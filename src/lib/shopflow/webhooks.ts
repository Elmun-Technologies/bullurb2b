import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * ShopFlow outbound webhook receiver helpers (integration guide §6.2).
 *
 * ShopFlow POSTs `{ event, tenantId, timestamp, data }` with headers
 * `X-ShopFlow-Event` and (when a secret is configured)
 * `X-ShopFlow-Signature: sha256=<hex>` — an HMAC-SHA256 over the RAW request
 * body. Verification must run on the raw text before `JSON.parse`.
 *
 * Documented events: `order.created`, `order.status_changed`, `order.paid`,
 * `lead.created`. `order.created` carries
 * `data.order = { id, code, total, currency, status, source }`.
 */

export const SHOPFLOW_EVENT_HEADER = 'x-shopflow-event';
export const SHOPFLOW_SIGNATURE_HEADER = 'x-shopflow-signature';

export type ShopFlowOutboundEvent = 'order.created' | 'order.status_changed' | 'order.paid' | 'lead.created';

const KNOWN_EVENTS: ShopFlowOutboundEvent[] = ['order.created', 'order.status_changed', 'order.paid', 'lead.created'];

export interface ShopFlowWebhookEnvelope {
  event: ShopFlowOutboundEvent;
  tenantId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface ShopFlowOrderEventData {
  id: string;
  code?: string;
  total?: number;
  currency?: string;
  status?: string;
  source?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Verifies `sha256=<hex>` over the raw body with a timing-safe compare.
 * Returns false for missing/empty secrets, headers or malformed signatures.
 */
export function verifyShopFlowSignature(rawBody: string, signatureHeader: string | null | undefined, secret: string): boolean {
  if (!rawBody || !signatureHeader || !secret) return false;
  const match = /^sha256=([0-9a-fA-F]+)$/u.exec(signatureHeader.trim());
  if (!match) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex')}`;
  const provided = `sha256=${match[1].toLowerCase()}`;
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}

export function isKnownShopFlowEvent(value: unknown): value is ShopFlowOutboundEvent {
  return typeof value === 'string' && (KNOWN_EVENTS as string[]).includes(value);
}

/**
 * Validates the webhook envelope. Returns null for malformed bodies; unknown
 * event names are rejected here so the route can acknowledge-and-ignore them.
 */
export function parseShopFlowWebhook(body: unknown): ShopFlowWebhookEnvelope | null {
  if (!isRecord(body)) return null;
  if (!isKnownShopFlowEvent(body.event)) return null;
  if (typeof body.tenantId !== 'string' || !body.tenantId.trim()) return null;
  if (typeof body.timestamp !== 'string' || !body.timestamp.trim()) return null;
  if (!isRecord(body.data)) return null;
  return { event: body.event, tenantId: body.tenantId.trim(), timestamp: body.timestamp.trim(), data: body.data };
}

/** Extracts the documented `data.order` subset; null when absent/malformed. */
export function parseShopFlowOrderData(data: Record<string, unknown>): ShopFlowOrderEventData | null {
  const order = data.order;
  if (!isRecord(order) || typeof order.id !== 'string' || !order.id.trim()) return null;
  const result: ShopFlowOrderEventData = { id: order.id.trim() };
  if (typeof order.code === 'string' && order.code.trim()) result.code = order.code.trim();
  if (typeof order.total === 'number' && Number.isInteger(order.total)) result.total = order.total;
  if (typeof order.currency === 'string' && order.currency.trim()) result.currency = order.currency.trim();
  if (typeof order.status === 'string' && order.status.trim()) result.status = order.status.trim();
  if (typeof order.source === 'string' && order.source.trim()) result.source = order.source.trim();
  return result;
}
