import 'server-only';

import type {
  ShopFlowCategory,
  ShopFlowHealth,
  ShopFlowLocale,
  ShopFlowOrderRequest,
  ShopFlowProduct,
  ShopFlowProductList,
  ShopFlowProductQuery,
  ShopFlowPromotion,
  ShopFlowUpsellOffer,
} from './types';
import {
  assertCategoryList,
  assertOrderResult,
  assertProduct,
  assertProductList,
  assertPromotionList,
  assertUpsellList,
  ShopFlowValidationError,
} from './validation';

/**
 * Server-only ShopFlow Public API v1 client.
 *
 * Follows the integration guide exactly: `Authorization: Bearer <sf_...>`
 * header, `?locale=uz|ru|en` on reads, integer UZS money, and the documented
 * error envelopes (`{error}`, Zod `{error,details}`, order `{ok:false}`).
 * Rate limit is 300 req/min/IP — HTTP 429 is retried with a delay, 5xx and
 * network failures with bounded exponential backoff.
 *
 * The API key travels in a header (never in a URL) and is never written to
 * logs, errors or responses — only method, path and status are logged.
 */

export type ShopFlowFailure =
  | 'unauthorized'
  | 'not-found'
  | 'validation'
  | 'conflict'
  | 'rate-limited'
  | 'transient'
  | 'invalid-data'
  | 'unconfigured'
  | 'unknown';

export class ShopFlowApiError extends Error {
  constructor(
    message: string,
    readonly options: {
      status?: number;
      failure: ShopFlowFailure;
      retryable: boolean;
      details?: { path: string; message: string }[];
      /** Variant choices relayed on the documented “variantId required” 400. */
      variants?: { id: string; name: string }[];
    },
  ) {
    super(message);
    this.name = 'ShopFlowApiError';
  }
}

export interface ShopFlowClientLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const noopShopFlowLogger: ShopFlowClientLogger = { info() {}, warn() {}, error() {} };

