import 'server-only';

import { normalizeUzPhone } from '@/lib/moysklad/phone';
import type { MoySkladCounterparty, MoySkladCounterpartyCreate } from '@/lib/moysklad/types';
import type { MoySkladFindResult } from '@/lib/moysklad/client';
import {
  buildAddressInvalidMessage,
  buildAmbiguousClientMessage,
  buildApplicationSubmittedMessage,
  buildAskAddressMessage,
  buildAskCompanyMessage,
  buildAskLocationMessage,
  buildAskNameMessage,
  buildAskPhoneMessage,
  buildClientFoundMessage,
  buildCompanyInvalidMessage,
  buildContactInvalidMessage,
  buildAdminNewApplicationMessage,
  buildNameInvalidMessage,
  buildPilotAskCompanyMessage,
  buildPilotAskNameMessage,
  buildPilotAskPhoneMessage,
  buildRegisteredMessage,
  buildServiceUnavailableMessage,
  buildShareLocationKeyboard,
  buildSharePhoneKeyboard,
  buildSkipLocationLabel,
  REMOVE_KEYBOARD,
} from './messages';
import type { TelegramSender } from './dispatcher';
import type { TelegramStores } from './stores';
import type { TelegramChatId, TelegramIncomingContact, TelegramLocale } from './types';
import type { TelegramClientLogger } from './client';

/**
 * MoySklad-backed phone onboarding for Telegram chats.
 *
 * Flow: `/start` (unlinked) → bot asks for a contact-share → the shared
 * number is ownership-checked (`contact.user_id` must equal the sender) →
 * MoySklad lookup by phone → found: link + show data; not found: collect
 * name + shop name → create the counterparty → link.
 *
 * Security notes:
 * - Manually typed phone numbers are NEVER accepted for linking: anyone
 *   could type someone else's number and receive their data. Only a
 *   contact-share owned by the sender (`user_id` match) counts as proof.
 * - Ambiguous matches (several counterparties, one phone) never auto-link;
 *   the user is routed to their manager.
 * - Raw phone numbers travel only: Telegram → server → MoySklad. They are
 *   stored solely as part of the subscription record needed for delivery.
 */

export interface CounterpartyDirectory {
  findByPhone(phoneE164: string): Promise<MoySkladFindResult>;
  createCounterparty(input: MoySkladCounterpartyCreate): Promise<MoySkladCounterparty>;
}

export type OnboardingAction =
  | 'awaiting-contact'
  | 'awaiting-name'
  | 'awaiting-company'
  | 'linked'
  | 'ambiguous'
  | 'service-unavailable';

export interface OnboardingContext {
  stores: TelegramStores;
  sender: TelegramSender;
  directory: CounterpartyDirectory;
  now: Date;
  logger: TelegramClientLogger;
}

const noopLogger: TelegramClientLogger = { info() {}, warn() {}, error() {} };

export function createOnboardingContext(input: {
  stores: TelegramStores;
  sender: TelegramSender;
  directory: CounterpartyDirectory;
  now?: Date;
  logger?: TelegramClientLogger;
}): OnboardingContext {
  return { stores: input.stores, sender: input.sender, directory: input.directory, now: input.now ?? new Date(), logger: input.logger ?? noopLogger };
}

/** Starts onboarding: remembers the dialog and asks for a contact share. */
export async function beginPhoneOnboarding(context: OnboardingContext, chatId: TelegramChatId, locale: TelegramLocale = 'uz'): Promise<OnboardingAction> {
  await context.stores.dialogs.save({ chatId, step: 'awaiting-contact', updatedAt: context.now.toISOString() });
  await context.sender.sendMessage(chatId, buildAskPhoneMessage(locale), { replyMarkup: buildSharePhoneKeyboard(locale) });
  return 'awaiting-contact';
}

