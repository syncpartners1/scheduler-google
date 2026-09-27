/** Client-facing coaching windows in Asia/Jerusalem; 0=Sun ... 6=Sat. */
export const COACHING_WINDOWS = {
  1: { start: 18, end: 21 }, // Monday
  2: { start: 18, end: 21 }, // Tuesday
  4: { start: 18, end: 21 }, // Thursday
  5: { start: 9, end: 15 },  // Friday
}
export const OWNER_TZ = 'Asia/Jerusalem'

const hebrewDate = new Intl.DateTimeFormat('en-u-ca-hebrew', {
  timeZone: OWNER_TZ, day: 'numeric', month: 'long', year: 'numeric',
})

/** Hebrew calendar dates, recalculated each year; not all Tishri holidays are closed. */
export function isClosedHoliday(dateStr) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return true
  const date = new Date(`${dateStr}T12:00:00Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateStr) return true
  const parts = hebrewDate.formatToParts(date)
  const value = (type) => parts.find(p => p.type === type)?.value
  const day = Number(value('day'))
  return value('month') === 'Tishri' && (day === 1 || day === 2 || day === 10)
}

export function windowForDate(dateStr) {
  if (isClosedHoliday(dateStr)) return null
  // Use UTC noon so the weekday does not depend on the server's timezone.
  const d = new Date(`${dateStr}T12:00:00Z`)
  return COACHING_WINDOWS[d.getUTCDay()] || null
}

function localParts(instant) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: OWNER_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant)
  const part = (type) => parts.find(p => p.type === type).value
  return { date: `${part('year')}-${part('month')}-${part('day')}`, seconds: Number(part('hour')) * 3600 + Number(part('minute')) * 60 + Number(part('second')) }
}

/** Check both ends, in owner-local time; never let a booking cross a day/window. */
export function isCoachingWindow(startISO, duration) {
  const start = new Date(startISO)
  const minutes = Number(duration)
  if (Number.isNaN(start.getTime()) || !Number.isFinite(minutes) || minutes <= 0) return false
  const end = new Date(start.getTime() + minutes * 60000)
  const localStart = localParts(start)
  const localEnd = localParts(end)
  const window = windowForDate(localStart.date)
  return !!window && localStart.date === localEnd.date &&
    localStart.seconds >= window.start * 3600 && localEnd.seconds <= window.end * 3600
}
