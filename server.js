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

import express        from 'express'
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
  'https://script.google.com/macros/s/AKfycbxIt5jVoSmstOxBh2Ojej3hwSNPHxuWc-gu6CT5-A5iwJEO_8bJYFxg269UJaa0mt09/exec'
const API_KEY   = process.env.API_KEY || ''

// ── Slot generation (mirrors src/utils/timeSlots.js) ────────────────────────

const OWNER_TZ       = 'Asia/Jerusalem'
const WORKING_HOURS  = { start: 9, end: 18 }
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
  return new Date(approxUtc.getTime() - diff)
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

  // Busy blocks are already buffered by GAS; add client-side buffer on top
  const busy = busySlots.map(b => ({
    start: new Date(new Date(b.start).getTime() - BUFFER_MINS * 60 * 1000),
    end:   new Date(new Date(b.end).getTime()   + BUFFER_MINS * 60 * 1000),
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
