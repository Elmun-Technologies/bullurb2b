import { checkAdminSession } from '@/lib/admin-auth/session';
import { IntegrationError } from '@/lib/providers/errors';
import { getTelegramStores } from '@/lib/telegram/stores';
import type { TelegramApplicationStatus } from '@/lib/telegram/types';

/**
 * Admin review queue for bot registration applications.
 * Protected by the admin login session (middleware + this check); the
 * portal demo role switcher is NOT authentication and is never trusted.
 */
export const dynamic = 'force-dynamic';

const STATUSES: TelegramApplicationStatus[] = ['pending', 'approved', 'rejected'];

export async function GET(request: Request): Promise<Response> {
  const session = await checkAdminSession(request);
  if (session !== 'ok') {
    return Response.json({ ok: false, error: session === 'unconfigured' ? 'admin-unconfigured' : 'unauthorized' }, { status: session === 'unconfigured' ? 503 : 401 });
  }
  const stores = getTelegramStores();
  try {
    await stores.applications.listByStatus('pending');
  } catch (error) {
    if (error instanceof IntegrationError && error.failure === 'UNCONFIGURED') {
      return Response.json({ ok: false, error: 'admin-unconfigured' }, { status: 503 });
    }
    throw error;
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
