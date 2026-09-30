import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Run the actual production /start registration block with isolated dependencies.
// No bot token, Firestore, Telegram, or coaching network calls.
const source = readFileSync(new URL('./bot.js', import.meta.url), 'utf8')
const begin = source.indexOf('const registeredOptions =')
const end = source.indexOf("bot.action('home:book'", begin)
assert(begin >= 0 && end > begin)
function harness(profile = null, failure = false) {
  const replies = [], coaching = []
  let start
  const ctx = { from: { id: 42 }, reply: async (...args) => replies.push(args) }
  vm.runInNewContext(source.slice(begin, end), {
    Markup: {
      button: { callback: (text, callback_data) => ({ text, callback_data }),
        url: (text, url) => ({ text, url }) },
      inlineKeyboard: rows => ({ reply_markup: { inline_keyboard: rows } }),
    },
    bot: { start: fn => { start = fn } },
    userRef: id => { assert.equal(id, 42); return { get: async () => {
      if (failure) throw new Error('test lookup failure')
      return { exists: Boolean(profile), data: () => profile }
    } } },
    startCoaching: async value => coaching.push(value),
    console: { error() {} },
  })
  return { run: () => start(ctx), ctx, replies, coaching }
}
test('stranger start invites to verified questionnaire and keeps registration secondary', async () => {
  const h = harness(); await h.run()
  assert.equal(h.coaching.length, 0); assert.equal(h.replies.length, 1)
  assert.match(h.replies[0][0], /שאלון המוכנות/)
  const rows = h.replies[0][1].reply_markup.inline_keyboard
  assert.equal(rows.length, 2)
  assert.equal(rows[0][0].url, 'https://changenavigator.web.app/qualify-form')
  assert.equal(rows[1][0].callback_data, 'home:register')
  assert(!rows.flat().some(b => ['home:virtual','home:call'].includes(b.callback_data)))
})
test('registered start retains direct coaching and booking option, not questionnaire', async () => {
  const h = harness({ name: 'Test' }); await h.run()
  assert.equal(h.coaching.length, 1); assert.equal(h.coaching[0], h.ctx)
  assert.equal(h.replies[0][1].reply_markup.inline_keyboard[0][0].callback_data, 'home:book')
  assert.doesNotMatch(h.replies[0][0], /שאלון/)
})
test('lookup failure does not misclassify registered user as stranger', async () => {
  const h = harness(null, true); await h.run()
  assert.equal(h.coaching.length, 0); assert.equal(h.replies.length, 1)
  assert.match(h.replies[0][0], /לא ניתן לבדוק את ההרשמה/)
  assert.equal(h.replies[0].length, 1)
})
