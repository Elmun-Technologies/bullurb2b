/**
 * Admin login wall: single shared password from `ADMIN_PASSWORD` + a
 * stateless HMAC-signed session cookie. No database, no new backend —
 * just a real gate so /admin and /api/admin are no longer open to the
 * world. Uses only WebCrypto so it runs in middleware (Edge) and in
 * Node route handlers alike.
 *
 * Pilot limits (honest): one shared password, per-instance login
 * throttling, no per-user audit. Full per-user auth (DB users, lockout,
 * audit log) is the documented next stage.
 */

export const ADMIN_SESSION_COOKIE = 'baraka_admin_session';
export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const SESSION_VERSION = 'baraka-admin-v1';
const MIN_PASSWORD_LENGTH = 12;

const encoder = new TextEncoder();

export function requireAdminPassword(): string | null {
  const value = (process.env.ADMIN_PASSWORD ?? '').trim();
  return value.length >= MIN_PASSWORD_LENGTH ? value : null;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

function sessionMessage(expiresAt: number): Uint8Array<ArrayBuffer> {
  return encoder.encode(`${SESSION_VERSION}:${expiresAt}`);
}

export async function createAdminSession(secret: string, now = Date.now()): Promise<string> {
  const expiresAt = now + ADMIN_SESSION_TTL_MS;
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), sessionMessage(expiresAt));
  return `${expiresAt}.${toHex(new Uint8Array(signature))}`;
}

export async function isValidAdminSession(token: string, secret: string, now = Date.now()): Promise<boolean> {
  const separator = token.indexOf('.');
  if (separator <= 0) return false;
  const expiresAt = Number(token.slice(0, separator));
  if (!Number.isInteger(expiresAt) || expiresAt <= now) return false;
  const signature = fromHex(token.slice(separator + 1));
  if (!signature || signature.length !== 32) return false;
  try {
    return await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, sessionMessage(expiresAt));
  } catch {
    return false;
  }
}

/** Constant-time-ish password check: SHA-256 both sides, then compare digests. */
export async function verifyAdminPassword(input: string, secret: string): Promise<boolean> {  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(input.trim())),
    crypto.subtle.digest('SHA-256', encoder.encode(secret)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export function readAdminSessionToken(request: Request): string | null {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${ADMIN_SESSION_COOKIE}=`)) {
      return trimmed.slice(ADMIN_SESSION_COOKIE.length + 1).trim() || null;
    }
  }
  return null;
}

/** Second auth layer for /api/admin routes (middleware is the first). */
export async function checkAdminSession(request: Request): Promise<'ok' | 'unconfigured' | 'unauthorized'> {
  const secret = requireAdminPassword();
  if (!secret) return 'unconfigured';
  const token = readAdminSessionToken(request);
  return token && (await isValidAdminSession(token, secret)) ? 'ok' : 'unauthorized';
}
