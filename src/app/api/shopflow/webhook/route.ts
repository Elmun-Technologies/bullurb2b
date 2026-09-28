import { IntegrationError } from '@/lib/providers/errors';
import { requireShopFlowWebhookSecret } from '@/lib/shopflow/config';
import {
  parseShopFlowOrderData,
  parseShopFlowWebhook,
  SHOPFLOW_SIGNATURE_HEADER,
  verifyShopFlowSignature,
} from '@/lib/shopflow/webhooks';

/**
 * ShopFlow outbound webhook receiver (guide §6.2).
 *
 * Register this URL in ShopFlow (`POST /api/outbound-webhooks` or admin
 * panel) with events `order.created`, `order.status_changed`, `order.paid`.
 * Every call must carry `X-ShopFlow-Signature: sha256=<hex>` over the RAW
 * body; the signature is verified with a timing-safe compare before parsing.
 *
 * Current behavior: verify → validate → acknowledge with the parsed order
 * summary. Fanning out to Telegram chats additionally needs the verified
 * customer→chat mapping and durable delivery storage (same production
 * blockers as the scheduler path), so no side effects happen yet.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let secret: string;
  try {
    secret = requireShopFlowWebhookSecret();
  } catch (error) {
    if (error instanceof IntegrationError) {
      return Response.json({ ok: false, error: 'shopflow-unconfigured' }, { status: 503 });
    }
    return Response.json({ ok: false, error: 'shopflow-failed' }, { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get(SHOPFLOW_SIGNATURE_HEADER);
  if (!verifyShopFlowSignature(rawBody, signature, secret)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  let parsedBody: unknown = null;
  try {
    parsedBody = rawBody ? (JSON.parse(rawBody) as unknown) : null;
  } catch {
    return Response.json({ ok: false, error: 'invalid-body' }, { status: 400 });
  }

  const envelope = parseShopFlowWebhook(parsedBody);
  if (!envelope) {
    // Unknown event names and malformed envelopes are acknowledged without
    // action so ShopFlow stops retrying; nothing was applied.
    return Response.json({ ok: true, ignored: true });
  }

  if (envelope.event === 'lead.created') {
    return Response.json({ ok: true, event: envelope.event, ignored: true });
  }

  const order = parseShopFlowOrderData(envelope.data);
  if (!order) {
    return Response.json({ ok: true, event: envelope.event, ignored: true });
  }
  return Response.json({ ok: true, event: envelope.event, order: { id: order.id, code: order.code ?? null, status: order.status ?? null } });
}
