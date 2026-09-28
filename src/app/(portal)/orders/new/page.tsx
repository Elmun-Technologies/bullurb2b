'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, Minus, Plus, ShieldCheck, ShoppingBag, Sparkles, Trash2, Truck } from 'lucide-react';
import { usePortal } from '@/components/portal-context';
import { products, customers } from '@/lib/domain/mock-data';
import { calculateLoyaltySummary } from '@/lib/domain/loyalty';
import { calculatePrice, formatUZS } from '@/lib/domain/pricing';
import { PageHeading, ProductArtwork, TierBadge } from '@/components/ui';

export default function NewOrderPage() {
  const { cart, setCartQuantity, removeFromCart, clearCart, config, customerBoxes, customerTurnover, simulateFulfillment } = usePortal();
  const [completed, setCompleted] = useState(false);
  const [orderId, setOrderId] = useState('');
  const [completedTotal, setCompletedTotal] = useState(0);
  const [upgradeReached, setUpgradeReached] = useState(false);
  const beforeSummary = calculateLoyaltySummary(config.metric === 'boxes' ? customerBoxes : customerTurnover, config);
  const lines = useMemo(() => cart.map((item) => {
    const product = products.find((candidate) => candidate.id === item.productId)!;
    const price = calculatePrice(product, beforeSummary, customers[0].id);
    return { ...item, product, price, subtotal: price.finalPrice * item.quantity, baseTotal: price.basePrice * item.quantity };
  }), [cart, beforeSummary]);
  const quantity = lines.reduce((sum, item) => sum + item.quantity, 0);
  const baseTotal = lines.reduce((sum, item) => sum + item.baseTotal, 0);
  const finalTotal = lines.reduce((sum, item) => sum + item.subtotal, 0);
  const projectedValue = (config.metric === 'boxes' ? customerBoxes : customerTurnover) + (config.metric === 'boxes' ? quantity : finalTotal);
  const afterSummary = calculateLoyaltySummary(projectedValue, config);
  const willUpgrade = afterSummary.currentTier.minValue > beforeSummary.currentTier.minValue;
  const noNextReached = beforeSummary.nextTier && projectedValue >= beforeSummary.nextTier.minValue;

  if (completed) return <div className="success-screen"><div className="success-check"><Check size={30} strokeWidth={2.4} /></div><div className="eyebrow">DEMO BUYURTMA BAJARILDI</div><h1>{upgradeReached ? `Tabriklaymiz, ${afterSummary.currentTier.name}!` : 'Buyurtma muvaffaqiyatli!'}</h1><p className="success-intro">{upgradeReached ? 'Samarqand Market yangi hamkorlik darajasiga ko‘tarildi.' : 'Demo buyurtmangiz qabul qilindi va yetkazilgan deb belgilandi.'}</p><div className="success-order-card"><div><span>Buyurtma raqami</span><strong>{orderId}</strong></div><div><span>Buyurtma summasi</span><strong>{formatUZS(completedTotal)}</strong></div><div><span>Yangi daraja</span><TierBadge tier={afterSummary.currentTier} /></div></div>{upgradeReached ? <div className="success-upgrade"><Sparkles size={18} /><span><b>{afterSummary.currentTier.name} darajasi faollashdi</b><small>Yangi ulgurji chegirmangiz: {afterSummary.discountPercent}%</small></span></div> : null}<p className="demo-disclaimer">Bu faqat demo rejimidagi bajarilgan buyurtma simulyatsiyasi. Haqiqiy rejimda loyallik darajasi faqat MoySklad’dan tasdiqlangan/yetkazilgan savdolar bo‘yicha hisoblanadi.</p><div className="success-actions"><Link href="/orders" className="button secondary">Buyurtmalarim</Link><Link href="/catalog" className="button primary">Yana buyurtma berish <ArrowRight size={16} /></Link></div></div>;

  return <>
    <PageHeading eyebrow="SAVAT VA BUYURTMA" title="Buyurtmani ko‘rib chiqish" description="Narxlar sizning hamkorlik shartlaringiz asosida hisoblandi." actions={<Link href="/catalog" className="button ghost"><ArrowLeft size={16} /> Katalogga qaytish</Link>} />
    {!lines.length ? <div className="order-empty"><span className="empty-filter-icon"><ShoppingBag size={23} /></span><h2>Savatingiz hozircha bo‘sh</h2><p>Katalogdan mahsulot tanlab, buyurtmani shu yerda rasmiylashtiring.</p><Link href="/catalog" className="button primary">Katalogga o‘tish <ArrowRight size={16} /></Link></div> : <>
      <div className="checkout-stepper"><span className="step active"><i>1</i> Mahsulotlar</span><b /><span className="step active"><i>2</i> Tekshirish</span><b /><span className="step"><i>3</i> Tasdiqlash</span></div>
      <div className="checkout-layout"><section className="surface checkout-items"><div className="checkout-section-heading"><div><h3>Tanlangan mahsulotlar</h3><span>{lines.length} xil mahsulot · {quantity} quti</span></div><button className="text-link danger-link" onClick={clearCart}><Trash2 size={14} /> Barchasini o‘chirish</button></div>
        <div className="checkout-list">{lines.map((line) => <div className="checkout-line" key={line.productId}><ProductArtwork product={line.product} className="checkout-art" /><div className="checkout-product-info"><b>{line.product.name}</b><span>{line.product.sku} · {line.product.unit}</span><small>{line.price.priceSource === 'CUSTOMER_SPECIAL' ? 'Kelishilgan maxsus narx' : `${line.price.discountPercent}% hamkorlik chegirmasi`}</small></div><div className="quantity-control"><button aria-label="Miqdorni kamaytirish" onClick={() => setCartQuantity(line.productId, line.quantity - 1)}><Minus size={14} /></button><input aria-label={`${line.product.name} miqdori`} type="number" min={1} value={line.quantity} onChange={(event) => setCartQuantity(line.productId, Number(event.target.value))} /><button aria-label="Miqdorni oshirish" onClick={() => setCartQuantity(line.productId, line.quantity + 1)}><Plus size={14} /></button></div><div className="checkout-line-price"><b>{formatUZS(line.subtotal)}</b><span>{formatUZS(line.price.finalPrice)} / quti</span></div><button className="remove-line" aria-label={`${line.product.name}ni o‘chirish`} onClick={() => removeFromCart(line.productId)}><Trash2 size={16} /></button></div>)}</div>
        <Link href="/catalog" className="add-more-link"><Plus size={15} /> Yana mahsulot qo‘shish</Link>
        <div className="delivery-note"><span><Truck size={17} /></span><div><b>Yetkazib berish shartlari</b><small>Buyurtma tasdiqlangandan so‘ng menejeringiz yetkazish vaqtini kelishadi.</small></div></div>
      </section>
      <aside className="checkout-aside"><section className="surface order-total-card"><h3>Buyurtma xulosasi</h3><div className="summary-row"><span>Mahsulotlar</span><b>{lines.length} xil</b></div><div className="summary-row"><span>Jami quti</span><b>{quantity} quti</b></div><div className="summary-row"><span>Asosiy B2B narx</span><b>{formatUZS(baseTotal)}</b></div><div className="summary-row savings-row"><span>Sizning tejamingiz</span><b>− {formatUZS(baseTotal - finalTotal)}</b></div><div className="summary-divider" /><div className="summary-grand"><span>Jami to‘lov</span><strong>{formatUZS(finalTotal)}</strong></div><div className="checkout-tier-info"><div><span className="tier-info-label">BUYURTMADAN OLDIN</span><TierBadge tier={beforeSummary.currentTier} /><b>{config.metric === 'boxes' ? `${customerBoxes} quti` : formatUZS(customerTurnover)} · {beforeSummary.discountPercent}%</b></div><ArrowRight size={18} className="tier-flow-arrow" /><div><span className="tier-info-label">BUYURTMADAN KEYIN</span><TierBadge tier={afterSummary.currentTier} /><b>{config.metric === 'boxes' ? `${projectedValue} quti` : formatUZS(projectedValue)} · {afterSummary.discountPercent}%</b></div></div>{willUpgrade ? <div className="upgrade-notice checkout-upgrade"><span className="upgrade-icon"><Sparkles size={16} /></span><span><strong>Buyurtmadan keyin {afterSummary.currentTier.name}!</strong><small>Yangi chegirmangiz {afterSummary.discountPercent}% bo‘ladi.</small></span></div> : noNextReached ? <div className="upgrade-notice checkout-upgrade"><span className="upgrade-icon"><Sparkles size={16} /></span><span><strong>{config.metric === 'boxes' ? `${afterSummary.remaining} quti` : formatUZS(afterSummary.remaining)} qoldi</strong><small>{afterSummary.nextTier?.name} darajasiga yana oz qoldi.</small></span></div> : null}<button className="button primary full checkout-confirm" onClick={() => { setCompletedTotal(finalTotal); setUpgradeReached(willUpgrade); const order = simulateFulfillment(); setOrderId(order.id); setCompleted(true); }}><Check size={17} /> Demo rejimida bajarilgan deb belgilash</button><div className="secure-note"><ShieldCheck size={15} /> To‘lov ma’lumotlari talab qilinmaydi</div></section><div className="mock-warning"><span>ⓘ</span><p><b>Demo muhit</b><br />Tasdiqlash buyurtmani demo rejimida “Yetkazildi” deb belgilaydi. Jonli MoySklad ulanishi sozlanmaguncha haqiqiy buyurtma yuborilmaydi.</p></div></aside></div>
    </>}
  </>;
}
