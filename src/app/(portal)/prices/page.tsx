'use client';

import { useMemo, useState } from 'react';
import { ArrowDownUp, Search, Tags } from 'lucide-react';
import { products, customers } from '@/lib/domain/mock-data';
import { calculateLoyaltySummary } from '@/lib/domain/loyalty';
import { calculatePrice, formatUZS } from '@/lib/domain/pricing';
import { usePortal } from '@/components/portal-context';
import { PageHeading, TierBadge } from '@/components/ui';

export default function PricesPage() {
  const { config, customerBoxes, customerTurnover } = usePortal();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState('name');
  const summary = calculateLoyaltySummary(config.metric === 'boxes' ? customerBoxes : customerTurnover, config);
  const items = useMemo(() => products.filter((product) => `${product.name} ${product.sku}`.toLowerCase().includes(query.toLowerCase())).map((product) => ({ product, price: calculatePrice(product, summary, customers[0].id) })).sort((a, b) => sort === 'price' ? a.price.finalPrice - b.price.finalPrice : a.product.name.localeCompare(b.product.name, 'uz')), [query, summary, sort]);
  return <>
    <PageHeading eyebrow="SHAHSIY TAKLIFLAR" title="Mening narxlarim" description="Sizga moslashtirilgan B2B narxlar va amaldagi hamkorlik chegirmalari." />
    <div className="personal-price-banner"><span className="personal-price-icon"><Tags size={20} /></span><div><small>SHAHSIY NARXLAR RO‘YXATI</small><h2>{customers[0].name}</h2><p>Amaldagi daraja: <TierBadge tier={summary.currentTier} /> <b>{summary.discountPercent}% hamkorlik chegirmasi</b></p></div><div className="price-valid"><span className="live-dot" /> Faol</div></div>
    <div className="price-explainer"><span>ⓘ</span><p><b>Kelishilgan maxsus narxlar</b> sodiqlik chegirmasidan ustun qo‘llanadi. Jadvalda siz uchun qo‘llanadigan yagona yakuniy narx ko‘rsatiladi.</p><span className="price-period">2026-yil sentabr</span></div>
    <div className="price-toolbar"><label className="search-field compact-search"><Search size={16} /><input placeholder="Mahsulot qidirish..." aria-label="Mahsulot qidirish" value={query} onChange={(event) => setQuery(event.target.value)} /></label><button className="sort-button" onClick={() => setSort((value) => value === 'name' ? 'price' : 'name')}><ArrowDownUp size={15} /> {sort === 'name' ? 'Nomi bo‘yicha' : 'Narx bo‘yicha'}</button><span className="results-count">{items.length} ta narx</span></div>
    <section className="surface prices-table-card"><div className="table-scroll"><table className="data-table prices-table"><thead><tr><th>MAHSULOT</th><th>SKU</th><th>ASOSIY B2B NARX</th><th>SIZNING NARXINGIZ</th><th>MANBA</th></tr></thead><tbody>{items.map(({ product, price }) => <tr key={product.id}><td><div className="table-product"><span className={`mini-product-icon art-${product.art}`}>{product.name.slice(0, 1)}</span><span><b>{product.name}</b><small>{product.brand} · {product.category}</small></span></div></td><td className="muted-cell">{product.sku}</td><td>{price.priceSource === 'CUSTOMER_SPECIAL' ? <span className="muted-cell">Maxsus kelishuv</span> : formatUZS(price.basePrice)}</td><td className="price-cell"><b>{formatUZS(price.finalPrice)}</b><small>quti uchun</small></td><td><span className={`price-source ${price.priceSource === 'CUSTOMER_SPECIAL' ? 'special' : ''}`}>{price.priceSource === 'CUSTOMER_SPECIAL' ? 'Kelishilgan narx' : price.priceSource === 'LOYALTY_PRICE' ? `${price.discountPercent}% ${summary.currentTier.name}` : 'B2B standart'}</span></td></tr>)}</tbody></table></div>{items.length === 0 ? <div className="table-empty">Hech qanday mahsulot topilmadi.</div> : null}<div className="prices-footer-note"><span className="live-dot" /> Narxlar buyurtma vaqtida qayta hisoblanadi. Valyuta: UZS</div></section>
  </>;
}
