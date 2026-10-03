# Scheduler: Change Navigator booking, registration and Telegram bot

Booking app that books meetings straight into Google Calendar with a Google Meet link,
plus the Telegram bot `@Change_navigator_bot` and passkey registration. It runs on
Google Cloud. It replaces Calendly.

## What it does

- Monthly calendar, 30 or 60 minute slots, busy slots read from the Google Calendar
- Booking form (name, email, subject), Meet link on every booking, `.ics` download
- Client coaching meetings are limited to approved windows and holidays (`availability.js`).
  The owner's own calendar stays open
- Hebrew and English UI, URL parameters `lang`, `type`, `embed` (see `EMBED.md`)
- Telegram bot: registration, booking, AI coaching through AICOACH, lead capture
- Passwordless registration with passkeys (WebAuthn)
- Booking notification emails sent from this service, with a durable outbox
- REST API for other apps

## Architecture

```
Browser (React PWA, built into dist/)
    |
    v
Cloud Run service "scheduler-google" (me-west1, Express, scale to zero)
    |-- serves the React build and /api/*
    |-- /telegram/<secret path>   Telegram webhook (secret header checked)
    |-- passkey registration and /register, /passkey/continue
    |-- Google Apps Script web app --> Google Calendar (navigator.change@gmail.com)
    |                              --> Google Sheet (booking log)
    |-- Firestore: users, passkeys, authFlows, telegramBotSessions,
    |              telegramLeads, bookingNotificationOutbox
    |-- AICOACH (https://app.changenavigator.co.il), internal bridge /internal/telegram/*
    |-- ClickUp (lead tasks), Brevo (email)
```

- Public hosts: `auth.changenavigator.co.il` is the WebAuthn origin (registration and
  passkeys). `meet.changenavigator.co.il` is the public booking link and redirects to the
  booking page.
- The Telegram bot runs inside the same Cloud Run service through a webhook. There is
  no separate bot process.
- Calendar logic stays in Google Apps Script (`gas/Code.gs`). It is not rewritten.
- Supabase is not used. Bookings are logged to a Google Sheet by the script.
- Railway is retired. The old Railway instance is off.

## Local development

```bash
cp .env.example .env     # fill in your values
npm install
npm run dev              # Vite on http://localhost:5173
npm start                # Express server (needs a built dist/)
```

Tests are the `*.test.mjs` files in the repo root and run with `node --test`.

## Google Apps Script

See `gas/Code.gs` for the inline setup notes.

1. Open https://script.google.com signed in as `navigator.change@gmail.com`
2. Paste `gas/Code.gs`
3. Enable the Advanced Calendar service (Services in the editor) and authorize it
4. Deploy > New deployment > Web app (Execute as: Me, Access: Anyone)
5. Save the `/exec` URL in the Secret Manager secret `SCHEDULER_GOOGLE_GAS_URL`

The Google Sheet used as booking log must be shared with `navigator.change@gmail.com`
as Editor, or logging fails silently. `testSheetAccess` in the script checks this.

When you change a production function, create a new version of the existing
deployment so the `/exec` URL stays the same.

## REST API

Endpoints under `/api/*` that need a key take the header `X-Api-Key: <API_KEY>`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/health` | none | Liveness check (used by the deploy workflow) |
| `GET` | `/api/slots?date=YYYY-MM-DD&tz=...&duration=30` | key | Available slots |
| `POST` | `/api/book` | key | Create a booking |
| `POST` | `/api/cancel` | key | Cancel a booking |
| `GET` | `/api/bookings` | key | List bookings |
| `GET` | `/api/public/slots` | none | Slots for the public booking page |
| `POST` | `/api/public/book` | none | Booking from the public page |
| `GET` | `/api/admin/bookings` | key | Admin booking list |
| `POST` | `/api/admin/reschedule` | key | Admin reschedule |
| `POST` | `/api/admin/booking-notifications/drain` | key | Send pending booking emails (called by a Cloud Scheduler job every 5 minutes) |

`POST /api/book` body:

```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "subject": "Product demo",
  "startISO": "2026-01-15T10:00:00.000Z",
  "duration": 30,
  "userTz": "America/New_York",
  "requestId": "optional-idempotency-key"
}
```

## Wix iframe

Embed the booking page with an HTML Embed element. Use the current booking link,
not the old Railway address:

```html
<iframe
  src="https://meet.changenavigator.co.il/?embed=true"
  width="100%"
  height="700px"
  style="border: none;"
  allow="clipboard-write"
