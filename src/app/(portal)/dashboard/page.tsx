'use client';

import Link from 'next/link';
import { ArrowRight, ArrowUpRight, Box, CalendarDays, ChevronRight, CircleDollarSign, Clock3, PackageCheck, ShoppingCart, Sparkles, TrendingUp } from 'lucide-react';
import { PageHeading, LoyaltyProgress, TierBadge, StatCard, OrderStatusBadge } from '@/components/ui';
import { usePortal } from '@/components/portal-context';
import { customers } from '@/lib/domain/mock-data';
import { calculateLoyaltySummary } from '@/lib/domain/loyalty';
import { formatUZS } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/format/dates';

export default function DashboardPage() {
  const { config, customerBoxes, customerTurnover, allOrders, allCustomers } = usePortal();
  const value = config.metric === 'boxes' ? customerBoxes : customerTurnover;
  const summary = calculateLoyaltySummary(value, config);
  const recentOrders = allOrders.filter((order) => order.customerId === customers[0].id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  const monthTurnover = customerTurnover;
  const weekHeights = [42, 55, 48, 70, 61, 81, 68];
  const calendarMonthBoxes = allCustomers[0].currentBoxes;

  return <>
    <PageHeading eyebrow="DUSHANBA, 28-SENTABR 2026" title={<>Xayrli kun, <span className="heading-accent">Samarqand Market</span></>} description="Hamkorlik holati va buyurtmalaringiz — barchasi bir joyda." actions={<Link href="/catalog" className="button primary"><ShoppingCart size={17} /> Buyurtma berish <ArrowRight size={16} /></Link>} />
    <section className="dashboard-hero">
      <div className="hero-orbit orbit-one" /><div className="hero-orbit orbit-two" />
      <div className="hero-main">
        <div className="hero-eyebrow"><span className="hero-star">✦</span> SIZNING HAMKORLIK DARAJANGIZ</div>
        <div className="hero-title-row"><h2>{summary.currentTier.name}</h2><TierBadge tier={summary.currentTier} size="large" /></div>
        <p className="hero-subtitle">Har bir xarid sizni yangi imkoniyatlarga yaqinlashtiradi.</p>
        <div className="hero-progress"><LoyaltyProgress summary={summary} /></div>
        <div className="hero-benefit"><span className="benefit-icon"><Sparkles size={15} /></span><span>{summary.nextTier ? <><strong>{summary.nextTier.name} darajasiga o‘ting</strong> — chegirmangiz <b>{summary.nextTier.discountPercent}%</b> gacha oshadi</> : 'Siz eng yuqori hamkorlik darajasiga yetdingiz!'}</span></div>
      </div>
      <div className="hero-aside"><div className="discount-label">SIZNING CHEGIRMANGIZ</div><div className="hero-discount">{summary.discountPercent}<span>%</span></div><div className="hero-discount-caption">barcha ulgurji buyurtmalarga</div><div className="hero-aside-divider" /><div className="hero-aside-foot"><span className="hero-check"><PackageCheck size={15} /></span><span>Shaxsiy narxlar<br /><b>faol</b></span></div></div>
    </section>

    <div className="stat-grid four">
      <StatCard label="Tanlangan davr xaridi" value={config.metric === 'boxes' ? `${value.toLocaleString('uz-UZ')} quti` : formatUZS(value)} note={config.period === 'calendar-month' ? 'Sentyabr oyi · bajarildi' : config.period === 'last-30-days' ? 'Oxirgi 30 kun · bajarildi' : 'Oxirgi 90 kun · bajarildi'} icon={<Box size={18} />} tone="mint" />
      <StatCard label={config.metric === 'boxes' ? 'Xarid aylanmasi' : 'Xarid qilingan qutilar'} value={config.metric === 'boxes' ? formatUZS(monthTurnover) : `${customerBoxes.toLocaleString('uz-UZ')} quti`} note="Tanlangan hisob-kitob davri" icon={<CircleDollarSign size={18} />} tone="blue" />
      <StatCard label="Keyingi bosqich" value={summary.nextTier?.name ?? 'VIP'} note={summary.nextTier ? `${summary.remaining} quti qoldi` : 'Eng yuqori daraja'} icon={<TrendingUp size={18} />} tone="amber" />
      <StatCard label="Faol buyurtmalar" value={String(allOrders.filter((order) => order.customerId === customers[0].id && !['Yetkazildi', 'Bekor qilindi'].includes(order.status)).length)} note="Yetkazish jarayonida" icon={<ShoppingCart size={18} />} tone="violet" />
    </div>

    <div className="dashboard-grid">
      <section className="surface chart-card">
        <div className="section-header"><div><div className="section-kicker">XARIDLAR</div><h3>Oy davomidagi faollik</h3></div><button className="period-chip"><CalendarDays size={14} /> Shu oy <ChevronRight size={14} /></button></div>
        <div className="chart-summary"><strong>{calendarMonthBoxes} <small>quti</small></strong><span className="trend-positive"><ArrowUpRight size={14} /> 12.8% <span>o‘tgan oyga nisbatan</span></span></div>
        <div className="bar-chart" aria-label="Haftalik xarid hajmi ustunli diagrammasi">{weekHeights.map((height, index) => <div className="bar-column" key={index}><div className={`bar ${index === 5 ? 'bar-current' : ''}`} style={{ height: `${height}%` }}><span>{[12, 18, 14, 26, 21, 32, 28][index]}</span></div><small>{['1-4', '5-8', '9-12', '13-16', '17-20', '21-24', '25-28'][index]}</small></div>)}</div>
        <div className="chart-foot"><span><i className="chart-legend-dot" /> Buyurtma qilingan qutilar</span><Link href="/orders">Buyurtmalar tarixi <ArrowRight size={14} /></Link></div>
      </section>
      <section className="surface next-level-card">
        <div className="section-header"><div><div className="section-kicker">SIZ UCHUN KEYINGI QADAM</div><h3>Yangi imkoniyatlar</h3></div><span className="spark-icon"><Sparkles size={16} /></span></div>
        {summary.nextTier ? <><div className="next-tier-display"><span className="next-tier-seal" style={{ color: summary.nextTier.color }}>◆</span><span><small>KEYINGI DARAJA</small><strong>{summary.nextTier.name}</strong></span><span className="next-tier-rate">{summary.nextTier.discountPercent}%<small>chegirma</small></span></div><div className="next-tier-remaining"><b>{config.metric === 'boxes' ? summary.remaining.toLocaleString('uz-UZ') : formatUZS(summary.remaining)}</b><span>{config.metric === 'boxes' ? 'quti' : 'miqdor'} xarid qilsangiz<br /><strong>{summary.nextTier.name}</strong> darajasiga o‘tasiz</span></div><LoyaltyProgress summary={summary} compact /><Link href="/catalog" className="button subtle full">Mahsulotlarni ko‘rish <ArrowRight size={15} /></Link></> : <div className="vip-message"><Sparkles size={25} /><strong>VIP hamkorsiz</strong><span>Siz barcha mavjud imtiyozlarga egasiz.</span></div>}
      </section>
    </div>

    <div className="dashboard-grid lower-grid">
      <section className="surface table-card"><div className="section-header"><div><div className="section-kicker">SO‘NGGI FAOLLIK</div><h3>Oxirgi buyurtmalar</h3></div><Link href="/orders" className="text-link">Barchasini ko‘rish <ArrowRight size={14} /></Link></div><OrdersTable orders={recentOrders} /></section>
      <section className="surface benefits-card"><div className="section-header"><div><div className="section-kicker">HAMKORLIK IMTIYOZLARI</div><h3>Sizga taqdim etiladi</h3></div></div><div className="benefit-list"><div className="benefit-item"><span className="benefit-list-icon mint-icon"><TagsIcon /></span><span><b>{summary.discountPercent}% ulgurji chegirma</b><small>{summary.currentTier.name} daraja uchun</small></span><i className="benefit-active">Faol</i></div><div className="benefit-item"><span className="benefit-list-icon blue-icon"><PackageCheck size={17} /></span><span><b>Shaxsiy hamkor narxlari</b><small>Kelishilgan narxlar saqlangan</small></span><i className="benefit-active">Faol</i></div><div className="benefit-item"><span className="benefit-list-icon amber-icon"><Clock3 size={17} /></span><span><b>Buyurtma kuzatuvi</b><small>Yetkazish holatini ko‘ring</small></span><ArrowRight size={15} className="benefit-arrow" /></div></div><Link href="/loyalty" className="benefits-foot">Sodiqlik dasturi haqida <ArrowRight size={14} /></Link></section>
    </div>
  </>;
}

function OrdersTable({ orders }: { orders: typeof import('@/lib/domain/mock-data').orders }) {
  if (!orders.length) return <div className="table-empty">Hozircha buyurtmalar mavjud emas.</div>;
  return <div className="table-scroll"><table className="data-table"><thead><tr><th>BUYURTMA</th><th>SANA</th><th>HOLATI</th><th>MIQDOR</th><th>SUMMA</th><th /></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><Link href={`/orders/${encodeURIComponent(order.id)}`} className="order-number">{order.id}</Link></td><td>{formatDate(order.date)}</td><td><OrderStatusBadge status={order.status} /></td><td>{order.boxes} quti</td><td className="table-total">{formatUZS(order.total)}</td><td><Link href={`/orders/${encodeURIComponent(order.id)}`} className="table-arrow" aria-label={`${order.id} buyurtmasini ko‘rish`}><ChevronRight size={16} /></Link></td></tr>)}</tbody></table></div>;
}
function TagsIcon() { return <span className="percent-icon">%</span>; }
