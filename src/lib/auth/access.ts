import 'server-only';
import type { VerifiedPrincipal } from './policy';
export { AccessDeniedError, authorizeCustomerAccess } from './policy';

/** Fail-closed until the real Shopflow session verifier and company mapping are configured. */
export async function getVerifiedPrincipal(): Promise<VerifiedPrincipal> {
  throw new Error('Shopflow authentication is not configured; demo identity is not a production session.');
}
