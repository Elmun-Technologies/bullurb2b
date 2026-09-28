'use client';

import { useState } from 'react';
import { Check, CircleHelp, Info, Plus, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { usePortal } from '@/components/portal-context';
import { validateTiers } from '@/lib/domain/loyalty';
import type { LoyaltyConfig, LoyaltyTier, MetricType, PeriodType } from '@/lib/domain/types';
import { PageHeading, TierBadge } from '@/components/ui';

export default function LoyaltySettingsPage() {
  const { config, saveConfig } = usePortal();
  const [draft, setDraft] = useState<LoyaltyConfig>(() => ({ ...config, tiers: config.tiers.map((tier) => ({ ...tier })) }));
  const [errors, setErrors] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);
  const changeTier = (id: string, field: keyof LoyaltyTier, value: string | number | boolean) => setDraft((current) => ({ ...current, tiers: current.tiers.map((tier) => tier.id === id ? { ...tier, [field]: value } : tier) }));
  const save = () => {
    const next = validateTiers(draft.tiers);
    if (next.length) { setErrors(next); setSaved(false); return; }
    saveConfig({ ...draft, bonusSystemEnabled: false });
    setErrors([]); setSaved(true); window.setTimeout(() => setSaved(false), 3000);
  };
  const addTier = () => {
    setDraft((current) => ({ ...current, tiers: [...current.tiers, { id: `tier-${Date.now()}`, name: 'Yangi daraja', minValue: current.tiers[current.tiers.length - 1].minValue + 100, discountPercent: 12, color: '#528476', description: 'Yangi hamkorlik darajasi', active: true }] }));
    setErrors([]);
  };
  const patch = (update: Partial<LoyaltyConfig>) => setDraft((current) => ({ ...current, ...update }));
  const changeMetric = (metric: MetricType) => {
    const defaults = metric === 'boxes' ? [0, 50, 100, 200, 500] : [0, 10_000_000, 25_000_000, 50_000_000, 100_000_000];
    setDraft((current) => ({ ...current, metric, tiers: current.tiers.map((tier, index) => ({ ...tier, minValue: defaults[index] ?? (defaults[defaults.length - 1] + (index - defaults.length + 1) * (metric === 'boxes' ? 100 : 25_000_000)) })) }));
    setErrors([]);
  };

  return <>
    <PageHeading eyebrow="DASTUR QOIDALARI" title="Loyallik dasturi sozlamalari" description="Hamkorlik darajalarini, hisoblash mezonini va davrini boshqaring." actions={<button className="button primary" onClick={save}><Save size={16} /> O‘zgarishlarni saqlash</button>} />
    <div className="settings-demo-banner"><span className="settings-demo-icon"><Info size={17} /></span><span><b>Demo sozlamalari</b><small>O‘zgarishlar ushbu brauzerda saqlanadi. Jonli dastur qoidalari Shopflow’da saqlanishi kerak.</small></span><span className="demo-tag">DEMO</span></div>
    {errors.length ? <div className="validation-errors" role="alert"><b>Sozlamalarni tekshiring:</b><ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul></div> : null}
    {saved ? <div className="save-confirmation"><Check size={16} /> Sodiqlik dasturi sozlamalari demo rejimida saqlandi.</div> : null}
    <div className="settings-layout"><div className="settings-main-column">
      <section className="surface settings-section"><div className="settings-section-head"><span className="settings-step">01</span><div><h3>Umumiy sozlamalar</h3><p>Sodiqlik dasturining asosiy ishlash usulini belgilang.</p></div></div><div className="setting-row"><div><b>Dastur holati</b><small>Dastur o‘chirilganda mijozlarga sodiqlik chegirmasi qo‘llanmaydi.</small></div><label className="switch-control"><input type="checkbox" checked={draft.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /><span /></label></div><div className="setting-control-grid"><label className="form-control"><span>Hisoblash mezoni</span><select value={draft.metric} onChange={(event) => changeMetric(event.target.value as MetricType)}><option value="boxes">Xarid qilingan qutilar soni</option><option value="turnover">Xarid aylanmasi (UZS)</option></select><small>{draft.metric === 'boxes' ? 'Yetkazilgan mahsulotlar qutilar bo‘yicha jamlanadi.' : 'Yetkazilgan xaridlar UZS qiymati bo‘yicha jamlanadi.'} Mezon almashganda tavsiya etilgan chegaralar o‘rnatiladi — saqlashdan oldin tekshiring.</small></label><label className="form-control"><span>Sodiqlik davri</span><select value={draft.period} onChange={(event) => patch({ period: event.target.value as PeriodType })}><option value="calendar-month">Joriy kalendar oyi</option><option value="last-30-days">Oxirgi 30 kun</option><option value="last-90-days">Oxirgi 90 kun</option></select><small>Vaqt mintaqasi: {draft.timezone}</small></label></div></section>
      <section className="surface settings-section tiers-settings"><div className="settings-section-head"><span className="settings-step">02</span><div><h3>Darajalar va chegirmalar</h3><p>Chegaralar ketma-ket ortib borishi kerak. Chegirma 0–100% oralig‘ida.</p></div><span className="editable-tag">TAHRIRLANADI</span></div><div className="tier-edit-table"><div className="tier-edit-head"><span>DARAJA NOMI</span><span>MIN. {draft.metric === 'boxes' ? 'QUTI' : 'UZS'}</span><span>CHEGIRMA</span><span>HOLAT</span><span /></div>{draft.tiers.map((tier, index) => <div className="tier-edit-row" key={tier.id}><div className="tier-edit-name"><i style={{ backgroundColor: tier.color }} /><input aria-label={`${tier.name} daraja nomi`} value={tier.name} onChange={(event) => changeTier(tier.id, 'name', event.target.value)} />{index === 0 ? <span className="entry-tier-tag">BOSHLANG‘ICH</span> : null}</div><label className="input-with-unit"><input aria-label={`${tier.name} minimal xaridi`} type="number" min="0" step="1" value={tier.minValue} onChange={(event) => changeTier(tier.id, 'minValue', Number(event.target.value))} /><span>{draft.metric === 'boxes' ? 'quti' : 'so‘m'}</span></label><label className="discount-input"><input aria-label={`${tier.name} chegirmasi foizda`} type="number" min="0" max="100" step="1" value={tier.discountPercent} onChange={(event) => changeTier(tier.id, 'discountPercent', Number(event.target.value))} /><span>%</span></label><label className="tier-active-check"><input type="checkbox" checked={tier.active} onChange={(event) => changeTier(tier.id, 'active', event.target.checked)} /><span>{tier.active ? 'Faol' : 'O‘chiq'}</span></label><button className="remove-tier-button" aria-label={`${tier.name}ni o‘chirish`} disabled={index === 0} onClick={() => setDraft((current) => ({ ...current, tiers: current.tiers.filter((item) => item.id !== tier.id) }))}><Trash2 size={15} /></button></div>)}</div><button className="add-tier-button" onClick={addTier}><Plus size={15} /> Yangi daraja qo‘shish</button><div className="tier-validation-note"><ShieldCheck size={15} /><span>Birinchi bosqich 0 dan boshlanishi shart. Chegaralar takrorlanmasligi va o‘sib borishi kerak.</span></div></section>
      <section className="surface settings-section"><div className="settings-section-head"><span className="settings-step">03</span><div><h3>Qo‘shimcha imkoniyatlar</h3><p>Bonus hisobi uchun Shopflow’dagi xavfsiz saqlash integratsiyasi kerak.</p></div></div><div className="setting-row bonus-setting"><span className="bonus-setting-icon">✦</span><div><b>Bonus tizimini yoqish</b><small>Bonus balanslari, ishlatish va muddati tugashi hozircha demo oqimiga ulanmagan.</small></div><label className="switch-control" aria-label="Bonus tizimi Shopflow integratsiyasidan keyin mavjud bo‘ladi"><input type="checkbox" defaultChecked={false} disabled /><span /></label></div></section>
    </div><aside className="settings-side-column"><section className="surface config-preview"><div className="section-kicker">MIJOZLARGA KO‘RINISHI</div><h3>Daraja ko‘rinishi</h3><p>Sizning hamkorlaringiz sodiqlik sahifasida quyidagilarni ko‘radi.</p><div className="config-preview-list">{draft.tiers.filter((tier) => tier.active).slice().sort((a, b) => a.minValue - b.minValue).map((tier, index) => <div key={tier.id}><span className="preview-step" style={{ '--tier-color': tier.color } as React.CSSProperties}>{String(index + 1).padStart(2, '0')}</span><TierBadge tier={tier} /><b>{tier.discountPercent}%</b><small>{tier.minValue === 0 ? '0 dan' : `${tier.minValue.toLocaleString('uz-UZ')} dan`}</small></div>)}</div><span className="timezone-note"><CircleHelp size={14} /> Davr: {draft.period === 'calendar-month' ? 'Kalendar oyi' : draft.period === 'last-30-days' ? 'Oxirgi 30 kun' : 'Oxirgi 90 kun'} · {draft.timezone}</span></section><section className="surface config-note-card"><span><Info size={16} /></span><div><b>Pasayish qoidasi</b><p>Daraja ko‘tarilishi darhol amalga oshadi. Pasayish keyingi hisob-kitob davri boshida qo‘llanadi.</p></div></section><button onClick={save} className="button primary full settings-save-bottom"><Save size={16} /> Sozlamalarni saqlash</button></aside></div>
  </>;
}
