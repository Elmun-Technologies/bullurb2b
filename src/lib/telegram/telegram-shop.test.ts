import { afterEach, describe, expect, it } from 'vitest';

import { ShopFlowApiError } from '@/lib/shopflow/client';
import type { ShopFlowCategory, ShopFlowOrderRequest, ShopFlowProduct, ShopFlowProductList, ShopFlowPromotion } from '@/lib/shopflow/types';
import type { TelegramSender } from './dispatcher';
import { decideApplication } from './admin';
import { buildApplicationApprovedMessage, buildHelpMessage } from './messages';
import { buildMainMenuKeyboard, buildMainMenuMessage, parseMenuButtonText } from './menu';
import { createMemoryTelegramStores, resetMemoryTelegramStores, type TelegramStores } from './stores';
import type { CatalogBackend } from './catalog';
import { parseTelegramCommand, TELEGRAM_ALLOWED_UPDATES } from './webhook';
import { handleTelegramUpdate } from './webhook-handler';
import type { TelegramIncomingUpdate, TelegramInlineKeyboardMarkup, TelegramReplyMarkup } from './types';

const LINKING_SECRET = 'shop-linking-secret-0123456789abcdef';
const CHAT_ID = 777002;
const ADMIN_CHAT_ID = '-999001';
const PHONE = '+998901234567';
const NOW = new Date('2026-10-04T12:00:00.000Z');

afterEach(() => {
  resetMemoryTelegramStores();
});

function makeSender(): {
  sender: TelegramSender;
  sent: Array<{ chatId: number; text: string; replyMarkup?: TelegramReplyMarkup }>;
  answered: Array<{ id: string; text?: string }>;
  edited: Array<{ chatId: number | string; messageId: number; text: string; replyMarkup?: TelegramInlineKeyboardMarkup | { inline_keyboard: [] } }>;
} {
  const sent: Array<{ chatId: number; text: string; replyMarkup?: TelegramReplyMarkup }> = [];
  const answered: Array<{ id: string; text?: string }> = [];
  const edited: Array<{ chatId: number | string; messageId: number; text: string; replyMarkup?: TelegramInlineKeyboardMarkup | { inline_keyboard: [] } }> = [];
  const sender: TelegramSender = {
    async sendMessage(chatId, text, options) {
      sent.push({ chatId, text, replyMarkup: options?.replyMarkup });
      return { messageId: sent.length };
    },
    async answerCallbackQuery(id, input) {
      answered.push({ id, text: input?.text });
      return true as const;
    },
    async editMessageText(chatId, messageId, text, options) {
      edited.push({ chatId, messageId, text, replyMarkup: options?.replyMarkup });
      return true as const;
    },
  };
  return { sender, sent, answered, edited };
}

function msg(text: string): TelegramIncomingUpdate {
  return { updateId: 2, message: { messageId: 11, chat: { id: CHAT_ID, type: 'private' }, text } };
}

let callbackSeq = 0;
function cb(data: string, overrides: { fromId?: number; chatId?: number; messageId?: number } = {}): TelegramIncomingUpdate {
  callbackSeq += 1;
  return {
    updateId: 100 + callbackSeq,
    callbackQuery: { id: `cq${callbackSeq}`, fromId: overrides.fromId ?? CHAT_ID, chatId: overrides.chatId ?? CHAT_ID, messageId: overrides.messageId ?? 10, data },
  };
}

function datas(markup: TelegramReplyMarkup | undefined): string[] {
  if (!markup || !('inline_keyboard' in markup)) return [];
  return markup.inline_keyboard.flat().map((button) => button.callback_data).filter((data): data is string => typeof data === 'string');
}

const CATEGORIES: ShopFlowCategory[] = [
  { id: 'c1', slug: 'ichimliklar', name: 'Ichimliklar', productCount: 2 },
  { id: 'c2', slug: 'shirinliklar', name: 'Shirinliklar', productCount: 1 },
];

