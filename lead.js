/** Collect an unregistered visitor's lead and record it once in ClickUp. */
import crypto from 'node:crypto'
import { db, getBotSession, saveBotSession, userRef } from './storage.js'

const CLICKUP_API_TOKEN = process.env.CLICKUP_API_TOKEN || ''
const CLICKUP_LEAD_LIST_ID = process.env.CLICKUP_LEAD_LIST_ID || ''
const ADMIN_TELEGRAM_ID = process.env.ADMIN_TELEGRAM_ID || ''
const TYPE_LABEL = { virtual: 'פגישה וירטואלית', call: 'שיחת היכרות' }
const leadDoc = (id) => db.collection('telegramLeads').doc(id)

function cleanPhone(contact) {
  const number = String(contact.phone_number || '').replace(/[\s()-]/g, '')
  return number.startsWith('+') ? number : `+${number}`
}

export function registerLeadHandlers(bot) {
  async function startLead(ctx, type) {
    await ctx.answerCbQuery()
    // Registered users take the normal /book path; do not create a lead for them.
    let snap
    try { snap = await userRef(ctx.from.id).get() }
    catch (err) {
      console.error('[lead/profile]', err)
      return ctx.reply('לא ניתן לבדוק הרשמה כרגע. נסו שוב מאוחר יותר.')
    }
    if (snap.exists) return ctx.reply('אתם כבר רשומים. שלחו /book כדי לקבוע פגישה.')
    if (!CLICKUP_API_TOKEN || !CLICKUP_LEAD_LIST_ID || !ADMIN_TELEGRAM_ID) {
      console.error('[lead/config] ClickUp token, list or admin ID missing')
      return ctx.reply('לא ניתן לקבל פניות כרגע. נסו שוב מאוחר יותר.')
    }
    const session = await getBotSession(ctx.chat.id)
    // If a submission is unresolved, do not create another task accidentally.
    if (session.leadId) {
      try {
        const old = await leadDoc(session.leadId).get()
        if (old.exists) return ctx.reply('הפנייה הקודמת עדיין בטיפול. לא נפתחה פנייה נוספת.')
      } catch (err) {
        console.error('[lead/status]', err)
        return ctx.reply('לא ניתן לבדוק פנייה קיימת כרגע. נסו שוב מאוחר יותר.')
      }
    }
    session.leadId = crypto.randomUUID()
    session.leadType = type
    session.awaitingLeadName = true
    delete session.awaitingLeadContact
    await saveBotSession(ctx.chat.id, session)
    return ctx.reply(`בחרתם ${TYPE_LABEL[type]}. נבקש שם ומספר טלפון כדי להעביר פנייה לעדי ולשמור אותה ב-ClickUp. לא נקבעת פגישה בשלב הזה. מה שמכם?`)
  }

  bot.action('home:virtual', (ctx) => startLead(ctx, 'virtual'))
  bot.action('home:call', (ctx) => startLead(ctx, 'call'))

  // Called by bot.js's contact handler before registration logic.
  async function handleContact(ctx, session) {
    if (!session.awaitingLeadContact) return false
    if (ctx.message.contact.user_id !== ctx.from.id) {
      await ctx.reply('יש לשתף את מספר הטלפון שלכם בלבד באמצעות הכפתור.')
      return true
    }
    const name = session.leadName
    const phone = cleanPhone(ctx.message.contact)
    const leadId = session.leadId
    const type = session.leadType
    if (!name || !TYPE_LABEL[type] || !leadId || !/^\+[1-9]\d{7,14}$/.test(phone)) {
      await ctx.reply('לא ניתן לשמור את פרטי הפנייה. שלחו /start כדי להתחיל מחדש.')
      return true
    }
    // Transaction protects against Telegram redelivery and double-taps. An uncertain
    // ClickUp result stays pending for manual reconciliation, never blind retry.
    const ref = leadDoc(leadId)
    let claimed
    try { claimed = await db.runTransaction(async (tx) => {
      const existing = await tx.get(ref)
      if (existing.exists) return false
      tx.create(ref, { status: 'pending', telegramId: String(ctx.from.id), chatId: String(ctx.chat.id), name, phone, type, createdAt: new Date() })
      return true
    }) } catch (err) {
      console.error('[lead/claim]', err)
      await ctx.reply('לא ניתן לשמור את הפנייה כרגע. נסו שוב מאוחר יותר.')
      return true
    }
    if (!claimed) {
      await ctx.reply('הפנייה כבר נשלחה או נמצאת בבדיקה. לא נפתחה פנייה נוספת.')
      return true
    }
    session.awaitingLeadContact = false
    try { await saveBotSession(ctx.chat.id, session) }
    catch (err) { console.error('[lead/session-update]', err) }
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15000)
      let response
      try {
        response = await fetch(`https://api.clickup.com/api/v2/list/${encodeURIComponent(CLICKUP_LEAD_LIST_ID)}/task`, {
          method: 'POST',
          headers: { 'Authorization': CLICKUP_API_TOKEN, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: `ליד מטלגרם - ${name} - ${TYPE_LABEL[type]}`,
            description: `שם: ${name}\nטלפון: ${phone}\nסוג פנייה: ${TYPE_LABEL[type]}\nמזהה טלגרם: ${ctx.from.id}\nמזהה פנייה: ${leadId}\nלא נקבעה פגישה.`,
          }),
          signal: ctrl.signal,
        })
      } finally { clearTimeout(timer) }
      const result = await response.json().catch(() => ({}))
      if (!response.ok || !result.id) throw new Error(`ClickUp rejected lead (${response.status})`)
      try { await ref.update({ status: 'created', clickupTaskId: result.id, clickupUrl: result.url || '', updatedAt: new Date() }) }
      catch (err) { console.error('[lead/state-after-create]', err) }
      const taskLine = result.url ? `\n${result.url}` : `\nמשימה: ${result.id}`
      // A Telegram notification is supplementary: ClickUp is the durable record.
      let notified = false
      try {
        await bot.telegram.sendMessage(ADMIN_TELEGRAM_ID, `פנייה חדשה: ${name}\n${phone}\n${TYPE_LABEL[type]}${taskLine}`)
        notified = true
        await ref.update({ adminNotified: true })
      } catch (notifyErr) {
        console.error('[lead/admin-notify]', notifyErr)
        await ref.update({ adminNotified: false }).catch(() => {})
      }
      await ctx.reply(notified
        ? 'הפנייה נרשמה ונשלחה לעדי. עדיין לא נקבעה פגישה.'
        : 'הפנייה נרשמה. לא הצלחנו לשלוח עליה התראה לעדי כרגע; היא שמורה לבדיקה. עדיין לא נקבעה פגישה.',
        { reply_markup: { remove_keyboard: true } })
    } catch (err) {
      console.error('[lead/clickup]', err)
      await ref.update({ status: 'needs_review', updatedAt: new Date() }).catch(() => {})
      await ctx.reply('לא ניתן לאשר שהפנייה התקבלה. לא נשלח אותה שוב אוטומטית כדי למנוע כפילות. אפשר לפנות לעדי ישירות.', { reply_markup: { remove_keyboard: true } })
    }
    return true
  }

  async function handleName(ctx, session) {
    if (!session.awaitingLeadName) return false
    const name = ctx.message.text.trim()
    if (name.length < 2 || name.length > 100) {
      await ctx.reply('כתבו שם בן 2 עד 100 תווים.')
      return true
    }
    session.leadName = name
    session.awaitingLeadName = false
    session.awaitingLeadContact = true
    await saveBotSession(ctx.chat.id, session)
    await ctx.reply('תודה. שתפו את מספר הטלפון שלכם באמצעות הכפתור:', {
      reply_markup: { keyboard: [[{ text: 'שיתוף מספר הטלפון שלי', request_contact: true }]], resize_keyboard: true, one_time_keyboard: true },
    })
    return true
  }

  bot.on('text', async (ctx, next) => {
    const session = await getBotSession(ctx.chat.id)
    if (await handleName(ctx, session)) return
    return next()
  })

  return { handleContact }
}
