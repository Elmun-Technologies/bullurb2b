import { afterEach, describe, expect, it, vi } from 'vitest';

import { POST as webhookPOST } from '@/app/api/telegram/webhook/route';
import { GET as adminListGET } from '@/app/api/admin/telegram/applications/route';
import { POST as adminApprovePOST } from '@/app/api/admin/telegram/applications/[chatId]/approve/route';
import { POST as adminRejectPOST } from '@/app/api/admin/telegram/applications/[chatId]/reject/route';
import { DEFAULT_LOYALTY_CONFIG } from '@/lib/domain/loyalty';
import type { MoySkladCounterparty } from '@/lib/moysklad/types';
import type { MoySkladFindResult } from '@/lib/moysklad/client';
import { TelegramBotApiClient } from './client';
import { readTelegramAdminChatId, requireTelegramAdminSecret } from './config';
import { dispatchTelegramReminders, type TelegramSender } from './dispatcher';
import { buildShareLocationKeyboard, buildSkipLocationLabel } from './messages';
import { createMemoryTelegramStores, getTelegramStores, resetMemoryTelegramStores, type TelegramStores } from './stores';
import type { CounterpartyDirectory } from './onboarding';
import { parseTelegramUpdate } from './webhook';
import { handleTelegramUpdate } from './webhook-handler';
import type { TelegramIncomingUpdate, TelegramReplyMarkup } from './types';
import { TEST_SECRETS, stubFullTelegramEnv as stubFullEnv } from './test-helpers';

const LINKING_SECRET = 'onboarding-linking-secret-0123456789abcdef';
const CHAT_ID = 777001;
const FROM_ID = 555001;
const PHONE = '+998901234567';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetMemoryTelegramStores();
});

function makeSender(): {
  sender: TelegramSender;
  sent: Array<{ chatId: number; text: string; replyMarkup?: TelegramReplyMarkup }>;
  answered: Array<{ id: string; text?: string }>;
  edited: Array<{ chatId: number | string; messageId: number; text: string }>;
} {
  const sent: Array<{ chatId: number; text: string; replyMarkup?: TelegramReplyMarkup }> = [];
  const answered: Array<{ id: string; text?: string }> = [];
  const edited: Array<{ chatId: number | string; messageId: number; text: string }> = [];
  const sender: TelegramSender = {
    async sendMessage(chatId, text, options) {
      sent.push({ chatId, text, replyMarkup: options?.replyMarkup });
      return { messageId: sent.length };
    },
    async answerCallbackQuery(id, input) {
      answered.push({ id, text: input?.text });
      return true as const;
    },
    async editMessageText(chatId, messageId, text) {
      edited.push({ chatId, messageId, text });
      return true as const;
    },
  };
  return { sender, sent, answered, edited };
}

function makeDirectory(behavior: {
  find?: (phone: string) => MoySkladFindResult | Promise<MoySkladFindResult>;
  create?: (input: { name: string; phone: string; description?: string }) => MoySkladCounterparty | Promise<MoySkladCounterparty>;
}): { directory: CounterpartyDirectory; calls: { find: string[]; create: Array<{ name: string; phone: string }> } } {
  const calls: { find: string[]; create: Array<{ name: string; phone: string }> } = { find: [], create: [] };
  const directory: CounterpartyDirectory = {
    async findByPhone(phone) {
      calls.find.push(phone);
      if (behavior.find) return behavior.find(phone);
      return { status: 'not-found' };
    },
    async createCounterparty(input) {
      calls.create.push({ name: input.name, phone: input.phone });
      if (behavior.create) return behavior.create(input);
      return { id: 'cp-new', name: input.name, phone: input.phone };
    },
  };
  return { directory, calls };
}

function contactUpdate(phoneNumber: string, userId?: number): TelegramIncomingUpdate {
  const parsed = parseTelegramUpdate({
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: FROM_ID },
      chat: { id: CHAT_ID, type: 'private' },
      contact: { phone_number: phoneNumber, first_name: 'Akmal', ...(userId === undefined ? {} : { user_id: userId }) },
    },
  });
  if (!parsed) throw new Error('test update failed to parse');
  return parsed;
}

function textUpdate(text: string): TelegramIncomingUpdate {
  const parsed = parseTelegramUpdate({
    update_id: 2,
    message: { message_id: 2, from: { id: FROM_ID }, chat: { id: CHAT_ID, type: 'private' }, text },
  });
  if (!parsed) throw new Error('test update failed to parse');
  return parsed;
}

async function handle(stores: TelegramStores, sender: TelegramSender, update: TelegramIncomingUpdate, directory?: CounterpartyDirectory | null, adminChatId?: string | null) {
  return handleTelegramUpdate({ update, stores, sender, botUsername: 'BarakaTestBot', linkingSecret: LINKING_SECRET, directory: directory ?? null, adminChatId: adminChatId ?? null });
}

