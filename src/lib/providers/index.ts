import 'server-only';
import { mockLoyaltySettingsStore, mockMoySkladProvider } from './mock-provider';
import { unconfiguredMoySkladProvider } from './moysklad-live-provider';
import { IntegrationError } from './errors';
import type { LoyaltySettingsStore } from './contracts';

export const moySkladProvider = process.env.MOYSKLAD_MODE === 'live'
  ? unconfiguredMoySkladProvider
  : mockMoySkladProvider;

const settingsUnconfigured = () => new IntegrationError(
  'UNCONFIGURED',
  'Loyalty settings have no Shopflow-backed store; refusing to use demo thresholds for server-side delivery.',
);

/**
 * Server-side loyalty settings. Live mode fails closed until a durable
 * Shopflow-backed store exists — demo browser settings must never drive
 * scheduled Telegram delivery.
 */
export const loyaltySettingsStore: LoyaltySettingsStore = process.env.MOYSKLAD_MODE === 'live'
  ? { async getConfig() { throw settingsUnconfigured(); }, async saveConfig() { throw settingsUnconfigured(); } }
  : mockLoyaltySettingsStore;
