import type { Customer, CustomerPurchaseMetrics, LoyaltyConfig, LoyaltySummary, LoyaltyTier, OrderStatus, PeriodType, SalesOrder } from './types';

export const DEFAULT_TIERS: LoyaltyTier[] = [
  { id: 'standard', name: 'Standard', minValue: 0, discountPercent: 0, color: '#97a3b8', description: 'Hamkorlikning boshlang‘ich darajasi', active: true },
  { id: 'silver', name: 'Silver', minValue: 50, discountPercent: 3, color: '#8193ad', description: 'Barqaror xaridlar uchun', active: true },
  { id: 'gold', name: 'Gold', minValue: 100, discountPercent: 5, color: '#bd9153', description: 'Faol hamkorlar uchun', active: true },
  { id: 'platinum', name: 'Platinum', minValue: 200, discountPercent: 7, color: '#697d9b', description: 'Yuqori hajmli hamkorlar uchun', active: true },
  { id: 'vip', name: 'VIP', minValue: 500, discountPercent: 10, color: '#7458a4', description: 'Strategik hamkorlar uchun', active: true },
];

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  enabled: true,
  metric: 'boxes',
  period: 'calendar-month',
  timezone: 'Asia/Tashkent',
  bonusSystemEnabled: false,
  tiers: DEFAULT_TIERS,
};

export function validateTiers(tiers: LoyaltyTier[]): string[] {
  const errors: string[] = [];
  const active = tiers.filter((tier) => tier.active);
  if (!active.length) errors.push('Kamida bitta faol bosqich bo‘lishi kerak.');
  if (active.length && active[0].minValue !== 0) errors.push('Birinchi faol bosqich 0 dan boshlanishi kerak.');
  if (new Set(active.map((tier) => tier.id)).size !== active.length) errors.push('Bosqich identifikatorlari takrorlanmasligi kerak.');
  if (new Set(active.map((tier) => tier.name.trim().toLowerCase())).size !== active.length) errors.push('Bosqich nomlari takrorlanmasligi kerak.');
  for (let i = 0; i < active.length; i += 1) {
    const tier = active[i];
    if (!tier.name.trim()) errors.push('Bosqich nomi bo‘sh bo‘lishi mumkin emas.');
    if (!Number.isInteger(tier.minValue) || tier.minValue < 0) errors.push(`${tier.name}: chegara manfiy bo‘lmagan butun son bo‘lishi kerak.`);
    if (i > 0 && tier.minValue <= active[i - 1].minValue) errors.push('Chegaralar takrorlanmasligi va o‘sib borishi kerak.');
    if (!Number.isInteger(tier.discountPercent) || tier.discountPercent < 0 || tier.discountPercent > 100) errors.push(`${tier.name}: chegirma 0–100% oralig‘idagi butun son bo‘lishi kerak.`);
    if (typeof tier.color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(tier.color)) errors.push(`${tier.name}: rang #RRGGBB formatida bo‘lishi kerak.`);
  }
  return [...new Set(errors)];
}

export function isValidLoyaltyConfig(value: unknown): value is LoyaltyConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<LoyaltyConfig>;
  if (typeof candidate.enabled !== 'boolean' || typeof candidate.bonusSystemEnabled !== 'boolean' || typeof candidate.timezone !== 'string') return false;
  if (candidate.metric !== 'boxes' && candidate.metric !== 'turnover') return false;
  if (candidate.period !== 'calendar-month' && candidate.period !== 'last-30-days' && candidate.period !== 'last-90-days') return false;
  if (!Array.isArray(candidate.tiers) || !candidate.tiers.every((tier) => tier && typeof tier.id === 'string' && typeof tier.name === 'string' && typeof tier.description === 'string' && typeof tier.active === 'boolean' && typeof tier.minValue === 'number' && typeof tier.discountPercent === 'number' && typeof tier.color === 'string')) return false;
  return validateTiers(candidate.tiers).length === 0;
}

export function getTierForValue(value: number, tiers: LoyaltyTier[]): LoyaltyTier {
  const active = tiers.filter((tier) => tier.active).slice().sort((a, b) => a.minValue - b.minValue);
  if (!active.length) throw new Error('At least one active loyalty tier is required.');
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  return active.reduce((chosen, tier) => safeValue >= tier.minValue ? tier : chosen, active[0]);
}

export function calculateLoyaltySummary(value: number, config: LoyaltyConfig): LoyaltySummary {
  const active = config.tiers.filter((tier) => tier.active).slice().sort((a, b) => a.minValue - b.minValue);
  if (!active.length) throw new Error('At least one active loyalty tier is required.');
  const safeValue = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
  const currentTier = getTierForValue(safeValue, active);
  const index = active.findIndex((tier) => tier.id === currentTier.id);
  const nextTier = active[index + 1] ?? null;
  const nextThreshold = nextTier?.minValue ?? null;
  const remaining = nextThreshold === null ? 0 : Math.max(0, nextThreshold - safeValue);
  const progressPercent = nextTier === null ? 100 : Math.min(100, Math.max(0, Math.round((safeValue / nextThreshold) * 100)));
  return { currentTier, nextTier, currentValue: safeValue, nextThreshold, remaining, progressPercent, discountPercent: config.enabled ? currentTier.discountPercent : 0, metric: config.metric };
}

