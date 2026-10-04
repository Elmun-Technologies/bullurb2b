import 'server-only';

import type { ShopFlowOutboundEvent } from './webhooks';

/**
 * In-memory log of ShopFlow outbound order events (guide §6.2).
 *
 * This is what makes Mini App store purchases visible in our admin panel:
 * the storefront checkout never touches our bot, so `order.created` /
 * `order.status_changed` / `order.paid` webhooks are the only live feed.
 * Pilot-only: restart wipes it, single machine only — production needs a
 * durable event table (same blocker as the Telegram stores).
 */

export interface ShopFlowOrderEvent {
  event: ShopFlowOutboundEvent;
  orderId: string;
  code?: string;
  total?: number;
  currency?: string;
  status?: string;
  source?: string;
  /** ShopFlow's own event timestamp. */
  timestamp: string;
  /** When our receiver stored it. */
  receivedAt: string;
}

const MAX_EVENTS = 200;

const events: ShopFlowOrderEvent[] = [];

export function recordShopFlowOrderEvent(event: ShopFlowOrderEvent): void {
  events.push({ ...event });
  if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
}

/** Newest first, capped. */
export function listShopFlowOrderEvents(limit: number): ShopFlowOrderEvent[] {
  return events.slice(-Math.max(1, limit)).reverse();
}

/** Test-only reset. */
export function resetShopFlowOrderEvents(): void {
  events.length = 0;
}
