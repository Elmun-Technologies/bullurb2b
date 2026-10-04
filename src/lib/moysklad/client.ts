import 'server-only';

import type { MoySkladCounterparty, MoySkladCounterpartyCreate } from './types';
import { assertCounterparty, assertCounterpartyList, errorEnvelopeMessage, MoySkladValidationError } from './validation';
import { digitsOnly, sameUzPhone } from './phone';

/**
 * Server-only MoySklad JSON API 1.2 client (counterparty identity subset).
 *
 * Verified against the official docs (https://dev.moysklad.ru/doc/api/remap/1.2/):
 * `Authorization: Bearer`, MANDATORY `Accept-Encoding: gzip` (missing header
 * yields HTTP 415 with no body), context `?search=`, list shape
 * `{meta:{size,limit,offset}, rows:[]}`, error envelope `{errors:[...]}`.
 *
 * 429 honors the `Retry-After` header when present, otherwise backs off;
 * 5xx/network failures use bounded exponential backoff. The token is never
 * written to logs — only method, path and status are logged.
 */

export type MoySkladFailure =
  | 'unauthorized'
  | 'not-found'
  | 'validation'
  | 'rate-limited'
  | 'transient'
  | 'invalid-data'
  | 'unconfigured'
  | 'unknown';

export class MoySkladApiError extends Error {
  constructor(
    message: string,
    readonly options: { status?: number; failure: MoySkladFailure; retryable: boolean },
  ) {
    super(message);
    this.name = 'MoySkladApiError';
  }
}

export interface MoySkladClientLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const noopMoySkladLogger: MoySkladClientLogger = { info() {}, warn() {}, error() {} };

export interface MoySkladClientOptions {
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  rateLimitDelayMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logger?: MoySkladClientLogger;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * (baseDelayMs / 2));
  return Math.min(maxDelayMs, exponential + jitter);
}

export type MoySkladFindResult =
  | { status: 'found'; counterparty: MoySkladCounterparty }
  | { status: 'not-found' }
  | { status: 'ambiguous'; matches: MoySkladCounterparty[] };

