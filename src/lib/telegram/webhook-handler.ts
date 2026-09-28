import 'server-only';

import { IntegrationError } from '@/lib/providers/errors';
import {
  buildApplicationApprovedMessage,
  buildApplicationPendingMessage,
  buildHelpMessage,
  buildInvalidCodeMessage,
  buildLinkSuccessMessage,
  buildPilotAskNameMessage,
  buildPilotStatusMessage,
  buildServiceUnavailableMessage,
  buildStopMessage,
  buildUnknownCommandMessage,
  buildWelcomeMessage,
  REMOVE_KEYBOARD,
} from './messages';
import { consumeLinkCode, isPlausibleLinkCode } from './linking';
import {
  beginPhoneOnboarding,
  beginPilotOnboarding,
  createOnboardingContext,
  createPilotContext,
  handleDialogText,
  handlePilotContact,
  handlePilotDialogText,
  handlePilotLocation,
  handleSharedContact,
  linkExistingPhone,
  type CounterpartyDirectory,
} from './onboarding';
import { parseTelegramCommand } from './webhook';
import type { TelegramSender } from './dispatcher';
import type { TelegramStores } from './stores';
import type { TelegramIncomingUpdate, TelegramLocale } from './types';
import { isChatInactiveError, type TelegramClientLogger } from './client';

/**
 * Handles an authenticated Telegram `message` update.
 *
 * Two linking methods (whichever is configured):
 * - MoySklad phone onboarding: `/start` → contact-share → lookup by phone →
 *   link, or name + shop registration when the client is new.
 * - Portal code linking: `/start <code>` with a one-time portal-issued code.
 * Plus `/start` (enable/status), `/stop` (unsubscribe), `/help`.
 *
 * Only private chats are served — group/channel messages are ignored so a
 * forwarding mistake can never bind or leak another customer's data.
 */

export type WebhookAction =
  | 'ignored'
  | 'linked'
  | 'invalid-code'
  | 'enabled'
  | 'welcome'
  | 'help'
  | 'stopped'
  | 'already-stopped'
  | 'unknown-command'
  | 'awaiting-contact'
  | 'awaiting-name'
  | 'awaiting-company'
  | 'awaiting-address'
  | 'awaiting-location'
  | 'application-submitted'
  | 'ambiguous'
  | 'service-unavailable';

export interface WebhookHandleResult {
  action: WebhookAction;
  chatId: number | null;
  replied: boolean;
}

export interface WebhookHandleInput {
  update: TelegramIncomingUpdate;
  stores: TelegramStores;
  sender: TelegramSender;
  botUsername: string | null;
  linkingSecret: string;
  /** MoySklad directory; when null, pilot registration + admin approval is used instead. */
  directory?: CounterpartyDirectory | null;
  /** Optional admin chat id for new-application notifications. */
  adminChatId?: string | null;
  now?: Date;
  logger?: TelegramClientLogger;
}

const noopLogger: TelegramClientLogger = { info() {}, warn() {}, error() {} };

