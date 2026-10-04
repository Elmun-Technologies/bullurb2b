# Architecture

## Repository discovery (2026-09-28)

The repository contains only a one-line README and the initial Git commit. There is no Next.js application, Shopflow SDK/configuration, authentication setup, environment file, MoySklad client, or business data to reuse. Therefore, no Shopflow or MoySklad endpoint behavior is assumed.

## Intended data flow

```text
B2B user / sales / admin
        ↓
Next.js App Router (UI and server-side integration boundary)
        ↓
Shopflow (identity, roles, customer mapping, portal-owned settings)
        ↓
MoySklad (operational products, stock, counterparties, sales, orders)
```

MoySklad remains the operational source of truth. Shopflow is the intended application/business layer. Next.js is not a replacement backend. The current repository has no usable credentials/SDK/API contract, so this implementation runs through a typed mock provider and clearly marks external adapters as unconfigured. Demo data is not a production source of truth.

## Modules

- `src/lib/domain`: shared types, mock fixtures and pure loyalty/pricing/opportunity rules.
- `src/lib/providers`: provider contracts and mock adapter. Integration boundaries are isolated; real calls are intentionally not guessed.
- `src/lib/auth`: server-side authorization contract/helper. Production identity and company mapping must come from verified Shopflow session data, never request-controlled customer IDs.
- `src/app`: App Router pages, with a responsive portal shell and Uzbek-first interface.
- `src/lib/telegram` + `src/app/api/telegram/*` + `src/app/api/cron/telegram-reminders`: narrow server-side Telegram adapter (Bot API client, webhook receiver, one-time account linking, scheduler dispatch, idempotent delivery log). No separate backend; all secrets stay server-only and the integration fails closed until Shopflow auth, durable storage, live data and secrets exist.
- `src/components`: shared portal navigation, feedback, product, progress, pricing and order experiences.

## Security and current limitations

The demo user switcher and browser-side demo cart/settings are for local product evaluation only. They do not provide production authentication or persistence. There is no Shopflow API surface in this checkout to inspect or call. A production deployment must wire Shopflow auth and server-side authorization before exposing customer data, then configure its verified user-to-MoySklad-company mapping. MoySklad tokens belong only in server-side environment variables and must never use `NEXT_PUBLIC_*`.

Telegram delivery reuses the same provider boundary and loyalty/opportunity rules as the portal, so bot texts always match the in-app reminder center; demo/mock records are refused by the scheduler guard. The `MoySkladProvider` contract is the only intended operational data boundary. The mock provider follows that shape. The real provider remains explicitly unconfigured until the actual Shopflow/MoySklad API contract, account access and status mappings are supplied. No second inventory/order database is introduced.

## Demo behavior

The seeded portal includes 20 companies, 40 products, 50+ orders and editable loyalty settings. The highlighted `SAMARQAND MARKET` demo account begins at 82 boxes (Silver, 3%; 18 boxes to Gold). An order preview shows projected volume/tier. The demo-only fulfillment simulation can demonstrate the 20-box transition to 102 boxes / Gold. A real integration must count only configured qualifying fulfilled sales and subtract returns; draft orders do not qualify.

## Verification

Core calculations are pure functions with unit tests. Run `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` before deployment.