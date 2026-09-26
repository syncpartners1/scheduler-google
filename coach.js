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
  if (status !== 200 || !data.ok) throw new Error(data.detail || 'Could not prepare your coaching profile')
  return data
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ── Public handlers ───────────────────────────────────────────────────────────

export function registerCoachHandlers(bot, { getBotSession, saveBotSession }) {

  const requireProfile = async (ctx) => {
    const profile = await firestoreProfile(ctx.from.id)
    if (!profile) {
      await ctx.reply('Register securely first. Use /register to share your phone and create a passkey, then come back.')
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
      if (status === 403) return ctx.reply(data.detail || 'Your coaching account is not active.')
      if (status !== 200 || !data.ok) throw new Error(data.detail || 'Could not start the session')
      const sess = await getBotSession(ctx.chat.id)
      sess.coachActive = true
      await saveBotSession(ctx.chat.id, sess)
      if (data.already_active) {
        await ctx.reply('You already have an active coaching session - just send your message. Use /done to end it.')
      } else if (data.message) {
        await ctx.reply(data.message)
      }
    } catch (err) {
      console.error('[coach/start]', err)
      await ctx.reply(`Could not start a coaching session: ${err.message}`)
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
      if (status === 409) return ctx.reply('No active coaching session. Use /coach to start one.')
      if (status !== 200 || !data.ok) throw new Error(data.detail || 'Could not end the session')
      const sess = await getBotSession(ctx.chat.id)
      sess.coachActive = false
      await saveBotSession(ctx.chat.id, sess)
      await ctx.reply(data.summary_text || 'Session saved. Thanks!', { parse_mode: 'HTML' })
        .catch(() => ctx.reply('Session saved. Thanks!'))
    } catch (err) {
      console.error('[coach/done]', err)
      await ctx.reply(`Could not end the session: ${err.message}`)
    }
  })

  // /message [text] — send a message to the human coach (Adi)
  bot.command('message', async (ctx) => {
    const text = (ctx.message.text.split(/\s+/).slice(1).join(' ') || '').trim()
    if (!text) {
      const sess = await getBotSession(ctx.chat.id)
      sess.awaitingMessage = true
      await saveBotSession(ctx.chat.id, sess)
      return ctx.reply('What would you like to send to Adi? Write it in your next message.')
    }
    await forwardToAdmin(ctx, text)
  })

  async function forwardToAdmin(ctx, text) {
    if (!ADMIN_TELEGRAM_ID) return ctx.reply('The coach inbox is not configured.')
    const name = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || 'Unknown'
    try {
      // "telegram id: N" is parsed back when the admin replies to this message
      await bot.telegram.sendMessage(
        ADMIN_TELEGRAM_ID,
        `📨 <b>Message from ${esc(name)}</b> (telegram id: ${ctx.from.id})\n\n${esc(text)}`,
        { parse_mode: 'HTML' },
      )
      await ctx.reply('✅ Your message has been sent to Adi.')
    } catch (err) {
      console.error('[coach/message]', err)
      await ctx.reply('Could not deliver your message. Please try again later.')
    }
  }

  // Plain text: admin reply-routing first, then message-to-coach, then coaching chat
  bot.on('text', async (ctx, next) => {
    // Admin replying to a forwarded user message → route back to the user
    if (isAdmin(ctx) && ctx.message.reply_to_message) {
      const m = /telegram id: (\d+)/.exec(ctx.message.reply_to_message.text || '')
      if (m) {
        try {
          await bot.telegram.sendMessage(
            m[1],
            `💬 <b>Message from Adi Ben Nesher:</b>\n\n${esc(ctx.message.text)}`,
            { parse_mode: 'HTML' },
          )
          await ctx.reply('✅ Reply delivered.')
        } catch (err) {
          console.error('[coach/admin-reply]', err)
          await ctx.reply('❌ Could not deliver the reply (the user may have blocked the bot).')
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
          return ctx.reply('Your coaching session has ended. Use /coach to start a new one.')
        }
        if (status !== 200 || !data.ok) throw new Error(data.detail || 'Coaching engine error')
        if (data.reply) await ctx.reply(data.reply, { parse_mode: 'HTML' })
          .catch(() => ctx.reply(data.reply))
      } catch (err) {
        console.error('[coach/chat]', err)
        await ctx.reply('Something went wrong in the coaching session. Please try again, or /done to end the session.')
      }
      return
    }

    return next()
  })

  // ── Admin commands ────────────────────────────────────────────────────────

  const adminOnly = (fn) => async (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('This command is for the coach only.')
    try {
      await fn(ctx)
    } catch (err) {
      console.error('[coach/admin]', err)
      await ctx.reply(`❌ ${err.message}`)
    }
  }

  // /users — all program members with progress
  bot.command('users', adminOnly(async (ctx) => {
    const { status, data } = await bridge('/internal/admin/users')
    if (status !== 200 || !data.ok) throw new Error(data.detail || 'Could not load users')
    if (!data.users.length) return ctx.reply('No users registered yet.')
    const lines = ['👥 <b>Program Members</b>', '']
    for (const u of data.users) {
      const pct = u.avg_kr_pct ?? 0
      const dot = pct >= 70 ? '🟢' : pct >= 40 ? '🟡' : '🔴'
      const contact = esc(u.email || u.phone_number || '—')
      const last = u.last_session
        ? new Date(u.last_session).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
        : 'never'
      lines.push(`${dot} <b>${esc(u.name)}</b> (${contact})\n   KR avg: ${pct.toFixed(0)}% · ${u.objectives_count} OKRs · last: ${last}`)
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' })
  }))

  // /report <user_id | phone | email | name>
  bot.command('report', adminOnly(async (ctx) => {
    const query = ctx.message.text.split(/\s+/).slice(1).join(' ').trim()
    if (!query) return ctx.reply('Usage: /report <user_id | phone | email | name>')
    const { status, data } = await bridge('/internal/admin/report', { query: { query } })
    if (status === 404) return ctx.reply('User not found.')
    if (status !== 200 || !data.ok) {
      if (data.error === 'ambiguous') {
        const names = (data.candidates || []).map(c => `• ${esc(c.name)} — <code>${c.user_id}</code>`).join('\n')
        return ctx.reply(`Several users match. Be specific:\n${names}`, { parse_mode: 'HTML' })
      }
      throw new Error(data.detail || 'Could not load the report')
    }
    const p = data.profile
    const lines = [`📊 <b>Report — ${esc(p.name)}</b>`, '']
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
      lines.push('<b>This week\'s highlights:</b>')
      for (const h of highlights) lines.push(`  ${esc(String(h.day_of_week).slice(0, 3))}: ${esc(h.highlight)}`)
      lines.push('')
    }
    if ((data.recent_sessions || []).length) {
      lines.push('<b>Recent sessions:</b>')
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
    if (status !== 200 || !data.ok) throw new Error(data.detail || 'Could not create the invite')
    await ctx.reply(
      `✅ <b>Invite created</b>${args[0] ? ' for ' + esc(args[0]) : ''}!\n\nRegistration link:\n<code>${esc(data.register_url)}</code>\n\nToken: <code>${esc(data.token)}</code>`,
      { parse_mode: 'HTML' },
    )
  }))

  // /broadcast <text> — the bot sends the messages itself (it holds the live token)
  bot.command('broadcast', adminOnly(async (ctx) => {
    const text = ctx.message.text.split(/\s+/).slice(1).join(' ').trim()
    if (!text) return ctx.reply('Usage: /broadcast <your message>')
    const { status, data } = await bridge('/internal/admin/broadcast-targets')
    if (status !== 200 || !data.ok) throw new Error(data.detail || 'Could not load recipients')
    let sent = 0, failed = 0
    for (const t of data.targets) {
      try {
        await bot.telegram.sendMessage(
          t.telegram_id,
          `📢 <b>Message from Adi Ben Nesher:</b>\n\n${esc(text)}`,
          { parse_mode: 'HTML' },
        )
        sent++
      } catch {
        failed++
      }
      await new Promise(r => setTimeout(r, 100))  // stay well under Telegram rate limits
    }
    await ctx.reply(`✅ Broadcast sent to ${sent} user(s)${failed ? ` · ${failed} failed` : ''}.`)
  }))
}