/** Re-asks for the contact share (invalid/spoofed contact, typed text). */
export async function reaskPhoneOnboarding(context: OnboardingContext, chatId: TelegramChatId, locale: TelegramLocale = 'uz'): Promise<OnboardingAction> {
  await context.stores.dialogs.save({ chatId, step: 'awaiting-contact', updatedAt: context.now.toISOString() });
  await context.sender.sendMessage(chatId, buildContactInvalidMessage(locale), { replyMarkup: buildSharePhoneKeyboard(locale) });
  return 'awaiting-contact';
}

function validFreeText(value: string, min: number, max: number): string | null {
  const trimmed = value.trim().replace(/\s+/gu, ' ');
  // eslint-disable-next-line no-control-regex
  if (trimmed.length < min || trimmed.length > max || /[\u0000-\u001F\u007F]/u.test(trimmed)) return null;
  return trimmed;
}

async function linkChat(
  context: OnboardingContext,
  chatId: TelegramChatId,
  counterparty: MoySkladCounterparty,
  locale: TelegramLocale,
): Promise<void> {
  await context.stores.subscriptions.save({
    chatId,
    subjectId: `moysklad:${counterparty.id}`,
    role: 'CLIENT',
    customerId: counterparty.id,
    locale,
    active: true,
    linkedAt: context.now.toISOString(),
  });
  await context.stores.dialogs.clear(chatId);
  context.logger.info(`telegram.onboarding linked chat ${chatId} to counterparty ${counterparty.id}`);
}

/**
 * Handles a shared contact: ownership check → MoySklad lookup →
 * link / registration / manager routing.
 */
export async function handleSharedContact(
  context: OnboardingContext,
  input: { chatId: TelegramChatId; contact: TelegramIncomingContact; fromId?: number; locale?: TelegramLocale },
): Promise<OnboardingAction> {
  const locale = input.locale ?? 'uz';
  const owned = input.fromId !== undefined && input.contact.userId !== undefined && input.contact.userId === input.fromId;
  const phone = normalizeUzPhone(input.contact.phoneNumber);
  if (!owned || !phone) {
    context.logger.info(`telegram.onboarding rejected contact for chat ${input.chatId} (ownership or format check failed)`);
    return reaskPhoneOnboarding(context, input.chatId, locale);
  }

  let found: MoySkladFindResult;
  try {
    found = await context.directory.findByPhone(phone);
  } catch (error) {
    context.logger.error(`telegram.onboarding lookup failed for chat ${input.chatId}: ${error instanceof Error ? error.message : 'unknown error'}`);
    await context.sender.sendMessage(input.chatId, buildServiceUnavailableMessage(locale));
    return 'service-unavailable';
  }

  if (found.status === 'ambiguous') {
    await context.sender.sendMessage(input.chatId, buildAmbiguousClientMessage(locale), { replyMarkup: REMOVE_KEYBOARD });
    await context.stores.dialogs.clear(input.chatId);
    return 'ambiguous';
  }
  if (found.status === 'found') {
    await linkChat(context, input.chatId, found.counterparty, locale);
    await context.sender.sendMessage(
      input.chatId,
      buildClientFoundMessage(locale, { name: found.counterparty.name, phone, code: found.counterparty.code }),
      { replyMarkup: REMOVE_KEYBOARD },
    );
    return 'linked';
  }

  await context.stores.dialogs.save({ chatId: input.chatId, step: 'awaiting-name', phone, updatedAt: context.now.toISOString() });
  await context.sender.sendMessage(input.chatId, buildAskNameMessage(locale, phone), { replyMarkup: REMOVE_KEYBOARD });
  return 'awaiting-name';
}

/**
 * Handles free-text replies during registration (name → company →
 * counterparty creation → link).
 */
