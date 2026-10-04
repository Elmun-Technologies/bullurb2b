import Link from 'next/link';
import { ArrowRight, Users } from 'lucide-react';
import { PageHeading } from '@/components/ui';
import { getTelegramStores } from '@/lib/telegram/stores';

/**
 * Real client registry: approved Telegram applications (no demo rows).
 * Turnover/tier progress stays unavailable until MoySklad live reads exist —
 * the table shows only verified registration data + bot order counts.
 */

export const dynamic = 'force-dynamic';

export default async function AdminClientsPage() {
  let approved: Awaited<ReturnType<ReturnType<typeof getTelegramStores>['applications']['listByStatus']>> = [];
  let pendingCount = 0;
  let orderCounts = new Map<number, number>();
  let available = true;
  try {
    const stores = getTelegramStores();
    const [approvedList, pendingList, orders] = await Promise.all([
      stores.applications.listByStatus('approved'),
      stores.applications.listByStatus('pending'),
      stores.botOrders.listRecent(200),
    ]);
    approved = approvedList;
    pendingCount = pendingList.length;
    orderCounts = new Map<number, number>();
    for (const order of orders) orderCounts.set(order.chatId, (orderCounts.get(order.chatId) ?? 0) + 1);
  } catch {
    available = false;
  }

  return <>
    <PageHeading
      eyebrow="B2B MIJOZLAR BAZASI"
      title="Mijozlar"
      description="Tasdiqlangan hamkorlar — bot orqali ro‘yxatdan o‘tgan real ma’lumotlar."
      actions={<span className="client-count-chip"><Users size={15} /> {approved.length} hamkor</span>}
    />
    {!available && (
      <div className="admin-data-notice"><span className="demo-dot" /><span><b>Xotira ombori ulanmagan</b> · Pilot rejimda mijozlar ko‘rinmaydi.</span></div>
    )}
    {pendingCount > 0 && (
      <div className="admin-data-notice"><span className="demo-dot" /><span><b>{pendingCount} ta ariza</b> tasdiqlanishi kutilmoqda.</span><Link href="/admin/telegram">Ko‘rish <ArrowRight size={14} /></Link></div>
    )}
    <section className="surface client-list-card">
      <div className="table-scroll">
        <table className="data-table client-table">
          <thead><tr><th>KOMPANIYA</th><th>MAS‘UL</th><th>TELEFON</th><th>MANZIL</th><th>SANA</th><th>BUYURTMALAR</th><th /></tr></thead>
          <tbody>
            {approved.map((item) => (
              <tr key={item.chatId}>
                <td><Link className="client-name-cell" href={`/admin/clients/${item.chatId}`}><span className="company-mini-avatar">{item.company.slice(0, 1)}</span><span><b>{item.company}</b></span></Link></td>
                <td>{item.name}</td>
                <td>{item.phone}</td>
                <td>{item.address}</td>
                <td>{item.createdAt.slice(0, 10)}</td>
                <td><b className="discount-cell">{orderCounts.get(item.chatId) ?? 0}</b></td>
                <td><Link href={`/admin/clients/${item.chatId}`} className="table-arrow" aria-label={`${item.company} tafsilotlari`}><ArrowRight size={15} /></Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {approved.length === 0 ? <div className="table-empty">Hali tasdiqlangan mijoz yo‘q. Arizalar <Link href="/admin/telegram">Telegram sahifasida</Link>.</div> : null}
      <div className="table-pagination"><span>{approved.length} hamkor</span></div>
    </section>
    <p className="muted-text">Aylanma va daraja progressi MoySklad jonli o‘qishlari ulangach chiqadi — hozircha faqat tasdiqlangan ro‘yxat ko‘rsatiladi.</p>
  </>;
}
