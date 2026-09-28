import type {
  ShopFlowCategory,
  ShopFlowLocale,
  ShopFlowOrderRequest,
  ShopFlowProduct,
  ShopFlowProductList,
  ShopFlowProductQuery,
  ShopFlowProductSort,
  ShopFlowPromotion,
  ShopFlowUpsellOffer,
} from './types';

/**
 * Runtime validation for the ShopFlow boundary — both directions.
 *
 * Outbound (our proxy request bodies) is validated fail-fast so malformed
 * browser input never reaches ShopFlow. Inbound (ShopFlow responses) is
 * validated defensively so an unexpected payload can never crash the portal
 * or poison loyalty/order logic. Only documented fields are accepted.
 */

export class ShopFlowValidationError extends Error {
  constructor(
    message: string,
    readonly details: { path: string; message: string }[] = [],
  ) {
    super(message);
    this.name = 'ShopFlowValidationError';
  }
}

const LOCALES: ShopFlowLocale[] = ['uz', 'ru', 'en'];
const SORTS: ShopFlowProductSort[] = ['popular', 'price_asc', 'price_desc', 'new'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asOptionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ShopFlowValidationError('Expected a string.');
  return value.slice(0, maxLength);
}

/** Validates/normalizes `GET /products` query params per the v1 contract. */
export function validateProductQuery(input: Record<string, string | string[] | undefined>): ShopFlowProductQuery {
  const first = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);
  const query: ShopFlowProductQuery = {};
  const locale = first(input.locale);
  if (locale !== undefined) {
    if (!(LOCALES as string[]).includes(locale)) throw new ShopFlowValidationError(`locale must be one of ${LOCALES.join('|')}.`);
    query.locale = locale as ShopFlowLocale;
  }
  const category = first(input.category);
  if (category) query.category = category.slice(0, 120);
  const search = first(input.search);
  if (search !== undefined) {
    if (search.length > 100) throw new ShopFlowValidationError('search must be 100 characters or less.');
    query.search = search;
  }
  const origin = first(input.origin);
  if (origin !== undefined) {
    if (origin.length > 60) throw new ShopFlowValidationError('origin must be 60 characters or less.');
    query.origin = origin;
  }
  for (const key of ['minPrice', 'maxPrice'] as const) {
    const raw = first(input[key]);
    if (raw !== undefined && raw !== '') {
      const num = Number(raw);
      if (!Number.isFinite(num) || num < 0) throw new ShopFlowValidationError(`${key} must be a non-negative number.`);
      query[key] = num;
    }
  }
  const sort = first(input.sort);
  if (sort !== undefined && sort !== '') {
    if (!(SORTS as string[]).includes(sort)) throw new ShopFlowValidationError(`sort must be one of ${SORTS.join('|')}.`);
    query.sort = sort as ShopFlowProductSort;
  }
  const page = first(input.page);
  if (page !== undefined && page !== '') {
    const num = Number(page);
    if (!Number.isInteger(num) || num < 1) throw new ShopFlowValidationError('page must be an integer >= 1.');
    query.page = num;
  }
  const pageSize = first(input.pageSize);
  if (pageSize !== undefined && pageSize !== '') {
    const num = Number(pageSize);
    if (!Number.isInteger(num) || num < 1 || num > 100) throw new ShopFlowValidationError('pageSize must be an integer 1..100.');
    query.pageSize = num;
  }
  return query;
}

export function validateLocaleParam(locale: string | string[] | undefined): ShopFlowLocale | undefined {
  const value = Array.isArray(locale) ? locale[0] : locale;
  if (value === undefined || value === '') return undefined;
  if (!(LOCALES as string[]).includes(value)) throw new ShopFlowValidationError(`locale must be one of ${LOCALES.join('|')}.`);
  return value as ShopFlowLocale;
}

