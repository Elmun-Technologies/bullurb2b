# MoySklad integration boundary

## Discovery and source of truth

No MoySklad client, credentials, account configuration, API schema, official documentation or real sample payloads were present in the repository. No endpoint, request shape, price-list precedence, stock mapping or status mapping is guessed here.

MoySklad must remain the operational source of truth for products/SKU, stock, customers/counterparties, sales, returns, orders and operational pricing wherever those records are available. Shopflow remains the intended business/authentication layer. This portal does not create a second inventory or permanent order database.

## Current code

- `src/lib/providers/contracts.ts` defines the normalized portal provider interface: product and customer reads, order reads and customer purchase history.
- `src/lib/providers/mock-provider.ts` provides the seeded demo adapter (40 products, 20 companies and 64 demo orders) with the same interface.
- `src/lib/providers/moysklad-live-provider.ts` is a server-only, intentionally unconfigured adapter. It throws rather than returning fictitious live data.
- `MOYSKLAD_MODE=mock` is the working default. `MOYSKLAD_MODE=live` currently selects the unconfigured adapter and will fail safely.
- All secrets belong server-side. Do not use `NEXT_PUBLIC_*` for a MoySklad token.

## Live adapter checklist

Before implementing the live adapter, inspect the actual authorized account/API documentation and verify:

1. Authentication method, account scope, pagination, rate limits and retryable errors.
2. Product, assortment, SKU, images, categories, units and package/box conversion fields.
3. Stock balances and permitted customer stock visibility.
4. Counterparty identity mapping from verified Shopflow subject to MoySklad ID.
5. Historical customer orders/sales, timestamp/timezone interpretation, currency and taxes.
6. Statuses that are genuinely fulfilled/eligible, plus returns/refunds and cancellations.
7. B2B price list and customer-specific negotiated-price fields and policy.
8. Order creation workflow, required fields, idempotency behavior and how resulting state is confirmed.

Then normalize and validate external payloads server-side, add bounded caching/deduplication, and test API error handling. Do not count drafts or cancelled orders toward loyalty. Subtract returned quantity/revenue when the source supplies reliable return data. A submitted draft order must not be presented as a qualifying completed purchase.

## Currency and pricing

Portal money values are integer UZS in domain logic. The pricing service resolves a customer-specific negotiated price before loyalty discount; a special price does not stack with the tier discount. Map the real MoySklad/Shopflow policy only after verifying actual price fields and business semantics.

## Mock demo limitation

Demo catalogue art and records are sample fixtures. The app's “fulfilled” demo action changes browser local-storage state only and does not call MoySklad or create an operational sale/order.