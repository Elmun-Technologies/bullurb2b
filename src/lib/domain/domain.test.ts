import { describe, expect, it } from 'vitest';
import { aggregatePurchaseMetrics, calculateLoyaltySummary, DEFAULT_LOYALTY_CONFIG, evaluateTierChange, getPeriodBounds, getTierForValue, getCustomerMetricValue, getLoyaltySummaryForCustomer, isOrderEligibleForLoyalty, validateTiers } from './loyalty';
import { calculatePrice } from './pricing';
import type { Product, SalesOrder } from './types';
import { AccessDeniedError, authorizeCustomerAccess } from '@/lib/auth/policy';
import { customers } from './mock-data';
import { getSalesOpportunities } from './opportunities';
import { mockMoySkladProvider } from '@/lib/providers/mock-provider';
import { getPortalNotifications } from './notifications';

const tiers = DEFAULT_LOYALTY_CONFIG.tiers;

describe('loyalty tier calculation', () => {
  it.each([[0, 'standard'], [49, 'standard'], [50, 'silver'], [99, 'silver'], [100, 'gold'], [199, 'gold'], [200, 'platinum'], [499, 'platinum'], [500, 'vip']] as const)('%i boxes maps to %s', (value, expected) => {
    expect(getTierForValue(value, tiers).id).toBe(expected);
  });

  it('reports 82 / 100, 18 remaining, and 82 percent progress', () => {
    const summary = calculateLoyaltySummary(82, DEFAULT_LOYALTY_CONFIG);
    expect(summary.currentTier.name).toBe('Silver');
    expect(summary.nextTier?.name).toBe('Gold');
    expect(summary.nextThreshold).toBe(100);
    expect(summary.remaining).toBe(18);
    expect(summary.progressPercent).toBe(82);
    expect(summary.discountPercent).toBe(3);
  });

  it('upgrades immediately after 82 + 20 reaches 102', () => {
    const summary = calculateLoyaltySummary(82 + 20, DEFAULT_LOYALTY_CONFIG);
    expect(summary.currentTier.id).toBe('gold');
    expect(summary.discountPercent).toBe(5);
  });

  it('holds the stored tier during a period and flags a downgrade risk for sales', () => {
    const customer = { ...customers[1], tierId: 'silver', currentBoxes: 20, previousBoxes: 80, metricsByPeriod: { 'calendar-month': { boxes: 20, turnover: 4_000_000 } } };
    const summary = getLoyaltySummaryForCustomer(customer, DEFAULT_LOYALTY_CONFIG);
    expect(summary.currentTier.id).toBe('silver');
    expect(getLoyaltySummaryForCustomer(customer, DEFAULT_LOYALTY_CONFIG, true).currentTier.id).toBe('standard');
    expect(getSalesOpportunities([customer], DEFAULT_LOYALTY_CONFIG, new Date('2026-09-28')).some((item) => item.type === 'TIER_DOWNGRADE_RISK')).toBe(true);
  });

  it('defers downgrades until the next period begins', () => {
    expect(evaluateTierChange('gold', 60, DEFAULT_LOYALTY_CONFIG).id).toBe('gold');
    expect(evaluateTierChange('gold', 60, DEFAULT_LOYALTY_CONFIG, true).id).toBe('silver');
  });

  it('uses the configured 30/90-day demo snapshot rather than the calendar-month volume', () => {
    const thirtyDay = { ...DEFAULT_LOYALTY_CONFIG, period: 'last-30-days' as const };
    expect(getCustomerMetricValue(customers[0], DEFAULT_LOYALTY_CONFIG)).toBe(82);
    expect(getCustomerMetricValue(customers[0], thirtyDay)).toBeGreaterThan(82);
  });

  it('supports turnover thresholds and zero progress at the entry level', () => {
    const turnoverConfig = { ...DEFAULT_LOYALTY_CONFIG, metric: 'turnover' as const, tiers: [{ ...tiers[0], minValue: 0 }, { ...tiers[1], minValue: 10_000_000 }] };
    const summary = calculateLoyaltySummary(5_000_000, turnoverConfig);
    expect(summary.currentTier.id).toBe('standard');
    expect(summary.remaining).toBe(5_000_000);
    expect(summary.progressPercent).toBe(50);
    expect(summary.metric).toBe('turnover');
  });

  it('does not grant a discount while the program is disabled', () => {
    expect(calculateLoyaltySummary(82, { ...DEFAULT_LOYALTY_CONFIG, enabled: false }).discountPercent).toBe(0);
  });

  it('validates duplicate and descending tier thresholds', () => {
    const invalid = [tiers[0], { ...tiers[1], minValue: 100 }, { ...tiers[2], minValue: 50 }];
    expect(validateTiers(invalid)).toContain('Chegaralar takrorlanmasligi va o‘sib borishi kerak.');
  });

  it('calculates Tashkent calendar-month boundaries in UTC correctly', () => {
    const { start, end } = getPeriodBounds('calendar-month', new Date('2026-09-28T08:00:00.000Z'), 'Asia/Tashkent');
    expect(start.toISOString()).toBe('2026-08-31T19:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-30T18:59:59.999Z');
  });
});

describe('sales opportunity rules', () => {
  it('flags close-to-tier, inactive and volume-drop clients from deterministic data', () => {
    const opportunities = getSalesOpportunities(customers, DEFAULT_LOYALTY_CONFIG, new Date('2026-09-28'));
    expect(opportunities.some((item) => item.type === 'NEAR_NEXT_TIER' || item.type === 'VERY_CLOSE_TO_NEXT_TIER')).toBe(true);
    expect(opportunities.some((item) => item.type === 'INACTIVE_CUSTOMER')).toBe(true);
    expect(opportunities.some((item) => item.type === 'VOLUME_DROP')).toBe(true);
  });
});

