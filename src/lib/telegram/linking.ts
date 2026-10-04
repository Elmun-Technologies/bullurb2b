import { randomBytes, createHmac } from 'node:crypto';

import type { VerifiedPrincipal } from '@/lib/auth/policy';
import type { PendingTelegramLink, TelegramLocale } from './types';
import type { TelegramStores } from './stores';

/**
 * Secure account linking between a Telegram chat and a verified portal user.
 *
 * Linking NEVER trusts the demo role switcher or any browser-supplied role:
 * a one-time code is issued only for a server-verified principal (Shopflow
 * session), and the binding is created only when that code arrives back via
 * the `/start <code>` deep link. Codes are short-lived (10 minutes), single
 * use (consumed atomically from the link store), and only an HMAC-SHA-256
 * digest keyed by the server-only `TELEGRAM_LINKING_SECRET` is persisted, so
 * stolen hashes cannot be brute-forced offline. Raw codes travel only:
 * portal session → user → Telegram bot.
 */

export const LINK_CODE_TTL_MS = 10 * 60 * 1000;

/** Deep-link payload charset from the Bot API docs: A–Z a–z 0–9 _ -, ≤64 chars. */
const LINK_CODE_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const BOT_USERNAME_PATTERN = /^[A-Za-z0-9_]{5,32}$/;

export function generateLinkCode(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashLinkCode(code: string, linkingSecret: string): string {
  if (!linkingSecret) throw new Error('Linking secret is required to hash a code.');
  return createHmac('sha256', linkingSecret).update(code, 'utf8').digest('hex');
}

export function isPlausibleLinkCode(value: string): boolean {
  return LINK_CODE_PATTERN.test(value.trim());
}

export function buildTelegramDeepLink(botUsername: string, code: string): string {
  const username = botUsername.trim().replace(/^@/u, '');
  if (!BOT_USERNAME_PATTERN.test(username)) throw new Error('Telegram bot username is not configured correctly.');
  if (!isPlausibleLinkCode(code)) throw new Error('Link code has an unexpected format.');
  return `https://t.me/${username}?start=${code.trim()}`;
}

export class LinkAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LinkAuthorizationError';
  }
}

export interface IssuedLinkCode {
  code: string;
  deepLink: string | null;
  expiresAt: number;
}

/**
 * Issues a single-use linking code for an already verified principal.
 * Throws `LinkAuthorizationError` when the principal has no usable scope
 * (e.g. a client without a resolved MoySklad customer mapping).
 */
export async function issueLinkCode(input: {
  principal: VerifiedPrincipal;
  stores: TelegramStores;
  linkingSecret: string;
  botUsername: string | null;
  locale?: TelegramLocale;
  nowMs?: number;
  ttlMs?: number;
}): Promise<IssuedLinkCode> {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? LINK_CODE_TTL_MS;
  const locale = input.locale ?? 'uz';

  if (input.principal.role === 'CLIENT' && !input.principal.moySkladCustomerId) {
    throw new LinkAuthorizationError('Client has no verified MoySklad customer mapping; cannot issue a Telegram link code.');
  }
  if (input.principal.role === 'SALES_MANAGER' && !(input.principal.assignedCustomerIds?.length)) {
    throw new LinkAuthorizationError('Manager has no assigned customers; cannot issue a Telegram link code.');
  }

  const code = generateLinkCode();
  const pending: PendingTelegramLink = {
    codeHash: hashLinkCode(code, input.linkingSecret),
    subjectId: input.principal.subjectId,
    role: input.principal.role,
    customerId: input.principal.moySkladCustomerId,
    managerCustomerIds: input.principal.assignedCustomerIds ? [...input.principal.assignedCustomerIds] : undefined,
    locale,
    createdAt: nowMs,
    expiresAt: nowMs + ttlMs,
  };
  await input.stores.links.savePending(pending);

  let deepLink: string | null = null;
  if (input.botUsername) {
    try {
      deepLink = buildTelegramDeepLink(input.botUsername, code);
    } catch {
      deepLink = null;
    }
  }
  return { code, deepLink, expiresAt: pending.expiresAt };
}

/** Consumes a raw code received via `/start <code>`; null when invalid/expired/used. */
export async function consumeLinkCode(input: { code: string; stores: TelegramStores; linkingSecret: string; nowMs?: number }): Promise<PendingTelegramLink | null> {
  const code = input.code.trim();
  if (!isPlausibleLinkCode(code)) return null;
  return input.stores.links.consume(hashLinkCode(code, input.linkingSecret), input.nowMs ?? Date.now());
}
