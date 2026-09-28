# Implementation checklist

## Discovery and architecture
- [x] Inspect repository, Shopflow configuration, authentication and MoySklad integration (checkout contained only README; none exists to reuse).
- [x] Create `ARCHITECTURE.md`, `LOYALTY_RULES.md`, `SHOPFLOW_INTEGRATION.md` and `MOYSKLAD_INTEGRATION.md` without inventing undocumented APIs.
- [x] Define provider interfaces, mock provider and explicitly unconfigured live adapter.

## Foundation and domain
- [x] Create Next.js App Router, TypeScript, responsive UI foundation and Uzbek-first message module.
- [x] Centralize 5 editable loyalty tiers, thresholds, period/metric model, progress, upgrade/downgrade, eligibility, return aggregation and Tashkent period boundaries.
- [x] Add integer UZS pricing and customer-specific special-price precedence.
- [x] Add rules-based near-tier, inactive, volume-drop and tier-downgrade opportunities.
- [x] Add derived in-app reminders for near-tier progress, order status, manager follow-ups and Tashkent Friday greetings (no external delivery).
- [x] Add fail-closed Shopflow session placeholder and pure server-side customer authorization policy (not a connected auth integration).
- [x] Add tests for thresholds, progress, upgrade/downgrade, validation, timezone period, cancelled orders, returns, pricing precedence and customer isolation.

## Customer portal (demo)
- [x] Dashboard with tier, discount, progress, next tier, current purchases, activity and recent orders.
- [x] Searchable product catalog with category/brand/stock filters, sorting and personalized pricing.
- [x] Cart, order review, savings summary, tier impact preview and factual near-tier messaging.
- [x] Explicit demo-only fulfilled-order simulation for 82 + 20 = 102 boxes / Silver → Gold.
- [x] Order history, order details, loyalty tiers and company profile.
- [x] Header reminder center with Friday greeting, next-tier gap and active order notifications.
- [x] Responsive mobile shell and empty/search states.

## Admin (demo)
- [x] Admin dashboard, tier distribution, client list/detail and rules-based sales opportunities.
- [x] Editable program state, metric (boxes/turnover), period (month/30/90 days), tier names, thresholds and discounts.
- [x] Client tier/region filters, search and sorting.
- [x] Tier validation and browser-local demo settings persistence.

## Verification
- [x] `npm run typecheck`
- [x] `npm run lint` (ESLint CLI, zero warnings)
- [x] `npm test` (domain and access policy coverage)
- [x] `npm run build`
- [x] `npm audit` (0 vulnerabilities after dependency updates)
- [x] `.env.example` contains placeholders only; no secrets or `NEXT_PUBLIC_*` integration tokens.
- [x] Verify `MOYSKLAD_MODE=live` returns an integration-unavailable screen rather than rendering the mock customer portal.

## Production blockers — do not mark complete until resolved
- [ ] Inspect/connect the actual Shopflow SDK/auth/session/roles and persist loyalty settings there.
- [ ] Verify server-side Shopflow user → MoySklad company mapping and enforce it on all live server data paths.
- [ ] Implement and test the live MoySklad provider against actual account/API documentation; map products, stock, customer-specific prices, sales, returns, statuses and order creation.
- [ ] Replace demo local-storage identity/cart/setting/fulfillment behavior as appropriate for the real contract.
- [ ] Perform cross-customer security verification in the integrated deployment before exposing customer data.
- [ ] Validate period aggregation against real historical sales and timezone fields.

**Status:** application and business-rule demo are implemented and build/test cleanly. The requested Shopflow + MoySklad production connections cannot be completed from this repository because no SDK, API contract, environment or credentials are present. The live boundary fails safely; this must not be represented as a production-connected portal.