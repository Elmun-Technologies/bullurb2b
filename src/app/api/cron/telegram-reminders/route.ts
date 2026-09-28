import { loyaltySettingsStore, moySkladProvider } from '@/lib/providers';
import { IntegrationError, safeIntegrationMessage } from '@/lib/providers/errors';
import { TelegramBotApiClient } from '@/lib/telegram/client';
import { getTelegramServerConfig, requireTelegramCronSecret, requireTelegramDeliveryConfig } from '@/lib/telegram/config';
import { dispatchTelegramReminders } from '@/lib/telegram/dispatcher';
import { getTelegramStores } from '@/lib/telegram/stores';
import { extractBearerToken, verifyBearerSecret } from '@/lib/telegram/webhook';

/**
 * Authenticated scheduler entrypoint for Telegram reminders.
 *
 * Must be invoked by a real external scheduler (cron, Vercel Cron, GitHub
 * Actions, …) with `Authorization: Bearer <TELEGRAM_CRON_SECRET>`. Both GET
 * and POST are accepted for scheduler compatibility. Unauthenticated calls
 * are rejected, and demo/mock provider data is never delivered.
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

  if (process.env.MOYSKLAD_MODE !== 'live') {
    return Response.json(
      { ok: false, error: 'mock-mode', message: 'Refusing to deliver demo/mock records to Telegram. Live provider mode is required.' },
      { status: 503 },
    );
  }

  let loyaltyConfig;
  try {
    loyaltyConfig = await loyaltySettingsStore.getConfig();
  } catch (error) {
    return Response.json(
      { ok: false, error: 'settings-unconfigured', message: error instanceof IntegrationError ? error.userMessage : safeIntegrationMessage(error) },
      { status: 503 },
    );
  }

  try {
    const delivery = requireTelegramDeliveryConfig();
    const sender = new TelegramBotApiClient(delivery.botToken);
    const summary = await dispatchTelegramReminders({
      config: loyaltyConfig,
      provider: moySkladProvider,
      dataMode: 'live',
      stores: getTelegramStores(),
      sender,
      delayBetweenSendsMs: 120,
    });
    return Response.json({ ok: true, summary });
  } catch (error) {
    if (error instanceof IntegrationError) {
      return Response.json({ ok: false, error: error.failure.toLowerCase(), message: error.userMessage }, { status: 503 });
    }
    return Response.json({ ok: false, error: 'dispatch-failed' }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<Response> {
  return run(request);
}

export async function POST(request: Request): Promise<Response> {
  return run(request);
}
