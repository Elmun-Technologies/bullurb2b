import { TelegramBotApiClient } from '@/lib/telegram/client';
import { getTelegramServerConfig, readTelegramAdminChatId, requireTelegramDeliveryConfig, requireTelegramLinkingSecret, requireTelegramWebhookSecret } from '@/lib/telegram/config';
import { getTelegramStores } from '@/lib/telegram/stores';
import { parseTelegramUpdate, TELEGRAM_WEBHOOK_SECRET_HEADER, verifyWebhookSecret } from '@/lib/telegram/webhook';
import { handleTelegramUpdate } from '@/lib/telegram/webhook-handler';
import { requireMoySkladConfig } from '@/lib/moysklad/config';
import { MoySkladClient } from '@/lib/moysklad/client';
import { ShopFlowClient } from '@/lib/shopflow/client';
import { readShopFlowStorefrontUrl, requireShopFlowConfig } from '@/lib/shopflow/config';
import type { CounterpartyDirectory } from '@/lib/telegram/onboarding';

/**
 * Telegram Bot API webhook receiver.
 *
 * Telegram retries any response with a non-2xx status, so after the secret is
 * validated this handler always answers 200 — delivery of `/start <code>`
 * links is single-use idempotent, and subscribe/unsubscribe are idempotent.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  const status = getTelegramServerConfig();
  if (status.status !== 'ready') {
    return Response.json({ ok: false, error: 'telegram-unconfigured', missing: status.missing }, { status: 503 });
  }

  const expectedSecret = requireTelegramWebhookSecret();
  const providedSecret = request.headers.get(TELEGRAM_WEBHOOK_SECRET_HEADER);
  if (!verifyWebhookSecret(providedSecret, expectedSecret)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  const update = parseTelegramUpdate(body);
  if (!update) {
    return Response.json({ ok: true, ignored: true });
  }

  const delivery = requireTelegramDeliveryConfig();
  const sender = new TelegramBotApiClient(delivery.botToken);
  const result = await handleTelegramUpdate({
    update,
    stores: getTelegramStores(),
    sender,
    botUsername: delivery.botUsername,
    linkingSecret: requireTelegramLinkingSecret(),
    directory: buildCounterpartyDirectory(),
    adminChatId: readTelegramAdminChatId(),
    shop: buildShopCatalog(),
    storefrontUrl: readShopFlowStorefrontUrl(),
  });
  return Response.json({ ok: true, action: result.action });
}

/**
 * MoySklad directory for phone onboarding. Null when the MoySklad token is
 * not configured — code linking and commands keep working without it.
 */
function buildCounterpartyDirectory(): CounterpartyDirectory | null {
  try {
    const config = requireMoySkladConfig();
    return new MoySkladClient(config.baseUrl, config.token);
  } catch {
    return null;
  }
}

/**
 * ShopFlow catalog backend for the in-bot shop. Null when the API URL/key
 * are not configured — the bot then honestly reports “coming soon”.
 */
function buildShopCatalog(): ShopFlowClient | null {
  try {
    const config = requireShopFlowConfig();
    return new ShopFlowClient(config.baseUrl, config.apiKey);
  } catch {
    return null;
  }
}
