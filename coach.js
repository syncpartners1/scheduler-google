/**
 * Coaching mode for the consolidated Telegram bot (@Change_navigator_bot).
 *
 * The AICOACH coaching engine (Python, syncpartners1/AICOACH) stays where it
 * is; this module proxies conversations to its internal bridge API:
 *
 *   POST /internal/telegram/user/ensure     — lazy profile provisioning
 *   POST /internal/telegram/session/start   — open a coaching session
 *   POST /internal/telegram/chat            — one conversation turn
 *   POST /internal/telegram/session/end     — close + formatted summary
 *   GET  /internal/admin/users              — progress list (/users)
 *   GET  /internal/admin/report?query=      — full user report (/report)
 *   POST /internal/admin/invite             — create invite (/invite)
 *   GET  /internal/admin/broadcast-targets  — recipients for /broadcast
 *
 * Every bridge call carries the shared secret in the X-Bridge-Secret header.
 * Identity: the Firestore `users` doc (registration + passkeys) is primary;
 * the AICOACH profile is provisioned lazily on first coaching use.
 *
 * Env:
 *   AICOACH_URL            — base URL of the AICOACH service (no trailing /)
 *   AICOACH_BRIDGE_SECRET  — must match TELEGRAM_BRIDGE_SECRET on AICOACH
 *   ADMIN_TELEGRAM_ID      — Telegram user ID with access to admin commands
 */

import fetch from 'node-fetch'
import { userRef } from './storage.js'

const AICOACH_URL = (process.env.AICOACH_URL || '').replace(/\/+$/, '')
const BRIDGE_SECRET = process.env.AICOACH_BRIDGE_SECRET || ''
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || '')

const BRIDGE_TIMEOUT_MS = 120000  // coaching LLM turns can take a while

const isAdmin = (ctx) => ADMIN_TELEGRAM_ID && String(ctx.from.id) === ADMIN_TELEGRAM_ID

