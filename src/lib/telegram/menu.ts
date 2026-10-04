import 'server-only';

import { DEFAULT_LOYALTY_CONFIG } from '@/lib/domain/loyalty';
import type { ShopFlowPromotion } from '@/lib/shopflow/types';
import {
  answerCallbackToast,
  beginCatalog,
  buildDeniedToast,
  buildPrivateOnlyToast,
  editBotScreen,
  getShopAccess,
  type ShopAccess,
  type ShopContext,
} from './catalog';
import {
  buildApplicationPendingMessage,
  buildApplicationRejectedMessage,
  buildHelpMessage,
  buildProfileMessage,
  buildProgramMessage,
  buildWelcomeMessage,
  truncateTelegramText,
} from './messages';
import type {
  TelegramIncomingCallbackQuery,
  TelegramInlineKeyboardMarkup,
  TelegramLocale,
  TelegramReplyKeyboardMarkup,
} from './types';

/**
 * Main menu as Telegram's own persistent bottom keyboard (not inline).
 *
 * Approved chats get the keyboard on `/start`, `/menu` and attached to the
 * approval message: the shop button opens the Mini App store directly
 * (`web_app`), the rest send their label text back and are answered with the
 * matching screen. Old inline menus (`menu:*` callbacks) keep working for
 * already-sent messages.
 *
 * Slash commands keep working as a fallback for old clients and the
 * BotFather command list.
 */

function t(locale: TelegramLocale, uz: string, ru: string): string {
  return locale === 'ru' ? ru : uz;
}

export const MENU_LABELS: Record<TelegramLocale, { shop: string; points: string; profile: string; help: string }> = {
  uz: { shop: '🛒 Mahsulotlar', points: '⭐ Balim', profile: '👤 Profilim', help: 'ℹ️ Yordam' },
  ru: { shop: '🛒 Товары', points: '⭐ Баллы', profile: '👤 Мой профиль', help: 'ℹ️ Помощь' },
};

export type MenuTextAction = 'shop' | 'points' | 'profile' | 'help';

const LABEL_TO_ACTION = new Map<string, MenuTextAction>(
  (['uz', 'ru'] as const).flatMap((locale) => {
    const labels = MENU_LABELS[locale];
    return (Object.keys(labels) as MenuTextAction[]).map((action) => [labels[action], action] as const);
  }),
);

/** Matches a pressed bottom-menu button (exact label text, either locale). */
export function parseMenuButtonText(text: string): MenuTextAction | null {
  return LABEL_TO_ACTION.get(text.trim()) ?? null;
}

export function buildMainMenuMessage(locale: TelegramLocale, company: string | null): string {
  if (company?.trim()) {
    return truncateTelegramText(t(locale, `Xush kelibsiz, ${company.trim()}! ✅\n\nPastdagi menyudan tanlang:`, `С возвращением, ${company.trim()}! ✅\n\nВыберите в меню ниже:`));
  }
  return truncateTelegramText(t(locale, '🏠 Asosiy menyu — pastdagi tugmalar:', '🏠 Главное меню — кнопки ниже:'));
}

