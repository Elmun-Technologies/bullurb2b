import { shopFlowClientFromEnv, shopFlowErrorResponse } from '@/lib/shopflow/responses';

/** Proxies ShopFlow `GET /api/health` so operators can verify connectivity. Fail-closed. */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const health = await shopFlowClientFromEnv().health();
    return Response.json({ ok: true, status: health.status, db: health.db });
  } catch (error) {
    return shopFlowErrorResponse(error);
  }
}