function locationUpdate(latitude: number, longitude: number): TelegramIncomingUpdate {
  const parsed = parseTelegramUpdate({
    update_id: 3,
    message: { message_id: 3, from: { id: FROM_ID }, chat: { id: CHAT_ID, type: 'private' }, location: { latitude, longitude } },
  });
  if (!parsed) throw new Error('test update failed to parse');
  return parsed;
}

function callbackUpdate(data: string, fromId: number, chatId: number, messageId = 50): TelegramIncomingUpdate {
  const parsed = parseTelegramUpdate({
    update_id: 4,
    callback_query: { id: `q-${data}`, from: { id: fromId }, message: { message_id: messageId, chat: { id: chatId, type: chatId < 0 ? 'group' : 'private' } }, data },
  });
  if (!parsed) throw new Error('test callback failed to parse');
  return parsed;
}

/** Drives a full pilot registration: contact → name → company → address → location/skip. */
async function completePilotRegistration(stores: TelegramStores, sender: TelegramSender, options: { withLocation?: boolean } = {}) {
  await handle(stores, sender, textUpdate('/start'), null);
  await handle(stores, sender, contactUpdate(PHONE, FROM_ID), null);
  await handle(stores, sender, textUpdate('Akmal Karimov'), null);
  await handle(stores, sender, textUpdate('BARAKA SAVDO'), null);
  await handle(stores, sender, textUpdate('Toshkent shahri, Chilonzor tumani, 12-uy'), null);
  if (options.withLocation) {
    return handle(stores, sender, locationUpdate(41.3111, 69.2797), null);
  }
  return handle(stores, sender, textUpdate(buildSkipLocationLabel('uz')), null);
}

