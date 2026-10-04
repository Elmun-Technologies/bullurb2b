import 'server-only';

import { ShopFlowApiError } from '@/lib/shopflow/client';
import type {
  ShopFlowCategory,
  ShopFlowLocale,
  ShopFlowOrderRequest,
  ShopFlowProduct,
  ShopFlowProductList,
  ShopFlowProductQuery,
  ShopFlowPromotion,
} from '@/lib/shopflow/types';
import type { TelegramSender } from './dispatcher';
import { truncateTelegramText } from './messages';
import type { TelegramStores } from './stores';
import type {
  TelegramIncomingCallbackQuery,
  TelegramInlineKeyboardMarkup,
  TelegramLocale,
  TelegramRegistrationApplication,
  TelegramShopState,
  TelegramSubscription,
} from './types';
import type { TelegramClientLogger } from './client';

/**
 * In-bot ShopFlow catalog + ordering (Path A — Public API v1).
 *
 * Approved clients browse categories → products → variants, then place an
 * order without leaving the chat: name/phone come from the verified
 * registration application, delivery + address are collected in-flow, and
 * ShopFlow recomputes all prices server-side (displayed prices are never
 * sent back — see the integration guide §3.6).
 *
 * Rules:
 * - Fail-closed: without ShopFlow configuration the bot honestly says the
 *   catalog is coming soon — no demo products are ever shown as live.
 * - Browsing/ordering require an approved application (or a MoySklad-linked
 *   binding); pending/rejected chats get an honest status message instead.
 * - Inline buttons carry short `sf:<action>:<index>` payloads (≤64 bytes);
 *   real ids live in the per-chat shop state and are revalidated on every
 *   press, so stale/forwarded buttons can never order the wrong item.
 * - Double-pressing confirm places exactly one order (`placing`/`placed`
 *   guards); stock conflicts relay ShopFlow's message and keep the cart.
 */

export interface CatalogBackend {
  categories(locale: ShopFlowLocale): Promise<ShopFlowCategory[]>;
  products(query: ShopFlowProductQuery): Promise<ShopFlowProductList>;
  product(slugOrId: string, locale: ShopFlowLocale): Promise<ShopFlowProduct>;
  promotions(): Promise<ShopFlowPromotion[]>;
  createOrder(body: ShopFlowOrderRequest): Promise<{ orderId: string; message: string }>;
}

export interface ShopContext {
  stores: TelegramStores;
  sender: TelegramSender;
  /** Null when ShopFlow is not configured — catalog stays honest, not fake. */
  shop: CatalogBackend | null;
  /** Mini App storefront URL; when set, /katalog opens it instead of buttons. */
  storefrontUrl: string | null;
  adminChatId: string | null;
  now: Date;
  logger: TelegramClientLogger;
}

export type ShopAccess =
  | { allowed: true; application: TelegramRegistrationApplication | null; subscription: TelegramSubscription | null }
  | { allowed: false; reason: 'register' | 'pending' | 'rejected'; application: TelegramRegistrationApplication | null; subscription: TelegramSubscription | null };

export async function getShopAccess(stores: TelegramStores, chatId: number): Promise<ShopAccess> {
  const [subscription, application] = await Promise.all([stores.subscriptions.getByChatId(chatId), stores.applications.getByChatId(chatId)]);
  if (application?.status === 'approved' || subscription?.customerId) {
    return { allowed: true, application, subscription };
  }
  if (application?.status === 'pending') return { allowed: false, reason: 'pending', application, subscription };
  if (application?.status === 'rejected') return { allowed: false, reason: 'rejected', application, subscription };
  return { allowed: false, reason: 'register', application, subscription };
}

const SHOP_PAGE_SIZE = 5;
const MAX_QTY = 999;

function t(locale: TelegramLocale, uz: string, ru: string): string {
  return locale === 'ru' ? ru : uz;
}

function formatMoney(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/gu, ' ');
}

function money(locale: TelegramLocale, value: number): string {
  return `${formatMoney(value)} ${locale === 'ru' ? 'сум' : 'so‘m'}`;
}

function short(text: string, max = 38): string {
  const normalized = text.trim().replace(/\s+/gu, ' ');
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
}

function toastTooLong(text: string): string {
  return text.length <= 200 ? text : `${text.slice(0, 199)}…`;
}

function keyboard(rows: { text: string; data: string }[][]): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: rows.map((row) => row.map((button) => ({ text: button.text, callback_data: button.data }))) };
}

const EMPTY_KEYBOARD: { inline_keyboard: [] } = { inline_keyboard: [] };

function parseIndex(raw: string | undefined): number | null {
  if (!raw || !/^\d{1,6}$/u.test(raw)) return null;
  return Number(raw);
}

/* ------------------------------ message texts ------------------------------ */

function buildStorefrontMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    t(
      locale,
      '🛒 Do‘konni ochish uchun bosing — mahsulotlar, savat va buyurtma ilova ichida:',
      '🛒 Нажмите, чтобы открыть магазин — товары, корзина и заказ внутри приложения:',
    ),
  );
}

function storefrontKeyboard(locale: TelegramLocale, url: string): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [{ text: t(locale, '🛒 Do‘konni ochish', '🛒 Открыть магазин'), web_app: { url } }],
      [{ text: t(locale, '📋 Tugmali katalog', '📋 Кнопочный каталог'), callback_data: 'sf:cats' }],
    ],
  };
}

function buildCatalogSoonMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    t(
      locale,
      '🛒 Katalog tez orada!\n\nMahsulotlar bazasi hali ulanmagan — ulangan zahoti shu yerda ko‘rasiz.\n/help — yordam.',
      '🛒 Каталог скоро!\n\nБаза товаров ещё не подключена — как только подключим, увидите её здесь.\n/help — помощь.',
    ),
  );
}

function buildStaleToast(locale: TelegramLocale): string {
  return t(locale, 'Eskirgan tugma — /katalog ni qayta bosing.', 'Кнопка устарела — нажмите /katalog заново.');
}

export function buildPrivateOnlyToast(locale: TelegramLocale): string {
  return t(locale, 'Faqat shaxsiy chatda ishlaydi.', 'Работает только в личном чате.');
}