/** Validates an order-creation body before it is forwarded to ShopFlow. */
export function validateOrderRequest(body: unknown): ShopFlowOrderRequest {
  if (!isRecord(body)) throw new ShopFlowValidationError('Order body must be an object.');
  const customer = body.customer;
  const delivery = body.delivery;
  const customerName = isRecord(customer) ? asNonEmptyString(customer.name) : null;
  const customerPhone = isRecord(customer) ? asNonEmptyString(customer.phone) : null;
  if (!customerName || !customerPhone) {
    throw new ShopFlowValidationError('customer.name and customer.phone are required.', [
      { path: 'customer', message: 'customer.name and customer.phone are required.' },
    ]);
  }
  if (customerPhone.length > 32) throw new ShopFlowValidationError('customer.phone is too long.');
  if (!isRecord(delivery) || (delivery.method !== 'courier' && delivery.method !== 'pickup')) {
    throw new ShopFlowValidationError('delivery.method must be courier or pickup.', [
      { path: 'delivery.method', message: 'delivery.method must be courier or pickup.' },
    ]);
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw new ShopFlowValidationError('At least one order item is required.', [{ path: 'items', message: 'At least one order item is required.' }]);
  }
  if (body.items.length > 100) throw new ShopFlowValidationError('Too many order items (max 100).');
  const items = body.items.map((item: unknown, index: number) => {
    if (!isRecord(item)) throw new ShopFlowValidationError(`items.${index} must be an object.`);
    const productId = asNonEmptyString(item.productId);
    const slug = asNonEmptyString(item.slug);
    if (!productId && !slug) {
      throw new ShopFlowValidationError(`items.${index}: productId or slug is required.`, [
        { path: `items.${index}`, message: 'productId or slug is required.' },
      ]);
    }
    if (typeof item.quantity !== 'number' || !Number.isInteger(item.quantity) || item.quantity <= 0) {
      throw new ShopFlowValidationError(`items.${index}.quantity must be an integer > 0.`, [
        { path: `items.${index}.quantity`, message: 'quantity must be an integer > 0.' },
      ]);
    }
    return {
      ...(productId ? { productId } : {}),
      ...(slug ? { slug } : {}),
      ...(asNonEmptyString(item.variantId) ? { variantId: (item.variantId as string).trim() } : {}),
      quantity: item.quantity,
    };
  });

  const request: ShopFlowOrderRequest = {
    customer: { name: customerName, phone: customerPhone },
    delivery: {
      method: delivery.method,
      ...(asOptionalString(delivery.region, 120) ? { region: asOptionalString(delivery.region, 120) } : {}),
      ...(asOptionalString(delivery.address, 300) ? { address: asOptionalString(delivery.address, 300) } : {}),
      ...(asOptionalString(delivery.note, 500) ? { note: asOptionalString(delivery.note, 500) } : {}),
    },
    items,
  };
  if (body.appliedUpsells !== undefined) {
    if (!Array.isArray(body.appliedUpsells) || !body.appliedUpsells.every((id) => typeof id === 'string')) {
      throw new ShopFlowValidationError('appliedUpsells must be an array of ids.');
    }
    request.appliedUpsells = body.appliedUpsells;
  }
  if (body.appliedPromotions !== undefined) {
    if (!Array.isArray(body.appliedPromotions) || !body.appliedPromotions.every((id) => typeof id === 'string')) {
      throw new ShopFlowValidationError('appliedPromotions must be an array of ids.');
    }
    request.appliedPromotions = body.appliedPromotions;
  }
  if (body.attribution !== undefined) {
    if (!isRecord(body.attribution)) throw new ShopFlowValidationError('attribution must be an object.');
    const attribution: NonNullable<ShopFlowOrderRequest['attribution']> = {};
    for (const key of ['utmSource', 'utmMedium', 'utmCampaign', 'landing', 'referrer'] as const) {
      const value = asOptionalString(body.attribution[key], 300);
      if (value) attribution[key] = value;
    }
    request.attribution = attribution;
  }
  const locale = asOptionalString(body.locale, 8);
  if (locale) request.locale = locale;
  return request;
}

// ---- Inbound response guards (defensive: documented fields only) ----

export function assertCategoryList(value: unknown): ShopFlowCategory[] {
  if (!Array.isArray(value)) throw new ShopFlowValidationError('ShopFlow categories response is not a list.');
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !asNonEmptyString(item.id) || !asNonEmptyString(item.slug) || !asNonEmptyString(item.name)) {
      throw new ShopFlowValidationError(`ShopFlow category #${index} has an unexpected shape.`);
    }
  }
  return value as ShopFlowCategory[];
}

export function assertProduct(value: unknown): ShopFlowProduct {
  if (
    !isRecord(value) ||
    !asNonEmptyString(value.id) ||
    !asNonEmptyString(value.slug) ||
    !asNonEmptyString(value.name) ||
    typeof value.price !== 'number' ||
    !Number.isInteger(value.price) ||
    typeof value.inStock !== 'boolean' ||
    !Array.isArray(value.images) ||
    !Array.isArray(value.variants) ||
    !Array.isArray(value.priceTiers)
  ) {
    throw new ShopFlowValidationError('ShopFlow product has an unexpected shape.');
  }
  for (const tier of value.priceTiers as unknown[]) {
    if (!isRecord(tier) || typeof tier.minQty !== 'number' || typeof tier.price !== 'number') {
      throw new ShopFlowValidationError('ShopFlow product priceTiers have an unexpected shape.');
    }
  }
  return value as unknown as ShopFlowProduct;
}

export function assertProductList(value: unknown): ShopFlowProductList {
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.total !== 'number' || typeof value.page !== 'number' || typeof value.pageSize !== 'number') {
    throw new ShopFlowValidationError('ShopFlow product list has an unexpected shape.');
  }
  return { items: value.items.map(assertProduct), total: value.total, page: value.page, pageSize: value.pageSize };
}

export function assertUpsellList(value: unknown): ShopFlowUpsellOffer[] {
  if (!Array.isArray(value)) throw new ShopFlowValidationError('ShopFlow upsells response is not a list.');
  return value.map((item) => {
    if (!isRecord(item) || typeof item.discountPercent !== 'number' || typeof item.reason !== 'string') {
      throw new ShopFlowValidationError('ShopFlow upsell has an unexpected shape.');
    }
    return { product: assertProduct(item.product), discountPercent: item.discountPercent, reason: item.reason };
  });
}

export function assertPromotionList(value: unknown): ShopFlowPromotion[] {
  if (!Array.isArray(value)) throw new ShopFlowValidationError('ShopFlow promotions response is not a list.');
  for (const [index, item] of value.entries()) {
    if (!isRecord(item) || !asNonEmptyString(item.id) || typeof item.title !== 'string' || typeof item.description !== 'string') {
      throw new ShopFlowValidationError(`ShopFlow promotion #${index} has an unexpected shape.`);
    }
  }
  return value as ShopFlowPromotion[];
}

export function assertOrderResult(value: unknown): { ok: boolean; orderId?: string; message?: string; variants?: { id: string; name: string }[] } {
  if (!isRecord(value) || typeof value.ok !== 'boolean') {
    throw new ShopFlowValidationError('ShopFlow order response has an unexpected shape.');
  }
  if (value.ok && !asNonEmptyString(value.orderId)) {
    throw new ShopFlowValidationError('ShopFlow order response is missing orderId.');
  }
  return value as unknown as { ok: boolean; orderId?: string; message?: string; variants?: { id: string; name: string }[] };
}
