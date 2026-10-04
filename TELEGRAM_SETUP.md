# Telegram reminders — setup & operations

Uzbek-first Telegram delivery for the portal reminder center. The in-app
reminder center keeps working unchanged; Telegram is an additional,
server-side-only channel built as a narrow adapter
(`src/lib/telegram/*` + 4 API routes). No separate backend was added.

> **Production status: NOT ready.** The adapter code, retry/idempotency logic
> and automated tests are implemented, but live delivery additionally requires
> Shopflow auth + user→company mapping, durable Shopflow-backed Telegram
> storage, a live MoySklad adapter, deployment secrets and an external
> scheduler — none of which exist in this checkout. Do not present this as a
> production-connected integration until every blocker below is resolved.

## What subscribers receive (Uzbek Latin, Russian supported)

Clients (their own verified company only):

- Friday greeting — evaluated in the loyalty program's configured timezone
  (default `Asia/Tashkent`), once per Friday.
- Next-tier gap while progress is ≥ 80% — same loyalty engine as the portal,
  exact remaining boxes/UZS. Repeats at most once per calendar week.
- Order status changes — every active-status transition once, plus terminal
  transitions (`Yetkazildi` / `Bekor qilindi`) once. Historical orders seen on
  first run stay silent (silent baseline, no backfill spam).

Managers — high-priority opportunities (`Yuqori`) for their verified assigned
customers only, at most once per calendar week per opportunity. Admins use the
same rule across all customers. Messages contain company name + headline +
action only — no phone numbers, emails or turnover details.

Bot commands: `/start <code>` links an account, `/start` enables/shows
status, `/stop` unsubscribes, `/help` shows help. Only private chats are
served; group/channel messages are ignored.

## MoySklad phone onboarding (bot identification)

When `MOYSKLAD_API_TOKEN` is configured, unlinked `/start` chats are onboarded
via MoySklad counterparty identity (no portal session needed):

1. Bot asks for a **“share phone number”** button tap (`request_contact`
   reply keyboard; private chats only).
2. The shared number is ownership-checked (`contact.user_id` must equal the
   sender). Manually typed numbers are **never** accepted — anyone could type
   someone else's number and receive their data.
3. MoySklad lookup by phone (`findByPhone`, tolerant Uzbek normalization):
   - exactly one match → chat links automatically and the bot shows the
     company name, phone and MoySklad code;
   - no match → the bot self-registers: asks F.I.Sh. + shop/company name,
     creates the counterparty (`POST /entity/counterparty`), then links;
   - several matches → no auto-link; the user is routed to their manager.
4. `/stop` cancels an in-progress dialog and removes the keyboard.

Without the MoySklad token, the bot runs in **pilot mode**: `/start` still
asks for a contact-share, ownership-checks it, and stores a pilot
subscription (`pilot-phone:<E.164>`, no `customerId`). Pilot chats honestly see
a “test mode” confirmation echoing their own number — no company data is ever
invented, and the dispatcher skips pilot bindings (nothing fake is sent).
Code linking (`/start <code>`) keeps working in both modes. See
`MOYSKLAD_INTEGRATION.md` for the verified counterparty contract and the
token runbook.

When the MoySklad token is added later, the next `/start` from a
pilot-linked chat automatically upgrades the binding via a real phone lookup
(found → link, unknown → in-place registration, ambiguous → manager routing
while keeping the pilot binding).

## Pilot registration + admin approval (no MoySklad needed)

Pilot registration is a full multi-step flow that also works end to end on a
single Fly machine (memory stores are a process-level singleton):

1. `/start` → contact-share button (ownership-checked).
2. F.I.Sh. → shop/company name → shop address (free text, validated).
3. Shop location via a `request_location` button, or ⏭ skip.
4. The application is saved as `pending`, a pilot subscription is created,
   and the admin chat (optional `TELEGRAM_ADMIN_CHAT_ID`) gets a summary with
   a Google Maps link.

