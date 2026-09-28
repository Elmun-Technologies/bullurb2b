'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronDown, FileText, Search } from 'lucide-react';
import { usePortal } from '@/components/portal-context';
import { customers } from '@/lib/domain/mock-data';
import { formatUZS } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/format/dates';
import { OrderStatusBadge, PageHeading } from '@/components/ui';

export default function OrdersPage() {
  const { allOrders } = usePortal();
  const [status, setStatus] = useState('Barcha holatlar');
  const [dateFilter, setDateFilter] = useState('all');
  const [search, setSearch] = useState('');
  const clientOrders = useMemo(() => {
    const today = new Date();
    const dateParts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(today);
    const year = Number(dateParts.find((part) => part.type === 'year')?.value);
    const month = Number(dateParts.find((part) => part.type === 'month')?.value);
    const day = Number(dateParts.find((part) => part.type === 'day')?.value);
    const cutoff = (days: number) => { const date = new Date(Date.UTC(year, month - 1, day - days + 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`; };
    const monthKey = `${year}-${String(month).padStart(2, '0')}`;
    return allOrders.filter((order) => order.customerId === customers[0].id)
      .sort((a, b) => b.date.localeCompare(a.date))
      .filter((order) => (status === 'Barcha holatlar' || order.status === status)
        && (dateFilter === 'all' || (dateFilter === 'month' ? order.date.startsWith(monthKey) : order.date >= cutoff(Number(dateFilter))))
        && order.id.toLowerCase().includes(search.toLowerCase()));
  }, [allOrders, status, dateFilter, search]);
  return <>
    <PageHeading eyebrow="BUYURTMALAR TARIXI" title="Buyurtmalarim" description="Buyurtmalar holati va xaridlar bo‘yicha hisob-kitoblarni kuzating." actions={<Link href="/catalog" className="button primary"><FileText size={17} /> Yangi buyurtma <ArrowRight size={15} /></Link>} />
    <div className="orders-summary-strip"><span className="orders-summary-icon"><FileText size={19} /></span><span><b>{clientOrders.length} ta buyurtma</b><small>Jami tarixdagi buyurtmalar</small></span><div className="orders-summary-total"><small>Yetkazilgan buyurtmalar summasi</small><b>{formatUZS(clientOrders.filter((order) => order.status === 'Yetkazildi').reduce((sum, order) => sum + order.total, 0))}</b></div></div>
    <div className="orders-toolbar"><label className="search-field compact-search"><Search size={16} /><input aria-label="Buyurtma qidirish" placeholder="Buyurtma raqami..." value={search} onChange={(event) => setSearch(event.target.value)} /></label><label className="select-filter"><CalendarDays size={15} /><select aria-label="Sana bo‘yicha filtr" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)}><option value="all">Barcha sanalar</option><option value="month">Shu oy</option><option value="30">Oxirgi 30 kun</option><option value="90">Oxirgi 90 kun</option></select><ChevronDown size={14} /></label><label className="select-filter"><select aria-label="Buyurtma holati" value={status} onChange={(event) => setStatus(event.target.value)}>{['Barcha holatlar', 'Yangi', 'Yig‘ilmoqda', 'Yo‘lda', 'Yetkazildi', 'Bekor qilindi'].map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label><span className="results-count">{clientOrders.length} natija</span></div>
    <section className="surface full-table-card"><div className="table-scroll"><table className="data-table orders-table"><thead><tr><th>BUYURTMA</th><th>SANA</th><th>HOLATI</th><th>MAHSULOTLAR</th><th>MIQDOR</th><th>JAMI</th><th /></tr></thead><tbody>{clientOrders.map((order) => <tr key={order.id}><td><Link href={`/orders/${encodeURIComponent(order.id)}`} className="order-number">{order.id}</Link></td><td>{formatDate(order.date)}</td><td><OrderStatusBadge status={order.status} /></td><td>{order.items} xil mahsulot</td><td>{order.boxes} quti</td><td className="table-total">{formatUZS(order.total)}</td><td><Link href={`/orders/${encodeURIComponent(order.id)}`} className="table-arrow" aria-label={`${order.id} tafsilotlari`}><ArrowRight size={15} /></Link></td></tr>)}</tbody></table></div>{!clientOrders.length ? <div className="table-empty">Bu filtr bo‘yicha buyurtmalar topilmadi.</div> : null}<div className="table-pagination"><span>1–{clientOrders.length} / {clientOrders.length} buyurtma</span><button disabled>Oldingi</button><button disabled>Keyingi</button></div></section>
  </>;
}
