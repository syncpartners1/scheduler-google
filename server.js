/**
 * Express server for the Scheduling App.
 *
 * Responsibilities:
 *  1. Serve the React production build (dist/)
 *  2. Expose a REST API so external apps (Telegram, Wix, other services)
 *     can query availability and create bookings without the browser UI.
 *
 * Environment variables:
 *  PORT           – HTTP port (Railway sets this automatically)
 *  GAS_URL        – Google Apps Script Web App URL (server-side calls)
 *  API_KEY        – Secret key for /api/* access (X-Api-Key header)
 *  ALLOWED_ORIGIN – Comma-separated origins for CORS (optional, defaults to *)
 */

import express           from 'express'
import { createServer }  from 'http'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import fetch             from 'node-fetch'

const __dirname = dirname(fileURLToPath(import.meta.url))
const app       = express()
const PORT      = process.env.PORT || 3000
const GAS_URL   =
  process.env.GAS_URL ||
  process.env.VITE_GAS_URL ||
  'https://script.google.com/macros/s/AKfycbxVe7r1QIZus4kwPlWk5T6ntKO8ebAtouz6dQzRuVgVd1bhbQMX5ZbQteJIORhv0LLB/exec'
const API_KEY   = process.env.API_KEY || ''

// ── Slot generation (mirrors src/utils/timeSlots.js) ────────────────────────

const OWNER_TZ       = 'Asia/Jerusalem'
const WORKING_HOURS  = { start: 9, end: 21 }
const BUFFER_MINS    = 15
const MIN_NOTICE_HRS = 2

function pad(n) { return String(n).padStart(2, '0') }

/** Parse 'YYYY-MM-DDTHH:MM:SS' as if it's in the given IANA timezone */
function parseInTz(localStr, tz) {
  const approxUtc = new Date(localStr + 'Z')
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(approxUtc)
  const get  = (t) => parts.find(p => p.type === t)?.value || '00'
  const tzStr = `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`
  const diff  = approxUtc - new Date(tzStr + 'Z')
  return new Date(approxUtc.getTime() + diff)
}

/** Format a UTC Date as "9:00 AM" in the given IANA timezone */
function formatInTz(date, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(date)
}

/**
 * Compute available slots for a date given a list of busy blocks.
 * @param {string} dateStr   - 'YYYY-MM-DD'
 * @param {Array}  busySlots - [{start: ISO, end: ISO}] already buffered by GAS
 * @param {string} userTz    - IANA timezone for slot labels
 * @param {number} duration  - minutes (30 or 60)
 */
function generateAvailableSlots(dateStr, busySlots, userTz, duration) {
  const slots   = []
  const now     = new Date()
  const cutoff  = new Date(now.getTime() + MIN_NOTICE_HRS * 60 * 60 * 1000)

  const workStart = parseInTz(`${dateStr}T${pad(WORKING_HOURS.start)}:00:00`, OWNER_TZ)
  const workEnd   = parseInTz(`${dateStr}T${pad(WORKING_HOURS.end)}:00:00`,   OWNER_TZ)

  // Busy blocks are already buffered by GAS — use them directly.
  const busy = busySlots.map(b => ({
    start: new Date(b.start),
    end:   new Date(b.end),
  }))

  let cursor = new Date(workStart)
  while (cursor < workEnd) {
    const slotEnd = new Date(cursor.getTime() + duration * 60 * 1000)
    if (slotEnd > workEnd) break
    if (cursor >= cutoff) {
      const overlaps = busy.some(b => cursor < b.end && slotEnd > b.start)
      if (!overlaps) {
        slots.push({
          start: cursor.toISOString(),
          end:   slotEnd.toISOString(),
          label: formatInTz(cursor, userTz || OWNER_TZ),
        })
      }
    }
    cursor = new Date(cursor.getTime() + 30 * 60 * 1000)
  }
  return slots
}

// ── Middleware ───────────────────────────────────────────────────────────────

app.use(express.json())

