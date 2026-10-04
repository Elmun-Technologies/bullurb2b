import type { MoySkladCounterparty, MoySkladErrorEnvelope, MoySkladList } from './types';

/**
 * Defensive runtime guards for the MoySklad boundary. Only documented fields
 * are accepted; unknown shapes fail loudly instead of poisoning identity or
 * loyalty logic.
 */

export class MoySkladValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoySkladValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asOptionalString(value: unknown): string | undefined {
  const normalized = asNonEmptyString(value);
  return normalized ?? undefined;
}

export function assertCounterparty(value: unknown): MoySkladCounterparty {
  if (!isRecord(value)) throw new MoySkladValidationError('MoySklad counterparty has an unexpected shape.');
  const id = asNonEmptyString(value.id);
  const name = asNonEmptyString(value.name);
  if (!id || !name) throw new MoySkladValidationError('MoySklad counterparty is missing id or name.');
  return {
    id,
    name,
    phone: asOptionalString(value.phone),
    email: asOptionalString(value.email),
    description: asOptionalString(value.description),
    code: asOptionalString(value.code),
  };
}

export function assertCounterpartyList(value: unknown): MoySkladList<MoySkladCounterparty> {
  if (!isRecord(value) || !Array.isArray(value.rows) || !isRecord(value.meta)) {
    throw new MoySkladValidationError('MoySklad list response has an unexpected shape.');
  }
  const meta = value.meta;
  if (typeof meta.size !== 'number' || typeof meta.limit !== 'number' || typeof meta.offset !== 'number') {
    throw new MoySkladValidationError('MoySklad list metadata has an unexpected shape.');
  }
  return {
    meta: {
      href: typeof meta.href === 'string' ? meta.href : '',
      type: typeof meta.type === 'string' ? meta.type : '',
      mediaType: typeof meta.mediaType === 'string' ? meta.mediaType : '',
      size: meta.size,
      limit: meta.limit,
      offset: meta.offset,
    },
    rows: value.rows.map(assertCounterparty),
  };
}

/** Extracts a safe one-line message from the documented `{errors:[...]}` envelope. */
export function errorEnvelopeMessage(payload: unknown, fallback: string): string {
  if (isRecord(payload) && Array.isArray(payload.errors) && payload.errors.length > 0) {
    const first = payload.errors[0] as Partial<MoySkladErrorEnvelope['errors'][number]>;
    const parts = [typeof first.error === 'string' ? first.error : '', typeof first.error_message === 'string' ? first.error_message : '']
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length > 0) return parts.join(': ').slice(0, 300);
  }
  return fallback;
}
