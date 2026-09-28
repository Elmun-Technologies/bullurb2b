'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowDownUp, ArrowRight, Check, ChevronDown, Filter, PackageCheck, Plus, Search, ShoppingBag, SlidersHorizontal, X } from 'lucide-react';
import { products, customers } from '@/lib/domain/mock-data';
import { calculateLoyaltySummary } from '@/lib/domain/loyalty';
import { calculatePrice } from '@/lib/domain/pricing';
import { usePortal } from '@/components/portal-context';
import { LoyaltyProgress, PageHeading, PriceDisplay, ProductArtwork, TierBadge } from '@/components/ui';

export default function CatalogPage() {
  const { config, customerBoxes, customerTurnover, addToCart, cart } = usePortal();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('Barcha kategoriyalar');
  const [brand, setBrand] = useState('Barcha brendlar');
  const [inStock, setInStock] = useState(false);
  const [sort, setSort] = useState('recommended');
  const [toast, setToast] = useState('');
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  const summary = calculateLoyaltySummary(config.metric === 'boxes' ? customerBoxes : customerTurnover, config);
  const categories = useMemo(() => ['Barcha kategoriyalar', ...new Set(products.map((product) => product.category))], []);
  const brands = useMemo(() => ['Barcha brendlar', ...new Set(products.map((product) => product.brand))], []);
  const visible = useMemo(() => {
    const result = products.filter((product) => {
      const matchesQuery = `${product.name} ${product.sku} ${product.category} ${product.brand}`.toLowerCase().includes(query.toLowerCase());
      return matchesQuery && (category === 'Barcha kategoriyalar' || product.category === category) && (brand === 'Barcha brendlar' || product.brand === brand) && (!inStock || product.stock > 0);
    });
    if (sort === 'name') result.sort((a, b) => a.name.localeCompare(b.name, 'uz'));
    if (sort === 'price-low') result.sort((a, b) => a.price - b.price);
    if (sort === 'availability') result.sort((a, b) => b.stock - a.stock);
    return result;
  }, [query, category, brand, inStock, sort]);
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);

  const handleAdd = (productId: string, quantity: number) => {
    addToCart(productId, quantity);
    const product = products.find((item) => item.id === productId);
    setToast(`${product?.name ?? 'Mahsulot'} · ${quantity} quti savatga qo‘shildi`);
    window.setTimeout(() => setToast(''), 2300);
  };

  return <>
    <PageHeading eyebrow="ULGURJI KATALOG" title="Mahsulotlar katalogi" description="Sizning hamkorlik narxlaringiz va mavjud qoldiqlar bilan tanishing." actions={<Link href="/orders/new" className="button primary"><ShoppingBag size={17} /> Savat {cartCount ? <span className="button-count">{cartCount}</span> : null}<ArrowRight size={15} /></Link>} />
    <div className="catalog-loyalty-strip"><span className="catalog-strip-icon"><PackageCheck size={19} /></span><div className="catalog-strip-copy"><b>{customers[0].name}</b><span>Sizga tegishli narxlar ko‘rsatilmoqda</span></div><TierBadge tier={summary.currentTier} /><div className="catalog-strip-progress"><LoyaltyProgress summary={summary} compact /></div><Link href="/loyalty" className="text-link">Darajani oshirish <ArrowRight size={14} /></Link></div>
    <div className="catalog-tools"><label className="search-field"><Search size={17} /><input ref={searchRef} aria-label="Mahsulot qidirish" placeholder="Mahsulot, brend yoki SKU qidiring..." value={query} onChange={(event) => setQuery(event.target.value)} />{query ? <button onClick={() => setQuery('')} aria-label="Qidiruvni tozalash"><X size={15} /></button> : <kbd>⌘ K</kbd>}</label><div className="catalog-filter-group"><label className="select-filter"><SlidersHorizontal size={15} /><select aria-label="Kategoriya" value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label><label className="select-filter brand-filter"><select aria-label="Brend" value={brand} onChange={(event) => setBrand(event.target.value)}>{brands.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={14} /></label><label className={`stock-toggle ${inStock ? 'checked' : ''}`}><input type="checkbox" checked={inStock} onChange={(event) => setInStock(event.target.checked)} /><span className="toggle-mark">{inStock ? <Check size={12} /> : null}</span> Mavjud</label></div></div>
    <div className="catalog-result-row"><span><b>{visible.length}</b> ta mahsulot <span className="dot-sep">·</span> B2B hamkorlar uchun</span><label className="sort-select"><ArrowDownUp size={14} /><select aria-label="Saralash" value={sort} onChange={(event) => setSort(event.target.value)}><option value="recommended">Tavsiya etilgan</option><option value="name">Nomi bo‘yicha</option><option value="price-low">Narx: arzondan</option><option value="availability">Mavjudligi bo‘yicha</option></select><ChevronDown size={14} /></label></div>

    {visible.length ? <div className="product-grid">{visible.map((product) => {
      const price = calculatePrice(product, summary, customers[0].id);
      const stockState = product.stock === 0 ? 'out' : product.stock < 35 ? 'low' : 'good';
      return <article className="product-card" key={product.id}><div className="product-card-art-wrap"><ProductArtwork product={product} /><span className={`stock-pill ${stockState}`}>{stockState === 'good' ? 'Mavjud' : stockState === 'low' ? 'Kam qoldi' : 'Tugagan'}</span></div><div className="product-card-body"><div className="product-meta"><span>{product.category}</span><span>SKU {product.sku}</span></div><h3>{product.name}</h3><div className="product-brand">{product.brand} <span>·</span> {product.packBoxes > 1 ? `${product.packBoxes} dona / quti` : 'quti'}</div><div className="product-card-price"><div><PriceDisplay value={price.finalPrice} /><small>{product.unit} uchun</small></div>{price.priceSource === 'CUSTOMER_SPECIAL' ? <span className="special-price-tag">Kelishilgan narx</span> : price.discountPercent > 0 ? <span className="saving-tag">−{price.discountPercent}%</span> : null}</div><div className="product-card-footer"><span className="minimum-order">Min. {product.minOrder} quti <span>·</span> {product.stock > 0 ? `${product.stock} qoldiq` : 'mavjud emas'}</span><div className="product-purchase-row"><div className="catalog-quantity"><button type="button" aria-label={`${product.name} miqdorini kamaytirish`} disabled={(quantities[product.id] ?? product.minOrder) <= product.minOrder} onClick={() => setQuantities((current) => ({ ...current, [product.id]: Math.max(product.minOrder, (current[product.id] ?? product.minOrder) - 1) }))}>−</button><input aria-label={`${product.name} buyurtma miqdori`} type="number" min={product.minOrder} max={product.stock || undefined} value={quantities[product.id] ?? product.minOrder} onChange={(event) => setQuantities((current) => ({ ...current, [product.id]: Math.max(product.minOrder, Math.min(product.stock || 999999, Number(event.target.value) || product.minOrder)) }))} /><button type="button" aria-label={`${product.name} miqdorini oshirish`} disabled={(quantities[product.id] ?? product.minOrder) >= product.stock} onClick={() => setQuantities((current) => ({ ...current, [product.id]: Math.min(product.stock, (current[product.id] ?? product.minOrder) + 1) }))}>+</button></div><button className="add-button" aria-label={`${product.name}ni savatga qo‘shish`} disabled={product.stock === 0} onClick={() => handleAdd(product.id, quantities[product.id] ?? product.minOrder)}><Plus size={17} /></button></div></div></div></article>;
    })}</div> : <div className="catalog-empty"><span className="empty-filter-icon"><Filter size={20} /></span><h3>Hech qanday mahsulot topilmadi</h3><p>Qidiruv yoki filtrlarni o‘zgartirib ko‘ring.</p><button className="button secondary small" onClick={() => { setQuery(''); setCategory('Barcha kategoriyalar'); setBrand('Barcha brendlar'); setInStock(false); }}>Filtrlarni tozalash <X size={15} /></button></div>}
    {toast ? <div className="toast-message"><span><Check size={14} /></span>{toast}<Link href="/orders/new">Savatni ko‘rish <ArrowRight size={14} /></Link></div> : null}
  </>;
}