describe('telegram contact parsing', () => {
  it('extracts from/contact fields and rejects malformed contact payloads', () => {
    const parsed = contactUpdate(PHONE, FROM_ID);
    expect(parsed.message?.from?.id).toBe(FROM_ID);
    expect(parsed.message?.contact).toMatchObject({ phoneNumber: PHONE, userId: FROM_ID });
    expect(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, contact: { user_id: 5 } } })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, contact: { phone_number: 123 } } })).toBeNull();
  });

  it('passes reply_markup through to the official sendMessage payload', async () => {
    const calls: Array<{ url: string; payload: unknown }> = [];
    const fetchImpl = vi.fn(async (url: string, init: { body?: string }) => {
      calls.push({ url, payload: init.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    });
    const client = new TelegramBotApiClient(TEST_SECRETS.botToken, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await client.sendMessage(CHAT_ID, 'share?', { replyMarkup: { keyboard: [[{ text: '📱 Share', request_contact: true }]], one_time_keyboard: true } });
    expect(calls[0].payload).toMatchObject({ reply_markup: { keyboard: [[{ text: '📱 Share', request_contact: true }]] } });
  });
});

describe('telegram phone onboarding', () => {
  it('asks unlinked /start chats to share their number with a contact button', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    const { directory } = makeDirectory({});
    const result = await handle(stores, sender, textUpdate('/start'), directory);
    expect(result).toMatchObject({ action: 'awaiting-contact', replied: true });
    expect(sent).toHaveLength(1);
    const markup = sent[0].replyMarkup as { keyboard: Array<Array<{ text: string; request_contact?: boolean }>> };
    expect(markup.keyboard[0][0].request_contact).toBe(true);
    expect(await stores.dialogs.get(CHAT_ID)).toMatchObject({ step: 'awaiting-contact' });
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toBeNull();
  });

  it('starts pilot phone onboarding when MoySklad is unconfigured', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    const result = await handle(stores, sender, textUpdate('/start'), null);
    expect(result.action).toBe('awaiting-contact');
    const markup = sent[0].replyMarkup as { keyboard: Array<Array<{ text: string; request_contact?: boolean }>> };
    expect(markup.keyboard[0][0].request_contact).toBe(true);
    expect(sent[0].text.toLowerCase()).toContain('test');
    expect(await stores.dialogs.get(CHAT_ID)).toMatchObject({ step: 'awaiting-contact' });
  });

  it('links an existing client automatically and shows their data', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    const { directory, calls } = makeDirectory({
      find: () => ({ status: 'found', counterparty: { id: 'cp-1', name: 'ALFA MARKET', phone: '+998 90 123 45 67', code: 'C-100' } }),
    });
    await handle(stores, sender, textUpdate('/start'), directory);
    const result = await handle(stores, sender, contactUpdate('+998 90 123 45 67', FROM_ID), directory);
    expect(result.action).toBe('linked');
    expect(calls.find).toEqual([PHONE]);
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toMatchObject({ subjectId: 'moysklad:cp-1', role: 'CLIENT', customerId: 'cp-1', active: true });
    expect(sent[1].text).toContain('ALFA MARKET');
    expect(sent[1].replyMarkup).toEqual({ remove_keyboard: true });
    expect(await stores.dialogs.get(CHAT_ID)).toBeNull();
  });

  it('rejects contacts that fail the ownership or format check', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    const { directory, calls } = makeDirectory({ find: () => ({ status: 'not-found' }) });
    await handle(stores, sender, textUpdate('/start'), directory);

    // Someone else's number (user_id mismatch) must never link this chat.
    expect((await handle(stores, sender, contactUpdate(PHONE, 999_999), directory)).action).toBe('awaiting-contact');
    // Missing user_id cannot prove ownership either.
    expect((await handle(stores, sender, contactUpdate(PHONE), directory)).action).toBe('awaiting-contact');
    // Implausible phone number.
    expect((await handle(stores, sender, contactUpdate('123', FROM_ID), directory)).action).toBe('awaiting-contact');
    // Typed text is not proof of ownership: never link manual numbers.
    expect((await handle(stores, sender, textUpdate(PHONE), directory)).action).toBe('awaiting-contact');

    expect(calls.find).toEqual([]);
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toBeNull();
    expect(sent[sent.length - 1].replyMarkup).toMatchObject({ keyboard: expect.any(Array) });
  });

  it('registers a new client via name and company, then links the chat', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    const { directory, calls } = makeDirectory({ find: () => ({ status: 'not-found' }) });
    await handle(stores, sender, textUpdate('/start'), directory);

    expect((await handle(stores, sender, contactUpdate(PHONE, FROM_ID), directory)).action).toBe('awaiting-name');
    expect(sent[sent.length - 1].text).toContain(PHONE);
    expect((await handle(stores, sender, textUpdate('A'), directory)).action).toBe('awaiting-name');
    expect((await handle(stores, sender, textUpdate('Akmal Karimov'), directory)).action).toBe('awaiting-company');
    expect((await handle(stores, sender, textUpdate('x'), directory)).action).toBe('awaiting-company');

    const result = await handle(stores, sender, textUpdate('BARAKA SAVDO'), directory);
    expect(result.action).toBe('linked');
    expect(calls.create).toEqual([{ name: 'BARAKA SAVDO', phone: PHONE }]);
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toMatchObject({ subjectId: 'moysklad:cp-new', customerId: 'cp-new' });
    expect(sent[sent.length - 1].text).toContain('BARAKA SAVDO');
    expect(await stores.dialogs.get(CHAT_ID)).toBeNull();
  });

  it('routes ambiguous matches to the manager without linking', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    const { directory } = makeDirectory({ find: () => ({ status: 'ambiguous', matches: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] }) });
    await handle(stores, sender, textUpdate('/start'), directory);
    expect((await handle(stores, sender, contactUpdate(PHONE, FROM_ID), directory)).action).toBe('ambiguous');
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toBeNull();
    expect(sent[sent.length - 1].text.toLowerCase()).toContain('menejer');
  });

  it('fails closed when the directory is down and lets /stop cancel the dialog', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    const { directory } = makeDirectory({
      find: () => { throw new Error('moysklad down'); },
    });
    await handle(stores, sender, textUpdate('/start'), directory);
    expect((await handle(stores, sender, contactUpdate(PHONE, FROM_ID), directory)).action).toBe('service-unavailable');
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toBeNull();

    const stopped = await handle(stores, sender, textUpdate('/stop'), directory);
    expect(stopped.action).toBe('already-stopped');
    expect(sent[sent.length - 1].replyMarkup).toEqual({ remove_keyboard: true });
    expect(await stores.dialogs.get(CHAT_ID)).toBeNull();
  });

  it('confirms already-linked chats that share a contact again', async () => {
    const stores = createMemoryTelegramStores();
    const { sender } = makeSender();
    const { directory } = makeDirectory({ find: () => ({ status: 'found', counterparty: { id: 'cp-1', name: 'ALFA MARKET' } }) });
    await handle(stores, sender, textUpdate('/start'), directory);
    await handle(stores, sender, contactUpdate(PHONE, FROM_ID), directory);
    const again = await handle(stores, sender, contactUpdate(PHONE, FROM_ID), directory);
    expect(again.action).toBe('enabled');
  });
});