Admin review happens at `/admin/telegram` (see the “Telegram arizalar” nav
item). Every admin API call needs `Authorization: Bearer
<TELEGRAM_ADMIN_SECRET>` (≥ 32 chars, server-only, set via `fly secrets set`);
the demo role switcher is never trusted. Approve/reject endpoints
(`POST /api/admin/telegram/applications/[chatId]/approve|reject`) update the
status and notify the chat over the bot (a `notified` flag reports delivery).
Reject accepts an optional reason and lets the user restart with `/start`.
For now the MoySklad counterparty itself is created manually by the operator
after approval; auto-creation on approve is a future step.

Find your admin chat id via `@userinfobot` (or `@getmyid_bot`) and set
`TELEGRAM_ADMIN_CHAT_ID` to enable new-application notifications.

## In-bot admin review (no panel visit needed)

The admin notification carries inline ✅/❌ buttons. Pressing one calls back
into the webhook (`callback_query`, so `allowed_updates` must include it),
applies the same shared `decideApplication` logic as the web panel, edits the
admin message to the final state (buttons removed) and notifies the client.
Bot-side rejects carry no reason — use the web panel when a reason is needed.

Authorization: a press counts only when the presser or the message chat
matches `TELEGRAM_ADMIN_CHAT_ID` (DM or group). Without that variable, nobody
can decide via the bot. Pilot note: every member of the admin group can press
the buttons — production should restrict this to listed admin user ids.

## User menu (post-registration)

Approved users get a main menu of inline buttons (also on `/menu` and
attached to the approval message): 🛒 shop (Mini App store, button-catalog
fallback), ⭐ points + discounts (tiers + live promotions; personal balance
needs purchase history), 👤 profile (stored data + status), ℹ️ help. The menu
is stateless and needs no keys; `/profil`, `/dastur`, `/katalog` stay as
command fallbacks.

`/katalog` (needs ShopFlow keys, see `SHOPFLOW_INTEGRATION.md`) opens the
Mini App store (`SHOPFLOW_STOREFRONT_URL`) inside Telegram, with a
button-based catalog as fallback (categories → products → variant → quantity
→ delivery → address → confirm → real ShopFlow order, admin notified per
order). Without the keys the bot honestly says the catalog is coming soon.
`/dastur` appends live promotions when configured.

## Client test script (2–3 day pilot, copy-paste to testers)

> Assalomu alaykum! Baraka B2B eslatmalar botini test qilamiz 🧪
>
> 1. @billurb2bbot ni oching, START bosing.
> 2. “📱 Telefon raqamni ulashish” tugmasini bosing.
> 3. Ism, do‘kon nomi, manzil va lokatsiyani yuboring.
> 4. Arizangiz qabul qilinadi — admin tasdiqlagach, xabar keladi.
>
> Hozir test rejimi: bot ro‘yxatdan o‘tishni sinayapti. Keyingi bosqichda
> kompaniyangiz avtomatik topiladi, darajangiz va eslatmalar shu chatga keladi.
> Muammo bo‘lsa menga yozing. Rahmat!

## Loyalty tier visuals (bot images)

`public/telegram/tiers/` holds one AI-generated illustration per loyalty tier
(`tier-standard/silver/gold/platinum/vip.jpg`, 1280px, chat-optimized), matching the tier ids in
`src/lib/domain/loyalty.ts`. The images are deliberately **text-free** — tier
name, progress and discount travel in the message caption instead, so one
asset set serves both Uzbek and Russian texts. They are served from `public/`,
so the bot can send them via `sendPhoto` with a public URL once photo
delivery is implemented (currently the sender supports text-only
`sendMessage`).

## Architecture (narrow adapter)

```text
Telegram ──POST──> /api/telegram/webhook ──> handleTelegramUpdate ──> stores + sender
  (secret header)   (secret verify, parse)     (/start /stop /help)

/portal session/ ──POST──> /api/telegram/link-code ──> issueLinkCode (verified principal only)
Shopflow auth                                                              │ one-time code (10 min)
/scheduler/ ──GET/POST──> /api/cron/telegram-reminders ──> dispatchTelegramReminders ──> sendMessage
  (bearer auth)        (live-mode guard)            (portal rules + idempotency log)

GET /api/telegram/status ──> secret-free status for the setup UI ({ disabled | unconfigured | ready })
```

- `src/lib/telegram/config.ts` — server-only env + fail-closed status.
- `src/lib/telegram/client.ts` — Bot API `sendMessage`/`setWebhook` with
  429 `retry_after` handling, bounded exponential backoff for 5xx/network,
  non-retryable auth/blocked/missing-chat mapping, secret-redacted logs.
