import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readPrefill } from './src/prefill.js'

const root = path.dirname(fileURLToPath(import.meta.url))
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

test('prefill reads name, email and subject and decodes Hebrew', () => {
  const q = '?type=diagnostic_60&name=' + encodeURIComponent('ישראל ישראלי') + '&email=a%40example.org&subject=' + encodeURIComponent('פגישת איבחון')
  assert.deepEqual(readPrefill(q), { name: 'ישראל ישראלי', email: 'a@example.org', subject: 'פגישת איבחון' })
})

test('prefill drops bad email, strips control characters and caps lengths', () => {
  const r = readPrefill('?name=' + 'x'.repeat(500) + '&email=not-an-email&subject=a%0D%0Ab%00c')
  assert.equal(r.name.length, 160)
  assert.equal(r.email, '')
  assert.equal(r.subject, 'a  b c')
  assert.deepEqual(readPrefill(''), { name: '', email: '', subject: '' })
  assert.equal(readPrefill('?email=' + 'a'.repeat(300) + '%40example.org').email, '')
})

test('diagnostic meeting type is 60 minutes, hidden from the public picker, labelled in Hebrew and English', () => {
  const config = read('src/config.js')
  const block = config.split("id:          'diagnostic_60'")[1].split('},')[0]
  assert.match(block, /duration:\s+60/)
  assert.match(block, /hidden:\s+true/)
  const i18n = read('src/i18n.js')
  assert.match(i18n, /mt_diagnostic_60_label:\s+'פגישת איבחון'/)
  assert.match(i18n, /mt_diagnostic_60_label:\s+'Diagnostic meeting'/)
  assert.match(read('src/components/TimeSlotPicker.jsx'), /filter\(mt => !mt\.hidden \|\| mt\.id === meetingType\.id\)/)
})
