import { afterEach, describe, expect, it, vi } from 'vitest';

import { GET as followupsGET } from '@/app/api/cron/telegram-followups/route';
import type { TelegramSender } from './dispatcher';
import {
  FOLLOWUP_POLICIES,
  buildFollowupMessage,
  checkEligibility,
  classifyChat,
  collectFollowupData,
  dispatchFollowups,
  type ChatFollowupSnapshot,
} from './followups';
import { createMemoryTelegramStores, getTelegramStores, resetMemoryTelegramStores } from './stores';
import type { TelegramDialogState, TelegramRegistrationApplication } from './types';
import { TEST_SECRETS, stubFullTelegramEnv } from './test-helpers';

// A Monday noon (Tashkent) — never Friday, so friday never fires accidentally.
const MONDAY = new Date('2026-10-05T12:00:00+05:00');
const FRIDAY = new Date('2026-10-09T12:00:00+05:00');

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  resetMemoryTelegramStores();
});

function hoursAgo(hours: number, from: Date = MONDAY): string {
  return new Date(from.getTime() - hours * 3_600_000).toISOString();
}

function dialog(overrides: Partial<TelegramDialogState> = {}): TelegramDialogState {
  return { chatId: 1, step: 'awaiting-name', name: 'Akmal', updatedAt: hoursAgo(30), ...overrides };
}

function application(overrides: Partial<TelegramRegistrationApplication> = {}): TelegramRegistrationApplication {
  const createdAt = hoursAgo(30);
  return {
    chatId: 1, phone: '+998901234567', name: 'Akmal', company: 'BARAKA', address: 'Toshkent',
    status: 'pending', locale: 'uz', createdAt, updatedAt: createdAt, ...overrides,
  };
}

function snapshot(overrides: Partial<ChatFollowupSnapshot> = {}): ChatFollowupSnapshot {
  return { chatId: 1, dialog: null, application: null, orders: [], subscription: null, ...overrides };
}

function makeSender(): { sender: TelegramSender; sent: Array<{ chatId: number; text: string }> } {
  const sent: Array<{ chatId: number; text: string }> = [];
  const sender: TelegramSender = {
    async sendMessage(chatId, text) {
      sent.push({ chatId: chatId as number, text });
      return { messageId: sent.length };
    },
    async answerCallbackQuery() { return true as const; },
    async editMessageText() { return true as const; },
  };
  return { sender, sent };
}

