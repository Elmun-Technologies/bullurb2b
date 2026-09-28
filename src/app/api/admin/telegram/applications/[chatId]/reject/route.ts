import { IntegrationError } from '@/lib/providers/errors';
import { TelegramBotApiClient } from '@/lib/telegram/client';
import { requireTelegramAdminSecret, requireTelegramDeliveryConfig } from '@/lib/telegram/config';
import { buildApplicationRejectedMessage } from '@/lib/telegram/messages';
import { getTelegramStores } from '@/lib/telegram/stores';
import { extractBearerToken, verifyBearerSecret } from '@/lib/telegram/webhook';

/**
 * Rejects a pending registration application, deactivates the pilot binding
 * and notifies the chat. The user can restart registration with /start.
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

  const body: unknown = await request.json().catch(() => ({}));
  const reason = extractReason(body);
  if (reason === null) {
    return Response.json({ ok: false, error: 'bad-reason', message: 'reason must be a string up to 300 characters' }, { status: 400 });
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
  await stores.applications.save({ ...application, status: 'rejected', updatedAt: decidedAt, decidedAt, ...(reason ? { reason } : {}) });
  await stores.subscriptions.setActive(chatId, false);
  try {
    await stores.dialogs.clear(chatId);
  } catch {
    // Best effort only.
  }

  let notified = false;
  let notifyError: string | null = null;
  try {
    const delivery = requireTelegramDeliveryConfig();
    const sender = new TelegramBotApiClient(delivery.botToken);
    await sender.sendMessage(chatId, buildApplicationRejectedMessage(application.locale, reason || undefined));
    notified = true;
  } catch (error) {
    notifyError = error instanceof Error ? error.message : 'unknown error';
  }
  return Response.json({ ok: true, status: 'rejected', notified, ...(notifyError ? { notifyError } : {}) });
}

function extractReason(body: unknown): string | '' | null {
  if (typeof body !== 'object' || body === null) return '';
  const reason = (body as Record<string, unknown>).reason;
  if (reason === undefined) return '';
  if (typeof reason !== 'string' || reason.length > 300) return null;
  return reason.trim().slice(0, 300);
}
