/** Task reports only, no session creation or profile provisioning. */
const queries = new Set(['what is my task', 'what are my tasks', 'מה המשימה שלי', 'מה המשימות שלי',
  'i finished', 'i completed it', 'סיימתי', 'השלמתי', 'לא השלמתי', 'לא סיימתי'])
export function isTaskQuery(text) {
  return queries.has(String(text || '').trim().replace(/[?!؟.]+$/, '').toLowerCase())
}
export function registerTaskHandlers(bot, { bridge, getBotSession, sendHtml }) {
  const report = async (ctx) => {
    const updateId = ctx.update?.update_id
    if (!Number.isSafeInteger(updateId) || updateId < 0 || !ctx.from?.id || ctx.chat?.type !== 'private') {
      return ctx.reply('לא ניתן לקבל דיווח כאן. שלחו את הפקודה בשיחה פרטית עם הבוט.')
    }
    // Telegram may address a slash command to this bot; Python accepts bare names.
    const text = ctx.message.text.replace(/^\/(tasks|task_done|task_not_done)@[A-Za-z0-9_]+(?=\s|$)/, '/$1')
    try {
      const { status, data } = await bridge('/internal/telegram/tasks', {
        method: 'POST', body: { telegram_id: ctx.from.id, text, update_id: updateId },
      })
      if (status !== 200 || !data.ok || typeof data.reply !== 'string') throw new Error('Task bridge rejected request')
      if (data.parse_mode === 'HTML') return sendHtml(ctx, data.reply)
      return ctx.reply(data.reply)
    } catch (err) {
      console.error('[coach/tasks]', err.message)
      return ctx.reply('לא ניתן לאשר את הדיווח כרגע. נסו שוב מאוחר יותר; לא התקבל אישור שמירה.')
    }
  }
  for (const command of ['tasks', 'task_done', 'task_not_done']) bot.command(command, report)
  bot.on('text', async (ctx, next) => {
    if (!isTaskQuery(ctx.message?.text) || ctx.message.reply_to_message) return next()
    const sess = await getBotSession(ctx.chat.id)
    // Do not steal a booking subject, lead name or message addressed to the coach.
    if (sess.awaitingSubject || sess.awaitingMessage || sess.awaitingLeadName || sess.awaitingLeadContact) return next()
    return report(ctx)
  })
}
