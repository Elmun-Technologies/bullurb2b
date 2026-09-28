import 'server-only';

import { IntegrationError } from '@/lib/providers/errors';

/**
 * Server-only ShopFlow configuration.
 *
 * The Public API v1 key (`sf_...`) and the outbound-webhook HMAC secret stay
 * on the server: this module must never be imported from client components,
 * and browsers always go through our proxy routes — never to ShopFlow
 * directly (integration guide §3.0 security rule).
 */

export interface ShopFlowEnv {
  SHOPFLOW_API_URL?: string;
  SHOPFLOW_API_KEY?: string;
  SHOPFLOW_WEBHOOK_SECRET?: string;
}

export interface ShopFlowConfig {
  /** Base URL, e.g. `https://shop.example.uz/api/v1` (no trailing slash). */
  baseUrl: string;
  apiKey: string;
}

function readEnv(env: NodeJS.ProcessEnv | ShopFlowEnv, name: keyof ShopFlowEnv): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/u, '');
  if (!/^https?:\/\/.+/u.test(trimmed)) {
    throw new IntegrationError('UNCONFIGURED', 'ShopFlow API URL must be an http(s) URL.');
  }
  return trimmed;
}

/** Fail-closed: throws unless a complete server-side configuration exists. */
export function requireShopFlowConfig(env: NodeJS.ProcessEnv | ShopFlowEnv = process.env): ShopFlowConfig {
  const baseUrl = readEnv(env, 'SHOPFLOW_API_URL');
  const apiKey = readEnv(env, 'SHOPFLOW_API_KEY');
  if (!baseUrl || !apiKey) {
    throw new IntegrationError('UNCONFIGURED', 'ShopFlow API URL/key are not configured.');
  }
  return { baseUrl: normalizeBaseUrl(baseUrl), apiKey };
}

export function isShopFlowConfigured(env: NodeJS.ProcessEnv | ShopFlowEnv = process.env): boolean {
  try {
    requireShopFlowConfig(env);
    return true;
  } catch {
    return false;
  }
}

/** Fail-closed: HMAC secret for verifying ShopFlow outbound webhooks. */
export function requireShopFlowWebhookSecret(env: NodeJS.ProcessEnv | ShopFlowEnv = process.env): string {
  const secret = readEnv(env, 'SHOPFLOW_WEBHOOK_SECRET');
  if (secret.length < 16) {
    throw new IntegrationError('UNCONFIGURED', 'ShopFlow webhook secret is not configured.');
  }
  return secret;
}
