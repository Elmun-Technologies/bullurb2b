import 'server-only';

import type { FollowupStage, TelegramBotOrder, TelegramChatId, TelegramDialogState, TelegramFollowupRecord, TelegramLocale, TelegramRegistrationApplication, TelegramSubscription } from './types';
import type { TelegramStores } from './stores';
import type { TelegramSender } from './dispatcher';
import { isChatInactiveError, type TelegramClientLogger } from './client';

/**
 * Stage-based client follow-ups (marketing v1).
 *
 * Unlike the MoySklad-driven reminder dispatcher, this engine works ONLY on
 * data the bot itself collected (dialogs, applications, bot orders) — so it
 * runs today, while MoySklad live reads are still a blocker. No turnover,
 * tier or bonus numbers are ever mentioned: every message is grounded in a
 * real event the chat performed (started registration, got approved, last
 * ordered N days ago).
 *
 * Anti-spam rules: one message per chat per run, per-stage cooldowns and
 * lifetime caps, a per-run send cap, and a small delay between sends.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface FollowupPolicy {
  /** First eligible age of the triggering event. */
  delayMs: number;
  /** Minimum gap between two sends of the same stage to the same chat. */
  cooldownMs: number;
  /** Lifetime sends of the same stage to the same chat. */
  maxSends: number;
}

export const FOLLOWUP_POLICIES: Record<FollowupStage, FollowupPolicy> = {
  'onboarding-stalled': { delayMs: 24 * HOUR_MS, cooldownMs: 72 * HOUR_MS, maxSends: 3 },
  'pending-review': { delayMs: 24 * HOUR_MS, cooldownMs: 72 * HOUR_MS, maxSends: 2 },
  'pending-admin': { delayMs: 2 * HOUR_MS, cooldownMs: Number.MAX_SAFE_INTEGER, maxSends: 1 },
  'approved-inactive': { delayMs: 48 * HOUR_MS, cooldownMs: 7 * DAY_MS, maxSends: 3 },
  'dormant-buyer': { delayMs: 14 * DAY_MS, cooldownMs: 14 * DAY_MS, maxSends: 3 },
  'restart-invite': { delayMs: 10 * DAY_MS, cooldownMs: 30 * DAY_MS, maxSends: 2 },
  friday: { delayMs: 0, cooldownMs: 6 * DAY_MS, maxSends: Number.MAX_SAFE_INTEGER },
};

export interface ChatFollowupSnapshot {
  chatId: TelegramChatId;
  dialog: TelegramDialogState | null;
  application: TelegramRegistrationApplication | null;
  /** Newest first. */
  orders: TelegramBotOrder[];
  subscription: TelegramSubscription | null;
}

export interface ClassifiedChat extends ChatFollowupSnapshot {
  stage: FollowupStage;
  locale: TelegramLocale;
  /** ISO timestamp of the triggering event (for admin preview). */
  triggerAt: string;
}

function isFridayInTashkent(now: Date): boolean {
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'Asia/Tashkent' }).format(now);
  return weekday === 'Fri';
}

function localeFor(snapshot: ChatFollowupSnapshot): TelegramLocale {
  const candidate = snapshot.application?.locale ?? snapshot.subscription?.locale;
  return candidate === 'ru' ? 'ru' : 'uz';
}

/**
 * Pure stage classifier. Priority when several stages match (one message
 * per chat per run): pending-review → onboarding-stalled → restart-invite →
 * dormant-buyer → approved-inactive → friday.
 */
