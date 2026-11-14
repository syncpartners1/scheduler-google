import test from 'node:test'
import assert from 'node:assert'
import fs from 'node:fs'
import { effectiveBookingFormat, isDiagnosticClinicSlot, CLINIC_ADDRESS } from './booking-format.js'

// Behavioral tests use the exact shapes a client POST to /api/public/book
// produces after express JSON parsing. A true end-to-end POST through
// server.js is not practical in tests: the handler's booking outbox talks to
// Firestore directly, so the format decision is extracted and tested here,
// and the wiring is source-guarded below.
//
// Fridays: 2026-11-20 (winter, IST +02:00) and 2026-07-03 (summer, IDT
// +03:00) — the DST pair proves the window is computed in Asia/Jerusalem,
// not in the server's timezone. 2026-11-19 is a Thursday.

test('Google Meet is always allowed on the diagnostic route', () => {
  assert.deepEqual(
    effectiveBookingFormat('diagnostic_60', 'virtual', '', '2026-11-19T18:30:00+02:00', 60),
    { ok: true, locationMode: 'virtual', location: '' })
  assert.deepEqual(
    effectiveBookingFormat('diagnostic_60', undefined, undefined, '2026-11-19T18:30:00+02:00', 60),
    { ok: true, locationMode: 'virtual', location: '' })
})

test('clinic is allowed on a Friday morning slot, ending by 12:00, at the clinic address', () => {
  for (const startISO of ['2026-11-20T09:00:00+02:00', '2026-11-20T11:00:00+02:00', '2026-07-03T10:30:00+03:00']) {
    const r = effectiveBookingFormat('diagnostic_60', 'in_person', '1 Client St, Home', startISO, 60)
    assert.deepEqual(r, { ok: true, locationMode: 'in_person', location: CLINIC_ADDRESS }, startISO)
  }
})

test('clinic address is fixed — a client-supplied address is never used', () => {
  const r = effectiveBookingFormat('diagnostic_60', 'in_person', '5 Home Ave, Tel Aviv', '2026-11-20T10:00:00+02:00', 60)
  assert.equal(r.location, CLINIC_ADDRESS)
})

test('clinic rejected outside Friday 09:00-12:00: weekday, morning start, end boundary, DST', () => {
  const rejected = [
    ['Thursday evening slot', '2026-11-19T18:30:00+02:00', 60],
    ['Friday before 09:00', '2026-11-20T08:00:00+02:00', 60],
    ['Friday ending after 12:00', '2026-11-20T11:30:00+02:00', 60],
    ['Friday afternoon', '2026-11-20T13:00:00+02:00', 60],
    ['Summer Friday ending after 12:00 (IDT)', '2026-07-03T11:30:00+03:00', 60],
  ]
  for (const [label, startISO, duration] of rejected) {
    const r = effectiveBookingFormat('diagnostic_60', 'in_person', '', startISO, duration)
    assert.equal(r.ok, false, label)
    assert.equal(r.code, 'ERR_CLINIC_HOURS', label)
  }
})

test('end exactly at 12:00 is inside the window; start exactly 09:00 is inside', () => {
  assert.equal(isDiagnosticClinicSlot('2026-11-20T11:00:00+02:00', 60), true)
  assert.equal(isDiagnosticClinicSlot('2026-11-20T09:00:00+02:00', 60), true)
  assert.equal(isDiagnosticClinicSlot('2026-11-20T11:00:01+02:00', 60), false)
})

test('hybrid is rejected on the diagnostic route (no client-address Meet+visit)', () => {
  const r = effectiveBookingFormat('diagnostic_60', 'hybrid', '5 Home Ave, Tel Aviv', '2026-11-20T10:00:00+02:00', 60)
  assert.equal(r.ok, false)
  assert.equal(r.code, 'ERR_FORMAT')
})

test('public meeting types keep the client-chosen format and address, unchanged', () => {
  assert.deepEqual(
    effectiveBookingFormat('intro_30', 'in_person', 'Herzl 1, Rishon LeZion', '2026-11-19T18:30:00+02:00', 30),
    { ok: true, locationMode: 'in_person', location: 'Herzl 1, Rishon LeZion' })
  assert.deepEqual(
    effectiveBookingFormat('coaching_60', 'hybrid', 'Herzl 1', '2026-11-20T13:00:00+02:00', 60),
    { ok: true, locationMode: 'hybrid', location: 'Herzl 1' })
  assert.deepEqual(
    effectiveBookingFormat('intro_30', undefined, undefined, '2026-11-19T18:30:00+02:00', 30),
    { ok: true, locationMode: 'virtual', location: '' })
})

test('public book endpoint validates the whole clinic interval server-side; reschedule untouched', () => {
  const source = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8')
  const start = source.indexOf("app.post('/api/public/book'")
  const block = source.slice(start, source.indexOf('/**', start))
  assert(block.includes('effectiveBookingFormat(meetingTypeId, locationMode, location, startISO, duration)'))
  assert(block.includes("res.status(400).json({ ok: false, error: format.error, code: format.code })"))
  assert(block.includes('locationMode:     effectiveLocationMode'))
  assert(block.includes('location:         effectiveLocation'))
  // The coach-side reschedule path is intentionally not locked.
  const re = source.slice(source.indexOf("app.post('/api/admin/reschedule'"), source.indexOf("app.get('/admin-bookings'"))
  assert(!re.includes('effectiveBookingFormat'))
})
