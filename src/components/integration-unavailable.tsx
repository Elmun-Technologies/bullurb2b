import { CircleAlert, ShieldCheck } from 'lucide-react';

export function IntegrationUnavailable() {
  return <main className="integration-blocked-page"><section className="integration-blocked-card"><span className="integration-blocked-icon"><ShieldCheck size={22} /></span><div className="eyebrow">BARAKA B2B PORTAL</div><h1>Portal ulanishi tayyor emas</h1><p>Jonli MoySklad rejimi tanlangan, ammo tasdiqlangan server adapteri va Shopflow autentifikatsiyasi hali sozlanmagan. Xavfsizlik uchun demo yoki mijoz ma’lumotlari ko‘rsatilmayapti.</p><div><CircleAlert size={16} /><span>Administrator MoySklad va Shopflow integratsiyalarini sozlagach qayta urinib ko‘ring.</span></div></section></main>;
}
