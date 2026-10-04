import Link from 'next/link';
import { ArrowRight, Sparkles } from 'lucide-react';
import { PageHeading } from '@/components/ui';

/**
 * Sales opportunities need live purchase history per customer (MoySklad
 * reads or documented ShopFlow customer shapes) — both are still blockers,
 * so this page honestly waits instead of scoring demo customers.
 */

export default function OpportunitiesPage() {
  return <>
    <PageHeading
      eyebrow="SAVDO IMKONIYATLARI"
      title="Imkoniyatlar"
      description="Keyingi darajaga yaqin mijozlar — jonli tarix ulangach avtomatik hisoblanadi."
      actions={<Link href="/admin/clients" className="button secondary"><Sparkles size={16} /> Mijozlar</Link>}
    />
    <section className="surface">
      <div className="section-header"><div><div className="section-kicker">HOLAT</div><h3>Tarix kutilmoqda</h3></div></div>
      <p className="muted-text">Xaridlar tarixi ulangach, imkoniyatlar shu yerda avtomatik hisoblanadi.</p>
      <p><Link href="/admin/telegram" className="text-link">Arizalarni ko‘rish <ArrowRight size={14} /></Link></p>
    </section>
  </>;
}
