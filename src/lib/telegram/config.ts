import 'server-only';

import { IntegrationError } from '@/lib/providers/errors';
import type { TelegramIntegrationStatus } from './types';

/**
 * Server-only Telegram configuration.
 *
 * All secrets stay on the server: this module must never be imported from
 * client components, and none of its return values contain secret material.
 * The integration is fail-closed — without an explicit opt-in plus every
 * required secret it reports `disabled`/`unconfigured` and refuses delivery.
 */

export interface TelegramEnv {
  TELEGRAM_ENABLED?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_BOT_USERNAME?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
  TELEGRAM_LINKING_SECRET?: string;
  TELEGRAM_CRON_SECRET?: string;
  TELEGRAM_ADMIN_CHAT_ID?: string;
  MOYSKLAD_MODE?: string;
}

export interface TelegramServerConfig {
  status: TelegramIntegrationStatus;
  enabled: boolean;
  botUsername: string | null;
  /** True only when the operational provider is live (never demo/mock data). */
  liveDataMode: boolean;
  /** Names of missing/invalid settings — names only, never values. */
  missing: string[];
}

/** Bot API `secret_token` charset: 1–256 chars of A–Z a–z 0–9 _ -. */
const WEBHOOK_SECRET_PATTERN = /^[A-Za-z0-9_-]{1,256}$/;

export function isValidWebhookSecretFormat(value: string): boolean {
  return WEBHOOK_SECRET_PATTERN.test(value);
}

function readEnv(env: NodeJS.ProcessEnv | TelegramEnv, name: keyof TelegramEnv): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function getTelegramServerConfig(env: NodeJS.ProcessEnv | TelegramEnv = process.env): TelegramServerConfig {
  const enabled = readEnv(env, 'TELEGRAM_ENABLED').toLowerCase() === 'true';
  const botToken = readEnv(env, 'TELEGRAM_BOT_TOKEN');
  const botUsername = readEnv(env, 'TELEGRAM_BOT_USERNAME');
  const webhookSecret = readEnv(env, 'TELEGRAM_WEBHOOK_SECRET');
  const linkingSecret = readEnv(env, 'TELEGRAM_LINKING_SECRET');
  const cronSecret = readEnv(env, 'TELEGRAM_CRON_SECRET');
  const liveDataMode = readEnv(env, 'MOYSKLAD_MODE').toLowerCase() === 'live';

  if (!enabled) {
    return { status: 'disabled', enabled: false, botUsername: botUsername || null, liveDataMode, missing: ['TELEGRAM_ENABLED'] };
  }

  const missing: string[] = [];
  if (!botToken) missing.push('TELEGRAM_BOT_TOKEN');
  if (!webhookSecret || !isValidWebhookSecretFormat(webhookSecret)) missing.push('TELEGRAM_WEBHOOK_SECRET');
  if (linkingSecret.length < 32) missing.push('TELEGRAM_LINKING_SECRET');
  if (cronSecret.length < 32) missing.push('TELEGRAM_CRON_SECRET');

  if (missing.length > 0) {
    return { status: 'unconfigured', enabled: true, botUsername: botUsername || null, liveDataMode, missing };
  }
  return { status: 'ready', enabled: true, botUsername: botUsername || null, liveDataMode, missing: [] };
}

export interface TelegramDeliveryConfig {
  botToken: string;
  botUsername: string | null;
}

/**
 * Returns the secrets needed for real delivery, or throws fail-closed.
 * Real delivery additionally requires live (non-demo) provider data; the cron
 * route enforces that separately so demo records can never reach real chats.
 */
export function requireTelegramDeliveryConfig(env: NodeJS.ProcessEnv | TelegramEnv = process.env): TelegramDeliveryConfig {
  const config = getTelegramServerConfig(env);
  if (config.status !== 'ready') {
    throw new IntegrationError('UNCONFIGURED', `Telegram integration is ${config.status}: missing ${config.missing.join(', ') || 'settings'}.`);
  }
  const botToken = readEnv(env, 'TELEGRAM_BOT_TOKEN');
  if (!botToken) throw new IntegrationError('UNCONFIGURED', 'Telegram bot token is not configured.');
  return { botToken, botUsername: config.botUsername };
}

export function requireTelegramWebhookSecret(env: NodeJS.ProcessEnv | TelegramEnv = process.env): string {
  const secret = readEnv(env, 'TELEGRAM_WEBHOOK_SECRET');
  if (!secret || !isValidWebhookSecretFormat(secret)) {
    throw new IntegrationError('UNCONFIGURED', 'Telegram webhook secret is not configured.');
  }
  return secret;
}

export function requireTelegramLinkingSecret(env: NodeJS.ProcessEnv | TelegramEnv = process.env): string {
  const secret = readEnv(env, 'TELEGRAM_LINKING_SECRET');
  if (secret.length < 32) throw new IntegrationError('UNCONFIGURED', 'Telegram linking secret is not configured.');
  return secret;
}

export function requireTelegramCronSecret(env: NodeJS.ProcessEnv | TelegramEnv = process.env): string {
  const secret = readEnv(env, 'TELEGRAM_CRON_SECRET');
  if (secret.length < 32) throw new IntegrationError('UNCONFIGURED', 'Telegram scheduler secret is not configured.');
  return secret;
}

/** Optional admin chat id for new-application notifications (null when unset/invalid). */
export function readTelegramAdminChatId(env: NodeJS.ProcessEnv | TelegramEnv = process.env): string | null {
  const raw = readEnv(env, 'TELEGRAM_ADMIN_CHAT_ID');
  if (!/^-?\d{1,20}$/u.test(raw)) return null;
  return raw;
}

/** Public, secret-free status for the setup UI and health checks. */
export function getTelegramPublicStatus(env: NodeJS.ProcessEnv | TelegramEnv = process.env): {
  status: TelegramIntegrationStatus;
  botUsername: string | null;
  liveDataMode: boolean;
  missing: string[];
  setupDocs: string;
} {
  const config = getTelegramServerConfig(env);
  return { status: config.status, botUsername: config.botUsername, liveDataMode: config.liveDataMode, missing: config.missing, setupDocs: 'TELEGRAM_SETUP.md' };
}
