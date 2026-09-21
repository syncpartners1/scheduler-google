/**
 * Telegram Bot for the Scheduling App
 *
 * Allows users to book meetings via Telegram using the same backend
 * as the web app (Express /api/* endpoints).
 *
 * Setup:
 *  1. Create a bot via @BotFather and get your token
 *  2. Set TELEGRAM_BOT_TOKEN env var
 *  3. Set SERVER_URL to your Railway app URL (e.g. https://my-app.railway.app)
 *  4. Set API_KEY to match your Express server's API_KEY env var
 *
 * Conversation flow:
 *  /start or /book  → show next 7 available dates
 *  Select date      → show duration options (30 / 60 min)
 *  Select duration  → show available time slots
 *  Select slot      → ask for Name | Email | Subject
 *  Submit details   → create booking → show confirmation with Meet link
 */

import { Telegraf, Markup } from 'telegraf'
import fetch from 'node-fetch'
import { getBotSession, saveBotSession, clearBotSession } from './storage.js'

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN
const SERVER_URL = process.env.SERVER_URL || `http://127.0.0.1:${process.env.PORT || 3000}`
const REGISTRATION_URL = process.env.WEBAUTHN_ORIGIN || 'https://auth.changenavigator.co.il'
const API_KEY    = process.env.API_KEY    || ''

const bot = BOT_TOKEN ? new Telegraf(BOT_TOKEN) : null

// ── Helpers ──────────────────────────────────────────────────────────────────

const HEADERS = { 'Content-Type': 'application/json', 'X-Api-Key': API_KEY }

/** Fetch with a hard timeout (default 15 s) to avoid hanging on cold-start Railway sleeps. */
async function fetchWithTimeout(url, opts = {}, timeoutMs = 15000) {
  const ctrl = new AbortController()
  const id   = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal })
  } finally {
    clearTimeout(id)
  }
}

async function fetchSlots(date, tz, duration) {
  const params = new URLSearchParams({ date, tz, duration })
  const res    = await fetchWithTimeout(`${SERVER_URL}/api/slots?${params}`, { headers: HEADERS })
  return res.json()
}

async function createBooking(payload) {
  const res = await fetchWithTimeout(`${SERVER_URL}/api/book`, {
    method:  'POST',
    headers: HEADERS,
    body:    JSON.stringify(payload),
  })
  return res.json()
}

/** Return next N working days as 'YYYY-MM-DD' strings */
function nextWorkingDays(n = 7) {
  const days = []
  const d    = new Date()
  d.setDate(d.getDate() + 1)   // start from tomorrow

  while (days.length < n) {
    const dow = d.getDay()
    if (dow !== 6) {  // work days are Sun-Fri; skip Saturday only
      days.push(d.toISOString().slice(0, 10))
    }
    d.setDate(d.getDate() + 1)
  }
  return days
}

/** Format 'YYYY-MM-DD' to a human-readable label like 'Mon, Jan 15' */
function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short',
    month:   'short',
    day:     'numeric',
    timeZone: 'UTC',
  })
}

// ── Bot handlers ─────────────────────────────────────────────────────────────

if (bot) {

// /start or /book — show date picker
const showDatePicker = async (ctx) => {
  await clearBotSession(ctx.chat.id)
  const dates   = nextWorkingDays(7)
  const buttons = dates.map(d =>
    Markup.button.callback(formatDate(d), `date:${d}`)
  )

  // Group into rows of 2
  const rows = []
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2))

  await ctx.reply(
    '📅 *Select a date for your meeting:*',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
  )
}

bot.start(showDatePicker)
bot.command('book', showDatePicker)

bot.command('register', async (ctx) => {
  await ctx.reply('Share your own Telegram phone number to start passwordless registration.', Markup.keyboard([[Markup.button.contactRequest('Share my phone')]]).oneTime().resize())
})

bot.on('contact', async (ctx) => {
  if (ctx.message.contact.user_id !== ctx.from.id) return ctx.reply('Please share your own contact, not someone else’s.')
  const sess = await getBotSession(ctx.from.id)
  sess.registrationPhone = ctx.message.contact.phone_number.startsWith('+') ? ctx.message.contact.phone_number : `+${ctx.message.contact.phone_number}`
  await saveBotSession(ctx.from.id, sess)
  await ctx.reply('Phone received. Continue registration securely:', { ...Markup.removeKeyboard(), ...Markup.inlineKeyboard([[Markup.button.webApp('Continue registration', `${REGISTRATION_URL}/register`)]]) })
})