export interface ShopFlowClientOptions {
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  /** Base delay for 429 retries (the guide suggests waiting before retry). */
  rateLimitDelayMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logger?: ShopFlowClientLogger;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * (baseDelayMs / 2));
  return Math.min(maxDelayMs, exponential + jitter);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export class ShopFlowClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly rateLimitDelayMs: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: ShopFlowClientLogger;

  constructor(baseUrl: string, apiKey: string, options: ShopFlowClientOptions = {}) {
    if (!baseUrl || !/^https?:\/\/.+/u.test(baseUrl.trim())) {
      throw new ShopFlowApiError('ShopFlow API URL is missing or invalid.', { failure: 'unconfigured', retryable: false });
    }
    if (!apiKey || !apiKey.trim()) {
      throw new ShopFlowApiError('ShopFlow API key is missing.', { failure: 'unconfigured', retryable: false });
    }
    this.baseUrl = baseUrl.trim().replace(/\/+$/u, '');
    this.apiKey = apiKey.trim();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.rateLimitDelayMs = options.rateLimitDelayMs ?? 1000;
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 8_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? noopShopFlowLogger;
  }

  /** `GET /api/health` — note: served outside `/api/v1` per the guide. */
  async health(): Promise<ShopFlowHealth> {
    const root = this.baseUrl.replace(/\/api\/v1$/u, '');
    const body = await this.request<Record<string, unknown>>('GET', `${root}/api/health`, undefined, { apiPrefix: '' });
    if (typeof body.status !== 'string' || typeof body.db !== 'string' || typeof body.ts !== 'string') {
      throw new ShopFlowApiError('ShopFlow health response has an unexpected shape.', { failure: 'invalid-data', retryable: false });
    }
    return { status: body.status, db: body.db, ts: body.ts };
  }

  async categories(locale: ShopFlowLocale = 'uz'): Promise<ShopFlowCategory[]> {
    return assertCategoryList(await this.request<unknown>('GET', `/categories?locale=${locale}`));
  }

  async products(query: ShopFlowProductQuery = {}): Promise<ShopFlowProductList> {
    const params = new URLSearchParams();
    if (query.locale) params.set('locale', query.locale);
    if (query.category) params.set('category', query.category);
    if (query.search) params.set('search', query.search);
    if (query.origin) params.set('origin', query.origin);
    if (query.minPrice !== undefined) params.set('minPrice', String(query.minPrice));
    if (query.maxPrice !== undefined) params.set('maxPrice', String(query.maxPrice));
    if (query.sort) params.set('sort', query.sort);
    if (query.page !== undefined) params.set('page', String(query.page));
    if (query.pageSize !== undefined) params.set('pageSize', String(query.pageSize));
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return assertProductList(await this.request<unknown>('GET', `/products${suffix}`));
  }

  async product(slugOrId: string, locale: ShopFlowLocale = 'uz'): Promise<ShopFlowProduct> {
    if (!slugOrId.trim()) throw new ShopFlowApiError('Product slug is required.', { failure: 'validation', retryable: false });
    return assertProduct(await this.request<unknown>('GET', `/products/${encodeURIComponent(slugOrId.trim())}?locale=${locale}`));
  }

  async upsells(productId: string): Promise<ShopFlowUpsellOffer[]> {
    if (!productId.trim()) throw new ShopFlowApiError('Product id is required.', { failure: 'validation', retryable: false });
    return assertUpsellList(await this.request<unknown>('GET', `/products/${encodeURIComponent(productId.trim())}/upsells`));
  }

  async promotions(): Promise<ShopFlowPromotion[]> {
    return assertPromotionList(await this.request<unknown>('GET', '/promotions'));
  }

  async createOrder(body: ShopFlowOrderRequest): Promise<{ orderId: string; message: string }> {
    const result = assertOrderResult(await this.request<unknown>('POST', '/orders', body));
    if (!result.ok) {
      // ShopFlow may answer 200 with {ok:false} for business failures — map by message.
      throw new ShopFlowApiError(result.message || 'ShopFlow rejected the order.', { failure: 'conflict', retryable: false });
    }
    return { orderId: result.orderId as string, message: result.message ?? '' };
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown, options: { apiPrefix?: string } = {}): Promise<T> {
    const prefix = options.apiPrefix === '' ? '' : this.baseUrl;
    const url = `${prefix}${path}`;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        let response: Response;
        try {
          response = await this.fetchImpl(url, {
            method,
            headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        const payload = (await response.json().catch(() => null)) as unknown;
        if (response.ok) return payload as T;

        const envelope = isRecord(payload) ? payload : {};
        const message = typeof envelope.error === 'string' ? envelope.error : typeof envelope.message === 'string' ? envelope.message : `HTTP ${response.status}`;

        if (response.status === 429) {
          lastError = new ShopFlowApiError(`ShopFlow rate limit hit: ${message}`, { status: 429, failure: 'rate-limited', retryable: true });
          this.logger.warn(`shopflow.${method} ${path} rate limited (429), attempt=${attempt + 1}`);
          if (attempt + 1 < this.maxAttempts) {
            await this.sleep(this.rateLimitDelayMs * (attempt + 1));
            continue;
          }
          throw lastError;
        }
        if (response.status === 401) {
          throw new ShopFlowApiError('ShopFlow API key was rejected (401).', { status: 401, failure: 'unauthorized', retryable: false });
        }
        if (response.status === 404) {
          throw new ShopFlowApiError(`ShopFlow resource not found: ${message}`, { status: 404, failure: 'not-found', retryable: false });
        }
        if (response.status === 400) {
          const details = Array.isArray(envelope.details)
            ? (envelope.details as unknown[]).filter(isRecord).map((d) => ({ path: String(d.path ?? ''), message: String(d.message ?? '') }))
            : undefined;
          const variants = Array.isArray(envelope.variants)
            ? (envelope.variants as unknown[])
                .filter(isRecord)
                .filter((v) => typeof v.id === 'string' && typeof v.name === 'string')
                .map((v) => ({ id: v.id as string, name: v.name as string }))
            : undefined;
          this.logger.warn(`shopflow.${method} ${path} validation failed (400): ${message}`);
          throw new ShopFlowApiError(`ShopFlow validation failed: ${message}`, { status: 400, failure: 'validation', retryable: false, details, variants });
        }
        if (response.status === 409) {
          this.logger.warn(`shopflow.${method} ${path} conflict (409): ${message}`);
          throw new ShopFlowApiError(message, { status: 409, failure: 'conflict', retryable: false });
        }
        if (response.status >= 500 && response.status <= 599) {
          lastError = new ShopFlowApiError(`ShopFlow transient failure: ${message}`, { status: response.status, failure: 'transient', retryable: true });
          this.logger.warn(`shopflow.${method} ${path} transient HTTP ${response.status}, attempt=${attempt + 1}`);
          if (attempt + 1 < this.maxAttempts) {
            await this.sleep(backoffDelayMs(attempt, this.baseDelayMs, this.maxDelayMs));
            continue;
          }
          throw lastError;
        }
        this.logger.error(`shopflow.${method} ${path} failed: HTTP ${response.status} ${message}`);
        throw new ShopFlowApiError(`ShopFlow request failed: ${message}`, { status: response.status, failure: 'unknown', retryable: false });
      } catch (error) {
        if (error instanceof ShopFlowApiError || error instanceof ShopFlowValidationError) throw error;
        lastError = error;
        const reason = error instanceof Error ? error.name : 'network-error';
        this.logger.warn(`shopflow.${method} ${path} network failure (${reason}), attempt=${attempt + 1}`);
        if (attempt + 1 < this.maxAttempts) {
          await this.sleep(backoffDelayMs(attempt, this.baseDelayMs, this.maxDelayMs));
          continue;
        }
        throw new ShopFlowApiError(`ShopFlow network failure: ${error instanceof Error ? error.message : 'unknown'}`, {
          failure: 'transient',
          retryable: true,
        });
      }
    }
    throw lastError instanceof Error ? lastError : new ShopFlowApiError('ShopFlow request failed.', { failure: 'unknown', retryable: false });
  }
}