describe('eligible purchase metrics', () => {
  const makeOrder = (id: string, status: SalesOrder['status'], boxes: number): SalesOrder => ({ id, customerId: 'client-1', date: '2026-09-12', status, items: 1, boxes, total: boxes * 100_000, lines: [{ productId: 'p1', quantity: boxes, unitPrice: 100_000 }] });
  it('excludes drafts/in-transit/cancelled orders and subtracts returns', () => {
    const orders = [makeOrder('delivered', 'Yetkazildi', 110), makeOrder('draft', 'Yig‘ilmoqda', 40), makeOrder('cancelled', 'Bekor qilindi', 25)];
    expect(isOrderEligibleForLoyalty('Bekor qilindi')).toBe(false);
    const metrics = aggregatePurchaseMetrics('client-1', orders, new Date('2026-09-01T00:00:00Z'), new Date('2026-09-30T23:59:59Z'), 20, 20, 2_000_000);
    expect(metrics.orderCount).toBe(1);
    expect(metrics.grossRevenue).toBe(11_000_000);
    expect(metrics.netBoxes).toBe(90);
    expect(metrics.netUnits).toBe(90);
    expect(metrics.netRevenue).toBe(9_000_000);
  });
});

describe('portal reminders', () => {
  it('shows a factual next-tier gap reminder and a Friday greeting on Friday in Tashkent', () => {
    const notifications = getPortalNotifications({ role: 'CLIENT', customer: customers[0], customers, orders: [], config: DEFAULT_LOYALTY_CONFIG, now: new Date('2026-09-25T05:00:00.000Z') });
    expect(notifications.some((item) => item.kind === 'FRIDAY_GREETING' && item.title === 'Juma muborak!')).toBe(true);
    expect(notifications.some((item) => item.kind === 'NEAR_NEXT_TIER' && item.title.includes('18 quti'))).toBe(true);
  });

  it('does not show the Friday greeting on another weekday and routes manager reminders to client detail', () => {
    const clientNotifications = getPortalNotifications({ role: 'CLIENT', customer: customers[0], customers, orders: [], config: DEFAULT_LOYALTY_CONFIG, now: new Date('2026-09-28T07:00:00.000Z') });
    expect(clientNotifications.some((item) => item.kind === 'FRIDAY_GREETING')).toBe(false);
    const managerNotifications = getPortalNotifications({ role: 'SALES_MANAGER', customer: customers[0], customers, orders: [], config: DEFAULT_LOYALTY_CONFIG, now: new Date('2026-09-28T07:00:00.000Z') });
    expect(managerNotifications.length).toBeGreaterThan(0);
    expect(managerNotifications.every((item) => item.href.startsWith('/admin/clients/'))).toBe(true);
  });
});

describe('mock MoySklad provider contract', () => {
  it('serves catalog, stock-bearing products, companies and order history through the shared adapter', async () => {
    const [providerProducts, providerCustomers, providerOrders] = await Promise.all([
      mockMoySkladProvider.getProducts(),
      mockMoySkladProvider.getCustomers(),
      mockMoySkladProvider.getOrders(),
    ]);
    expect(mockMoySkladProvider.mode).toBe('mock');
    expect(providerProducts).toHaveLength(40);
    expect(providerProducts.every((product) => typeof product.stock === 'number')).toBe(true);
    expect(providerCustomers).toHaveLength(20);
    expect(providerOrders.length).toBeGreaterThanOrEqual(50);
  });
});

describe('customer isolation policy', () => {
  it('allows a client only their server-mapped MoySklad customer', () => {
    const principal = { subjectId: 'user-a', role: 'CLIENT' as const, moySkladCustomerId: 'company-a' };
    expect(() => authorizeCustomerAccess(principal, 'company-a')).not.toThrow();
    expect(() => authorizeCustomerAccess(principal, 'company-b')).toThrow(AccessDeniedError);
  });

  it('limits a sales manager to assigned customer ids', () => {
    const principal = { subjectId: 'manager-1', role: 'SALES_MANAGER' as const, assignedCustomerIds: ['company-a'] };
    expect(() => authorizeCustomerAccess(principal, 'company-b')).toThrow(AccessDeniedError);
  });
});

describe('pricing precedence', () => {
  const product: Product = { id: 'p1', name: 'Test', sku: 'T-1', category: 'Test', brand: 'Test', unit: 'quti', packBoxes: 1, price: 120_000, stock: 10, minOrder: 1, art: 'milk', description: 'Test', specialPrices: { 'client-1': 108_000 } };
  it('applies 5 percent discount using integer UZS', () => {
    const gold = calculateLoyaltySummary(100, DEFAULT_LOYALTY_CONFIG);
    const result = calculatePrice({ ...product, specialPrices: undefined }, gold);
    expect(result.finalPrice).toBe(114_000);
    expect(result.discountAmount).toBe(6_000);
    expect(result.priceSource).toBe('LOYALTY_PRICE');
  });

  it('uses a customer-specific negotiated price without stacking loyalty discount', () => {
    const gold = calculateLoyaltySummary(100, DEFAULT_LOYALTY_CONFIG);
    const special = calculatePrice(product, gold, 'client-1');
    const other = calculatePrice(product, gold, 'another-client');
    expect(special.finalPrice).toBe(108_000);
    expect(special.priceSource).toBe('CUSTOMER_SPECIAL');
    expect(special.discountPercent).toBe(0);
    expect(other.finalPrice).toBe(114_000);
  });
});
