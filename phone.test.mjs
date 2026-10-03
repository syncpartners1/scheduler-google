import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizePhone } from './phone.js'

test('Israeli formats all become the same E.164 number', () => {
  for (const raw of ['050-123-4567', '0501234567', '972501234567', '501234567', '+972 50 123 4567',
                     '00972501234567', ' (050) 123.4567 ', '\u200e+972-50-123-4567']) {
    assert.equal(normalizePhone(raw), '+972501234567', raw)
  }
})

test('international numbers need + or 00 and are kept', () => {
  assert.equal(normalizePhone('+1 212 555 0100'), '+12125550100')
  assert.equal(normalizePhone('0044 20 7946 0958'), '+442079460958')
})

test('landline and 8-digit Israeli numbers work', () => {
  assert.equal(normalizePhone('03-123-4567'), '+97231234567')
  assert.equal(normalizePhone('+972-3-123-4567'), '+97231234567')
})

test('not a plausible number returns null, never a guess', () => {
  for (const raw of ['', '   ', null, undefined, 'abc', '12', '050-123', '+0501234567', '+123', '+1234567890123456',
                     '05012345678901', '+972 0 501234567', '٠٥٠١٢٣٤٥٦٧']) {
    assert.equal(normalizePhone(raw), null, String(raw))
  }
})

test('matches the AICOACH receiver on the shared fixtures', () => {
  const cases = { '050-123-4567': '+972501234567', '+1 212 555 0100': '+12125550100', '12': null }
  for (const [raw, want] of Object.entries(cases)) assert.equal(normalizePhone(raw), want)
})
