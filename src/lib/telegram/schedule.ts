/**
 * Timezone-aware scheduling helpers for reminders.
 *
 * The Friday greeting and daily idempotency keys must follow the loyalty
 * program's configured timezone (default Asia/Tashkent), not the server clock.
 */

export function isFridayInTimezone(now: Date, timezone: string): boolean {
  return new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(now) === 'Fri';
}

export function dateKeyInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '0000';
  const month = parts.find((part) => part.type === 'month')?.value ?? '00';
  const day = parts.find((part) => part.type === 'day')?.value ?? '00';
  return `${year}-${month}-${day}`;
}

/**
 * ISO calendar-week key (`2026-W40`) in the given timezone. Persistent
 * conditions (near-tier gap, manager opportunities) re-notify at most once
 * per week instead of spamming the chat on every scheduler run.
 */
export function weekKeyInTimezone(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === 'year')?.value ?? '1970');
  const month = Number(parts.find((part) => part.type === 'month')?.value ?? '01');
  const day = Number(parts.find((part) => part.type === 'day')?.value ?? '01');
  const current = new Date(Date.UTC(year, month - 1, day));
  const weekday = (current.getUTCDay() + 6) % 7;
  current.setUTCDate(current.getUTCDate() - weekday + 3);
  const firstThursday = new Date(Date.UTC(current.getUTCFullYear(), 0, 4));
  const firstWeekday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstWeekday + 3);
  const week = 1 + Math.round((current.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
  return `${current.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
