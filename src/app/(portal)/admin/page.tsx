import Link from 'next/link';
import { ArrowRight, BellRing, Building2, CheckCircle2, Clock3, FileText, PlugZap, ShoppingBag } from 'lucide-react';
import { PageHeading, StatCard } from '@/components/ui';
import { ShopFlowClient } from '@/lib/shopflow/client';
import { isShopFlowConfigured, requireShopFlowConfig } from '@/lib/shopflow/config';
import { getTelegramServerConfig } from '@/lib/telegram/config';
import { getTelegramStores } from '@/lib/telegram/stores';
import type { TelegramBotOrder, TelegramRegistrationApplication } from '@/lib/telegram/types';

/**
 * Operations dashboard — 100% live data, zero demo numbers.
 *
 * Widgets read the real pilot stores (Telegram applications, bot orders),
 * the live ShopFlow catalog and the integration statuses. Sales analytics
 * stay an honest placeholder until MoySklad live reads exist.
 */

export const dynamic = 'force-dynamic';

function formatDateTime(iso: string): string {
  const [date = '', time = ''] = iso.split('T');
  return `${date} ${time.slice(0, 5)}`;
}

async function loadTelegram(): Promise<{ pending: TelegramRegistrationApplication[]; approved: TelegramRegistrationApplication[]; orders: TelegramBotOrder[]; available: boolean }> {
  try {
    const stores = getTelegramStores();
    const [pending, approved, orders] = await Promise.all([
      stores.applications.listByStatus('pending'),
      stores.applications.listByStatus('approved'),
      stores.botOrders.listRecent(8),
    ]);
    return { pending, approved, orders, available: true };
  } catch {
    return { pending: [], approved: [], orders: [], available: false };
  }
}

async function loadShopFlow(): Promise<{ configured: boolean; categories: number; products: number; promotions: number }> {
  if (!isShopFlowConfigured()) return { configured: false, categories: 0, products: 0, promotions: 0 };
  try {
    const config = requireShopFlowConfig();
    const client = new ShopFlowClient(config.baseUrl, config.apiKey);
    const [categories, products, promotions] = await Promise.all([
      client.categories('uz'),
      client.products({ page: 1, pageSize: 1 }),
      client.promotions(),
    ]);
    return { configured: true, categories: categories.length, products: products.total, promotions: promotions.length };
  } catch {
    return { configured: true, categories: 0, products: 0, promotions: 0 };
  }
}

export default async function AdminDashboardPage() {
  const [telegram, shopflow] = await Promise.all([loadTelegram(), loadShopFlow()]);
  const telegramStatus = getTelegramServerConfig().status;
  const moyskladLive = process.env.MOYSKLAD_MODE === 'live';

  return <>
    <PageHeading
      eyebrow="OPERATSIYA"
      title="Boshqaruv paneli"
      description="Jonli ko‘rsatkichlar: arizalar, bot buyurtmalari, katalog va integratsiyalar holati."
      actions={<Link href="/admin/telegram" className="button secondary"><BellRing size={16} /> Telegram arizalar</Link>}
    />

    {!telegram.available && (
      <div className="admin-data-notice"><span className="demo-dot" /><span><b>Xotira ombori ulanmagan</b> · Pilot rejimda Telegram ma’lumotlari ko‘rinmaydi.</span></div>
    )}

    <div className="stat-grid four admin-stats">
      <StatCard label="Kutilayotgan arizalar" value={String(telegram.pending.length)} note="Tasdiqlashni kutyapti" icon={<Clock3 size={18} />} tone="amber" />
      <StatCard label="Tasdiqlangan mijozlar" value={String(telegram.approved.length)} note="Botda faol" icon={<Building2 size={18} />} tone="mint" />
      <StatCard label="Bot buyurtmalari" value={String(telegram.orders.length)} note="So‘nggi 8 tadan" icon={<ShoppingBag size={18} />} tone="blue" />
      <StatCard
        label="Katalog mahsulotlari"
        value={shopflow.configured ? String(shopflow.products) : '—'}
        note={shopflow.configured ? `${shopflow.categories} kategoriya · ${shopflow.promotions} aksiya` : 'ShopFlow ulanmagan'}
        icon={<FileText size={18} />}
        tone="violet"
      />
    </div>

    <div className="admin-grid">
      <section className="surface">
        <div className="section-header"><div><div className="section-kicker">ARIZALAR</div><h3>So‘nggi arizalar</h3></div><Link href="/admin/telegram" className="text-link">Barchasi <ArrowRight size={14} /></Link></div>
        {telegram.pending.length === 0 ? (
          <p className="muted-text">Kutilayotgan ariza yo‘q. Yangi ariza botda <b>/start</b> orqali keladi.</p>
        ) : (
          <div className="near-client-list">
            {telegram.pending.slice(0, 5).map((item) => (
              <Link href="/admin/telegram" className="near-client-row" key={item.chatId}>
                <span className="near-client-avatar">{item.company.slice(0, 1)}</span>
                <span className="near-client-name"><b>{item.company}</b><small>{item.name} · {item.phone}</small></span>
                <span className="near-client-remaining">{formatDateTime(item.createdAt)}</span>
                <ArrowRight size={15} className="near-client-arrow" />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="surface">
        <div className="section-header"><div><div className="section-kicker">BOT BUYURTMALAR</div><h3>So‘nggi buyurtmalar</h3></div></div>
        {telegram.orders.length === 0 ? (
          <p className="muted-text">Hali bot buyurtmasi yo‘q. Mijoz <b>/katalog</b> orqali buyurtma beradi.</p>
        ) : (
          <div className="near-client-list">
            {telegram.orders.slice(0, 5).map((order) => (
              <div className="near-client-row" key={order.orderId}>
                <span className="near-client-avatar"><ShoppingBag size={15} /></span>
                <span className="near-client-name"><b>{order.productName}{order.variantName ? ` (${order.variantName})` : ''} × {order.quantity}</b><small>{order.company} · {order.method === 'courier' ? 'Kuryer' : 'Olib ketish'}</small></span>
                <span className="near-client-remaining">{formatDateTime(order.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>

    <div className="admin-grid">
      <section className="surface">
        <div className="section-header"><div><div className="section-kicker">INTEGRATSIYALAR</div><h3>Ulanish holati</h3></div><PlugZap size={17} /></div>
        <div className="tier-distribution-list">
          <div className="tier-distribution-item"><CheckCircle2 size={16} /><b>Telegram bot</b><span>{telegramStatus === 'ready' ? 'Ishlayapti ✅' : telegramStatus === 'disabled' ? 'O‘chiq' : 'Sozlanmagan'}</span></div>
          <div className="tier-distribution-item"><CheckCircle2 size={16} /><b>ShopFlow</b><span>{shopflow.configured ? `Ulangan ✅ (${shopflow.products} mahsulot)` : 'Ulanmagan'}</span></div>
          <div className="tier-distribution-item"><CheckCircle2 size={16} /><b>MoySklad</b><span>{moyskladLive ? 'Jonli ✅' : 'Test rejimi'}</span></div>
        </div>
      </section>

      <section className="surface">
        <div className="section-header"><div><div className="section-kicker">SAVDO ANALITIKASI</div><h3>Oylik aylanma</h3></div></div>
        <p className="muted-text">Savdo tarixi MoySklad ulangach shu yerda chiqadi. Hozircha namuna raqamlar ko‘rsatilmaydi — faqat jonli ma’lumot.</p>
        <p><Link href="/admin/telegram" className="text-link">Arizalarni ko‘rish <ArrowRight size={14} /></Link></p>
      </section>
    </div>
  </>;
}
