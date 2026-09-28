import { describe, expect, it, vi, afterEach } from 'vitest';

import { DEFAULT_LOYALTY_CONFIG, getLoyaltySummaryForCustomer } from '@/lib/domain/loyalty';
import type { Customer, SalesOrder } from '@/lib/domain/types';
import { IntegrationError } from '@/lib/providers/errors';
import type { MoySkladProvider } from '@/lib/providers/contracts';
import { POST as cronPOST, GET as cronGET } from '@/app/api/cron/telegram-reminders/route';
import { POST as linkCodePOST } from '@/app/api/telegram/link-code/route';
import { GET as statusGET } from '@/app/api/telegram/status/route';
import { POST as webhookPOST } from '@/app/api/telegram/webhook/route';
import { TelegramApiError } from './client';
import { dedupeKeyFor, dispatchTelegramReminders, type TelegramSender } from './dispatcher';
import { issueLinkCode } from './linking';
import { createMemoryTelegramStores, type TelegramStores } from './stores';
import { TEST_SECRETS, stubFullTelegramEnv as stubFullEnv } from './test-helpers';
import { handleTelegramUpdate } from './webhook-handler';

const FRIDAY = new Date('2026-09-25T05:00:00.000Z'); // Friday 10:00 in Asia/Tashkent
const MONDAY_NEXT_WEEK = new Date('2026-09-28T05:00:00.000Z');

function makeCustomer(overrides: Partial<Customer> & { id: string; name: string }): Customer {
  return {
    region: 'Toshkent shahri',
    contactName: 'Test Contact',
    email: `${overrides.id}@example.uz`,
    phone: '+998901234567',
    currentBoxes: 0,
    currentTurnover: 0,
    previousBoxes: 0,
    lastPurchase: '2026-09-20',
    manager: 'Test Manager',
    active: true,
    ...overrides,
  } as Customer;
}

const customerA = makeCustomer({ id: 'company-a', name: 'ALFA MARKET', currentBoxes: 82, currentTurnover: 18_600_000, previousBoxes: 80 });
const customerB = makeCustomer({ id: 'company-b', name: 'BETA SAVDO', currentBoxes: 10, currentTurnover: 2_000_000, previousBoxes: 40 });
const customerC = makeCustomer({ id: 'company-c', name: 'GAMMA TRADE', currentBoxes: 95, currentTurnover: 22_000_000, previousBoxes: 90 });
const customerD = makeCustomer({ id: 'company-d', name: 'DELTA FOOD', currentBoxes: 79, currentTurnover: 17_000_000, previousBoxes: 80 });

function makeOrder(overrides: Partial<SalesOrder> & { id: string; customerId: string }): SalesOrder {
  return {
    date: '2026-09-24',
    status: 'Yangi',
    items: 1,
    boxes: 2,
    total: 200_000,
    lines: [{ productId: 'p1', quantity: 2, unitPrice: 100_000 }],
    ...overrides,
  } as SalesOrder;
}

function createTestProvider(orders: SalesOrder[], customers: Customer[] = [customerA, customerB, customerC, customerD]): MoySkladProvider {
  return {
    mode: 'mock',
    async getProducts() { return []; },
    async getProduct() { return null; },
    async getCustomers() { return customers; },
    async getCustomer(id) { return customers.find((customer) => customer.id === id) ?? null; },
    async getOrders(customerId) { return customerId ? orders.filter((order) => order.customerId === customerId) : orders; },
    async getOrder(id) { return orders.find((order) => order.id === id) ?? null; },
    async getCustomerPurchaseHistory(customerId) { return orders.filter((order) => order.customerId === customerId); },
  };
}

function createFakeSender(options: { failWith?: (chatId: number) => Error | null } = {}) {
  const sent: Array<{ chatId: number; text: string }> = [];
  let nextId = 1;
  const sender: TelegramSender = {
    async sendMessage(chatId, text) {
      const failure = options.failWith?.(chatId) ?? null;
      if (failure) throw failure;
      sent.push({ chatId, text });
      const messageId = nextId;
      nextId += 1;
      return { messageId };
    },
  };
  return { sent, sender };
}