export async function handleDialogText(
  context: OnboardingContext,
  input: { chatId: TelegramChatId; text: string; locale?: TelegramLocale },
): Promise<OnboardingAction> {
  const locale = input.locale ?? 'uz';
  const dialog = await context.stores.dialogs.get(input.chatId);
  if (!dialog) return reaskPhoneOnboarding(context, input.chatId, locale);

  if (dialog.step === 'awaiting-contact') {
    // Typed numbers are not proof of ownership — require the share button.
    return reaskPhoneOnboarding(context, input.chatId, locale);
  }

  if (dialog.step === 'awaiting-name') {
    const name = validFreeText(input.text, 2, 100);
    if (!name) {
      await context.sender.sendMessage(input.chatId, buildNameInvalidMessage(locale));
      return 'awaiting-name';
    }
    await context.stores.dialogs.save({ chatId: input.chatId, step: 'awaiting-company', phone: dialog.phone, name, updatedAt: context.now.toISOString() });
    await context.sender.sendMessage(input.chatId, buildAskCompanyMessage(locale, name));
    return 'awaiting-company';
  }

  // awaiting-company
  const company = validFreeText(input.text, 2, 120);
  if (!company) {
    await context.sender.sendMessage(input.chatId, buildCompanyInvalidMessage(locale));
    return 'awaiting-company';
  }
  const phone = dialog.phone ?? '';
  try {
    const created = await context.directory.createCounterparty({
      name: company,
      phone,
      description: `Telegram bot orqali ro'yxatdan o'tdi. Mas'ul: ${dialog.name ?? '—'}. Chat: ${input.chatId}.`,
    });
    await linkChat(context, input.chatId, created, locale);
    await context.sender.sendMessage(input.chatId, buildRegisteredMessage(locale, { company: created.name, phone }), { replyMarkup: REMOVE_KEYBOARD });
    return 'linked';
  } catch (error) {
    context.logger.error(`telegram.onboarding registration failed for chat ${input.chatId}: ${error instanceof Error ? error.message : 'unknown error'}`);
    await context.sender.sendMessage(input.chatId, buildServiceUnavailableMessage(locale));
    return 'service-unavailable';
  }
}

/* ------------------------------------------------------------------ */
/* Pilot mode: phone onboarding WITHOUT MoySklad (2–3 day client test).   */
/*                                                                     */
/* No company data is invented: the bot collects the ownership-verified */
/* phone, echoes it back honestly as "test mode", and stores a pilot    */
/* subscription (no customerId → dispatcher skips it, nothing fake is   */
/* ever sent). When the MoySklad token appears, the next /start upgrades */
/* the pilot binding via a real lookup (linkExistingPhone).             */
/* ------------------------------------------------------------------ */

export type PilotAction =
  | 'awaiting-contact'
  | 'awaiting-name'
  | 'awaiting-company'
  | 'awaiting-address'
  | 'awaiting-location'
  | 'application-submitted';

export interface PilotContext {
  stores: TelegramStores;
  sender: TelegramSender;
  now: Date;
  logger: TelegramClientLogger;
  /** Optional admin chat id for new-application notifications. */
  adminChatId: string | null;
}

export function createPilotContext(input: {
  stores: TelegramStores;
  sender: TelegramSender;
  now?: Date;
  logger?: TelegramClientLogger;
  adminChatId?: string | null;
}): PilotContext {
  return {
    stores: input.stores,
    sender: input.sender,
    now: input.now ?? new Date(),
    logger: input.logger ?? noopLogger,
    adminChatId: input.adminChatId ?? null,
  };
}

export async function beginPilotOnboarding(context: PilotContext, chatId: TelegramChatId, locale: TelegramLocale = 'uz'): Promise<'awaiting-contact'> {
  await context.stores.dialogs.save({ chatId, step: 'awaiting-contact', updatedAt: context.now.toISOString() });
  await context.sender.sendMessage(chatId, buildPilotAskPhoneMessage(locale), { replyMarkup: buildSharePhoneKeyboard(locale) });
  return 'awaiting-contact';
}

export async function reaskPilotOnboarding(context: PilotContext, chatId: TelegramChatId, locale: TelegramLocale = 'uz'): Promise<'awaiting-contact'> {
  await context.stores.dialogs.save({ chatId, step: 'awaiting-contact', updatedAt: context.now.toISOString() });
  await context.sender.sendMessage(chatId, buildContactInvalidMessage(locale), { replyMarkup: buildSharePhoneKeyboard(locale) });
  return 'awaiting-contact';
}

