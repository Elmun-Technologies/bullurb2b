import 'server-only';

import { IntegrationError } from '@/lib/providers/errors';
import type { PendingTelegramLink, TelegramApplicationStatus, TelegramChatId, TelegramDeliveryRecord, TelegramDialogState, TelegramRegistrationApplication, TelegramSubscription } from './types';

/**
 * Durable storage boundary for Telegram subscriptions, linking codes and the
 * delivery (idempotency) log.
 *
 * Production requires durable Shopflow-backed implementations — exactly like
 * the loyalty settings store. Until those exist, the production selector
 * returns `unconfiguredTelegramStores`, which fail closed instead of losing
 * subscriptions or double-sending reminders.
 *
 * `createMemoryTelegramStores()` is ONLY for automated tests and local dry
 * runs with a fake sender. It must never back production delivery: it loses
 * all state on restart and cannot deduplicate across instances.
 */

export interface TelegramSubscriptionStore {
  getByChatId(chatId: TelegramChatId): Promise<TelegramSubscription | null>;
  listActive(): Promise<TelegramSubscription[]>;
  save(subscription: TelegramSubscription): Promise<void>;
  setActive(chatId: TelegramChatId, active: boolean): Promise<void>;
}

export interface TelegramDeliveryLog {
  has(key: string): Promise<boolean>;
  record(entry: TelegramDeliveryRecord): Promise<void>;
}

export interface TelegramLinkStore {
  /** Persists a pending link; the raw code itself is never stored. */
  savePending(link: PendingTelegramLink): Promise<void>;
  /**
   * Atomically consumes a pending link by code hash. Returns null when the
   * code is unknown, expired, or already used.
   */
  consume(codeHash: string, nowMs: number): Promise<PendingTelegramLink | null>;
}

export interface TelegramDialogStore {
  get(chatId: TelegramChatId): Promise<TelegramDialogState | null>;
  save(dialog: TelegramDialogState): Promise<void>;
  clear(chatId: TelegramChatId): Promise<void>;
}

export interface TelegramApplicationStore {
  save(application: TelegramRegistrationApplication): Promise<void>;
  getByChatId(chatId: TelegramChatId): Promise<TelegramRegistrationApplication | null>;
  listByStatus(status: TelegramApplicationStatus): Promise<TelegramRegistrationApplication[]>;
}

export interface TelegramStores {
  subscriptions: TelegramSubscriptionStore;
  deliveryLog: TelegramDeliveryLog;
  links: TelegramLinkStore;
  dialogs: TelegramDialogStore;
  applications: TelegramApplicationStore;
}

export function createMemoryTelegramStores(): TelegramStores {
  const subscriptions = new Map<number, TelegramSubscription>();
  const deliveries = new Set<string>();
  const links = new Map<string, PendingTelegramLink>();
  const dialogs = new Map<number, TelegramDialogState>();
  const applications = new Map<number, TelegramRegistrationApplication>();

  return {
    subscriptions: {
      async getByChatId(chatId) { return subscriptions.get(chatId) ?? null; },
      async listActive() { return [...subscriptions.values()].filter((item) => item.active); },
      async save(subscription) { subscriptions.set(subscription.chatId, { ...subscription }); },
      async setActive(chatId, active) {
        const current = subscriptions.get(chatId);
        if (current) subscriptions.set(chatId, { ...current, active });
      },
    },
    deliveryLog: {
      async has(key) { return deliveries.has(key); },
      async record(entry) { deliveries.add(entry.key); },
    },
    links: {
      async savePending(link) { links.set(link.codeHash, { ...link }); },
      async consume(codeHash, nowMs) {
        const pending = links.get(codeHash);
        if (!pending) return null;
        links.delete(codeHash);
        if (pending.expiresAt <= nowMs) return null;
        return pending;
      },
    },
    dialogs: {
      async get(chatId) { return dialogs.get(chatId) ?? null; },
      async save(dialog) { dialogs.set(dialog.chatId, { ...dialog }); },
      async clear(chatId) { dialogs.delete(chatId); },
    },
    applications: {
      async save(application) { applications.set(application.chatId, { ...application }); },
      async getByChatId(chatId) { return applications.get(chatId) ?? null; },
      async listByStatus(status) {
        return [...applications.values()]
          .filter((item) => item.status === status)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      },
    },
  };
}

function unconfiguredError(store: string): IntegrationError {
  return new IntegrationError(
    'UNCONFIGURED',
    `Telegram ${store} has no durable Shopflow-backed store. ` +
      'Configure persistent Telegram storage before enabling production delivery (see TELEGRAM_SETUP.md).',
  );
}

/** Production default until durable Shopflow-backed stores are implemented. */
export const unconfiguredTelegramStores: TelegramStores = {
  subscriptions: {
    async getByChatId() { throw unconfiguredError('subscription store'); },
    async listActive() { throw unconfiguredError('subscription store'); },
    async save() { throw unconfiguredError('subscription store'); },
    async setActive() { throw unconfiguredError('subscription store'); },
  },
  deliveryLog: {
    async has() { throw unconfiguredError('delivery log'); },
    async record() { throw unconfiguredError('delivery log'); },
  },
  links: {
    async savePending() { throw unconfiguredError('link store'); },
    async consume() { throw unconfiguredError('link store'); },
  },
  dialogs: {
    async get() { throw unconfiguredError('dialog store'); },
    async save() { throw unconfiguredError('dialog store'); },
    async clear() { throw unconfiguredError('dialog store'); },
  },
  applications: {
    async save() { throw unconfiguredError('application store'); },
    async getByChatId() { throw unconfiguredError('application store'); },
    async listByStatus() { throw unconfiguredError('application store'); },
  },
};

export interface TelegramStoreEnv {
  TELEGRAM_STORE_MODE?: string;
}

/**
 * Resolves the active stores. Production stays fail-closed (`unconfigured`).
 * Set `TELEGRAM_STORE_MODE=memory` ONLY for local development dry runs with a
 * fake sender — never with a real bot token.
 */
let memorySingleton: TelegramStores | null = null;

/**
 * Test-only reset for the process-level memory stores. Production memory
 * mode intentionally keeps state for the lifetime of the process.
 */
export function resetMemoryTelegramStores(): void {
  memorySingleton = null;
}

export function getTelegramStores(env: NodeJS.ProcessEnv | TelegramStoreEnv = process.env): TelegramStores {
  // Memory mode is a process-level singleton: multi-request dialog flows
  // (registration steps, admin review) share one machine's RAM on purpose.
  // It is still tests/local/pilot-only — restart wipes it, and it never
  // spans machines. Production needs durable Shopflow-backed stores.
  if (env.TELEGRAM_STORE_MODE === 'memory') {
    if (!memorySingleton) memorySingleton = createMemoryTelegramStores();
    return memorySingleton;
  }
  return unconfiguredTelegramStores;
}

export function isUnconfiguredStores(stores: TelegramStores): boolean {
  return stores === unconfiguredTelegramStores;
}
