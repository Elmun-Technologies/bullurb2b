import 'server-only';

import { TELEGRAM_MAX_TEXT_LENGTH } from './messages';
import type { TelegramChatId, TelegramReplyMarkup } from './types';

/**
 * Minimal Telegram Bot API client (`sendMessage`, `setWebhook`).
 *
 * Endpoints and behavior follow the official Bot API documentation:
 * `POST https://api.telegram.org/bot<token>/<method>`. Rate limits are
 * honored per the Bot FAQ: roughly 1 message/second per chat, ~30/second
 * overall; HTTP 429 responses carry `parameters.retry_after` (seconds) which
 * is honored exactly. 5xx/network failures use bounded exponential backoff.
 *
 * The bot token is part of the request URL, so URLs and tokens are never
 * written to logs — only the method name and Telegram's error codes are.
 */

export interface TelegramSendSuccess {
  ok: true;
  messageId: number;
}

export type TelegramSendOutcome = TelegramSendSuccess;

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly options: { errorCode?: number; retryable: boolean; reason: 'auth' | 'blocked' | 'chat-missing' | 'bad-request' | 'rate-limited' | 'transient' | 'unknown' },
  ) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

export function isChatInactiveError(error: unknown): boolean {
  return error instanceof TelegramApiError && (error.options.reason === 'blocked' || error.options.reason === 'chat-missing');
}

/** Replaces any occurrence of known secrets with `[REDACTED]` before logging. */
export function redactSecrets(text: string, secrets: Array<string | null | undefined>): string {
  let redacted = text;
  for (const secret of secrets) {
    if (!secret) continue;
    const token = secret.trim();
    if (token.length < 4) continue;
    redacted = redacted.split(token).join('[REDACTED]');
  }
  return redacted;
}

export interface TelegramClientLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const noopTelegramLogger: TelegramClientLogger = { info() {}, warn() {}, error() {} };

interface TelegramApiEnvelope {
  ok?: boolean;
  result?: { message_id?: number };
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number; migrate_to_chat_id?: number };
}

export interface TelegramClientOptions {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  logger?: TelegramClientLogger;
  /** Extra per-call secrets to redact from logs (defense in depth). */
  redact?: Array<string | null | undefined>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

function backoffDelayMs(attempt: number, baseDelayMs: number, maxDelayMs: number): number {
  const exponential = baseDelayMs * 2 ** attempt;
  const jitter = Math.floor(Math.random() * (baseDelayMs / 2));
  return Math.min(maxDelayMs, exponential + jitter);
}

export class TelegramBotApiClient {
  private readonly token: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly logger: TelegramClientLogger;
  private readonly redact: Array<string | null | undefined>;

  constructor(token: string, options: TelegramClientOptions = {}) {
    if (!token || !token.trim()) throw new TelegramApiError('Telegram bot token is missing.', { retryable: false, reason: 'auth' });
    this.token = token.trim();
    this.baseUrl = (options.baseUrl ?? 'https://api.telegram.org').replace(/\/+$/u, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 5);
    this.baseDelayMs = options.baseDelayMs ?? 500;
    this.maxDelayMs = options.maxDelayMs ?? 15_000;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.sleep = options.sleep ?? defaultSleep;
    this.logger = options.logger ?? noopTelegramLogger;
    this.redact = options.redact ?? [];
  }

  async sendMessage(chatId: TelegramChatId | string, text: string, options: { replyMarkup?: TelegramReplyMarkup } = {}): Promise<TelegramSendOutcome> {
    const normalized = text.trim();
    if (!normalized) throw new TelegramApiError('Refusing to send an empty Telegram message.', { retryable: false, reason: 'bad-request' });
    if (normalized.length > TELEGRAM_MAX_TEXT_LENGTH) {
      throw new TelegramApiError(`Telegram message exceeds ${TELEGRAM_MAX_TEXT_LENGTH} characters.`, { retryable: false, reason: 'bad-request' });
    }
    const result = await this.callApi<{ message_id?: number }>('sendMessage', {
      chat_id: chatId,
      text: normalized,
      disable_web_page_preview: true,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    });
    return { ok: true as const, messageId: typeof result.message_id === 'number' ? result.message_id : 0 };
  }

