/**
 * Uzbekistan phone normalization for MoySklad counterparty matching.
 *
 * MoySklad stores phones in arbitrary formats (`+998 90 123 45 67`,
 * `998901234567`, `901234567`, …), so every comparison normalizes both sides
 * to E.164 (`+998XXXXXXXXX`) and falls back to last-9-digit matching.
 */

export function digitsOnly(value: string): string {
  return value.replace(/\D/gu, '');
}

/** Normalizes Uzbek numbers to `+998XXXXXXXXX`; null when not plausible. */
export function normalizeUzPhone(input: string): string | null {
  const digits = digitsOnly(input);
  if (/^998\d{9}$/u.test(digits)) return `+${digits}`;
  if (/^\d{9}$/u.test(digits)) return `+998${digits}`;
  return null;
}

/** Last 9 digits (subscriber part) for tolerant matching; null when too short. */
export function subscriberDigits(input: string): string | null {
  const digits = digitsOnly(input);
  if (digits.length < 9) return null;
  return digits.slice(-9);
}

/** True when two phone strings plausibly denote the same Uzbek number. */
export function sameUzPhone(a: string, b: string): boolean {
  const normalizedA = normalizeUzPhone(a);
  const normalizedB = normalizeUzPhone(b);
  if (normalizedA && normalizedB) return normalizedA === normalizedB;
  const subA = subscriberDigits(a);
  const subB = subscriberDigits(b);
  return !!subA && !!subB && subA === subB;
}