describe('followup classifier', () => {
  it('detects stalled onboarding after 24h without an application', () => {
    expect(classifyChat(snapshot({ dialog: dialog() }), MONDAY)?.stage).toBe('onboarding-stalled');
    expect(classifyChat(snapshot({ dialog: dialog({ updatedAt: hoursAgo(2) }) }), MONDAY)).toBeNull();
    expect(classifyChat(snapshot({ dialog: dialog(), application: application({ status: 'pending', createdAt: hoursAgo(2) }) }), MONDAY)).toBeNull();
  });

  it('detects stale pending applications and prefers them over dialogs', () => {
    const app = application({ status: 'pending', createdAt: hoursAgo(30) });
    expect(classifyChat(snapshot({ application: app }), MONDAY)?.stage).toBe('pending-review');
    expect(classifyChat(snapshot({ application: app, dialog: dialog() }), MONDAY)?.stage).toBe('pending-review');
    expect(classifyChat(snapshot({ application: application({ status: 'pending', createdAt: hoursAgo(2) }) }), MONDAY)).toBeNull();
  });

  it('detects approved-but-inactive chats after 48h', () => {
    const approvedAt = hoursAgo(50);
    const app = application({ status: 'approved', decidedAt: approvedAt, updatedAt: approvedAt });
    expect(classifyChat(snapshot({ application: app }), MONDAY)?.stage).toBe('approved-inactive');
    const freshAt = hoursAgo(5);
    expect(classifyChat(snapshot({ application: application({ status: 'approved', decidedAt: freshAt, updatedAt: freshAt }) }), MONDAY)).toBeNull();
  });

  it('detects dormant buyers 14 days after their last order', () => {
    const approvedAt = hoursAgo(500);
    const app = application({ status: 'approved', decidedAt: approvedAt, updatedAt: approvedAt });
    const order = { orderId: 'o1', orderMessage: 'm', chatId: 1, company: 'BARAKA', name: 'A', phone: '+998', productName: 'P', quantity: 1, method: 'courier' as const, createdAt: hoursAgo(400) };
    expect(classifyChat(snapshot({ application: app, orders: [order] }), MONDAY)?.stage).toBe('dormant-buyer');
    expect(classifyChat(snapshot({ application: app, orders: [{ ...order, createdAt: hoursAgo(24) }] }), MONDAY)).toBeNull();
  });

  it('invites rejected chats to restart after 10 days', () => {
    const decidedAt = hoursAgo(300);
    expect(classifyChat(snapshot({ application: application({ status: 'rejected', decidedAt, updatedAt: decidedAt }) }), MONDAY)?.stage).toBe('restart-invite');
    const freshAt = hoursAgo(24);
    expect(classifyChat(snapshot({ application: application({ status: 'rejected', decidedAt: freshAt, updatedAt: freshAt }) }), MONDAY)).toBeNull();
  });

  it('greets approved chats on Fridays only', () => {
    const approvedAt = hoursAgo(5, FRIDAY);
    const app = application({ status: 'approved', decidedAt: approvedAt, updatedAt: approvedAt });
    expect(classifyChat(snapshot({ application: app }), MONDAY)).toBeNull();
    expect(classifyChat(snapshot({ application: app }), FRIDAY)?.stage).toBe('friday');
    const staleAt = hoursAgo(500);
    const staleApp = application({ status: 'approved', decidedAt: staleAt, updatedAt: staleAt });
    expect(classifyChat(snapshot({ application: staleApp }), FRIDAY)?.stage).toBe('approved-inactive');
  });

  it('picks the application locale, defaulting to uz', () => {
    const app = application({ status: 'pending', createdAt: hoursAgo(30), locale: 'ru' });
    expect(classifyChat(snapshot({ application: app }), MONDAY)?.locale).toBe('ru');
    expect(classifyChat(snapshot({ dialog: dialog() }), MONDAY)?.locale).toBe('uz');
  });
});

describe('followup messages', () => {
  it('name the next step and never invent numbers', () => {
    const text = buildFollowupMessage('onboarding-stalled', 'uz', { name: 'Akmal', step: 'awaiting-address' });
    expect(text).toContain('Akmal');
    expect(text).toContain('manzil');
    expect(text).toContain('/start');
    expect(text).not.toMatch(/\d+\s*(so‘m|UZS|ball|%)/);
    expect(buildFollowupMessage('approved-inactive', 'ru', {})).toContain('/katalog');
    expect(buildFollowupMessage('friday', 'uz', { name: 'Oybek' })).toContain('Juma muborak');
  });
});

describe('followup eligibility', () => {
  it('enforces cooldowns and lifetime caps', () => {
    const policy = FOLLOWUP_POLICIES['onboarding-stalled'];
    expect(checkEligibility(1, 'onboarding-stalled', [], MONDAY.getTime())).toBe('ok');
    const recent = [{ chatId: 1, stage: 'onboarding-stalled' as const, sentAt: hoursAgo(1) }];
    expect(checkEligibility(1, 'onboarding-stalled', recent, MONDAY.getTime())).toBe('cooldown');
    const old = [{ chatId: 1, stage: 'onboarding-stalled' as const, sentAt: hoursAgo(policy.cooldownMs / 3_600_000 + 1) }];
    expect(checkEligibility(1, 'onboarding-stalled', old, MONDAY.getTime())).toBe('ok');
    const capped = Array.from({ length: policy.maxSends }, (_, index) => ({ chatId: 1, stage: 'onboarding-stalled' as const, sentAt: hoursAgo(100 + index) }));
    expect(checkEligibility(1, 'onboarding-stalled', capped, MONDAY.getTime())).toBe('max');
    expect(checkEligibility(2, 'onboarding-stalled', capped, MONDAY.getTime())).toBe('ok');
  });
});

