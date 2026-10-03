import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Runs the real lead.js with Firestore, ClickUp and Telegram replaced by stubs.
const source = readFileSync(new URL('./lead.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace('export function', 'function')

function harness({ clickupOk = true, replyFailsOnLink = false } = {}) {
  const replies = [], updates = [], docs = new Set()
  const ref = { update: async (v) => { updates.push(v) } }
  const db = { collection: () => ({ doc: () => ref }),
    runTransaction: async (fn) => fn({ get: async () => ({ exists: docs.has('x') }),
      create: () => { docs.add('x') } }) }
  const handlers = vm.runInNewContext(source + '\nregisterLeadHandlers(bot)', {
    crypto: {}, db, getBotSession: async () => ({}), saveBotSession: async () => {}, userRef: () => ({}),
    process: { env: { CLICKUP_API_TOKEN: 't', CLICKUP_LEAD_LIST_ID: 'l', ADMIN_TELEGRAM_ID: '1' } },
    bot: { action() {}, on() {}, telegram: { sendMessage: async () => {} } },
    fetch: async () => ({ ok: clickupOk, json: async () => (clickupOk ? { id: 'T1', url: 'https://u' } : {}) }),
    AbortController, setTimeout, clearTimeout, console: { error() {} },
  })
  const ctx = { from: { id: 7 }, chat: { id: 7 },
    message: { contact: { user_id: 7, phone_number: '972501234567' } },
    reply: async (text, extra) => {
      if (replyFailsOnLink && extra?.reply_markup?.inline_keyboard) throw new Error('telegram down')
      replies.push({ text, extra })
    } }
  const session = { awaitingLeadContact: true, leadName: 'נועה', leadType: 'call', leadId: 'L1' }
  return { run: () => handlers.handleContact(ctx, session), replies, updates }
}
const linkReplies = (h) => h.replies.filter((r) => r.extra?.reply_markup?.inline_keyboard)

test('successful lead gets the questionnaire button once, after the confirmation', async () => {
  const h = harness(); await h.run()
  assert.equal(linkReplies(h).length, 1)
  assert.equal(linkReplies(h)[0].extra.reply_markup.inline_keyboard[0][0].url, 'https://changenavigator.web.app/qualify-form')
  assert.match(h.replies[0].text, /הפנייה נרשמה/)
  assert.ok(h.updates.some((u) => u.questionnaireLinkSent === true))
})

test('ClickUp failure still gets the button; status stays needs_review', async () => {
  const h = harness({ clickupOk: false }); await h.run()
  assert.equal(linkReplies(h).length, 1)
  assert.ok(h.updates.some((u) => u.status === 'needs_review'))
})

test('a repeated submission sends no second link', async () => {
  const h = harness(); await h.run(); await h.run()
  assert.equal(linkReplies(h).length, 1)
})

test('a failed link message does not flip a created lead to needs_review', async () => {
  const h = harness({ replyFailsOnLink: true }); await h.run()
  assert.ok(!h.updates.some((u) => u.status === 'needs_review'))
  assert.ok(!h.updates.some((u) => u.questionnaireLinkSent))
})
