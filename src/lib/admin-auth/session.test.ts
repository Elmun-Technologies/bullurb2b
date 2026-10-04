import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAdminSession, isValidAdminSession, requireAdminPassword, verifyAdminPassword } from './session';

const SECRET = 'test-admin-password-0123456789';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('admin auth session', () => {
  it('requires a configured password of minimum length', () => {
    expect(requireAdminPassword()).toBeNull();
    vi.stubEnv('ADMIN_PASSWORD', 'too-short');
    expect(requireAdminPassword()).toBeNull();
    vi.stubEnv('ADMIN_PASSWORD', SECRET);
    expect(requireAdminPassword()).toBe(SECRET);
  });

  it('verifies passwords without leaking them', async () => {
    expect(await verifyAdminPassword(SECRET, SECRET)).toBe(true);
    expect(await verifyAdminPassword('wrong-password-000000000000', SECRET)).toBe(false);
    expect(await verifyAdminPassword('', SECRET)).toBe(false);
  });

  it('issues sessions that expire and reject tampering', async () => {
    const now = Date.now();
    const token = await createAdminSession(SECRET, now);
    expect(await isValidAdminSession(token, SECRET, now + 1000)).toBe(true);
    expect(await isValidAdminSession(token, SECRET, now + 13 * 60 * 60 * 1000)).toBe(false);
    expect(await isValidAdminSession('not-a-token', SECRET, now)).toBe(false);
    expect(await isValidAdminSession(token, 'other-secret-0000000000000000', now + 1000)).toBe(false);
    const [exp, signature] = token.split('.');
    const tampered = `${Number(exp) + 9999}.${signature}`;
    expect(await isValidAdminSession(tampered, SECRET, now + 1000)).toBe(false);
  });
});