describe('followup dispatch', () => {
  async function seedStalled(chatId = 1) {
    const stores = createMemoryTelegramStores();
    await stores.dialogs.save(dialog({ chatId, updatedAt: hoursAgo(30) }));
    return stores;
  }

  it('sends once per stage window and skips on the second run', async () => {
    const stores = await seedStalled();
    const first = makeSender();
    const one = await dispatchFollowups({ now: MONDAY, stores, sender: first.sender, sleep: async () => undefined });
    expect(one.summary.sent).toBe(1);
    expect(first.sent[0].text).toContain('/start');

    const second = makeSender();
    const two = await dispatchFollowups({ now: MONDAY, stores, sender: second.sender, sleep: async () => undefined });
    expect(two.summary.sent).toBe(0);
    expect(two.summary.skippedCooldown).toBe(1);
    expect(second.sent).toHaveLength(0);
  });

  it('dry-runs without sending or recording', async () => {
    const stores = await seedStalled();
    const { sender, sent } = makeSender();
    const result = await dispatchFollowups({ now: MONDAY, stores, sender, dryRun: true });
    expect(result.summary.dryRun).toBe(true);
    expect(result.summary.sent).toBe(0);
    expect(result.previews).toHaveLength(1);
    expect(result.previews[0]).toMatchObject({ chatId: 1, stage: 'onboarding-stalled' });
    expect(sent).toHaveLength(0);
    expect(await stores.followups.listRecent(10)).toHaveLength(0);
  });

  it('caps live sends per run', async () => {
    const stores = createMemoryTelegramStores();
    for (const chatId of [1, 2, 3]) await stores.dialogs.save(dialog({ chatId, updatedAt: hoursAgo(30) }));
    const { sender } = makeSender();
    const result = await dispatchFollowups({ now: MONDAY, stores, sender, maxSends: 2, sleep: async () => undefined });
    expect(result.summary.sent).toBe(2);
    expect(result.summary.skippedCap).toBe(1);
  });

  it('pings the admin chat once per stale application', async () => {
    const stores = createMemoryTelegramStores();
    await stores.applications.save(application({ chatId: 7, status: 'pending', createdAt: hoursAgo(5) }));
    const { sender, sent } = makeSender();
    const one = await dispatchFollowups({ now: MONDAY, stores, sender, adminChatId: '999', sleep: async () => undefined });
    expect(one.summary.adminPings).toBe(1);
    expect(sent.find((item) => item.chatId === 999)?.text).toContain('BARAKA');

    const again = makeSender();
    const two = await dispatchFollowups({ now: MONDAY, stores, sender: again.sender, adminChatId: '999', sleep: async () => undefined });
    expect(two.summary.adminPings).toBe(0);

    const none = await dispatchFollowups({ now: MONDAY, stores: createMemoryTelegramStores(), sender: again.sender });
    expect(none.summary.adminPings).toBe(0);
  });

  it('collects snapshots for the admin preview', async () => {
    const stores = await seedStalled();
    const data = await collectFollowupData(stores);
    expect(data.snapshots).toHaveLength(1);
    expect(data.snapshots[0].dialog?.step).toBe('awaiting-name');
  });
});

describe('followups cron route', () => {
  function stubEnv() {
    stubFullTelegramEnv();
    vi.stubEnv('TELEGRAM_STORE_MODE', 'memory');
  }

  it('rejects missing or invalid scheduler auth', async () => {
    stubEnv();
    const url = 'https://portal.test/api/cron/telegram-followups?dryRun=1';
    expect((await followupsGET(new Request(url))).status).toBe(401);
    expect((await followupsGET(new Request(url, { headers: { authorization: 'Bearer wrong' } }))).status).toBe(401);
  });

  it('fails closed without scheduler or telegram configuration', async () => {
    const authed = new Request('https://portal.test/api/cron/telegram-followups?dryRun=1', {
      headers: { authorization: `Bearer ${TEST_SECRETS.cronSecret}` },
    });
    expect((await followupsGET(authed)).status).toBe(503);
  });

  it('dry-runs end to end with memory stores', async () => {
    stubEnv();
    const stores = getTelegramStores();
    await stores.dialogs.save(dialog({ chatId: 11, updatedAt: new Date(Date.now() - 30 * 3_600_000).toISOString() }));
    const response = await followupsGET(
      new Request('https://portal.test/api/cron/telegram-followups?dryRun=1', {
        headers: { authorization: `Bearer ${TEST_SECRETS.cronSecret}` },
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; summary: { chats: number; dryRun: boolean }; previews: Array<{ chatId: number }> };
    expect(body.ok).toBe(true);
    expect(body.summary.chats).toBe(1);
    expect(body.previews).toHaveLength(1);
    expect(await stores.followups.listRecent(10)).toHaveLength(0);
  });
});