describe('telegram onboarding webhook route wiring', () => {
  function stubRouteFetch(rows: unknown[]) {
    const calls: string[] = [];
    const fetchStub = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('api.moysklad.ru')) {
        return new Response(JSON.stringify({ meta: { size: rows.length, limit: 10, offset: 0 }, rows }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, result: { message_id: 7 } }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchStub);
    return calls;
  }

  function webhookRequest(body: unknown) {
    return new Request('https://portal.test/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': TEST_SECRETS.webhookSecret },
      body: JSON.stringify(body),
    });
  }

  it('runs the real MoySklad client for /start and contact lookup end to end', async () => {
    stubFullEnv();
    vi.stubEnv('TELEGRAM_STORE_MODE', 'memory');
    vi.stubEnv('MOYSKLAD_API_TOKEN', 'route-test-token');
    const calls = stubRouteFetch([{ id: 'cp-route', name: 'ROUTE SHOP', phone: '+998901234567' }]);

    const started = await webhookPOST(webhookRequest({ update_id: 10, message: { message_id: 1, chat: { id: CHAT_ID, type: 'private' }, text: '/start' } }));
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ ok: true, action: 'awaiting-contact' });

    const linked = await webhookPOST(
      webhookRequest({
        update_id: 11,
        message: {
          message_id: 2,
          from: { id: FROM_ID },
          chat: { id: CHAT_ID, type: 'private' },
          contact: { phone_number: PHONE, first_name: 'Akmal', user_id: FROM_ID },
        },
      }),
    );
    expect(linked.status).toBe(200);
    expect(await linked.json()).toMatchObject({ ok: true, action: 'linked' });
    expect(calls.some((url) => url.includes('api.moysklad.ru/api/remap/1.2/entity/counterparty?search=998901234567'))).toBe(true);
  });

  it('starts pilot onboarding when MoySklad is not configured', async () => {
    stubFullEnv();
    vi.stubEnv('TELEGRAM_STORE_MODE', 'memory');
    stubRouteFetch([]);
    const started = await webhookPOST(webhookRequest({ update_id: 12, message: { message_id: 1, chat: { id: CHAT_ID, type: 'private' }, text: '/start' } }));
    expect(await started.json()).toMatchObject({ ok: true, action: 'awaiting-contact' });
  });
});

