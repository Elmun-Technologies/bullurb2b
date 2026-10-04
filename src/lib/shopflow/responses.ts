import 'server-only';

import { IntegrationError } from '@/lib/providers/errors';
import { ShopFlowClient, ShopFlowApiError } from './client';
import { requireShopFlowConfig } from './config';
import { ShopFlowValidationError } from './validation';

/**
 * Shared helpers for the ShopFlow BFF proxy routes. Browsers call our routes;
 * only the server ever talks to ShopFlow (guide §3.0 security rule).
 *
 * Error mapping is deliberately lossy toward the browser: operational detail
 * stays in server logs, clients get safe Uzbek messages. Only the documented
 * user-actionable payloads (validation messages/details, stock conflicts,
 * variant choices) are relayed — never keys, URLs or stack traces.
 */

export function shopFlowClientFromEnv(): ShopFlowClient {
  const config = requireShopFlowConfig();
  return new ShopFlowClient(config.baseUrl, config.apiKey);
}

function logUpstreamFailure(error: unknown): void {
  if (error instanceof ShopFlowApiError) {
    console.error(`[shopflow] upstream failure=${error.options.failure} status=${error.options.status ?? 'n/a'} message=${error.message}`);
  } else if (error instanceof IntegrationError) {
    console.error(`[shopflow] ${error.message}`);
  } else {
    console.error(`[shopflow] unexpected: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

export function shopFlowErrorResponse(error: unknown): Response {
  if (error instanceof IntegrationError && error.failure === 'UNCONFIGURED') {
    return Response.json({ ok: false, error: 'shopflow-unconfigured', message: 'ShopFlow integratsiyasi sozlanmagan.' }, { status: 503 });
  }
  if (error instanceof ShopFlowValidationError) {
    // Our own fail-fast input validation (browser input never reached ShopFlow).
    return Response.json({ ok: false, error: 'validation', message: error.message, details: error.details }, { status: 400 });
  }
  if (error instanceof ShopFlowApiError) {
    switch (error.options.failure) {
      case 'not-found':
        return Response.json({ ok: false, error: 'not-found', message: 'So‘ralgan ma’lumot topilmadi.' }, { status: 404 });
      case 'validation':
        return Response.json(
          { ok: false, error: 'validation', message: error.message, ...(error.options.details ? { details: error.options.details } : {}), ...(error.options.variants ? { variants: error.options.variants } : {}) },
          { status: 400 },
        );
      case 'conflict':
        return Response.json({ ok: false, error: 'conflict', message: error.message }, { status: 409 });
      case 'rate-limited':
      case 'transient':
        logUpstreamFailure(error);
        return Response.json(
          { ok: false, error: 'shopflow-unavailable', message: 'Tashqi xizmat vaqtincha ishlamayapti. Birozdan so‘ng qayta urinib ko‘ring.' },
          { status: 503 },
        );
      case 'invalid-data':
        logUpstreamFailure(error);
        return Response.json({ ok: false, error: 'shopflow-invalid-data', message: 'Tashqi xizmatdan kutilmagan ma’lumot olindi.' }, { status: 502 });
      case 'unauthorized':
      case 'unconfigured':
      case 'unknown':
      default:
        logUpstreamFailure(error);
        return Response.json({ ok: false, error: 'shopflow-unavailable', message: 'Tashqi xizmat vaqtincha ishlamayapti.' }, { status: 503 });
    }
  }
  logUpstreamFailure(error);
  return Response.json({ ok: false, error: 'shopflow-failed' }, { status: 500 });
}

export function searchParamsToRecord(searchParams: URLSearchParams): Record<string, string | string[] | undefined> {
  const record: Record<string, string | string[] | undefined> = {};
  for (const key of searchParams.keys()) {
    const values = searchParams.getAll(key);
    record[key] = values.length > 1 ? values : values[0];
  }
  return record;
}