export function buildDeniedToast(locale: TelegramLocale): string {
  return t(locale, 'Avval ro‘yxatdan o‘ting: /start', 'Сначала зарегистрируйтесь: /start');
}

function buildCategoriesMessage(locale: TelegramLocale, total: number): string {
  return truncateTelegramText(t(locale, `🛒 Kategoriyalar (${total} ta)\n\nTanlang:`, `🛒 Категории (${total})\n\nВыберите:`));
}

function buildCategoriesEmptyMessage(locale: TelegramLocale): string {
  return truncateTelegramText(t(locale, 'Hozircha kategoriyalar yo‘q. Keyinroq urinib ko‘ring.', 'Категорий пока нет. Попробуйте позже.'));
}

function buildCategoryEmptyMessage(locale: TelegramLocale, categoryName: string): string {
  return truncateTelegramText(
    t(locale, `📂 ${categoryName}\n\nBu kategoriyada mahsulot topilmadi.`, `📂 ${categoryName}\n\nВ этой категории товаров нет.`),
  );
}

function buildListMessage(locale: TelegramLocale, categoryName: string, page: number, pages: number, total: number): string {
  return truncateTelegramText(
    t(
      locale,
      `📂 ${categoryName}\n\n${total} ta mahsulot — sahifa ${page}/${pages}:`,
      `📂 ${categoryName}\n\nТоваров: ${total} — страница ${page}/${pages}:`,
    ),
  );
}

function unitLabel(locale: TelegramLocale, unit: ShopFlowProduct['unit'], fallback: string): string {
  if (unit === 'kg') return 'kg';
  if (unit === 'l') return 'l';
  if (unit === 'dona') return t(locale, 'dona', 'шт');
  return fallback;
}

function buildProductMessage(locale: TelegramLocale, product: ShopFlowProduct): string {
  const lines = [`🧃 ${product.name}`, '', `${t(locale, '💰 Narx', '💰 Цена')}: ${money(locale, product.price)}`];
  if (product.oldPrice !== undefined && product.oldPrice > product.price) {
    lines.push(`${t(locale, 'Eski narx', 'Старая цена')}: ${money(locale, product.oldPrice)} 🎉`);
  }
  lines.push(
    product.inStock
      ? t(locale, '📦 Mavjud: ha ✅', '📦 В наличии: да ✅')
      : t(locale, '📦 Mavjud: yo‘q ❌', '📦 В наличии: нет ❌'),
  );
  if (product.reviewCount > 0) lines.push(`⭐ ${product.rating} (${product.reviewCount})`);
  if (product.badges.length > 0) lines.push(`🏷 ${product.badges.join(', ')}`);
  if (product.moq !== null && product.moq > 1) {
    lines.push(`${t(locale, '📏 Minimal buyurtma', '📏 Минимальный заказ')}: ${product.moq} ${unitLabel(locale, product.unit, t(locale, 'dona', 'шт'))}`);
  }
  if (product.priceTiers.length > 0) {
    const tiers = [...product.priceTiers]
      .sort((a, b) => a.minQty - b.minQty)
      .map((tier) => `  • ${tier.minQty}+ → ${money(locale, tier.price)}`);
    lines.push(`${t(locale, '📉 Ulgurji narxlar', '📉 Оптовые цены')}:\n${tiers.join('\n')}`);
  }
  if (product.tagline.trim()) lines.push('', product.tagline.trim().slice(0, 300));
  if (!product.inStock) {
    lines.push('', t(locale, 'Bu mahsulot hozircha mavjud emas.', 'Этого товара сейчас нет в наличии.'));
  } else if (product.variants.length > 0) {
    lines.push('', t(locale, 'Variantni tanlang:', 'Выберите вариант:'));
  } else {
    lines.push('', t(locale, 'Buyurtma berish uchun bosing:', 'Нажмите, чтобы заказать:'));
  }
  return truncateTelegramText(lines.join('\n'));
}

function buildQtyMessage(locale: TelegramLocale, input: { name: string; variantName?: string; moq: number | null; unit: ShopFlowProduct['unit'] }): string {
  const variantLine = input.variantName ? `\n${t(locale, 'Variant', 'Вариант')}: ${input.variantName}` : '';
  const moqLine =
    input.moq !== null && input.moq > 1
      ? `\n${t(locale, 'Minimal', 'Минимум')}: ${input.moq} ${unitLabel(locale, input.unit, t(locale, 'dona', 'шт'))}`
      : '';
  return truncateTelegramText(
    t(locale, `🔢 Miqdorni tanlang:\n\n🧃 ${input.name}${variantLine}${moqLine}`, `🔢 Выберите количество:\n\n🧃 ${input.name}${variantLine}${moqLine}`),
  );
}

function buildQtyInvalidMessage(locale: TelegramLocale): string {
  return truncateTelegramText(t(locale, 'Iltimos, 1 dan 999 gacha butun son yozing.', 'Пожалуйста, напишите целое число от 1 до 999.'));
}

function buildQtyBelowMoqMessage(locale: TelegramLocale, moq: number, unit: ShopFlowProduct['unit']): string {
  return truncateTelegramText(
    t(
      locale,
      `Minimal buyurtma: ${moq} ${unitLabel(locale, unit, 'dona')}. Boshqa miqdor yozing.`,
      `Минимальный заказ: ${moq} ${unitLabel(locale, unit, 'шт')}. Напишите другое количество.`,
    ),
  );
}

function buildDeliveryMessage(locale: TelegramLocale): string {
  return truncateTelegramText(t(locale, '🚚 Yetkazish usulini tanlang:', '🚚 Выберите способ доставки:'));
}

function deliveryLabel(locale: TelegramLocale, method: 'courier' | 'pickup'): string {
  if (method === 'courier') return t(locale, '🚚 Kuryer', '🚚 Курьер');
  return t(locale, '🏠 Olib ketish', '🏠 Самовывоз');
}

