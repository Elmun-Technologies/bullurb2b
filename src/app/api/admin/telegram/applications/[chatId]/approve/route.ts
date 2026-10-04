import { IntegrationError } from '@/lib/providers/errors';
import { decideApplication } from '@/lib/telegram/admin';
import { TelegramBotApiClient } from '@/lib/telegram/client';
import { requireTelegramAdminSecret, requireTelegramDeliveryConfig } from '@/lib/telegram/config';
import type { TelegramSender } from '@/lib/telegram/dispatcher';
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

  // The decision applies even when bot delivery is unconfigured; the caller
  // learns about the missed notification via notified:false.
  let sender: TelegramBotApiClient | TelegramSender;
  try {
    sender = new TelegramBotApiClient(requireTelegramDeliveryConfig().botToken);
  } catch {
    sender = {
      async sendMessage() { throw new Error('notify-unconfigured'); },
      async answerCallbackQuery() { return true as const; },
      async editMessageText() { return true as const; },
    };
  }
  let result;
  try {
    result = await decideApplication(stores, sender, chatId, 'approved', undefined, new Date());
  } catch (error) {
    if (error instanceof IntegrationError && error.failure === 'UNCONFIGURED') {
      return Response.json({ ok: false, error: 'storage-unconfigured' }, { status: 503 });
    }
    throw error;
  }
  if (!result.ok) {
    if (result.error === 'not-found') return Response.json({ ok: false, error: 'not-found' }, { status: 404 });
    return Response.json({ ok: false, error: 'not-pending', status: result.status }, { status: 409 });
  }
  return Response.json({ ok: true, status: 'approved', notified: result.notified, ...(result.notifyError ? { notifyError: result.notifyError } : {}) });
}
