import 'server-only';

import type { LoyaltyConfig } from '@/lib/domain/types';
import { getLoyaltySummaryForCustomer } from '@/lib/domain/loyalty';
import { getPortalNotifications, type PortalNotification } from '@/lib/domain/notifications';
import { getSalesOpportunities } from '@/lib/domain/opportunities';
import { IntegrationError } from '@/lib/providers/errors';
import type { MoySkladProvider } from '@/lib/providers/contracts';
import {
  buildFridayGreeting,
  buildTierGapMessage,
  buildOpportunityMessage,
  buildOrderStatusMessage,
} from './messages';
import { weekKeyInTimezone } from './schedule';
import type { TelegramChatId, TelegramInlineKeyboardMarkup, TelegramLocale, TelegramReplyMarkup } from './types';
import type { TelegramStores } from './stores';
import { isChatInactiveError, type TelegramClientLogger } from './client';

/**
 * Scheduled reminder dispatch: portal notifications → Telegram chats.
 *
 * Rules reuse the exact portal logic (`getPortalNotifications`, loyalty
 * summaries, opportunity rules), so Telegram texts always match the in-app
 * reminder center. Delivery is idempotent per chat via the delivery log and
 * skipped on later runs. Order status transitions therefore send exactly
 * once — a new status produces a new notification id.
 *
 * Safety: demo/mock provider data is NEVER delivered to real chats unless the
 * caller explicitly passes `allowMockDelivery` (automated tests with a fake
 * sender only). Every recipient receives only their own verified scope: a
 * client gets their own customer record, a manager only their assigned
 * customers.
 *
 * Cadence: Friday greetings fire once per Friday; order events fire once per
 * status; persistent conditions (near-tier gap, manager opportunities) repeat
 * at most once per calendar week while the condition holds. Terminal order
 * transitions (`Yetkazildi` / `Bekor qilindi`) are detected against a silent
 * per-order baseline so historical orders never trigger a message on link.
 */

export interface TelegramSender {
  sendMessage(chatId: TelegramChatId, text: string, options?: { replyMarkup?: TelegramReplyMarkup }): Promise<{ messageId: number }>;
  answerCallbackQuery(callbackQueryId: string, input?: { text?: string; showAlert?: boolean }): Promise<true>;
  editMessageText(
    chatId: TelegramChatId | string,
    messageId: number,
    text: string,
    options?: { replyMarkup?: TelegramInlineKeyboardMarkup | { inline_keyboard: [] } },
  ): Promise<true>;
}

export interface TelegramDispatchSummary {
  subscriptions: number;
  attempted: number;
  sent: number;
  skippedAlreadySent: number;
  failed: number;
  deactivatedInactiveChats: number;
}