export function classifyChat(snapshot: ChatFollowupSnapshot, now = new Date()): ClassifiedChat | null {
  const nowMs = now.getTime();
  const locale = localeFor(snapshot);
  const application = snapshot.application;

  if (application?.status === 'pending' && nowMs - Date.parse(application.createdAt) >= FOLLOWUP_POLICIES['pending-review'].delayMs) {
    return { ...snapshot, stage: 'pending-review', locale, triggerAt: application.createdAt };
  }
  if (!application && snapshot.dialog && nowMs - Date.parse(snapshot.dialog.updatedAt) >= FOLLOWUP_POLICIES['onboarding-stalled'].delayMs) {
    return { ...snapshot, stage: 'onboarding-stalled', locale, triggerAt: snapshot.dialog.updatedAt };
  }
  if (application?.status === 'rejected') {
    const decidedAt = application.decidedAt ?? application.updatedAt;
    if (nowMs - Date.parse(decidedAt) >= FOLLOWUP_POLICIES['restart-invite'].delayMs) {
      return { ...snapshot, stage: 'restart-invite', locale, triggerAt: decidedAt };
    }
    return null;
  }
  if (application?.status === 'approved') {
    const lastOrder = snapshot.orders[0];
    if (lastOrder && nowMs - Date.parse(lastOrder.createdAt) >= FOLLOWUP_POLICIES['dormant-buyer'].delayMs) {
      return { ...snapshot, stage: 'dormant-buyer', locale, triggerAt: lastOrder.createdAt };
    }
    if (!lastOrder) {
      const approvedAt = application.decidedAt ?? application.updatedAt;
      if (nowMs - Date.parse(approvedAt) >= FOLLOWUP_POLICIES['approved-inactive'].delayMs) {
        return { ...snapshot, stage: 'approved-inactive', locale, triggerAt: approvedAt };
      }
    }
    if (isFridayInTashkent(now)) {
      return { ...snapshot, stage: 'friday', locale, triggerAt: now.toISOString() };
    }
  }
  return null;
}

const STEP_HINT: Record<TelegramDialogState['step'], { uz: string; ru: string }> = {
  'awaiting-contact': { uz: 'telefon raqamingizni yuborish', ru: 'отправить номер телефона' },
  'awaiting-name': { uz: 'ismingizni yozish', ru: 'написать имя' },
  'awaiting-company': { uz: 'do‘kon nomini yozish', ru: 'написать название магазина' },
  'awaiting-address': { uz: 'do‘kon manzilini yozish', ru: 'написать адрес магазина' },
  'awaiting-location': { uz: 'lokatsiyani yuborish (yoki o‘tkazib yuborish)', ru: 'отправить локацию (или пропустить)' },
};

export function buildFollowupMessage(stage: FollowupStage, locale: TelegramLocale, context: { name?: string; step?: TelegramDialogState['step']; company?: string }): string {
  const name = context.name?.trim();
  const greeting = name ? (locale === 'ru' ? `${name}, здравствуйте! 👋` : `${name}, assalomu alaykum! 👋`) : (locale === 'ru' ? 'Здравствуйте! 👋' : 'Assalomu alaykum! 👋');
  switch (stage) {
    case 'onboarding-stalled': {
      const hint = context.step ? STEP_HINT[context.step][locale] : null;
      return locale === 'ru'
        ? `${greeting}\n\nВы начали регистрацию в Baraka, но не закончили${hint ? ` — остался шаг: ${hint}` : ''}. Продолжим? Отправьте /start.`
        : `${greeting}\n\nBaraka’da ro‘yxatdan o‘tishni boshlagansiz, lekin yakunlamagansiz${hint ? ` — navbatdagi qadam: ${hint}` : ''}. Davom ettiramizmi? /start ni yuboring.`;
    }
    case 'pending-review':
      return locale === 'ru'
        ? `${greeting}\n\nВаша заявка на рассмотрении — обычно мы отвечаем в течение рабочего дня. Спасибо за ожидание! 🙏`
        : `${greeting}\n\nArizangiz ko‘rib chiqilmoqda — odatda ish kuni ichida javob beramiz. Kutganingiz uchun rahmat! 🙏`;
    case 'pending-admin':
      return `🔔 Yangi ko‘rib chiqilmagan ariza: ${context.company ?? '—'} (${name ?? '—'}). /admin/telegram`;
    case 'approved-inactive':
      return locale === 'ru'
        ? `${greeting}\n\nВаша заявка одобрена — добро пожаловать в Baraka! 🎉 Загляните в каталог: /katalog`
        : `${greeting}\n\nArizangiz tasdiqlangan — Baraka’ga xush kelibsiz! 🎉 Katalogni ko‘ring: /katalog`;
    case 'dormant-buyer':
      return locale === 'ru'
        ? `${greeting}\n\nДавно не виделись! 👀 Загляните в каталог — возможно, появилось что-то нужное: /katalog`
        : `${greeting}\n\nAncha bo‘ldi ko‘rishmaganimizga! 👀 Katalogga bir ko‘z tashlang — kerakli narsa chiqqan bo‘lishi mumkin: /katalog`;
    case 'restart-invite':
      return locale === 'ru'
        ? `${greeting}\n\nНапоминаем: вы можете пройти регистрацию заново — отправьте /start, это займёт пару минут.`
        : `${greeting}\n\nEslatib o‘tamiz: qayta ro‘yxatdan o‘tishingiz mumkin — /start ni yuboring, bor-yo‘g‘i 2 daqiqa.`;
    case 'friday':
      return locale === 'ru'
        ? `${greeting}\n\nС пятницей! 🕌 Пусть сделки будут удачными, а полки — полными. Baraka — всегда рядом.`
        : `${greeting}\n\nJuma muborak! 🕌 Savdolaringiz barakali, rastalaringiz to‘la bo‘lsin. Baraka — doim yoningizda.`;
  }
}