// CORS — allow all origins by default (required for Wix iframe + external apps)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Api-Key')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// Remove X-Frame-Options so the app can be embedded as an iframe in Wix
app.use((req, res, next) => {
  res.removeHeader('X-Frame-Options')
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' *.wix.com *.wixsite.com *.editorx.com"
  )
  next()
})

// ── API key auth middleware (applied to /api/* routes) ──────────────────────

function requireApiKey(req, res, next) {
  if (!API_KEY) return next()  // auth disabled if no key set

  const key = req.headers['x-api-key'] || req.query.apiKey
  if (key !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'Invalid or missing API key' })
  }
  next()
}

// ── REST API routes ──────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Quick liveness check.
 */
app.get('/api/health', (req, res) => {
  res.json({ ok: true, status: 'running', ts: new Date().toISOString() })
})

/**
 * GET /api/slots?date=YYYY-MM-DD&tz=America/New_York&duration=30
 *
 * Returns available time slots by proxying to GAS.
 * Protected by X-Api-Key header.
 *
 * Response: { slots: [{start, end, label}] }
 */
app.get('/api/slots', requireApiKey, async (req, res) => {
  const { date, tz = 'UTC', duration = '30' } = req.query

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ ok: false, error: 'date param required (YYYY-MM-DD)' })
  }
  if (!GAS_URL) {
    return res.status(503).json({ ok: false, error: 'GAS_URL not configured' })
  }

  try {
    const params   = new URLSearchParams({ action: 'getBusySlots', date, tz, duration })
    const gasRes   = await fetch(`${GAS_URL}?${params}`)
    const data     = await gasRes.json()
    if (data.error) return res.status(502).json({ ok: false, error: data.error })
    const slots    = generateAvailableSlots(date, data.busySlots || [], tz, Number(duration))
    res.json({ ok: true, slots })
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message })
  }
})

/**
 * POST /api/book
 *
 * Create a booking via GAS.
 * Protected by X-Api-Key header.
 *
 * Body: { name, email, subject, startISO, duration, userTz, requestId? }
 * Response: { ok: true, meetLink, eventId, startISO, endISO }
 */
app.post('/api/book', requireApiKey, async (req, res) => {
  const { name, email, subject, startISO, duration, userTz } = req.body

  if (!name || !email || !startISO || !duration) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: name, email, startISO, duration' })
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'Invalid email address' })
  }
  if (!GAS_URL) {
    return res.status(503).json({ ok: false, error: 'GAS_URL not configured' })
  }

  const requestId = req.body.requestId || `${email}-${startISO}-${Date.now()}`

  try {
    const gasRes = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'createEvent', name, email, subject, startISO, duration, userTz, requestId }),
    })
    const data = await gasRes.json()
    if (!data.ok) return res.status(502).json({ ok: false, error: data.error || 'Booking failed' })
    res.json(data)
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message })
  }
})

/**
 * POST /api/cancel
 *
 * Cancel a previously created booking by its Google Calendar event ID.
 * Protected by X-Api-Key header.
 *
 * Body: { eventId, reason? }
 * Response: { ok: true, eventId }
 */
app.post('/api/cancel', requireApiKey, async (req, res) => {
  const { eventId, reason } = req.body

  if (!eventId) {
    return res.status(400).json({ ok: false, error: 'Missing required field: eventId' })
  }
  if (!GAS_URL) {
    return res.status(503).json({ ok: false, error: 'GAS_URL not configured' })
  }

  try {
    const gasRes = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'cancelEvent', eventId, reason: reason || '' }),
    })
    const data = await gasRes.json()
    if (!data.ok) return res.status(502).json({ ok: false, error: data.error || 'Cancellation failed' })
    res.json(data)
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message })
  }
})

/**
 * GET /api/bookings?email=user@example.com
 *
 * Look up upcoming bookings for an email address.
 * Reads from the Google Sheet via GAS (no Supabase required).
 * Protected by X-Api-Key header.
 *
 * Response: { ok: true, bookings: [{eventId, name, email, subject, startISO, endISO, duration, meetLink}] }
 */