function buildAddressMessage(locale: TelegramLocale, input: { method: 'courier' | 'pickup'; hasRegistered: boolean }): string {
  if (input.method === 'pickup') {
    return truncateTelegramText(
      t(locale, '📍 Olib ketish manzilini yozing yoki o‘tkazib yuboring:', '📍 Напишите адрес самовывоза или пропустите:'),
    );
  }
  const suffix = input.hasRegistered ? t(locale, '\n\nYoki ro‘yxatdagi manzilni ishlating:', '\n\nИли используйте адрес из регистрации:') : '';
  return truncateTelegramText(t(locale, `📍 Manzilni yozing (shahar, ko‘cha, bino):${suffix}`, `📍 Напишите адрес (город, улица, дом):${suffix}`));
}

function buildAddressInvalidMessage(locale: TelegramLocale): string {
  return truncateTelegramText(t(locale, 'Manzil juda qisqa. Iltimos, to‘liq yozing.', 'Адрес слишком короткий. Напишите, пожалуйста, полностью.'));
}

function buildAskOrderNameMessage(locale: TelegramLocale): string {
  return truncateTelegramText(t(locale, 'Ismingiz (buyurtma uchun)?', 'Ваше имя (для заказа)?'));
}

function buildOrderNameInvalidMessage(locale: TelegramLocale): string {
  return truncateTelegramText(t(locale, 'Ism juda qisqa. Iltimos, to‘liq yozing.', 'Имя слишком короткое. Напишите, пожалуйста, полностью.'));
}

function buildNoPhoneMessage(locale: TelegramLocale): string {
  return truncateTelegramText(
    t(locale, 'Telefon raqamingiz topilmadi. /start orqali qayta ulaning.', 'Номер телефона не найден. Переподключитесь через /start.'),
  );
}

function buildConfirmMessage(
  locale: TelegramLocale,
  input: { productName: string; variantName?: string; quantity: number; unit: string; method: 'courier' | 'pickup'; address?: string; name: string; phone: string },
): string {
  return truncateTelegramText(
    t(
      locale,
      `🧾 Buyurtmani tekshiring:\n\n🧃 ${input.productName}${input.variantName ? `\nVariant: ${input.variantName}` : ''}\n🔢 Miqdor: ${input.quantity} ${input.unit}\n${deliveryLabel(locale, input.method)}\n📍 Manzil: ${input.address?.trim() ? input.address.trim() : '—'}\n👤 Mijoz: ${input.name}\n📞 Telefon: ${input.phone}\n\nYakuniy narxlar serverda hisoblanadi.`,
      `🧾 Проверьте заказ:\n\n🧃 ${input.productName}${input.variantName ? `\nВариант: ${input.variantName}` : ''}\n🔢 Количество: ${input.quantity} ${input.unit}\n${deliveryLabel(locale, input.method)}\n📍 Адрес: ${input.address?.trim() ? input.address.trim() : '—'}\n👤 Клиент: ${input.name}\n📞 Телефон: ${input.phone}\n\nИтоговые цены считает сервер.`,
    ),
  );
}

function buildOrderSuccessMessage(locale: TelegramLocale, orderMessage: string): string {
  return truncateTelegramText(
    t(locale, `✅ ${orderMessage}\n\nMenejerimiz tez orada bog‘lanadi.`, `✅ ${orderMessage}\n\nНаш менеджер скоро свяжется с вами.`),
  );
}

function buildOrderFailedMessage(locale: TelegramLocale, detail?: string): string {
  const suffix = detail?.trim() ? `\n\n${detail.trim().slice(0, 500)}` : '';
  return truncateTelegramText(
    t(locale, `⚠️ Buyurtmani yuborishda xatolik.${suffix}\n\nQayta urinib ko‘ring.`, `⚠️ Ошибка отправки заказа.${suffix}\n\nПопробуйте ещё раз.`),
  );
}

function buildOrderCancelledMessage(locale: TelegramLocale): string {
  return truncateTelegramText(t(locale, '❌ Buyurtma bekor qilindi.', '❌ Заказ отменён.'));
}

function buildShopErrorMessage(locale: TelegramLocale): string {
  return truncateTelegramText(t(locale, '⚠️ Katalogda xatolik. Birozdan so‘ng qayta urinib ko‘ring.', '⚠️ Ошибка каталога. Попробуйте чуть позже.'));
}

function buildAdminOrderMessage(input: {
  orderMessage: string;
  company: string;
  name: string;
  phone: string;
  productName: string;
  variantName?: string;
  quantity: number;
  method: 'courier' | 'pickup';
  address?: string;
}): string {
  const variantLine = input.variantName ? ` (${input.variantName})` : '';
  return truncateTelegramText(
    `🛒 Yangi buyurtma (bot)!\n\n${input.orderMessage}\nDo‘kon: ${input.company}\nMijoz: ${input.name}\nTelefon: ${input.phone}\nMahsulot: ${input.productName}${variantLine} × ${input.quantity}\nYetkazish: ${input.method === 'courier' ? 'Kuryer' : 'Olib ketish'}\nManzil: ${input.address?.trim() ? input.address.trim() : '—'}`,
  );
}

/* ------------------------------ keyboards ------------------------------ */

function categoriesKeyboard(locale: TelegramLocale, categories: { slug: string; name: string }[]): TelegramInlineKeyboardMarkup {
  return keyboard(categories.map((category, index) => [{ text: short(category.name), data: `sf:cat:${index}` }]));
}

function listKeyboard(
  locale: TelegramLocale,
  input: { products: { name: string; price: number; inStock: boolean }[]; page: number; pages: number },
): TelegramInlineKeyboardMarkup {
  const rows = input.products.map((product, index) => {
    const label = product.inStock ? `${product.name} — ${formatMoney(product.price)}` : `❌ ${product.name}`;
    return [{ text: short(label), data: `sf:prd:${index}` }];
  });
  if (input.pages > 1) {
    const nav: { text: string; data: string }[] = [];
    if (input.page > 1) nav.push({ text: '⬅️', data: `sf:pg:${input.page - 1}` });
    nav.push({ text: `${input.page}/${input.pages}`, data: `sf:pg:${input.page}` });
    if (input.page < input.pages) nav.push({ text: '➡️', data: `sf:pg:${input.page + 1}` });
    rows.push(nav);
  }
  rows.push([{ text: t(locale, '⬅️ Kategoriyalar', '⬅️ Категории'), data: 'sf:cats' }]);
  return keyboard(rows);
}

