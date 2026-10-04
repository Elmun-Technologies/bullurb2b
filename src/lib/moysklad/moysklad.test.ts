import { afterEach, describe, expect, it, vi } from 'vitest';

import { IntegrationError } from '@/lib/providers/errors';
import { normalizeUzPhone, sameUzPhone } from './phone';
import { isMoySkladConfigured, MOYSKLAD_DEFAULT_BASE_URL, requireMoySkladConfig } from './config';
import { MoySkladApiError, MoySkladClient, type MoySkladClientLogger } from './client';
import { assertCounterparty, assertCounterpartyList, errorEnvelopeMessage, MoySkladValidationError } from './validation';

const TOKEN = 'moysklad-test-token-abcdef123456';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('moysklad config fails closed', () => {
  it('requires a pre-minted token and defaults to the official host', () => {
    expect(requireMoySkladConfig({ MOYSKLAD_API_TOKEN: TOKEN })).toMatchObject({ baseUrl: MOYSKLAD_DEFAULT_BASE_URL, token: TOKEN });
    expect(() => requireMoySkladConfig({})).toThrow(IntegrationError);
    expect(() => requireMoySkladConfig({ MOYSKLAD_API_TOKEN: '  ' })).toThrow(IntegrationError);
    expect(() => requireMoySkladConfig({ MOYSKLAD_API_TOKEN: TOKEN, MOYSKLAD_API_URL: 'notaurl' })).toThrow(IntegrationError);
    expect(isMoySkladConfigured({})).toBe(false);
    expect(isMoySkladConfigured({ MOYSKLAD_API_TOKEN: TOKEN })).toBe(true);
  });
});

describe('uzbek phone normalization', () => {
  it('normalizes common MoySklad/Telegram formats to E.164', () => {
    expect(normalizeUzPhone('+998 90 123 45 67')).toBe('+998901234567');
    expect(normalizeUzPhone('998901234567')).toBe('+998901234567');
    expect(normalizeUzPhone('901234567')).toBe('+998901234567');
    expect(normalizeUzPhone('+7 555 123 4568')).toBeNull();
    expect(normalizeUzPhone('12345')).toBeNull();
    expect(normalizeUzPhone('')).toBeNull();
  });

  it('matches the same subscriber across formats', () => {
    expect(sameUzPhone('+998 90 123 45 67', '+998901234567')).toBe(true);
    expect(sameUzPhone('901234567', '+998901234567')).toBe(true);
    expect(sameUzPhone('+998901234567', '+998901234568')).toBe(false);
  });
});

describe('moysklad response guards', () => {
  it('accepts documented counterparty and list shapes', () => {
    expect(assertCounterparty({ id: 'a', name: 'Shop', phone: '+998901234567', code: 'C-1' })).toMatchObject({ id: 'a', name: 'Shop' });
    const list = assertCounterpartyList({ meta: { size: 1, limit: 10, offset: 0 }, rows: [{ id: 'a', name: 'Shop' }] });
    expect(list.rows).toHaveLength(1);
    expect(list.meta.size).toBe(1);
  });

  it('rejects malformed payloads loudly', () => {
    expect(() => assertCounterparty(null)).toThrow(MoySkladValidationError);
    expect(() => assertCounterparty({ id: 'a' })).toThrow(MoySkladValidationError);
    expect(() => assertCounterpartyList({ rows: [] })).toThrow(MoySkladValidationError);
    expect(() => assertCounterpartyList({ meta: { size: 0, limit: 10, offset: 0 }, rows: [{ id: 'a' }] })).toThrow(MoySkladValidationError);
  });

  it('reads the documented errors envelope without leaking raw payloads', () => {
    expect(errorEnvelopeMessage({ errors: [{ error: 'Auth error', error_message: 'bad token' }] }, 'fallback')).toBe('Auth error: bad token');
    expect(errorEnvelopeMessage({ ok: true }, 'fallback')).toBe('fallback');
  });
});

