import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { IntegrationError } from '@/lib/providers/errors';
import {
  getTelegramPublicStatus,
  getTelegramServerConfig,
  isValidWebhookSecretFormat,
  requireTelegramDeliveryConfig,
} from './config';
import { TelegramApiError, TelegramBotApiClient, isChatInactiveError, redactSecrets } from './client';
import {
  buildFridayGreeting,
  buildHelpMessage,
  buildTierGapMessage,
  TELEGRAM_MAX_TEXT_LENGTH,
  truncateTelegramText,
} from './messages';
import { isFridayInTimezone, weekKeyInTimezone } from './schedule';
import { consumeLinkCode, generateLinkCode, hashLinkCode, isPlausibleLinkCode, issueLinkCode, LinkAuthorizationError } from './linking';
import { createMemoryTelegramStores, getTelegramStores, isUnconfiguredStores, resetMemoryTelegramStores, unconfiguredTelegramStores } from './stores';
import { parseTelegramCommand, parseTelegramUpdate, verifyBearerSecret, verifyWebhookSecret } from './webhook';
import { TEST_SECRETS, stubFullTelegramEnv as stubFullEnv } from './test-helpers';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('telegram server config fails closed', () => {
  it('reports disabled without an explicit opt-in', () => {
    expect(getTelegramServerConfig({})).toMatchObject({ status: 'disabled', enabled: false });
    expect(getTelegramServerConfig({ TELEGRAM_ENABLED: 'false', TELEGRAM_BOT_TOKEN: 'x' })).toMatchObject({ status: 'disabled' });
  });

  it('reports unconfigured when any required secret is missing or weak', () => {
    const base = {
      TELEGRAM_ENABLED: 'true',
      TELEGRAM_BOT_TOKEN: TEST_SECRETS.botToken,
      TELEGRAM_WEBHOOK_SECRET: TEST_SECRETS.webhookSecret,
      TELEGRAM_LINKING_SECRET: TEST_SECRETS.linkingSecret,
      TELEGRAM_CRON_SECRET: TEST_SECRETS.cronSecret,
    };
    expect(getTelegramServerConfig(base).status).toBe('ready');
    expect(getTelegramServerConfig({ ...base, TELEGRAM_BOT_TOKEN: '' }).missing).toContain('TELEGRAM_BOT_TOKEN');
    expect(getTelegramServerConfig({ ...base, TELEGRAM_WEBHOOK_SECRET: 'has space!' }).missing).toContain('TELEGRAM_WEBHOOK_SECRET');
    expect(getTelegramServerConfig({ ...base, TELEGRAM_LINKING_SECRET: 'short' }).missing).toContain('TELEGRAM_LINKING_SECRET');
    expect(getTelegramServerConfig({ ...base, TELEGRAM_CRON_SECRET: 'short' }).missing).toContain('TELEGRAM_CRON_SECRET');
  });

  it('refuses delivery config unless fully ready', () => {
    stubFullEnv();
    expect(requireTelegramDeliveryConfig().botToken).toBe(TEST_SECRETS.botToken);
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');
    expect(() => requireTelegramDeliveryConfig()).toThrow(IntegrationError);
  });

  it('rejects malformed webhook secret formats', () => {
    expect(isValidWebhookSecretFormat('abc-DEF_123')).toBe(true);
    expect(isValidWebhookSecretFormat('')).toBe(false);
    expect(isValidWebhookSecretFormat('has space')).toBe(false);
    expect(isValidWebhookSecretFormat('semi;colon')).toBe(false);
    expect(isValidWebhookSecretFormat('x'.repeat(257))).toBe(false);
  });
});

