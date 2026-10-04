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

## Telegram reminders (adapter implemented; production delivery blocked)
- [x] Server-only Bot API client (`sendMessage`/`setWebhook`) with 429 `retry_after`, bounded 5xx/network backoff, blocked-chat handling and secret-redacted logs.
- [x] Authenticated webhook receiver (`X-Telegram-Bot-Api-Secret-Token`, message-only updates, `/start` `/help` `/stop`, private chats only).
- [x] One-time short-lived account linking bound to verified principals only (hash-persisted codes, demo switcher never trusted).
- [x] Authenticated scheduler endpoint + dispatcher reusing portal Friday/80%-gap/order/opportunity rules, Uzbek + Russian texts, per-chat idempotency and weekly cadence caps.
- [x] Mock-mode refusal: demo records can never be delivered to real chats; integration reports `disabled/unconfigured` without full configuration.
- [x] 121 automated Telegram tests (config fail-closed, secret-free responses, webhook auth, linking, phone onboarding, pilot registration + admin approval queue + in-bot review + user menu + persistent bottom menu + in-bot ShopFlow catalog/ordering + Mini App storefront + upgrade path, isolation, unsubscribe, timezones, loyalty parity, idempotency, retries) and `TELEGRAM_SETUP.md` operator docs.
- [x] Admin operations dashboard is 100% live data (pending/approved applications, bot order log, ShopFlow catalog counts, integration statuses; honest placeholder for sales analytics instead of demo numbers).

## ShopFlow Public API v1 (verified subset implemented)
- [x] Server-only v1 client (categories, products, product, promotions, upsells, createOrder, health) with Bearer auth, locale validation, 429 retry and bounded 5xx/network backoff.
- [x] BFF proxy routes under `/api/shopflow/*`: fail-fast input validation, fail-closed 503 without config, safe error mapping, key never exposed.
- [x] Outbound webhook receiver with raw-body HMAC-SHA256 verification for `order.created` / `order.status_changed` / `order.paid` (verified order events feed the admin “store orders” widget; Telegram fan-out still needs mapping + durable storage).
- [x] Admin clients + client details are 100% live (approved applications + per-client bot orders); opportunities is an honest placeholder until purchase history exists.
- [x] Admin login wall: `ADMIN_PASSWORD` + signed 12h session cookie, middleware gates `/admin/*` + `/api/admin/*` (login form, logout, per-IP throttle, fail-closed 503 when unconfigured). The old per-page `TELEGRAM_ADMIN_SECRET` prompt is retired — review API uses the login session (single sign-on). Full per-user auth (DB users, lockout, audit) is the next stage.
- [x] Admin shell cleanup: no demo workspace/profile/promo/cart/bell on `/admin/*`, route-aware footer, fixed live-row grid (+ mobile).
- [x] Marketing v1 (follow-ups): stage classifier + honest uz/ru templates + cooldown/cap dispatcher on bot data only, `/api/cron/telegram-followups` (bearer, `dryRun=1`, `limit`), `/admin/marketing` funnel + history + policy. Broadcasts + MoySklad-driven win-back stay future work.
- [x] In-bot catalog + ordering (`/katalog` for approved chats: categories → products → variant → MOQ quantity → courier/pickup → address → confirm → `POST /orders`, admin notified; fail-closed “coming soon”, single-order guard, live promos in `/dastur`).
- [x] Mini App storefront (`/katalog` opens `SHOPFLOW_STOREFRONT_URL` via a `web_app` button; button catalog stays as fallback; BotFather `/newapp` + Menu button; bot token never shared with ShopFlow).
- [x] Main menu buttons (`/menu`, `/start` for approved, attached to approval: shop / points+discounts / profile / help with back navigation; stateless; commands stay as fallback).
- [x] Persistent bottom menu (Telegram reply keyboard: shop opens the Mini App directly, label-text screens for the rest; bot order log powers the admin view).
- [x] 20 automated ShopFlow tests (config, validation, client retries/errors, HMAC, routes) and rewritten `SHOPFLOW_INTEGRATION.md` from the verified guide.

## Verification
- [x] `npm run typecheck`
- [x] `npm run lint` (ESLint CLI, zero warnings)
- [x] `npm test` (domain and access policy coverage)
- [x] `npm run build`
- [x] `npm audit` (0 vulnerabilities after dependency updates)
- [x] `.env.example` contains placeholders only; no secrets or `NEXT_PUBLIC_*` integration tokens.
- [x] Verify `MOYSKLAD_MODE=live` returns an integration-unavailable screen rather than rendering the mock customer portal.

## Production blockers — do not mark complete until resolved
- [ ] Inspect/connect the actual Shopflow SDK/auth/session/roles and persist loyalty settings there. (Public API v1 catalog/order/webhook subset is verified and implemented; dealer login, order-history field contracts and settings storage remain unspecified in the guide.)
- [ ] Verify server-side Shopflow user → MoySklad company mapping and enforce it on all live server data paths.
- [x] Verify and implement the MoySklad JSON API 1.2 counterparty subset (Bearer auth, mandatory gzip, `?search=`, list/error envelopes, phone lookup + registration) with 13 contract tests; wire it to Telegram phone onboarding.
- [ ] Implement and test the live MoySklad catalog/history provider against actual account/API documentation; map products, stock, customer-specific prices, sales, returns and statuses.
- [ ] Replace demo local-storage identity/cart/setting/fulfillment behavior as appropriate for the real contract.
- [ ] Perform cross-customer security verification in the integrated deployment before exposing customer data.
- [ ] Implement durable Shopflow-backed Telegram subscription/delivery/link/dialog stores and wire them into `getTelegramStores()` (memory stores are tests/local-only).
- [ ] Create the production bot via BotFather, configure deployment secrets, register the HTTPS webhook with `secret_token`, and connect the authenticated scheduler.
- [ ] Verify `/api/telegram/status` reports `ready` with `storageReady: true` and `liveDataMode: true` before announcing Telegram reminders; never mark production-ready earlier.
- [ ] Validate period aggregation against real historical sales and timezone fields.

**Status:** application and business-rule demo are implemented and build/test cleanly. The requested Shopflow + MoySklad production connections cannot be completed from this repository because no SDK, API contract, environment or credentials are present. The live boundary fails safely; this must not be represented as a production-connected portal.