async function bridge(path, { method = 'GET', body, query } = {}) {
  if (!AICOACH_URL || !BRIDGE_SECRET) throw new Error('Coaching bridge is not configured (AICOACH_URL / AICOACH_BRIDGE_SECRET)')
  const qs = query ? '?' + new URLSearchParams(query) : ''
  const ctrl = new AbortController()
  const id = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT_MS)
  let res
  try {
    res = await fetch(`${AICOACH_URL}${path}${qs}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': BRIDGE_SECRET },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(id)
  }
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

/** Load the Firestore profile (primary identity) for a Telegram user. */
async function firestoreProfile(telegramId) {
  const snap = await userRef(telegramId).get()
  return snap.exists ? snap.data() : null
}

/** Ensure the AICOACH-side profile exists; returns the bridge user record or null. */
async function ensureCoachUser(ctx, profile) {
  const name = profile.displayName || [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Telegram user'
  const { status, data } = await bridge('/internal/telegram/user/ensure', {
    method: 'POST',
    body: { telegram_id: ctx.from.id, name, phone: profile.phone, email: profile.email, lang: 'he' },
  })
  if (status !== 200 || !data.ok) throw new Error(data.detail || 'לא ניתן להכין את פרופיל האימון')
  return data
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Public handlers ───────────────────────────────────────────────────────────

export function registerCoachHandlers(bot, { getBotSession, saveBotSession }) {

  const requireProfile = async (ctx) => {
    const profile = await firestoreProfile(ctx.from.id)
    if (!profile) {
      await ctx.reply('כדי להתחיל אימון, צריך להירשם תחילה. שלחו /register, שתפו את מספר הטלפון שלכם והשלימו את ההרשמה.')
      return null
    }
    return profile
  }

  // /coach or /newsession — open a coaching session
  const startCoaching = async (ctx) => {
    const profile = await requireProfile(ctx)
    if (!profile) return
    try {
      await ensureCoachUser(ctx, profile)
      const { status, data } = await bridge('/internal/telegram/session/start', {
        method: 'POST', body: { telegram_id: ctx.from.id },
      })
      if (status === 403) return ctx.reply('לא ניתן להתחיל אימון בחשבון הזה כרגע. אם החשבון ממתין לאישור, פנו לעדי.')
      if (status !== 200 || !data.ok) throw new Error(data.detail || 'לא ניתן להתחיל את שיחת האימון')
      const sess = await getBotSession(ctx.chat.id)
      sess.coachActive = true
      await saveBotSession(ctx.chat.id, sess)
      if (data.already_active) {
        await ctx.reply('שיחת האימון כבר פעילה. אפשר לשלוח הודעה. לסיום שלחו /done.')
      } else if (data.message) {
        await ctx.reply(data.message)
      }
    } catch (err) {
      console.error('[coach/start]', err)
      await ctx.reply('לא ניתן להתחיל כרגע את שיחת האימון. נסו שוב מאוחר יותר.')
    }
  }
  bot.command('coach', startCoaching)
  bot.command('newsession', startCoaching)

  // /done — end the session and show the summary
  bot.command('done', async (ctx) => {
    try {
      const { status, data } = await bridge('/internal/telegram/session/end', {
        method: 'POST', body: { telegram_id: ctx.from.id },
      })
      if (status === 409) return ctx.reply('אין שיחת אימון פעילה. שלחו /coach כדי להתחיל.')
      if (status !== 200 || !data.ok) throw new Error(data.detail || 'לא ניתן לסיים את שיחת האימון')
      const sess = await getBotSession(ctx.chat.id)
      sess.coachActive = false
      await saveBotSession(ctx.chat.id, sess)
      await ctx.reply(data.summary_text || 'השיחה נשמרה. תודה!', { parse_mode: 'HTML' })
        .catch(() => ctx.reply('השיחה נשמרה. תודה!'))
    } catch (err) {
      console.error('[coach/done]', err)
      await ctx.reply('לא ניתן לסיים כרגע את השיחה. נסו שוב מאוחר יותר.')
    }
  })

  // /message [text] — send a message to the human coach (Adi)
  bot.command('message', async (ctx) => {
    const text = (ctx.message.text.split(/\s+/).slice(1).join(' ') || '').trim()
    if (!text) {
      const sess = await getBotSession(ctx.chat.id)
      sess.awaitingMessage = true
      await saveBotSession(ctx.chat.id, sess)
      return ctx.reply('מה תרצו לשלוח לעדי? כתבו את ההודעה הבאה שלכם.')
    }
    await forwardToAdmin(ctx, text)
  })

  async function forwardToAdmin(ctx, text) {
    if (!ADMIN_TELEGRAM_ID) return ctx.reply('לא ניתן לשלוח הודעה למאמן כרגע.')
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'ללא שם'
    try {
      // "telegram id: N" is parsed back when the admin replies to this message
      await bot.telegram.sendMessage(
        ADMIN_TELEGRAM_ID,
        `📨 <b>הודעה מאת ${esc(name)}</b> (מזהה טלגרם: ${ctx.from.id})\n\n${esc(text)}`,
        { parse_mode: 'HTML' },
      )
      await ctx.reply('✅ ההודעה נשלחה לעדי.')
    } catch (err) {
      console.error('[coach/message]', err)
      await ctx.reply('לא ניתן לשלוח את ההודעה כרגע. נסו שוב מאוחר יותר.')
    }
  }

  // Plain text: admin reply-routing first, then message-to-coach, then coaching chat
  bot.on('text', async (ctx, next) => {
    // Admin replying to a forwarded user message → route back to the user
    if (isAdmin(ctx) && ctx.message.reply_to_message) {
      const m = /(?:מזהה טלגרם|telegram id): (\d+)/.exec(ctx.message.reply_to_message.text || '')
      if (m) {
        try {
          await bot.telegram.sendMessage(
            m[1],
            `💬 <b>הודעה מעדי בן נשר:</b>\n\n${esc(ctx.message.text)}`,
            { parse_mode: 'HTML' },
          )
          await ctx.reply('✅ התשובה נשלחה.')
        } catch (err) {
          console.error('[coach/admin-reply]', err)
          await ctx.reply('❌ לא ניתן לשלוח את התשובה (ייתכן שהמשתמש חסם את הבוט).')
        }
        return
      }
    }

    const sess = await getBotSession(ctx.chat.id)

    // Booking flow owns the text input while awaiting a subject
    if (sess.awaitingSubject) return next()

    // Pending free-text message to the coach
    if (sess.awaitingMessage) {
      sess.awaitingMessage = false
      await saveBotSession(ctx.chat.id, sess)
      return forwardToAdmin(ctx, ctx.message.text.trim())
    }

    // Active coaching session → proxy the turn to the engine
    if (sess.coachActive) {
      try {
        await ctx.sendChatAction('typing')
        const { status, data } = await bridge('/internal/telegram/chat', {
          method: 'POST', body: { telegram_id: ctx.from.id, text: ctx.message.text },
        })
        if (status === 409) {
          sess.coachActive = false
          await saveBotSession(ctx.chat.id, sess)
          return ctx.reply('שיחת האימון הסתיימה. שלחו /coach כדי להתחיל שיחה חדשה.')
        }
        if (status !== 200 || !data.ok) throw new Error(data.detail || 'תקלה במנוע האימון')
        if (data.reply) await ctx.reply(data.reply, { parse_mode: 'HTML' })
          .catch(() => ctx.reply(data.reply))
      } catch (err) {
        console.error('[coach/chat]', err)
        await ctx.reply('אירעה תקלה בשיחת האימון. נסו שוב, או שלחו /done לסיום.')
      }
      return
    }

    return next()
  })

  // ── Admin commands ────────────────────────────────────────────────────────

  const adminOnly = (fn) => async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('הפקודה הזו מיועדת למאמן בלבד.')
    try {
      await fn(ctx)
    } catch (err) {
      console.error('[coach/admin]', err)
      await ctx.reply('❌ הפעולה נכשלה. נסו שוב מאוחר יותר.')
    }
  }

  // /users — all program members with progress
  bot.command('users', adminOnly(async (ctx) => {
    const { status, data } = await bridge('/internal/admin/users')
    if (status !== 200 || !data.ok) throw new Error(data.detail || 'לא ניתן לטעון משתמשים')
    if (!data.users.length) return ctx.reply('אין משתמשים רשומים עדיין.')
    const lines = ['👥 <b>משתתפי התוכנית</b>', '']
    for (const u of data.users) {
      const pct = u.avg_kr_pct ?? 0
      const dot = pct >= 70 ? '🟢' : pct >= 40 ? '🟡' : '🔴'
      const contact = esc(u.email || u.phone_number || '—')
      const last = u.last_session
        ? new Date(u.last_session).toLocaleDateString('he-IL', { day: 'numeric', month: 'short', timeZone: 'Asia/Jerusalem' })
        : 'אין'
      lines.push(`${dot} <b>${esc(u.name)}</b> (${contact})\n   KR avg: ${pct.toFixed(0)}% · ${u.objectives_count} OKRs · last: ${last}`)
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  }))

  // /report <user_id | phone | email | name>
  bot.command('report', adminOnly(async (ctx) => {
    const query = ctx.message.text.split(/\s+/).slice(1).join(' ').trim()
    if (!query) return ctx.reply('שימוש: /report <מזהה | טלפון | אימייל | שם>')
    const { status, data } = await bridge('/internal/admin/report', { query: { query } })
    if (status === 404) return ctx.reply('המשתמש לא נמצא.')
    if (status !== 200 || !data.ok) {
      if (data.error === 'ambiguous') {
        const names = (data.candidates || []).map(c => `• ${esc(c.name)} — <code>${c.user_id}</code>`).join('\n')
        return ctx.reply(`נמצאו כמה משתמשים. ציינו פרטים נוספים:\n${names}`, { parse_mode: 'HTML' })
      }
      throw new Error(data.detail || 'לא ניתן לטעון דוח')
    }
    const p = data.profile
    const lines = [`📊 <b>דוח - ${esc(p.name)}</b>`, '']
    for (const obj of data.objectives || []) {
      lines.push(`🎯 <b>${esc(obj.title)}</b>`)
      for (const kr of obj.key_results || []) {
        const pct = kr.current_pct ?? 0
        const dot = pct >= 70 ? '🟢' : pct >= 40 ? '🟡' : '🔴'
        lines.push(`  ${dot} ${esc(kr.description)}: ${pct}%`)
      }
      lines.push('')
    }
    const highlights = data.weekly_plan?.daily_highlights || []
    if (highlights.length) {
      lines.push('<b>נקודות בולטות השבוע:</b>')
      for (const h of highlights) lines.push(`  ${esc(String(h.day_of_week).slice(0, 3))}: ${esc(h.highlight)}`)
      lines.push('')
    }
    if ((data.recent_sessions || []).length) {
      lines.push('<b>מפגשים אחרונים:</b>')
      for (const s of data.recent_sessions) {
        lines.push(`  ${String(s.timestamp).slice(0, 10)} [${String(s.alert_level).toUpperCase()}]: ${esc((s.summary_for_coach || '').slice(0, 80))}…`)
      }
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  }))

  // /invite [name] [phone-or-email]
  bot.command('invite', adminOnly(async (ctx) => {
    const args = ctx.message.text.split(/\s+/).slice(1)
    const { status, data } = await bridge('/internal/admin/invite', {
      method: 'POST',
      body: { name: args[0] || null, contact: args[1] || null },
    })
    if (status !== 200 || !data.ok) throw new Error(data.detail || 'לא ניתן ליצור הזמנה')
    await ctx.reply(
      `✅ <b>נוצרה הזמנה</b>${args[0] ? ' עבור ' + esc(args[0]) : ''}.\n\nקישור הרשמה:\n<code>${esc(data.register_url)}</code>\n\nקוד הזמנה: <code>${esc(data.token)}</code>`,
      { parse_mode: 'HTML' },
    )
  }))

  // /broadcast <text> — the bot sends the messages itself (it holds the live token)
  bot.command('broadcast', adminOnly(async (ctx) => {
    const text = ctx.message.text.split(/\s+/).slice(1).join(' ').trim()
    if (!text) return ctx.reply('שימוש: /broadcast <הודעה>')
    const { status, data } = await bridge('/internal/admin/broadcast-targets')
    if (status !== 200 || !data.ok) throw new Error(data.detail || 'לא ניתן לטעון נמענים')
    let sent = 0, failed = 0
    for (const t of data.targets) {
      try {
        await bot.telegram.sendMessage(
          t.telegram_id,
          `📢 <b>הודעה מעדי בן נשר:</b>\n\n${esc(text)}`,
          { parse_mode: 'HTML' },
        )
        sent++
      } catch {
        failed++
      }
      await new Promise(r => setTimeout(r, 100))  // stay well under Telegram rate limits
    }
    await ctx.reply(`✅ ההודעה נשלחה ל-${sent} משתמשים${failed ? ` · שליחה נכשלה ל-${failed}` : ''}.`)
  }))
  return { startCoaching }
}
