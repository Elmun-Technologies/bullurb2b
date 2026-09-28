import { IntegrationError } from '@/lib/providers/errors';
import { TelegramBotApiClient } from '@/lib/telegram/client';
import { requireTelegramAdminSecret, requireTelegramDeliveryConfig } from '@/lib/telegram/config';
import { buildApplicationApprovedMessage } from '@/lib/telegram/messages';
import { getTelegramStores } from '@/lib/telegram/stores';
import { extractBearerToken, verifyBearerSecret } from '@/lib/telegram/webhook';

/**
 * Approves a pending registration application and notifies the chat.
 * The MoySklad counterparty itself is created manually by the operator for
 * now (see TELEGRAM_SETUP.md); auto-creation is a future step.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ chatId: string }> }): Promise<Response> {
  const stores = getTelegramStores();
  let adminSecret: string;
  try {
    adminSecret = requireTelegramAdminSecret();
  } catch (error) {
    if (error instanceof IntegrationError && error.failure === 'UNCONFIGURED') {
      return Response.json({ ok: false, error: 'admin-unconfigured' }, { status: 503 });
    }
    throw error;
  }
  if (!verifyBearerSecret(extractBearerToken(request.headers.get('authorization')), adminSecret)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const chatId = Number((await context.params).chatId);
  if (!Number.isInteger(chatId)) {
    return Response.json({ ok: false, error: 'bad-chat-id' }, { status: 400 });
  }

  let application;
  try {
    application = await stores.applications.getByChatId(chatId);
  } catch (error) {
    if (error instanceof IntegrationError && error.failure === 'UNCONFIGURED') {
      return Response.json({ ok: false, error: 'storage-unconfigured' }, { status: 503 });
    }
    throw error;
  }
  if (!application) {
    return Response.json({ ok: false, error: 'not-found' }, { status: 404 });
  }
  if (application.status !== 'pending') {
    return Response.json({ ok: false, error: 'not-pending', status: application.status }, { status: 409 });
  }

  const decidedAt = new Date().toISOString();
  await stores.applications.save({ ...application, status: 'approved', updatedAt: decidedAt, decidedAt });
  await stores.subscriptions.setActive(chatId, true);

  let notified = false;
  let notifyError: string | null = null;
  try {
    const delivery = requireTelegramDeliveryConfig();
    const sender = new TelegramBotApiClient(delivery.botToken);
    await sender.sendMessage(chatId, buildApplicationApprovedMessage(application.locale, application.company));
    notified = true;
  } catch (error) {
    notifyError = error instanceof Error ? error.message : 'unknown error';
  }
  return Response.json({ ok: true, status: 'approved', notified, ...(notifyError ? { notifyError } : {}) });
}
