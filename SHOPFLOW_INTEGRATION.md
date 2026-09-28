# Shopflow integration boundary

## Discovery

No Shopflow SDK, API client, environment configuration, login flow, session cookies, callback routes or Shopflow documentation are present in this checkout. No undocumented API has been assumed and no alternate backend/database/authentication system has been added.

## Intended responsibilities

Shopflow should provide, subject to the actual product contract available to the business:

- Authentication and verified role/session claims (`ADMIN`, `SALES_MANAGER`, `CLIENT`).
- User/account-to-MoySklad-company mapping.
- Persistent loyalty configuration, customer overrides and authorized manager/company assignments.
- Access control or secure server-side application data as supported by Shopflow.

MoySklad remains the operational source of truth for products, inventory, customers, sales and order state.

## Code boundary

- `src/lib/auth/access.ts` is server-only and deliberately fails closed until a verified Shopflow session verifier exists.
- `src/lib/auth/policy.ts` has pure authorization logic. A client only passes when its server-verified `moySkladCustomerId` matches the resource; sales managers only pass for server-verified assigned customer IDs; admins can access all.
- `src/lib/providers/contracts.ts` defines persistence and provider seams without presuming Shopflow methods.
- Loyalty settings currently persist only in demo browser local storage. They must move to Shopflow-backed persistence before production.

## Required implementation when the contract is supplied

1. Inspect the actual Shopflow SDK/API and environment naming in the target deployment; do not reuse the placeholder variables blindly.
2. Implement a server-only session verifier. Never accept role or customer mapping from a URL, request body, local storage or client-select control.
3. Resolve the authenticated subject to exactly one MoySklad company on the server. Reject missing/ambiguous mappings.
4. Apply `authorizeCustomerAccess` at every server data boundary before requesting or returning commercial data.
5. Persist loyalty configuration through Shopflow if the real capability supports it. Validate rules on both client and server.
6. Add integration tests covering missing sessions, changed URL IDs, cross-company reads and manager assignment scope.

The demo top-bar role switcher only changes navigation presentation; it is not login, authorization, account mapping or a safe substitute for Shopflow.