describe('telegram pilot onboarding (no MoySklad token)', () => {
  it('collects a full registration and submits it for admin review', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    await handle(stores, sender, textUpdate('/start'), null);
    expect((await handle(stores, sender, contactUpdate(PHONE, FROM_ID), null)).action).toBe('awaiting-name');
    expect((await handle(stores, sender, textUpdate('A'), null)).action).toBe('awaiting-name');
    expect((await handle(stores, sender, textUpdate('Akmal Karimov'), null)).action).toBe('awaiting-company');
    expect((await handle(stores, sender, textUpdate('x'), null)).action).toBe('awaiting-company');
    expect((await handle(stores, sender, textUpdate('BARAKA SAVDO'), null)).action).toBe('awaiting-address');
    expect((await handle(stores, sender, textUpdate('Tosh'), null)).action).toBe('awaiting-address');
    expect((await handle(stores, sender, textUpdate('Toshkent, Chilonzor 12'), null)).action).toBe('awaiting-location');
    const markup = sent[sent.length - 1].replyMarkup as { keyboard: Array<Array<{ text: string; request_location?: boolean }>> };
    expect(markup.keyboard[0][0].request_location).toBe(true);
    expect((await handle(stores, sender, textUpdate('shunchaki matn'), null)).action).toBe('awaiting-location');

    const result = await handle(stores, sender, locationUpdate(41.3111, 69.2797), null);
    expect(result.action).toBe('application-submitted');
    expect(await stores.applications.getByChatId(CHAT_ID)).toMatchObject({
      phone: PHONE,
      name: 'Akmal Karimov',
      company: 'BARAKA SAVDO',
      address: 'Toshkent, Chilonzor 12',
      location: { latitude: 41.3111, longitude: 69.2797 },
      status: 'pending',
    });
    const subscription = await stores.subscriptions.getByChatId(CHAT_ID);
    expect(subscription).toMatchObject({ subjectId: `pilot-phone:${PHONE}`, role: 'CLIENT', phone: PHONE, active: true });
    expect(subscription?.customerId).toBeUndefined();
    expect(sent[sent.length - 1].text).toContain('BARAKA SAVDO');
    expect(sent[sent.length - 1].replyMarkup).toEqual({ remove_keyboard: true });
    expect(await stores.dialogs.get(CHAT_ID)).toBeNull();
  });

  it('accepts skipping the location step', async () => {
    const stores = createMemoryTelegramStores();
    const { sender } = makeSender();
    const result = await completePilotRegistration(stores, sender);
    expect(result.action).toBe('application-submitted');
    const application = await stores.applications.getByChatId(CHAT_ID);
    expect(application?.status).toBe('pending');
    expect(application?.location).toBeUndefined();
  });

  it('restarts pilot onboarding when a location arrives without a dialog', async () => {
    const stores = createMemoryTelegramStores();
    const { sender } = makeSender();
    expect((await handle(stores, sender, locationUpdate(41.3, 69.2), null)).action).toBe('awaiting-contact');
  });

  it('rejects spoofed contacts and typed numbers in pilot mode', async () => {
    const stores = createMemoryTelegramStores();
    const { sender } = makeSender();
    await handle(stores, sender, textUpdate('/start'), null);
    expect((await handle(stores, sender, contactUpdate(PHONE, 999_999), null)).action).toBe('awaiting-contact');
    expect((await handle(stores, sender, contactUpdate(PHONE), null)).action).toBe('awaiting-contact');
    expect((await handle(stores, sender, textUpdate(PHONE), null)).action).toBe('awaiting-contact');
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toBeNull();
  });

  it('shows the pending status on repeat /start and contact re-share', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    await completePilotRegistration(stores, sender);
    expect((await handle(stores, sender, textUpdate('/start'), null)).action).toBe('enabled');
    expect(sent[sent.length - 1].text).toContain('BARAKA SAVDO');
    expect((await handle(stores, sender, contactUpdate(PHONE, FROM_ID), null)).action).toBe('enabled');
    expect(sent[sent.length - 1].replyMarkup).toEqual({ remove_keyboard: true });
  });

  it('notifies the admin chat when an application is submitted', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    await handle(stores, sender, textUpdate('/start'), null, '999888777');
    await handle(stores, sender, contactUpdate(PHONE, FROM_ID), null, '999888777');
    await handle(stores, sender, textUpdate('Akmal Karimov'), null, '999888777');
    await handle(stores, sender, textUpdate('BARAKA SAVDO'), null, '999888777');
    await handle(stores, sender, textUpdate('Toshkent, Chilonzor 12'), null, '999888777');
    await handle(stores, sender, locationUpdate(41.3111, 69.2797), null, '999888777');
    const adminMessage = sent.find((item) => item.chatId === 999888777);
    expect(adminMessage?.text).toContain('BARAKA SAVDO');
    expect(adminMessage?.text).toContain(PHONE);
    expect(adminMessage?.text).toContain('maps.google.com/?q=41.3111,69.2797');
    const inline = adminMessage?.replyMarkup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    expect(inline.inline_keyboard[0].map((button) => button.callback_data)).toEqual([`app:approve:${CHAT_ID}`, `app:reject:${CHAT_ID}`]);
  });

  it('lets /stop cancel a pilot dialog', async () => {
    const stores = createMemoryTelegramStores();
    const { sender } = makeSender();
    await handle(stores, sender, textUpdate('/start'), null);
    expect((await handle(stores, sender, textUpdate('/stop'), null)).action).toBe('already-stopped');
    expect(await stores.dialogs.get(CHAT_ID)).toBeNull();
  });

  it('upgrades a pilot binding via real lookup once MoySklad appears', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    await completePilotRegistration(stores, sender);

    const { directory } = makeDirectory({
      find: () => ({ status: 'found', counterparty: { id: 'cp-1', name: 'ALFA MARKET', phone: PHONE } }),
    });
    expect((await handle(stores, sender, textUpdate('/start'), directory)).action).toBe('linked');
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toMatchObject({ subjectId: 'moysklad:cp-1', customerId: 'cp-1' });
    expect(sent[sent.length - 1].text).toContain('ALFA MARKET');
  });

  it('registers a pilot phone that MoySklad does not know yet', async () => {
    const stores = createMemoryTelegramStores();
    const { sender } = makeSender();
    await completePilotRegistration(stores, sender);

    const { directory, calls } = makeDirectory({ find: () => ({ status: 'not-found' }) });
    expect((await handle(stores, sender, textUpdate('/start'), directory)).action).toBe('awaiting-name');
    expect(await stores.dialogs.get(CHAT_ID)).toMatchObject({ step: 'awaiting-name', phone: PHONE });
    expect((await handle(stores, sender, textUpdate('Akmal Karimov'), directory)).action).toBe('awaiting-company');
    expect((await handle(stores, sender, textUpdate('BARAKA SAVDO'), directory)).action).toBe('linked');
    expect(calls.create).toEqual([{ name: 'BARAKA SAVDO', phone: PHONE }]);
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toMatchObject({ customerId: 'cp-new' });
  });

  it('keeps the pilot binding when the upgrade lookup is ambiguous', async () => {
    const stores = createMemoryTelegramStores();
    const { sender } = makeSender();
    await completePilotRegistration(stores, sender);

    const { directory } = makeDirectory({ find: () => ({ status: 'ambiguous', matches: [{ id: 'a', name: 'A' }] }) });
    expect((await handle(stores, sender, textUpdate('/start'), directory)).action).toBe('ambiguous');
    expect(await stores.subscriptions.getByChatId(CHAT_ID)).toMatchObject({ subjectId: `pilot-phone:${PHONE}`, phone: PHONE });
    expect((await stores.subscriptions.getByChatId(CHAT_ID))?.customerId).toBeUndefined();
  });

  it('never dispatches reminders to pilot bindings without a customer mapping', async () => {
    const stores = createMemoryTelegramStores();
    await stores.subscriptions.save({
      chatId: CHAT_ID,
      subjectId: `pilot-phone:${PHONE}`,
      role: 'CLIENT',
      phone: PHONE,
      locale: 'uz',
      active: true,
      linkedAt: new Date().toISOString(),
    });
    const { sender, sent } = makeSender();
    const summary = await dispatchTelegramReminders({
      now: new Date('2026-09-25T05:00:00.000Z'),
      config: DEFAULT_LOYALTY_CONFIG,
      provider: { mode: 'mock', getProducts: async () => [], getProduct: async () => null, getCustomers: async () => [], getCustomer: async () => null, getOrders: async () => [], getOrder: async () => null, getCustomerPurchaseHistory: async () => [] },
      dataMode: 'mock',
      allowMockDelivery: true,
      stores,
      sender,
    });
    expect(summary.sent).toBe(0);
    expect(sent).toHaveLength(0);
  });
});

