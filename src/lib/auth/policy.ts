import type { Role } from '@/lib/domain/types';

export interface VerifiedPrincipal {
  subjectId: string;
  role: Role;
  moySkladCustomerId?: string;
  assignedCustomerIds?: string[];
}

export class AccessDeniedError extends Error {
  constructor(message = 'Ushbu ma’lumotni ko‘rishga ruxsat yo‘q.') { super(message); this.name = 'AccessDeniedError'; }
}

/** Authorization uses only verified identity claims, never a customer id supplied by the browser. */
export function authorizeCustomerAccess(principal: VerifiedPrincipal, customerId: string): void {
  if (principal.role === 'ADMIN') return;
  if (principal.role === 'CLIENT' && principal.moySkladCustomerId === customerId) return;
  if (principal.role === 'SALES_MANAGER' && principal.assignedCustomerIds?.includes(customerId)) return;
  throw new AccessDeniedError();
}
