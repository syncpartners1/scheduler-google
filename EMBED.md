# Scheduler Embed Guide

## Booking Page URL

**Direct link:** `https://abn-sch.up.railway.app`

Use this URL anywhere you want to send people to book a meeting.

### URL Parameters

| Parameter | Values | Effect |
|-----------|--------|--------|
| `lang` | `en` (default) / `he` | Pre-select language |
| `type` | see below | Pre-select meeting type |
| `embed` | `true` | Forces embed mode (no header/footer) |

**Meeting type IDs for `?type=`:**

| `?type=` | Meeting |
|----------|---------|
| `intro_30` | Introduction 30 min *(default)* |
| `general_30` | 30 min General |
| `virtual_30` | 30 min Virtual |
| `general_60` | 60 min General |
| `coaching_60` | 60 min Coaching / Advisory |

### Example Links

```
# Hebrew, intro meeting (website default)
https://abn-sch.up.railway.app?lang=he&type=intro_30

# English, coaching session
https://abn-sch.up.railway.app?type=coaching_60

# Hebrew, embedded in iframe
https://abn-sch.up.railway.app?lang=he&embed=true
```

---

## Embedding in Wix

### Step 1 — Add an HTML iframe element

1. In Wix Editor, click **Add** → **Embed** → **Embed a Widget** (or **HTML iframe**)
2. Drag it onto your page and resize it (recommended: **600 px wide × 820 px tall** or wider)

### Step 2 — Paste the embed code

Click **Enter Code** and paste:

```html
<iframe
  src="https://abn-sch.up.railway.app?embed=true&lang=he"
  width="100%"
  height="820"
  frameborder="0"
  scrolling="no"
  allow="clipboard-write"
  title="Book a meeting with Adi Ben-Nesher"
  style="border:none;border-radius:16px;">
</iframe>
```

Change `lang=he` to `lang=en` for English, or remove the parameter for the toggle to be visible.

### Step 3 — Add a "Book a Meeting" button on other pages

In Wix, add a Button element and set its link to:

```
https://abn-sch.up.railway.app?lang=he&type=intro_30
```

This opens the booking page in a new tab (or the same tab) directly pre-set to the Introduction meeting.

---

## Admin Dashboard

Access the booking admin panel at:

```
https://abn-sch.up.railway.app/admin-bookings
```

Log in with the `API_KEY` environment variable value set in Railway.

**Admin capabilities:**
- View all upcoming bookings
- Cancel a meeting (deletes the Google Calendar event)
- Reschedule a meeting — pick a new date and time; the old event is cancelled and a new one is created automatically

> **Note:** The "View all bookings" feature requires adding a `getAllBookings` action to your
> Google Apps Script. See the GAS setup section below.

---

## GAS Script — Required Actions

Your Google Apps Script needs to handle the following `action` values sent via POST/GET:

| Action | Method | Description |
|--------|--------|-------------|
| `getBusySlots` | GET | Returns `{busySlots:[{start,end}]}` for a given date |
| `createEvent` | POST | Creates calendar event, returns `{ok,meetLink,eventId,startISO,endISO}` |
| `cancelEvent` | POST | Deletes event by `eventId`, returns `{ok}` |
| `getBookings` | GET | Returns bookings for an `email`, returns `{ok,bookings:[...]}` |
| `getAllBookings` | GET | *(New)* Returns all upcoming bookings, returns `{ok,bookings:[...]}` |

Each booking object should include:
```json
{
  "eventId": "...",
  "name": "Jane Smith",
  "email": "jane@example.com",
  "subject": "Discussion topic",
  "startISO": "2026-03-20T10:00:00.000Z",
  "endISO": "2026-03-20T10:30:00.000Z",
  "duration": 30,
  "meetLink": "https://meet.google.com/...",
  "meetingTypeId": "intro_30",
  "meetingTypeLabel": "Introduction",
  "locationMode": "virtual",
  "location": ""
}
```

---

## Environment Variables (Railway)

| Variable | Required | Description |
|----------|----------|-------------|
| `GAS_URL` | ✅ | Google Apps Script Web App URL |
| `API_KEY` | ✅ | Secret for `/api/*` and admin dashboard |
| `VITE_GAS_URL` | ✅ | Same URL, used at build time for the React app |
| `VITE_OWNER_NAME` | ✅ | Displayed in the booking page header |
| `VITE_OWNER_PHOTO_URL` | optional | URL or path to the owner's photo (default: `/adi.jpg`) |
| `PORT` | auto | Set automatically by Railway |

> To use `/adi.jpg` as the photo, place the image file in the `public/` folder
> before running `npm run build`.

---

## Photo Setup

The booking page header displays the owner's photo. To use the provided photo:

1. Save the image file as `public/adi.jpg` in the project root
2. Run `npm run build` — Vite will copy it to `dist/adi.jpg`
3. Deploy to Railway — the photo will be served at `/adi.jpg`

Alternatively, set `VITE_OWNER_PHOTO_URL` to any public image URL (e.g. hosted on Wix Media).