describe('server-only secrets never leak to public surfaces', () => {
  it('excludes every secret from the public status payload', () => {
    stubFullEnv();
    const serialized = JSON.stringify(getTelegramPublicStatus());
    expect(serialized).not.toContain(TEST_SECRETS.botToken);
    expect(serialized).not.toContain(TEST_SECRETS.webhookSecret);
    expect(serialized).not.toContain(TEST_SECRETS.linkingSecret);
    expect(serialized).not.toContain(TEST_SECRETS.cronSecret);
    expect(getTelegramPublicStatus().botUsername).toBe('BarakaTestBot');
  });

  it('redacts known secrets from log text', () => {
    const message = redactSecrets(`calling with ${TEST_SECRETS.botToken} and ${TEST_SECRETS.webhookSecret}`, [TEST_SECRETS.botToken, TEST_SECRETS.webhookSecret]);
    expect(message).not.toContain(TEST_SECRETS.botToken);
    expect(message).not.toContain(TEST_SECRETS.webhookSecret);
    expect(message).toContain('[REDACTED]');
  });

  it('keeps telegram secrets out of NEXT_PUBLIC_* and the committed env example', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) walk(path);
        else if ((path.endsWith('.ts') || path.endsWith('.tsx')) && !path.endsWith('.test.ts')) files.push(path);
      }
    };
    walk('src');
    for (const file of files) {
      expect(readFileSync(file, 'utf8')).not.toContain('NEXT_PUBLIC_TELEGRAM');
    }
    const example = readFileSync('.env.example', 'utf8');
    expect(example).not.toContain('NEXT_PUBLIC_TELEGRAM');
    expect(example).toMatch(/^TELEGRAM_BOT_TOKEN=$/m);
    expect(example).toMatch(/^TELEGRAM_WEBHOOK_SECRET=$/m);
    expect(example).toMatch(/^TELEGRAM_LINKING_SECRET=$/m);
    expect(example).toMatch(/^TELEGRAM_CRON_SECRET=$/m);
  });

  it('keeps the server config module behind the server-only boundary', () => {
    expect(readFileSync('src/lib/telegram/config.ts', 'utf8')).toContain("import 'server-only'");
    expect(readFileSync('src/lib/telegram/client.ts', 'utf8')).toContain("import 'server-only'");
    expect(readFileSync('src/lib/telegram/stores.ts', 'utf8')).toContain("import 'server-only'");
  });
});

describe('webhook secret verification', () => {
  it('accepts the exact secret and rejects anything else', () => {
    expect(verifyWebhookSecret('s3cret-value_1', 's3cret-value_1')).toBe(true);
    expect(verifyWebhookSecret('wrong', 's3cret-value_1')).toBe(false);
    expect(verifyWebhookSecret('', 's3cret-value_1')).toBe(false);
    expect(verifyWebhookSecret(null, 's3cret-value_1')).toBe(false);
    expect(verifyWebhookSecret('s3cret-value_1', '')).toBe(false);
    expect(verifyBearerSecret('cron-value', 'cron-value')).toBe(true);
    expect(verifyBearerSecret('cron-value!', 'cron-value')).toBe(false);
  });
});

describe('telegram update and command parsing', () => {
  it('accepts a private text message update', () => {
    const update = parseTelegramUpdate({ update_id: 7, message: { message_id: 1, chat: { id: 111, type: 'private' }, text: '/help' } });
    expect(update).toEqual({ updateId: 7, message: { messageId: 1, chat: { id: 111, type: 'private' }, text: '/help' } });
  });

  it('ignores non-message updates and malformed bodies', () => {
    expect(parseTelegramUpdate({ update_id: 8, callback_query: { id: 'q' } })).toEqual({ updateId: 8 });
    expect(parseTelegramUpdate({ update_id: 9, edited_message: {} })).toEqual({ updateId: 9 });
    expect(parseTelegramUpdate(null)).toBeNull();
    expect(parseTelegramUpdate({})).toBeNull();
    expect(parseTelegramUpdate({ update_id: 'nope' })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 'x', type: 'private' } } })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, text: 42 } })).toBeNull();
  });

  it('parses start/help/stop commands with payloads and mentions', () => {
    expect(parseTelegramCommand('/start ABC123', 'BarakaTestBot')).toMatchObject({ command: 'start', payload: 'ABC123' });
    expect(parseTelegramCommand('/start', 'BarakaTestBot')).toMatchObject({ command: 'start', payload: '' });
    expect(parseTelegramCommand('/START  code-1 ', 'BarakaTestBot')).toMatchObject({ command: 'start', payload: 'code-1' });
    expect(parseTelegramCommand('/help@BarakaTestBot', 'BarakaTestBot').command).toBe('help');
    expect(parseTelegramCommand('/stop@OtherBot', 'BarakaTestBot').command).toBe('unknown');
    expect(parseTelegramCommand('hello', 'BarakaTestBot').command).toBe('unknown');
    expect(parseTelegramCommand('/delete', 'BarakaTestBot').command).toBe('unknown');
  });
});