function makeProduct(overrides: Partial<ShopFlowProduct> & { id: string; slug: string; name: string }): ShopFlowProduct {
  return {
    tagline: 'Zo‘r mahsulot',
    description: 'Batafsil tavsif',
    categoryId: 'c1',
    categorySlug: 'ichimliklar',
    price: 10000,
    currency: 'UZS',
    rating: 4.5,
    reviewCount: 12,
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
    priceTiers: [],
    moq: null,
    unit: 'dona',
    ...overrides,
  };
}

const SIMPLE = makeProduct({ id: 'p-simple', slug: 'cola-1l', name: 'Cola 1L', price: 12000, categorySlug: 'ichimliklar' });
const WITH_VARIANTS = makeProduct({
  id: 'p-var',
  slug: 'choy',
  name: 'Choy',
  price: 20000,
  categorySlug: 'ichimliklar',
  moq: 10,
  unit: 'kg',
  priceTiers: [{ minQty: 10, price: 19000 }],
  variants: [
    { id: 'v1', sku: 'CH-1', name: 'Qora 1kg', options: {}, price: 20000, inStock: true, images: [], attributes: [] },
    { id: 'v2', sku: 'CH-5', name: 'Qora 5kg', options: {}, price: 90000, inStock: true, images: [], attributes: [] },
  ],
});
const OUT_OF_STOCK = makeProduct({ id: 'p-oos', slug: 'shokolad', name: 'Shokolad', price: 8000, categorySlug: 'shirinliklar', inStock: false });

const PROMOS: ShopFlowPromotion[] = [{ id: 'pr1', type: 'free_shipping_over', title: 'Bepul yetkazish', description: '500 mingdan yuqori', threshold: 500000 }];

function makeShop(overrides: {
  products?: ShopFlowProduct[];
  order?: (body: ShopFlowOrderRequest) => Promise<{ orderId: string; message: string }>;
  promotions?: ShopFlowPromotion[];
} = {}): { shop: CatalogBackend; calls: { products: number; product: string[]; orders: ShopFlowOrderRequest[] } } {
  const products = overrides.products ?? [SIMPLE, WITH_VARIANTS, OUT_OF_STOCK];
  const calls: { products: number; product: string[]; orders: ShopFlowOrderRequest[] } = { products: 0, product: [], orders: [] };
  const shop: CatalogBackend = {
    async categories() {
      return CATEGORIES;
    },
    async products(query): Promise<ShopFlowProductList> {
      calls.products += 1;
      const filtered = query.category ? products.filter((item) => item.categorySlug === query.category) : products;
      const pageSize = query.pageSize ?? 20;
      const page = query.page ?? 1;
      return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
    },
    async product(slugOrId) {
      calls.product.push(slugOrId);
      const found = products.find((item) => item.id === slugOrId || item.slug === slugOrId);
      if (!found) throw new ShopFlowApiError('not found', { failure: 'not-found', retryable: false });
      return found;
    },
    async promotions() {
      return overrides.promotions ?? PROMOS;
    },
    async createOrder(body) {
      calls.orders.push(body);
      if (overrides.order) return overrides.order(body);
      return { orderId: 'ord-1', message: 'Buyurtma #ORD-7524 qabul qilindi' };
    },
  };
  return { shop, calls };
}

async function seedApproved(stores: TelegramStores): Promise<void> {
  await stores.subscriptions.save({ chatId: CHAT_ID, subjectId: `pilot-phone:${PHONE}`, role: 'CLIENT', phone: PHONE, locale: 'uz', active: true, linkedAt: NOW.toISOString() });
  await stores.applications.save({
    chatId: CHAT_ID,
    phone: PHONE,
    name: 'Ali Valiyev',
    company: 'Ali Market',
    address: 'Toshkent, Chilonzor 5',
    status: 'approved',
    locale: 'uz',
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  });
}

const STOREFRONT_URL = 'https://shop-flow.uz/store/billur';

function handle(stores: TelegramStores, sender: TelegramSender, update: TelegramIncomingUpdate, shop: CatalogBackend | null, storefrontUrl: string | null = null) {
  return handleTelegramUpdate({ update, stores, sender, botUsername: 'billurb2bbot', linkingSecret: LINKING_SECRET, shop, storefrontUrl, adminChatId: ADMIN_CHAT_ID, now: NOW });
}

