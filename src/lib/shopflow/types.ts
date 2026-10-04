/**
 * Verified ShopFlow Public API v1 contract types.
 *
 * Copied from the ShopFlow backend integration guide (checked against
 * `backend/src/routes/public-api.ts` by its author). Only the documented
 * fields are modeled here — anything the guide does not specify is left out
 * on purpose and must not be guessed.
 */

export type ShopFlowLocale = 'uz' | 'ru' | 'en';

export interface ShopFlowCategory {
  id: string;
  slug: string;
  name: string;
  description?: string;
  image?: string;
  productCount?: number;
}

export interface ShopFlowProductImage {
  url: string;
  alt: string;
}

export interface ShopFlowProductVariant {
  id: string;
  sku: string;
  name: string;
  options: Record<string, string>;
  price: number;
  oldPrice?: number;
  inStock: boolean;
  images: ShopFlowProductImage[];
  attributes: { label: string; value: string }[];
}

export interface ShopFlowProduct {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  categoryId: string | null;
  categorySlug: string | null;
  price: number;
  oldPrice?: number;
  currency: string;
  rating: number;
  reviewCount: number;
  inStock: boolean;
  images: ShopFlowProductImage[];
  highlights: string[];
  benefits: { icon?: string; title: string; description: string }[];
  ingredients: { name: string; amount: string; dailyValue?: string }[];
  howToUse: string;
  faq: { question: string; answer: string }[];
  reviews: { author: string; rating: number; date: string; text: string }[];
  badges: string[];
  servings?: number;
  origin?: string;
  bespoke: boolean;
  options: { id: string; name: string; values: { id: string; label: string }[] }[];
  variants: ShopFlowProductVariant[];
  /** B2B wholesale prices; empty array when none. */
  priceTiers: { minQty: number; price: number }[];
  moq: number | null;
  unit: 'kg' | 'l' | 'dona' | null;
}

export interface ShopFlowUpsellOffer {
  product: ShopFlowProduct;
  discountPercent: number;
  reason: string;
}

export interface ShopFlowPromotion {
  id: string;
  type: 'free_shipping_over' | 'percent_off' | 'buy_x_get_y';
  title: string;
  description: string;
  threshold?: number;
  percent?: number;
}

export type ShopFlowProductSort = 'popular' | 'price_asc' | 'price_desc' | 'new';

export interface ShopFlowProductQuery {
  locale?: ShopFlowLocale;
  category?: string;
  search?: string;
  origin?: string;
  minPrice?: number;
  maxPrice?: number;
  sort?: ShopFlowProductSort;
  page?: number;
  pageSize?: number;
}

export interface ShopFlowProductList {
  items: ShopFlowProduct[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ShopFlowOrderItem {
  productId?: string;
  slug?: string;
  variantId?: string;
  quantity: number;
  name?: string;
  unitPrice?: number;
}

export interface ShopFlowOrderRequest {
  customer: { name: string; phone: string };
  delivery: { region?: string; address?: string; note?: string; method: 'courier' | 'pickup' };
  items: ShopFlowOrderItem[];
  appliedUpsells?: string[];
  appliedPromotions?: string[];
  totals?: { subtotal?: number; discount?: number; shipping?: number; total?: number };
  locale?: string;
  attribution?: { utmSource?: string; utmMedium?: string; utmCampaign?: string; landing?: string; referrer?: string };
}

export interface ShopFlowOrderSuccess {
  ok: true;
  orderId: string;
  message: string;
}

export interface ShopFlowOrderFailure {
  ok: false;
  message: string;
  variants?: { id: string; name: string }[];
}

export type ShopFlowOrderResult = ShopFlowOrderSuccess | ShopFlowOrderFailure;

export interface ShopFlowHealth {
  status: string;
  db: string;
  ts: string;
}

/** Generic `{ "error": "..." }` failure envelope (401/404/429). */
export interface ShopFlowErrorEnvelope {
  error: string;
}

/** Zod validation failure envelope (400). */
export interface ShopFlowValidationEnvelope {
  error: string;
  details?: { path: string; message: string }[];
}