async function subscribeClient(stores: TelegramStores, chatId: number, customerId: string, locale: 'uz' | 'ru' = 'uz') {
  await stores.subscriptions.save({
    chatId,
    subjectId: `user-${customerId}`,
    role: 'CLIENT',
    customerId,
    locale,
    active: true,
    linkedAt: FRIDAY.toISOString(),
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('client reminder dispatch and isolation', () => {
  it('sends each verified client only their own Friday, tier-gap and order reminders', async () => {
    const orders = [
      makeOrder({ id: 'ORD-A1', customerId: 'company-a', status: 'Yo‘lda', boxes: 5, total: 500_000 }),
      makeOrder({ id: 'ORD-B1', customerId: 'company-b', status: 'Yangi', boxes: 2, total: 200_000 }),
    ];
    const stores = createMemoryTelegramStores();
    await subscribeClient(stores, 111, 'company-a', 'uz');
    await subscribeClient(stores, 222, 'company-b', 'ru');
    const { sent, sender } = createFakeSender();

    const summary = await dispatchTelegramReminders({
      now: FRIDAY,
      config: DEFAULT_LOYALTY_CONFIG,
      provider: createTestProvider(orders),
      dataMode: 'mock',
      allowMockDelivery: true,
      stores,
      sender,
    });

    expect(summary.sent).toBe(5);
    const chatA = sent.filter((item) => item.chatId === 111).map((item) => item.text);
    const chatB = sent.filter((item) => item.chatId === 222).map((item) => item.text);
    expect(chatA).toHaveLength(3);
    expect(chatB).toHaveLength(2);

    // Friday greeting names only the recipient's own company.
    expect(chatA[0]).toContain('Juma muborak!');
    expect(chatA[0]).toContain('ALFA MARKET');
    expect(chatB[0]).toContain('пятницей');
    expect(chatB[0]).toContain('BETA SAVDO');

    // Tier gap matches the live loyalty calculation: 82/100, 18 boxes remain.
    const expected = getLoyaltySummaryForCustomer(customerA, DEFAULT_LOYALTY_CONFIG);
    expect(expected.progressPercent).toBe(82);
    expect(expected.remaining).toBe(18);
    expect(chatA[1]).toContain('Gold');
    expect(chatA[1]).toContain('18 quti');
    expect(chatA[1]).toContain('5%');
    expect(chatB.join('\n')).not.toContain('qoldi');

    // Orders never cross customer boundaries.
    expect(chatA[2]).toContain('ORD-A1');
    expect(chatA.join('\n')).not.toContain('ORD-B1');
    expect(chatA.join('\n')).not.toContain('BETA SAVDO');
    expect(chatB[1]).toContain('ORD-B1');
    expect(chatB.join('\n')).not.toContain('ORD-A1');
    expect(chatB.join('\n')).not.toContain('ALFA MARKET');
  });

  it('withholds the tier reminder below the 80 percent portal threshold', async () => {
    const stores = createMemoryTelegramStores();
    await subscribeClient(stores, 444, 'company-d', 'uz');
    const { sent, sender } = createFakeSender();
    expect(getLoyaltySummaryForCustomer(customerD, DEFAULT_LOYALTY_CONFIG).progressPercent).toBe(79);
    await dispatchTelegramReminders({
      now: FRIDAY,
      config: DEFAULT_LOYALTY_CONFIG,
      provider: createTestProvider([]),
      dataMode: 'mock',
      allowMockDelivery: true,
      stores,
      sender,
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Juma muborak!');
  });

  it('never delivers the same reminder twice (durable idempotency)', async () => {
    const orders = [makeOrder({ id: 'ORD-A1', customerId: 'company-a', status: 'Yo‘lda' })];
    const stores = createMemoryTelegramStores();
    await subscribeClient(stores, 111, 'company-a', 'uz');
    const { sender } = createFakeSender();
    const base = {
      now: FRIDAY,
      config: DEFAULT_LOYALTY_CONFIG,
      provider: createTestProvider(orders),
      dataMode: 'mock' as const,
      allowMockDelivery: true,
      stores,
      sender,
    };
    const first = await dispatchTelegramReminders(base);
    expect(first.sent).toBe(3);
    const second = await dispatchTelegramReminders(base);
    expect(second.sent).toBe(0);
    expect(second.attempted).toBe(0);
    expect(second.skippedAlreadySent).toBe(3);
  });

  it('repeats weekly conditions at most once per calendar week', async () => {
    const stores = createMemoryTelegramStores();
    await subscribeClient(stores, 111, 'company-a', 'uz');
    const { sent, sender } = createFakeSender();
    const base = {
      config: DEFAULT_LOYALTY_CONFIG,
      provider: createTestProvider([]),
      dataMode: 'mock' as const,
      allowMockDelivery: true,
      stores,
      sender,
    };
    await dispatchTelegramReminders({ ...base, now: FRIDAY });
    expect(sent).toHaveLength(2); // Friday greeting + tier gap.
    await dispatchTelegramReminders({ ...base, now: MONDAY_NEXT_WEEK });
    expect(sent).toHaveLength(3); // Only the tier gap repeats in the new week.
    expect(sent[2].text).toContain('18 quti');
  });

  it('keeps weekly dedupe keys stable within a week and distinct across weeks', () => {
    const notification = { id: 'tier-gap:2026-09-25:company-a:gold', kind: 'NEAR_NEXT_TIER' } as never;
    const timezone = 'Asia/Tashkent';
    expect(dedupeKeyFor(111, notification, FRIDAY, timezone)).toBe(dedupeKeyFor(111, notification, new Date('2026-09-26T05:00:00.000Z'), timezone));
    expect(dedupeKeyFor(111, notification, FRIDAY, timezone)).not.toBe(dedupeKeyFor(111, notification, MONDAY_NEXT_WEEK, timezone));
    expect(dedupeKeyFor(111, notification, FRIDAY, timezone)).not.toBe(dedupeKeyFor(222, notification, FRIDAY, timezone));
  });
});

describe('order status change delivery', () => {
  it('sends active-status transitions once and terminal transitions once', async () => {
    const orders = [makeOrder({ id: 'ORD-A1', customerId: 'company-a', status: 'Yangi' })];
    const stores = createMemoryTelegramStores();
    await subscribeClient(stores, 111, 'company-a', 'uz');
    const { sent, sender } = createFakeSender();
    const base = {
      now: new Date('2026-09-28T05:00:00.000Z'),
      config: DEFAULT_LOYALTY_CONFIG,
      provider: createTestProvider(orders),
      dataMode: 'mock' as const,
      allowMockDelivery: true,
      stores,
      sender,
    };
    await dispatchTelegramReminders(base);
    expect(sent.filter((item) => item.text.includes('ORD-A1'))).toHaveLength(1);

    orders[0] = { ...orders[0], status: 'Yo‘lda' };
    await dispatchTelegramReminders(base);
    const activeTransitions = sent.filter((item) => item.text.includes('ORD-A1'));
    expect(activeTransitions).toHaveLength(2);
    expect(activeTransitions[1].text).toContain('Yo‘lda');

    orders[0] = { ...orders[0], status: 'Yetkazildi' };
    await dispatchTelegramReminders(base);
    const terminal = sent.filter((item) => item.text.includes('ORD-A1'));
    expect(terminal).toHaveLength(3);
    expect(terminal[2].text).toContain('Yetkazildi');

    await dispatchTelegramReminders(base);
    expect(sent.filter((item) => item.text.includes('ORD-A1'))).toHaveLength(3);
  });

  it('stays silent for historical delivered orders seen on first run', async () => {
    const orders = [makeOrder({ id: 'ORD-OLD', customerId: 'company-a', status: 'Yetkazildi' })];
    const stores = createMemoryTelegramStores();
    await subscribeClient(stores, 111, 'company-a', 'uz');
    const { sent, sender } = createFakeSender();
    await dispatchTelegramReminders({
      now: new Date('2026-09-28T05:00:00.000Z'),
      config: DEFAULT_LOYALTY_CONFIG,
      provider: createTestProvider(orders),
      dataMode: 'mock' as const,
      allowMockDelivery: true,
      stores,
      sender,
    });
    expect(sent.join('\n')).not.toContain('ORD-OLD');
  });
});

describe('manager opportunity dispatch stays in scope', () => {
  it('sends high-priority opportunities only for assigned customers', async () => {
    const stores = createMemoryTelegramStores();
    await stores.subscriptions.save({
      chatId: 333, subjectId: 'manager-1', role: 'SALES_MANAGER', managerCustomerIds: ['company-c'], locale: 'uz', active: true, linkedAt: FRIDAY.toISOString(),
    });
    await stores.subscriptions.save({
      chatId: 334, subjectId: 'manager-2', role: 'SALES_MANAGER', managerCustomerIds: ['company-b'], locale: 'uz', active: true, linkedAt: FRIDAY.toISOString(),
    });
    await stores.subscriptions.save({
      chatId: 335, subjectId: 'admin-1', role: 'ADMIN', locale: 'uz', active: true, linkedAt: FRIDAY.toISOString(),
    });
    const { sent, sender } = createFakeSender();
    await dispatchTelegramReminders({
      now: FRIDAY,
      config: DEFAULT_LOYALTY_CONFIG,
      provider: createTestProvider([]),
      dataMode: 'mock' as const,
      allowMockDelivery: true,
      stores,
      sender,
    });

    const scoped = sent.filter((item) => item.chatId === 333);
    expect(scoped).toHaveLength(1);
    expect(scoped[0].text).toContain('GAMMA TRADE');
    expect(scoped[0].text).toContain('5 quti');
    expect(scoped[0].text).not.toContain('+998');
    expect(scoped[0].text).not.toContain('example.uz');

    expect(sent.filter((item) => item.chatId === 334)).toHaveLength(0);
    expect(sent.filter((item) => item.chatId === 335)).toHaveLength(1);
  });

  it('deactivates chats the bot can no longer reach', async () => {
    const stores = createMemoryTelegramStores();
    await subscribeClient(stores, 111, 'company-a', 'uz');
    const blocked = new TelegramApiError('blocked', { retryable: false, reason: 'blocked' });
    const { sender } = createFakeSender({ failWith: () => blocked });
    const summary = await dispatchTelegramReminders({
      now: FRIDAY,
      config: DEFAULT_LOYALTY_CONFIG,
      provider: createTestProvider([]),
      dataMode: 'mock' as const,
      allowMockDelivery: true,
      stores,
      sender,
    });
    expect(summary.deactivatedInactiveChats).toBe(1);
    expect(await stores.subscriptions.getByChatId(111)).toMatchObject({ active: false });
  });
});

describe('demo data can never reach real chats by accident', () => {
  it('refuses mock-mode dispatch unless a test explicitly allows it with a fake sender', async () => {
    const stores = createMemoryTelegramStores();
    const { sender } = createFakeSender();
    await expect(
      dispatchTelegramReminders({
        now: FRIDAY,
        config: DEFAULT_LOYALTY_CONFIG,
        provider: createTestProvider([]),
        dataMode: 'mock',
        stores,
        sender,
      }),
    ).rejects.toThrow(IntegrationError);
  });
});

describe('telegram webhook commands and unsubscribe', () => {
  function privateUpdate(text: string, chatId = 777, type = 'private') {
    return { updateId: 1, message: { messageId: 1, chat: { id: chatId, type }, text } };
  }

  it('links a chat with a valid single-use code and rejects reuse', async () => {
    const stores = createMemoryTelegramStores();
    const { sent, sender } = createFakeSender();
    const issued = await issueLinkCode({
      principal: { subjectId: 'user-a', role: 'CLIENT', moySkladCustomerId: 'company-a' },
      stores,
      linkingSecret: TEST_SECRETS.linkingSecret,
      botUsername: 'BarakaTestBot',
      nowMs: 0,
    });
    const linked = await handleTelegramUpdate({ update: privateUpdate(`/start ${issued.code}`), stores, sender, botUsername: 'BarakaTestBot', linkingSecret: TEST_SECRETS.linkingSecret, now: new Date(1_000) });
    expect(linked).toMatchObject({ action: 'linked', chatId: 777, replied: true });
    expect(await stores.subscriptions.getByChatId(777)).toMatchObject({ active: true, customerId: 'company-a', subjectId: 'user-a' });

    const reused = await handleTelegramUpdate({ update: privateUpdate(`/start ${issued.code}`), stores, sender, botUsername: 'BarakaTestBot', linkingSecret: TEST_SECRETS.linkingSecret, now: new Date(2_000) });
    expect(reused.action).toBe('invalid-code');
    expect(sent).toHaveLength(2);
  });

  it('rejects unauthorized linking attempts without creating subscriptions', async () => {
    const stores = createMemoryTelegramStores();
    const { sent, sender } = createFakeSender();
    const result = await handleTelegramUpdate({
      update: privateUpdate('/start ABCDEFGHijklmnopQRSTUV'),
      stores,
      sender,
      botUsername: 'BarakaTestBot',
      linkingSecret: TEST_SECRETS.linkingSecret,
    });
    expect(result.action).toBe('invalid-code');
    expect(await stores.subscriptions.getByChatId(777)).toBeNull();
    expect(sent[0].text).toContain('yaroqsiz');
  });

  it('supports stop/unsubscribe and re-enable via start', async () => {
    const stores = createMemoryTelegramStores();
    await subscribeClient(stores, 777, 'company-a', 'uz');
    const { sender } = createFakeSender();
    const base = { update: privateUpdate('/stop'), stores, sender, botUsername: 'BarakaTestBot' as string | null, linkingSecret: TEST_SECRETS.linkingSecret };

    expect((await handleTelegramUpdate(base)).action).toBe('stopped');
    expect(await stores.subscriptions.getByChatId(777)).toMatchObject({ active: false });

    const { sent: afterStop, sender: sender2 } = createFakeSender();
    await dispatchTelegramReminders({
      now: FRIDAY,
      config: DEFAULT_LOYALTY_CONFIG,
      provider: createTestProvider([makeOrder({ id: 'ORD-A1', customerId: 'company-a', status: 'Yangi' })]),
      dataMode: 'mock',
      allowMockDelivery: true,
      stores,
      sender: sender2,
    });
    expect(afterStop).toHaveLength(0);

    expect((await handleTelegramUpdate({ ...base, update: privateUpdate('/start') })).action).toBe('enabled');
    expect(await stores.subscriptions.getByChatId(777)).toMatchObject({ active: true });
  });

  it('answers help, onboards strangers via pilot mode and ignores groups and non-text updates', async () => {
    const stores = createMemoryTelegramStores();
    const { sent, sender } = createFakeSender();
    expect((await handleTelegramUpdate({ update: privateUpdate('/help'), stores, sender, botUsername: 'BarakaTestBot', linkingSecret: TEST_SECRETS.linkingSecret })).action).toBe('help');
    expect((await handleTelegramUpdate({ update: privateUpdate('hello?'), stores, sender, botUsername: 'BarakaTestBot', linkingSecret: TEST_SECRETS.linkingSecret })).action).toBe('awaiting-contact');
    expect((await handleTelegramUpdate({ update: privateUpdate('/start', 555, 'group'), stores, sender, botUsername: 'BarakaTestBot', linkingSecret: TEST_SECRETS.linkingSecret })).action).toBe('ignored');
    expect((await handleTelegramUpdate({ update: { updateId: 2 }, stores, sender, botUsername: 'BarakaTestBot', linkingSecret: TEST_SECRETS.linkingSecret })).action).toBe('ignored');
    const repliesBefore = sent.length;
    expect((await handleTelegramUpdate({ update: privateUpdate('/start@OtherBot payload', 999), stores, sender, botUsername: 'BarakaTestBot', linkingSecret: TEST_SECRETS.linkingSecret })).action).toBe('awaiting-contact');
    expect(sent.length).toBe(repliesBefore + 1);
  });
});

describe('telegram api routes', () => {
  it('exposes a secret-free public status', async () => {
    stubFullEnv();
    const response = await statusGET();
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toContain(TEST_SECRETS.botToken);
    expect(serialized).not.toContain(TEST_SECRETS.webhookSecret);
    expect(serialized).not.toContain(TEST_SECRETS.linkingSecret);
    expect(serialized).not.toContain(TEST_SECRETS.cronSecret);
  });

  it('rejects webhook calls without configuration or with a wrong secret', async () => {
    const unconfigured = await webhookPOST(new Request('https://portal.test/api/telegram/webhook', { method: 'POST', body: '{}' }));
    expect(unconfigured.status).toBe(503);

    stubFullEnv();
    const unauthorized = await webhookPOST(
      new Request('https://portal.test/api/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': 'wrong' },
        body: JSON.stringify({ update_id: 1 }),
      }),
    );
    expect(unauthorized.status).toBe(401);
    expect(JSON.stringify(await unauthorized.json())).not.toContain(TEST_SECRETS.webhookSecret);
  });

  it('ignores malformed webhook updates after validating the secret', async () => {
    stubFullEnv();
    const response = await webhookPOST(
      new Request('https://portal.test/api/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': TEST_SECRETS.webhookSecret },
        body: JSON.stringify({ nope: true }),
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, ignored: true });
  });

  it('handles a valid webhook update without leaking secrets', async () => {
    stubFullEnv();
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 9 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);
    const response = await webhookPOST(
      new Request('https://portal.test/api/telegram/webhook', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': TEST_SECRETS.webhookSecret },
        body: JSON.stringify({ update_id: 3, message: { message_id: 1, chat: { id: 999, type: 'private' }, text: '/help' } }),
      }),
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, action: 'service-unavailable' });
    expect(JSON.stringify(body)).not.toContain(TEST_SECRETS.botToken);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const firstCall = fetchSpy.mock.calls[0] as unknown as [string];
    expect(String(firstCall[0])).toContain('/sendMessage');
  });

  it('refuses linking codes until shopflow auth is connected', async () => {
    const unconfigured = await linkCodePOST(new Request('https://portal.test/api/telegram/link-code', { method: 'POST', body: '{}' }));
    expect(unconfigured.status).toBe(503);
    stubFullEnv();
    const noAuth = await linkCodePOST(new Request('https://portal.test/api/telegram/link-code', { method: 'POST', body: '{}' }));
    expect(noAuth.status).toBe(503);
    expect(await noAuth.json()).toMatchObject({ ok: false, error: 'auth-unconfigured' });
  });

  it('protects the scheduler with its own secret and refuses mock-mode delivery', async () => {
    stubFullEnv();
    vi.stubEnv('MOYSKLAD_MODE', 'mock');
    const fetchSpy = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchSpy);

    const anonymous = await cronPOST(new Request('https://portal.test/api/cron/telegram-reminders', { method: 'POST' }));
    expect(anonymous.status).toBe(401);
    const wrongSecret = await cronPOST(
      new Request('https://portal.test/api/cron/telegram-reminders', { method: 'POST', headers: { authorization: 'Bearer wrong' } }),
    );
    expect(wrongSecret.status).toBe(401);

    const authed = new Request('https://portal.test/api/cron/telegram-reminders', {
      method: 'POST',
      headers: { authorization: `Bearer ${TEST_SECRETS.cronSecret}` },
    });
    const mockRefused = await cronPOST(authed);
    expect(mockRefused.status).toBe(503);
    expect(await mockRefused.json()).toMatchObject({ ok: false, error: 'mock-mode' });
    expect(fetchSpy).not.toHaveBeenCalled();

    const mockRefusedGet = await cronGET(
      new Request('https://portal.test/api/cron/telegram-reminders', { headers: { authorization: `Bearer ${TEST_SECRETS.cronSecret}` } }),
    );
    expect(mockRefusedGet.status).toBe(503);
  });
});