describe('telegram location parsing and keyboard', () => {
  it('extracts valid locations and rejects malformed payloads', () => {
    expect(locationUpdate(41.3, 69.2).message?.location).toEqual({ latitude: 41.3, longitude: 69.2 });
    expect(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, location: { latitude: 1 } } })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, location: { latitude: 'x', longitude: 1 } } })).toBeNull();
    expect(parseTelegramUpdate({ update_id: 1, message: { message_id: 1, chat: { id: 1, type: 'private' }, location: 'tashkent' } })).toBeNull();
  });

  it('builds a location keyboard with a skip option', () => {
    const keyboard = buildShareLocationKeyboard('uz');
    expect(keyboard.keyboard[0][0]).toMatchObject({ request_location: true });
    expect(keyboard.keyboard[1][0].text).toBe(buildSkipLocationLabel('uz'));
  });
});

describe('telegram admin config', () => {
  it('requires a strong admin secret and parses the admin chat id', () => {
    expect(() => requireTelegramAdminSecret({})).toThrow();
    expect(() => requireTelegramAdminSecret({ TELEGRAM_ADMIN_SECRET: 'short' })).toThrow();
    expect(requireTelegramAdminSecret({ TELEGRAM_ADMIN_SECRET: 'a'.repeat(32) })).toBe('a'.repeat(32));
    expect(readTelegramAdminChatId({})).toBeNull();
    expect(readTelegramAdminChatId({ TELEGRAM_ADMIN_CHAT_ID: 'abc' })).toBeNull();
    expect(readTelegramAdminChatId({ TELEGRAM_ADMIN_CHAT_ID: '999888777' })).toBe('999888777');
  });
});