function detailKeyboard(locale: TelegramLocale, product: ShopFlowProduct): TelegramInlineKeyboardMarkup {
  const rows: { text: string; data: string }[][] = [];
  if (product.inStock) {
    if (product.variants.length > 0) {
      for (const [index, variant] of product.variants.entries()) {
        rows.push([{ text: short(`${variant.name} — ${formatMoney(variant.price)}`), data: `sf:var:${index}` }]);
      }
    } else {
      rows.push([{ text: t(locale, '🛒 Buyurtma berish', '🛒 Заказать'), data: 'sf:nvar' }]);
    }
  }
  rows.push([{ text: t(locale, '⬅️ Mahsulotlar', '⬅️ Товары'), data: 'sf:back:list' }]);
  return keyboard(rows);
}

function qtyKeyboard(locale: TelegramLocale): TelegramInlineKeyboardMarkup {
  return keyboard([
    [
      { text: '1', data: 'sf:qty:1' },
      { text: '2', data: 'sf:qty:2' },
      { text: '5', data: 'sf:qty:5' },
      { text: '10', data: 'sf:qty:10' },
    ],
    [{ text: t(locale, '✏️ Boshqa miqdor', '✏️ Другое количество'), data: 'sf:qtyx' }],
    [{ text: t(locale, '⬅️ Mahsulot', '⬅️ Товар'), data: 'sf:back:prd' }],
  ]);
}

function deliveryKeyboard(locale: TelegramLocale): TelegramInlineKeyboardMarkup {
  return keyboard([
    [{ text: deliveryLabel(locale, 'courier'), data: 'sf:del:courier' }],
    [{ text: deliveryLabel(locale, 'pickup'), data: 'sf:del:pickup' }],
    [{ text: t(locale, '⬅️ Miqdor', '⬅️ Количество'), data: 'sf:back:qty' }],
  ]);
}

function addressKeyboard(locale: TelegramLocale, input: { method: 'courier' | 'pickup'; hasRegistered: boolean }): TelegramInlineKeyboardMarkup {
  const rows: { text: string; data: string }[][] = [];
  if (input.hasRegistered) rows.push([{ text: t(locale, '🏠 Ro‘yxatdagi manzil', '🏠 Адрес из регистрации'), data: 'sf:addr:reg' }]);
  if (input.method === 'pickup') rows.push([{ text: t(locale, '⏭ O‘tkazib yuborish', '⏭ Пропустить'), data: 'sf:addr:skip' }]);
  rows.push([{ text: t(locale, '⬅️ Yetkazish', '⬅️ Доставка'), data: 'sf:back:del' }]);
  return keyboard(rows);
}

function confirmKeyboard(locale: TelegramLocale): TelegramInlineKeyboardMarkup {
  return keyboard([
    [{ text: t(locale, '✅ Buyurtmani tasdiqlash', '✅ Подтвердить заказ'), data: 'sf:ok' }],
    [{ text: t(locale, '❌ Bekor qilish', '❌ Отмена'), data: 'sf:no' }],
  ]);
}

function retryKeyboard(locale: TelegramLocale): TelegramInlineKeyboardMarkup {
  return keyboard([
    [{ text: t(locale, '🔁 Qayta urinish', '🔁 Повторить'), data: 'sf:ok' }],
    [{ text: t(locale, '❌ Bekor qilish', '❌ Отмена'), data: 'sf:no' }],
  ]);
}

function backToCatalogKeyboard(locale: TelegramLocale): TelegramInlineKeyboardMarkup {
  return keyboard([[{ text: t(locale, '🛒 Katalog', '🛒 Каталог'), data: 'sf:cats' }]]);
}

/* ------------------------------ flow entry ------------------------------ */

function shopLocale(locale: TelegramLocale): ShopFlowLocale {
  return locale === 'ru' ? 'ru' : 'uz';
}

/** Shared callback answer: always clears the spinner, toasts when text given. */
export async function answerCallbackToast(sender: TelegramSender, queryId: string, text?: string): Promise<void> {
  try {
    await sender.answerCallbackQuery(queryId, text?.trim() ? { text: toastTooLong(text) } : {});
  } catch {
    // Best effort only — the spinner clears by itself.
  }
}

/** Shared in-place screen redraw (catalog + menu); false when Telegram rejects the edit. */
export async function editBotScreen(
  sender: TelegramSender,
  chatId: number,
  messageId: number,
  text: string,
  replyMarkup?: TelegramInlineKeyboardMarkup | { inline_keyboard: [] },
): Promise<boolean> {
  try {
    if (replyMarkup) await sender.editMessageText(chatId, messageId, text, { replyMarkup });
    else await sender.editMessageText(chatId, messageId, text);
    return true;
  } catch {
    return false;
  }
}

