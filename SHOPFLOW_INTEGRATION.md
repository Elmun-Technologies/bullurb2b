# Shopflow integration

## Verified source

The ShopFlow backend integration guide (uploaded to `origin/main` as
`Pasted text(20260928-173124) (1).txt`, verified by its author against
`backend/src/routes/public-api.ts`) is now the contract source. Only the
parts below are implemented — everything the guide leaves unspecified stays
a blocker and is not guessed.

ShopFlow is a multi-tenant e-commerce CRM backend (Fastify + Prisma +
PostgreSQL). For this portal we use **Path A — Public API v1** (stable,
versioned) plus **outbound webhooks** for order events:

| Verified capability | Contract | Used in this repo |
| --- | --- | --- |
| `GET /api/health` (authless) | `{status, db, ts}` | `ShopFlowClient.health()`, `GET /api/shopflow/health` |
| `GET /v1/categories?locale=` | `Category[]` | `categories()`, `GET /api/shopflow/categories` |
| `GET /v1/products` (filters, sort, pagination) | `{items, total, page, pageSize}` | `products()`, `GET /api/shopflow/products` |
| `GET /v1/products/:slug` (id fallback) | Full `Product` incl. `variants`, `priceTiers`, `moq`, `inStock` | `product()`, `GET /api/shopflow/products/[slug]` |
| `GET /v1/promotions` | `Promotion[]` | `promotions()`, `GET /api/shopflow/promotions` |
| `POST /v1/orders` | `201 {ok, orderId, message}`; `400/409 {ok:false, message, variants?}` | `createOrder()`, `POST /api/shopflow/orders` |
| Errors | `401/404 {error}`, `400 {error,details}` (Zod), `429 {error}` | Typed `ShopFlowApiError` + safe proxy mapping |
| Rate limit | 300 req/min/IP | 429 retried with delay; 5xx/network bounded backoff |
| Money | Integer UZS, `currency: "UZS"` | Matches portal domain (€ never float) |
| Locale | `?locale=uz\|ru\|en`, default `uz` | Validated on every proxy read |
| Outbound webhooks | `X-ShopFlow-Signature: sha256=<hex>` over raw body; events `order.created`, `order.status_changed`, `order.paid`, `lead.created` | `POST /api/shopflow/webhook` (HMAC verify, parse, acknowledge) |

## Code boundary

- `src/lib/shopflow/` — server-only client, config, validation, webhook
  helpers. The `sf_...` API key lives only in `SHOPFLOW_API_KEY` and travels
  in the `Authorization` header; it is never logged, never returned, never in
  `NEXT_PUBLIC_*`. Browsers call our BFF proxy routes, never ShopFlow
  directly (guide §3.0 security rule).
- `src/app/api/shopflow/*` — thin BFF proxies: fail-fast input validation,
  fail-closed `503` without configuration, lossy-but-safe error mapping
  (only user-actionable texts like stock conflicts and variant choices are
  relayed).
- `POST /api/shopflow/webhook` — verifies HMAC on the raw body with a
  timing-safe compare, validates `{event, tenantId, timestamp, data}`, and
  acknowledges. Fanning order events out to Telegram chats still needs the
  verified customer→chat mapping and durable delivery storage (same Telegram
  production blockers).
- Order path (decided): orders are created via ShopFlow `POST /orders`, which
  syncs them into MoySklad. The in-bot catalog reuses this path rather than
  writing MoySklad documents directly.

## In-bot catalog + ordering (`/katalog`)

Approved Telegram clients browse and order without leaving the chat:
categories → products (5/page) → detail (price/stock/MOQ/tiers) → variant →
quantity (MOQ-enforced) → courier/pickup → address (or the registered one,
skippable on pickup) → confirm → `POST /orders`. Name/phone come from the
verified registration application; `attribution.utmSource` is `telegram-bot`;
displayed prices are never sent back (ShopFlow recomputes totals).

- Code: `src/lib/telegram/catalog.ts` (`CatalogBackend` interface — the real
  `ShopFlowClient` in production, a fake in tests), wired in
  `webhook-handler.ts` (`catalog` command, `sf:*` callbacks, free-text steps)
  and `src/app/api/telegram/webhook/route.ts` (fail-closed `null` backend).
- Gating: approved application (or MoySklad-linked binding) required;
  pending/rejected chats get an honest status, unconfigured ShopFlow gets an
  honest “coming soon” — no demo products, ever.
- Safety: buttons carry `sf:<action>:<index>` (≤64 bytes), ids stay in
  per-chat state and are revalidated per press; private-chat presser check;
  stale buttons toast instead of acting; double-confirm places one order
  (`placing`/`placed` guards); 409 stock messages are relayed, the cart kept
  for retry; 401 alerts the admin chat to check the key.
- Admin: every bot order best-effort notifies `TELEGRAM_ADMIN_CHAT_ID`.
- `/dastur` appends live `GET /promotions` when ShopFlow is configured.
- Needs: `SHOPFLOW_API_URL` (`https://<domain>/api/v1`, no trailing slash)
  and `SHOPFLOW_API_KEY` (`sf_...`) as server secrets (Fly: `fly secrets set`
  — triggers a restart, which wipes pilot memory stores).

## Deliberately NOT implemented (guide leaves these unspecified)

- **Dealer (Customer) login / sessions.** The guide documents staff login
  (`POST /api/auth/login`, JWT 15 min + 30-day refresh, roles
  `OWNER/ADMIN/MANAGER/AGENT`) but no customer-facing auth. Portal `CLIENT`
  sessions therefore stay blocked; the demo role switcher is still not auth.
- **Order-history / customer reads with field contracts.** Path B prefixes
  (`/api/orders`, `/api/customers`, …) are listed without response shapes, so
  no loyalty-grade purchase-history reader is implemented. Loyalty history
  still needs either documented MoySklad reads or documented ShopFlow shapes.
- **Portal settings / Telegram storage in ShopFlow.** No key-value or
  portal-settings endpoint is documented, so loyalty settings and Telegram
  subscriptions/delivery-log stay on their fail-closed boundaries.
- **Box-unit semantics.** ShopFlow `unit` is `kg|l|dona|null` with boolean
  `inStock`; the portal counts boxes with quantities. No conversion is
  assumed — mapping this needs a business decision plus real catalog data.
- **Customer-specific negotiated prices.** Public API has `priceTiers`
  (quantity breaks), not per-customer prices. Portal special-price logic
  stays demo-only until a verified source exists.

## Setup (when a real backend exists)

1. Health: `GET https://<domain>/api/health` → `{"status":"ok",...}`.
2. API key (admin panel **Sozlamalar → API**, or
   `npm run create-api-key -- <tenant-slug> "B2B portal"`); store as
   server-only `SHOPFLOW_API_URL=https://<domain>/api/v1` and
   `SHOPFLOW_API_KEY=sf_...`.
3. Outbound events: register `https://<portal>/api/shopflow/webhook` with a
   secret (`SHOPFLOW_WEBHOOK_SECRET`) for `order.status_changed` (+
   `order.created`, `order.paid` as needed).
4. Verify via `GET /api/shopflow/health` (proxied, no secrets in response).

`src/lib/auth/*` fail-closed placeholders and the pure authorization policy
are unchanged: server-verified identity is still required before any live
customer data flows.
