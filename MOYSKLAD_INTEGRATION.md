# MoySklad integration boundary

## Discovery and source of truth

Verified against the official JSON API 1.2 docs
(https://dev.moysklad.ru/doc/api/remap/1.2/); everything below is implemented
in `src/lib/moysklad/` with tests in `src/lib/moysklad/moysklad.test.ts`.

- Base URL: `https://api.moysklad.ru/api/remap/1.2`.
- Auth: `Authorization: Basic base64(login:password)` or
  `Authorization: Bearer <token>`. Tokens are minted with
  `POST /security/token`, which **revokes previously issued tokens** — so the
  portal never mints tokens automatically and requires a pre-minted
  `MOYSKLAD_API_TOKEN`.
- `Accept-Encoding: gzip` is **mandatory** on every request (missing header
  yields HTTP 415 with no body).
- Context search: `GET /entity/counterparty?search=<urlencoded>`.
- Lists return `{meta:{size,limit,offset}, rows:[]}`.
- Failures return `{errors:[{error, parameter, code, error_message, ...}]}`.
- `Retry-After` on 429 is honored when present; 5xx/network use bounded
  backoff. 401 never retries.

MoySklad remains the operational source of truth for customers/counterparties,
products/SKU, stock, sales, returns, orders and operational pricing wherever
those records are available. Shopflow remains the intended
business/authentication layer and the order-creation path (ShopFlow
`POST /orders` syncs orders into MoySklad). This portal does not create a
second inventory or permanent order database.

## What is live today (counterparty identity)

- `src/lib/moysklad/client.ts` — server-only client: `searchCounterparties`,
  `getCounterparty`, `findByPhone` (E.164 + tolerant Uzbek matching over
  context search, since MoySklad stores phones in arbitrary formats),
  `createCounterparty` (`name` + `phone` + `description` only).
- `src/lib/moysklad/phone.ts` — pure Uzbek phone normalization/matching.
- `src/lib/moysklad/config.ts` — fail-closed server-only token config.
- `MOYSKLAD_API_TOKEN` enables Telegram bot identification today:
  `/start` → contact-share → counterparty lookup by phone → auto-link when
  exactly one match, bot self-registration when none. See TELEGRAM_SETUP.md.
- 429 honors `Retry-After`; 5xx/network retry with bounded backoff; the token
  is never written to logs.

## Still blocked (catalog, sales, loyalty math)

- `src/lib/providers/contracts.ts` defines the normalized portal provider
  interface: product and customer reads, order reads and customer purchase
  history.
- `src/lib/providers/mock-provider.ts` provides the seeded demo adapter
  (40 products, 20 companies and 64 demo orders) with the same interface.
- `src/lib/providers/moysklad-live-provider.ts` is a server-only,
  intentionally unconfigured adapter. It throws rather than returning
  fictitious live data.
- `MOYSKLAD_MODE=mock` is the working default. `MOYSKLAD_MODE=live` currently
  selects the unconfigured adapter and will fail safely.
- All secrets belong server-side. Do not use `NEXT_PUBLIC_*` for a MoySklad
  token.

Before implementing the live catalog/history adapter, verify in the actual
authorized account and docs:

1. Assortment/product fields: SKU, images, categories, units, package/box
   conversion.
2. Stock balances and permitted customer stock visibility.
3. Historical customer orders/sales (customerorder/demand), timestamp/timezone
   interpretation, currency and taxes.
4. Statuses that are genuinely fulfilled/eligible, plus returns/refunds and
   cancellations.
5. B2B price list and customer-specific negotiated-price fields and policy.
6. Rate-limit quotas and parallel-request limits.

Then normalize and validate external payloads server-side, add bounded
caching/deduplication, and test API error handling. Do not count drafts or
cancelled orders toward loyalty. Subtract returned quantity/revenue when the
source supplies reliable return data. A submitted draft order must not be
presented as a qualifying completed purchase.

## Minting a token (operator runbook)

```bash
curl -s -X POST \
  -u '<login>:<password>' \
  -H 'Accept-Encoding: gzip' \
  https://api.moysklad.ru/api/remap/1.2/security/token
# → {"access_token":"..."} — store as MOYSKLAD_API_TOKEN (server-only).
# Minting revokes older tokens: coordinate with other integrations first.
```

Verify read access:

```bash
curl -s -H "Authorization: Bearer $MOYSKLAD_API_TOKEN" \
  -H 'Accept-Encoding: gzip' \
  'https://api.moysklad.ru/api/remap/1.2/entity/counterparty?limit=1'
```

## Currency and pricing

Portal money values are integer UZS in domain logic. The pricing service
resolves a customer-specific negotiated price before loyalty discount; a
special price does not stack with the tier discount. Map the real
MoySklad/Shopflow policy only after verifying actual price fields and business
semantics.

## Mock demo limitation

Demo catalogue art and records are sample fixtures. The app's “fulfilled” demo
action changes browser local-storage state only and does not call MoySklad or
create an operational sale/order.