export async function handlePilotContact(
  context: PilotContext,
  input: { chatId: TelegramChatId; contact: TelegramIncomingContact; fromId?: number; locale?: TelegramLocale },
): Promise<PilotAction> {
  const locale = input.locale ?? 'uz';
  const owned = input.fromId !== undefined && input.contact.userId !== undefined && input.contact.userId === input.fromId;
  const phone = normalizeUzPhone(input.contact.phoneNumber);
  if (!owned || !phone) {
    context.logger.info(`telegram.pilot rejected contact for chat ${input.chatId} (ownership or format check failed)`);
    return reaskPilotOnboarding(context, input.chatId, locale);
  }
  await context.stores.dialogs.save({ chatId: input.chatId, step: 'awaiting-name', phone, updatedAt: context.now.toISOString() });
  await context.sender.sendMessage(input.chatId, buildPilotAskNameMessage(locale), { replyMarkup: REMOVE_KEYBOARD });
  return 'awaiting-name';
}

/** Free-text steps of the pilot registration: name → company → address → location. */
export async function handlePilotDialogText(
  context: PilotContext,
  input: { chatId: TelegramChatId; text: string; locale?: TelegramLocale },
): Promise<PilotAction> {
  const locale = input.locale ?? 'uz';
  const dialog = await context.stores.dialogs.get(input.chatId);
  if (!dialog || dialog.step === 'awaiting-contact') return reaskPilotOnboarding(context, input.chatId, locale);

  if (dialog.step === 'awaiting-name') {
    const name = validFreeText(input.text, 2, 100);
    if (!name) {
      await context.sender.sendMessage(input.chatId, buildNameInvalidMessage(locale));
      return 'awaiting-name';
    }
    await context.stores.dialogs.save({ chatId: input.chatId, step: 'awaiting-company', phone: dialog.phone, name, updatedAt: context.now.toISOString() });
    await context.sender.sendMessage(input.chatId, buildPilotAskCompanyMessage(locale, name));
    return 'awaiting-company';
  }

  if (dialog.step === 'awaiting-company') {
    const company = validFreeText(input.text, 2, 120);
    if (!company) {
      await context.sender.sendMessage(input.chatId, buildCompanyInvalidMessage(locale));
      return 'awaiting-company';
    }
    await context.stores.dialogs.save({ chatId: input.chatId, step: 'awaiting-address', phone: dialog.phone, name: dialog.name, company, updatedAt: context.now.toISOString() });
    await context.sender.sendMessage(input.chatId, buildAskAddressMessage(locale, company));
    return 'awaiting-address';
  }

  if (dialog.step === 'awaiting-address') {
    const address = validFreeText(input.text, 5, 300);
    if (!address) {
      await context.sender.sendMessage(input.chatId, buildAddressInvalidMessage(locale));
      return 'awaiting-address';
    }
    await context.stores.dialogs.save({ chatId: input.chatId, step: 'awaiting-location', phone: dialog.phone, name: dialog.name, company: dialog.company, address, updatedAt: context.now.toISOString() });
    await context.sender.sendMessage(input.chatId, buildAskLocationMessage(locale), { replyMarkup: buildShareLocationKeyboard(locale) });
    return 'awaiting-location';
  }

  // awaiting-location: only the skip button text is accepted as text.
  const skipLabels = [buildSkipLocationLabel('uz'), buildSkipLocationLabel('ru')];
  if (skipLabels.includes(input.text.trim())) {
    return submitPilotApplication(context, { chatId: input.chatId, locale });
  }
  await context.sender.sendMessage(input.chatId, buildAskLocationMessage(locale), { replyMarkup: buildShareLocationKeyboard(locale) });
  return 'awaiting-location';
}

