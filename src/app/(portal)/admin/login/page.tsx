import { Lock } from 'lucide-react';

export const dynamic = 'force-dynamic';

const MESSAGES: Record<string, string> = {
  '1': 'Parol noto‘g‘ri. Qaytadan urining.',
  locked: 'Juda ko‘p urinish. 10 daqiqadan keyin qayting.',
};

/**
 * Admin login — plain server-rendered form, no client JS. The
 * PortalShell renders chrome-less on this route (see portal-shell).
 */
export default async function AdminLoginPage(context: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await context.searchParams;
  const next = params.next && params.next.startsWith('/') && !params.next.startsWith('//') ? params.next : '/admin';
  const unconfigured = params.unconfigured === '1';
  const error = params.error ? MESSAGES[params.error] ?? MESSAGES['1'] : null;

  return (
    <div className="admin-login-wrap">
      <section className="surface admin-login-card">
        <div className="admin-login-icon"><Lock size={22} /></div>
        <h1>Admin kirish</h1>
        <p className="muted-text">Boshqaruv paneli faqat parol bilan ochiladi.</p>
        {unconfigured ? (
          <p className="admin-login-error">Serverda <b>ADMIN_PASSWORD</b> sozlanmagan. Operator uni <b>fly secrets</b> orqali o‘rnatishi kerak.</p>
        ) : (
          <form action="/api/admin/login" method="post" className="admin-login-form">
            <input type="hidden" name="next" value={next} />
            <label className="form-control"><span>PAROL</span>
              <input type="password" name="password" autoComplete="current-password" required minLength={1} placeholder="••••••••••••" />
            </label>
            {error ? <p className="admin-login-error">{error}</p> : null}
            <button type="submit" className="button primary full">Kirish</button>
          </form>
        )}
      </section>
    </div>
  );
}
