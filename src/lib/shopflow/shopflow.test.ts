import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { IntegrationError } from '@/lib/providers/errors';
import { ShopFlowApiError, ShopFlowClient } from './client';
import { isShopFlowConfigured, requireShopFlowConfig, requireShopFlowWebhookSecret } from './config';
import {
  ShopFlowValidationError,
  assertProduct,
  assertProductList,
  validateLocaleParam,
  validateOrderRequest,
  validateProductQuery,
} from './validation';
import { isKnownShopFlowEvent, parseShopFlowOrderData, parseShopFlowWebhook, verifyShopFlowSignature } from './webhooks';

const TEST_KEY = 'sf_TESTKEY_do-not-use-in-production-0123456789abcdef';
const TEST_BASE = 'https://shopflow.test/api/v1';

afterEach(() => {
  vi.unstubAllEnvs();
});

function minimalProduct(overrides: Record<string, unknown> = {}) {
  return {
    id: 'prod-1',
    slug: 'sut-3-2',
    name: 'Sut 3.2%',
    tagline: '',
    description: '',
    categoryId: null,
    categorySlug: 'sut',
    price: 128000,
    currency: 'UZS',
    rating: 4.5,
    reviewCount: 10,
    inStock: true,
    images: [],
    highlights: [],
    benefits: [],
    ingredients: [],
    howToUse: '',
    faq: [],
    reviews: [],
    badges: [],
    bespoke: false,
    options: [],
    variants: [],
    priceTiers: [{ minQty: 10, price: 120000 }],
    moq: null,
    unit: 'dona',
    ...overrides,
  };
}

