import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerTaskHandlers, isTaskQuery } from './task-routing.js'
function harness(session = {}, response = { status: 200, data: { ok: true, reply: '<b>Tasks</b>', parse_mode: 'HTML' } }) {
  const commands = {}, calls = [], replies = [], html = []
  let textHandler
  const bot = { command: (n, f) => { commands[n] = f }, on: (_, f) => { textHandler = f } }
  registerTaskHandlers(bot, { bridge: async (...args) => { calls.push(args); return response },
    getBotSession: async () => session, sendHtml: async (_, text) => html.push(text) })
  const ctx = { from: { id: 42 }, chat: { id: 42, type: 'private' }, update: { update_id: 123 },
    message: { text: '/tasks' }, reply: async text => replies.push(text) }
  return { commands, calls, replies, html, ctx, text: (...args) => textHandler(...args) }
}
test('all commands carry exact identity and original update ID; retry keeps same ID', async () => {
  const h = harness()
  for (const name of ['tasks', 'task_done', 'task_not_done']) {
    h.ctx.message.text = '/' + name + (name === 'tasks' ? '' : ' 00000000-0000-4000-8000-000000000001')
    await h.commands[name](h.ctx); await h.commands[name](h.ctx)
  }
  assert.equal(h.calls.length, 6)
  for (const [path, opts] of h.calls) { assert.equal(path, '/internal/telegram/tasks'); assert.equal(opts.body.update_id, 123); assert.equal(opts.body.telegram_id, 42); assert.equal(opts.method, 'POST') }
  assert.equal(h.html.length, 6)
})
test('addressed slash command normalized; no update ID and groups rejected', async () => {
  const h = harness(); h.ctx.message.text = '/tasks@Change_navigator_bot'; await h.commands.tasks(h.ctx)
  assert.equal(h.calls[0][1].body.text, '/tasks')
  h.ctx.update = {}; await h.commands.tasks(h.ctx); h.ctx.update = { update_id: 123 }; h.ctx.chat.type = 'group'; await h.commands.tasks(h.ctx)
  assert.equal(h.calls.length, 1); assert.equal(h.replies.length, 2)
})
test('exact natural queries route without active session; ambiguous completion requests select only', async () => {
  for (const text of ['מה המשימה שלי?', 'what are my tasks', 'סיימתי', 'לא השלמתי']) {
    const h = harness(); h.ctx.message.text = text; await h.text(h.ctx, () => assert.fail('unexpected fallthrough')); assert.equal(h.calls[0][1].body.text, text)
  }
  assert.equal(isTaskQuery('I finished my shopping'), false)
})
test('pending flows and admin replies retain precedence; active coaching query bypasses chat', async () => {
  for (const key of ['awaitingSubject','awaitingMessage','awaitingLeadName','awaitingLeadContact']) {
    const h = harness({ [key]: true }); h.ctx.message.text = 'סיימתי'; let next = false; await h.text(h.ctx, () => { next = true }); assert(next); assert.equal(h.calls.length, 0)
  }
  const h = harness({ coachActive: true }); h.ctx.message.text = 'סיימתי'; await h.text(h.ctx, () => assert.fail()); assert.equal(h.calls.length, 1)
  h.ctx.message.reply_to_message = {}; await h.text(h.ctx, () => {}); assert.equal(h.calls.length, 1)
})
test('bridge error never claims saved; plain reply not treated as HTML', async () => {
  const h = harness({}, { status: 503, data: {} }); await h.commands.tasks(h.ctx); assert.equal(h.html.length, 0); assert(h.replies[0].includes('לא התקבל אישור'))
  const p = harness({}, { status: 200, data: { ok: true, reply: 'plain' } }); await p.commands.tasks(p.ctx); assert.deepEqual(p.replies, ['plain'])
})