export function evaluateTierChange(previousTierId: string, purchaseValue: number, config: LoyaltyConfig, isNewPeriodStart = false): LoyaltyTier {
  const earned = getTierForValue(purchaseValue, config.tiers);
  const previous = config.tiers.find((tier) => tier.id === previousTierId && tier.active);
  if (!previous || earned.minValue >= previous.minValue || isNewPeriodStart) return earned;
  return previous;
}

export function isOrderEligibleForLoyalty(status: OrderStatus): boolean {
  return status === 'Yetkazildi';
}

export function aggregatePurchaseMetrics(customerId: string, orders: SalesOrder[], periodStart: Date, periodEnd: Date, returnedBoxes = 0, returnedUnits = 0, returnedRevenue = 0): CustomerPurchaseMetrics {
  const relevant = orders.filter((order) => order.customerId === customerId && isOrderEligibleForLoyalty(order.status) && new Date(order.date) >= periodStart && new Date(order.date) <= periodEnd);
  const grossRevenue = relevant.reduce((sum, order) => sum + order.total, 0);
  const totalBoxes = relevant.reduce((sum, order) => sum + order.boxes, 0);
  const totalUnits = relevant.reduce((sum, order) => sum + order.lines.reduce((lineSum, line) => lineSum + line.quantity, 0), 0);
  return { customerId, periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), orderCount: relevant.length, totalUnits, totalBoxes, grossRevenue, returnedUnits, returnedBoxes, netUnits: Math.max(0, totalUnits - returnedUnits), netBoxes: Math.max(0, totalBoxes - returnedBoxes), netRevenue: Math.max(0, grossRevenue - returnedRevenue) };
}

export function getCustomerMetricValue(customer: Customer, config: LoyaltyConfig): number {
  const snapshot = customer.metricsByPeriod?.[config.period];
  if (snapshot) return config.metric === 'boxes' ? snapshot.boxes : snapshot.turnover;
  return config.metric === 'boxes' ? customer.currentBoxes : customer.currentTurnover;
}

export function getLoyaltySummaryForCustomer(customer: Customer, config: LoyaltyConfig, isNewPeriodStart = false): LoyaltySummary {
  const earned = calculateLoyaltySummary(getCustomerMetricValue(customer, config), config);
  const previousTierId = customer.tierIdByMetric?.[config.metric] ?? customer.tierId;
  if (isNewPeriodStart || !previousTierId) return earned;
  const heldTier = config.tiers.find((tier) => tier.id === previousTierId && tier.active);
  if (!heldTier || earned.currentTier.minValue >= heldTier.minValue) return earned;
  const active = config.tiers.filter((tier) => tier.active).slice().sort((a, b) => a.minValue - b.minValue);
  const nextTier = active[active.findIndex((tier) => tier.id === heldTier.id) + 1] ?? null;
  const nextThreshold = nextTier?.minValue ?? null;
  const remaining = nextThreshold === null ? 0 : Math.max(0, nextThreshold - earned.currentValue);
  const progressPercent = nextThreshold === null ? 100 : Math.min(100, Math.round((earned.currentValue / nextThreshold) * 100));
  return { ...earned, currentTier: heldTier, nextTier, nextThreshold, remaining, progressPercent, discountPercent: config.enabled ? heldTier.discountPercent : 0 };
}

export function getPeriodBounds(period: PeriodType, now = new Date(), timezone = 'Asia/Tashkent'): { start: Date; end: Date } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  let start: Date;
  let end: Date;
  if (period === 'last-30-days' || period === 'last-90-days') {
    const days = period === 'last-30-days' ? 30 : 90;
    const firstDay = new Date(Date.UTC(year, month - 1, day - days + 1));
    start = zonedDateToUtc(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate(), timezone);
    const tomorrow = new Date(Date.UTC(year, month - 1, day + 1));
    end = new Date(zonedDateToUtc(tomorrow.getUTCFullYear(), tomorrow.getUTCMonth(), tomorrow.getUTCDate(), timezone).getTime() - 1);
    return { start, end };
  }
  start = zonedDateToUtc(year, month - 1, 1, timezone);
  end = new Date(zonedDateToUtc(year, month, 1, timezone).getTime() - 1);
  return { start, end };
}

function zonedDateToUtc(year: number, monthIndex: number, day: number, timezone: string): Date {
  const target = new Date(Date.UTC(year, monthIndex, day));
  const formatted = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' }).formatToParts(target);
  const values = Object.fromEntries(formatted.map((part) => [part.type, Number(part.value)]));
  const asUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second);
  return new Date(target.getTime() + (target.getTime() - asUtc));
}
