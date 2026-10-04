/**
 * Per-instance login attempt throttle (single-machine pilot).
 * Multi-instance deployments need a shared store (Redis) — documented.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 10;
const attempts = new Map<string, { count: number; resetAt: number }>();

export function isAdminLoginLocked(key: string, now = Date.now()): boolean {
  const record = attempts.get(key);
  return !!record && record.resetAt > now && record.count >= MAX_ATTEMPTS;
}

export function recordAdminLoginFailure(key: string, now = Date.now()): void {
  const record = attempts.get(key);
  const entry = record && record.resetAt > now ? record : { count: 0, resetAt: now + WINDOW_MS };
  entry.count += 1;
  attempts.set(key, entry);
}

export function clearAdminLoginAttempts(key: string): void {
  attempts.delete(key);
}

export function resetAdminLoginThrottle(): void {
  attempts.clear();
}