export interface FollowupDispatchSummary {
  chats: number;
  classified: number;
  attempted: number;
  sent: number;
  skippedCooldown: number;
  skippedMax: number;
  skippedCap: number;
  failed: number;
  adminPings: number;
  dryRun: boolean;
  stages: Partial<Record<FollowupStage, number>>;
}

export interface FollowupPreview {
  chatId: TelegramChatId;
  stage: FollowupStage;
  locale: TelegramLocale;
  text: string;
}

export interface FollowupDispatchInput {
  now?: Date;
  stores: TelegramStores;
  sender: TelegramSender;
  logger?: TelegramClientLogger;
  dryRun?: boolean;
  /** Max live sends per run (default 25). Previews are uncapped. */
  maxSends?: number;
  delayBetweenSendsMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Numeric admin chat id for pending-application pings (null = skip). */
  adminChatId?: string | null;
}

const noopLogger: TelegramClientLogger = { info() {}, warn() {}, error() {} };
const defaultSleep = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export interface FollowupDataset {
  snapshots: ChatFollowupSnapshot[];
  pendingApps: TelegramRegistrationApplication[];
  history: TelegramFollowupRecord[];
}

/** Shared snapshot collector for the dispatcher and the admin preview. */
export async function collectFollowupData(stores: TelegramStores): Promise<FollowupDataset> {
  const [dialogs, pendingApps, approvedApps, rejectedApps, orders, history] = await Promise.all([
    stores.dialogs.listActive(),
    stores.applications.listByStatus('pending'),
    stores.applications.listByStatus('approved'),
    stores.applications.listByStatus('rejected'),
    stores.botOrders.listRecent(200),
    stores.followups.listRecent(500),
  ]);
  const applicationByChat = new Map([...pendingApps, ...approvedApps, ...rejectedApps].map((item) => [item.chatId, item]));
  const dialogByChat = new Map(dialogs.map((item) => [item.chatId, item]));
  const ordersByChat = new Map<TelegramChatId, TelegramBotOrder[]>();
  for (const order of orders) {
    const list = ordersByChat.get(order.chatId) ?? [];
    list.push(order);
    ordersByChat.set(order.chatId, list);
  }
  const chatIds = new Set<TelegramChatId>([...dialogByChat.keys(), ...applicationByChat.keys()]);
  const snapshots: ChatFollowupSnapshot[] = [];
  for (const chatId of chatIds) {
    snapshots.push({
      chatId,
      dialog: dialogByChat.get(chatId) ?? null,
      application: applicationByChat.get(chatId) ?? null,
      orders: ordersByChat.get(chatId) ?? [],
      subscription: await stores.subscriptions.getByChatId(chatId).catch(() => null),
    });
  }
  return { snapshots, pendingApps, history };
}

function historyFor(history: TelegramFollowupRecord[], chatId: TelegramChatId, stage: FollowupStage): TelegramFollowupRecord[] {
  return history.filter((item) => item.chatId === chatId && item.stage === stage);
}

export type Eligibility = 'ok' | 'cooldown' | 'max';

/** Shared anti-spam gate for the dispatcher and the admin preview. */
export function checkEligibility(chatId: TelegramChatId, stage: FollowupStage, history: TelegramFollowupRecord[], nowMs: number): Eligibility {
  const prior = historyFor(history, chatId, stage);
  const policy = FOLLOWUP_POLICIES[stage];
  if (prior.length >= policy.maxSends) return 'max';
  const lastSentAt = prior.length > 0 ? Date.parse(prior[0].sentAt) : null;
  if (lastSentAt !== null && nowMs - lastSentAt < policy.cooldownMs) return 'cooldown';
  return 'ok';
}

