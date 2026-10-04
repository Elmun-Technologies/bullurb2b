import { shopFlowClientFromEnv, shopFlowErrorResponse, searchParamsToRecord } from '@/lib/shopflow/responses';
import { validateLocaleParam } from '@/lib/shopflow/validation';

/** BFF proxy for ShopFlow `GET /v1/categories`. Fail-closed, key never exposed. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  try {
    const client = shopFlowClientFromEnv();
    const params = searchParamsToRecord(new URL(request.url).searchParams);
    const locale = validateLocaleParam(params.locale) ?? 'uz';
    const categories = await client.categories(locale);
    return Response.json({ ok: true, items: categories });
  } catch (error) {
    return shopFlowErrorResponse(error);
  }
}
