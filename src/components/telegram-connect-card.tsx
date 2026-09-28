'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellRing, Copy, Check, Send, ShieldCheck } from 'lucide-react';

interface TelegramStatus {
  ok: boolean;
  status?: 'disabled' | 'unconfigured' | 'ready';
  botUsername?: string | null;
  liveDataMode?: boolean;
  missing?: string[];
  storageReady?: boolean;
}

interface LinkCodeResponse {
  ok: boolean;
  code?: string;
  deepLink?: string | null;
  expiresAt?: number;
  error?: string;
  message?: string;
}

/**
 * Telegram reminder setup card. Shows the secret-free integration status and,
 * once production auth/storage are connected, issues the user's own one-time
 * linking code. No secret is ever rendered: only the user's personal
 * single-use code (or an honest setup message in demo mode).
 */
export function TelegramConnectCard() {
  const [status, setStatus] = useState<TelegramStatus | null>(null);
  const [link, setLink] = useState<LinkCodeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/telegram/status', { cache: 'no-store' })
      .then((response) => response.json() as Promise<TelegramStatus>)
      .then((value) => { if (!cancelled) setStatus(value); })
      .catch(() => { if (!cancelled) setStatus({ ok: false }); });
    return () => { cancelled = true; };
  }, []);

  const requestCode = useCallback(async () => {
    setLoading(true);
    setLink(null);
    try {
      const response = await fetch('/api/telegram/link-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale: 'uz' }),
      });
      setLink((await response.json()) as LinkCodeResponse);
    } catch {
      setLink({ ok: false, error: 'network', message: 'So‘rov bajarilmadi. Qayta urinib ko‘ring.' });
    } finally {
      setLoading(false);
    }
  }, []);

  const copyCode = useCallback(async () => {
    if (!link?.code) return;
    await navigator.clipboard?.writeText(`/start ${link.code}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }, [link?.code]);

  const state = status?.status ?? (status ? 'unconfigured' : null);
  return <section className="surface telegram-card" aria-label="Telegram eslatmalar">
    <div className="section-header">
      <div>
        <div className="section-kicker">TELEGRAM ESLATMALAR</div>
        <h3><BellRing size={17} /> Bot orqali eslatmalar</h3>
      </div>
      <span className="readonly-pill"><ShieldCheck size={14} /> {state === 'ready' ? 'Tayyor' : state === 'disabled' ? 'O‘chiq' : 'Sozlanmagan'}</span>
    </div>

    {state === null ? <p className="telegram-muted">Holat tekshirilmoqda…</p> : null}

    {state === 'disabled' || state === 'unconfigured' ? <div className="telegram-setup">
      <p>Telegram eslatmalar hozir <b>{state === 'disabled' ? 'o‘chiq' : 'sozlanmagan'}</b>. Portal ichidagi eslatmalar markazi avvalgidek ishlaydi.</p>
      <p className="telegram-muted">Ishga tushirish uchun serverda bot tokeni, webhook maxfiy kaliti, ulanish kaliti va scheduler kaliti sozlanishi, Shopflow autentifikatsiya va doimiy saqlash ulanishi kerak. Demo rejimidagi ma’lumotlar Telegram’ga yuborilmaydi.</p>
      <p className="telegram-muted">Batafsil: <code>TELEGRAM_SETUP.md</code></p>
    </div> : null}

    {state === 'ready' ? <div className="telegram-setup">
      <p>Hisobingizni bog‘lash uchun bir martalik kod oling (10 daqiqa amal qiladi):</p>
      <button className="button primary" onClick={requestCode} disabled={loading}>
        <Send size={16} /> {loading ? 'Tayyorlanmoqda…' : 'Bog‘lash kodi olish'}
      </button>
      {link?.ok && link.code ? <div className="telegram-code-box">
        <code>/start {link.code}</code>
        <button onClick={copyCode} aria-label="Koddan nusxalash" className="copy-button">{copied ? <Check size={14} /> : <Copy size={14} />}</button>
      </div> : null}
      {link?.ok && link.deepLink ? <a className="text-link" href={link.deepLink} target="_blank" rel="noreferrer">Botni ochish ↗</a> : null}
      {link && !link.ok ? <p className="telegram-error">{link.message ?? 'Kod olishda xatolik. Administrator bilan bog‘laning.'}</p> : null}
      <p className="telegram-muted">Bot buyruqlari: <code>/start</code> — yoqish, <code>/stop</code> — o‘chirish, <code>/help</code> — yordam.</p>
    </div> : null}
  </section>;
}