describe('secure account linking codes', () => {
  const clientPrincipal = { subjectId: 'user-1', role: 'CLIENT' as const, moySkladCustomerId: 'company-a' };

  it('issues single-use codes that expire', async () => {
    const stores = createMemoryTelegramStores();
    const issued = await issueLinkCode({ principal: clientPrincipal, stores, linkingSecret: TEST_SECRETS.linkingSecret, botUsername: 'BarakaTestBot', nowMs: 1_000 });
    expect(isPlausibleLinkCode(issued.code)).toBe(true);
    expect(issued.code.length).toBeLessThanOrEqual(64);
    expect(issued.deepLink).toBe(`https://t.me/BarakaTestBot?start=${issued.code}`);

    const consumed = await consumeLinkCode({ code: issued.code, stores, linkingSecret: TEST_SECRETS.linkingSecret, nowMs: 2_000 });
    expect(consumed).toMatchObject({ subjectId: 'user-1', role: 'CLIENT', customerId: 'company-a' });
    expect(await consumeLinkCode({ code: issued.code, stores, linkingSecret: TEST_SECRETS.linkingSecret, nowMs: 3_000 })).toBeNull();

    const expiring = await issueLinkCode({ principal: clientPrincipal, stores, linkingSecret: TEST_SECRETS.linkingSecret, botUsername: null, nowMs: 0, ttlMs: 60_000 });
    expect(await consumeLinkCode({ code: expiring.code, stores, linkingSecret: TEST_SECRETS.linkingSecret, nowMs: 61_000 })).toBeNull();
  });

  it('rejects unknown or malformed codes without touching subscriptions', async () => {
    const stores = createMemoryTelegramStores();
    expect(await consumeLinkCode({ code: generateLinkCode(), stores, linkingSecret: TEST_SECRETS.linkingSecret, nowMs: 0 })).toBeNull();
    expect(await consumeLinkCode({ code: 'not a code!!', stores, linkingSecret: TEST_SECRETS.linkingSecret, nowMs: 0 })).toBeNull();
    expect(await stores.subscriptions.listActive()).toHaveLength(0);
  });

  it('persists only the code hash, never the raw code', async () => {
    const stores = createMemoryTelegramStores();
    const issued = await issueLinkCode({ principal: clientPrincipal, stores, linkingSecret: TEST_SECRETS.linkingSecret, botUsername: null, nowMs: 0 });
    expect(hashLinkCode(issued.code, TEST_SECRETS.linkingSecret)).not.toBe(issued.code);
    expect(hashLinkCode(issued.code, TEST_SECRETS.linkingSecret)).not.toBe(hashLinkCode(issued.code, 'a-different-linking-secret-value-00'));
    // The raw code is not a valid store key; only its hash resolves.
    expect(await stores.links.consume(issued.code, 1)).toBeNull();
    expect(await consumeLinkCode({ code: issued.code, stores, linkingSecret: TEST_SECRETS.linkingSecret, nowMs: 1 })).not.toBeNull();
  });

  it('refuses codes for principals without a verified scope', async () => {
    const stores = createMemoryTelegramStores();
    await expect(issueLinkCode({ principal: { subjectId: 'u', role: 'CLIENT' }, stores, linkingSecret: TEST_SECRETS.linkingSecret, botUsername: null })).rejects.toThrow(LinkAuthorizationError);
    await expect(issueLinkCode({ principal: { subjectId: 'm', role: 'SALES_MANAGER', assignedCustomerIds: [] }, stores, linkingSecret: TEST_SECRETS.linkingSecret, botUsername: null })).rejects.toThrow(
      LinkAuthorizationError,
    );
  });
});