/** `/katalog` — access-checked by the caller; opens the Mini App store, the button catalog, or an honest fallback. */
export async function beginCatalog(context: ShopContext, chatId: number, locale: TelegramLocale): Promise<'catalog'> {
  if (context.storefrontUrl) {
    await context.sender.sendMessage(chatId, buildStorefrontMessage(locale), { replyMarkup: storefrontKeyboard(locale, context.storefrontUrl) });
    return 'catalog';
  }
  if (!context.shop) {
    await context.sender.sendMessage(chatId, buildCatalogSoonMessage(locale));
    return 'catalog';
  }
  try {
    const categories = await context.shop.categories(shopLocale(locale));
    if (categories.length === 0) {
      await context.sender.sendMessage(chatId, buildCategoriesEmptyMessage(locale));
      return 'catalog';
    }
    await context.stores.shop.save({
      chatId,
      step: 'browsing',
      categories: categories.map((category) => ({ slug: category.slug, name: category.name })),
      page: 1,
      total: 0,
      pageSize: SHOP_PAGE_SIZE,
      updatedAt: context.now.toISOString(),
    });
    await context.sender.sendMessage(chatId, buildCategoriesMessage(locale, categories.length), {
      replyMarkup: categoriesKeyboard(locale, categories),
    });
  } catch (error) {
    context.logger.warn(`telegram.shop categories failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    await context.sender.sendMessage(chatId, buildShopErrorMessage(locale));
  }
  return 'catalog';
}

/* ------------------------------ screens ------------------------------ */

async function renderCategories(
  context: ShopContext,
  chatId: number,
  messageId: number,
  locale: TelegramLocale,
  state: TelegramShopState,
): Promise<void> {
  if (!context.shop) {
    await editBotScreen(context.sender, chatId, messageId, buildCatalogSoonMessage(locale), EMPTY_KEYBOARD);
    return;
  }
  let categories = state.categories;
  if (!categories) {
    const fresh = await context.shop.categories(shopLocale(locale));
    categories = fresh.map((category) => ({ slug: category.slug, name: category.name }));
    await context.stores.shop.save({ ...state, step: 'browsing', categories, categorySlug: undefined, categoryName: undefined, products: undefined, selection: undefined, deliveryMethod: undefined, address: undefined, updatedAt: context.now.toISOString() });
  }
  if (categories.length === 0) {
    await editBotScreen(context.sender, chatId, messageId, buildCategoriesEmptyMessage(locale), EMPTY_KEYBOARD);
    return;
  }
  await editBotScreen(context.sender, chatId, messageId, buildCategoriesMessage(locale, categories.length), categoriesKeyboard(locale, categories));
}

async function renderList(
  context: ShopContext,
  chatId: number,
  messageId: number,
  locale: TelegramLocale,
  state: TelegramShopState,
  input: { categorySlug: string; categoryName: string; page: number },
): Promise<void> {
  if (!context.shop) return;
  const list = await context.shop.products({ locale: shopLocale(locale), category: input.categorySlug, page: input.page, pageSize: SHOP_PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(list.total / SHOP_PAGE_SIZE));
  const page = Math.min(Math.max(1, input.page), pages);
  const products =
    page === input.page
      ? list.items
      : (await context.shop.products({ locale: shopLocale(locale), category: input.categorySlug, page, pageSize: SHOP_PAGE_SIZE })).items;
  await context.stores.shop.save({
    ...state,
    step: 'browsing',
    categorySlug: input.categorySlug,
    categoryName: input.categoryName,
    products: products.map((item) => ({ id: item.id, slug: item.slug, name: item.name, price: item.price, ...(item.oldPrice !== undefined ? { oldPrice: item.oldPrice } : {}), inStock: item.inStock })),
    page,
    total: list.total,
    pageSize: SHOP_PAGE_SIZE,
    selection: undefined,
    deliveryMethod: undefined,
    address: undefined,
    updatedAt: context.now.toISOString(),
  });
  if (products.length === 0) {
    await editBotScreen(context.sender, chatId, messageId, buildCategoryEmptyMessage(locale, input.categoryName), backToCatalogKeyboard(locale));
    return;
  }
  const saved = (await context.stores.shop.get(chatId)) ?? state;
  await editBotScreen(
    context.sender,
    chatId,
    messageId,
    buildListMessage(locale, input.categoryName, page, pages, list.total),
    listKeyboard(locale, { products: saved.products ?? [], page, pages }),
  );
}

async function renderDetail(
  context: ShopContext,
  chatId: number,
  messageId: number,
  locale: TelegramLocale,
  state: TelegramShopState,
  productId: string,
): Promise<ShopFlowProduct | null> {
  if (!context.shop) return null;
  const product = await context.shop.product(productId, shopLocale(locale));
  await context.stores.shop.save({ ...state, viewedProductId: product.id, updatedAt: context.now.toISOString() });
  await editBotScreen(context.sender, chatId, messageId, buildProductMessage(locale, product), detailKeyboard(locale, product));
  return product;
}

async function renderQty(
  context: ShopContext,
  chatId: number,
  messageId: number,
  locale: TelegramLocale,
  state: TelegramShopState,
): Promise<void> {
  if (!context.shop || !state.selection) return;
  const product = await context.shop.product(state.selection.productId, shopLocale(locale));
  await editBotScreen(
    context.sender,
    chatId,
    messageId,
    buildQtyMessage(locale, { name: state.selection.name, ...(state.selection.variantName ? { variantName: state.selection.variantName } : {}), moq: product.moq, unit: product.unit }),
    qtyKeyboard(locale),
  );
}

/* ------------------------------ callbacks ------------------------------ */

export async function handleShopCallback(
  context: ShopContext,
  query: TelegramIncomingCallbackQuery,
  locale: TelegramLocale,
): Promise<'shop-callback'> {
  // Catalog buttons only work for the private-chat owner: in a private chat
  // the presser always equals the chat, anywhere else the press is foreign.
  if (query.fromId !== query.chatId) {
    await answerCallbackToast(context.sender, query.id, buildPrivateOnlyToast(locale));
    return 'shop-callback';
  }
  const access = await getShopAccess(context.stores, query.chatId);
  if (!access.allowed) {
    await answerCallbackToast(context.sender, query.id, buildDeniedToast(locale));
    return 'shop-callback';
  }
  if (!context.shop) {
    await answerCallbackToast(context.sender, query.id);
    await editBotScreen(context.sender, query.chatId, query.messageId, buildCatalogSoonMessage(locale), EMPTY_KEYBOARD);
    return 'shop-callback';
  }

  const parts = query.data.split(':');
  try {
    await routeShopCallback(context, query, locale, parts, access.application);
  } catch (error) {
    context.logger.warn(`telegram.shop callback failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    await answerCallbackToast(context.sender, query.id, t(locale, 'Xatolik, qayta urinib ko‘ring.', 'Ошибка, попробуйте ещё раз.'));
    return 'shop-callback';
  }
  return 'shop-callback';
}

async function stale(context: ShopContext, query: TelegramIncomingCallbackQuery, locale: TelegramLocale): Promise<void> {
  await answerCallbackToast(context.sender, query.id, buildStaleToast(locale));
}

async function routeShopCallback(
  context: ShopContext,
  query: TelegramIncomingCallbackQuery,
  locale: TelegramLocale,
  parts: string[],
  application: TelegramRegistrationApplication | null,
): Promise<void> {
  const chatId = query.chatId;
  const action = parts[1];
  const state = await context.stores.shop.get(chatId);

  if (action === 'cats') {
    await answerCallbackToast(context.sender, query.id);
    const base: TelegramShopState = state ?? { chatId, step: 'browsing', page: 1, total: 0, pageSize: SHOP_PAGE_SIZE, updatedAt: context.now.toISOString() };
    await renderCategories(context, chatId, query.messageId, locale, base);
    return;
  }

  if (!state) {
    await stale(context, query, locale);
    return;
  }

  if (action === 'cat') {
    const index = parseIndex(parts[2]);
    const category = index !== null ? state.categories?.[index] : undefined;
    if (!category) {
      await stale(context, query, locale);
      return;
    }
    await answerCallbackToast(context.sender, query.id);
    await renderList(context, chatId, query.messageId, locale, state, { categorySlug: category.slug, categoryName: category.name, page: 1 });
    return;
  }

  if (action === 'pg') {
    const page = parseIndex(parts[2]);
    if (!state.categorySlug || !state.categoryName || page === null) {
      await stale(context, query, locale);
      return;
    }
    await answerCallbackToast(context.sender, query.id);
    await renderList(context, chatId, query.messageId, locale, state, { categorySlug: state.categorySlug, categoryName: state.categoryName, page });
    return;
  }

  if (action === 'prd') {
    const index = parseIndex(parts[2]);
    const ref = index !== null ? state.products?.[index] : undefined;
    if (!ref) {
      await stale(context, query, locale);
      return;
    }
    await answerCallbackToast(context.sender, query.id);
    await renderDetail(context, chatId, query.messageId, locale, state, ref.id);
    return;
  }

  if (action === 'var' || action === 'nvar') {
    // Variant/order buttons always resolve the product shown on screen —
    // never a stale selection — and revalidate stock before continuing.
    const productId = state.viewedProductId;
    if (!productId || !context.shop) {
      await stale(context, query, locale);
      return;
    }
    const product = await context.shop.product(productId, shopLocale(locale));
    if (!product.inStock) {
      await answerCallbackToast(context.sender, query.id, t(locale, 'Mahsulot mavjud emas.', 'Товара нет в наличии.'));
      await renderDetail(context, chatId, query.messageId, locale, state, productId);
      return;
    }
    if (action === 'var') {
      const index = parseIndex(parts[2]);
      const variant = index !== null ? product.variants[index] : undefined;
      if (!variant || !variant.inStock) {
        await answerCallbackToast(context.sender, query.id, t(locale, 'Bu variant mavjud emas.', 'Этот вариант недоступен.'));
        await renderDetail(context, chatId, query.messageId, locale, state, productId);
        return;
      }
      await context.stores.shop.save({
        ...state,
        step: 'browsing',
        selection: { productId: product.id, slug: product.slug, name: product.name, unitPrice: variant.price, variantId: variant.id, variantName: variant.name, quantity: 1, unit: product.unit },
        updatedAt: context.now.toISOString(),
      });
    } else {
      if (product.variants.length > 0) {
        await stale(context, query, locale);
        return;
      }
      await context.stores.shop.save({
        ...state,
        step: 'browsing',
        selection: { productId: product.id, slug: product.slug, name: product.name, unitPrice: product.price, quantity: 1, unit: product.unit },
        updatedAt: context.now.toISOString(),
      });
    }
    await answerCallbackToast(context.sender, query.id);
    const saved = (await context.stores.shop.get(chatId)) ?? state;
    await renderQty(context, chatId, query.messageId, locale, saved);
    return;
  }

  if (action === 'qty') {
    if (!state.selection) {
      await stale(context, query, locale);
      return;
    }
    const qty = parseIndex(parts[2]);
    if (qty === null || qty < 1 || qty > MAX_QTY) {
      await stale(context, query, locale);
      return;
    }
    if (context.shop) {
      const product = await context.shop.product(state.selection.productId, shopLocale(locale));
      if (product.moq !== null && qty < product.moq) {
        await answerCallbackToast(context.sender, query.id, buildQtyBelowMoqMessage(locale, product.moq, product.unit));
        return;
      }
    }
    await context.stores.shop.save({ ...state, step: 'browsing', selection: { ...state.selection, quantity: qty }, updatedAt: context.now.toISOString() });
    await answerCallbackToast(context.sender, query.id);
    await editBotScreen(context.sender, chatId, query.messageId, buildDeliveryMessage(locale), deliveryKeyboard(locale));
    return;
  }

  if (action === 'qtyx') {
    if (!state.selection) {
      await stale(context, query, locale);
      return;
    }
    await context.stores.shop.save({ ...state, step: 'awaiting-qty', updatedAt: context.now.toISOString() });
    await answerCallbackToast(context.sender, query.id);
    await context.sender.sendMessage(chatId, t(locale, '🔢 Miqdorni yozing (1–999):', '🔢 Напишите количество (1–999):'));
    return;
  }

  if (action === 'del') {
    const method = parts[2];
    if (!state.selection || (method !== 'courier' && method !== 'pickup')) {
      await stale(context, query, locale);
      return;
    }
    await context.stores.shop.save({ ...state, step: 'awaiting-address', deliveryMethod: method, updatedAt: context.now.toISOString() });
    await answerCallbackToast(context.sender, query.id);
    await context.sender.sendMessage(chatId, buildAddressMessage(locale, { method, hasRegistered: !!application?.address.trim() }), {
      replyMarkup: addressKeyboard(locale, { method, hasRegistered: !!application?.address.trim() }),
    });
    return;
  }

  if (action === 'addr') {
    const mode = parts[2];
    if (!state.selection || !state.deliveryMethod || (mode !== 'reg' && mode !== 'skip')) {
      await stale(context, query, locale);
      return;
    }
    if (mode === 'skip' && state.deliveryMethod !== 'pickup') {
      await stale(context, query, locale);
      return;
    }
    const address = mode === 'reg' ? application?.address.trim() : undefined;
    if (mode === 'reg' && !address) {
      await stale(context, query, locale);
      return;
    }
    await answerCallbackToast(context.sender, query.id);
    await advanceToConfirm(context, chatId, query.messageId, locale, state, application, address);
    return;
  }

  if (action === 'ok') {
    await placeOrder(context, query, locale, state, application);
    return;
  }

  if (action === 'no') {
    await context.stores.shop.clear(chatId);
    await answerCallbackToast(context.sender, query.id);
    await editBotScreen(context.sender, chatId, query.messageId, buildOrderCancelledMessage(locale), EMPTY_KEYBOARD);
    return;
  }

  if (action === 'back') {
    await answerCallbackToast(context.sender, query.id);
    const where = parts[2];
    if (where === 'cats') {
      await renderCategories(context, chatId, query.messageId, locale, state);
      return;
    }
    if (where === 'list' && state.categorySlug && state.categoryName) {
      await renderList(context, chatId, query.messageId, locale, state, { categorySlug: state.categorySlug, categoryName: state.categoryName, page: state.page });
      return;
    }
    if (where === 'prd' && state.selection) {
      await renderDetail(context, chatId, query.messageId, locale, state, state.selection.productId);
      return;
    }
    if (where === 'qty' && state.selection) {
      const saved = (await context.stores.shop.get(chatId)) ?? state;
      await renderQty(context, chatId, query.messageId, locale, saved);
      return;
    }
    if (where === 'del' && state.selection) {
      await editBotScreen(context.sender, chatId, query.messageId, buildDeliveryMessage(locale), deliveryKeyboard(locale));
      return;
    }
    await stale(context, query, locale);
    return;
  }

  await answerCallbackToast(context.sender, query.id, t(locale, 'Noma’lum amal.', 'Неизвестное действие.'));
}

async function advanceToConfirm(
  context: ShopContext,
  chatId: number,
  messageId: number | null,
  locale: TelegramLocale,
  state: TelegramShopState,
  application: TelegramRegistrationApplication | null,
  address: string | undefined,
): Promise<void> {
  const selection = state.selection;
  const method = state.deliveryMethod;
  if (!selection || !method) return;
  const subscription = await context.stores.subscriptions.getByChatId(chatId);
  const phone = application?.phone ?? subscription?.phone;
  const name = application?.name ?? state.customerName;
  if (!phone) {
    const text = buildNoPhoneMessage(locale);
    if (messageId !== null) await editBotScreen(context.sender, chatId, messageId, text, EMPTY_KEYBOARD);
    else await context.sender.sendMessage(chatId, text);
    return;
  }
  if (!name?.trim()) {
    await context.stores.shop.save({ ...state, step: 'awaiting-name', ...(address !== undefined ? { address } : {}), updatedAt: context.now.toISOString() });
    await context.sender.sendMessage(chatId, buildAskOrderNameMessage(locale));
    return;
  }
  const next: TelegramShopState = {
    ...state,
    step: 'confirm',
    ...(address !== undefined ? { address } : {}),
    updatedAt: context.now.toISOString(),
  };
  await context.stores.shop.save(next);
  const confirmText = buildConfirmMessage(locale, {
    productName: selection.name,
    ...(selection.variantName ? { variantName: selection.variantName } : {}),
    quantity: selection.quantity,
    unit: unitLabel(locale, selection.unit ?? null, t(locale, 'dona', 'шт')),
    method,
    ...(address !== undefined ? { address } : {}),
    name: name.trim(),
    phone,
  });
  // The confirm screen is always a fresh message: the address step has no
  // stable message to edit (free text), and freshness beats chat tidiness.
  await context.sender.sendMessage(chatId, confirmText, { replyMarkup: confirmKeyboard(locale) });
}

async function placeOrder(
  context: ShopContext,
  query: TelegramIncomingCallbackQuery,
  locale: TelegramLocale,
  state: TelegramShopState,
  application: TelegramRegistrationApplication | null,
): Promise<void> {
  const chatId = query.chatId;
  if (state.step === 'placed') {
    await answerCallbackToast(context.sender, query.id, t(locale, 'Buyurtma allaqachon yuborilgan ✅', 'Заказ уже отправлен ✅'));
    return;
  }
  if (state.step === 'placing') {
    await answerCallbackToast(context.sender, query.id, t(locale, 'Buyurtma yuborilmoqda…', 'Заказ отправляется…'));
    return;
  }
  const selection = state.selection;
  const method = state.deliveryMethod;
  if (state.step !== 'confirm' || !selection || !method || !context.shop) {
    await stale(context, query, locale);
    return;
  }
  const subscription = await context.stores.subscriptions.getByChatId(chatId);
  const phone = application?.phone ?? subscription?.phone;
  const name = application?.name ?? state.customerName;
  if (!phone || !name?.trim()) {
    await stale(context, query, locale);
    return;
  }
  // Single-order guard: the flag is saved BEFORE the network call, so a
  // double-press always observes `placing` and places exactly one order.
  await context.stores.shop.save({ ...state, step: 'placing', updatedAt: context.now.toISOString() });
  await answerCallbackToast(context.sender, query.id, t(locale, 'Buyurtma yuborilmoqda…', 'Заказ отправляется…'));

  const orderBody: ShopFlowOrderRequest = {
    customer: { name: name.trim(), phone },
    delivery: { method, ...(state.address?.trim() ? { address: state.address.trim() } : {}) },
    items: [{ productId: selection.productId, ...(selection.variantId ? { variantId: selection.variantId } : {}), quantity: selection.quantity }],
    locale: shopLocale(locale),
    attribution: { utmSource: 'telegram-bot' },
  };
  try {
    const result = await context.shop.createOrder(orderBody);
    await context.stores.shop.save({ ...state, step: 'placed', orderId: result.orderId, orderMessage: result.message, updatedAt: context.now.toISOString() });
    try {
      await context.stores.botOrders.record({
        orderId: result.orderId,
        orderMessage: result.message,
        chatId,
        company: application?.company ?? '—',
        name: name.trim(),
        phone,
        productName: selection.name,
        ...(selection.variantName ? { variantName: selection.variantName } : {}),
        quantity: selection.quantity,
        method,
        ...(state.address?.trim() ? { address: state.address.trim() } : {}),
        createdAt: context.now.toISOString(),
      });
    } catch (error) {
      // Log-only: the order already exists at ShopFlow; the local log is ops-only.
      context.logger.warn(`telegram.shop order log failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    await editBotScreen(context.sender, chatId, query.messageId, buildOrderSuccessMessage(locale, result.message), backToCatalogKeyboard(locale));
    context.logger.info(`telegram.shop order placed for chat ${chatId}: ${result.orderId}`);
    await notifyAdminOfOrder(context, { application, name: name.trim(), phone, selection, method, address: state.address, orderMessage: result.message });
  } catch (error) {
    await context.stores.shop.save({ ...state, step: 'confirm', updatedAt: context.now.toISOString() });
    if (error instanceof ShopFlowApiError && error.options.failure === 'unauthorized') {
      context.logger.error('telegram.shop order failed: ShopFlow API key rejected (401) — check SHOPFLOW_API_KEY');
      await notifyAdminText(context, '⚠️ ShopFlow kalit xato (401). SHOPFLOW_API_KEY ni tekshiring.');
    } else {
      context.logger.warn(`telegram.shop order failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const detail = error instanceof ShopFlowApiError && (error.options.failure === 'conflict' || error.options.failure === 'validation') ? error.message : undefined;
    await editBotScreen(context.sender, chatId, query.messageId, buildOrderFailedMessage(locale, detail), retryKeyboard(locale));
  }
}

async function notifyAdminOfOrder(
  context: ShopContext,
  input: {
    application: TelegramRegistrationApplication | null;
    name: string;
    phone: string;
    selection: { name: string; variantName?: string; quantity: number };
    method: 'courier' | 'pickup';
    address?: string;
    orderMessage: string;
  },
): Promise<void> {
  await notifyAdminText(
    context,
    buildAdminOrderMessage({
      orderMessage: input.orderMessage,
      company: input.application?.company ?? '—',
      name: input.name,
      phone: input.phone,
      productName: input.selection.name,
      ...(input.selection.variantName ? { variantName: input.selection.variantName } : {}),
      quantity: input.selection.quantity,
      method: input.method,
      ...(input.address !== undefined ? { address: input.address } : {}),
    }),
  );
}

async function notifyAdminText(context: ShopContext, text: string): Promise<void> {
  if (!context.adminChatId) return;
  try {
    await context.sender.sendMessage(Number(context.adminChatId), text);
  } catch (error) {
    context.logger.warn(`telegram.shop admin notify failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/* ------------------------------ free text ------------------------------ */

export async function handleShopText(context: ShopContext, chatId: number, text: string, locale: TelegramLocale): Promise<'catalog'> {
  const state = await context.stores.shop.get(chatId);
  if (!state) return 'catalog';
  const access = await getShopAccess(context.stores, chatId);
  if (!access.allowed) {
    await context.sender.sendMessage(chatId, t(locale, 'Avval ro‘yxatdan o‘ting: /start', 'Сначала зарегистрируйтесь: /start'));
    return 'catalog';
  }

  if (state.step === 'awaiting-qty') {
    if (!state.selection || !context.shop) {
      await context.sender.sendMessage(chatId, buildShopErrorMessage(locale));
      return 'catalog';
    }
    const qty = /^\d{1,3}$/u.test(text.trim()) ? Number(text.trim()) : NaN;
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      await context.sender.sendMessage(chatId, buildQtyInvalidMessage(locale));
      return 'catalog';
    }
    try {
      const product = await context.shop.product(state.selection.productId, shopLocale(locale));
      if (product.moq !== null && qty < product.moq) {
        await context.sender.sendMessage(chatId, buildQtyBelowMoqMessage(locale, product.moq, product.unit));
        return 'catalog';
      }
    } catch (error) {
      context.logger.warn(`telegram.shop qty check failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      await context.sender.sendMessage(chatId, buildShopErrorMessage(locale));
      return 'catalog';
    }
    await context.stores.shop.save({ ...state, step: 'browsing', selection: { ...state.selection, quantity: qty }, updatedAt: context.now.toISOString() });
    await context.sender.sendMessage(chatId, buildDeliveryMessage(locale), { replyMarkup: deliveryKeyboard(locale) });
    return 'catalog';
  }

  if (state.step === 'awaiting-name') {
    const name = text.trim().replace(/\s+/gu, ' ');
    if (name.length < 2) {
      await context.sender.sendMessage(chatId, buildOrderNameInvalidMessage(locale));
      return 'catalog';
    }
    const next: TelegramShopState = { ...state, step: 'confirm', customerName: name.slice(0, 120), updatedAt: context.now.toISOString() };
    await context.stores.shop.save(next);
    const subscription = await context.stores.subscriptions.getByChatId(chatId);
    const phone = access.application?.phone ?? subscription?.phone ?? '';
    await context.sender.sendMessage(
      chatId,
      buildConfirmMessage(locale, {
        productName: next.selection?.name ?? '',
        ...(next.selection?.variantName ? { variantName: next.selection.variantName } : {}),
        quantity: next.selection?.quantity ?? 1,
        unit: unitLabel(locale, next.selection?.unit ?? null, t(locale, 'dona', 'шт')),
        method: next.deliveryMethod ?? 'courier',
        ...(next.address !== undefined ? { address: next.address } : {}),
        name,
        phone,
      }),
      { replyMarkup: confirmKeyboard(locale) },
    );
    return 'catalog';
  }

  if (state.step === 'awaiting-address') {
    const address = text.trim().replace(/\s+/gu, ' ');
    if (address.length < 5) {
      await context.sender.sendMessage(chatId, buildAddressInvalidMessage(locale));
      return 'catalog';
    }
    await advanceToConfirm(context, chatId, null, locale, state, access.application, address.slice(0, 500));
    return 'catalog';
  }

  return 'catalog';
}