export interface TelegramDispatchInput {
  now?: Date;
  config: LoyaltyConfig;
  provider: MoySkladProvider;
  /** Must be 'live' for real delivery; 'mock' is refused unless allowMockDelivery. */
  dataMode: 'mock' | 'live';
  allowMockDelivery?: boolean;
  stores: TelegramStores;
  sender: TelegramSender;
  logger?: TelegramClientLogger;
  delayBetweenSendsMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export function deliveryKeyFor(chatId: TelegramChatId, notificationId: string): string {
  return `${chatId}:${notificationId}`;
}

/**
 * Idempotency key for a notification. Event-like items (Friday, order status)
 * keep their exact portal id; persistent weekly conditions collapse to one
 * key per calendar week so a daily scheduler cannot spam the chat.
 */
export function dedupeKeyFor(chatId: TelegramChatId, notification: PortalNotification, now: Date, timezone: string): string {
  if (notification.kind === 'NEAR_NEXT_TIER') {
    const [, , customerId, tierId] = notification.id.split(':');
    if (customerId && tierId) return `${chatId}:tier-gap-weekly:${weekKeyInTimezone(now, timezone)}:${customerId}:${tierId}`;
  }
  if (notification.kind === 'SALES_OPPORTUNITY') {
    const [, , customerId, type] = notification.id.split(':');
    if (customerId && type) return `${chatId}:sales-weekly:${weekKeyInTimezone(now, timezone)}:${customerId}:${type}`;
  }
  return deliveryKeyFor(chatId, notification.id);
}

const noopLogger: TelegramClientLogger = { info() {}, warn() {}, error() {} };
const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export async function dispatchTelegramReminders(input: TelegramDispatchInput): Promise<TelegramDispatchSummary> {
  const now = input.now ?? new Date();
  const logger = input.logger ?? noopLogger;
  const sleep = input.sleep ?? defaultSleep;
  const delayBetweenSendsMs = input.delayBetweenSendsMs ?? 0;

  if (input.dataMode !== 'live' && !input.allowMockDelivery) {
    throw new IntegrationError(
      'UNCONFIGURED',
      'Refusing to deliver demo/mock records to Telegram. Real delivery requires the live provider mode.',
    );
  }

  const summary: TelegramDispatchSummary = {
    subscriptions: 0,
    attempted: 0,
    sent: 0,
    skippedAlreadySent: 0,
    failed: 0,
    deactivatedInactiveChats: 0,
  };

  const [customers, orders] = await Promise.all([input.provider.getCustomers(), input.provider.getOrders()]);
  const subscriptions = await input.stores.subscriptions.listActive();
  summary.subscriptions = subscriptions.length;

  for (const subscription of subscriptions) {
    const locale: TelegramLocale = subscription.locale === 'ru' ? 'ru' : 'uz';
    let notifications: PortalNotification[] = [];
    let clientCustomerId: string | undefined;

    if (subscription.role === 'CLIENT') {
      if (!subscription.customerId) {
        logger.warn(`telegram.dispatch skipping chat ${subscription.chatId}: client subscription has no verified customer mapping`);
        continue;
      }
      const customer = customers.find((item) => item.id === subscription.customerId);
      if (!customer) {
        logger.warn(`telegram.dispatch skipping chat ${subscription.chatId}: verified customer is no longer available`);
        continue;
      }
      clientCustomerId = customer.id;
      notifications = getPortalNotifications({ role: 'CLIENT', customer, customers, orders, config: input.config, now })
        .filter((item) => item.kind === 'FRIDAY_GREETING' || item.kind === 'NEAR_NEXT_TIER' || item.kind === 'ORDER_UPDATE');
    } else {
      const scope = subscription.role === 'ADMIN'
        ? customers
        : customers.filter((customer) => subscription.managerCustomerIds?.includes(customer.id));
      if (scope.length === 0) {
        logger.warn(`telegram.dispatch skipping chat ${subscription.chatId}: manager has no customers in scope`);
        continue;
      }
      notifications = getPortalNotifications({ role: 'SALES_MANAGER', customer: scope[0], customers: scope, orders, config: input.config, now })
        .filter((item) => item.kind === 'SALES_OPPORTUNITY');
    }

    let chatDeactivated = false;
    const sendOnce = async (key: string, notificationId: string, text: string): Promise<void> => {
      if (chatDeactivated) return;
      if (await input.stores.deliveryLog.has(key)) {
        summary.skippedAlreadySent += 1;
        return;
      }
      summary.attempted += 1;
      if (delayBetweenSendsMs > 0 && summary.attempted > 1) await sleep(delayBetweenSendsMs);
      try {
        const result = await input.sender.sendMessage(subscription.chatId, text);
        await input.stores.deliveryLog.record({
          key,
          chatId: subscription.chatId,
          notificationId,
          sentAt: now.toISOString(),
          telegramMessageId: result.messageId,
        });
        summary.sent += 1;
      } catch (error) {
        if (isChatInactiveError(error)) {
          await input.stores.subscriptions.setActive(subscription.chatId, false);
          summary.deactivatedInactiveChats += 1;
          chatDeactivated = true;
          logger.info(`telegram.dispatch deactivated unreachable chat ${subscription.chatId}`);
          return;
        }
        summary.failed += 1;
        logger.error(`telegram.dispatch failed for chat ${subscription.chatId} notification ${notificationId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    };

    const sentBefore = summary.sent;
    for (const notification of notifications) {
      const key = dedupeKeyFor(subscription.chatId, notification, now, input.config.timezone);
      const text = renderNotificationText(notification, { customers, orders, locale, config: input.config, customerId: subscription.customerId, now });
      if (!text) {
        logger.warn(`telegram.dispatch skipping notification ${notification.id}: source record unavailable`);
        continue;
      }
      await sendOnce(key, notification.id, text);
    }

    // Terminal order transitions are not part of the portal's active-order
    // reminders, so they are tracked separately against a silent baseline:
    // the first sighting of an order only records the baseline (historical
    // delivered orders stay silent), later transitions to a terminal status
    // send exactly one message.
    if (clientCustomerId && !chatDeactivated) {
      const customerOrders = orders.filter((order) => order.customerId === clientCustomerId);
      for (const order of customerOrders) {
        const baselineKey = deliveryKeyFor(subscription.chatId, `order-baseline:${order.id}`);
        const hadBaseline = await input.stores.deliveryLog.has(baselineKey);
        if (!hadBaseline) {
          await input.stores.deliveryLog.record({ key: baselineKey, chatId: subscription.chatId, notificationId: baselineKey, sentAt: now.toISOString() });
          if (order.status === 'Yetkazildi' || order.status === 'Bekor qilindi') {
            const seenKey = deliveryKeyFor(subscription.chatId, `order-terminal:${order.id}:${order.status}`);
            await input.stores.deliveryLog.record({ key: seenKey, chatId: subscription.chatId, notificationId: seenKey, sentAt: now.toISOString() });
          }
          continue;
        }
        if (order.status !== 'Yetkazildi' && order.status !== 'Bekor qilindi') continue;
        const seenKey = deliveryKeyFor(subscription.chatId, `order-terminal:${order.id}:${order.status}`);
        await sendOnce(seenKey, seenKey, buildOrderStatusMessage(locale, { orderId: order.id, status: order.status, boxes: order.boxes, total: order.total }));
      }
    }

    if (summary.sent > sentBefore) {
      try {
        await input.stores.subscriptions.save({ ...subscription, lastReminderAt: now.toISOString() });
      } catch (error) {
        logger.warn(`telegram.dispatch could not update lastReminderAt for chat ${subscription.chatId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }

  logger.info(`telegram.dispatch done: ${summary.sent} sent, ${summary.skippedAlreadySent} already sent, ${summary.failed} failed (${summary.subscriptions} subscriptions)`);
  return summary;
}

interface RenderContext {
  customers: Awaited<ReturnType<MoySkladProvider['getCustomers']>>;
  orders: Awaited<ReturnType<MoySkladProvider['getOrders']>>;
  locale: TelegramLocale;
  config: LoyaltyConfig;
  customerId?: string;
  now: Date;
}

/**
 * Renders a portal notification with the same source values the portal used.
 * Returns null when the underlying record disappeared (fail-silent for that
 * single item, never fabricated).
 */
function renderNotificationText(notification: PortalNotification, context: RenderContext): string | null {
  if (notification.kind === 'FRIDAY_GREETING') {
    const customer = context.customers.find((item) => item.id === context.customerId);
    if (!customer) return null;
    return buildFridayGreeting(context.locale, customer.name);
  }
  if (notification.kind === 'NEAR_NEXT_TIER') {
    const customer = context.customers.find((item) => item.id === context.customerId);
    if (!customer) return null;
    const summary = getLoyaltySummaryForCustomer(customer, context.config);
    if (!summary.nextTier) return null;
    return buildTierGapMessage(context.locale, {
      currentValue: summary.currentValue,
      remaining: summary.remaining,
      nextTierName: summary.nextTier.name,
      discountPercent: summary.nextTier.discountPercent,
      metric: summary.metric,
    });
  }
  if (notification.kind === 'ORDER_UPDATE') {
    const orderId = notification.id.split(':')[1];
    const order = context.orders.find((item) => item.id === orderId && item.customerId === context.customerId);
    if (!order) return null;
    return buildOrderStatusMessage(context.locale, { orderId: order.id, status: order.status, boxes: order.boxes, total: order.total });
  }
  if (notification.kind === 'SALES_OPPORTUNITY') {
    const [, , customerId, type] = notification.id.split(':');
    const opportunity = getSalesOpportunities(context.customers, context.config, context.now).find(
      (item) => item.customer.id === customerId && item.type === type,
    );
    if (!opportunity) return null;
    return buildOpportunityMessage(context.locale, { companyName: opportunity.customer.name, headline: opportunity.headline, action: opportunity.action });
  }
  return null;
}
