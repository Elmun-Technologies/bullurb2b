import type { LoyaltySummary, PriceResult, Product } from './types';

export function calculatePrice(product: Product, loyalty: LoyaltySummary, customerId?: string): PriceResult {
  const basePrice = Math.max(0, Math.round(product.price));
  const specialPrice = customerId ? product.specialPrices?.[customerId] : undefined;
  if (specialPrice !== undefined && Number.isSafeInteger(specialPrice) && specialPrice >= 0) {
    const finalPrice = Math.round(specialPrice);
    return { basePrice, finalPrice, priceSource: 'CUSTOMER_SPECIAL', loyaltyTier: loyalty.currentTier.name, discountPercent: 0, discountAmount: 0, savingsAmount: Math.max(0, basePrice - finalPrice) };
  }
  const discountAmount = Math.round((basePrice * loyalty.discountPercent) / 100);
  return { basePrice, finalPrice: basePrice - discountAmount, priceSource: loyalty.discountPercent > 0 ? 'LOYALTY_PRICE' : 'B2B_PRICE', loyaltyTier: loyalty.currentTier.name, discountPercent: loyalty.discountPercent, discountAmount, savingsAmount: discountAmount };
}

export function formatUZS(value: number): string {
  return `${new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 }).format(Math.round(value))} so‘m`;
}