- `src/lib/telegram/stores.ts` — storage boundary (subscriptions, delivery
  log, link codes). Production defaults to fail-closed `unconfigured` stores.
- `src/lib/telegram/linking.ts` — one-time short-lived codes (hash persisted,
  raw code never stored or logged).
- `src/lib/telegram/webhook.ts` — timing-safe secret check, Update/commands.
- `src/lib/telegram/dispatcher.ts` + `webhook-handler.ts` — orchestration.
- `src/lib/telegram/schedule.ts`, `messages.ts` — timezone helpers, UZ/RU texts.

## 1. Create the bot (BotFather)

1. In Telegram, open `@BotFather` → `/newbot`, pick a name and username
   (must end in `bot`, e.g. `BarakaB2BReminderBot`).
2. Copy the bot token BotFather returns. **Treat it as a password**: server
   deployment secret only, never `NEXT_PUBLIC_*`, Git, logs or chat.
3. Optionally `/setdescription`, `/setabouttext`, and `/setcommands`:
   `menu` (main menu), `start` (start/registration), `katalog`
   (products/orders), `profil` (my data), `dastur` (tiers), `help`, `stop`.
4. Mini App store: `/newapp` on this bot with the ShopFlow storefront URL,
   then `/mybots` → the bot → Menu Button → the same URL (label e.g.
   `🛒 Do‘kon`). Mirrors `/katalog`; never give this bot's token to
   ShopFlow (one token = one webhook).

