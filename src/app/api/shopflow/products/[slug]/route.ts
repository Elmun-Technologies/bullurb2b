import { shopFlowClientFromEnv, shopFlowErrorResponse, searchParamsToRecord } from '@/lib/shopflow/responses';
import { validateLocaleParam } from '@/lib/shopflow/validation';

/** BFF proxy for ShopFlow `GET /v1/products/:slug` (id fallback included). Fail-closed. */
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }): Promise<Response> {
  try {
    const client = shopFlowClientFromEnv();
    const { slug } = await context.params;
    const params = searchParamsToRecord(new URL(request.url).searchParams);
    const locale = validateLocaleParam(params.locale) ?? 'uz';
    const product = await client.product(slug, locale);
    return Response.json({ ok: true, item: product });
  } catch (error) {
    return shopFlowErrorResponse(error);
  }
}