export async function handleTelegramUpdate(input: WebhookHandleInput): Promise<WebhookHandleResult> {
  const logger = input.logger ?? noopLogger;
  const now = input.now ?? new Date();
  const message = input.update.message;

  if (!message || (!message.text && !message.contact && !message.location)) {
    return { action: 'ignored', chatId: message?.chat.id ?? null, replied: false };
  }
  if (message.chat.type !== 'private') {
    logger.info(`telegram.webhook ignoring non-private chat type=${message.chat.type}`);
    return { action: 'ignored', chatId: message.chat.id, replied: false };
  }

  const chatId = message.chat.id;
  const text = message.text;

  try {
    const existing = await input.stores.subscriptions.getByChatId(chatId);
    const locale: TelegramLocale = existing?.locale === 'ru' ? 'ru' : 'uz';
    const onboarding = input.directory
      ? createOnboardingContext({ stores: input.stores, sender: input.sender, directory: input.directory, now, logger })
      : null;
    const pilot = createPilotContext({ stores: input.stores, sender: input.sender, now, logger, adminChatId: input.adminChatId ?? null });

    // Contact shares (phone onboarding).
    if (message.contact) {
      if (existing) {
        try {
          await input.stores.dialogs.clear(chatId);
        } catch {
          // Best effort only.
        }
        if (existing.phone && !existing.customerId) {
          await input.sender.sendMessage(chatId, buildPilotStatusMessage(locale, existing.phone), { replyMarkup: REMOVE_KEYBOARD });
          return { action: 'enabled', chatId, replied: true };
        }
        await input.sender.sendMessage(chatId, buildWelcomeMessage(locale, true), { replyMarkup: REMOVE_KEYBOARD });
        return { action: 'enabled', chatId, replied: true };
      }
      if (!onboarding) {
        const action = await handlePilotContact(pilot, { chatId, contact: message.contact, fromId: message.from?.id, locale });
        return { action, chatId, replied: true };
      }
      const action = await handleSharedContact(onboarding, { chatId, contact: message.contact, fromId: message.from?.id, locale });
      return { action, chatId, replied: true };
    }

    // Location shares (pilot registration step).
    if (message.location && !message.text && !message.contact) {
      const dialog = await input.stores.dialogs.get(chatId);
      if (!existing && !onboarding && dialog?.step === 'awaiting-location') {
        const action = await handlePilotLocation(pilot, { chatId, latitude: message.location.latitude, longitude: message.location.longitude, locale });
        return { action, chatId, replied: true };
      }
      if (!existing && !onboarding) {
        const action = await beginPilotOnboarding(pilot, chatId, locale);
        return { action, chatId, replied: true };
      }
      return { action: 'ignored', chatId, replied: false };
    }

    const parsed = parseTelegramCommand(text ?? '', input.botUsername);

    // Registration dialog free-text steps take precedence over unknown text.
    // Pilot-linked chats (verified phone, no customer yet) stay in the dialog
    // flow so a MoySklad upgrade can finish registration in place.
    const inDialogFlow = !existing || (existing.phone !== undefined && !existing.customerId);
    if (parsed.command === 'unknown' && text && inDialogFlow) {
      const dialog = await input.stores.dialogs.get(chatId);
      if (dialog && !onboarding) {
        const action = await handlePilotDialogText(pilot, { chatId, text, locale });
        return { action, chatId, replied: true };
      }
      if (dialog && onboarding && dialog.step !== 'awaiting-contact') {
        const action = await handleDialogText(onboarding, { chatId, text, locale });
        return { action, chatId, replied: true };
      }
      if (dialog && dialog.step === 'awaiting-contact' && onboarding) {
        const action = await handleDialogText(onboarding, { chatId, text, locale });
        return { action, chatId, replied: true };
      }
    }

    if (parsed.command === 'unknown' && text && isPlausibleLinkCode(text)) {
      return linkChat(input, chatId, text.trim(), locale, locale, now, logger);
    }

    switch (parsed.command) {
      case 'start': {
        if (parsed.payload) {
          return linkChat(input, chatId, parsed.payload, locale, locale, now, logger);
        }
        if (existing) {
          await input.stores.subscriptions.setActive(chatId, true);
          const application = await input.stores.applications.getByChatId(chatId);
          if (existing.phone && !existing.customerId && onboarding) {
            const action = await linkExistingPhone(onboarding, { chatId, phone: existing.phone, locale });
            return { action, chatId, replied: true };
          }
          if (application?.status === 'pending' && !existing.customerId) {
            await input.sender.sendMessage(chatId, buildApplicationPendingMessage(locale, application.company));
            return { action: 'enabled', chatId, replied: true };
          }
          if (application?.status === 'rejected' && !existing.customerId && existing.phone) {
            await input.stores.dialogs.save({ chatId, step: 'awaiting-name', phone: existing.phone, updatedAt: now.toISOString() });
            await input.sender.sendMessage(chatId, buildPilotAskNameMessage(locale));
            return { action: 'awaiting-name', chatId, replied: true };
          }
          if (application?.status === 'approved' && !existing.customerId) {
            await input.sender.sendMessage(chatId, buildApplicationApprovedMessage(locale, application.company));
            return { action: 'enabled', chatId, replied: true };
          }
          if (existing.phone && !existing.customerId) {
            await input.sender.sendMessage(chatId, buildPilotStatusMessage(locale, existing.phone));
            return { action: 'enabled', chatId, replied: true };
          }
          await input.sender.sendMessage(chatId, buildWelcomeMessage(locale, true));
          return { action: 'enabled', chatId, replied: true };
        }
        if (onboarding) {
          const action = await beginPhoneOnboarding(onboarding, chatId, locale);
          return { action, chatId, replied: true };
        }
        const pilotAction = await beginPilotOnboarding(pilot, chatId, locale);
        return { action: pilotAction, chatId, replied: true };
      }
      case 'stop': {
        try {
          await input.stores.dialogs.clear(chatId);
        } catch {
          // Best effort: unsubscribing must work even if dialog cleanup fails.
        }
        if (existing?.active) {
          await input.stores.subscriptions.setActive(chatId, false);
          await input.sender.sendMessage(chatId, buildStopMessage(locale, true), { replyMarkup: REMOVE_KEYBOARD });
          return { action: 'stopped', chatId, replied: true };
        }
        await input.sender.sendMessage(chatId, buildStopMessage(locale, false), { replyMarkup: REMOVE_KEYBOARD });
        return { action: 'already-stopped', chatId, replied: true };
      }
      case 'help': {
        await input.sender.sendMessage(chatId, buildHelpMessage(locale));
        return { action: 'help', chatId, replied: true };
      }
      default: {
        if (existing) {
          await input.sender.sendMessage(chatId, buildUnknownCommandMessage(locale));
          return { action: 'unknown-command', chatId, replied: true };
        }
        if (onboarding) {
          const action = await beginPhoneOnboarding(onboarding, chatId, locale);
          return { action, chatId, replied: true };
        }
        const pilotAction = await beginPilotOnboarding(pilot, chatId, locale);
        return { action: pilotAction, chatId, replied: true };
      }
    }
  } catch (error) {
    if (isChatInactiveError(error)) {
      try {
        await input.stores.subscriptions.setActive(chatId, false);
      } catch {
        // Best effort: the chat is unreachable, nothing more to do.
      }
      return { action: 'ignored', chatId, replied: false };
    }
    if (error instanceof IntegrationError && error.failure === 'UNCONFIGURED') {
      logger.error(`telegram.webhook unavailable: ${error.message}`);
      await replyUnavailable(input, chatId);
      return { action: 'service-unavailable', chatId, replied: true };
    }
    logger.error(`telegram.webhook failed for chat ${chatId}: ${error instanceof Error ? error.message : 'unknown error'}`);
    await replyUnavailable(input, chatId);
    return { action: 'service-unavailable', chatId, replied: true };
  }
}

