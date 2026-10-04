# Baraka — B2B Loyalty & Dealer Portal

Uzbek-first B2B portal experience for wholesale customers and sales teams. The core product loop is **buy more → reach the next loyalty tier → receive a better B2B price**.

## What is implemented

- Responsive customer dashboard with current tier, discount, progress, next-tier gap, recent orders and benefits.
- Product catalog (40 seeded SKUs) with search, category/brand/stock filters, sorting, availability, quantity and personalized prices.
- Customer-specific negotiated prices take precedence over tier pricing; discounts use integer UZS arithmetic.
- Cart, order review, savings totals and projected tier impact. The mock-only fulfillment action demonstrates `82 + 20 = 102 boxes`, Silver → Gold, 3% → 5%.
- Loyalty page and editable admin thresholds, metric (boxes / UZS turnover), period (calendar month / 30 / 90 days), program state and tier discounts.
- Admin dashboard, 20 customer records, client list/detail, recent orders and rules-based sales opportunities.
- In-app reminder center with factual near-tier gap alerts, order-status reminders, high-priority manager follow-ups, and a Tashkent-time Friday greeting. These are computed in the portal; no email, SMS, or push channel is connected.
- Server-side Telegram reminder adapter (bot webhook, one-time account linking, `/start`/`/help`/`/stop`, authenticated scheduler dispatch, idempotent delivery) reusing the exact portal rules. The code and tests are implemented, but live delivery is **not production-ready**: it stays `disabled/unconfigured` until Shopflow auth, durable storage, the live MoySklad adapter, secrets and a scheduler are connected. See [Telegram setup](./TELEGRAM_SETUP.md).
- Centralized loyalty, pricing, eligibility, tier validation, time-window and customer authorization policy modules with unit tests.
- Typed Shopflow/MoySklad integration boundaries and a demo provider.

## Important integration status

This Git checkout originally contained only a README. There was no Shopflow SDK or configuration, no authentication/session verifier, no MoySklad API contract or credentials, and no source data to reuse. Therefore:

- The portal currently runs in **mock/demo mode**. Seeded commercial data is illustrative and is not a source of truth.
- Shopflow authentication, role claims, customer mapping and persistent settings are **not connected** (the verified Public API v1 covers catalog + order creation + order-event webhooks; dealer login, order-history shapes and settings storage are still unspecified). The top-bar view switcher is a demo UI control, not authentication or access control.
- The live MoySklad catalog/history provider is deliberately **unconfigured** (`MOYSKLAD_MODE=live` fails rather than serving mock data). Only the verified counterparty-identity subset (search/create) is implemented, powering Telegram bot identification.
- Telegram delivery is likewise fail-closed: without `TELEGRAM_ENABLED=true`, all secrets, Shopflow auth/storage and live provider mode, the integration reports `disabled/unconfigured`, and demo records are never sent to real chats.
- Do not deploy with customer data until the Shopflow session verifier and server-side customer authorization are connected. The fail-closed authorization policy is present as a boundary, not a live session implementation.

See [Architecture](./ARCHITECTURE.md), [Shopflow integration](./SHOPFLOW_INTEGRATION.md), [MoySklad integration](./MOYSKLAD_INTEGRATION.md), [Loyalty rules](./LOYALTY_RULES.md), [Telegram setup](./TELEGRAM_SETUP.md) and [Implementation checklist](./IMPLEMENTATION_CHECKLIST.md).

## Requirements

- Node.js 20+ (tested with Node 22)
- npm

## Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. The app binds to `0.0.0.0` for hosted previews. The mock provider is the default; no credentials are needed.

## Environment

`.env.example` lists only relevant configuration. Never add secrets to Git or a `NEXT_PUBLIC_*` variable. Current variables:

| Variable | Purpose |
| --- | --- |
| `MOYSKLAD_MODE=mock` | Use seeded adapter; currently the only working data mode. |
| `DEFAULT_TIMEZONE=Asia/Tashkent` | Intended business timezone (domain defaults to Asia/Tashkent). |
| `DEFAULT_CURRENCY=UZS` | Currency display. |
| `SHOPFLOW_API_URL`, `SHOPFLOW_API_KEY` | Verified Public API v1 base (`https://<domain>/api/v1`) + `sf_...` key; server-only, used by the BFF proxies in `/api/shopflow/*`. |
| `SHOPFLOW_WEBHOOK_SECRET` | Server-only HMAC secret for the ShopFlow outbound webhook receiver (`POST /api/shopflow/webhook`). |
| `MOYSKLAD_API_TOKEN` | Server-only pre-minted token; enables Telegram bot identification (counterparty lookup/registration). Live catalog/history still unverified — keep `MOYSKLAD_MODE=mock`. |
| `TELEGRAM_ENABLED`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_LINKING_SECRET`, `TELEGRAM_CRON_SECRET` | Server-only Telegram placeholders (see `TELEGRAM_SETUP.md`); keep `TELEGRAM_ENABLED=false` until every production blocker is resolved. |

Do not set `MOYSKLAD_MODE=live` until a verified adapter and API contract exist. In the current code it intentionally reports an unconfigured integration.

## Demo flow

1. Open **Bosh sahifa**; the `SAMARQAND MARKET` demo account starts at **82 boxes**, Silver, **3%**, with 18 boxes to Gold.
2. In **Mahsulotlar**, add products until the cart is 20 boxes. Product quantity is measured in boxes.
3. Open the cart from the top bar. The preview shows a projected total of 102 boxes, Gold and 5% if the current demo configuration is unchanged.
4. Use **“Demo rejimida bajarilgan deb belgilash”** only to simulate a fulfilled order and see the Gold success state. This does not create a MoySklad order.
5. Select **Admin ko‘rinishi** in the top bar to inspect the admin screens and edit tier settings. This selector is not a production role check.
6. Demo cart, settings, role selection and simulated fulfillments persist in this browser's local storage. Clear local storage to reset.

## Routes

- `/dashboard`, `/catalog`, `/prices`, `/orders`, `/orders/new`, `/orders/[id]`, `/loyalty`, `/company`
- `/admin`, `/admin/clients`, `/admin/clients/[id]`, `/admin/opportunities`, `/admin/loyalty`

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm audit
```

## Deployment notes

The UI and demo mode are ready for local/preview evaluation. This is **not yet a production-connected loyalty service**. Before a real rollout: connect verified Shopflow authentication and role claims, resolve Shopflow user → MoySklad company mapping server-side, implement real MoySklad reads/order creation against verified API docs, configure qualifying states and returns, move loyalty settings to Shopflow, add integration/authorization tests, and only then enable customer data. Never create a shadow operational inventory/order database.
