'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Box, CalendarDays, PackageCheck, Truck } from 'lucide-react';
import { usePortal } from '@/components/portal-context';
import { products } from '@/lib/domain/mock-data';
import { formatUZS } from '@/lib/domain/pricing';
import { formatDate } from '@/lib/format/dates';
import { OrderStatusBadge, PageHeading } from '@/components/ui';

export default function OrderDetailPage() {
  const params = useParams<{ id: string }>();
  const { allOrders } = usePortal();
  const order = allOrders.find((item) => item.id === decodeURIComponent(params.id));
  if (!order) return <div className="not-found-card"><span className="empty-filter-icon"><PackageCheck size={22} /></span><h2>Buyurtma topilmadi</h2><p>Buyurtma raqamini tekshiring yoki buyurtmalar ro‘yxatiga qayting.</p><Link href="/orders" className="button secondary">Buyurtmalarga qaytish</Link></div>;
  return <>
    <PageHeading eyebrow="BUYURTMA TAFSILOTLARI" title={order.id} description={`Buyurtma ${formatDate(order.date)} kuni rasmiylashtirilgan.`} actions={<Link href="/orders" className="button ghost"><ArrowLeft size={16} /> Buyurtmalarga qaytish</Link>} />
    <div className="order-detail-layout"><section className="surface detail-lines-card"><div className="detail-status-row"><div><span className="section-kicker">JORIY HOLAT</span><div className="detail-status"><OrderStatusBadge status={order.status} /></div></div><div className="detail-date"><CalendarDays size={16} /><span>{formatDate(order.date)}</span></div></div><div className="table-scroll"><table className="data-table detail-table"><thead><tr><th>MAHSULOT</th><th>NARX</th><th>MIQDOR</th><th>SUMMA</th></tr></thead><tbody>{order.lines.map((line, index) => { const product = products.find((item) => item.id === line.productId); return <tr key={`${line.productId}-${index}`}><td><div className="detail-product"><span className="detail-product-icon"><Box size={15} /></span><span><b>{product?.name ?? 'Mahsulot'}</b><small>{product?.sku}</small></span></div></td><td>{formatUZS(line.unitPrice)}</td><td>{line.quantity} quti</td><td className="table-total">{formatUZS(line.quantity * line.unitPrice)}</td></tr>; })}</tbody></table></div><Link href="/catalog" className="button secondary reorder-button">Shu mahsulotlardan buyurtma qilish</Link></section><aside className="surface detail-summary"><h3>Buyurtma xulosasi</h3><div className="summary-row"><span>Mahsulotlar</span><b>{order.items} xil</b></div><div className="summary-row"><span>Jami miqdor</span><b>{order.boxes} quti</b></div><div className="summary-divider" /><div className="summary-grand"><span>Buyurtma summasi</span><strong>{formatUZS(order.total)}</strong></div><div className="detail-timeline"><div className={`timeline-item complete`}><span><PackageCheck size={15} /></span><div><b>Buyurtma yaratildi</b><small>{formatDate(order.date)}</small></div></div><div className={`timeline-item ${order.status === 'Yetkazildi' ? 'complete' : ''}`}><span><Truck size={15} /></span><div><b>{order.status === 'Yetkazildi' ? 'Yetkazib berildi' : order.status}</b><small>{order.status === 'Yetkazildi' ? 'Muvaffaqiyatli yakunlandi' : 'Jarayon davom etmoqda'}</small></div></div></div></aside></div>
  </>;
}
