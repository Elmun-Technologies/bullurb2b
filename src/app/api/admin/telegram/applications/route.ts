import { IntegrationError } from '@/lib/providers/errors';
import { requireTelegramAdminSecret } from '@/lib/telegram/config';
import { getTelegramStores } from '@/lib/telegram/stores';
import type { TelegramApplicationStatus } from '@/lib/telegram/types';
import { extractBearerToken, verifyBearerSecret } from '@/lib/telegram/webhook';

/**
 * Admin review queue for bot registration applications.
 * Bearer-protected by TELEGRAM_ADMIN_SECRET (the portal demo role switcher
 * is NOT authentication and is never trusted here).
 */
export const dynamic = 'force-dynamic';

const STATUSES: TelegramApplicationStatus[] = ['pending', 'approved', 'rejected'];

export async function GET(request: Request): Promise<Response> {
  const stores = getTelegramStores();
  let adminSecret: string;
  try {
    adminSecret = requireTelegramAdminSecret();
    await stores.applications.listByStatus('pending');
  } catch (error) {
    if (error instanceof IntegrationError && error.failure === 'UNCONFIGURED') {
      return Response.json({ ok: false, error: 'admin-unconfigured' }, { status: 503 });
    }
    throw error;
  }
  if (!verifyBearerSecret(extractBearerToken(request.headers.get('authorization')), adminSecret)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const requested = searchParams.get('status') ?? 'pending';
  const statuses = requested === 'all' ? STATUSES : STATUSES.filter((status) => status === requested);
  if (statuses.length === 0) {
    return Response.json({ ok: false, error: 'bad-status', message: 'status must be pending, approved, rejected or all' }, { status: 400 });
  }
  const applications = (await Promise.all(statuses.map((status) => stores.applications.listByStatus(status)))).flat();
  return Response.json({ ok: true, applications });
}
