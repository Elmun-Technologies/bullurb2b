import { getTelegramPublicStatus } from '@/lib/telegram/config';
import { getTelegramStores, isUnconfiguredStores } from '@/lib/telegram/stores';

/**
 * Secret-free integration status for the setup UI and operators.
 * Never contains tokens, secrets, or chat identifiers.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const status = getTelegramPublicStatus();
  return Response.json({ ok: true, ...status, storageReady: !isUnconfiguredStores(getTelegramStores()) });
}