></iframe>
```

With `embed=true` the app drops the header and footer. After a booking it sends a
`postMessage` to the parent page:

```js
window.addEventListener('message', (e) => {
  if (e.data.type === 'BOOKING_SUCCESS') {
    console.log('Booking confirmed:', e.data.booking)
  }
})
```

## Environment variables

Secrets come from Secret Manager in production (see the deploy section).
Do not put real values in the repo.

| Variable | Source in production | Description |
|----------|----------------------|-------------|
| `GAS_URL` | secret | Apps Script web app URL, server side |
| `VITE_GAS_URL` | local only | Same URL for the Vite build when developing |
| `API_KEY` | secret | Protects `/api/*` endpoints that need a key |
| `TELEGRAM_BOT_TOKEN` | secret | Telegram bot token |
| `TELEGRAM_WEBHOOK_PATH` | secret | Secret path of the webhook |
| `TELEGRAM_WEBHOOK_SECRET` | secret | Checked against `X-Telegram-Bot-Api-Secret-Token` |
| `BREVO_API_KEY` | secret | Sends booking and registration emails |
| `AICOACH_BRIDGE_SECRET` | secret | Must match `TELEGRAM_BRIDGE_SECRET` on AICOACH |
| `ADMIN_TELEGRAM_ID` | secret | Telegram ID allowed to use admin commands |
| `CLICKUP_API_TOKEN` | secret `CLICKUP_API_KEY` | Creates lead tasks |
| `CLICKUP_LEAD_LIST_ID` | GitHub Actions variable | ClickUp List that receives leads |
| `AICOACH_URL` | env | `https://app.changenavigator.co.il` |
| `WEBAUTHN_RP_ID` | env | `changenavigator.co.il` |
| `WEBAUTHN_ORIGIN` | env | `https://auth.changenavigator.co.il` |
| `SERVER_URL` | env | Internal URL the bot uses to call `/api/*` (`http://127.0.0.1:8080` on Cloud Run) |
| `VITE_GOOGLE_MAPS_API_KEY` | build secret | Places autocomplete in the browser. Restrict by HTTPS referrer |
| `VITE_OWNER_NAME` | optional | Name shown in the header |

## Constraints & Edge Cases

| Constraint | Where handled |
|-----------|---------------|
| 2-hour minimum notice | Front-end filter + GAS validation |
| 15-min buffer around events | GAS `getBusySlots` expands each event ±15 min |
| No double-booking | GAS conflict check before `createEvent` |
| Idempotent booking | GAS checks `requestId` in event description |
| Email validation | Front-end regex + GAS validation |
| `sendUpdates: 'all'` | GAS sends Google Calendar invite to both parties |

## Deployment on GCP Cloud Run

Production deploys from `main` through `.github/workflows/deploy-gcp.yml` using
GitHub Workload Identity Federation. The workflow builds the React application,
pushes the image to Artifact Registry, and deploys the public `scheduler-google`
Cloud Run service in `me-west1` with scale-to-zero enabled.

Required Secret Manager secrets:

| Secret | Used as | Notes |
|---|---|---|
| `SCHEDULER_GOOGLE_API_KEY` | `API_KEY` | Protects admin and REST endpoints |
| `SCHEDULER_GOOGLE_GAS_URL` | `GAS_URL` | Apps Script web-app deployment URL |
| `SCHEDULER_GOOGLE_MAPS_API_KEY` | Vite build value | Restrict by HTTPS referrer because browser clients can see it |

The existing `scheduler-sa@change-navigator-abn.iam.gserviceaccount.com` is the
Cloud Run runtime identity. It needs Secret Manager Secret Accessor only on the
first two secrets. The GitHub deploy identity needs access to the Maps-key secret
at build time.

The calendar operations still run in Google Apps Script, as the Google user who
deployed that web app. Deploy `gas/Code.gs` while signed in as
`navigator.change@gmail.com`, enable the Advanced Calendar service, authorize it,
and save the resulting `/exec` URL in `SCHEDULER_GOOGLE_GAS_URL`.

Cloud Scheduler has one job: it calls `/api/admin/booking-notifications/drain` every
5 minutes to send booking emails that are still pending. The rest of the app is
request driven. The Telegram bot uses webhooks, not long polling, so scale to zero is safe.

## Telegram coaching mode (consolidated bot)

This bot is the single Telegram front door: registration, booking, and AI
coaching. Coaching conversations are proxied to the AICOACH service through
its internal bridge API (`/internal/telegram/*`, `X-Bridge-Secret` auth), so
the coaching engine, session state, and history stay in AICOACH's Postgres.

`/start` shows a Hebrew coaching entry screen based on the Firestore registration profile.
Registered users start or resume a coaching session and can choose the existing booking flow. Visitors
can begin registration or submit a lead for a virtual meeting/intro call. The bot
asks for a name and the visitor's own Telegram contact, creates a ClickUp task,
and sends Adi a Telegram alert. No appointment is booked. If ClickUp times out
after submission, the lead is flagged for manual review instead of retried.

User commands: `/coach` (or `/newsession`) start a session, free text chats,
`/done` ends it with a summary, `/message` texts the human coach. Admin
commands (gated by `ADMIN_TELEGRAM_ID`): `/users`, `/report <query>`,
`/invite [name] [contact]`, `/broadcast <text>`; replying to a forwarded
user message routes the reply back to that user.

Cloud Run deploy needs two extra secrets (`SCHEDULER_GOOGLE_AICOACH_BRIDGE_SECRET`,
`SCHEDULER_GOOGLE_ADMIN_TELEGRAM_ID`) and the `AICOACH_URL` env var. The request
timeout is 300s because coaching LLM turns can exceed 30s.

The full Hebrew Telegram command menu is installed separately after deployment
without changing the webhook:

```bash
TELEGRAM_BOT_TOKEN=... ADMIN_TELEGRAM_ID=... npm run telegram:set-commands
```

`ADMIN_TELEGRAM_ID` is optional for normal users but needed to publish the
admin-only commands to Adi's private Telegram chat. Do not paste the token in
logs or a chat. Deployment does not automatically update the menu.

Lead setup: use existing Secret Manager secret `CLICKUP_API_KEY`
(project `change-navigator-abn`). Grant `scheduler-sa` Secret Accessor on it,
set GitHub Actions repository variable `CLICKUP_LEAD_LIST_ID` to the chosen
ClickUp List ID, and deploy from main. The workflow injects
`CLICKUP_API_TOKEN` and `CLICKUP_LEAD_LIST_ID` into Cloud Run. A Space ID
alone is not enough for task creation. Confirm the exact destination List
before deploy. A ClickUp task records name, phone, request type and Telegram
ID; task link is included in the admin message when ClickUp returns one.
Firestore collection `telegramLeads` stores a submission status and task ID
for duplicate prevention and later reconciliation; grant the runtime identity
Firestore access as with the existing `telegramBotSessions` collection.

## Telegram webhook and passwordless registration

Production receives Telegram updates at `POST /telegram/$TELEGRAM_WEBHOOK_PATH`. Telegram must also send the matching `X-Telegram-Bot-Api-Secret-Token` header. Register the webhook once after `auth.changenavigator.co.il` is mapped and the new revision is healthy:

```bash
TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_PATH=... TELEGRAM_WEBHOOK_SECRET=... \
WEBAUTHN_ORIGIN=https://auth.changenavigator.co.il npm run telegram:set-webhook
```

Registration is passwordless. The bot collects the user's own contact with Telegram's native contact-share button. The Mini App validates Telegram `initData` server-side, verifies email through Brevo, proves phone ownership through Telegram native own-contact share, and creates a WebAuthn passkey scoped to RP ID `changenavigator.co.il`. Everyday login uses the passkey only; email and phone verification are repeated only for account recovery.

Firestore stores users, passkeys, temporary auth flows, and bot sessions. Configure Firestore TTL on `authFlows.expiresAt` and `telegramBotSessions.expiresAt`.

### External-browser passkey handoff

Telegram Mini Apps do not reliably expose WebAuthn. After email and native-contact verification, registration opens a single-use external-browser link on `auth.changenavigator.co.il` to create the passkey in Safari or Chrome. The opaque handoff token is random; Firestore stores only its SHA-256 hash, binds it to the verified Telegram registration flow, and expires it after five minutes. Successful passkey verification atomically creates the user/passkey and deletes both the registration flow and handoff.

Enable Firestore TTL on `passkeyHandoffs.expiresAt` in addition to the existing auth-flow and bot-session TTL policies:

```bash
gcloud firestore fields ttls update expiresAt \
  --project=change-navigator-abn \
  --database='(default)' \
  --collection-group=passkeyHandoffs \
  --enable-ttl
```