describe('shop catalog wiring', () => {
  it('parses /katalog (uz alias for catalog)', () => {
    expect(parseTelegramCommand('/katalog', 'billurb2bbot').command).toBe('catalog');
    expect(parseTelegramCommand('/KATALOG', null).command).toBe('catalog');
    expect(parseTelegramCommand('/katalog@billurb2bbot', 'billurb2bbot').command).toBe('catalog');
    expect(parseTelegramCommand('/katalog@otherbot', 'billurb2bbot').command).toBe('unknown');
  });

  it('subscribes to callback_query updates', () => {
    expect([...TELEGRAM_ALLOWED_UPDATES]).toContain('callback_query');
  });

  it('approval, menu and help point to buttons', () => {
    expect(buildApplicationApprovedMessage('uz', 'Ali Market')).toContain('/menu');
    expect(buildApplicationApprovedMessage('ru', 'Ali Market')).toContain('кнопках');
    expect(buildMainMenuMessage('uz', 'Ali Market')).toContain('Ali Market');
    expect(buildMainMenuKeyboard('uz', STOREFRONT_URL).inline_keyboard).toHaveLength(4);
    expect(buildHelpMessage('uz')).toContain('/menu');
  });

  it('parses /menu and /menyu', () => {
    expect(parseTelegramCommand('/menu', 'billurb2bbot').command).toBe('menu');
    expect(parseTelegramCommand('/menyu', null).command).toBe('menu');
    expect(parseTelegramCommand('/menu@otherbot', 'billurb2bbot').command).toBe('unknown');
  });
});

describe('/katalog access', () => {
  it('is honest when ShopFlow is not configured', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { sender, sent } = makeSender();
    const result = await handle(stores, sender, msg('/katalog'), null);
    expect(result.action).toBe('catalog');
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('tez orada');
    expect(datas(sent[0].replyMarkup)).toHaveLength(0);
  });

  it('tells pending chats to wait', async () => {
    const stores = createMemoryTelegramStores();
    await stores.subscriptions.save({ chatId: CHAT_ID, subjectId: `pilot-phone:${PHONE}`, role: 'CLIENT', phone: PHONE, locale: 'uz', active: true, linkedAt: NOW.toISOString() });
    await stores.applications.save({ chatId: CHAT_ID, phone: PHONE, name: 'A', company: 'C', address: 'M', status: 'pending', locale: 'uz', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    const { shop } = makeShop();
    const { sender, sent } = makeSender();
    await handle(stores, sender, msg('/katalog'), shop);
    expect(sent[0].text).toContain('ko‘rib chiqilmoqda');
  });

  it('starts registration for unknown chats', async () => {
    const stores = createMemoryTelegramStores();
    const { shop } = makeShop();
    const { sender, sent } = makeSender();
    const result = await handle(stores, sender, msg('/katalog'), shop);
    expect(result.action).toBe('awaiting-contact');
    expect(sent[0].text).toContain('raqam');
  });
});

describe('storefront mini app', () => {
  it('opens the Mini App store with a button-catalog fallback', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop, calls } = makeShop();
    const { sender, sent } = makeSender();
    await handle(stores, sender, msg('/katalog'), shop, STOREFRONT_URL);
    expect(sent).toHaveLength(1);
    const markup = sent[0].replyMarkup;
    expect(markup && 'inline_keyboard' in markup ? markup.inline_keyboard[0][0] : null).toMatchObject({ text: expect.stringContaining('Do‘konni ochish'), web_app: { url: STOREFRONT_URL } });
    expect(datas(markup)).toContain('sf:cats');
    // The API catalog is untouched when the Mini App opens.
    expect(calls.products).toBe(0);
  });

  it('falls back to buttons without a storefront URL', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, sent } = makeSender();
    await handle(stores, sender, msg('/katalog'), shop, null);
    expect(datas(sent[0].replyMarkup)).toEqual(['sf:cat:0', 'sf:cat:1']);
  });

  it('answers the fallback honestly when the API is unconfigured', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { sender, edited } = makeSender();
    await handle(stores, sender, cb('sf:cats'), null, STOREFRONT_URL);
    expect(edited).toHaveLength(1);
    expect(edited[0].text).toContain('tez orada');
  });
});

