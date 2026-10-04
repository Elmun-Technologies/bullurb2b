import { createHash, timingSafeEqual } from 'node:crypto';

import type { ParsedTelegramCommand, TelegramCommand, TelegramIncomingUpdate } from './types';

/**
 * Webhook request validation and Update parsing.
 *
 * Every webhook call must carry the `X-Telegram-Bot-Api-Secret-Token` header
 * matching the `secret_token` registered via `setWebhook`. Comparison is
 * timing-safe. `message` updates and `callback_query` updates (inline buttons)
 * are processed — the webhook is registered with
 * `allowed_updates: ["message", "callback_query"]`, and anything else is
 * ignored defensively.
 */

export const TELEGRAM_WEBHOOK_SECRET_HEADER = 'x-telegram-bot-api-secret-token';

/** Update types this integration subscribes to via `allowed_updates`. */
export const TELEGRAM_ALLOWED_UPDATES = ['message', 'callback_query'] as const;

export function verifyWebhookSecret(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedHash = createHash('sha256').update(provided, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function verifyBearerSecret(provided: string | null | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const providedHash = createHash('sha256').update(provided, 'utf8').digest();
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function extractBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer (.+)$/u.exec(header.trim());
  return match ? match[1].trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Validates an incoming Update payload. Returns the typed update, or null for
 * malformed bodies and update types this bot does not handle.
 */
export function parseTelegramUpdate(body: unknown): TelegramIncomingUpdate | null {
  if (!isRecord(body)) return null;
  if (typeof body.update_id !== 'number' || !Number.isInteger(body.update_id)) return null;

  const update: TelegramIncomingUpdate = { updateId: body.update_id };
  if ('callback_query' in body && body.callback_query !== undefined) {
    const callbackQuery = body.callback_query;
    if (!isRecord(callbackQuery) || typeof callbackQuery.id !== 'string') return null;
    if (!isRecord(callbackQuery.from) || typeof callbackQuery.from.id !== 'number') return null;
    if (!isRecord(callbackQuery.message) || !isRecord(callbackQuery.message.chat)) return null;
    if (typeof callbackQuery.message.chat.id !== 'number' || typeof callbackQuery.message.message_id !== 'number') return null;
    if (typeof callbackQuery.data !== 'string') return null;
    update.callbackQuery = {
      id: callbackQuery.id,
      fromId: callbackQuery.from.id,
      chatId: callbackQuery.message.chat.id,
      messageId: callbackQuery.message.message_id,
      data: callbackQuery.data,
    };
    return update;
  }
  if (!('message' in body) || body.message === undefined) return update;

  const message = body.message;
  if (!isRecord(message)) return null;
  if (typeof message.message_id !== 'number' || !isRecord(message.chat)) return null;
  if (typeof message.chat.id !== 'number' || typeof message.chat.type !== 'string') return null;
  if ('text' in message && message.text !== undefined && typeof message.text !== 'string') return null;
  if ('from' in message && message.from !== undefined) {
    if (!isRecord(message.from) || typeof message.from.id !== 'number') return null;
  }
  if ('contact' in message && message.contact !== undefined) {
    if (!isRecord(message.contact) || typeof message.contact.phone_number !== 'string') return null;
    if (message.contact.user_id !== undefined && typeof message.contact.user_id !== 'number') return null;
    if (message.contact.first_name !== undefined && typeof message.contact.first_name !== 'string') return null;
  }
  if ('location' in message && message.location !== undefined) {
    if (!isRecord(message.location) || typeof message.location.latitude !== 'number' || typeof message.location.longitude !== 'number') return null;
    if (!Number.isFinite(message.location.latitude) || !Number.isFinite(message.location.longitude)) return null;
  }

  const contact = isRecord(message.contact) ? message.contact : null;
  const location = isRecord(message.location) ? message.location : null;
  update.message = {
    messageId: message.message_id,
    chat: { id: message.chat.id, type: message.chat.type },
    from: isRecord(message.from) ? { id: message.from.id as number } : undefined,
    text: typeof message.text === 'string' ? message.text : undefined,
    contact: contact
      ? {
          phoneNumber: contact.phone_number as string,
          ...(typeof contact.first_name === 'string' ? { firstName: contact.first_name } : {}),
          ...(typeof contact.user_id === 'number' ? { userId: contact.user_id } : {}),
        }
      : undefined,
    location: location ? { latitude: location.latitude as number, longitude: location.longitude as number } : undefined,
  };
  return update;
}

/**
 * Parses `/start`, `/start <payload>`, `/help`, `/stop`, `/profil`,
 * `/dastur`, `/katalog`, `/menu` (with optional `@botname` mention).
 * Anything else is `unknown`. A mention for a different bot is treated as
 * unknown so group chatter for other bots is ignored.
 */
export function parseTelegramCommand(text: string, botUsername: string | null): ParsedTelegramCommand {
  const rawText = text;
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return { command: 'unknown', payload: '', rawText };

  const firstSpace = trimmed.search(/\s/u);
  const commandToken = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).toLowerCase();
  const payload = firstSpace === -1 ? '' : trimmed.slice(firstSpace).trim();

  const [commandPart, mentionPart] = commandToken.slice(1).split('@', 2);
  const aliases: Record<string, TelegramCommand> = { start: 'start', help: 'help', stop: 'stop', profil: 'profile', dastur: 'program', katalog: 'catalog', menu: 'menu', menyu: 'menu' };
  const command = aliases[commandPart] ?? 'unknown';
  if (command === 'unknown') return { command, payload: '', rawText };

  if (mentionPart !== undefined) {
    const expected = (botUsername ?? '').trim().replace(/^@/u, '').toLowerCase();
    if (!expected || mentionPart !== expected) return { command: 'unknown', payload: '', rawText };
  }
  return { command, payload, rawText };
}