describe('telegram application store', () => {
  it('saves, reads and lists applications by status', async () => {
    const stores = createMemoryTelegramStores();
    expect(await stores.applications.getByChatId(1)).toBeNull();
    const base = { phone: PHONE, name: 'A', company: 'B', address: 'C', status: 'pending' as const, locale: 'uz' as const, createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z' };
    await stores.applications.save({ ...base, chatId: 1 });
    await stores.applications.save({ ...base, chatId: 2, status: 'approved' });
    expect((await stores.applications.getByChatId(1))?.company).toBe('B');
    expect(await stores.applications.listByStatus('pending')).toHaveLength(1);
    expect(await stores.applications.listByStatus('approved')).toHaveLength(1);
    expect(await stores.applications.listByStatus('rejected')).toHaveLength(0);
  });
});

describe('telegram admin application routes', () => {
  const ADMIN_SECRET = 'admin-SECRET-value-abcdef0123456789';

  function stubAdminEnv() {
    stubFullEnv();
    vi.stubEnv('TELEGRAM_STORE_MODE', 'memory');
    vi.stubEnv('TELEGRAM_ADMIN_SECRET', ADMIN_SECRET);
  }

  function stubTelegramSend() {
    const fetchStub = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchStub);
    return fetchStub;
  }

  async function seedPending(chatId: number = CHAT_ID) {
    const stores = getTelegramStores();
    const timestamp = new Date().toISOString();
    await stores.applications.save({
      chatId, phone: PHONE, name: 'Akmal Karimov', company: 'BARAKA SAVDO', address: 'Toshkent', status: 'pending', locale: 'uz', createdAt: timestamp, updatedAt: timestamp,
    });
    await stores.subscriptions.save({ chatId, subjectId: `pilot-phone:${PHONE}`, role: 'CLIENT', phone: PHONE, locale: 'uz', active: true, linkedAt: timestamp });
  }

  it('fails closed without the admin secret or storage', async () => {
    const noSecret = await adminListGET(new Request('https://portal.test/api/admin/telegram/applications'));
    expect(noSecret.status).toBe(503);
    stubAdminEnv();
    const wrongSecret = await adminListGET(
      new Request('https://portal.test/api/admin/telegram/applications', { headers: { authorization: 'Bearer wrong' } }),
    );
    expect(wrongSecret.status).toBe(401);
  });

  it('lists applications by status for the admin', async () => {
    stubAdminEnv();
    await seedPending();
    const pending = await adminListGET(
      new Request('https://portal.test/api/admin/telegram/applications?status=pending', { headers: { authorization: `Bearer ${ADMIN_SECRET}` } }),
    );
    expect(pending.status).toBe(200);
    const body = (await pending.json()) as { ok: boolean; applications: Array<{ company: string }> };
    expect(body.applications).toHaveLength(1);
    expect(body.applications[0].company).toBe('BARAKA SAVDO');
    const bad = await adminListGET(
      new Request('https://portal.test/api/admin/telegram/applications?status=nope', { headers: { authorization: `Bearer ${ADMIN_SECRET}` } }),
    );
    expect(bad.status).toBe(400);
  });

  it('approves a pending application and notifies the chat', async () => {
    stubAdminEnv();
    const fetchStub = stubTelegramSend();
    await seedPending();
    const response = await adminApprovePOST(
      new Request(`https://portal.test/api/admin/telegram/applications/${CHAT_ID}/approve`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN_SECRET}` } }),
      { params: Promise.resolve({ chatId: String(CHAT_ID) }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: 'approved', notified: true });
    expect(fetchStub).toHaveBeenCalledOnce();
    const stores = getTelegramStores();
    expect((await stores.applications.getByChatId(CHAT_ID))?.status).toBe('approved');
    expect((await stores.subscriptions.getByChatId(CHAT_ID))?.active).toBe(true);

    const again = await adminApprovePOST(
      new Request(`https://portal.test/api/admin/telegram/applications/${CHAT_ID}/approve`, { method: 'POST', headers: { authorization: `Bearer ${ADMIN_SECRET}` } }),
      { params: Promise.resolve({ chatId: String(CHAT_ID) }) },
    );
    expect(again.status).toBe(409);
    const missing = await adminApprovePOST(
      new Request('https://portal.test/api/admin/telegram/applications/424242/approve', { method: 'POST', headers: { authorization: `Bearer ${ADMIN_SECRET}` } }),
      { params: Promise.resolve({ chatId: '424242' }) },
    );
    expect(missing.status).toBe(404);
  });

  it('rejects with a reason, deactivates the binding and lets the user restart', async () => {
    stubAdminEnv();
    stubTelegramSend();
    await seedPending();
    const response = await adminRejectPOST(
      new Request(`https://portal.test/api/admin/telegram/applications/${CHAT_ID}/reject`, {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN_SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'Manzil to‘liq emas' }),
      }),
      { params: Promise.resolve({ chatId: String(CHAT_ID) }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, status: 'rejected', notified: true });
    const stores = getTelegramStores();
    expect((await stores.applications.getByChatId(CHAT_ID))?.reason).toBe('Manzil to‘liq emas');
    expect((await stores.subscriptions.getByChatId(CHAT_ID))?.active).toBe(false);

    // The same stores back the webhook: /start restarts registration at the name step.
    const { sender } = makeSender();
    const restarted = await handle(stores, sender, textUpdate('/start'), null);
    expect(restarted.action).toBe('awaiting-name');
    expect(await stores.dialogs.get(CHAT_ID)).toMatchObject({ step: 'awaiting-name', phone: PHONE });
  });
});