async function linkChat(
  input: WebhookHandleInput,
  chatId: number,
  code: string,
  replyLocale: TelegramLocale,
  fallbackLocale: TelegramLocale,
  now: Date,
  logger: TelegramClientLogger,
): Promise<WebhookHandleResult> {
  const pending = await consumeLinkCode({ code, stores: input.stores, linkingSecret: input.linkingSecret, nowMs: now.getTime() });
  if (!pending) {
    await input.sender.sendMessage(chatId, buildInvalidCodeMessage(replyLocale));
    return { action: 'invalid-code', chatId, replied: true };
  }
  const locale: TelegramLocale = pending.locale === 'ru' ? 'ru' : fallbackLocale;
  await input.stores.subscriptions.save({
    chatId,
    subjectId: pending.subjectId,
    role: pending.role,
    customerId: pending.customerId,
    managerCustomerIds: pending.managerCustomerIds,
    locale,
    active: true,
    linkedAt: now.toISOString(),
  });
  try {
    await input.stores.dialogs.clear(chatId);
  } catch {
    logger.warn(`telegram.webhook linked chat ${chatId} but could not clear its dialog state`);
  }
  logger.info(`telegram.webhook linked chat ${chatId} for role=${pending.role}`);
  await input.sender.sendMessage(chatId, buildLinkSuccessMessage(locale));
  return { action: 'linked', chatId, replied: true };
}

async function replyUnavailable(input: WebhookHandleInput, chatId: number): Promise<void> {
  try {
    await input.sender.sendMessage(chatId, buildServiceUnavailableMessage('uz'));
  } catch {
    // Best effort only; the route still returns 200 so Telegram stops retrying.
  }
}
