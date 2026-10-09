import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { makeGasFetch } from './gas-auth.js'

const GAS = 'https://script.google.com/macros/s/TEST/exec'

function gasContext(secret) {
  const logs = []
  const ctx = {
    Logger: { log: (m) => logs.push(m) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k === 'GAS_SHARED_SECRET' ? secret : null) }) },
    ContentService: { createTextOutput: (t) => ({ t, setMimeType() { return this } }), MimeType: { JSON: 'json' } },
  }
  vm.createContext(ctx)
  vm.runInContext(fs.readFileSync(new URL('./gas/Code.gs', import.meta.url), 'utf8'), ctx)
  return { ctx, logs }
}

test('GAS: no property set keeps the gate off (rollout order)', () => {
  const { ctx } = gasContext('')
  assert.equal(ctx.checkSharedSecret('getAllBookings', {}, null), null)
})

test('GAS: with a secret, missing or wrong secret is rejected for every action', () => {
  const { ctx } = gasContext('s3cret-value')
  for (const action of ['getBusySlots', 'createEvent', 'cancelEvent', 'getBookings', 'getAllBookings', 'lookupNotificationBooking', 'listEvents', undefined]) {
    assert.equal(ctx.checkSharedSecret(action, {}, null).code, 'ERR_UNAUTHORIZED')
    assert.equal(ctx.checkSharedSecret(action, { secret: 'nope' }, null).code, 'ERR_UNAUTHORIZED')
    assert.equal(ctx.checkSharedSecret(action, {}, { secret: 's3cret-valuX' }).code, 'ERR_UNAUTHORIZED')
    assert.equal(ctx.checkSharedSecret(action, {}, { secret: 's3cret' }).code, 'ERR_UNAUTHORIZED')
  }
})

test('GAS: the right secret passes in the query or in the POST body; diagnostics stays public', () => {
  const { ctx } = gasContext('s3cret-value')
  assert.equal(ctx.checkSharedSecret('getAllBookings', { secret: 's3cret-value' }, null), null)
  assert.equal(ctx.checkSharedSecret('createEvent', {}, { secret: 's3cret-value' }), null)
  assert.equal(ctx.checkSharedSecret('diagnostics', {}, null), null)
})

test('GAS: handleRequest rejects before running the action and never logs or echoes the secret', () => {
  const { ctx, logs } = gasContext('s3cret-value')
  let ran = false
  ctx.getAllBookings = () => { ran = true; return { ok: true, bookings: [] } }
  const out = ctx.handleRequest({ parameter: { action: 'getAllBookings', secret: 'wrong-guess' } }, null)
  assert.equal(ran, false)
  assert.match(JSON.stringify(out), /ERR_UNAUTHORIZED/)
  assert.ok(![JSON.stringify(out), ...logs].join('').includes('wrong-guess'))
  const ok = ctx.handleRequest({ parameter: { action: 'getAllBookings', secret: 's3cret-value' } }, null)
  assert.equal(ran, true)
  assert.ok(!JSON.stringify(ok).includes('s3cret-value'))
})

test('GAS: diagnostics reports whether the gate is on, without the value', () => {
  assert.equal(gasContext('abc').ctx.getDiagnostics().authEnforced, true)
  assert.equal(gasContext('').ctx.getDiagnostics().authEnforced, false)
})

test('Node: gasFetch adds the secret to GAS POST bodies and GET queries only', async () => {
  const calls = []
  const gasFetch = makeGasFetch(GAS, 'k1', async (url, init) => { calls.push({ url, init }) })
  await gasFetch(GAS, { method: 'POST', headers: {}, body: JSON.stringify({ action: 'createEvent', name: 'a' }) })
  assert.deepEqual(JSON.parse(calls[0].init.body), { action: 'createEvent', name: 'a', secret: 'k1' })
  await gasFetch(`${GAS}?action=getBusySlots&date=2026-10-10`, { signal: 1 })
  assert.equal(calls[1].url, `${GAS}?action=getBusySlots&date=2026-10-10&secret=k1`)
  assert.equal(calls[1].init.signal, 1)
  await gasFetch(GAS)
  assert.equal(calls[2].url, `${GAS}?secret=k1`)
  await gasFetch('https://app.test/internal/booking-notifications', { method: 'POST', body: '{"a":1}' })
  assert.equal(calls[3].url, 'https://app.test/internal/booking-notifications')
  assert.equal(calls[3].init.body, '{"a":1}')
})

test('Node: without a secret nothing is changed', async () => {
  const calls = []
  const gasFetch = makeGasFetch(GAS, '', async (url, init) => { calls.push({ url, init }) })
  await gasFetch(`${GAS}?action=x`, undefined)
  assert.equal(calls[0].url, `${GAS}?action=x`)
})

test('Node: every GAS call in server.js goes through gasFetch except the public diagnostics check', () => {
  const src = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8')
  const raw = [...src.matchAll(/[^a-zA-Z]fetch\((GAS_URL|`\$\{GAS_URL\}[^`]*`)/g)].map((m) => m[1])
  assert.ok(raw.length > 0 && raw.every((u) => u.includes('action=diagnostics')), raw.join(' | '))
  assert.ok((src.match(/gasFetch\(/g) || []).length >= 9)
  assert.ok(src.includes('fetch:gasFetch'))
})

test('workflow passes the secret to Cloud Run and the Docker runtime copies gas-auth.js', () => {
  assert.ok(fs.readFileSync(new URL('./.github/workflows/deploy-gcp.yml', import.meta.url), 'utf8').includes('GAS_SHARED_SECRET=SCHEDULER_GOOGLE_GAS_SHARED_SECRET:latest'))
  assert.ok(fs.readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8').includes('gas-auth.js'))
})
