'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Check, MapPin, RefreshCw, X } from 'lucide-react';
import { PageHeading } from '@/components/ui';

interface Application {
  chatId: number;
  phone: string;
  name: string;
  company: string;
  address: string;
  location?: { latitude: number; longitude: number };
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  reason?: string;
}

type Filter = 'pending' | 'approved' | 'rejected' | 'all';

/**
 * Admin review queue for bot registration applications.
 * Auth comes from the admin login session cookie (middleware guarantees it),
 * so there is no second secret prompt — fetch sends cookies automatically.
 */
export default function AdminTelegramPage() {
  const [filter, setFilter] = useState<Filter>('pending');
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [reasonFor, setReasonFor] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const load = useCallback(async (status: Filter) => {
    setLoading(true);
    setError(null);
    setSessionExpired(false);
    try {
      const response = await fetch(`/api/admin/telegram/applications?status=${status}`, { cache: 'no-store' });
      const body = (await response.json()) as { ok: boolean; applications?: Application[]; error?: string };
      if (!response.ok || !body.ok) {
        if (response.status === 401) {
          setSessionExpired(true);
          return;
        }
        setError(response.status === 503 ? 'Admin rejim sozlanmagan.' : `Xatolik: ${body.error ?? 'noma’lum'}`);
        return;
      }
      setApplications(body.applications ?? []);
    } catch {
      setError('So‘rov bajarilmadi. Qayta urinib ko‘ring.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(filter);
  }, [filter, load]);

  const decide = useCallback(async (chatId: number, decision: 'approve' | 'reject') => {
    setError(null);
    try {
      const response = await fetch(`/api/admin/telegram/applications/${chatId}/${decision}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(decision === 'reject' ? { reason } : {}),
      });
      const body = (await response.json()) as { ok: boolean; error?: string; notified?: boolean };
      if (!response.ok || !body.ok) {
        if (response.status === 401) {
          setSessionExpired(true);
          return;
        }
        setError(`Xatolik: ${body.error ?? 'noma’lum'}`);
        return;
      }
      if (!body.notified) setError('Qaror saqlandi, lekin bot xabari yuborilmadi (bot sozlamasini tekshiring).');
      setReasonFor(null);
      setReason('');
      await load(filter);
    } catch {
      setError('So‘rov bajarilmadi. Qayta urinib ko‘ring.');
    }
  }, [reason, filter, load]);

  return (
    <>
      <PageHeading eyebrow="TELEGRAM BOT" title="Ro‘yxatdan o‘tish arizalari" description="Bot orqali kelgan mijoz arizalarini ko‘rib chiqing va tasdiqlang." />
      {sessionExpired ? (
        <section className="surface"><p>Sessiya tugagan. <Link href="/admin/login" className="text-link">Qayta kiring</Link>.</p></section>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {(['pending', 'approved', 'rejected', 'all'] as Filter[]).map((value) => (
              <button key={value} type="button" className={`button ${filter === value ? 'primary' : 'secondary'}`} onClick={() => setFilter(value)}>
                {value === 'pending' ? 'Kutilmoqda' : value === 'approved' ? 'Tasdiqlangan' : value === 'rejected' ? 'Rad etilgan' : 'Barchasi'}
              </button>
            ))}
            <button type="button" className="button secondary" onClick={() => load(filter)} aria-label="Yangilash"><RefreshCw size={15} /> Yangilash</button>
          </div>
          {error ? <p className="telegram-error">{error}</p> : null}
          {loading ? <p>Yuklanmoqda…</p> : null}
          {!loading && applications.length === 0 ? <section className="surface"><p>Arizalar yo‘q.</p></section> : null}
          <div style={{ display: 'grid', gap: 12 }}>
            {applications.map((application) => (
              <section className="surface" key={application.chatId}>
                <div className="section-header">
                  <div><div className="section-kicker">{application.status === 'pending' ? 'KUTILMOQDA' : application.status === 'approved' ? 'TASDIQLANGAN' : 'RAD ETILGAN'} · {new Date(application.createdAt).toLocaleString('uz-UZ')}</div><h3>{application.company}</h3><p>{application.name} · {application.phone}</p></div>
                </div>
                <p><b>Manzil:</b> {application.address}</p>
                <p>
                  <b>Lokatsiya:</b>{' '}
                  {application.location ? (
                    <a className="text-link" href={`https://maps.google.com/?q=${application.location.latitude},${application.location.longitude}`} target="_blank" rel="noreferrer">
                      <MapPin size={13} /> {application.location.latitude}, {application.location.longitude}
                    </a>
                  ) : 'yuborilmadi'}
                </p>
                {application.reason ? <p><b>Rad sababi:</b> {application.reason}</p> : null}
                {application.status === 'pending' ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                    <button type="button" className="button primary" onClick={() => decide(application.chatId, 'approve')}><Check size={15} /> Tasdiqlash</button>
                    {reasonFor === application.chatId ? (
                      <>
                        <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Sabab (ixtiyoriy)" className="input" style={{ flex: 1, minWidth: 200 }} aria-label="Rad sababi" />
                        <button type="button" className="button secondary" onClick={() => decide(application.chatId, 'reject')}><X size={15} /> Rad etish</button>
                      </>
                    ) : (
                      <button type="button" className="button secondary" onClick={() => { setReasonFor(application.chatId); setReason(''); }}><X size={15} /> Rad etish</button>
                    )}
                  </div>
                ) : null}
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
