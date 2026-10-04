import { BellRing, Clock3, Megaphone, Send } from 'lucide-react';
import { PageHeading, StatCard } from '@/components/ui';
import { FOLLOWUP_POLICIES, buildFollowupMessage, checkEligibility, classifyChat, collectFollowupData, type ClassifiedChat } from '@/lib/telegram/followups';
import { getTelegramStores } from '@/lib/telegram/stores';
import type { FollowupStage } from '@/lib/telegram/types';

/**
 * Marketing v1: stage-based follow-ups on bot-collected data only.
 * Funnel counts + recent sends + per-stage policy, all live. Sending happens
 * only via the authenticated cron endpoint (dry-run supported).
 */

export const dynamic = 'force-dynamic';

const STAGE_LABELS: Record<FollowupStage, string> = {
  'onboarding-stalled': 'Yarim qolgan ro‘yxat',
  'pending-review': 'Kutilayotgan ariza',
  'pending-admin': 'Operator pingi',
  'approved-inactive': 'Faollashmagan hamkor',
  'dormant-buyer': 'Sovigan xaridor',
  'restart-invite': 'Qayta taklif',
  friday: 'Juma tabrigi',
};

const STAGE_ORDER: FollowupStage[] = [
  'onboarding-stalled',
  'pending-review',
  'approved-inactive',
  'dormant-buyer',
  'restart-invite',
  'friday',
];

function policyText(stage: FollowupStage): string {
  const policy = FOLLOWUP_POLICIES[stage];
  const span = (ms: number) => {
    if (ms >= Number.MAX_SAFE_INTEGER) return '—';
    if (ms <= 0) return 'yo‘q';
    const hours = Math.round(ms / 3_600_000);
    if (hours < 24) return `${hours} soat`;
    return `${Math.round(hours / 24)} kun`;
  };
  const max = policy.maxSends >= Number.MAX_SAFE_INTEGER ? '∞' : String(policy.maxSends);
  return `kechikish ${span(policy.delayMs)} · pauza ${span(policy.cooldownMs)} · max ${max}`;
}

export default async function AdminMarketingPage() {
  const now = new Date();
  let available = true;
  const classified: ClassifiedChat[] = [];
  let eligible = 0;
  let recent: Awaited<ReturnType<ReturnType<typeof getTelegramStores>['followups']['listRecent']>> = [];
  let chats = 0;
  let sentTotal = '0';
  try {
    const stores = getTelegramStores();
    const data = await collectFollowupData(stores);
    chats = data.snapshots.length;
    sentTotal = data.history.length >= 500 ? '500+' : String(data.history.length);
    recent = data.history.slice(0, 10);
    for (const snapshot of data.snapshots) {
      const item = classifyChat(snapshot, now);
      if (!item) continue;
      classified.push(item);
      if (checkEligibility(item.chatId, item.stage, data.history, now.getTime()) === 'ok') eligible += 1;
    }
  } catch {
    available = false;
  }

  const byStage = new Map<FollowupStage, number>();
  for (const item of classified) byStage.set(item.stage, (byStage.get(item.stage) ?? 0) + 1);
  const lastSent = recent[0]?.sentAt.slice(5, 16).replace('T', ' ') ?? '—';

  return <>
    <PageHeading
      eyebrow="MIJOZLAR BILAN ISHLASH"
      title="Marketing"
      description="Bosqichma-bosqich follow-up’lar: yarim qolgan ro‘yxat, kutilayotgan ariza, sovigan xaridor, juma tabrigi."
    />
    {!available && (
      <div className="admin-data-notice"><span className="demo-dot" /><span><b>Xotira ombori ulanmagan</b> · Pilot rejimda funnel ko‘rinmaydi.</span></div>
    )}
    <div className="stat-grid four admin-stats">
      <StatCard label="Jami chatlar" value={String(chats)} note="Ro‘yxat + arizalar" icon={<Megaphone size={18} />} tone="blue" />
      <StatCard label="Faol bosqichda" value={String(classified.length)} note={`Shundan hozir yuboriladi: ${eligible}`} icon={<BellRing size={18} />} tone="amber" />
      <StatCard label="Yuborilgan" value={sentTotal} note="Jami follow-up’lar" icon={<Send size={18} />} tone="mint" />
      <StatCard label="So‘nggi yuborish" value={lastSent} note="Follow-up tarixi" icon={<Clock3 size={18} />} tone="violet" />
    </div>
    <div className="admin-grid">
      <section className="surface">
        <div className="section-header"><div><div className="section-kicker">VORONKA</div><h3>Bosqichlar</h3></div></div>
        <div className="live-list">
          {STAGE_ORDER.map((stage) => (
            <div className="live-row" key={stage}>
              <span className="near-client-avatar"><Megaphone size={15} /></span>
              <span className="near-client-name"><b>{STAGE_LABELS[stage]}</b><small>{policyText(stage)}</small></span>
              <span className="live-meta">{byStage.get(stage) ?? 0} chat</span>
            </div>
          ))}
        </div>
        <div className="sample-box"><span className="sample-label">NAMUNA XABAR</span><p>{buildFollowupMessage('onboarding-stalled', 'uz', { name: 'Akmal', step: 'awaiting-address' })}</p></div>
      </section>
      <section className="surface">
        <div className="section-header"><div><div className="section-kicker">TARIX</div><h3>So‘nggi yuborishlar</h3></div></div>
        {recent.length === 0 ? (
          <p className="muted-text">Hali follow-up yuborilmadi. Scheduler ulangach shu yerda tarix chiqadi.</p>
        ) : (
          <div className="live-list">
            {recent.map((item, index) => (
              <div className="live-row" key={`${item.chatId}-${item.stage}-${index}`}>
                <span className="near-client-avatar"><Send size={15} /></span>
                <span className="near-client-name"><b>{STAGE_LABELS[item.stage]}</b><small>chat {item.chatId}{item.reference ? ` · ariza ${item.reference}` : ''}</small></span>
                <span className="live-meta">{item.sentAt.slice(0, 16).replace('T', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
    <section className="surface">
      <div className="section-header"><div><div className="section-kicker">SOZLASH</div><h3>Scheduler</h3></div></div>
      <p className="muted-text">Yuborish faqat tashqi cron orqali (`TELEGRAM_CRON_SECRET` bilan). Kunlik 09:00 Toshkent vaqti tavsiya etiladi; avval `dryRun=1` bilan tekshiring:</p>
      <p className="telegram-code-box"><code>POST https://&lt;portal-host&gt;/api/cron/telegram-followups?dryRun=1</code></p>
    </section>
  </>;
}
