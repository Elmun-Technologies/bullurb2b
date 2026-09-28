export type MetricType = 'boxes' | 'turnover';
export type PeriodType = 'calendar-month' | 'last-30-days' | 'last-90-days';
export type Role = 'ADMIN' | 'SALES_MANAGER' | 'CLIENT';
export type StockState = 'in_stock' | 'low_stock' | 'out_of_stock';
export type OrderStatus = 'Yangi' | 'Yig‘ilmoqda' | 'Yo‘lda' | 'Yetkazildi' | 'Bekor qilindi';
export type PriceSource = 'CUSTOMER_SPECIAL' | 'B2B_PRICE' | 'LOYALTY_PRICE';

export interface LoyaltyTier {
  id: string;
  name: string;
  minValue: number;
  discountPercent: number;
  color: string;
  description: string;
  active: boolean;
}

export interface LoyaltyConfig {
  enabled: boolean;
  metric: MetricType;
  period: PeriodType;
  timezone: string;
  bonusSystemEnabled: boolean;
  tiers: LoyaltyTier[];
}

export interface Customer {
  id: string;
  name: string;
  region: string;
  contactName: string;
  email: string;
  phone: string;
  tierId?: string;
  tierIdByMetric?: Partial<Record<MetricType, string>>;
  currentBoxes: number;
  currentTurnover: number;
  metricsByPeriod?: Partial<Record<PeriodType, { boxes: number; turnover: number }>>;
  previousBoxes: number;
  previousTurnover?: number;
  lastPurchase: string;
  manager: string;
  active: boolean;
}

export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  brand: string;
  unit: string;
  packBoxes: number;
  price: number;
  specialPrices?: Record<string, number>;
  stock: number;
  minOrder: number;
  art: string;
  description: string;
}

export interface OrderLine {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface SalesOrder {
  id: string;
  customerId: string;
  date: string;
  status: OrderStatus;
  items: number;
  boxes: number;
  total: number;
  lines: OrderLine[];
}

export interface CustomerPurchaseMetrics {
  customerId: string;
  periodStart: string;
  periodEnd: string;
  orderCount: number;
  totalUnits: number;
  totalBoxes: number;
  grossRevenue: number;
  returnedUnits: number;
  returnedBoxes: number;
  netUnits: number;
  netBoxes: number;
  netRevenue: number;
}

export interface LoyaltySummary {
  currentTier: LoyaltyTier;
  nextTier: LoyaltyTier | null;
  currentValue: number;
  nextThreshold: number | null;
  remaining: number;
  progressPercent: number;
  discountPercent: number;
  metric: MetricType;
}

export interface PriceResult {
  basePrice: number;
  finalPrice: number;
  priceSource: PriceSource;
  loyaltyTier: string;
  discountPercent: number;
  discountAmount: number;
  savingsAmount: number;
}

export interface Opportunity {
  customer: Customer;
  type: 'VERY_CLOSE_TO_NEXT_TIER' | 'NEAR_NEXT_TIER' | 'INACTIVE_CUSTOMER' | 'VOLUME_DROP' | 'TIER_DOWNGRADE_RISK';
  priority: 'Yuqori' | 'O‘rta';
  headline: string;
  detail: string;
  action: string;
  progress?: number;
  targetValue?: number;
}
