import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MapPin, Phone, ShoppingBag, User } from 'lucide-react';
import { PageHeading, StatCard } from '@/components/ui';
import { getTelegramStores } from '@/lib/telegram/stores';

/**
 * Real client details: one verified application + their bot orders.
 * The `id` segment is the Telegram chat id. Turnover/tier progress stay
 * honest placeholders until MoySklad live reads exist.
 */

export const dynamic = 'force-dynamic';

export default async function ClientDetailsPage(context: { params: Promise<{ id: string }> }) {
  const chatId = Number((await context.params).id);
  if (!Number.isInteger(chatId)) notFound();

  let application = null;
  let orders: Awaited<ReturnType<ReturnType<typeof getTelegramStores>['botOrders']['listRecent']>> = [];
  try {
    const stores = getTelegramStores();
    application = await stores.applications.getByChatId(chatId);
    orders = (await stores.botOrders.listRecent(200)).filter((order) => order.chatId === chatId);
  } catch {
    notFound();
  }
  if (!application) notFound();

  const statusLabel = application.status === 'approved' ? 'Tasdiqlangan ✅' : application.status === 'pending' ? 'Kutilmoqda ⏳' : 'Rad etilgan';

  return <>
    <PageHeading
      eyebrow="MIJOZ TAFSILOTI"
      title={application.company}
      description={`${application.name} · ro‘yxat: ${application.createdAt.slice(0, 10)}`}
      actions={<Link href="/admin/clients" className="button secondary"><ArrowLeft size={16} /> Mijozlar</Link>}
    />
    <div className="stat-grid four admin-stats">
      <StatCard label="Holat" value={statusLabel} note="Ariza holati" icon={<User size={18} />} tone="mint" />
      <StatCard label="Telefon" value={application.phone} note="Tasdiqlangan raqam" icon={<Phone size={18} />} tone="blue" />
      <StatCard label="Bot buyurtmalari" value={String(orders.length)} note="Tugmali katalog orqali" icon={<ShoppingBag size={18} />} tone="amber" />
      <StatCard label="Manzil" value={application.address.length > 24 ? `${application.address.slice(0, 24)}…` : application.address} note="Ro‘yxatdagi manzil" icon={<MapPin size={18} />} tone="violet" />
    </div>
    <div className="admin-grid">
      <section className="surface">
        <div className="section-header"><div><div className="section-kicker">BUYURTMALAR</div><h3>Bot buyurtmalari tarixi</h3></div></div>
        {orders.length === 0 ? (
          <p className="muted-text">Bu mijoz hali bot orqali buyurtma bermagan.</p>
        ) : (
          <div className="live-list">
            {orders.map((order) => (
              <div className="live-row" key={order.orderId}>
                <span className="near-client-avatar"><ShoppingBag size={15} /></span>
                <span className="near-client-name"><b>{order.productName}{order.variantName ? ` (${order.variantName})` : ''} × {order.quantity}</b><small>{order.orderMessage} · {order.method === 'courier' ? 'Kuryer' : 'Olib ketish'}</small></span>
                <span className="live-meta">{order.createdAt.slice(0, 10)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="surface">
        <div className="section-header"><div><div className="section-kicker">SODIQLIK</div><h3>Daraja progressi</h3></div></div>
        <p className="muted-text">Aylanma va daraja keyingi bosqichda shu yerda chiqadi. Dastur sozlamalari: <Link href="/admin/loyalty" className="text-link">Sodiqlik darajalari</Link>.</p>
        {application.location && (
          <p className="muted-text">Lokatsiya: {application.location.latitude}, {application.location.longitude}</p>
        )}
      </section>
    </div>
  </>;
}
