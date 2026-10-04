import { IntegrationError, safeIntegrationMessage } from '@/lib/providers/errors';
import { TelegramBotApiClient } from '@/lib/telegram/client';
import { getTelegramServerConfig, readTelegramAdminChatId, requireTelegramCronSecret, requireTelegramDeliveryConfig } from '@/lib/telegram/config';
import { dispatchFollowups } from '@/lib/telegram/followups';
import { getTelegramStores } from '@/lib/telegram/stores';
import { extractBearerToken, verifyBearerSecret } from '@/lib/telegram/webhook';

/**
 * Authenticated scheduler entrypoint for stage-based client follow-ups.
 *
 * Works on bot-collected data only (dialogs, applications, bot orders) — no
 * MoySklad live reads required. `?dryRun=1` previews without sending;
 * `?limit=N` caps live sends per run (default 25, max 100).
 */
export const dynamic = 'force-dynamic';

async function run(request: Request): Promise<Response> {
  const status = getTelegramServerConfig();
  if (status.status !== 'ready') {
    return Response.json({ ok: false, error: 'telegram-unconfigured', missing: status.missing }, { status: 503 });
  }

  let cronSecret: string;
  try {
    cronSecret = requireTelegramCronSecret();
  } catch {
    return Response.json({ ok: false, error: 'scheduler-unconfigured' }, { status: 503 });
  }
  const token = extractBearerToken(request.headers.get('authorization'));
  if (!verifyBearerSecret(token, cronSecret)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const dryRun = searchParams.get('dryRun') === '1';
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') ?? 25) || 25));

  try {
    const delivery = requireTelegramDeliveryConfig();
    const sender = new TelegramBotApiClient(delivery.botToken);
    const { summary, previews } = await dispatchFollowups({
      stores: getTelegramStores(),
      sender,
      dryRun,
      maxSends: limit,
      delayBetweenSendsMs: 120,
      adminChatId: readTelegramAdminChatId(),
    });
    return Response.json({ ok: true, summary, ...(dryRun ? { previews } : {}) });
  } catch (error) {
    if (error instanceof IntegrationError) {
      return Response.json({ ok: false, error: error.failure.toLowerCase(), message: error.userMessage }, { status: 503 });
    }
    return Response.json({ ok: false, error: 'dispatch-failed', message: safeIntegrationMessage(error) }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}
