# Scheduling App — Calendly Alternative

A professional scheduling PWA that replaces Calendly by booking meetings directly into Google Calendar with automatic Google Meet links.

## Features

- **Monthly calendar** to select a date
- **30 or 60-minute slots** based on configurable working hours (09:00–18:00 Israel time)
- **Busy-slot filtering** — pulls existing events from your Google Calendar
- **Automatic Google Meet link** on every booking
- **Timezone-aware** — visitors see times in their local timezone
- **Booking form** with name, email, and meeting subject
- **Confirmation screen** with "Add to Calendar" (.ics) and "Copy Meet Link"
- **Telegram bot** — book meetings directly in Telegram
- **REST API** — integrate with any other app (Wix Velo, webhooks, etc.)
- **Wix iframe** — embed directly in your Wix site
- **Supabase** — booking records stored for admin review

---

## Architecture

```
Browser (React PWA)
    ├── GAS API  →  Google Apps Script  →  Google Calendar
    └── Supabase JS client  →  Supabase (booking log)

Express.js (Railway)
    ├── Serves React build (dist/)
    └── /api/* REST proxy (requires X-Api-Key)

Telegram Bot (Railway — separate process)
    └── Uses /api/* endpoints internally
```

---

## Quick Start (Local Development)

```bash
cd scheduling-app
cp .env.example .env          # fill in your values
npm install
npm run dev                   # http://localhost:5173
```

---

## Deployment on Railway

1. Push this repo to GitHub (`syncpartners1/scheduler-google`)
2. Create a new Railway project → **Deploy from GitHub repo**
3. Set environment variables (copy from `.env.example`)
4. Railway auto-builds and deploys on every push

The `railway.toml` configures the build and start commands automatically.

### Running the Telegram Bot

Railway supports multiple processes. The `Procfile` defines:
- `web` — Express server (main app)
- `bot` — Telegram bot

Both start automatically on Railway when you deploy.

---

## Google Apps Script Setup

See `gas/Code.gs` for full inline setup instructions.

**Short version:**
1. Go to https://script.google.com → New project
2. Paste `gas/Code.gs` content
3. Set `OWNER_CALENDAR_ID` to your Gmail address
4. Enable **Google Calendar API** (Extensions → Services)
5. Deploy → New deployment → **Web App** (Execute as: Me, Access: Anyone)
6. Copy the Web App URL → set as `VITE_GAS_URL` and `GAS_URL` in Railway

---

## Supabase Setup

Run `supabase/migrations/001_create_bookings.sql` in your Supabase SQL Editor.

The table stores booking records with Row Level Security:
- **Anon** can INSERT (the React app uses the anon key)
- **Authenticated** (admin) can SELECT

---

## REST API

All `/api/*` endpoints require `X-Api-Key: YOUR_API_KEY` header.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/slots?date=YYYY-MM-DD&tz=...&duration=30` | Available slots |
| `POST` | `/api/book` | Create a booking |

**POST /api/book body:**
```json
{
  "name": "Jane Smith",
  "email": "jane@example.com",
  "subject": "Product demo",
  "startISO": "2024-01-15T10:00:00.000Z",
  "duration": 30,
  "userTz": "America/New_York",
  "requestId": "optional-idempotency-key"
}
```

---

## Wix Iframe Integration

Add an **HTML Embed** element to your Wix page:

```html
<iframe
  src="https://YOUR-APP.railway.app?embed=true"
  width="100%"
  height="700px"
  style="border: none;"
  allow="clipboard-write"
></iframe>
```

The app detects the `embed=true` param and switches to a compact layout without header/footer.

On successful booking, it fires a `postMessage` to the parent Wix page:
```js
// In your Wix Velo code:
window.addEventListener('message', (e) => {
  if (e.data.type === 'BOOKING_SUCCESS') {
    console.log('Booking confirmed:', e.data.booking)
  }
})
```

---

## Telegram Bot

1. Create a bot via [@BotFather](https://t.me/BotFather) → `/newbot`
2. Copy the token → set `TELEGRAM_BOT_TOKEN` env var
3. Set `SERVER_URL` to your Railway app URL

Users chat with your bot:
- `/start` or `/book` — begin booking flow
- Pick date → pick duration → pick time slot → enter details → confirmation

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `VITE_GAS_URL` | Yes | GAS Web App URL (Vite build) |
| `GAS_URL` | Yes | GAS Web App URL (server-side) |
| `VITE_SUPABASE_URL` | Optional | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Optional | Supabase anon key |
| `VITE_OWNER_NAME` | Optional | Your name (shown in header) |
| `API_KEY` | Recommended | Protects `/api/*` endpoints |
| `TELEGRAM_BOT_TOKEN` | Optional | Enable Telegram bot |
| `SERVER_URL` | If using bot | Public Railway URL for bot→API calls |
| `AICOACH_URL` | For coaching | Base URL of the AICOACH service (coaching bridge) |
| `AICOACH_BRIDGE_SECRET` | For coaching | Must match `TELEGRAM_BRIDGE_SECRET` on AICOACH |
| `ADMIN_TELEGRAM_ID` | For coaching | Telegram user ID allowed to use admin commands |

---

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

Cloud Scheduler is not used: this application is request-driven, not a cron job.
The optional Telegram bot still uses long polling and is not started by the Cloud
Run web image. Move it to Telegram webhooks before retiring a live Railway bot.

## Telegram coaching mode (consolidated bot)

This bot is the single Telegram front door: registration, booking, and AI
coaching. Coaching conversations are proxied to the AICOACH service through
its internal bridge API (`/internal/telegram/*`, `X-Bridge-Secret` auth), so
the coaching engine, session state, and history stay in AICOACH's Postgres.

User commands: `/coach` (or `/newsession`) start a session, free text chats,
`/done` ends it with a summary, `/message` texts the human coach. Admin
commands (gated by `ADMIN_TELEGRAM_ID`): `/users`, `/report <query>`,
`/invite [name] [contact]`, `/broadcast <text>`; replying to a forwarded
user message routes the reply back to that user.

Cloud Run deploy needs two extra secrets (`SCHEDULER_GOOGLE_AICOACH_BRIDGE_SECRET`,
`SCHEDULER_GOOGLE_ADMIN_TELEGRAM_ID`) and the `AICOACH_URL` env var. The request
timeout is 300s because coaching LLM turns can exceed 30s.

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
