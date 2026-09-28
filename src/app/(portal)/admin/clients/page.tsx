'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, ArrowRight, Building2, ChevronDown, Search, Users } from 'lucide-react';
import { getLoyaltySummaryForCustomer } from '@/lib/domain/loyalty';
import { formatDate } from '@/lib/format/dates';
import { formatUZS } from '@/lib/domain/pricing';
import { PageHeading, TierBadge } from '@/components/ui';
import { usePortal } from '@/components/portal-context';

export default function AdminClientsPage() {
  const { config, allCustomers } = usePortal();
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState('all');
  const [regionFilter, setRegionFilter] = useState('all');
  const [sort, setSort] = useState('progress');
  useEffect(() => {
    const tier = new URLSearchParams(window.location.search).get('tier');
    if (tier && config.tiers.some((item) => item.id === tier)) setTierFilter(tier);
  }, [config.tiers]);
  const regions = [...new Set(allCustomers.map((customer) => customer.region))];
  const rows = useMemo(() => allCustomers.map((customer) => ({ customer, summary: getLoyaltySummaryForCustomer(customer, config) })).filter(({ customer, summary }) => customer.name.toLowerCase().includes(search.toLowerCase()) && (tierFilter === 'all' || summary.currentTier.id === tierFilter) && (regionFilter === 'all' || customer.region === regionFilter)).sort((a, b) => sort === 'volume' ? getLoyaltySummaryForCustomer(b.customer, config).currentValue - getLoyaltySummaryForCustomer(a.customer, config).currentValue : sort === 'name' ? a.customer.name.localeCompare(b.customer.name) : (b.summary.progressPercent - a.summary.progressPercent)), [allCustomers, config, search, tierFilter, regionFilter, sort]);
  return <>
    <PageHeading eyebrow="B2B MIJOZLAR BAZASI" title="Mijozlar" description="Hamkor kompaniyalar xaridi, sodiqlik darajasi va savdo imkoniyatlari." actions={<span className="client-count-chip"><Users size={15} /> {allCustomers.length} hamkor</span>} />
    <div className="admin-filter-toolbar"><label className="search-field compact-search"><Search size={16} /><input placeholder="Kompaniya nomi bo‘yicha qidirish..." aria-label="Kompaniya qidirish" value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="select-filter"><TierIcon /><select aria-label="Daraja bo‘yicha filtr" value={tierFilter} onChange={(event) => setTierFilter(event.target.value)}><option value="all">Barcha darajalar</option>{config.tiers.filter((tier) => tier.active).map((tier) => <option value={tier.id} key={tier.id}>{tier.name}</option>)}</select><ChevronDown size={14} /></label><label className="select-filter region-filter"><select aria-label="Hudud bo‘yicha filtr" value={regionFilter} onChange={(event) => setRegionFilter(event.target.value)}><option value="all">Barcha hududlar</option>{regions.map((region) => <option key={region}>{region}</option>)}</select><ChevronDown size={14} /></label><button className="sort-button" onClick={() => setSort((value) => value === 'progress' ? 'volume' : value === 'volume' ? 'name' : 'progress')}><ArrowDownUp size={14} /> {sort === 'progress' ? 'Progress bo‘yicha' : sort === 'volume' ? 'Hajm bo‘yicha' : 'Nomi bo‘yicha'}</button></div>
    <section className="surface client-list-card"><div className="table-scroll"><table className="data-table client-table"><thead><tr><th>KOMPANIYA</th><th>HUDUD</th><th>DARAJA</th><th>JORIY OY</th><th>CHEGIRMA</th><th>KEYINGI DARAJA</th><th>OXIRGI XARID</th><th /></tr></thead><tbody>{rows.map(({ customer, summary }) => <tr key={customer.id}><td><Link className="client-name-cell" href={`/admin/clients/${customer.id}`}><span className="company-mini-avatar">{customer.name.slice(0, 1)}</span><span><b>{customer.name}</b><small>{customer.id.toUpperCase()}</small></span></Link></td><td>{customer.region}</td><td><TierBadge tier={summary.currentTier} /></td><td><span className="volume-cell"><b>{config.metric === 'boxes' ? `${summary.currentValue} quti` : formatUZS(summary.currentValue)}</b><span className="mini-progress"><i style={{ width: `${summary.progressPercent}%` }} /></span></span></td><td><b className="discount-cell">{summary.discountPercent}%</b></td><td>{summary.nextTier ? <span className="next-tier-cell"><b>{config.metric === 'boxes' ? `${summary.remaining} quti` : formatUZS(summary.remaining)}</b><small>→ {summary.nextTier.name}</small></span> : <span className="muted-cell">Eng yuqori daraja</span>}</td><td>{formatDate(customer.lastPurchase)}</td><td><Link href={`/admin/clients/${customer.id}`} className="table-arrow" aria-label={`${customer.name} tafsilotlari`}><ArrowRight size={15} /></Link></td></tr>)}</tbody></table></div>{rows.length === 0 ? <div className="table-empty">Qidiruv bo‘yicha mijoz topilmadi.</div> : null}<div className="table-pagination"><span>1–{rows.length} / {rows.length} hamkor</span><button disabled>Oldingi</button><button disabled>Keyingi</button></div></section>
  </>;
}
function TierIcon() { return <Building2 size={14} />; }