Official references: Bot API
([sendMessage/setWebhook](https://core.telegram.org/bots/api)),
[bot features & deep linking](https://core.telegram.org/bots/features)
(`/start` payload ≤ 64 chars, `A–Z a–z 0–9 _ -`).

## 2. Deployment secrets (server environment only)

| Variable | Purpose |
| --- | --- |
| `TELEGRAM_ENABLED=true` | Explicit opt-in; anything else keeps the integration `disabled`. |
| `TELEGRAM_BOT_TOKEN` | BotFather token. In the request URL path — never logged. |
| `TELEGRAM_BOT_USERNAME` | Bot username without `@` (deep links + mention checks). |
| `TELEGRAM_WEBHOOK_SECRET` | 1–256 chars, `A–Z a–z 0–9 _ -` (Bot API `secret_token` charset). |
| `TELEGRAM_LINKING_SECRET` | ≥ 32 chars HMAC pepper for persisted link-code hashes. |
| `TELEGRAM_CRON_SECRET` | ≥ 32 chars bearer token for the scheduler endpoint. |
| `TELEGRAM_ADMIN_SECRET` | ≥ 32 chars bearer token for the admin review API (`/api/admin/telegram/*`). Required for approve/reject. |
| `TELEGRAM_ADMIN_CHAT_ID` | Optional numeric chat id for new-application bot notifications (via `@userinfobot`). |
| `TELEGRAM_STORE_MODE` | Leave empty in production. `memory` is for local dry runs with a fake sender only — never with a real token. |

Generate secrets with e.g. `openssl rand -base64 32 | tr '/+=' '_-_'`.
`.env.example` contains placeholders only. On Fly.io, store them with
`fly secrets` (values are encrypted at rest and never appear in code or
Git — see “Deploy to Fly.io” below). Verify status any time:

```bash
curl -s https://<portal-host>/api/telegram/status
# {"ok":true,"status":"ready|unconfigured|disabled","missing":[...],"storageReady":false,...}
```

## 2b. Deploy to Fly.io (portal + bot webhook)

Prerequisites: a Fly.io account and
[flyctl](https://fly.io/docs/flyctl/install/) installed and logged in
(`fly auth login`). The repo ships `Dockerfile` (Next.js standalone, per the
[official Fly guide](https://fly.io/docs/js/frameworks/nextjs/)), `fly.toml`
(app `bullurb2b`, region `fra` — closest to Tashkent, one warm machine) and
`.dockerignore`. Secrets are set via `fly secrets` — nobody (including chat
and Git) ever sees them.

```bash
# 1. From the repo root: creates/confirms the app (rename if `bullurb2b` is
#    taken), then builds and deploys. Re-run `fly deploy` on every update.
fly launch
fly deploy

# 2. Set server secrets (example values — generate your own; see section 2).
fly secrets set \
  TELEGRAM_ENABLED=true \
  TELEGRAM_BOT_TOKEN='<botfather-token>' \
  TELEGRAM_BOT_USERNAME='<bot-username-without-@>' \
  TELEGRAM_WEBHOOK_SECRET='<webhook-secret>' \
  TELEGRAM_LINKING_SECRET='<32plus-char-linking-secret>' \
  TELEGRAM_CRON_SECRET='<32plus-char-cron-secret>' \
  MOYSKLAD_API_TOKEN='<pre-minted-moysklad-token>' \
  SHOPFLOW_API_URL='<shopflow-domain>' \
  SHOPFLOW_API_KEY='<sf_...>' \
  SHOPFLOW_WEBHOOK_SECRET='<shopflow-webhook-secret>'
# NOTE: keep MOYSKLAD_MODE unset (= mock) for now. The live catalog/history
# adapter is still unverified; MOYSKLAD_API_TOKEN alone enables bot
# identification, which does not depend on MOYSKLAD_MODE.

# 3. Verify the deployment (replace with your real host).
APP_URL='https://bullurb2b.fly.dev'
curl -s "$APP_URL/api/telegram/status"
# expect "status":"ready" once all secrets are set

# 4. Register the Telegram webhook (section 3) against the Fly host:
#    POST https://api.telegram.org/bot<token>/setWebhook
#    url=$APP_URL/api/telegram/webhook, secret_token=<webhook-secret>
```

Pilot limitations on Fly (be honest about them): until the durable
Shopflow-backed stores (blocker 2 in section 5) are implemented, set
`TELEGRAM_STORE_MODE=memory` **only** for a small pilot — subscriptions and
dialog state live in one machine's RAM and are lost on restart/redeploy, so
this is not production storage. Reminders additionally need the live MoySklad
adapter (blocker 3); the cron endpoint refuses mock mode by design.

Scheduler: `.github/workflows/telegram-reminders.yml` triggers
`/api/cron/telegram-reminders` daily at 09:00 Tashkent via GitHub Actions
(repo secrets `APP_URL` + `TELEGRAM_CRON_SECRET`). Fly has no managed cron
with exact times (scheduled machines fire on creation-relative intervals),
and any external scheduler hitting the same bearer-authenticated endpoint
works equally well.

## 3. Register the HTTPS webhook

The endpoint is `POST https://<portal-host>/api/telegram/webhook`
(ports 443/80/88/8443 per Bot API docs). Register it once from a machine that
holds the secrets (never from the browser):

```bash
curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'content-type: application/json' \
  -d "{
    \"url\": \"https://<portal-host>/api/telegram/webhook\",
    \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\",
    \"allowed_updates\": [\"message\", \"callback_query\"]
  }"
# {"ok":true,"result":true,"description":"Webhook was set"}
```

> If the webhook was registered earlier with `["message"]` only, re-run
> `setWebhook` with the command above — otherwise Telegram never delivers
> the admin approve/reject button presses (`callback_query`).

Every webhook call carries `X-Telegram-Bot-Api-Secret-Token`, verified with
a timing-safe compare; wrong/missing secrets get HTTP 401. After validation
the handler always answers 200 (linking is single-use idempotent), so
Telegram stops retrying. To rotate: set a new `secret_token`, update the
deployment secret, then remove the old one. To disable: `setWebhook` with an
empty `url`.

## 4. Connect the scheduler (real cron, not page views)

Reminders are produced only by the authenticated scheduler endpoint —
visiting pages never triggers Telegram sends.

```bash
# runs e.g. daily 09:00 Asia/Tashkent + Fridays; any external scheduler works
curl -s -X POST https://<portal-host>/api/cron/telegram-reminders \
  -H "authorization: Bearer ${TELEGRAM_CRON_SECRET}"
# {"ok":true,"summary":{"subscriptions":N,"sent":M,"skippedAlreadySent":K,...}}
```

- GET and POST are both accepted (Vercel Cron uses GET).
- Missing/wrong bearer → HTTP 401. There is no unauthenticated job path.
- Recommended cadence: once daily. Weekly conditions self-limit to one
  message per week; order events are idempotent per status.

## 5. Production blockers (must resolve before any live send)

1. **Shopflow session verifier** (`src/lib/auth/access.ts` currently throws).
   `/api/telegram/link-code` returns `503 auth-unconfigured` until then; the
   demo role switcher can never mint codes. (Phone onboarding does not need
   portal sessions, but reminders still need blockers 2–4.)
2. **Durable Shopflow-backed Telegram stores** — implement
   `TelegramSubscriptionStore`, `TelegramDeliveryLog`, `TelegramLinkStore`
   and `TelegramDialogStore` against verified Shopflow persistence and wire
   them in `getTelegramStores()`. The in-memory stores are for tests/local
   dry runs only.
3. **Live MoySklad adapter + status mapping** — the cron route refuses
   `MOYSKLAD_MODE=mock` (demo records must never reach real chats) and the
   live provider is intentionally unconfigured (see `MOYSKLAD_INTEGRATION.md`).
4. **Durable loyalty settings** — `loyaltySettingsStore` fails closed in live
   mode; demo browser settings must not drive scheduled delivery.
5. **Secrets + webhook + scheduler** per sections 2–4, then verify:
   `/api/telegram/status` → `ready`, `storageReady: true`, `liveDataMode: true`.

## 6. Local verification (no real bot needed)

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- 118 automated Telegram tests use a fake sender + memory stores: fail-closed
  config, secret-free responses, webhook auth, linking lifecycle, phone
  onboarding (contact ownership, auto-link, self-registration, ambiguous and
  failure paths), in-bot admin review (inline buttons, guards, double-press),
  user menu (/profil, /dastur), main menu buttons (/menu: shop, points,
  profile, help), in-bot ShopFlow catalog + ordering (/katalog,
  variants, MOQ, address, confirm, single-order guard, stock/401 paths, live
  promotions), pilot registration (name/company/address/location steps,
  skip, admin approval queue + chat notifications, reject/restart), per-customer
  isolation, unsubscribe, Friday/timezone logic, 80% parity, idempotency,
  429/5xx retry with secret-free logs, mock-mode refusal; plus 13 MoySklad
  contract tests (auth/gzip headers, phone normalization, search/create,
  401/429/5xx mapping, secret-free logs).
- No test uses a real token or network. A mock/fake provider is never
  presented as a live bot.
- The `/company` page shows a Telegram card: in demo it honestly reports
  `disabled/unconfigured` with setup guidance; no secret is rendered.

## 7. Operations notes

- **Rate limits** (~1 msg/s per chat, ~30/s overall; HTTP 429 with
  `parameters.retry_after`): `retry_after` is honored exactly; 5xx/network
  use bounded exponential backoff (5 attempts). Blocked/missing chats are
  deactivated automatically without retries.
- **Logs** contain method names, chat ids, error codes and safe descriptions
  only — token-bearing URLs and secrets are redacted.
- **Manager scope** is snapshotted at link time; ask managers to re-link (`/stop`, then a fresh code) after assignment changes.
- **Privacy**: linking binds a chat to exactly one verified subject/scope;
  clients cannot receive another company's data; unsubscribe is one command.
- **Message length** is capped at the Bot API 4096-character limit; texts are
  plain (no `parse_mode`), so names can never inject formatting.

## 8. Troubleshooting (learned during pilot setup)

- **`chat not found` on send**: the bot is not a member of that chat. Add the
  bot to the admin group first, then re-test with a direct `sendMessage` call
  before touching app code.
- **`404 Not Found` from Bot API**: the token in the URL is wrong (often the
  literal placeholder `BOT_TOKEN`). Get the real token from @BotFather
  (`/token` → pick the bot).
- **`secret token contains illegal characters`**: the webhook secret must use
  only `A-Z a-z 0-9 _ -`. Generate with `openssl rand -hex 32` (hex is always
  legal); base64 secrets (`+ / =`) are rejected by Telegram.
- **Application invisible in panel after deploy/secrets change**: pilot stores
  are in-memory — any machine restart wipes them. Re-register after deploy.
- **Buttons do nothing**: the webhook was registered without `callback_query`
  in `allowed_updates`. Re-run `setWebhook` with `["message","callback_query"]`.
