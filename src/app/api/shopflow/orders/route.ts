import { shopFlowClientFromEnv, shopFlowErrorResponse } from '@/lib/shopflow/responses';
import { validateOrderRequest } from '@/lib/shopflow/validation';

/**
 * BFF proxy for ShopFlow `POST /v1/orders`.
 * Browser input is validated fail-fast, then forwarded server-side; the API
 * key never leaves the server. Stock conflicts and variant choices are
 * relayed so the UI can react (per the integration guide).
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  try {
    const client = shopFlowClientFromEnv();
    const body: unknown = await request.json().catch(() => null);
    const order = validateOrderRequest(body);
    const result = await client.createOrder(order);
    return Response.json({ ok: true, orderId: result.orderId, message: result.message }, { status: 201 });
  } catch (error) {
    return shopFlowErrorResponse(error);
  }
}