app.get('/api/bookings', requireApiKey, async (req, res) => {
  const { email } = req.query

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, error: 'email param required' })
  }
  if (!GAS_URL) {
    return res.status(503).json({ ok: false, error: 'GAS_URL not configured' })
  }

  try {
    const params  = new URLSearchParams({ action: 'getBookings', email })
    const gasRes  = await fetch(`${GAS_URL}?${params}`)
    const data    = await gasRes.json()
    if (!data.ok) return res.status(502).json({ ok: false, error: data.error || 'Could not fetch bookings' })
    res.json(data)
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message })
  }
})

/**
 * GET /api/admin/bookings
 *
 * List all upcoming bookings (admin only).
 * Calls GAS with action=getAllBookings — requires that action in the GAS script.
 * Protected by X-Api-Key header or ?apiKey= query param.
 */
app.get('/api/admin/bookings', requireApiKey, async (req, res) => {
  if (!GAS_URL) return res.status(503).json({ ok: false, error: 'GAS_URL not configured' })
  try {
    const params = new URLSearchParams({ action: 'getAllBookings' })
    const gasRes = await fetch(`${GAS_URL}?${params}`)
    const data   = await gasRes.json()
    if (!data.ok) return res.status(502).json({ ok: false, error: data.error || 'Could not fetch bookings' })
    res.json(data)
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message })
  }
})

/**
 * POST /api/admin/reschedule
 *
 * Reschedule a meeting: cancel the old event and create a new one.
 * Protected by X-Api-Key header.
 *
 * Body: { eventId, name, email, subject, newStartISO, duration, userTz,
 *         meetingTypeId?, meetingTypeLabel?, locationMode?, location? }
 */
app.post('/api/admin/reschedule', requireApiKey, async (req, res) => {
  const { eventId, name, email, subject, newStartISO, duration, userTz } = req.body
  if (!eventId || !newStartISO || !duration) {
    return res.status(400).json({ ok: false, error: 'Missing required fields: eventId, newStartISO, duration' })
  }
  if (!GAS_URL) return res.status(503).json({ ok: false, error: 'GAS_URL not configured' })

  try {
    // Step 1: cancel existing event
    const cancelRes = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ action: 'cancelEvent', eventId, reason: 'Rescheduled by admin' }),
    })
    const cancelData = await cancelRes.json()
    if (!cancelData.ok) return res.status(502).json({ ok: false, error: `Cancel failed: ${cancelData.error}` })

    // Step 2: create new event
    const requestId = `${email}-${newStartISO}-${Date.now()}`
    const createRes = await fetch(GAS_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        action: 'createEvent',
        name, email, subject,
        startISO:  newStartISO,
        duration,
        userTz:    userTz || 'UTC',
        requestId,
        meetingTypeId:    req.body.meetingTypeId    || '',
        meetingTypeLabel: req.body.meetingTypeLabel || '',
        locationMode:     req.body.locationMode     || 'virtual',
        location:         req.body.location         || '',
      }),
    })
    const createData = await createRes.json()
    if (!createData.ok) return res.status(502).json({ ok: false, error: `Create failed: ${createData.error}` })

    res.json({ ok: true, oldEventId: eventId, newEvent: createData })
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message })
  }
})

/**
 * GET /admin-bookings
 *
 * Admin dashboard to view, cancel, and reschedule meetings.
 * Authenticates client-side with the API_KEY.
 */
