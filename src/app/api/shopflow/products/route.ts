import { shopFlowClientFromEnv, shopFlowErrorResponse, searchParamsToRecord } from '@/lib/shopflow/responses';
import { validateProductQuery } from '@/lib/shopflow/validation';

/** BFF proxy for ShopFlow `GET /v1/products` (paginated catalog). Fail-closed. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const client = shopFlowClientFromEnv();
    const query = validateProductQuery(searchParamsToRecord(new URL(request.url).searchParams));
    const list = await client.products(query);
    return Response.json({ ok: true, ...list });
  } catch (error) {
    return shopFlowErrorResponse(error);
  }
}