function replyRows(markup: TelegramReplyMarkup | undefined): string[] {
  if (!markup || !('keyboard' in markup)) return [];
  return markup.keyboard.flat().map((button) => button.text);
}

describe('main menu', () => {
  it('/menu sends the persistent bottom keyboard with the Mini App store', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, sent } = makeSender();
    await handle(stores, sender, msg('/menu'), shop, STOREFRONT_URL);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('Ali Market');
    const markup = sent[0].replyMarkup;
    expect(markup && 'keyboard' in markup ? markup.is_persistent : false).toBe(true);
    expect(replyRows(markup)).toEqual(['🛒 Mahsulotlar', '⭐ Balim', '👤 Profilim', 'ℹ️ Yordam']);
    const shopButton = markup && 'keyboard' in markup ? markup.keyboard[0][0] : null;
    expect(shopButton).toMatchObject({ web_app: { url: STOREFRONT_URL } });
  });

  it('/start shows the bottom menu for approved chats', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, sent } = makeSender();
    const result = await handle(stores, sender, msg('/start'), shop, STOREFRONT_URL);
    expect(result.action).toBe('enabled');
    expect(replyRows(sent[0].replyMarkup)).toContain('⭐ Balim');
  });

  it('answers bottom-menu button texts with the matching screen', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, sent } = makeSender();
    await handle(stores, sender, msg('⭐ Balim'), shop, STOREFRONT_URL);
    expect(sent[0].text).toContain('Sodiqlik darajalari');
    expect(sent[0].text).toContain('Bepul yetkazish');
    await handle(stores, sender, msg('👤 Profilim'), shop);
    expect(sent[1].text).toContain('Ali Market');
    await handle(stores, sender, msg('ℹ️ Yordam'), shop);
    expect(sent[2].text).toContain('/menu');
    await handle(stores, sender, msg('🛒 Mahsulotlar'), shop, STOREFRONT_URL);
    const markup = sent[3].replyMarkup;
    expect(markup && 'inline_keyboard' in markup ? markup.inline_keyboard[0][0] : null).toMatchObject({ web_app: { url: STOREFRONT_URL } });
  });

  it('opens the button catalog from the shop label without a storefront url', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, sent } = makeSender();
    await handle(stores, sender, msg('🛒 Mahsulotlar'), shop, null);
    expect(datas(sent[0].replyMarkup)).toEqual(['sf:cat:0', 'sf:cat:1']);
  });

  it('parses menu labels in both locales', () => {
    expect(parseMenuButtonText('⭐ Balim')).toBe('points');
    expect(parseMenuButtonText('🛒 Товары')).toBe('shop');
    expect(parseMenuButtonText('salom')).toBeNull();
    expect(parseMenuButtonText('/menu')).toBeNull();
  });

  it('gates /menu like the catalog', async () => {
    const pending = createMemoryTelegramStores();
    await pending.subscriptions.save({ chatId: CHAT_ID, subjectId: `pilot-phone:${PHONE}`, role: 'CLIENT', phone: PHONE, locale: 'uz', active: true, linkedAt: NOW.toISOString() });
    await pending.applications.save({ chatId: CHAT_ID, phone: PHONE, name: 'A', company: 'C', address: 'M', status: 'pending', locale: 'uz', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    const { shop } = makeShop();
    const { sender, sent } = makeSender();
    await handle(pending, sender, msg('/menyu'), shop);
    expect(sent[0].text).toContain('ko‘rib chiqilmoqda');
  });

  it('navigates points/profile/help and back without any state', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, edited } = makeSender();
    await handle(stores, sender, msg('/menu'), shop, STOREFRONT_URL);

    await handle(stores, sender, cb('menu:points'), shop, STOREFRONT_URL);
    expect(edited[0].text).toContain('Sodiqlik darajalari');
    expect(edited[0].text).toContain('Bepul yetkazish');
    expect(datas(edited[0].replyMarkup)).toEqual(['menu:main']);

    await handle(stores, sender, cb('menu:profile'), shop);
    expect(edited[1].text).toContain('Ali Market');
    expect(edited[1].text).toContain('Tasdiqlangan');

    await handle(stores, sender, cb('menu:help'), shop);
    expect(edited[2].text).toContain('/menu');

    await handle(stores, sender, cb('menu:main'), shop, STOREFRONT_URL);
    expect(edited[3].text).toContain('Pastdagi menyudan');
    expect(await stores.shop.get(CHAT_ID)).toBeNull();
  });

  it('rejects foreign and unapproved menu presses', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, answered, edited } = makeSender();
    await handle(stores, sender, cb('menu:points', { fromId: 4242, chatId: -100, messageId: 99 }), shop);
    expect(answered[0].text).toContain('shaxsiy');
    expect(edited).toHaveLength(0);

    const empty = createMemoryTelegramStores();
    const { sender: sender2, answered: answered2 } = makeSender();
    await handle(empty, sender2, cb('menu:points'), shop);
    expect(answered2[0].text).toContain('/start');
  });

  it('attaches the bottom menu to the approval notification', async () => {
    const stores = createMemoryTelegramStores();
    await stores.subscriptions.save({ chatId: CHAT_ID, subjectId: `pilot-phone:${PHONE}`, role: 'CLIENT', phone: PHONE, locale: 'uz', active: true, linkedAt: NOW.toISOString() });
    await stores.applications.save({ chatId: CHAT_ID, phone: PHONE, name: 'Ali', company: 'Ali Market', address: 'M', status: 'pending', locale: 'uz', createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    const { sender, sent } = makeSender();
    const result = await decideApplication(stores, sender, CHAT_ID, 'approved', undefined, NOW, { storefrontUrl: STOREFRONT_URL });
    expect(result.ok).toBe(true);
    const markup = sent[0].replyMarkup;
    expect(markup && 'keyboard' in markup ? markup.is_persistent : false).toBe(true);
    expect(replyRows(markup)).toContain('🛒 Mahsulotlar');
    const shopButton = markup && 'keyboard' in markup ? markup.keyboard[0][0] : null;
    expect(shopButton).toMatchObject({ web_app: { url: STOREFRONT_URL } });
  });
});

