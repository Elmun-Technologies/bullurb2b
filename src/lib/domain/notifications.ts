import type { Customer, LoyaltyConfig, Role, SalesOrder } from './types';
import { getLoyaltySummaryForCustomer } from './loyalty';
import { getSalesOpportunities } from './opportunities';
import { dateKeyInTimezone, isFridayInTimezone } from '@/lib/telegram/schedule';
import { uz } from '@/messages/uz';

export interface PortalNotification {
  id: string;
  kind: 'FRIDAY_GREETING' | 'NEAR_NEXT_TIER' | 'ORDER_UPDATE' | 'SALES_OPPORTUNITY';
  title: string;
  message: string;
  href: string;
  date: string;
}

export function getPortalNotifications(input: {
  role: Role;
  customer: Customer;
  customers: Customer[];
  orders: SalesOrder[];
  config: LoyaltyConfig;
  now?: Date;
}): PortalNotification[] {
  const { role, customer, customers, orders, config, now = new Date() } = input;
  const date = dateKeyInTimezone(now, config.timezone);
  const result: PortalNotification[] = [];

  if (role === 'CLIENT') {
    if (isFridayInTimezone(now, config.timezone)) {
      result.push({ id: `friday:${date}:${customer.id}`, kind: 'FRIDAY_GREETING', title: uz.reminders.fridayTitle, message: uz.reminders.fridayMessage(customer.name), href: '/dashboard', date });
    }
    const summary = getLoyaltySummaryForCustomer(customer, config);
    if (config.enabled && summary.nextTier && summary.progressPercent >= 80) {
      result.push({ id: `tier-gap:${date}:${customer.id}:${summary.nextTier.id}`, kind: 'NEAR_NEXT_TIER', title: uz.reminders.tierTitle(summary.nextTier.name, formatGap(summary.remaining, config.metric)), message: uz.reminders.tierMessage(formatGap(summary.currentValue, config.metric), summary.nextTier.name, summary.nextTier.discountPercent), href: '/loyalty', date });
    }
    orders.filter((order) => order.customerId === customer.id && ['Yangi', 'Yig‘ilmoqda', 'Yo‘lda'].includes(order.status))
      .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)
      .forEach((order) => result.push({ id: `order:${order.id}:${order.status}`, kind: 'ORDER_UPDATE', title: uz.reminders.orderTitle(order.id, order.status), message: uz.reminders.orderMessage(order.boxes, formatUZS(order.total)), href: `/orders/${encodeURIComponent(order.id)}`, date: order.date }));
    return result;
  }

  const opportunities = getSalesOpportunities(customers, config, now)
    .filter((opportunity) => opportunity.priority === 'Yuqori')
    .slice(0, 5);
  opportunities.forEach((opportunity) => result.push({
    id: `sales:${date}:${opportunity.customer.id}:${opportunity.type}`,
    kind: 'SALES_OPPORTUNITY',
    title: `${opportunity.customer.name} · ${opportunity.headline}`,
    message: opportunity.action,
    href: `/admin/clients/${opportunity.customer.id}`,
    date,
  }));
  return result;
}

function formatGap(value: number, metric: LoyaltyConfig['metric']): string {
  return metric === 'boxes' ? `${value.toLocaleString('uz-UZ')} quti` : `${new Intl.NumberFormat('uz-UZ').format(value)} so‘m`;
}

function formatUZS(value: number): string {
  return `${new Intl.NumberFormat('uz-UZ', { maximumFractionDigits: 0 }).format(Math.round(value))} so‘m`;
}
