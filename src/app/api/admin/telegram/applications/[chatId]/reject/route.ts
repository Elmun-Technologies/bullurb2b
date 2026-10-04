import { checkAdminSession } from '@/lib/admin-auth/session';
import { IntegrationError } from '@/lib/providers/errors';
import { decideApplication } from '@/lib/telegram/admin';
import { TelegramBotApiClient } from '@/lib/telegram/client';
import { requireTelegramDeliveryConfig } from '@/lib/telegram/config';
import type { TelegramSender } from '@/lib/telegram/dispatcher';
import { getTelegramStores } from '@/lib/telegram/stores';

/**
 * Rejects a pending registration application, deactivates the pilot binding
 * and notifies the chat. The user can restart registration with /start.
 */
export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ chatId: string }> }): Promise<Response> {
  const session = await checkAdminSession(request);
  if (session !== 'ok') {
    return Response.json({ ok: false, error: session === 'unconfigured' ? 'admin-unconfigured' : 'unauthorized' }, { status: session === 'unconfigured' ? 503 : 401 });
  }
  const stores = getTelegramStores();

  const chatId = Number((await context.params).chatId);
  if (!Number.isInteger(chatId)) {
    return Response.json({ ok: false, error: 'bad-chat-id' }, { status: 400 });
  }

  const body: unknown = await request.json().catch(() => ({}));
  const reason = extractReason(body);
  if (reason === null) {
    return Response.json({ ok: false, error: 'bad-reason', message: 'reason must be a string up to 300 characters' }, { status: 400 });
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
    result = await decideApplication(stores, sender, chatId, 'rejected', reason || undefined, new Date());
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
  return Response.json({ ok: true, status: 'rejected', notified: result.notified, ...(result.notifyError ? { notifyError: result.notifyError } : {}) });
}

function extractReason(body: unknown): string | '' | null {
  if (typeof body !== 'object' || body === null) return '';
  const reason = (body as Record<string, unknown>).reason;
  if (reason === undefined) return '';
  if (typeof reason !== 'string' || reason.length > 300) return null;
  return reason.trim().slice(0, 300);
}