describe('catalog browsing', () => {
  it('lists categories then products with pagination state', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, sent, edited } = makeSender();

    await handle(stores, sender, msg('/katalog'), shop);
    expect(datas(sent[0].replyMarkup)).toEqual(['sf:cat:0', 'sf:cat:1']);

    await handle(stores, sender, cb('sf:cat:0'), shop);
    expect(edited[0].text).toContain('Ichimliklar');
    expect(datas(edited[0].replyMarkup)).toContain('sf:prd:0');
    const state = await stores.shop.get(CHAT_ID);
    expect(state?.products).toHaveLength(2);
    expect(state?.categorySlug).toBe('ichimliklar');
  });

  it('rejects out-of-range and unknown buttons as stale', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, answered } = makeSender();
    await handle(stores, sender, msg('/katalog'), shop);
    await handle(stores, sender, cb('sf:prd:9'), shop);
    await handle(stores, sender, cb('sf:nope:x'), shop);
    expect(answered[0].text).toContain('Eskirgan');
    expect(answered[1].text).toContain('Noma’lum');
  });

  it('rejects foreign presses (groups) without touching state', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, answered, edited } = makeSender();
    await handle(stores, sender, msg('/katalog'), shop);
    const result = await handle(stores, sender, cb('sf:cat:0', { fromId: 4242, chatId: -100, messageId: 99 }), shop);
    expect(result.action).toBe('shop-callback');
    expect(answered.map((item) => item.text).join(' ')).toContain('shaxsiy');
    expect(edited).toHaveLength(0);
  });
});

