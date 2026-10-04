import type { Role } from '@/lib/domain/types';

/** Uzbek-first locales supported by Telegram reminder texts. */
export type TelegramLocale = 'uz' | 'ru';

/** Telegram chat identifiers are 64-bit integers; keep them numeric server-side. */
export type TelegramChatId = number;

/** How a Telegram chat is bound to a verified portal identity. */
export interface TelegramSubscription {
  chatId: TelegramChatId;
  /** Verified principal subject (Shopflow user id) that owns this binding. */
  subjectId: string;
  role: Role;
  /** Verified MoySklad customer id for CLIENT bindings. */
  customerId?: string;
  /** Ownership-verified E.164 phone for pilot bindings (no MoySklad yet). */
  phone?: string;
  /** Verified assigned customer ids snapshot for SALES_MANAGER bindings. */
  managerCustomerIds?: string[];
  locale: TelegramLocale;
  active: boolean;
  linkedAt: string;
  lastReminderAt?: string;
}

/** Short-lived single-use account-linking code issued to a verified principal. */
export interface PendingTelegramLink {
  /** SHA-256 hex digest of the raw code; the raw code is never persisted. */
  codeHash: string;
  subjectId: string;
  role: Role;
  customerId?: string;
  managerCustomerIds?: string[];
  locale: TelegramLocale;
  createdAt: number;
  expiresAt: number;
}

/** Idempotency record: portal notification id already delivered to a chat. */
export interface TelegramDeliveryRecord {
  /** Namespaced key: `${chatId}:${portalNotificationId}`. */
  key: string;
  chatId: TelegramChatId;
  notificationId: string;
  sentAt: string;
  telegramMessageId?: number;
}

export type TelegramIntegrationStatus = 'disabled' | 'unconfigured' | 'ready';

/** Minimal subset of the Bot API Update object used by this integration. */
export interface TelegramIncomingContact {
  phoneNumber: string;
  firstName?: string;
  /** Telegram user id the contact belongs to; verifies ownership of shared numbers. */
  userId?: number;
}

export interface TelegramIncomingLocation {
  latitude: number;
  longitude: number;
}

export interface TelegramIncomingMessage {
  messageId: number;
  chat: { id: number; type: string };
  from?: { id: number };
  text?: string;
  contact?: TelegramIncomingContact;
  location?: TelegramIncomingLocation;
}

export interface TelegramIncomingCallbackQuery {
  id: string;
  fromId: number;
  chatId: number;
  messageId: number;
  data: string;
}

export interface TelegramIncomingUpdate {
  updateId: number;
  message?: TelegramIncomingMessage;
  callbackQuery?: TelegramIncomingCallbackQuery;
}

export type TelegramCommand = 'start' | 'help' | 'stop' | 'profile' | 'program' | 'catalog' | 'unknown';

export interface ParsedTelegramCommand {
  command: TelegramCommand;
  /** Deep-link payload from `/start <payload>` (empty string when absent). */
  payload: string;
  rawText: string;
}

/** Reply keyboard (`request_contact`) and keyboard removal markups. */
export interface TelegramReplyKeyboardMarkup {
  keyboard: { text: string; request_contact?: boolean; request_location?: boolean }[][];
  resize_keyboard?: boolean;
  one_time_keyboard?: boolean;
}

export interface TelegramReplyKeyboardRemove {
  remove_keyboard: true;
}

/** Inline buttons under a message (callback_data comes back as callback_query). */
export interface TelegramInlineKeyboardButton {
  text: string;
  callback_data?: string;
  /** Plain URL button (opens outside Telegram). */
  url?: string;
  /** Mini App button (opens a Web App inside Telegram). */
  web_app?: { url: string };
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineKeyboardButton[][];
}

export type TelegramReplyMarkup = TelegramReplyKeyboardMarkup | TelegramReplyKeyboardRemove | TelegramInlineKeyboardMarkup;

/** Multi-step onboarding dialog state for MoySklad identification/registration. */
export type TelegramDialogStep = 'awaiting-contact' | 'awaiting-name' | 'awaiting-company' | 'awaiting-address' | 'awaiting-location';

export interface TelegramDialogState {
  chatId: TelegramChatId;
  step: TelegramDialogStep;
  /** Verified E.164 phone (set after an ownership-checked contact share). */
  phone?: string;
  /** Contact person name collected during registration. */
  name?: string;
  /** Shop/company name collected during registration. */
  company?: string;
  /** Shop address collected during registration. */
  address?: string;
  updatedAt: string;
}

/** In-bot ShopFlow catalog/order flow state (one active browser per chat). */
export type TelegramShopStep =
  | 'browsing'
  | 'awaiting-qty'
  | 'awaiting-name'
  | 'awaiting-address'
  | 'confirm'
  | 'placing'
  | 'placed';

export interface TelegramShopCategoryRef {
  slug: string;
  name: string;
}

export interface TelegramShopProductRef {
  id: string;
  slug: string;
  name: string;
  price: number;
  oldPrice?: number;
  inStock: boolean;
}

export interface TelegramShopSelection {
  productId: string;
  slug: string;
  name: string;
  /** Display-only unit price snapshot (ShopFlow recomputes totals server-side). */
  unitPrice: number;
  variantId?: string;
  variantName?: string;
  quantity: number;
  unit?: 'kg' | 'l' | 'dona' | null;
}

export interface TelegramShopState {
  chatId: TelegramChatId;
  step: TelegramShopStep;
  categories?: TelegramShopCategoryRef[];
  categorySlug?: string;
  categoryName?: string;
  products?: TelegramShopProductRef[];
  page: number;
  total: number;
  pageSize: number;
  /** Product id shown on the detail screen (variant buttons resolve via this). */
  viewedProductId?: string;
  selection?: TelegramShopSelection;
  /** Customer name fallback when no registration application exists. */
  customerName?: string;
  deliveryMethod?: 'courier' | 'pickup';
  address?: string;
  orderId?: string;
  orderMessage?: string;
  updatedAt: string;
}

/** Client registration application for admin approval (pilot mode). */
export type TelegramApplicationStatus = 'pending' | 'approved' | 'rejected';

export interface TelegramRegistrationApplication {
  chatId: TelegramChatId;
  phone: string;
  name: string;
  company: string;
  address: string;
  location?: TelegramIncomingLocation;
  status: TelegramApplicationStatus;
  locale: TelegramLocale;
  createdAt: string;
  updatedAt: string;
  decidedAt?: string;
  /** Rejection reason (admin input, echoed to the client). */
  reason?: string;
}
