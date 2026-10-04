import 'server-only';

import { IntegrationError } from '@/lib/providers/errors';

/**
 * Server-only MoySklad configuration.
 *
 * Authentication uses a pre-minted access token (`Authorization: Bearer`).
 * Tokens are minted once by the operator (`POST /security/token` with Basic
 * auth) because minting REVOKES previously issued tokens — the portal never
 * mints or refreshes tokens automatically to avoid breaking other
 * integrations. The token stays server-only, like all other secrets.
 */

export const MOYSKLAD_DEFAULT_BASE_URL = 'https://api.moysklad.ru/api/remap/1.2';

export interface MoySkladEnv {
  MOYSKLAD_API_TOKEN?: string;
  MOYSKLAD_API_URL?: string;
}

export interface MoySkladConfig {
  baseUrl: string;
  token: string;
}

function readEnv(env: NodeJS.ProcessEnv | MoySkladEnv, name: keyof MoySkladEnv): string {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

/** Fail-closed: throws unless a complete server-side configuration exists. */
export function requireMoySkladConfig(env: NodeJS.ProcessEnv | MoySkladEnv = process.env): MoySkladConfig {
  const token = readEnv(env, 'MOYSKLAD_API_TOKEN');
  if (!token) {
    throw new IntegrationError('UNCONFIGURED', 'MoySklad API token is not configured.');
  }
  const rawBase = readEnv(env, 'MOYSKLAD_API_URL') || MOYSKLAD_DEFAULT_BASE_URL;
  const baseUrl = rawBase.replace(/\/+$/u, '');
  if (!/^https?:\/\/.+/u.test(baseUrl)) {
    throw new IntegrationError('UNCONFIGURED', 'MoySklad API URL must be an http(s) URL.');
  }
  return { baseUrl, token };
}

export function isMoySkladConfigured(env: NodeJS.ProcessEnv | MoySkladEnv = process.env): boolean {
  try {
    requireMoySkladConfig(env);
    return true;
  } catch {
    return false;
  }
}