describe('moysklad client request contract', () => {
  function mockFetchSequence(steps: Array<{ status: number; body: unknown; headers?: Record<string, string> } | { networkError: string }>) {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; payload: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
      const headers = Object.fromEntries(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
      calls.push({ url, method: init.method ?? 'GET', headers, payload: init.body ? JSON.parse(init.body) : null });
      const step = steps[Math.min(calls.length - 1, steps.length - 1)];
      if ('networkError' in step) throw new Error(step.networkError);
      return new Response(JSON.stringify(step.body), { status: step.status, headers: { 'content-type': 'application/json', ...(step.headers ?? {}) } });
    });
    return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
  }

  function captureLogger(): { lines: string[]; logger: MoySkladClientLogger } {
    const lines: string[] = [];
    return { lines, logger: { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) } };
  }

  const listBody = (rows: unknown[]) => ({ meta: { href: 'x', type: 'counterparty', mediaType: 'json', size: rows.length, limit: 10, offset: 0 }, rows });

  it('sends Bearer auth with the mandatory gzip header', async () => {
    const { calls, fetchImpl } = mockFetchSequence([{ status: 200, body: listBody([]) }]);
    const client = new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl });
    await client.searchCounterparties('998901234567');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${MOYSKLAD_DEFAULT_BASE_URL}/entity/counterparty?search=998901234567&limit=10&offset=0`);
    expect(calls[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(calls[0].headers['accept-encoding']).toBe('gzip');
  });

  it('finds exactly one counterparty by phone across format variants', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 200, body: listBody([{ id: 'cp-1', name: 'Shop One', phone: '+998 90 123 45 67' }, { id: 'cp-2', name: 'Other', phone: '+998901234500' }]) },
    ]);
    const client = new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl });
    const found = await client.findByPhone('+998901234567');
    expect(found).toMatchObject({ status: 'found', counterparty: { id: 'cp-1' } });
  });

  it('distinguishes not-found from ambiguous matches', async () => {
    const empty = mockFetchSequence([{ status: 200, body: listBody([]) }]);
    const { lines, logger } = captureLogger();
    expect(await new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl: empty.fetchImpl, logger }).findByPhone('+998901234567')).toEqual({ status: 'not-found' });

    const dupe = mockFetchSequence([
      { status: 200, body: listBody([{ id: 'a', name: 'A', phone: '901234567' }, { id: 'b', name: 'B', phone: '+998901234567' }]) },
    ]);
    const ambiguous = await new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl: dupe.fetchImpl, logger }).findByPhone('+998901234567');
    expect(ambiguous.status).toBe('ambiguous');
    expect(lines.join('\n')).not.toContain(TOKEN);
  });

  it('creates counterparties with name, phone and description only', async () => {
    const { calls, fetchImpl } = mockFetchSequence([{ status: 200, body: { id: 'cp-9', name: 'New Shop', phone: '+998901234567' } }]);
    const client = new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl });
    const created = await client.createCounterparty({ name: 'New Shop', phone: '+998901234567', description: 'Telegram bot' });
    expect(created).toMatchObject({ id: 'cp-9', name: 'New Shop' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe(`${MOYSKLAD_DEFAULT_BASE_URL}/entity/counterparty`);
    expect(calls[0].payload).toEqual({ name: 'New Shop', phone: '+998901234567', description: 'Telegram bot' });
    await expect(client.createCounterparty({ name: '  ', phone: '+998901234567' })).rejects.toThrow(MoySkladApiError);
  });

  it('maps 401 to unauthorized without retrying', async () => {
    const { calls, fetchImpl } = mockFetchSequence([{ status: 401, body: { errors: [{ error: 'Auth error' }] } }]);
    const client = new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl, sleep: async () => {} });
    const failure: unknown = await client.findByPhone('+998901234567').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MoySkladApiError);
    expect((failure as MoySkladApiError).options).toMatchObject({ status: 401, failure: 'unauthorized', retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('honors Retry-After on 429 and surfaces envelope messages on validation failures', async () => {
    const sleeps: number[] = [];
    const { fetchImpl } = mockFetchSequence([
      { status: 429, body: { errors: [] }, headers: { 'retry-after': '2' } },
      { status: 200, body: listBody([]) },
    ]);
    const client = new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl, sleep: async (ms) => { sleeps.push(ms); } });
    await client.findByPhone('+998901234567');
    expect(sleeps).toEqual([2000]);

    const invalid = mockFetchSequence([{ status: 400, body: { errors: [{ error: 'Validation', error_message: 'name required', parameter: 'name' }] } }]);
    const bad = new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl: invalid.fetchImpl, sleep: async () => {} });
    await expect(bad.createCounterparty({ name: 'x', phone: '+998901234567' })).rejects.toThrow(/name required/);
    expect(invalid.calls).toHaveLength(1);
  });

  it('retries 5xx and network failures with bounded backoff, then fails transient', async () => {
    const sleeps: number[] = [];
    const { lines, logger } = captureLogger();
    const { fetchImpl } = mockFetchSequence([
      { status: 502, body: { errors: [] } },
      { networkError: 'socket hang up' },
      { status: 200, body: listBody([]) },
    ]);
    const client = new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl, logger, baseDelayMs: 10, maxDelayMs: 20, sleep: async (ms) => { sleeps.push(ms); } });
    await client.searchCounterparties('shop');
    expect(sleeps).toHaveLength(2);
    expect(lines.join('\n')).not.toContain(TOKEN);

    const down = mockFetchSequence([{ status: 500, body: { errors: [] } }]);
    const failing = new MoySkladClient(MOYSKLAD_DEFAULT_BASE_URL, TOKEN, { fetchImpl: down.fetchImpl, maxAttempts: 2, sleep: async () => {} });
    const failure: unknown = await failing.getCounterparty('x').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MoySkladApiError);
    expect((failure as MoySkladApiError).options).toMatchObject({ failure: 'transient', retryable: true });
    expect(down.calls).toHaveLength(2);
  });
});