/** Persistent bottom keyboard; the shop button opens the Mini App directly. */
export function buildPersistentMenuKeyboard(locale: TelegramLocale, storefrontUrl: string | null): TelegramReplyKeyboardMarkup {
  const labels = MENU_LABELS[locale];
  return {
    keyboard: [
      [storefrontUrl ? { text: labels.shop, web_app: { url: storefrontUrl } } : { text: labels.shop }, { text: labels.points }],
      [{ text: labels.profile }, { text: labels.help }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  };
}

/** Sends the main menu (callers must check `getShopAccess` first). */
export async function sendMainMenu(context: ShopContext, chatId: number, locale: TelegramLocale, company: string | null): Promise<void> {
  await context.sender.sendMessage(chatId, buildMainMenuMessage(locale, company), {
    replyMarkup: buildPersistentMenuKeyboard(locale, context.storefrontUrl),
  });
}

async function replyDenied(context: ShopContext, chatId: number, locale: TelegramLocale, access: Extract<ShopAccess, { allowed: false }>): Promise<void> {
  if (access.reason === 'pending') {
    await context.sender.sendMessage(chatId, buildApplicationPendingMessage(locale, access.application?.company ?? ''));
    return;
  }
  if (access.reason === 'rejected') {
    await context.sender.sendMessage(chatId, buildApplicationRejectedMessage(locale));
    return;
  }
  await context.sender.sendMessage(chatId, t(locale, 'Avval ro‘yxatdan o‘ting: /start', 'Сначала зарегистрируйтесь: /start'));
}

async function programText(context: ShopContext, locale: TelegramLocale): Promise<string> {
  const tiers = DEFAULT_LOYALTY_CONFIG.tiers
    .filter((tier) => tier.active)
    .map((tier) => ({ name: tier.name, minValue: tier.minValue, discountPercent: tier.discountPercent }));
  let promotions: ShopFlowPromotion[] | undefined;
  if (context.shop) {
    try {
      promotions = await context.shop.promotions();
    } catch (error) {
      context.logger.warn(`telegram.menu promotions failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  return buildProgramMessage(locale, tiers, promotions);
}

/** Bottom-menu button press (plain label text). */
export async function handleMenuText(context: ShopContext, chatId: number, action: MenuTextAction, locale: TelegramLocale): Promise<'catalog'> {
  const access = await getShopAccess(context.stores, chatId);
  if (!access.allowed) {
    await replyDenied(context, chatId, locale, access);
    return 'catalog';
  }
  if (action === 'shop') {
    await beginCatalog(context, chatId, locale);
    return 'catalog';
  }
  if (action === 'points') {
    await context.sender.sendMessage(chatId, await programText(context, locale));
    return 'catalog';
  }
  if (action === 'profile') {
    const application = access.application;
    await context.sender.sendMessage(
      chatId,
      application
        ? buildProfileMessage(locale, {
            name: application.name,
            company: application.company,
            phone: application.phone,
            address: application.address,
            status: application.status,
            hasLocation: !!application.location,
          })
        : buildWelcomeMessage(locale, true),
    );
    return 'catalog';
  }
  await context.sender.sendMessage(chatId, buildHelpMessage(locale));
  return 'catalog';
}

/* ------------------------- legacy inline menu ------------------------- */
/* Already-sent inline menus keep working; new sends use the bottom keyboard. */

export function buildMainMenuKeyboard(locale: TelegramLocale, storefrontUrl: string | null): TelegramInlineKeyboardMarkup {
  const shopButton = storefrontUrl
    ? { text: t(locale, '🛒 Mahsulotlarni ko‘rish', '🛒 Смотреть товары'), web_app: { url: storefrontUrl } }
    : { text: t(locale, '🛒 Mahsulotlarni ko‘rish', '🛒 Смотреть товары'), callback_data: 'sf:cats' };
  return {
    inline_keyboard: [
      [shopButton],
      [{ text: t(locale, '⭐ Balim va chegirmalar', '⭐ Баллы и скидки'), callback_data: 'menu:points' }],
      [{ text: t(locale, '👤 Profilim', '👤 Мой профиль'), callback_data: 'menu:profile' }],
      [{ text: t(locale, 'ℹ️ Yordam', 'ℹ️ Помощь'), callback_data: 'menu:help' }],
    ],
  };
}

function buildMenuBackKeyboard(locale: TelegramLocale): TelegramInlineKeyboardMarkup {
  return { inline_keyboard: [[{ text: t(locale, '⬅️ Menyu', '⬅️ Меню'), callback_data: 'menu:main' }]] };
}

export async function handleMenuCallback(
  context: ShopContext,
  query: TelegramIncomingCallbackQuery,
  locale: TelegramLocale,
): Promise<'shop-callback'> {
  if (query.fromId !== query.chatId) {
    await answerCallbackToast(context.sender, query.id, buildPrivateOnlyToast(locale));
    return 'shop-callback';
  }
  const access = await getShopAccess(context.stores, query.chatId);
  if (!access.allowed) {
    await answerCallbackToast(context.sender, query.id, buildDeniedToast(locale));
    return 'shop-callback';
  }

  const action = query.data.split(':')[1];
  try {
    if (action === 'main') {
      await answerCallbackToast(context.sender, query.id);
      await editBotScreen(
        context.sender,
        query.chatId,
        query.messageId,
        buildMainMenuMessage(locale, access.application?.company ?? null),
        buildMainMenuKeyboard(locale, context.storefrontUrl),
      );
      return 'shop-callback';
    }
    if (action === 'points') {
      await answerCallbackToast(context.sender, query.id);
      await editBotScreen(context.sender, query.chatId, query.messageId, await programText(context, locale), buildMenuBackKeyboard(locale));
      return 'shop-callback';
    }
    if (action === 'profile') {
      await answerCallbackToast(context.sender, query.id);
      const application = access.application;
      const text = application
        ? buildProfileMessage(locale, {
            name: application.name,
            company: application.company,
            phone: application.phone,
            address: application.address,
            status: application.status,
            hasLocation: !!application.location,
          })
        : buildWelcomeMessage(locale, true);
      await editBotScreen(context.sender, query.chatId, query.messageId, text, buildMenuBackKeyboard(locale));
      return 'shop-callback';
    }
    if (action === 'help') {
      await answerCallbackToast(context.sender, query.id);
      await editBotScreen(context.sender, query.chatId, query.messageId, buildHelpMessage(locale), buildMenuBackKeyboard(locale));
      return 'shop-callback';
    }
    await answerCallbackToast(context.sender, query.id, t(locale, 'Noma’lum amal.', 'Неизвестное действие.'));
  } catch (error) {
    context.logger.warn(`telegram.menu callback failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    await answerCallbackToast(context.sender, query.id, t(locale, 'Xatolik, qayta urinib ko‘ring.', 'Ошибка, попробуйте ещё раз.'));
  }
  return 'shop-callback';
}