describe('telegram in-bot admin review', () => {
  const GROUP_ID = -100555001;
  const ADMIN_USER = 111222333;

  it('approves via a group inline button and updates both chats', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent, answered, edited } = makeSender();
    await completePilotRegistration(stores, sender);
    const result = await handle(stores, sender, callbackUpdate(`app:approve:${CHAT_ID}`, ADMIN_USER, GROUP_ID), null, String(GROUP_ID));
    expect(result.action).toBe('admin-approved');
    expect((await stores.applications.getByChatId(CHAT_ID))?.status).toBe('approved');
    expect(sent.find((item) => item.chatId === CHAT_ID && item.text.includes('tasdiqlandi'))).toBeDefined();
    expect(answered).toHaveLength(1);
    expect(answered[0].text).toContain('Tasdiqlandi');
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({ chatId: GROUP_ID, messageId: 50 });
    expect(edited[0].text).toContain('BARAKA SAVDO');
  });

  it('rejects via an admin DM button without a reason', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent, answered } = makeSender();
    await completePilotRegistration(stores, sender);
    const result = await handle(stores, sender, callbackUpdate(`app:reject:${CHAT_ID}`, ADMIN_USER, ADMIN_USER), null, String(ADMIN_USER));
    expect(result.action).toBe('admin-rejected');
    expect((await stores.applications.getByChatId(CHAT_ID))?.status).toBe('rejected');
    expect((await stores.subscriptions.getByChatId(CHAT_ID))?.active).toBe(false);
    expect(sent.find((item) => item.chatId === CHAT_ID && item.text.includes('rad etildi'))).toBeDefined();
    expect(answered[0].text).toContain('Rad etildi');
  });

  it('ignores presses from strangers, unknown data and missing admin config', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, answered } = makeSender();
    await completePilotRegistration(stores, sender);
    expect((await handle(stores, sender, callbackUpdate(`app:approve:${CHAT_ID}`, 424242, 424242), null, String(ADMIN_USER))).action).toBe('callback-ignored');
    expect((await handle(stores, sender, callbackUpdate('app:hack:1', ADMIN_USER, ADMIN_USER), null, String(ADMIN_USER))).action).toBe('callback-ignored');
    expect((await handle(stores, sender, callbackUpdate(`app:approve:${CHAT_ID}`, ADMIN_USER, ADMIN_USER), null, null)).action).toBe('callback-ignored');
    expect((await stores.applications.getByChatId(CHAT_ID))?.status).toBe('pending');
    expect(answered.map((item) => item.text)).toEqual(['Ruxsat yo‘q.', 'Nomaʼlum amal.', 'Ruxsat yo‘q.']);
  });

  it('handles double presses and unknown applications gracefully', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, answered, edited } = makeSender();
    await completePilotRegistration(stores, sender);
    await handle(stores, sender, callbackUpdate(`app:approve:${CHAT_ID}`, ADMIN_USER, ADMIN_USER), null, String(ADMIN_USER));
    const again = await handle(stores, sender, callbackUpdate(`app:approve:${CHAT_ID}`, ADMIN_USER, ADMIN_USER), null, String(ADMIN_USER));
    expect(again.action).toBe('callback-ignored');
    expect(answered[answered.length - 1].text).toContain('allaqachon');
    expect(edited.length).toBeGreaterThanOrEqual(2);
    const missing = await handle(stores, sender, callbackUpdate('app:approve:424242', ADMIN_USER, ADMIN_USER), null, String(ADMIN_USER));
    expect(missing.action).toBe('callback-ignored');
    expect(answered[answered.length - 1].text).toContain('topilmadi');
  });
});

describe('telegram user menu', () => {
  it('shows the profile with stored data and status', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    await completePilotRegistration(stores, sender, { withLocation: true });
    expect((await handle(stores, sender, textUpdate('/profil'), null)).action).toBe('profile');
    const profile = sent[sent.length - 1].text;
    expect(profile).toContain('BARAKA SAVDO');
    expect(profile).toContain(PHONE);
    expect(profile).toContain('Chilonzor');
    expect(profile).toContain('yuborilgan');
  });

  it('starts onboarding for /profil strangers and shows the program to anyone', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    expect((await handle(stores, sender, textUpdate('/profil'), null)).action).toBe('awaiting-contact');
    expect((await handle(stores, sender, textUpdate('/dastur'), null)).action).toBe('program');
    const program = sent[sent.length - 1].text;
    expect(program).toContain('Silver');
    expect(program).toContain('Gold');
    expect(program).toContain('3%');
  });

  it('shows the menu on /start for approved users', async () => {
    const stores = createMemoryTelegramStores();
    const { sender, sent } = makeSender();
    await completePilotRegistration(stores, sender);
    const timestamp = new Date().toISOString();
    await stores.applications.save({
      chatId: CHAT_ID, phone: PHONE, name: 'Akmal Karimov', company: 'BARAKA SAVDO', address: 'Toshkent',
      status: 'approved', locale: 'uz', createdAt: timestamp, updatedAt: timestamp,
    });
    expect((await handle(stores, sender, textUpdate('/start'), null)).action).toBe('enabled');
    expect(sent[sent.length - 1].text).toContain('/profil');
    expect(sent[sent.length - 1].text).toContain('BARAKA SAVDO');
  });
});