describe('telegram stores fail closed in production', () => {
  it('defaults to unconfigured stores and offers explicit memory stores only', async () => {
    expect(isUnconfiguredStores(getTelegramStores({}))).toBe(true);
    await expect(unconfiguredTelegramStores.subscriptions.listActive()).rejects.toThrow(IntegrationError);
    await expect(unconfiguredTelegramStores.deliveryLog.has('x')).rejects.toThrow(IntegrationError);
    await expect(unconfiguredTelegramStores.links.consume('x', 0)).rejects.toThrow(IntegrationError);

    resetMemoryTelegramStores();
    const memory = getTelegramStores({ TELEGRAM_STORE_MODE: 'memory' });
    expect(isUnconfiguredStores(memory)).toBe(false);
    await expect(memory.subscriptions.listActive()).resolves.toEqual([]);
    expect(getTelegramStores({ TELEGRAM_STORE_MODE: 'memory' })).toBe(memory);
  });
});

describe('friday and weekly scheduling in the configured timezone', () => {
  it('detects Friday in Asia/Tashkent even when UTC says Thursday', () => {
    expect(isFridayInTimezone(new Date('2026-09-25T05:00:00.000Z'), 'Asia/Tashkent')).toBe(true);
    expect(isFridayInTimezone(new Date('2026-09-24T20:00:00.000Z'), 'Asia/Tashkent')).toBe(true);
    expect(isFridayInTimezone(new Date('2026-09-25T20:00:00.000Z'), 'Asia/Tashkent')).toBe(false);
    expect(isFridayInTimezone(new Date('2026-09-28T07:00:00.000Z'), 'Asia/Tashkent')).toBe(false);
  });

  it('follows the configured timezone rather than the server clock', () => {
    const instant = new Date('2026-09-25T01:00:00.000Z');
    expect(isFridayInTimezone(instant, 'Asia/Tashkent')).toBe(true);
    expect(isFridayInTimezone(instant, 'America/New_York')).toBe(false);
  });

  it('computes stable ISO week keys per timezone', () => {
    expect(weekKeyInTimezone(new Date('2026-09-25T05:00:00.000Z'), 'Asia/Tashkent')).toBe('2026-W39');
    expect(weekKeyInTimezone(new Date('2026-09-28T05:00:00.000Z'), 'Asia/Tashkent')).toBe('2026-W40');
  });
});

describe('telegram message texts', () => {
  it('renders Uzbek-first texts with Russian support', () => {
    expect(buildFridayGreeting('uz', 'ALFA MARKET')).toContain('Juma muborak!');
    expect(buildFridayGreeting('ru', 'ALFA MARKET')).toContain('пятницей');
    expect(buildTierGapMessage('uz', { currentValue: 82, remaining: 18, nextTierName: 'Gold', discountPercent: 5, metric: 'boxes' })).toContain('18 quti');
    expect(buildTierGapMessage('ru', { currentValue: 82, remaining: 18, nextTierName: 'Gold', discountPercent: 5, metric: 'boxes' })).toContain('коробок');
    expect(buildHelpMessage('uz')).toContain('/stop');
  });

  it('never exceeds the Bot API text limit', () => {
    expect(TELEGRAM_MAX_TEXT_LENGTH).toBe(4096);
    const truncated = truncateTelegramText('x'.repeat(5000));
    expect(truncated.length).toBeLessThanOrEqual(4096);
    expect(truncated.endsWith('…')).toBe(true);
  });
});

