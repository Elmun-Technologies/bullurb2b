import { NextResponse, type NextRequest } from 'next/server';
import { ADMIN_SESSION_COOKIE, isValidAdminSession, requireAdminPassword } from './lib/admin-auth/session';

/**
 * The demo role switcher is UI only — this middleware is the real gate:
 * every /admin page (except /admin/login) and every /api/admin route
 * requires a valid admin session, otherwise redirect to login / 401.
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  // The login/logout endpoints must stay public — otherwise nobody could
  // ever obtain (or clear) a session. Matcher excludes them too; this is
  // defense in depth so the gate never depends on config alone.
  if (pathname === '/admin/login' || pathname === '/api/admin/login' || pathname === '/api/admin/logout') {
    return NextResponse.next();
  }
  const isApi = pathname.startsWith('/api/admin/');
  const secret = requireAdminPassword();

  if (!secret) {
    return isApi
      ? NextResponse.json({ ok: false, error: 'admin-auth-unconfigured' }, { status: 503 })
      : NextResponse.redirect(new URL('/admin/login?unconfigured=1', request.url));
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value ?? '';
  if (token && (await isValidAdminSession(token, secret))) return NextResponse.next();

  if (isApi) return NextResponse.json({ ok: false, error: 'admin-auth-required' }, { status: 401 });
  const login = new URL('/admin/login', request.url);
  login.searchParams.set('next', pathname);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/admin', '/admin/((?!login$|login/).*)', '/api/admin/((?!login$|logout$).*)'],
};
