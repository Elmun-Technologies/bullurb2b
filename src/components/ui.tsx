import Link from 'next/link';
import { ArrowRight, PackageOpen, Sparkles } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { LoyaltySummary, LoyaltyTier, OrderStatus, Product } from '@/lib/domain/types';
import { formatUZS } from '@/lib/domain/pricing';

export function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: ReactNode; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}<h1>{title}</h1>{description ? <p>{description}</p> : null}</div>{actions ? <div className="page-heading-actions">{actions}</div> : null}</div>;
}

export function TierBadge({ tier, size = 'regular' }: { tier: LoyaltyTier; size?: 'regular' | 'large' }) {
  return <span className={`tier-badge ${size === 'large' ? 'tier-large' : ''}`} style={{ '--tier-color': tier.color } as CSSProperties}><span className="tier-gem">◆</span>{tier.name}</span>;
}

export function LoyaltyProgress({ summary, compact = false, caption }: { summary: LoyaltySummary; compact?: boolean; caption?: string }) {
  return <div className={`loyalty-progress ${compact ? 'compact' : ''}`}>
    <div className="progress-meta"><span>{caption ?? `${summary.currentValue.toLocaleString('uz-UZ')} ${summary.metric === 'boxes' ? 'quti' : 'so‘m'}`}</span><span>{summary.nextThreshold !== null ? `${summary.nextThreshold.toLocaleString('uz-UZ')} ${summary.metric === 'boxes' ? 'quti' : 'so‘m'}` : 'Eng yuqori bosqich'}</span></div>
    <div className="progress-track" role="progressbar" aria-label="Keyingi bosqichga erishish" aria-valuenow={summary.progressPercent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${summary.progressPercent}%` }} /></div>
    <div className="progress-bottom"><span>{summary.progressPercent}% bajarildi</span>{summary.nextTier ? <span><strong>{summary.remaining.toLocaleString('uz-UZ')} {summary.metric === 'boxes' ? 'quti' : 'so‘m'}</strong> qoldi</span> : <span>Tabriklaymiz — eng yuqori bosqichdasiz</span>}</div>
  </div>;
}

export function StatCard({ label, value, note, icon, tone = 'mint' }: { label: string; value: string; note?: ReactNode; icon: ReactNode; tone?: string }) {
  return <div className="stat-card"><div className="stat-card-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><strong className="stat-value">{value}</strong>{note ? <span className="stat-note">{note}</span> : null}</div>;
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const className = status === 'Yetkazildi' ? 'delivered' : status === 'Bekor qilindi' ? 'cancelled' : status === 'Yo‘lda' ? 'transit' : 'processing';
  return <span className={`status-badge ${className}`}><i />{status}</span>;
}

export function ProductArtwork({ product, className = '' }: { product: Product; className?: string }) {
  return <div className={`product-art art-${product.art} ${className}`} aria-label={`${product.name} mahsulot tasviri`} role="img"><div className="art-shadow" /><div className="package"><span className="package-top" /><span className="package-brand">{product.brand.slice(0, 10)}</span><span className="package-name">{product.name.split(' ').slice(0, 2).join(' ')}</span><span className="package-weight">{product.packBoxes === 1 ? 'ULGURJI' : `${product.packBoxes} dona`}</span></div><div className="art-glow" /></div>;
}

export function PriceDisplay({ value, large = false }: { value: number; large?: boolean }) {
  return <span className={large ? 'price-large' : 'price'}>{formatUZS(value)}</span>;
}

export function EmptyState({ title, description, href, action }: { title: string; description: string; href?: string; action?: string }) {
  return <div className="empty-state"><span className="empty-icon"><PackageOpen size={24} /></span><h3>{title}</h3><p>{description}</p>{href && action ? <Link href={href} className="button secondary small">{action}<ArrowRight size={15} /></Link> : null}</div>;
}

export function UpgradeNotice({ name, boxes }: { name: string; boxes: number }) {
  return <div className="upgrade-notice"><span className="upgrade-icon"><Sparkles size={17} /></span><span><strong>{name} darajasiga {boxes} quti qoldi.</strong><small>Keyingi buyurtmangiz bilan yanada qulay narxlarga chiqing.</small></span></div>;
}