describe('ordering (simple product)', () => {
  it('places exactly one order end to end and notifies the admin', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop, calls } = makeShop();
    const { sender, sent, edited } = makeSender();

    await handle(stores, sender, msg('/katalog'), shop);
    await handle(stores, sender, cb('sf:cat:0'), shop);
    await handle(stores, sender, cb('sf:prd:0'), shop);
    expect(edited[1].text).toContain('Cola 1L');
    expect(edited[1].text).toContain('12 000');

    await handle(stores, sender, cb('sf:nvar'), shop);
    await handle(stores, sender, cb('sf:qty:2'), shop);
    await handle(stores, sender, cb('sf:del:courier'), shop);
    expect(sent[sent.length - 1].text).toContain('Manzilni yozing');
    expect(datas(sent[sent.length - 1].replyMarkup)).toContain('sf:addr:reg');

    await handle(stores, sender, cb('sf:addr:reg'), shop);
    const confirm = sent[sent.length - 1];
    expect(confirm.text).toContain('Cola 1L');
    expect(confirm.text).toContain('Ali Valiyev');
    expect(confirm.text).toContain(PHONE);

    const messageId = 50;
    await handle(stores, sender, cb('sf:ok', { messageId }), shop);
    expect(calls.orders).toHaveLength(1);
    expect(calls.orders[0]).toMatchObject({
      customer: { name: 'Ali Valiyev', phone: PHONE },
      delivery: { method: 'courier', address: 'Toshkent, Chilonzor 5' },
      items: [{ productId: 'p-simple', quantity: 2 }],
      attribution: { utmSource: 'telegram-bot' },
    });
    // Prices are display-only: never sent to ShopFlow.
    expect(JSON.stringify(calls.orders[0])).not.toContain('12000');
    expect(edited[edited.length - 1].text).toContain('ORD-7524');

    const adminMsg = sent.find((item) => item.chatId === Number(ADMIN_CHAT_ID));
    expect(adminMsg?.text).toContain('Yangi buyurtma');
    expect(adminMsg?.text).toContain('Ali Market');

    const logged = await stores.botOrders.listRecent(5);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ orderId: 'ord-1', company: 'Ali Market', productName: 'Cola 1L', quantity: 2, method: 'courier' });

    // Double-pressing confirm places no second order.
    await handle(stores, sender, cb('sf:ok', { messageId }), shop);
    expect(calls.orders).toHaveLength(1);
  });
});

describe('ordering (variants, custom qty, pickup)', () => {
  it('requires a variant, validates qty and skips address on pickup', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop, calls } = makeShop();
    const { sender, sent, answered, edited } = makeSender();

    await handle(stores, sender, msg('/katalog'), shop);
    await handle(stores, sender, cb('sf:cat:0'), shop);
    await handle(stores, sender, cb('sf:prd:1'), shop);
    expect(edited[1].text).toContain('Minimal buyurtma');

    await handle(stores, sender, cb('sf:var:1'), shop);
    const afterVar = await stores.shop.get(CHAT_ID);
    expect(afterVar?.selection).toMatchObject({ productId: 'p-var', variantId: 'v2', quantity: 1 });

    // Below MOQ via quick button → toast, quantity untouched.
    await handle(stores, sender, cb('sf:qty:2'), shop);
    expect(answered[answered.length - 1].text).toContain('Minimal buyurtma');
    expect((await stores.shop.get(CHAT_ID))?.selection?.quantity).toBe(1);

    // Custom qty: invalid → error; valid → delivery screen.
    await handle(stores, sender, cb('sf:qtyx'), shop);
    await handle(stores, sender, msg('abc'), shop);
    expect(sent[sent.length - 1].text).toContain('1 dan 999');
    await handle(stores, sender, msg('15'), shop);
    expect(sent[sent.length - 1].text).toContain('Yetkazish');

    await handle(stores, sender, cb('sf:del:pickup'), shop);
    await handle(stores, sender, cb('sf:addr:skip'), shop);
    expect(sent[sent.length - 1].text).toContain('Olib ketish');

    await handle(stores, sender, cb('sf:ok'), shop);
    expect(calls.orders[0]).toMatchObject({
      delivery: { method: 'pickup' },
      items: [{ productId: 'p-var', variantId: 'v2', quantity: 15 }],
    });
    expect(calls.orders[0].delivery.address).toBeUndefined();
  });
});

