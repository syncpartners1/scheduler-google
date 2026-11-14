/** Effective booking format for a public booking request.
 *
 *  The dedicated diagnostic route (?type=diagnostic_60) offers exactly two
 *  formats: Google Meet (virtual), always; or a clinic meeting at Adi's
 *  clinic, Fridays 09:00-12:00 Asia/Jerusalem only, with the meeting ending
 *  by 12:00. Hybrid is never offered on this route, and a client-supplied
 *  address is never used — clinic bookings always meet at the clinic.
 *
 *  Every other meeting type keeps the client's choice unchanged, defaulting
 *  to virtual exactly as before. */

// Adi's clinic address, from his 2026-11-07 WhatsApp: "כתובת הקליניקה היא:
// 33 ברשבסקי, קליניקה 103, קומה א', ראשון לציון (מעל קשת טעמים)".
export const CLINIC_ADDRESS = '33 ברשבסקי, קליניקה 103, קומה א\', ראשון לציון (מעל קשת טעמים)'

const OWNER_TZ = 'Asia/Jerusalem'
const CLINIC_WEEKDAY = 5          // Friday
const CLINIC_START_S = 9 * 3600   // 09:00 Jerusalem
const CLINIC_END_S   = 12 * 3600  // 12:00 Jerusalem; end is inclusive

/** Weekday (0=Sun..6=Sat) and seconds-since-midnight in Asia/Jerusalem. */
function jerusalemDayAndSeconds(instant) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: OWNER_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const part = t => parts.find(p => p.type === t).value
  const date = `${part('year')}-${part('month')}-${part('day')}`
  const seconds = Number(part('hour')) * 3600 + Number(part('minute')) * 60 + Number(part('second'))
  // UTC-noon weekday is timezone-independent for the date string.
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay()
  return { weekday, seconds }
}

/** True when a diagnostic slot (start ISO + duration minutes) falls inside
 *  the Friday 09:00-12:00 Jerusalem clinic window, ending by 12:00. */
export function isDiagnosticClinicSlot(startISO, duration) {
  const start = new Date(startISO)
  const minutes = Number(duration)
  if (Number.isNaN(start.getTime()) || !Number.isFinite(minutes) || minutes <= 0) return false
  const s = jerusalemDayAndSeconds(start)
  const e = jerusalemDayAndSeconds(new Date(start.getTime() + minutes * 60000))
  return s.weekday === CLINIC_WEEKDAY && e.weekday === CLINIC_WEEKDAY &&
    s.seconds >= CLINIC_START_S && e.seconds <= CLINIC_END_S
}

/** Resolve the effective format for a booking request.
 *  Returns { ok: true, locationMode, location } or { ok: false, code, error }. */
export function effectiveBookingFormat(meetingTypeId, locationMode, location, startISO, duration) {
  if (meetingTypeId !== 'diagnostic_60') {
    return { ok: true, locationMode: locationMode || 'virtual', location: location || '' }
  }
  const mode = locationMode || 'virtual'
  if (mode === 'virtual') return { ok: true, locationMode: 'virtual', location: '' }
  if (mode !== 'in_person') {
    return { ok: false, code: 'ERR_FORMAT',
             error: 'Diagnostic meetings are Google Meet or clinic (Fridays 09:00-12:00) only.' }
  }
  if (!isDiagnosticClinicSlot(startISO, duration)) {
    return { ok: false, code: 'ERR_CLINIC_HOURS',
             error: 'Clinic diagnostic meetings run Fridays 09:00-12:00 (Asia/Jerusalem) only.' }
  }
  return { ok: true, locationMode: 'in_person', location: CLINIC_ADDRESS }
}
