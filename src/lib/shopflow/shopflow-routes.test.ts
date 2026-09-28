import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { GET as categoriesGET } from '@/app/api/shopflow/categories/route';
import { GET as healthGET } from '@/app/api/shopflow/health/route';
import { POST as ordersPOST } from '@/app/api/shopflow/orders/route';
import { GET as productsGET } from '@/app/api/shopflow/products/route';
import { GET as productGET } from '@/app/api/shopflow/products/[slug]/route';
import { POST as shopflowWebhookPOST } from '@/app/api/shopflow/webhook/route';

const TEST_KEY = 'sf_ROUTEKEY_do-not-use-in-production-abcdef0123456789';
const TEST_BASE = 'https://shopflow.test/api/v1';
const TEST_WEBHOOK_SECRET = 'webhook-secret-0123456789abcdef';

function stubShopFlowEnv() {
  vi.stubEnv('SHOPFLOW_API_URL', TEST_BASE);
  vi.stubEnv('SHOPFLOW_API_KEY', TEST_KEY);
  vi.stubEnv('SHOPFLOW_WEBHOOK_SECRET', TEST_WEBHOOK_SECRET);
}

function stubUpstream(body: unknown, status = 200) {
  const fetchSpy = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', fetchSpy);
  return fetchSpy;
}

function validOrderBody() {
  return {
    customer: { name: 'Ali', phone: '+998901234567' },
    delivery: { method: 'courier', region: 'Toshkent' },
    items: [{ productId: 'prod-1', quantity: 2 }],
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('shopflow bff proxy routes', () => {
  it('fail closed without server configuration and never call upstream', async () => {
    const fetchSpy = stubUpstream({});
    for (const response of [
      await healthGET(),
      await categoriesGET(new Request('https://portal.test/api/shopflow/categories')),
      await productsGET(new Request('https://portal.test/api/shopflow/products')),
      await productGET(new Request('https://portal.test/api/shopflow/products/x'), { params: Promise.resolve({ slug: 'x' }) }),
      await ordersPOST(new Request('https://portal.test/api/shopflow/orders', { method: 'POST', body: '{}' })),
    ]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ ok: false, error: 'shopflow-unconfigured' });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('proxies catalog reads without exposing the api key', async () => {
    stubShopFlowEnv();
    stubUpstream({ items: [], total: 0, page: 1, pageSize: 20 });
    const response = await productsGET(new Request('https://portal.test/api/shopflow/products?locale=ru&pageSize=5'));
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain(TEST_BASE);
  });

  it('rejects invalid proxy input before any upstream call', async () => {
    stubShopFlowEnv();
    const fetchSpy = stubUpstream({});
    const badQuery = await productsGET(new Request('https://portal.test/api/shopflow/products?pageSize=500'));
    expect(badQuery.status).toBe(400);
    const badOrder = await ordersPOST(
      new Request('https://portal.test/api/shopflow/orders', { method: 'POST', body: JSON.stringify({ customer: {}, delivery: {}, items: [] }) }),
    );
    expect(badOrder.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('forwards order creation and relays stock conflicts safely', async () => {
    stubShopFlowEnv();
    stubUpstream({ ok: true, orderId: 'ck-1', message: 'Buyurtma #ORD-1 qabul qilindi' }, 201);
    const created = await ordersPOST(
      new Request('https://portal.test/api/shopflow/orders', { method: 'POST', body: JSON.stringify(validOrderBody()) }),
    );
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ ok: true, orderId: 'ck-1' });

    stubUpstream({ ok: false, message: 'Stock yetarli emas (mavjud: 2)' }, 409);
    const conflicted = await ordersPOST(
      new Request('https://portal.test/api/shopflow/orders', { method: 'POST', body: JSON.stringify(validOrderBody()) }),
    );
    expect(conflicted.status).toBe(409);
    const conflictBody = await conflicted.json();
    expect(conflictBody).toMatchObject({ ok: false, error: 'conflict' });
    expect(JSON.stringify(conflictBody)).not.toContain(TEST_KEY);
  });

  it('maps upstream 404 and 401 to safe responses without secrets', async () => {
    stubShopFlowEnv();
    stubUpstream({ error: 'Topilmadi' }, 404);
    const missing = await productGET(new Request('https://portal.test/api/shopflow/products/nope'), { params: Promise.resolve({ slug: 'nope' }) });
    expect(missing.status).toBe(404);

    stubUpstream({ error: 'Yaroqsiz API kalit' }, 401);
    const badKey = await healthGET();
    expect(badKey.status).toBe(503);
    const serialized = JSON.stringify(await badKey.json());
    expect(serialized).not.toContain(TEST_KEY);
    expect(serialized).not.toContain('Yaroqsiz');
  });
});

describe('shopflow outbound webhook route', () => {
  const sign = (raw: string) => `sha256=${createHmac('sha256', TEST_WEBHOOK_SECRET).update(raw, 'utf8').digest('hex')}`;
  const postEvent = (raw: string, signature: string | null) =>
    shopflowWebhookPOST(
      new Request('https://portal.test/api/shopflow/webhook', {
        method: 'POST',
        headers: signature ? { 'x-shopflow-signature': signature } : {},
        body: raw,
      }),
    );

  it('requires webhook secret configuration', async () => {
    const response = await postEvent('{}', 'sha256=abc');
    expect(response.status).toBe(503);
  });

  it('rejects missing or invalid signatures', async () => {
    stubShopFlowEnv();
    const raw = JSON.stringify({ event: 'order.created', tenantId: 't', timestamp: 'x', data: {} });
    expect((await postEvent(raw, null)).status).toBe(401);
    expect((await postEvent(raw, 'sha256=deadbeef')).status).toBe(401);
    expect((await postEvent(`${raw} `, sign(raw))).status).toBe(401);
  });

  it('accepts signed order events and ignores unknown ones', async () => {
    stubShopFlowEnv();
    const raw = JSON.stringify({
      event: 'order.status_changed',
      tenantId: 'tenant-1',
      timestamp: '2026-09-28T00:00:00.000Z',
      data: { order: { id: 'ord-1', code: 'ORD-1', status: 'PROCESSING' } },
    });
    const accepted = await postEvent(raw, sign(raw));
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ ok: true, event: 'order.status_changed', order: { id: 'ord-1', status: 'PROCESSING' } });

    const unknown = JSON.stringify({ event: 'order.deleted', tenantId: 't', timestamp: 'x', data: {} });
    const ignored = await postEvent(unknown, sign(unknown));
    expect(ignored.status).toBe(200);
    expect(await ignored.json()).toMatchObject({ ok: true, ignored: true });
  });
});
