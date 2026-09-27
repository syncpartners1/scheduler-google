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
 *  /start checks registration and offers coaching/booking options.
 *  /book preserves the existing appointment flow for registered users.
 */

import { Telegraf, Markup } from 'telegraf'
import fetch from 'node-fetch'
import { getBotSession, saveBotSession, clearBotSession, userRef } from './storage.js'
import { registerCoachHandlers } from './coach.js'
import { registerLeadHandlers } from './lead.js'
import { windowForDate } from './availability.js'

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
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const d = new Date(`${today}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)   // start from tomorrow in Jerusalem

  while (days.length < n) {
    const date = d.toISOString().slice(0, 10)
    if (windowForDate(date)) days.push(date)
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

/** Format 'YYYY-MM-DD' to a human-readable label like 'Mon, Jan 15' */
function formatDate(dateStr) {
  return new Date(dateStr + 'T12:00:00Z').toLocaleDateString('he-IL', {
    weekday: 'long',
    month:   'long',
    day:     'numeric',
    timeZone: 'UTC',
  })
}

/** Render a slot in the visitor's chosen timezone without English AM/PM text. */
function formatSlotTime(iso, tz) {
  return new Intl.DateTimeFormat('he-IL', {
    timeZone: tz || 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso))
}

// ── Bot handlers ─────────────────────────────────────────────────────────────

if (bot) {

// Coaching mode + admin commands (must register before the booking text
// handler so coaching messages are routed first; it calls next() to fall through)
const { handleContact: handleLeadContact } = registerLeadHandlers(bot)
const { startCoaching } = registerCoachHandlers(bot, { getBotSession, saveBotSession })

// /book keeps the existing booking flow; /start is the coaching entry point.
const showDatePicker = async (ctx) => {
  // Keep an active coaching session when the visitor browses booking dates.
  const sess = await getBotSession(ctx.chat.id)
  await saveBotSession(ctx.chat.id, sess.coachActive ? { coachActive: true } : (sess.leadId ? { leadId: sess.leadId } : {}))
  const dates   = nextWorkingDays(7)
  const buttons = dates.map(d =>
    Markup.button.callback(formatDate(d), `date:${d}`)
  )

  // Group into rows of 2
  const rows = []
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2))

  await ctx.reply(
    '📅 *בחרו תאריך לפגישה:*',
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
  )
}

bot.command('book', showDatePicker)

const registeredOptions = Markup.inlineKeyboard([
  [Markup.button.callback('לקבוע פגישה', 'home:book')],
])
const guestOptions = Markup.inlineKeyboard([
  [Markup.button.callback('להירשם לאימון', 'home:register')],
  [Markup.button.callback('פגישה וירטואלית', 'home:virtual')],
  [Markup.button.callback('שיחת היכרות', 'home:call')],
])

bot.start(async (ctx) => {
  // A failed Firestore lookup is not proof that someone is unregistered.
  let profile
  try {
    const snap = await userRef(ctx.from.id).get()
    profile = snap.exists ? snap.data() : null
  } catch (err) {
    console.error('[bot/start/profile]', err)
    return ctx.reply('לא ניתן לבדוק את ההרשמה כרגע. נסו שוב בעוד כמה דקות.')
  }
  if (profile) {
    // Preserve any ongoing session; the visitor chooses whether to resume or book.
    await ctx.reply('ברוכים הבאים. שיחת האימון מתחילה כעת. אפשר גם לקבוע פגישה עם עדי.', registeredOptions)
    return startCoaching(ctx)
  }
  return ctx.reply(
    'שלום, אני הבוט של עדי בן נשר, מאמן לשינוי אישי, כלכלי ועסקי. האימון מתחיל בהיכרות עם היעדים והאתגרים שלכם, וממשיך בשיחה אישית על הצעדים הבאים. אפשר להירשם, או להשאיר פנייה לפגישה וירטואלית או לשיחת היכרות. לא נקבע זמן אוטומטית.',
    guestOptions,
  )
})
bot.action('home:book', async (ctx) => { await ctx.answerCbQuery(); return showDatePicker(ctx) })
bot.action('home:register', async (ctx) => { await ctx.answerCbQuery(); return startRegistration(ctx) })


const startRegistration = async (ctx) => {
  await ctx.reply('כדי להירשם, שתפו את מספר הטלפון שלכם בטלגרם. לאחר מכן תאמתו את האימייל ותיצרו מפתח גישה.', Markup.keyboard([[Markup.button.contactRequest('שיתוף מספר הטלפון שלי')]]).oneTime().resize())
}
bot.command('register', startRegistration)

bot.on('contact', async (ctx) => {
  const sess = await getBotSession(ctx.from.id)
  if (await handleLeadContact(ctx, sess)) return
  if (ctx.message.contact.user_id !== ctx.from.id) return ctx.reply('יש לשתף את מספר הטלפון שלכם בלבד.')
  delete sess.awaitingLeadName
  delete sess.awaitingLeadContact
  sess.registrationPhone = ctx.message.contact.phone_number.startsWith('+') ? ctx.message.contact.phone_number : `+${ctx.message.contact.phone_number}`
  await saveBotSession(ctx.from.id, sess)
  await ctx.reply('המספר התקבל.', Markup.removeKeyboard())
  await ctx.reply('להמשך ההרשמה המאובטחת:', Markup.inlineKeyboard([[Markup.button.webApp('המשך הרשמה', `${REGISTRATION_URL}/register`)]]))
})

// Date selected → ask for duration
bot.action(/^date:(.+)$/, async (ctx) => {
  const date = ctx.match[1]
  const sess = await getBotSession(ctx.chat.id)
  sess.date  = date
  await saveBotSession(ctx.chat.id, sess)

  await ctx.editMessageText(
    `📅 *${formatDate(date)}*\n\n⏱ מה משך הפגישה?`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('30 דקות', `dur:30`), Markup.button.callback('60 דקות', `dur:60`)],
        [Markup.button.callback('← חזרה', 'back:dates')],
      ]),
    }
  )
})

// Back to dates
bot.action('back:dates', async (ctx) => {
  return showDatePicker(ctx)
})

// Common timezones offered to Telegram users
const TZ_OPTIONS = [
  { label: '🇮🇱 ישראל',    tz: 'Asia/Jerusalem' },
  { label: '🇪🇺 מרכז אירופה',    tz: 'Europe/Berlin'  },
  { label: '🇬🇧 לונדון', tz: 'Europe/London'  },
  { label: '🌐 UTC',                tz: 'UTC'            },
  { label: '🇺🇸 מזרח ארה״ב',        tz: 'America/New_York' },
  { label: '🇺🇸 מערב ארה״ב',        tz: 'America/Los_Angeles' },
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
  rows.push([Markup.button.callback('← חזרה', `date:${sess.date}`)])

  await ctx.editMessageText(
    `📅 *${formatDate(sess.date)}* · ${duration} דקות\n\n🌍 מה אזור הזמן שלכם?`,
    { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
  )
})

// Timezone selected → load + show slots
bot.action(/^tz:(.+)$/, async (ctx) => {
  const userTz = ctx.match[1]
  const sess   = await getBotSession(ctx.chat.id)
  sess.userTz  = userTz
  await saveBotSession(ctx.chat.id, sess)

  await ctx.editMessageText(`⏳ טוען שעות פנויות ל-*${formatDate(sess.date)}*…`, { parse_mode: 'Markdown' })

  const { duration } = sess
  try {
    const data = await fetchSlots(sess.date, userTz, duration)
    if (!data.ok) throw new Error(data.error || 'Availability service failed')
    if (!data.slots?.length) {
      return ctx.editMessageText(
        `😔 אין שעות פנויות ב-*${formatDate(sess.date)}* לפגישה של ${duration} דקות.\n\nשלחו /book כדי לבחור יום אחר.`,
        { parse_mode: 'Markdown' }
      )
    }

    sess.slots = data.slots
    await saveBotSession(ctx.chat.id, sess)
    const buttons = data.slots.map((s, i) =>
      Markup.button.callback(formatSlotTime(s.start, userTz), `slot:${i}`)
    )

    const rows = []
    for (let i = 0; i < buttons.length; i += 3) rows.push(buttons.slice(i, i + 3))
    rows.push([Markup.button.callback('← חזרה', `date:${sess.date}`)])

    await ctx.editMessageText(
      `📅 *${formatDate(sess.date)}* · ${duration} דקות\n\nבחרו שעה:`,
      { parse_mode: 'Markdown', ...Markup.inlineKeyboard(rows) }
    )
  } catch (err) {
    await ctx.editMessageText('❌ לא ניתן לטעון שעות פנויות כרגע. נסו שוב מאוחר יותר.')
  }
})

// Slot selected → require a registered profile, then ask only for subject
bot.action(/^slot:(\d+)$/, async (ctx) => {
  const idx = Number(ctx.match[1])
  const sess = await getBotSession(ctx.chat.id)
  if (!sess.slots || !sess.slots[idx]) return ctx.reply('אירעה תקלה. שלחו /book כדי להתחיל מחדש.')
  sess.selectedSlot = sess.slots[idx]
  const profileRes = await fetchWithTimeout(`${SERVER_URL}/api/auth/profile/${ctx.from.id}`, { headers: HEADERS })
  if (profileRes.status === 404) {
    await saveBotSession(ctx.chat.id, sess)
    return ctx.editMessageText('כדי לקבוע פגישה יש להירשם תחילה. שלחו /register והשלימו את ההרשמה, ואז חזרו ל-/book.')
  }
  if (!profileRes.ok) return ctx.reply('לא ניתן לבדוק את פרטי ההרשמה כרגע. נסו שוב מאוחר יותר.')
  const { profile } = await profileRes.json()
  sess.profile = profile
  sess.awaitingSubject = true
  await saveBotSession(ctx.chat.id, sess)
  await ctx.editMessageText(`✅ *${formatSlotTime(sess.selectedSlot.start, sess.userTz)}* ב-*${formatDate(sess.date)}* - ${sess.duration} דקות\n\nכתבו את נושא הפגישה.`, { parse_mode: 'Markdown' })
})

bot.on('text', async (ctx) => {
  const sess = await getBotSession(ctx.chat.id)
  if (!sess.awaitingSubject) return
  const subject = ctx.message.text.trim()
  if (!subject) return ctx.reply('כתבו את נושא הפגישה.')
  const name = sess.profile.name || ctx.from.first_name || 'משתמש טלגרם'
  const email = sess.profile.email
  sess.awaitingSubject = false
  await saveBotSession(ctx.chat.id, sess)
  const processingMsg = await ctx.reply('⏳ קובע את הפגישה…')
  try {
    const requestId = `tg-${ctx.chat.id}-${sess.selectedSlot.start}-${Date.now()}`
    const data = await createBooking({ name, email, subject, startISO: sess.selectedSlot.start, duration: sess.duration, userTz: sess.userTz, requestId })
    if (!data.ok) throw new Error('Booking failed')
    const current = await getBotSession(ctx.chat.id)
    if (current.coachActive) await saveBotSession(ctx.chat.id, { coachActive: true })
    else await clearBotSession(ctx.chat.id)
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null,
      `✅ הפגישה נקבעה!\n\n📅 ${formatDate(sess.date)} בשעה ${formatSlotTime(sess.selectedSlot.start, sess.userTz)} (${sess.duration} דקות)\n👤 ${name}\n📧 ${email}\n📝 ${subject}\n\n🎥 קישור לפגישה: ${data.meetLink}\n\nנשלחה הזמנה ליומן לאימייל שלכם.`,
      undefined)
    await ctx.reply('להצטרפות לפגישה:', Markup.inlineKeyboard([
      [Markup.button.url('כניסה לפגישה', data.meetLink)], [Markup.button.callback('קביעת פגישה נוספת', 'back:dates')],
    ]))
  } catch (err) {
    await ctx.telegram.editMessageText(ctx.chat.id, processingMsg.message_id, null, '❌ קביעת הפגישה נכשלה. שלחו /book כדי לנסות שוב.')
  }
})

// ── Error handling ────────────────────────────────────────────────────────────

bot.catch((err, ctx) => {
  console.error('[Telegram Bot Error]', err)
  ctx.reply('אירעה תקלה. שלחו /start כדי להתחיל מחדש.').catch(() => {})
})

} // if (bot)

export { bot }
