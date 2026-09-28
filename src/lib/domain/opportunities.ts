import type { Customer, LoyaltyConfig, Opportunity } from './types';
import { calculateLoyaltySummary, getCustomerMetricValue, getLoyaltySummaryForCustomer } from './loyalty';

export function getSalesOpportunities(customers: Customer[], config: LoyaltyConfig, today = new Date()): Opportunity[] {
  const opportunities: Opportunity[] = [];
  for (const customer of customers) {
    const currentValue = getCustomerMetricValue(customer, config);
    const summary = getLoyaltySummaryForCustomer(customer, config);
    const earnedTier = calculateLoyaltySummary(currentValue, config).currentTier;

    if (summary.nextTier && summary.progressPercent >= 80) {
      const veryClose = summary.progressPercent >= 90;
      const gap = config.metric === 'boxes' ? `${summary.remaining} quti` : `${new Intl.NumberFormat('uz-UZ').format(summary.remaining)} so‘m`;
      opportunities.push({ customer, type: veryClose ? 'VERY_CLOSE_TO_NEXT_TIER' : 'NEAR_NEXT_TIER', priority: veryClose ? 'Yuqori' : 'O‘rta', headline: `${gap} orqali ${summary.nextTier.name}`, detail: `Mijoz ${summary.progressPercent}% yo‘lda. Hozir ${config.metric === 'boxes' ? `${summary.currentValue} / ${summary.nextThreshold} quti` : `${new Intl.NumberFormat('uz-UZ').format(summary.currentValue)} / ${new Intl.NumberFormat('uz-UZ').format(summary.nextThreshold ?? 0)} so‘m`}.`, action: `Keyingi buyurtmaga kamida ${gap} qo‘shishni taklif qiling.`, progress: summary.progressPercent, targetValue: summary.nextThreshold ?? undefined });
    }

    const previousTierId = customer.tierIdByMetric?.[config.metric] ?? customer.tierId;
    const heldTier = config.tiers.find((tier) => tier.id === previousTierId && tier.active);
    if (heldTier && earnedTier.minValue < heldTier.minValue) {
      const keepProgress = Math.min(100, Math.round(currentValue / Math.max(heldTier.minValue, 1) * 100));
      const remaining = Math.max(0, heldTier.minValue - currentValue);
      const unit = config.metric === 'boxes' ? `${remaining} quti` : `${new Intl.NumberFormat('uz-UZ').format(remaining)} so‘m`;
      opportunities.push({ customer, type: 'TIER_DOWNGRADE_RISK', priority: keepProgress < 50 ? 'Yuqori' : 'O‘rta', headline: `${heldTier.name} darajasini saqlab qolish`, detail: `Bu davrda ${config.metric === 'boxes' ? `${currentValue} / ${heldTier.minValue} quti` : `${new Intl.NumberFormat('uz-UZ').format(currentValue)} / ${new Intl.NumberFormat('uz-UZ').format(heldTier.minValue)} so‘m`} xarid qilingan. Davr shu holatda yakunlansa, keyingi davrda daraja pasayishi mumkin.`, action: `Joriy darajani saqlash uchun yana ${unit} xarid kerak.`, progress: keepProgress, targetValue: heldTier.minValue });
    }

    const idleDays = Math.floor((today.getTime() - new Date(customer.lastPurchase).getTime()) / 86_400_000);
    if (idleDays >= 30) opportunities.push({ customer, type: 'INACTIVE_CUSTOMER', priority: idleDays >= 60 ? 'Yuqori' : 'O‘rta', headline: `${idleDays} kundan beri xarid yo‘q`, detail: 'Oxirgi xariddan beri faollik kuzatilmadi.', action: 'Mijoz bilan bog‘lanib, qayta buyurtma rejasini aniqlang.' });
    const previousValue = config.metric === 'boxes' ? customer.previousBoxes : (customer.previousTurnover ?? 0);
    if (previousValue > 0 && currentValue < previousValue * 0.65) {
      opportunities.push({ customer, type: 'VOLUME_DROP', priority: 'O‘rta', headline: 'Xarid hajmi kamaygan', detail: `Joriy hajm oldingi taqqoslanadigan davrdan ${Math.round((1 - currentValue / previousValue) * 100)}% kam.`, action: 'Xarid dinamikasini tekshirib, kerakli mahsulotlarni taklif qiling.' });
    }
  }
  const order = { VERY_CLOSE_TO_NEXT_TIER: 0, NEAR_NEXT_TIER: 1, TIER_DOWNGRADE_RISK: 2, INACTIVE_CUSTOMER: 3, VOLUME_DROP: 4 };
  return opportunities.sort((a, b) => (order[a.type] - order[b.type]) || (b.progress ?? 0) - (a.progress ?? 0));
}
