import { shopFlowClientFromEnv, shopFlowErrorResponse } from '@/lib/shopflow/responses';

/** BFF proxy for ShopFlow `GET /v1/promotions`. Fail-closed. */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const promotions = await shopFlowClientFromEnv().promotions();
    return Response.json({ ok: true, items: promotions });
  } catch (error) {
    return shopFlowErrorResponse(error);
  }
}