app.get('/admin-bookings', (req, res) => {
  const appUrl = process.env.PUBLIC_URL || `http://localhost:${PORT}`
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Bookings Admin – Adi Ben-Nesher</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f4f8;color:#111}
.hdr{background:#1a2b4a;color:#fff;padding:14px 24px;display:flex;align-items:center;gap:12px}
.hdr-title{font-size:17px;font-weight:700}
.container{max-width:1100px;margin:0 auto;padding:24px 16px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:20px}
.section-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;color:#6b7280;margin:24px 0 10px}
table{width:100%;border-collapse:collapse}
thead th{background:#f9fafb;padding:10px 12px;text-align:left;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;border-bottom:1px solid #e5e7eb}
tbody tr:hover{background:#f9fafb}
tbody tr{border-bottom:1px solid #f3f4f6}
td{padding:10px 12px;font-size:13px;vertical-align:middle}
.btn{border:none;padding:4px 10px;border-radius:6px;font-size:11px;font-weight:600;cursor:pointer}
.btn-cancel{background:#fee2e2;color:#991b1b}
.btn-reschedule{background:#e0f2fe;color:#0369a1;margin-right:4px}
.auth-box{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;max-width:420px;margin:40px auto}
.auth-box h2{font-size:16px;font-weight:700;margin-bottom:12px}
.auth-box input{width:100%;padding:10px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:10px}
.auth-box button{width:100%;padding:10px;background:#1a2b4a;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
.badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:8px}
.badge-virtual{background:#e0f2fe;color:#0369a1}
.badge-hybrid{background:#f0fdf4;color:#166534}
.badge-inperson{background:#fef3c7;color:#92400e}
#status{font-size:13px;color:#6b7280;margin-bottom:12px}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:100;align-items:center;justify-content:center}
.modal-overlay.open{display:flex}
.modal{background:#fff;border-radius:16px;padding:24px;width:90%;max-width:440px;box-shadow:0 20px 60px rgba(0,0,0,.2)}
.modal h3{font-size:15px;font-weight:700;margin-bottom:14px}
.modal label{display:block;font-size:12px;font-weight:600;color:#6b7280;margin-bottom:4px}
.modal input,.modal select{width:100%;padding:9px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:13px;margin-bottom:10px}
.modal-btns{display:flex;gap:10px;margin-top:4px}
.modal-btns button{flex:1;padding:10px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer}
.btn-confirm{background:#1a2b4a;color:#fff}
.btn-close{background:#f3f4f6;color:#374151}
.slot-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-height:220px;overflow-y:auto;margin-bottom:10px}
.slot-btn{padding:8px 4px;border:1.5px solid #d1d5db;border-radius:8px;font-size:12px;cursor:pointer;background:#fff}
.slot-btn.selected{border-color:#1a2b4a;background:#1a2b4a;color:#fff}
</style>
</head>
<body>
<div class="hdr">
  <div>
    <div class="hdr-title">Bookings Admin</div>
    <div style="font-size:12px;opacity:.7;margin-top:1px">Adi Ben-Nesher · Scheduler</div>
  </div>
  <button id="logoutBtn" onclick="logout()" style="margin-left:auto;background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3);padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer">Sign Out</button>
</div>

<!-- Auth screen -->
<div id="authScreen" class="container">
  <div class="auth-box">
    <h2>Admin Login</h2>
    <p style="font-size:13px;color:#6b7280;margin-bottom:14px">Enter your API key to access bookings</p>
    <input type="password" id="keyInput" placeholder="API Key" onkeydown="if(event.key==='Enter')login()">
    <button onclick="login()">Sign In</button>
    <p id="authErr" style="color:#dc2626;font-size:12px;margin-top:8px"></p>
  </div>
</div>

<!-- Main screen -->
<div id="mainScreen" class="container" style="display:none">
  <div class="section-title">Upcoming Bookings</div>
  <p id="status">Loading…</p>
  <div class="card">
    <table>
      <thead><tr>
        <th>Name</th><th>Email</th><th>Date & Time</th><th>Type</th><th>Format</th><th>Subject</th><th>Actions</th>
      </tr></thead>
      <tbody id="bookingsBody"><tr><td colspan="7" style="padding:20px;color:#9ca3af;text-align:center">Loading…</td></tr></tbody>
    </table>
  </div>
</div>

<!-- Reschedule modal -->
<div class="modal-overlay" id="rescheduleModal">
  <div class="modal">
    <h3>Reschedule Meeting</h3>
    <div id="modalBookingInfo" style="font-size:12px;color:#6b7280;margin-bottom:14px"></div>
    <label>New Date</label>
    <input type="date" id="modalDate" onchange="loadModalSlots()">
    <label>Available Slots</label>
    <div class="slot-grid" id="slotGrid"><p style="font-size:12px;color:#9ca3af">Pick a date first</p></div>
    <input type="hidden" id="selectedNewSlot">
    <div class="modal-btns">
      <button class="btn-close" onclick="closeModal()">Cancel</button>
      <button class="btn-confirm" onclick="confirmReschedule()">Confirm Reschedule</button>
    </div>
  </div>
</div>

<script>
const API_BASE = '';
let apiKey = '';
let activeBooking = null;

function login() {
  apiKey = document.getElementById('keyInput').value.trim();
  if (!apiKey) return;
  loadBookings();
}

function logout() {
  apiKey = '';
  document.getElementById('authScreen').style.display = '';
  document.getElementById('mainScreen').style.display  = 'none';
  document.getElementById('logoutBtn').style.display   = 'none';
  document.getElementById('keyInput').value = '';
}

async function loadBookings() {
  try {
    const res  = await fetch(API_BASE + '/api/admin/bookings', { headers: { 'X-Api-Key': apiKey } });
    if (res.status === 401) { document.getElementById('authErr').textContent = 'Invalid API key.'; return; }
    const data = await res.json();
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('mainScreen').style.display  = '';
    document.getElementById('logoutBtn').style.display   = '';
    renderBookings(data.bookings || []);
  } catch (e) {
    document.getElementById('authErr').textContent = 'Connection error: ' + e.message;
  }
}

function renderBookings(bookings) {
  const tbody  = document.getElementById('bookingsBody');
  const status = document.getElementById('status');
  if (!bookings.length) {
    tbody.innerHTML  = '<tr><td colspan="7" style="padding:20px;color:#9ca3af;text-align:center">No upcoming bookings found.<br><small>Note: requires getAllBookings action in the GAS script.</small></td></tr>';
    status.textContent = '';
    return;
  }
  status.textContent = bookings.length + ' upcoming booking(s)';
  tbody.innerHTML = bookings.map(b => {
    const fmt    = b.locationMode || 'virtual';
    const badge  = fmt === 'in_person' ? 'badge-inperson' : fmt === 'hybrid' ? 'badge-hybrid' : 'badge-virtual';
    const fmtLbl = fmt === 'in_person' ? '📍 In-Person' : fmt === 'hybrid' ? '🔀 Hybrid' : '🎥 Virtual';
    const dt     = b.startISO ? new Date(b.startISO).toLocaleString('en-IL', { timeZone:'Asia/Jerusalem', dateStyle:'medium', timeStyle:'short' }) : '—';
    return \`<tr>
      <td style="font-weight:600">\${esc(b.name||'—')}</td>
      <td style="color:#6b7280">\${esc(b.email||'—')}</td>
      <td style="white-space:nowrap">\${dt}</td>
      <td>\${esc(b.meetingTypeLabel||b.duration+'min'||'—')}</td>
      <td><span class="badge \${badge}">\${fmtLbl}</span></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="\${esc(b.subject||'')}">
        \${esc(b.subject||'—')}</td>
      <td style="white-space:nowrap">
        <button class="btn btn-reschedule" onclick="openReschedule(\${JSON.stringify(b).replace(/"/g,'&quot;')})">Reschedule</button>
        <button class="btn btn-cancel"     onclick="cancelBooking('\${esc(b.eventId||'')}','\${esc(b.name||'')}')">Cancel</button>
      </td>
    </tr>\`;
  }).join('');
}

async function cancelBooking(eventId, name) {
  if (!eventId) return alert('No event ID for this booking.');
  if (!confirm('Cancel meeting for ' + name + '?\\nThis will delete the Google Calendar event.')) return;
  const res  = await fetch(API_BASE + '/api/cancel', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body:    JSON.stringify({ eventId, reason: 'Cancelled by admin' }),
  });
  const data = await res.json();
  if (data.ok) { alert('Meeting cancelled.'); loadBookings(); }
  else alert('Error: ' + (data.error || 'unknown'));
}

function openReschedule(booking) {
  activeBooking = booking;
  const dt = booking.startISO ? new Date(booking.startISO).toLocaleString('en-IL',{timeZone:'Asia/Jerusalem'}) : '—';
  document.getElementById('modalBookingInfo').textContent = booking.name + ' — ' + dt;
  // set min date to today
  const today = new Date().toISOString().slice(0,10);
  document.getElementById('modalDate').min   = today;
  document.getElementById('modalDate').value = '';
  document.getElementById('slotGrid').innerHTML = '<p style="font-size:12px;color:#9ca3af">Pick a date first</p>';
  document.getElementById('selectedNewSlot').value = '';
  document.getElementById('rescheduleModal').classList.add('open');
}

function closeModal() {
  document.getElementById('rescheduleModal').classList.remove('open');
  activeBooking = null;
}

async function loadModalSlots() {
  if (!activeBooking) return;
  const date     = document.getElementById('modalDate').value;
  const duration = activeBooking.duration || 30;
  const grid     = document.getElementById('slotGrid');
  grid.innerHTML = '<p style="font-size:12px;color:#9ca3af">Loading…</p>';
  document.getElementById('selectedNewSlot').value = '';
  try {
    const params = new URLSearchParams({ date, tz: 'Asia/Jerusalem', duration });
    const res    = await fetch(API_BASE + '/api/slots?' + params, { headers: { 'X-Api-Key': apiKey } });
    const data   = await res.json();
    const slots  = data.slots || [];
    if (!slots.length) { grid.innerHTML = '<p style="font-size:12px;color:#9ca3af">No slots available</p>'; return; }
    grid.innerHTML = slots.map(s =>
      \`<button class="slot-btn" data-iso="\${s.start}" onclick="selectSlot(this)">\${
        new Date(s.start).toLocaleTimeString('en-IL',{timeZone:'Asia/Jerusalem',hour:'2-digit',minute:'2-digit'})
      }</button>\`
    ).join('');
  } catch (e) {
    grid.innerHTML = '<p style="font-size:12px;color:#dc2626">Error loading slots</p>';
  }
}

function selectSlot(btn) {
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  document.getElementById('selectedNewSlot').value = btn.dataset.iso;
}

async function confirmReschedule() {
  const newStartISO = document.getElementById('selectedNewSlot').value;
  if (!newStartISO) return alert('Please select a new time slot.');
  if (!activeBooking || !activeBooking.eventId) return alert('No event ID for this booking.');
  const res  = await fetch(API_BASE + '/api/admin/reschedule', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': apiKey },
    body:    JSON.stringify({
      eventId:          activeBooking.eventId,
      name:             activeBooking.name,
      email:            activeBooking.email,
      subject:          activeBooking.subject,
      newStartISO,
      duration:         activeBooking.duration,
      userTz:           activeBooking.userTz || 'Asia/Jerusalem',
      meetingTypeId:    activeBooking.meetingTypeId    || '',
      meetingTypeLabel: activeBooking.meetingTypeLabel || '',
      locationMode:     activeBooking.locationMode     || 'virtual',
      location:         activeBooking.location         || '',
    }),
  });
  const data = await res.json();
  if (data.ok) { alert('Meeting rescheduled!'); closeModal(); loadBookings(); }
  else alert('Error: ' + (data.error || 'unknown'));
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
</script>
</body>
</html>`)
})

// ── Static file serving (React build) ───────────────────────────────────────

const distDir = join(__dirname, 'dist')
app.use(express.static(distDir))

// SPA fallback — serve index.html for all non-API routes
app.get('*', (req, res) => {
  res.sendFile(join(distDir, 'index.html'))
})

// ── Start ────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Scheduling app running on port ${PORT}`)
  if (!GAS_URL) console.warn('⚠️  GAS_URL is not set — calendar integration will not work')
  if (!API_KEY) console.warn('⚠️  API_KEY is not set — /api/* endpoints are unprotected')
})
