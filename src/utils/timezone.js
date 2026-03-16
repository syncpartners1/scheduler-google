import { OWNER_TZ } from '../config.js'

/**
 * Build an .ics Blob URL for a confirmed booking.
 * Handles both virtual (Meet link) and in-person (address) meetings.
 */
export function buildIcsDataUri(booking) {
  const {
    name, email, subject, startISO, endISO,
    meetLink, locationMode, meetingLocation,
  } = booking

  const isInPerson  = locationMode === 'in_person'
  const icsLocation = isInPerson ? (meetingLocation || '') : (meetLink || '')
  const icsDesc     = isInPerson
    ? `Meeting location: ${meetingLocation || ''}`
    : `Google Meet: ${meetLink || ''}`

  const dtStart = toIcsDateTime(startISO, OWNER_TZ)
  const dtEnd   = toIcsDateTime(endISO,   OWNER_TZ)
  const uid     = `${Date.now()}-${Math.random().toString(36).slice(2)}@scheduler`
  const now     = toIcsDateTime(new Date().toISOString(), 'UTC').replace('Z', '')

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Scheduler//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${now}Z`,
    `DTSTART;TZID=${OWNER_TZ}:${dtStart}`,
    `DTEND;TZID=${OWNER_TZ}:${dtEnd}`,
    `SUMMARY:${escapeIcs(subject || 'Meeting')}`,
    `DESCRIPTION:${escapeIcs(icsDesc)}`,
    `LOCATION:${escapeIcs(icsLocation)}`,
    `ORGANIZER;CN=${escapeIcs(name)}:MAILTO:${email}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT15M',
    'ACTION:DISPLAY',
    'DESCRIPTION:Reminder',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' })
  return URL.createObjectURL(blob)
}

/**
 * Build a Google Calendar "Add to Calendar" URL.
 */
export function buildGoogleCalendarUrl(booking) {
  const {
    subject, startISO, endISO,
    meetLink, locationMode, meetingLocation,
  } = booking

  const toGCalDate = (iso) =>
    new Date(iso).toISOString().replace(/[-:]/g, '').replace('.000', '')

  const gcalLocation = locationMode === 'in_person' ? (meetingLocation || '') : (meetLink || '')
  const gcalDetails  = meetLink && locationMode !== 'in_person' ? `Google Meet: ${meetLink}` : ''

  const params = new URLSearchParams({ action: 'TEMPLATE' })
  params.set('text',  subject || 'Meeting')
  params.set('dates', `${toGCalDate(startISO)}/${toGCalDate(endISO)}`)
  if (gcalDetails)  params.set('details',  gcalDetails)
  if (gcalLocation) params.set('location', gcalLocation)

  return `https://calendar.google.com/calendar/render?${params}`
}

/**
 * Get a short timezone label for display, e.g. "PST", "GMT+2"
 */
export function tzAbbr(tz) {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone:     tz,
      timeZoneName: 'short',
    }).formatToParts(new Date()).find(p => p.type === 'timeZoneName')?.value || tz
  } catch {
    return tz
  }
}

// ── internal helpers ─────────────────────────────────────────────────────────

function toIcsDateTime(isoString, tz) {
  const d = new Date(isoString)
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year:    'numeric',
    month:   '2-digit',
    day:     '2-digit',
    hour:    '2-digit',
    minute:  '2-digit',
    second:  '2-digit',
    hour12:  false,
  }).formatToParts(d)
  const get = (t) => parts.find(p => p.type === t)?.value || '00'
  return `${get('year')}${get('month')}${get('day')}T${get('hour')}${get('minute')}${get('second')}`
}

function escapeIcs(str) {
  return String(str).replace(/[\\;,]/g, c => `\\${c}`).replace(/\n/g, '\\n')
}
