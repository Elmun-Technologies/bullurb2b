import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { middleware } from '@/middleware';
import { ADMIN_SESSION_COOKIE, createAdminSession } from '@/lib/admin-auth/session';
import { resetAdminLoginThrottle } from '@/lib/admin-auth/throttle';
import { POST as loginPOST } from './login/route';

const SECRET = 'test-admin-password-0123456789';

afterEach(() => {
  vi.unstubAllEnvs();
  resetAdminLoginThrottle();
});

function loginForm(password: string, next = '/admin'): Request {
  const form = new FormData();
  form.set('password', password);
  form.set('next', next);
  return new Request('https://portal.test/api/admin/login', { method: 'POST', body: form });
}

describe('admin login route', () => {
  it('fails closed without a configured password', async () => {
    const response = await loginPOST(loginForm(SECRET));
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('unconfigured=1');
  });

  it('sets a session cookie on success and bounces failures', async () => {
    vi.stubEnv('ADMIN_PASSWORD', SECRET);
    const ok = await loginPOST(loginForm(SECRET));
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('https://portal.test/admin');
    expect(ok.cookies.get(ADMIN_SESSION_COOKIE)?.value).toContain('.');

    const bad = await loginPOST(loginForm('wrong-password-000000000000'));
    expect(bad.status).toBe(303);
    expect(bad.headers.get('location')).toContain('error=1');
  });

  it('throttles repeated failures from one client', async () => {
    vi.stubEnv('ADMIN_PASSWORD', SECRET);
    for (let index = 0; index < 10; index += 1) {
      await loginPOST(loginForm('wrong-password-000000000000'));
    }
    const locked = await loginPOST(loginForm(SECRET));
    expect(locked.status).toBe(303);
    expect(locked.headers.get('location')).toContain('error=locked');
  });
});

describe('admin middleware gate', () => {
  it('redirects page visits without a session and lets sessions through', async () => {
    vi.stubEnv('ADMIN_PASSWORD', SECRET);
    const denied = await middleware(new NextRequest('https://portal.test/admin'));
    expect(denied.status).toBe(307);
    expect(denied.headers.get('location')).toContain('/admin/login');

    const token = await createAdminSession(SECRET);
    const authed = new NextRequest('https://portal.test/admin');
    authed.cookies.set(ADMIN_SESSION_COOKIE, token);
    expect((await middleware(authed)).status).toBe(200);
  });

  it('returns 401 JSON for api routes without a session', async () => {
    vi.stubEnv('ADMIN_PASSWORD', SECRET);
    const response = await middleware(new NextRequest('https://portal.test/api/admin/telegram/applications'));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: 'admin-auth-required' });
  });
});
