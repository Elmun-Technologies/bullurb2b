import { NextResponse } from 'next/server';
import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_TTL_MS, createAdminSession, requireAdminPassword, verifyAdminPassword } from '@/lib/admin-auth/session';
import { clearAdminLoginAttempts, isAdminLoginLocked, recordAdminLoginFailure } from '@/lib/admin-auth/throttle';

/**
 * Admin login: plain HTML form POST (no client JS needed). Sets the
 * signed session cookie on success, bounces back to /admin/login on
 * failure. Attempt throttling is per-instance memory — enough for the
 * single-machine pilot; multi-instance needs Redis (documented).
 */

function clientKey(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

function loginRedirect(request: Request, params: string): NextResponse {
  return NextResponse.redirect(new URL(`/admin/login${params}`, request.url), { status: 303 });
}

function safeNext(raw: string | null): string {
  if (raw && raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/admin';
}

export async function POST(request: Request) {
  const secret = requireAdminPassword();
  if (!secret) return loginRedirect(request, '?unconfigured=1');

  const key = clientKey(request);
  const now = Date.now();
  if (isAdminLoginLocked(key, now)) {
    return loginRedirect(request, '?error=locked');
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return loginRedirect(request, '?error=1');
  }
  const next = safeNext(typeof form.get('next') === 'string' ? (form.get('next') as string) : null);
  const password = typeof form.get('password') === 'string' ? (form.get('password') as string) : '';

  if (!(await verifyAdminPassword(password, secret))) {
    recordAdminLoginFailure(key, now);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return loginRedirect(request, `?error=1&next=${encodeURIComponent(next)}`);
  }

  clearAdminLoginAttempts(key);
  const response = NextResponse.redirect(new URL(next, request.url), { status: 303 });
  response.cookies.set(ADMIN_SESSION_COOKIE, await createAdminSession(secret, now), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: Math.floor(ADMIN_SESSION_TTL_MS / 1000),
  });
  return response;
}