// Date selected → ask for duration
bot.action(/^date:(.+)$/, async (ctx) => {
  const date = ctx.match[1]
  const sess = await getBotSession(ctx.chat.id)
  sess.date  = date
  await saveBotSession(ctx.chat.id, sess)

  await ctx.editMessageText(
    `📅 *${formatDate(date)}*\n\n⏱ How long should the meeting be?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('30 minutes', `dur:30`), Markup.button.callback('60 minutes', `dur:60`)],
        [Markup.button.callback('← Back', 'back:dates')],
      ]),
    }
  )
})

// Back to dates
bot.action('back:dates', async (ctx) => {
  await clearBotSession(ctx.chat.id)
  return showDatePicker(ctx)
})

// Common timezones offered to Telegram users
const TZ_OPTIONS = [
  { label: '🇮🇱 Israel (UTC+3)',    tz: 'Asia/Jerusalem' },
  { label: '🇪🇺 Central Europe',    tz: 'Europe/Berlin'  },
  { label: '🇬🇧 London (UTC±0/+1)', tz: 'Europe/London'  },
  { label: '🌐 UTC',                tz: 'UTC'            },
  { label: '🇺🇸 US Eastern',        tz: 'America/New_York' },
  { label: '🇺🇸 US Pacific',        tz: 'America/Los_Angeles' },
]

// Duration selected → ask for timezone
bot.action(/^dur:(\d+)$/, async (ctx) => {
  const duration = Number(ctx.match[1])
  const sess     = await getBotSession(ctx.chat.id)
  sess.duration  = duration
  await saveBotSession(ctx.chat.id, sess)

  const buttons = TZ_OPTIONS.map(o => Markup.button.callback(o.label, `tz:${o.tz}`))
  const rows    = []
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2))
  rows.push([Markup.button.callback('← Back', `date:${sess.date}`)])

  await ctx.editMessageText(
    `📅 *${formatDate(sess.date)}* · ${duration} min\n\n🌍 What's your timezone?`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
  )
})

// Timezone selected → load + show slots
bot.action(/^tz:(.+)$/, async (ctx) => {
  const userTz = ctx.match[1]
  const sess   = await getBotSession(ctx.chat.id)
  sess.userTz  = userTz
  await saveBotSession(ctx.chat.id, sess)

  await ctx.editMessageText(`⏳ Loading available times for *${formatDate(sess.date)}*…`, { parse_mode: 'Markdown' })

  const { duration } = sess
  try {
    const data = await fetchSlots(sess.date, userTz, duration)
    if (!data.ok) throw new Error(data.error || 'Availability service failed')
    if (!data.slots?.length) {
      return ctx.editMessageText(
        `😔 No available slots on *${formatDate(sess.date)}* for ${duration} min.\n\nUse /book to try another date.`,
        { parse_mode: 'Markdown' }
      )
    }

    sess.slots = data.slots
    await saveBotSession(ctx.chat.id, sess)
    const buttons = data.slots.map((s, i) =>
      Markup.button.callback(s.label, `slot:${i}`)
    )

    const rows = []
    for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3))
    rows.push([Markup.button.callback('← Back', `date:${sess.date}`)])

    await ctx.editMessageText(
      `📅 *${formatDate(sess.date)}* · ${duration} min\n\nSelect a time slot:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
    )
  } catch (err) {
    await ctx.editMessageText(`❌ Could not load slots: ${err.message}`)
  }
})

// Slot selected → require a registered profile, then ask only for subject
bot.action(/^slot:(\d+)$/, async (ctx) => {
  const idx = Number(ctx.match[1])
  const sess = await getBotSession(ctx.chat.id)
  if (!sess.slots || !sess.slots[idx]) return ctx.reply('Something went wrong. Please use /book to start over.')
  sess.selectedSlot = sess.slots[idx]
  const profileRes = await fetchWithTimeout(`${SERVER_URL}/api/auth/profile/${ctx.from.id}`, { headers: HEADERS })
  if (!profileRes.ok) {
    await saveBotSession(ctx.chat.id, sess)
    return ctx.editMessageText('Register securely first. Use /register to share your phone and create a passkey, then return to /book.')
  }
  const { profile } = await profileRes.json()
  sess.profile = profile
  sess.awaitingSubject = true
  await saveBotSession(ctx.chat.id, sess)
  await ctx.editMessageText(`✅ *${sess.selectedSlot.label}* on *${formatDate(sess.date)}* — ${sess.duration} min\n\nSend the meeting subject.`, { parse_mode: 'Markdown' })
})

bot.on('text', async (ctx) => {
  const sess = await getBotSession(ctx.chat.id)
  if (!sess.awaitingSubject) return
  const subject = ctx.message.text.trim()
  if (!subject) return ctx.reply('Please send a meeting subject.')
  const name = sess.profile.name || ctx.from.first_name || 'Telegram user'
  const email = sess.profile.email
  sess.awaitingSubject = false
  await saveBotSession(ctx.chat.id, sess)
  const processingMsg = await ctx.reply('⏳ Creating your booking…')
  try {
    const requestId = `tg-${ctx.chat.id}-${sess.selectedSlot.start}-${Date.now()}`
    const data = await createBooking({ name, email, subject, startISO: sess.selectedSlot.start, duration: sess.duration, userTz: sess.userTz, requestId })
    if (!data.ok) throw new Error(data.error || 'Booking failed')
    await clearBotSession(ctx.chat.id)
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null,
      `✅ *Booking Confirmed!*\n\n📅 *${formatDate(sess.date)}* at *${sess.selectedSlot.label}* (${sess.duration} min)\n👤 ${name}\n📧 ${email}\n📝 ${subject}\n\n🎥 *Google Meet:* ${data.meetLink}\n\n_A calendar invite has been sent to your email._`,
      { parse_mode: 'Markdown' })
    await ctx.reply('Tap below to join your meeting:', Markup.inlineKeyboard([
      [Markup.button.url('Join Google Meet', data.meetLink)], [Markup.button.callback('Book another meeting', 'back:dates')],
    ]))
  } catch (err) {
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, `❌ Booking failed: ${err.message}\n\nUse /book to try again.`)
  }
})

// ── Error handling ────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error('[Telegram Bot Error]', err)
  ctx.reply('An unexpected error occurred. Please use /book to start over.').catch(() => {})
})

} // if (bot)

export { bot }
