/**
 * Verified MoySklad JSON API 1.2 contract subset (counterparties only).
 *
 * Source: official docs at https://dev.moysklad.ru/doc/api/remap/1.2/
 * (authentication, gzip requirement, list/search/filter, error envelope).
 * Only documented fields are modeled; everything else stays a blocker.
 */

export interface MoySkladMeta {
  href: string;
  type: string;
  mediaType: string;
}

export interface MoySkladCounterparty {
  id: string;
  meta?: MoySkladMeta;
  name: string;
  phone?: string;
  email?: string;
  description?: string;
  code?: string;
}

export interface MoySkladList<T> {
  meta: { href: string; type: string; mediaType: string; size: number; limit: number; offset: number };
  rows: T[];
}

export interface MoySkladApiViolation {
  error: string;
  parameter?: string;
  code?: number;
  error_message?: string;
}

export interface MoySkladErrorEnvelope {
  errors: MoySkladApiViolation[];
}

export interface MoySkladCounterpartyCreate {
  name: string;
  phone: string;
  description?: string;
}