export async function handlePilotLocation(
  context: PilotContext,
  input: { chatId: TelegramChatId; latitude: number; longitude: number; locale?: TelegramLocale },
): Promise<PilotAction> {
  const locale = input.locale ?? 'uz';
  const dialog = await context.stores.dialogs.get(input.chatId);
  if (!dialog || dialog.step !== 'awaiting-location') return reaskPilotOnboarding(context, input.chatId, locale);
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) || Math.abs(input.latitude) > 90 || Math.abs(input.longitude) > 180) {
    await context.sender.sendMessage(input.chatId, buildAskLocationMessage(locale), { replyMarkup: buildShareLocationKeyboard(locale) });
    return 'awaiting-location';
  }
  return submitPilotApplication(context, { chatId: input.chatId, locale, location: { latitude: input.latitude, longitude: input.longitude } });
}

async function submitPilotApplication(
  context: PilotContext,
  input: { chatId: TelegramChatId; locale: TelegramLocale; location?: { latitude: number; longitude: number } },
): Promise<PilotAction> {
  const dialog = await context.stores.dialogs.get(input.chatId);
  const phone = dialog?.phone ?? '';
  const name = dialog?.name ?? '';
  const company = dialog?.company ?? '';
  const address = dialog?.address ?? '';
  if (!phone || !name || !company || !address) {
    return reaskPilotOnboarding(context, input.chatId, input.locale);
  }
  const timestamp = context.now.toISOString();
  await context.stores.applications.save({
    chatId: input.chatId,
    phone,
    name,
    company,
    address,
    ...(input.location ? { location: input.location } : {}),
    status: 'pending',
    locale: input.locale,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await context.stores.subscriptions.save({
    chatId: input.chatId,
    subjectId: `pilot-phone:${phone}`,
    role: 'CLIENT',
    phone,
    locale: input.locale,
    active: true,
    linkedAt: timestamp,
  });
  await context.stores.dialogs.clear(input.chatId);
  context.logger.info(`telegram.pilot submitted application for chat ${input.chatId} (pending admin review)`);
  await context.sender.sendMessage(input.chatId, buildApplicationSubmittedMessage(input.locale, company), { replyMarkup: REMOVE_KEYBOARD });
  if (context.adminChatId) {
    try {
      await context.sender.sendMessage(
        Number(context.adminChatId),
        buildAdminNewApplicationMessage({ chatId: input.chatId, phone, name, company, address, ...(input.location ? { location: input.location } : {}) }),
      );
    } catch (error) {
      context.logger.warn(`telegram.pilot admin notification failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  return 'application-submitted';
}

/**
 * Upgrades a pilot binding once MoySklad is available: real lookup by the
 * stored (ownership-verified) phone → link, register, or route to manager.
 * The pilot subscription is kept when the lookup is ambiguous or fails.
 */
export async function linkExistingPhone(
  context: OnboardingContext,
  input: { chatId: TelegramChatId; phone: string; locale?: TelegramLocale },
): Promise<OnboardingAction> {
  const locale = input.locale ?? 'uz';
  let found: MoySkladFindResult;
  try {
    found = await context.directory.findByPhone(input.phone);
  } catch (error) {
    context.logger.error(`telegram.onboarding upgrade lookup failed for chat ${input.chatId}: ${error instanceof Error ? error.message : 'unknown error'}`);
    await context.sender.sendMessage(input.chatId, buildServiceUnavailableMessage(locale));
    return 'service-unavailable';
  }
  if (found.status === 'ambiguous') {
    await context.sender.sendMessage(input.chatId, buildAmbiguousClientMessage(locale), { replyMarkup: REMOVE_KEYBOARD });
    return 'ambiguous';
  }
  if (found.status === 'found') {
    await linkChat(context, input.chatId, found.counterparty, locale);
    await context.sender.sendMessage(
      input.chatId,
      buildClientFoundMessage(locale, { name: found.counterparty.name, phone: input.phone, code: found.counterparty.code }),
      { replyMarkup: REMOVE_KEYBOARD },
    );
    return 'linked';
  }
  await context.stores.dialogs.save({ chatId: input.chatId, step: 'awaiting-name', phone: input.phone, updatedAt: context.now.toISOString() });
  await context.sender.sendMessage(input.chatId, buildAskNameMessage(locale, input.phone), { replyMarkup: REMOVE_KEYBOARD });
  return 'awaiting-name';
}