describe('telegram bot api client retries and error mapping', () => {
  function mockFetchSequence(steps: Array<{ status: number; body: unknown } | { networkError: string }>) {
    const calls: Array<{ url: string; payload: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init: { body?: string }) => {
      calls.push({ url, payload: init.body ? JSON.parse(init.body) : null });
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      if ('networkError' in step) throw new Error(step.networkError);
      return new Response(JSON.stringify(step.body), { status: step.status, headers: { 'content-type': 'application/json' } });
    });
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
  }

  function captureLogger() {
    const lines: string[] = [];
    return { lines, logger: { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) } };
  }

  it('sends via the official Bot API endpoint shape', async () => {
    const { calls, fetchImpl } = mockFetchSequence([{ status: 200, body: { ok: true, result: { message_id: 42 } } }]);
    const client = new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl });
    const result = await client.sendMessage(111, 'hello');
    expect(result.messageId).toBe(42);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://api.telegram.org/bot${TEST_SECRETS.botToken}/sendMessage`);
    expect(calls[0].payload).toMatchObject({ chat_id: 111, text: 'hello' });
  });

  it('honors 429 retry_after exactly before retrying', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 429, body: { ok: false, error_code: 429, description: 'Too Many Requests: retry after 2', parameters: { retry_after: 2 } } },
      { status: 200, body: { ok: true, result: { message_id: 1 } } },
    ]);
    const sleeps: number[] = [];
    const { lines, logger } = captureLogger();
    const client = new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl, logger, sleep: async (ms) => { sleeps.push(ms); } });
    await client.sendMessage(111, 'hello');
    expect(sleeps).toEqual([2000]);
    expect(lines.join('\n')).not.toContain(TEST_SECRETS.botToken);
  });

  it('retries 5xx and network failures with bounded backoff', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 502, body: { ok: false, error_code: 502, description: 'Bad Gateway' } },
      { networkError: 'socket hang up' },
      { status: 200, body: { ok: true, result: { message_id: 3 } } },
    ]);
    const sleeps: number[] = [];
    const client = new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl, baseDelayMs: 10, maxDelayMs: 20, sleep: async (ms) => { sleeps.push(ms); } });
    const result = await client.sendMessage(111, 'hello');
    expect(result.messageId).toBe(3);
    expect(sleeps).toHaveLength(2);
    expect(sleeps.every((ms) => ms <= 20)).toBe(true);
  });

  it('gives up after max attempts without leaking secrets to logs', async () => {
    const { fetchImpl } = mockFetchSequence([{ status: 500, body: { ok: false, error_code: 500, description: 'boom' } }]);
    const { lines, logger } = captureLogger();
    const client = new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl, logger, maxAttempts: 3, sleep: async () => {} });
    await expect(client.sendMessage(111, 'hello')).rejects.toThrow(TelegramApiError);
    const joined = lines.join('\n');
    expect(joined).not.toContain(TEST_SECRETS.botToken);
    expect(joined).not.toContain('api.telegram.org/bot');
  });

  it('maps auth/blocked/missing-chat errors to non-retryable reasons', async () => {
    const blocked = mockFetchSequence([{ status: 403, body: { ok: false, error_code: 403, description: 'Forbidden: bot was blocked by the user' } }]);
    await expect(new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl: blocked.fetchImpl }).sendMessage(111, 'hi')).rejects.toMatchObject({
      options: { reason: 'blocked', retryable: false },
    });
    expect(blocked.calls).toHaveLength(1);

    const missing = mockFetchSequence([{ status: 400, body: { ok: false, error_code: 400, description: 'Bad Request: chat not found' } }]);
    const missingError = await new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl: missing.fetchImpl }).sendMessage(111, 'hi').catch((error) => error);
    expect(isChatInactiveError(missingError)).toBe(true);

    const auth = mockFetchSequence([{ status: 401, body: { ok: false, error_code: 401, description: 'Unauthorized' } }]);
    await expect(new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl: auth.fetchImpl }).sendMessage(111, 'hi')).rejects.toMatchObject({
      options: { reason: 'auth' },
    });
    expect(auth.calls).toHaveLength(1);
  });

  it('refuses empty or overlong texts before any network call', async () => {
    const { calls, fetchImpl } = mockFetchSequence([{ status: 200, body: { ok: true, result: {} } }]);
    const client = new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl });
    await expect(client.sendMessage(111, '   ')).rejects.toThrow(TelegramApiError);
    await expect(client.sendMessage(111, 'x'.repeat(4097))).rejects.toThrow(TelegramApiError);
    expect(calls).toHaveLength(0);
  });

  it('registers webhooks with the secret token and message-only updates', async () => {
    const { calls, fetchImpl } = mockFetchSequence([{ status: 200, body: { ok: true, result: true } }]);
    const client = new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl });
    await client.setWebhook('https://portal.example.uz/api/telegram/webhook', { secretToken: TEST_SECRETS.webhookSecret });
    expect(calls[0].url.endsWith('/setWebhook')).toBe(true);
    expect(calls[0].payload).toMatchObject({ secret_token: TEST_SECRETS.webhookSecret, allowed_updates: ['message'] });
  });
});
