import 'server-only';

import {
  buildApplicationApprovedMessage,
  buildApplicationRejectedMessage,
} from './messages';
import { buildMainMenuKeyboard } from './menu';
import type { TelegramSender } from './dispatcher';
import type { TelegramStores } from './stores';
import type { TelegramChatId, TelegramRegistrationApplication } from './types';

/**
 * Shared approve/reject logic for the admin web panel AND the in-bot inline
 * buttons. Applies the decision, updates the binding, and notifies the chat.
 * Notification failures never roll back the decision — they are reported via
 * the `notified` flag so the caller can respond honestly.
 */

export type AdminDecision = 'approved' | 'rejected';

export type DecideApplicationResult =
  | { ok: true; application: TelegramRegistrationApplication; notified: boolean; notifyError: string | null }
  | { ok: false; error: 'not-found' }
  | { ok: false; error: 'not-pending'; status: string };

export async function decideApplication(
  stores: TelegramStores,
  sender: TelegramSender,
  chatId: TelegramChatId,
  decision: AdminDecision,
  reason: string | undefined,
  now: Date,
  options: { storefrontUrl?: string | null } = {},
): Promise<DecideApplicationResult> {
  const application = await stores.applications.getByChatId(chatId);
  if (!application) return { ok: false, error: 'not-found' };
  if (application.status !== 'pending') return { ok: false, error: 'not-pending', status: application.status };

  const decidedAt = now.toISOString();
  const updated: TelegramRegistrationApplication = {
    ...application,
    status: decision,
    updatedAt: decidedAt,
    decidedAt,
    ...(decision === 'rejected' && reason ? { reason } : {}),
  };
  await stores.applications.save(updated);
  await stores.subscriptions.setActive(chatId, decision === 'approved');
  if (decision === 'rejected') {
    try {
      await stores.dialogs.clear(chatId);
    } catch {
      // Best effort only.
    }
  }

  let notified = false;
  let notifyError: string | null = null;
  try {
    if (decision === 'approved') {
      await sender.sendMessage(chatId, buildApplicationApprovedMessage(application.locale, application.company), {
        replyMarkup: buildMainMenuKeyboard(application.locale, options.storefrontUrl ?? null),
      });
    } else {
      await sender.sendMessage(chatId, buildApplicationRejectedMessage(application.locale, reason || undefined));
    }
    notified = true;
  } catch (error) {
    notifyError = error instanceof Error ? error.message : 'unknown error';
  }
  return { ok: true, application: updated, notified, notifyError };
}
