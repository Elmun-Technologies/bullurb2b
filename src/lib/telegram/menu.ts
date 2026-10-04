import 'server-only';

import { DEFAULT_LOYALTY_CONFIG } from '@/lib/domain/loyalty';
import type { ShopFlowPromotion } from '@/lib/shopflow/types';
import {
  answerCallbackToast,
  buildDeniedToast,
  buildPrivateOnlyToast,
  editBotScreen,
  getShopAccess,
  type ShopContext,
} from './catalog';
import {
  buildHelpMessage,
  buildProfileMessage,
  buildProgramMessage,
  buildWelcomeMessage,
  truncateTelegramText,
} from './messages';
import type { TelegramIncomingCallbackQuery, TelegramInlineKeyboardMarkup, TelegramLocale } from './types';

/**
 * Main menu: a few clear inline buttons instead of slash commands.
 *
 * Approved chats get the menu on `/start`, `/menu` and attached to the
 * approval message: shop (Mini App `web_app` button, button-catalog
 * fallback), points + discounts, profile, help. The menu is stateless —
 * every press re-resolves access and data, so stale buttons are impossible
 * and nothing is cached.
 *
 * Slash commands keep working as a fallback for old clients and the
 * BotFather command list.
 */

function t(locale: TelegramLocale, uz: string, ru: string): string {
  return locale === 'ru' ? ru : uz;
}

export function buildMainMenuMessage(locale: TelegramLocale, company: string | null): string {
  if (company?.trim()) {
    return truncateTelegramText(t(locale, `Xush kelibsiz, ${company.trim()}! ✅\n\n🏠 Asosiy menyu:`, `С возвращением, ${company.trim()}! ✅\n\n🏠 Главное меню:`));
  }
  return truncateTelegramText(t(locale, '🏠 Asosiy menyu:\n\nTanlang:', '🏠 Главное меню:\n\nВыберите:'));
}

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

/** Sends the main menu (callers must check `getShopAccess` first). */
export async function sendMainMenu(context: ShopContext, chatId: number, locale: TelegramLocale, company: string | null): Promise<void> {
  await context.sender.sendMessage(chatId, buildMainMenuMessage(locale, company), {
    replyMarkup: buildMainMenuKeyboard(locale, context.storefrontUrl),
  });
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
      await editBotScreen(context.sender, query.chatId, query.messageId, buildProgramMessage(locale, tiers, promotions), buildMenuBackKeyboard(locale));
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