export async function dispatchFollowups(input: FollowupDispatchInput): Promise<{ summary: FollowupDispatchSummary; previews: FollowupPreview[] }> {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const logger = input.logger ?? noopLogger;
  const sleep = input.sleep ?? defaultSleep;
  const delayBetweenSendsMs = input.delayBetweenSendsMs ?? 120;
  const maxSends = Math.max(1, input.maxSends ?? 25);
  const dryRun = input.dryRun === true;

  const summary: FollowupDispatchSummary = {
    chats: 0, classified: 0, attempted: 0, sent: 0,
    skippedCooldown: 0, skippedMax: 0, skippedCap: 0, failed: 0,
    adminPings: 0, dryRun, stages: {},
  };
  const previews: FollowupPreview[] = [];

  const { snapshots, pendingApps, history } = await collectFollowupData(input.stores);
  summary.chats = snapshots.length;

  const bumpStage = (stage: FollowupStage) => {
    summary.stages[stage] = (summary.stages[stage] ?? 0) + 1;
  };

  for (const snapshot of snapshots) {
    const { chatId, subscription } = snapshot;
    const classified = classifyChat(snapshot, now);
    if (!classified) continue;
    summary.classified += 1;
    bumpStage(classified.stage);

    const eligibility = checkEligibility(chatId, classified.stage, history, nowMs);
    if (eligibility !== 'ok') {
      summary[eligibility === 'max' ? 'skippedMax' : 'skippedCooldown'] += 1;
      continue;
    }

    const text = buildFollowupMessage(classified.stage, classified.locale, {
      name: classified.application?.name ?? classified.dialog?.name,
      step: classified.dialog?.step,
      company: classified.application?.company,
    });

    if (dryRun) {
      previews.push({ chatId, stage: classified.stage, locale: classified.locale, text });
      continue;
    }
    if (summary.attempted >= maxSends) {
      summary.skippedCap += 1;
      continue;
    }
    summary.attempted += 1;
    if (delayBetweenSendsMs > 0 && summary.attempted > 1) await sleep(delayBetweenSendsMs);
    try {
      await input.sender.sendMessage(chatId, text);
      await input.stores.followups.record({ chatId, stage: classified.stage, sentAt: now.toISOString() });
      history.unshift({ chatId, stage: classified.stage, sentAt: now.toISOString() });
      summary.sent += 1;
    } catch (error) {
      summary.failed += 1;
      if (isChatInactiveError(error) && subscription) {
        await input.stores.subscriptions.setActive(chatId, false).catch(() => undefined);
        logger.info(`followups deactivated unreachable chat ${chatId}`);
      } else {
        logger.error(`followups failed for chat ${chatId} stage ${classified.stage}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }

  // Operator ping: each stale pending application notifies the admin chat once.
  const adminChatId = input.adminChatId ? Number(input.adminChatId) : NaN;
  if (input.adminChatId && Number.isInteger(adminChatId)) {
    const adminPolicy = FOLLOWUP_POLICIES['pending-admin'];
    for (const application of pendingApps) {
      if (nowMs - Date.parse(application.createdAt) < adminPolicy.delayMs) continue;
      const alreadyPinged = history.some(
        (item) => item.stage === 'pending-admin' && item.reference === String(application.chatId),
      );
      if (alreadyPinged) continue;
      bumpStage('pending-admin');
      const text = buildFollowupMessage('pending-admin', 'uz', { name: application.name, company: application.company });
      if (dryRun) {
        previews.push({ chatId: adminChatId, stage: 'pending-admin', locale: 'uz', text });
        continue;
      }
      summary.attempted += 1;
      if (delayBetweenSendsMs > 0 && summary.attempted > 1) await sleep(delayBetweenSendsMs);
      try {
        await input.sender.sendMessage(adminChatId, text);
        const record = { chatId: adminChatId, stage: 'pending-admin' as const, sentAt: now.toISOString(), reference: String(application.chatId) };
        await input.stores.followups.record(record);
        history.unshift(record);
        summary.sent += 1;
        summary.adminPings += 1;
      } catch (error) {
        summary.failed += 1;
        logger.error(`followups admin ping failed for application ${application.chatId}: ${error instanceof Error ? error.message : 'unknown error'}`);
      }
    }
  }

  logger.info(`followups done: ${summary.sent} sent, ${summary.skippedCooldown} cooldown, ${summary.skippedMax} capped, ${summary.failed} failed (${summary.chats} chats, dryRun=${dryRun})`);
  return { summary, previews };
}