describe('ordering failures', () => {
  it('relays stock conflicts and keeps the cart for retry', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    let fail = true;
    const { shop, calls } = makeShop({
      order: async () => {
        if (fail) throw new ShopFlowApiError('Choy yetarli emas (mavjud: 3)', { status: 409, failure: 'conflict', retryable: false });
        return { orderId: 'ord-2', message: 'Buyurtma #ORD-7525 qabul qilindi' };
      },
    });
    const { sender, edited } = makeSender();

    await handle(stores, sender, msg('/katalog'), shop);
    await handle(stores, sender, cb('sf:cat:0'), shop);
    await handle(stores, sender, cb('sf:prd:0'), shop);
    await handle(stores, sender, cb('sf:nvar'), shop);
    await handle(stores, sender, cb('sf:qty:5'), shop);
    await handle(stores, sender, cb('sf:del:courier'), shop);
    await handle(stores, sender, cb('sf:addr:reg'), shop);
    await handle(stores, sender, cb('sf:ok'), shop);

    expect(edited[edited.length - 1].text).toContain('mavjud: 3');
    expect(datas(edited[edited.length - 1].replyMarkup)).toContain('sf:ok');
    expect((await stores.shop.get(CHAT_ID))?.step).toBe('confirm');

    fail = false;
    await handle(stores, sender, cb('sf:ok'), shop);
    expect(edited[edited.length - 1].text).toContain('ORD-7525');
    expect(calls.orders).toHaveLength(2);
  });

  it('alerts the admin on an unauthorized ShopFlow key', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop({
      order: async () => {
        throw new ShopFlowApiError('rejected', { status: 401, failure: 'unauthorized', retryable: false });
      },
    });
    const { sender, sent, edited } = makeSender();

    await handle(stores, sender, msg('/katalog'), shop);
    await handle(stores, sender, cb('sf:cat:0'), shop);
    await handle(stores, sender, cb('sf:prd:0'), shop);
    await handle(stores, sender, cb('sf:nvar'), shop);
    await handle(stores, sender, cb('sf:qty:1'), shop);
    await handle(stores, sender, cb('sf:del:pickup'), shop);
    await handle(stores, sender, cb('sf:addr:skip'), shop);
    await handle(stores, sender, cb('sf:ok'), shop);

    expect(edited[edited.length - 1].text).toContain('xatolik');
    const adminMsg = sent.find((item) => item.chatId === Number(ADMIN_CHAT_ID));
    expect(adminMsg?.text).toContain('401');
  });

  it('blocks ordering an out-of-stock product', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop, calls } = makeShop();
    const { sender, answered, edited } = makeSender();

    await handle(stores, sender, msg('/katalog'), shop);
    await handle(stores, sender, cb('sf:cat:1'), shop);
    await handle(stores, sender, cb('sf:prd:0'), shop);
    expect(edited[edited.length - 1].text).toContain('mavjud emas');
    expect(datas(edited[edited.length - 1].replyMarkup)).toEqual(['sf:back:list']);

    await handle(stores, sender, cb('sf:nvar'), shop);
    expect(answered[answered.length - 1].text).toContain('mavjud emas');
    expect(calls.orders).toHaveLength(0);
  });
});

describe('promotions and misc', () => {
  it('shows live promotions in /dastur when configured', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender, sent } = makeSender();
    await handle(stores, sender, msg('/dastur'), shop);
    expect(sent[0].text).toContain('Faol aksiyalar');
    expect(sent[0].text).toContain('Bepul yetkazish');
  });

  it('keeps /dastur static without ShopFlow', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { sender, sent } = makeSender();
    await handle(stores, sender, msg('/dastur'), null);
    expect(sent[0].text).toContain('Sodiqlik darajalari');
    expect(sent[0].text).not.toContain('Faol aksiyalar');
  });

  it('/stop clears the shop state and commands win over text steps', async () => {
    const stores = createMemoryTelegramStores();
    await seedApproved(stores);
    const { shop } = makeShop();
    const { sender } = makeSender();
    await handle(stores, sender, msg('/katalog'), shop);
    expect(await stores.shop.get(CHAT_ID)).not.toBeNull();
    const result = await handle(stores, sender, msg('/stop'), shop);
    expect(result.action).toBe('stopped');
    expect(await stores.shop.get(CHAT_ID)).toBeNull();
  });
});