function mockFetchSequence(steps: Array<{ status: number; body: unknown } | { networkError: string }>) {
  const calls: Array<{ url: string; method: string; headers: Record<string, string>; payload: unknown }> = [];
  const fetchImpl = vi.fn(async (url: string, init: { method?: string; headers?: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, payload: init.body ? JSON.parse(init.body) : undefined });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if ('networkError' in step) throw new Error(step.networkError);
    return new Response(JSON.stringify(step.body), { status: step.status, headers: { 'content-type': 'application/json' } });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

describe('shopflow server config fails closed', () => {
  it('requires both api url and key', () => {
    expect(() => requireShopFlowConfig({})).toThrow(IntegrationError);
    expect(() => requireShopFlowConfig({ SHOPFLOW_API_URL: TEST_BASE })).toThrow(IntegrationError);
    expect(() => requireShopFlowConfig({ SHOPFLOW_API_URL: 'not-a-url', SHOPFLOW_API_KEY: TEST_KEY })).toThrow(IntegrationError);
    expect(requireShopFlowConfig({ SHOPFLOW_API_URL: `${TEST_BASE}/`, SHOPFLOW_API_KEY: TEST_KEY })).toEqual({ baseUrl: TEST_BASE, apiKey: TEST_KEY });
    expect(isShopFlowConfigured({})).toBe(false);
    expect(isShopFlowConfigured({ SHOPFLOW_API_URL: TEST_BASE, SHOPFLOW_API_KEY: TEST_KEY })).toBe(true);
  });

  it('requires a webhook secret for the receiver', () => {
    expect(() => requireShopFlowWebhookSecret({})).toThrow(IntegrationError);
    expect(() => requireShopFlowWebhookSecret({ SHOPFLOW_WEBHOOK_SECRET: 'short' })).toThrow(IntegrationError);
    expect(requireShopFlowWebhookSecret({ SHOPFLOW_WEBHOOK_SECRET: '0123456789abcdef' })).toBe('0123456789abcdef');
  });
});

describe('shopflow request validation', () => {
  it('validates product query params per the v1 contract', () => {
    expect(validateProductQuery({ locale: 'ru', sort: 'price_asc', page: '2', pageSize: '50', search: 'sut' })).toEqual({
      locale: 'ru',
      sort: 'price_asc',
      page: 2,
      pageSize: 50,
      search: 'sut',
    });
    expect(validateProductQuery({})).toEqual({});
    expect(() => validateProductQuery({ locale: 'de' })).toThrow(ShopFlowValidationError);
    expect(() => validateProductQuery({ sort: 'nope' })).toThrow(ShopFlowValidationError);
    expect(() => validateProductQuery({ pageSize: '101' })).toThrow(ShopFlowValidationError);
    expect(() => validateProductQuery({ search: 'x'.repeat(101) })).toThrow(ShopFlowValidationError);
    expect(() => validateProductQuery({ origin: 'x'.repeat(61) })).toThrow(ShopFlowValidationError);
    expect(() => validateProductQuery({ minPrice: '-5' })).toThrow(ShopFlowValidationError);
    expect(validateLocaleParam('ru')).toBe('ru');
    expect(validateLocaleParam(undefined)).toBeUndefined();
    expect(() => validateLocaleParam('de')).toThrow(ShopFlowValidationError);
  });

  it('validates order bodies fail-fast before any network call', () => {
    const valid = {
      customer: { name: 'Ali', phone: '+998901234567' },
      delivery: { method: 'courier', region: 'Toshkent' },
      items: [{ productId: 'prod-1', quantity: 2 }],
    };
    expect(validateOrderRequest(valid).items).toHaveLength(1);
    expect(() => validateOrderRequest(null)).toThrow(ShopFlowValidationError);
    expect(() => validateOrderRequest({ ...valid, customer: { name: '', phone: '' } })).toThrow(ShopFlowValidationError);
    expect(() => validateOrderRequest({ ...valid, delivery: { method: 'drone' } })).toThrow(ShopFlowValidationError);
    expect(() => validateOrderRequest({ ...valid, items: [] })).toThrow(ShopFlowValidationError);
    expect(() => validateOrderRequest({ ...valid, items: [{ quantity: 1 }] })).toThrow(ShopFlowValidationError);
    expect(() => validateOrderRequest({ ...valid, items: [{ productId: 'p', quantity: 0 }] })).toThrow(ShopFlowValidationError);
    expect(() => validateOrderRequest({ ...valid, items: [{ productId: 'p', quantity: 1.5 }] })).toThrow(ShopFlowValidationError);
  });

  it('rejects unexpected response shapes defensively', () => {
    expect(() => assertProduct({ id: 'x' })).toThrow(ShopFlowValidationError);
    expect(() => assertProduct(minimalProduct({ priceTiers: [{ minQty: 'lots' }] }))).toThrow(ShopFlowValidationError);
    expect(() => assertProductList({ items: [] })).toThrow(ShopFlowValidationError);
    expect(assertProduct(minimalProduct()).slug).toBe('sut-3-2');
  });
});

describe('shopflow v1 client', () => {
  it('sends bearer auth with locale and maps list responses', async () => {
    const { calls, fetchImpl } = mockFetchSequence([
      { status: 200, body: { items: [minimalProduct()], total: 1, page: 1, pageSize: 20 } },
    ]);
    const client = new ShopFlowClient(TEST_BASE, TEST_KEY, { fetchImpl });
    const list = await client.products({ locale: 'ru', pageSize: 20 });
    expect(list.total).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${TEST_BASE}/products?locale=ru&pageSize=20`);
    expect(calls[0].headers.authorization).toBe(`Bearer ${TEST_KEY}`);
    expect(calls[0].url).not.toContain(TEST_KEY);
  });

  it('checks health outside /v1 and creates orders', async () => {
    const { calls, fetchImpl } = mockFetchSequence([
      { status: 200, body: { status: 'ok', db: 'ok', ts: '2026-09-28T00:00:00Z' } },
      { status: 201, body: { ok: true, orderId: 'ck-order-1', message: 'Buyurtma #ORD-1 qabul qilindi' } },
    ]);
    const client = new ShopFlowClient(TEST_BASE, TEST_KEY, { fetchImpl });
    expect((await client.health()).status).toBe('ok');
    expect(calls[0].url).toBe('https://shopflow.test/api/health');
    const created = await client.createOrder({
      customer: { name: 'Ali', phone: '+998901234567' },
      delivery: { method: 'pickup' },
      items: [{ productId: 'prod-1', quantity: 2 }],
    });
    expect(created.orderId).toBe('ck-order-1');
    expect(calls[1].method).toBe('POST');
  });

  it('retries 429 with a delay and maps 401/404/400/409 without retrying', async () => {
    const sleeps: number[] = [];
    const lines: string[] = [];
    const logger = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m), error: (m: string) => lines.push(m) };
    const limited = mockFetchSequence([
      { status: 429, body: { error: "Juda ko'p so'rov. Biroz kutib turing." } },
      { status: 200, body: [] },
    ]);
    const promotions = await new ShopFlowClient(TEST_BASE, TEST_KEY, {
      fetchImpl: limited.fetchImpl,
      logger,
      rateLimitDelayMs: 5,
      sleep: async (ms) => { sleeps.push(ms); },
    }).promotions();
    expect(promotions).toEqual([]);
    expect(sleeps).toEqual([5]);
    expect(lines.join('\n')).not.toContain(TEST_KEY);

    const auth = mockFetchSequence([{ status: 401, body: { error: 'Yaroqsiz API kalit' } }]);
    await expect(new ShopFlowClient(TEST_BASE, TEST_KEY, { fetchImpl: auth.fetchImpl }).categories()).rejects.toMatchObject({
      options: { failure: 'unauthorized', retryable: false },
    });
    expect(auth.calls).toHaveLength(1);

    const missing = mockFetchSequence([{ status: 404, body: { error: 'Topilmadi' } }]);
    await expect(new ShopFlowClient(TEST_BASE, TEST_KEY, { fetchImpl: missing.fetchImpl }).product('nope')).rejects.toMatchObject({
      options: { failure: 'not-found' },
    });

    const invalid = mockFetchSequence([
      { status: 400, body: { error: 'Validation error', details: [{ path: 'items.0.quantity', message: 'majburiy' }] } },
    ]);
    const validationError = await new ShopFlowClient(TEST_BASE, TEST_KEY, { fetchImpl: invalid.fetchImpl }).categories().catch((error) => error);
    expect(validationError).toBeInstanceOf(ShopFlowApiError);
    expect(validationError.options).toMatchObject({ failure: 'validation', retryable: false });
    expect(validationError.options.details).toEqual([{ path: 'items.0.quantity', message: 'majburiy' }]);

    const conflict = mockFetchSequence([{ status: 409, body: { ok: false, message: 'Stock yetarli emas (mavjud: 2)' } }]);
    await expect(
      new ShopFlowClient(TEST_BASE, TEST_KEY, { fetchImpl: conflict.fetchImpl }).createOrder({
        customer: { name: 'A', phone: '1' },
        delivery: { method: 'courier' },
        items: [{ productId: 'p', quantity: 9 }],
      }),
    ).rejects.toMatchObject({ options: { failure: 'conflict' } });
  });

  it('relays variant choices on the documented variant-required 400', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 400, body: { ok: false, message: 'variantId kerak', variants: [{ id: 'v1', name: '1kg' }] } },
    ]);
    const error = await new ShopFlowClient(TEST_BASE, TEST_KEY, { fetchImpl })
      .createOrder({ customer: { name: 'A', phone: '1' }, delivery: { method: 'courier' }, items: [{ productId: 'p', quantity: 1 }] })
      .catch((e) => e);
    expect(error.options.variants).toEqual([{ id: 'v1', name: '1kg' }]);
  });

  it('retries transient failures with bounded backoff, then gives up', async () => {
    const { fetchImpl } = mockFetchSequence([
      { status: 502, body: { error: 'Bad Gateway' } },
      { networkError: 'socket hang up' },
      { status: 200, body: [] },
    ]);
    const sleeps: number[] = [];
    const result = await new ShopFlowClient(TEST_BASE, TEST_KEY, {
      fetchImpl,
      baseDelayMs: 5,
      maxDelayMs: 10,
      sleep: async (ms) => { sleeps.push(ms); },
    }).promotions();
    expect(result).toEqual([]);
    expect(sleeps).toHaveLength(2);

    const failing = mockFetchSequence([{ status: 500, body: { error: 'boom' } }]);
    await expect(
      new ShopFlowClient(TEST_BASE, TEST_KEY, { fetchImpl: failing.fetchImpl, maxAttempts: 2, sleep: async () => {} }).promotions(),
    ).rejects.toMatchObject({ options: { failure: 'transient' } });
    expect(failing.calls).toHaveLength(2);
  });
});

describe('shopflow outbound webhook verification', () => {
  const secret = '0123456789abcdef0123456789abcdef';
  const sign = (raw: string) => `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;

  it('accepts a valid hmac signature and rejects anything else', () => {
    const raw = '{"event":"order.created"}';
    expect(verifyShopFlowSignature(raw, sign(raw), secret)).toBe(true);
    expect(verifyShopFlowSignature(raw, sign(`${raw} `), secret)).toBe(false);
    expect(verifyShopFlowSignature(raw, 'sha256=deadbeef', secret)).toBe(false);
    expect(verifyShopFlowSignature(raw, 'not-a-signature', secret)).toBe(false);
    expect(verifyShopFlowSignature(raw, sign(raw), 'wrong-secret-00000000000000000000')).toBe(false);
    expect(verifyShopFlowSignature('', sign(''), secret)).toBe(false);
    expect(verifyShopFlowSignature(raw, null, secret)).toBe(false);
  });

  it('parses known envelopes and order payloads, rejecting malformed ones', () => {
    expect(isKnownShopFlowEvent('order.status_changed')).toBe(true);
    expect(isKnownShopFlowEvent('order.deleted')).toBe(false);
    const envelope = parseShopFlowWebhook({
      event: 'order.status_changed',
      tenantId: 'tenant-1',
      timestamp: '2026-09-28T00:00:00.000Z',
      data: { order: { id: 'ord-1', code: 'ORD-1', total: 500000, currency: 'UZS', status: 'PROCESSING', source: 'WEBSITE' } },
    });
    expect(envelope?.event).toBe('order.status_changed');
    expect(parseShopFlowOrderData(envelope!.data)).toMatchObject({ id: 'ord-1', code: 'ORD-1', status: 'PROCESSING' });
    expect(parseShopFlowWebhook({ event: 'order.deleted', tenantId: 't', timestamp: 'x', data: {} })).toBeNull();
    expect(parseShopFlowWebhook(null)).toBeNull();
    expect(parseShopFlowOrderData({})).toBeNull();
    expect(parseShopFlowOrderData({ order: { id: '' } })).toBeNull();
  });
});
