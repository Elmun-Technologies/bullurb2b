'use client';

import { useState } from 'react';
import { Building2, Check, Clock3, Copy, Mail, MapPin, Phone, ShieldCheck } from 'lucide-react';
import { PageHeading, TierBadge } from '@/components/ui';
import { customers } from '@/lib/domain/mock-data';
import { usePortal } from '@/components/portal-context';
import { TelegramConnectCard } from '@/components/telegram-connect-card';
import { calculateLoyaltySummary } from '@/lib/domain/loyalty';

export default function CompanyPage() {
  const [copied, setCopied] = useState(false);
  const { config, customerBoxes, customerTurnover } = usePortal();
  const company = customers[0];
  const summary = calculateLoyaltySummary(config.metric === 'boxes' ? customerBoxes : customerTurnover, config);
  const copyId = async () => { await navigator.clipboard?.writeText(company.id); setCopied(true); window.setTimeout(() => setCopied(false), 1600); };
  return <>
    <PageHeading eyebrow="HAMKOR PROFILI" title="Kompaniya ma’lumotlari" description="MoySklad bilan sinxronlangan demo hamkor profili." />
    <section className="company-profile-hero"><div className="company-logo">SM</div><div className="company-identity"><span className="section-kicker">B2B HAMKOR</span><h2>{company.name}</h2><span><MapPin size={14} /> {company.region}, O‘zbekiston</span></div><div className="company-tier-block"><span>HAMKORLIK DARAJASI</span><TierBadge tier={summary.currentTier} size="large" /><b>{summary.discountPercent}% chegirma</b></div></section>
    <div className="company-layout"><section className="surface company-info-card"><div className="section-header"><div><div className="section-kicker">TASHKILOT MA’LUMOTLARI</div><h3>Kompaniya profili</h3></div><span className="readonly-pill"><ShieldCheck size={14} /> Tasdiqlangan</span></div><div className="info-grid"><Info label="Kompaniya nomi" value={company.name} icon={<Building2 size={16} />} /><Info label="Hudud" value={company.region} icon={<MapPin size={16} />} /><Info label="MoySklad mijozi" value={company.id} icon={<span className="id-hash">#</span>} action={<button onClick={copyId} aria-label="Mijoz ID sini nusxalash" className="copy-button">{copied ? <Check size={14} /> : <Copy size={14} />}</button>} /><Info label="Hisob holati" value="Faol hamkor" icon={<span className="account-active-dot" />} /></div><div className="profile-sync-note"><Clock3 size={15} /> Ma’lumotlar demo provayderdan olinmoqda. Haqiqiy MoySklad sinxronizatsiyasi ulanmagan.</div></section><aside className="surface contact-card"><div className="section-kicker">SIZNING MENEJERINGIZ</div><h3>Shaxsiy aloqa</h3><div className="manager-profile"><span className="manager-avatar">AT</span><span><b>{company.contactName}</b><small>Hamkorlar bo‘yicha menejer</small></span><span className="presence-dot" /></div><div className="contact-link"><span><Phone size={15} /></span><div><small>TELEFON</small><b>{company.phone}</b></div></div><div className="contact-link"><span><Mail size={15} /></span><div><small>EMAIL</small><b>{company.email}</b></div></div><a href={`tel:${company.phone}`} className="button secondary full contact-button">Menejer bilan bog‘lanish</a></aside></div>
    <TelegramConnectCard />
    <section className="surface company-stats"><div><small>Joriy oy xaridi</small><b>{customerBoxes} quti</b></div><div><small>Joriy daraja</small><b>{summary.currentTier.name}</b></div><div><small>Keyingi daraja</small><b>{summary.nextTier?.name ?? 'Eng yuqori'}</b></div><div><small>Keyingi bosqichgacha</small><b>{summary.remaining ? `${summary.remaining} quti` : '—'}</b></div></section>
  </>;
}
function Info({ label, value, icon, action }: { label: string; value: string; icon: React.ReactNode; action?: React.ReactNode }) { return <div className="info-item"><span className="info-icon">{icon}</span><span className="info-label-value"><small>{label}</small><b>{value}</b></span>{action}</div>; }