export class MoySkladClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly rateLimitDelayMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: MoySkladClientLogger;

  constructor(baseUrl: string, token: string, options: MoySkladClientOptions = {}) {
    if (!baseUrl || !/^https?:\/\/.+/u.test(baseUrl.trim())) {
      throw new MoySkladApiError('MoySklad API URL is missing or invalid.', { failure: 'unconfigured', retryable: false });
    }
    if (!token || !token.trim()) {
      throw new MoySkladApiError('MoySklad API token is missing.', { failure: 'unconfigured', retryable: false });
    }
    this.baseUrl = baseUrl.trim().replace(/\/+$/u, '');
    this.token = token.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.rateLimitDelayMs = options.rateLimitDelayMs ?? 1000;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 8_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? noopMoySkladLogger;
  }

  /** Context search across counterparty string fields (documented `?search=`). */
  async searchCounterparties(query: string, limit = 10): Promise<MoySkladCounterparty[]> {
    const trimmed = query.trim();
    if (!trimmed) throw new MoySkladApiError('Search query is required.', { failure: 'validation', retryable: false });
    const safeLimit = Math.min(1000, Math.max(1, Math.floor(limit)));
    const list = assertCounterpartyList(
      await this.request<unknown>('GET', `/entity/counterparty?search=${encodeURIComponent(trimmed)}&limit=${safeLimit}&offset=0`),
    );
    return list.rows;
  }

  async getCounterparty(id: string): Promise<MoySkladCounterparty> {
    if (!id.trim()) throw new MoySkladApiError('Counterparty id is required.', { failure: 'validation', retryable: false });
    return assertCounterparty(await this.request<unknown>('GET', `/entity/counterparty/${encodeURIComponent(id.trim())}`));
  }

  /**
   * Finds the single counterparty matching an E.164 phone. MoySklad stores
   * phones in arbitrary formats, so candidates from context search are
   * re-matched client-side with tolerant Uzbek normalization.
   */
  async findByPhone(phoneE164: string): Promise<MoySkladFindResult> {
    const digits = digitsOnly(phoneE164);
    if (!digits) throw new MoySkladApiError('Phone number is required.', { failure: 'validation', retryable: false });
    const candidates = await this.searchCounterparties(digits);
    const matches = candidates.filter((candidate) => candidate.phone && sameUzPhone(candidate.phone, phoneE164));
    if (matches.length === 1) return { status: 'found', counterparty: matches[0] };
    if (matches.length === 0) return { status: 'not-found' };
    this.logger.warn(`moysklad.findByPhone ambiguous: ${matches.length} counterparties match the phone`);
    return { status: 'ambiguous', matches };
  }

  /** Creates a counterparty (`name` required; phone + description documented). */
  async createCounterparty(input: MoySkladCounterpartyCreate): Promise<MoySkladCounterparty> {
    const name = input.name.trim();
    const phone = input.phone.trim();
    if (!name || !phone) throw new MoySkladApiError('Counterparty name and phone are required.', { failure: 'validation', retryable: false });
    return assertCounterparty(
      await this.request<unknown>('POST', '/entity/counterparty', {
        name: name.slice(0, 255),
        phone: phone.slice(0, 255),
        ...(input.description?.trim() ? { description: input.description.trim().slice(0, 4096) } : {}),
      }),
    );
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            method,
            headers: {
              authorization: `Bearer ${this.token}`,
              'content-type': 'application/json',
              // Mandatory per docs: requests without gzip Accept-Encoding get HTTP 415 with no body.
              'accept-encoding': 'gzip',
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        const payload = (await response.json().catch(() => null)) as unknown;
        if (response.ok) return payload as T;

        const message = errorEnvelopeMessage(payload, `HTTP ${response.status}`);
        if (response.status === 429) {
          const retryAfterSec = Number(response.headers.get('retry-after'));
          const waitMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0 ? retryAfterSec * 1000 : this.rateLimitDelayMs * (attempt + 1);
          lastError = new MoySkladApiError(`MoySklad rate limit hit: ${message}`, { status: 429, failure: 'rate-limited', retryable: true });
          this.logger.warn(`moysklad.${method} ${path} rate limited (429), attempt=${attempt + 1}`);
          if (attempt + 1 < this.maxAttempts) {
            await this.sleep(waitMs);
            continue;
          }
          throw lastError;
        }
        if (response.status === 401 || response.status === 403) {
          throw new MoySkladApiError('MoySklad token was rejected.', { status: response.status, failure: 'unauthorized', retryable: false });
        }
        if (response.status === 404) {
          throw new MoySkladApiError(`MoySklad resource not found: ${message}`, { status: 404, failure: 'not-found', retryable: false });
        }
        if (response.status === 400 || response.status === 412) {
          this.logger.warn(`moysklad.${method} ${path} validation failed (${response.status}): ${message}`);
          throw new MoySkladApiError(`MoySklad validation failed: ${message}`, { status: response.status, failure: 'validation', retryable: false });
        }
        if (response.status === 415) {
          this.logger.error(`moysklad.${method} ${path} missing gzip encoding (415): client misconfiguration`);
          throw new MoySkladApiError('MoySklad rejected the request encoding (415).', { status: 415, failure: 'unknown', retryable: false });
        }
        if (response.status >= 500 && response.status <= 599) {
          lastError = new MoySkladApiError(`MoySklad transient failure: ${message}`, { status: response.status, failure: 'transient', retryable: true });
          this.logger.warn(`moysklad.${method} ${path} transient HTTP ${response.status}, attempt=${attempt + 1}`);
          if (attempt + 1 < this.maxAttempts) {
            await this.sleep(backoffDelayMs(attempt, this.baseDelayMs, this.maxDelayMs));
            continue;
          }
          throw lastError;
        }
        this.logger.error(`moysklad.${method} ${path} failed: HTTP ${response.status} ${message}`);
        throw new MoySkladApiError(`MoySklad request failed: ${message}`, { status: response.status, failure: 'unknown', retryable: false });
      } catch (error) {
        if (error instanceof MoySkladApiError || error instanceof MoySkladValidationError) throw error;
        lastError = error;
        const reason = error instanceof Error ? error.name : 'network-error';
        this.logger.warn(`moysklad.${method} ${path} network failure (${reason}), attempt=${attempt + 1}`);
        if (attempt + 1 < this.maxAttempts) {
          await this.sleep(backoffDelayMs(attempt, this.baseDelayMs, this.maxDelayMs));
          continue;
        }
        throw new MoySkladApiError(`MoySklad network failure: ${error instanceof Error ? error.message : 'unknown'}`, {
          failure: 'transient',
          retryable: true,
        });
      }
    }
    throw lastError instanceof Error ? lastError : new MoySkladApiError('MoySklad request failed.', { failure: 'unknown', retryable: false });
  }
}
