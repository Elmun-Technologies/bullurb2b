'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, ChevronDown, CircleAlert, Clock3, Phone, Search, Sparkles, TrendingDown } from 'lucide-react';
import { getSalesOpportunities } from '@/lib/domain/opportunities';
import { getLoyaltySummaryForCustomer } from '@/lib/domain/loyalty';
import { formatUZS } from '@/lib/domain/pricing';
import { usePortal } from '@/components/portal-context';
import { PageHeading, TierBadge } from '@/components/ui';

export default function OpportunitiesPage() {
  const { config, allCustomers } = usePortal();
  const [filter, setFilter] = useState('Barchasi');
  const [search, setSearch] = useState('');
  const opportunities = useMemo(() => getSalesOpportunities(allCustomers, config, new Date('2026-09-28')).filter((item) => item.customer.name.toLowerCase().includes(search.toLowerCase()) && (filter === 'Barchasi' || filter === item.type)), [allCustomers, config, filter, search]);
  const types = ['Barchasi', 'VERY_CLOSE_TO_NEXT_TIER', 'NEAR_NEXT_TIER', 'TIER_DOWNGRADE_RISK', 'INACTIVE_CUSTOMER', 'VOLUME_DROP'];
  const labels: Record<string, string> = { Barchasi: 'Barchasi', VERY_CLOSE_TO_NEXT_TIER: 'Keyingi darajaga juda yaqin', NEAR_NEXT_TIER: 'Keyingi darajaga yaqin', TIER_DOWNGRADE_RISK: 'Darajani saqlab qolish', INACTIVE_CUSTOMER: 'Faol emas', VOLUME_DROP: 'Xarid pasayishi' };
  const highCount = opportunities.filter((item) => item.priority === 'Yuqori').length;
  return <>
    <PageHeading eyebrow="SAVDO JAMOASI UCHUN" title="Savdo imkoniyatlari" description="Mijozlar bilan faol ishlash uchun aniq va qoidaga asoslangan tavsiyalar." actions={<span className="opportunity-count-chip"><Sparkles size={15} /> {opportunities.length} imkoniyat</span>} />
    <div className="opportunity-overview"><span className="opportunity-overview-icon"><CircleAlert size={18} /></span><span><b>{highCount} ta yuqori ustuvor vazifa</b><small>Mijozning amaldagi xaridlari va sodiqlik chegaralari asosida.</small></span><span className="opportunity-live-status"><i /> QOIDAGA ASOSLANGAN</span></div>
    <div className="opportunity-filter-bar"><label className="search-field compact-search"><Search size={16} /><input placeholder="Mijoz nomi..." aria-label="Mijoz nomi bo‘yicha qidirish" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="select-filter"><Sparkles size={14} /><select aria-label="Imkoniyat turi" value={filter} onChange={(event) => setFilter(event.target.value)}>{types.map((type) => <option value={type} key={type}>{labels[type]}</option>)}</select><ChevronDown size={14} /></label><span className="results-count">{opportunities.length} natija</span></div>
    <div className="opportunity-card-list">{opportunities.map((item, index) => {
      const summary = getLoyaltySummaryForCustomer(item.customer, config);
      const icon = item.type === 'INACTIVE_CUSTOMER' ? <Clock3 size={17} /> : item.type === 'VOLUME_DROP' ? <TrendingDown size={17} /> : item.type === 'TIER_DOWNGRADE_RISK' ? <CircleAlert size={17} /> : <Sparkles size={17} />;
      return <article className="surface opportunity-card" key={`${item.customer.id}-${item.type}`}><div className={`opportunity-type-icon ${item.priority === 'Yuqori' ? 'urgent' : ''}`}>{icon}</div><div className="opportunity-card-main"><div className="opportunity-card-tags"><span className={`priority-badge ${item.priority === 'Yuqori' ? 'high' : ''}`}><i /> {item.priority} ustuvorlik</span><span className="opportunity-type-label">{labels[item.type]}</span></div><Link href={`/admin/clients/${item.customer.id}`} className="opportunity-company-name">{item.customer.name}<ArrowRight size={15} /></Link><p>{item.detail}</p>{item.progress !== undefined ? <div className="opportunity-progress-wrap"><div className="opportunity-progress-label"><span>{config.metric === 'boxes' ? `${summary.currentValue} / ${item.targetValue ?? summary.nextThreshold} quti` : `${formatUZS(summary.currentValue)} / ${formatUZS(item.targetValue ?? summary.nextThreshold ?? 0)}`}</span><span>{item.progress}%</span></div><div className="mini-progress"><i style={{ width: `${item.progress}%` }} /></div></div> : null}<div className="opportunity-action"><b>Keyingi qadam</b><span>{item.action}</span></div></div><div className="opportunity-card-side"><TierBadge tier={summary.currentTier} /><span className="opportunity-next-tier">{item.type === 'TIER_DOWNGRADE_RISK' ? `${config.metric === 'boxes' ? `${Math.max(0, (item.targetValue ?? 0) - summary.currentValue)} quti` : formatUZS(Math.max(0, (item.targetValue ?? 0) - summary.currentValue))} → ${summary.currentTier.name}ni saqlash` : summary.nextTier ? `${config.metric === 'boxes' ? `${summary.remaining} quti` : formatUZS(summary.remaining)} → ${summary.nextTier.name}` : 'Faollikni tiklash'}</span><a href={`tel:${item.customer.phone}`} className="button secondary small"><Phone size={14} /> Qo‘ng‘iroq qilish</a></div><span className="opportunity-index">{String(index + 1).padStart(2, '0')}</span></article>;
    })}</div>{!opportunities.length ? <div className="empty-state"><span className="empty-icon"><Sparkles size={22} /></span><h3>Imkoniyat topilmadi</h3><p>Tanlangan tur bo‘yicha mijozlar yo‘q.</p></div> : null}
  </>;
}