  async setWebhook(url: string, input: { secretToken: string; allowedUpdates?: string[] }): Promise<true> {
    await this.callApi<true>('setWebhook', { url, secret_token: input.secretToken, allowed_updates: input.allowedUpdates ?? ['message'] });
    return true;
  }

  private log(level: 'info' | 'warn' | 'error', message: string): void {
    this.logger[level](redactSecrets(message, [this.token, ...this.redact]));
  }

  private async callApi<T>(method: string, payload: Record<string, unknown>): Promise<T> {
    // The token is embedded in the Bot API URL path; never log this URL.
    const endpoint = `${this.baseUrl}/bot${this.token}/${method}`;
    let lastError: unknown = null;

    for (let attempt = 0; attempt < this.maxAttempts; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
        let response: Response;
        try {
          response = await this.fetchImpl(endpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        const envelope = (await response.json().catch(() => null)) as TelegramApiEnvelope | null;
        if (response.ok && envelope?.ok) {
          if (attempt > 0) this.log('info', `telegram.${method} succeeded for chat after ${attempt + 1} attempts`);
          return (envelope.result ?? true) as T;
        }

        const errorCode = envelope?.error_code ?? response.status;
        const description = envelope?.description ?? `HTTP ${response.status}`;
        const retryAfterSec = envelope?.parameters?.retry_after;

        if (response.status === 429 || errorCode === 429) {
          const waitMs = Math.max(0, (typeof retryAfterSec === 'number' ? retryAfterSec : 1) * 1000);
          this.log('warn', `telegram.${method} rate limited (429), retry_after=${retryAfterSec ?? 'missing'}s, attempt=${attempt + 1}`);
          lastError = new TelegramApiError(`Telegram rate limit hit: ${description}`, { errorCode: 429, retryable: true, reason: 'rate-limited' });
          if (attempt + 1 < this.maxAttempts) {
            await this.sleep(waitMs);
            continue;
          }
          throw lastError;
        }

        if (response.status === 401 || errorCode === 401) {
          throw new TelegramApiError('Telegram bot token was rejected (401).', { errorCode: 401, retryable: false, reason: 'auth' });
        }

        if (response.status === 403 || errorCode === 403) {
          this.log('info', `telegram.${method} forbidden (403): chat blocked the bot or cannot receive messages`);
          throw new TelegramApiError('Telegram chat is not reachable (403).', { errorCode: 403, retryable: false, reason: 'blocked' });
        }

        if (response.status >= 500 && response.status <= 599) {
          lastError = new TelegramApiError(`Telegram API transient failure: ${description}`, { errorCode, retryable: true, reason: 'transient' });
          this.log('warn', `telegram.${method} transient HTTP ${response.status}, attempt=${attempt + 1}`);
          if (attempt + 1 < this.maxAttempts) {
            await this.sleep(backoffDelayMs(attempt, this.baseDelayMs, this.maxDelayMs));
            continue;
          }
          throw lastError;
        }

        const normalizedDescription = description.toLowerCase();
        if (normalizedDescription.includes('chat not found') || normalizedDescription.includes('user not found') || normalizedDescription.includes('bot was kicked') || normalizedDescription.includes('bot was blocked')) {
          this.log('info', `telegram.${method} chat missing (${errorCode}), marking inactive`);
          throw new TelegramApiError(`Telegram chat is missing: ${description}`, { errorCode, retryable: false, reason: 'chat-missing' });
        }

        this.log('error', `telegram.${method} failed: error_code=${errorCode} description=${description}`);
        throw new TelegramApiError(`Telegram API error: ${description}`, { errorCode, retryable: false, reason: response.status === 400 ? 'bad-request' : 'unknown' });
      } catch (error) {
        if (error instanceof TelegramApiError) throw error;
        lastError = error;
        const reason = error instanceof Error ? error.name : 'network-error';
        this.log('warn', `telegram.${method} network failure (${reason}), attempt=${attempt + 1}`);
        if (attempt + 1 < this.maxAttempts) {
          await this.sleep(backoffDelayMs(attempt, this.baseDelayMs, this.maxDelayMs));
          continue;
        }
        throw new TelegramApiError(`Telegram network failure: ${error instanceof Error ? error.message : 'unknown'}`, { retryable: true, reason: 'transient' });
      }
    }
    throw lastError instanceof Error ? lastError : new TelegramApiError('Telegram request failed.', { retryable: false, reason: 'unknown' });
  }
}
