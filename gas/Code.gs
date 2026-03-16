/**
 * ============================================================
 *  SCHEDULING APP — Google Apps Script Backend (Code.gs)
 * ============================================================
 *
 * This script acts as the API bridge between the React web app
 * and your Google Calendar. It runs entirely in Google's cloud
 * for free, with no server required.
 *
 * ── SETUP INSTRUCTIONS ──────────────────────────────────────
 *
 *  1. Go to https://script.google.com → click "New project"
 *  2. Delete any existing code and paste this entire file
 *  3. Set OWNER_CALENDAR_ID below (usually your Gmail address)
 *  4. Enable the Calendar Advanced Service:
 *       Extensions → Apps Script → Services (+)
 *       Find "Google Calendar API" → Add → OK
 *  5. (Optional) Set up Google Sheet booking log:
 *       a. Create a new Google Sheet at https://sheets.google.com
 *       b. Copy its ID from the URL (the long string between /d/ and /edit)
 *       c. Paste the ID as BOOKING_SHEET_ID below
 *       d. The script will auto-create the "Bookings" tab and header row
 *          on the first booking.
 *  6. Deploy as a Web App:
 *       Deploy → New deployment → Web app
 *       - Description: "Scheduling API v1"
 *       - Execute as: Me
 *       - Who has access: Anyone
 *       → Click Deploy → Authorize (grant Calendar + Gmail + Sheets access)
 *  7. Copy the Web App URL
 *  8. Paste it as VITE_GAS_URL in your Railway environment variables
 *     AND as GAS_URL for the server-side Express proxy.
 *
 * ── RE-DEPLOYING AFTER CHANGES ──────────────────────────────
 *  Any code changes require a NEW deployment version:
 *  Deploy → Manage deployments → Edit (pencil icon) → New version → Deploy
 *
 * ── TESTING ─────────────────────────────────────────────────
 *  Open in browser (replace YOUR_DATE):
 *  YOUR_WEB_APP_URL?action=getBusySlots&date=2024-01-15&tz=UTC&duration=30
 *  You should get a JSON response with a `busySlots` array.
 *
 * ============================================================
 */

// ─────────────────────────────────────────────────────────────
//  CONFIGURATION — update these values
// ─────────────────────────────────────────────────────────────

/** Your Google Calendar ID. Usually your Gmail address. */
const OWNER_CALENDAR_ID = 'syncpartners1@gmail.com'

/** Timezone for your working hours (IANA format). */
const OWNER_TZ = 'Asia/Jerusalem'

/** Working hours in OWNER_TZ (24-hour, inclusive start, exclusive end). */
const WORKING_HOURS = { start: 9, end: 18 }

/** Buffer added before and after each existing event (minutes). */
const BUFFER_MINS = 15

/** Minimum notice period — cannot book within this many hours from now. */
const MIN_NOTICE_HOURS = 2

/**
 * Google Spreadsheet ID for booking log.
 * Leave empty ('') to disable sheet logging.
 *
 * How to find it: open your Google Sheet and copy the ID from the URL:
 *   https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
 *
 * The script will automatically create a header row on first use.
 * The sheet must be accessible to the account running this script.
 */
const BOOKING_SHEET_ID = '1LGD1_3SkTecbMRmGcIfaD0wpEcKB3gBMrfS2xJjMOGg'

/**
 * Name of the tab (worksheet) inside the spreadsheet where rows are appended.
 * Will be created automatically if it doesn't exist.
 */
const BOOKING_SHEET_TAB = 'Bookings'

// ─────────────────────────────────────────────────────────────
//  HTTP ROUTER
// ─────────────────────────────────────────────────────────────

function doGet(e) {
  return handleRequest(e, null)
}

function doPost(e) {
  let body = null
  try {
    body = JSON.parse(e.postData.contents)
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }
  return handleRequest(e, body)
}

function handleRequest(e, body) {
  const action = (e.parameter && e.parameter.action) || (body && body.action)

  try {
    switch (action) {
      case 'getBusySlots':
        return jsonResponse(getBusySlots(e.parameter))
      case 'createEvent':
        return jsonResponse(createEvent(body))
      case 'cancelEvent':
        return jsonResponse(cancelEvent(body))
      case 'getBookings':
        return jsonResponse(getBookings(e.parameter))
      default:
        return jsonResponse({ error: `Unknown action: ${action}` }, 400)
    }
  } catch (err) {
    Logger.log('Error in handleRequest: ' + err.message + '\n' + err.stack)
    return jsonResponse({ error: err.message }, 500)
  }
}

function jsonResponse(data, statusCode) {
  // GAS ContentService always returns 200; status codes are informational here
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON)
}

// ─────────────────────────────────────────────────────────────
//  GET BUSY SLOTS
// ─────────────────────────────────────────────────────────────

/**
 * Return the busy blocks for a given calendar date.
 *
 * Params:
 *   date     – 'YYYY-MM-DD'
 *   tz       – visitor's IANA timezone (used only for context; response is UTC ISO)
 *   duration – slot duration in minutes (30 | 60)
 *
 * Response:
 *   { busySlots: [{start: ISO, end: ISO}] }
 *   Each block is already expanded by BUFFER_MINS on both sides.
 */
function getBusySlots(params) {
  const dateStr  = params.date                // 'YYYY-MM-DD'
  const duration = Number(params.duration) || 30

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error('date param required (YYYY-MM-DD)')
  }

  // Build start/end of the day in OWNER_TZ
  const [year, mon, day] = dateStr.split('-').map(Number)
  const dayStart = new Date(Date.UTC(year, mon - 1, day, 0, 0, 0))
  const dayEnd   = new Date(Date.UTC(year, mon - 1, day, 23, 59, 59))

  // Shift from UTC to OWNER_TZ (approximate — GAS CalendarApp uses the script's tz)
  const calendar = CalendarApp.getCalendarById(OWNER_CALENDAR_ID)
  if (!calendar) throw new Error('Calendar not found. Check OWNER_CALENDAR_ID.')

  const events = calendar.getEvents(dayStart, dayEnd)

  const busySlots = events
    .filter(e => !e.isAllDayEvent())
    .map(e => {
      const bufMs = BUFFER_MINS * 60 * 1000
      return {
        start: new Date(e.getStartTime().getTime() - bufMs).toISOString(),
        end:   new Date(e.getEndTime().getTime()   + bufMs).toISOString(),
      }
    })

  return { busySlots }
}

// ─────────────────────────────────────────────────────────────
//  CREATE EVENT
// ─────────────────────────────────────────────────────────────

/**
 * Create a Google Calendar event with a Google Meet link.
 *
 * Body params:
 *   name       – attendee's full name
 *   email      – attendee's email (receives calendar invite)
 *   subject    – meeting title / description
 *   startISO   – UTC ISO string for meeting start
 *   duration   – meeting length in minutes (30 | 60)
 *   userTz     – attendee's IANA timezone (stored in event description)
 *   requestId  – idempotency key (prevents duplicate events on retry)
 *
 * Response (success):
 *   { ok: true, eventId, meetLink, startISO, endISO }
 *
 * Response (error):
 *   { ok: false, error: '...' }
 */
function createEvent(body) {
  const { name, email, subject, startISO, duration, userTz, requestId } = body

  if (!name || !email || !startISO || !duration) {
    throw new Error('Missing required fields: name, email, startISO, duration')
  }

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRe.test(email)) throw new Error('Invalid email address')

  const startTime = new Date(startISO)
  const endTime   = new Date(startTime.getTime() + Number(duration) * 60 * 1000)

  // ── Minimum notice check ─────────────────────────────────
  const minNoticeMs = MIN_NOTICE_HOURS * 60 * 60 * 1000
  if (startTime.getTime() - Date.now() < minNoticeMs) {
    return { ok: false, error: `Must book at least ${MIN_NOTICE_HOURS} hours in advance` }
  }

  // ── Idempotency check ────────────────────────────────────
  if (requestId) {
    const existing = findEventByRequestId(requestId, startTime)
    if (existing) {
      const meetLink = getMeetLinkFromEvent(existing)
      return {
        ok:       true,
        eventId:  existing.getId(),
        meetLink: meetLink,
        startISO: existing.getStartTime().toISOString(),
        endISO:   existing.getEndTime().toISOString(),
      }
    }
  }

  // ── Double-booking check ──────────────────────────────────
  const calendar = CalendarApp.getCalendarById(OWNER_CALENDAR_ID)
  if (!calendar) throw new Error('Calendar not found. Check OWNER_CALENDAR_ID.')

  const bufMs     = BUFFER_MINS * 60 * 1000
  const checkFrom = new Date(startTime.getTime() - bufMs)
  const checkTo   = new Date(endTime.getTime()   + bufMs)
  const conflicts = calendar.getEvents(checkFrom, checkTo)

  if (conflicts.length > 0) {
    return { ok: false, error: 'Time slot is no longer available. Please pick another.' }
  }

  // ── Create the event via Advanced Calendar Service ────────
  // conferenceDataVersion:1 triggers automatic Google Meet link generation
  const eventResource = {
    summary:     subject || `Meeting with ${name}`,
    description: [
      `Booked via Scheduling App`,
      `Attendee: ${name} <${email}>`,
      `Timezone: ${userTz || 'UTC'}`,
      requestId ? `RequestId: ${requestId}` : '',
    ].filter(Boolean).join('\n'),
    start:  { dateTime: startTime.toISOString(), timeZone: OWNER_TZ },
    end:    { dateTime: endTime.toISOString(),   timeZone: OWNER_TZ },
    attendees: [
      { email: email, displayName: name },
    ],
    conferenceData: {
      createRequest: {
        requestId:             Utilities.getUuid(),
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'email', minutes: 60 },
        { method: 'popup', minutes: 15 },
      ],
    },
  }

  const createdEvent = Calendar.Events.insert(
    eventResource,
    OWNER_CALENDAR_ID,
    { conferenceDataVersion: 1, sendUpdates: 'all' }
  )

  const meetLink = createdEvent.conferenceData
    && createdEvent.conferenceData.entryPoints
    && createdEvent.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video')
      ? createdEvent.conferenceData.entryPoints.find(ep => ep.entryPointType === 'video').uri
      : 'https://meet.google.com'

  // Log the confirmed booking to Google Sheets (non-blocking)
  logBookingToSheet({
    name,
    email,
    subject,
    startISO:  createdEvent.start.dateTime,
    endISO:    createdEvent.end.dateTime,
    duration:  Number(duration),
    meetLink,
    eventId:   createdEvent.id,
    userTz:    userTz || '',
    requestId: requestId || '',
  })

  return {
    ok:       true,
    eventId:  createdEvent.id,
    meetLink: meetLink,
    startISO: createdEvent.start.dateTime,
    endISO:   createdEvent.end.dateTime,
  }
}

// ─────────────────────────────────────────────────────────────
//  CANCEL EVENT
// ─────────────────────────────────────────────────────────────

/**
 * Cancel (delete) a Google Calendar event by its eventId.
 * Sends cancellation notifications to all attendees.
 *
 * Body params:
 *   eventId   – the Google Calendar event ID (returned by createEvent)
 *   reason    – optional cancellation reason (stored in sheet log)
 *
 * Response (success):
 *   { ok: true, eventId }
 *
 * Response (error):
 *   { ok: false, error: '...' }
 */
function cancelEvent(body) {
  const { eventId, reason } = body

  if (!eventId) {
    throw new Error('Missing required field: eventId')
  }

  // Verify the event exists and belongs to our calendar before deleting
  const calendar = CalendarApp.getCalendarById(OWNER_CALENDAR_ID)
  if (!calendar) throw new Error('Calendar not found. Check OWNER_CALENDAR_ID.')

  let event = null
  try {
    // CalendarApp can fetch by ID directly
    event = calendar.getEventById(eventId)
  } catch (_) {
    // getEventById throws if not found in some GAS versions
  }

  if (!event) {
    return { ok: false, error: 'Event not found or already cancelled.' }
  }

  // Capture details for the sheet log before deleting
  const startISO   = event.getStartTime().toISOString()
  const endISO     = event.getEndTime().toISOString()
  const title      = event.getTitle()
  const desc       = event.getDescription() || ''

  // Delete the event and notify attendees
  event.deleteEvent()

  // Log cancellation to Google Sheet
  logCancellationToSheet({
    eventId,
    title,
    startISO,
    endISO,
    reason: reason || '',
    description: desc,
  })

  return { ok: true, eventId }
}

// ─────────────────────────────────────────────────────────────
//  GET BOOKINGS (from Google Sheet)
// ─────────────────────────────────────────────────────────────

/**
 * Return upcoming bookings for a given email address by reading the
 * Bookings sheet. Only returns future meetings (start time >= now).
 *
 * Params:
 *   email – the attendee's email address
 *
 * Response:
 *   { ok: true, bookings: [{eventId, name, email, subject, startISO, endISO, duration, meetLink}] }
 */
function getBookings(params) {
  const email = (params.email || '').trim().toLowerCase()
  if (!email) throw new Error('email param required')

  if (!BOOKING_SHEET_ID) {
    return { ok: true, bookings: [] }
  }

  const ss    = SpreadsheetApp.openById(BOOKING_SHEET_ID)
  const sheet = ss.getSheetByName(BOOKING_SHEET_TAB)
  if (!sheet || sheet.getLastRow() <= 1) {
    return { ok: true, bookings: [] }
  }

  // Sheet columns (1-indexed):
  // 1=Timestamp 2=Name 3=Email 4=Subject 5=Start(UTC) 6=End(UTC)
  // 7=Duration  8=MeetLink 9=EventId 10=UserTz 11=RequestId
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 11).getValues()
  const now  = new Date()

  const bookings = data
    .filter(row => {
      const rowEmail = String(row[2] || '').trim().toLowerCase()
      const startISO = String(row[4] || '')
      if (rowEmail !== email) return false
      if (!startISO) return false
      return new Date(startISO) >= now   // only future meetings
    })
    .map(row => ({
      eventId:  String(row[8]  || ''),
      name:     String(row[1]  || ''),
      email:    String(row[2]  || ''),
      subject:  String(row[3]  || ''),
      startISO: String(row[4]  || ''),
      endISO:   String(row[5]  || ''),
      duration: Number(row[6]  || 0),
      meetLink: String(row[7]  || ''),
    }))
    .sort((a, b) => new Date(a.startISO) - new Date(b.startISO))

  return { ok: true, bookings }
}

// ─────────────────────────────────────────────────────────────
//  GOOGLE SHEET LOGGING
// ─────────────────────────────────────────────────────────────

/**
 * Append a booking record to the configured Google Sheet.
 * Silently skips if BOOKING_SHEET_ID is not set.
 *
 * Sheet columns (auto-created header row on first use):
 *   Timestamp | Name | Email | Subject | Start Time | End Time |
 *   Duration (min) | Meet Link | Event ID | User Timezone | Request ID
 *
 * @param {Object} params
 * @param {string} params.name
 * @param {string} params.email
 * @param {string} params.subject
 * @param {string} params.startISO  – UTC ISO string
 * @param {string} params.endISO    – UTC ISO string
 * @param {number} params.duration  – minutes
 * @param {string} params.meetLink
 * @param {string} params.eventId
 * @param {string} params.userTz    – IANA timezone of the attendee
 * @param {string} params.requestId
 */
function logBookingToSheet(params) {
  if (!BOOKING_SHEET_ID) return   // logging disabled

  try {
    const ss  = SpreadsheetApp.openById(BOOKING_SHEET_ID)
    let sheet = ss.getSheetByName(BOOKING_SHEET_TAB)

    // Create the tab if it doesn't exist yet
    if (!sheet) {
      sheet = ss.insertSheet(BOOKING_SHEET_TAB)
    }

    // Write the header row if the sheet is empty
    if (sheet.getLastRow() === 0) {
      sheet.appendRow([
        'Timestamp',
        'Name',
        'Email',
        'Subject',
        'Start Time (UTC)',
        'End Time (UTC)',
        'Duration (min)',
        'Meet Link',
        'Event ID',
        'User Timezone',
        'Request ID',
      ])

      // Bold + freeze the header row for readability
      sheet.getRange(1, 1, 1, 11).setFontWeight('bold')
      sheet.setFrozenRows(1)
    }

    sheet.appendRow([
      new Date(),              // Timestamp (logged at booking time)
      params.name,
      params.email,
      params.subject   || '',
      params.startISO  || '',
      params.endISO    || '',
      params.duration  || '',
      params.meetLink  || '',
      params.eventId   || '',
      params.userTz    || '',
      params.requestId || '',
    ])

    Logger.log('logBookingToSheet: row appended for ' + params.email)
  } catch (err) {
    // Non-fatal — don't let a sheet error break the booking response
    // Check execution log (View → Executions) in Apps Script editor to diagnose
    Logger.log('logBookingToSheet ERROR: ' + err.message + ' | sheetId=' + BOOKING_SHEET_ID)
    console.error('logBookingToSheet ERROR:', err.message)
  }
}

// ─────────────────────────────────────────────────────────────
//  DIAGNOSTIC — run manually from Apps Script editor to verify
//  sheet access before relying on real bookings.
//  Steps: open script editor → select testSheetAccess → Run
// ─────────────────────────────────────────────────────────────

/**
 * Manual test function — run this from the Apps Script editor to
 * check that the sheet is accessible and writable.
 * Open: Extensions → Apps Script → select testSheetAccess → Run
 * Check the Execution Log (View → Executions) for the result.
 */
function testSheetAccess() {
  if (!BOOKING_SHEET_ID) {
    Logger.log('BOOKING_SHEET_ID is empty — sheet logging is disabled')
    return
  }

  try {
    const ss = SpreadsheetApp.openById(BOOKING_SHEET_ID)
    Logger.log('✅ Opened spreadsheet: ' + ss.getName() + ' (' + ss.getId() + ')')

    let sheet = ss.getSheetByName(BOOKING_SHEET_TAB)
    if (!sheet) {
      sheet = ss.insertSheet(BOOKING_SHEET_TAB)
      Logger.log('✅ Created new tab: ' + BOOKING_SHEET_TAB)
    } else {
      Logger.log('✅ Found existing tab: ' + BOOKING_SHEET_TAB + ' (' + sheet.getLastRow() + ' rows)')
    }

    // Write a test row
    logBookingToSheet({
      name:      'TEST USER',
      email:     'test@example.com',
      subject:   'TEST BOOKING — safe to delete',
      startISO:  new Date().toISOString(),
      endISO:    new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      duration:  30,
      meetLink:  'https://meet.google.com/test',
      eventId:   'test-event-id-' + Date.now(),
      userTz:    'Asia/Jerusalem',
      requestId: 'test-' + Date.now(),
    })

    Logger.log('✅ Test row written successfully. Check the Bookings tab in your sheet.')
    Logger.log('Sheet URL: https://docs.google.com/spreadsheets/d/' + BOOKING_SHEET_ID)
  } catch (err) {
    Logger.log('❌ testSheetAccess FAILED: ' + err.message)
    Logger.log('Possible causes:')
    Logger.log('  1. Script does not have Sheets permission — re-authorize: Deploy → Manage deployments → Edit → New version → Deploy')
    Logger.log('  2. Sheet ID is wrong or sheet was deleted')
    Logger.log('  3. Sheet is not shared with the account running this script (' + Session.getActiveUser().getEmail() + ')')
  }
}

/**
 * Log a cancellation to a separate "Cancellations" tab in the same spreadsheet.
 * Silently skips if BOOKING_SHEET_ID is not set.
 */
function logCancellationToSheet(params) {
  if (!BOOKING_SHEET_ID) return

  try {
    const ss        = SpreadsheetApp.openById(BOOKING_SHEET_ID)
    const tabName   = 'Cancellations'
    let sheet       = ss.getSheetByName(tabName)

    if (!sheet) {
      sheet = ss.insertSheet(tabName)
    }

    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Event ID', 'Title', 'Start Time (UTC)', 'End Time (UTC)', 'Reason'])
      sheet.getRange(1, 1, 1, 6).setFontWeight('bold')
      sheet.setFrozenRows(1)
    }

    sheet.appendRow([
      new Date(),
      params.eventId   || '',
      params.title     || '',
      params.startISO  || '',
      params.endISO    || '',
      params.reason    || '',
    ])
  } catch (err) {
    Logger.log('logCancellationToSheet error: ' + err.message)
  }
}

// ─────────────────────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────────────────────

/**
 * Find an existing calendar event whose description contains a requestId.
 * Searches the day of startTime ± 1 day to handle tz edge cases.
 */
function findEventByRequestId(requestId, startTime) {
  const calendar = CalendarApp.getCalendarById(OWNER_CALENDAR_ID)
  const from = new Date(startTime.getTime() - 24 * 60 * 60 * 1000)
  const to   = new Date(startTime.getTime() + 24 * 60 * 60 * 1000)
  const events = calendar.getEvents(from, to)
  return events.find(e => (e.getDescription() || '').includes(`RequestId: ${requestId}`)) || null
}

/**
 * Extract a Google Meet video link from a CalendarApp Event object.
 */
function getMeetLinkFromEvent(event) {
  // CalendarApp Event objects don't expose conferenceData directly,
  // so we fall back to checking the location field (GAS sets it).
  const loc = event.getLocation() || ''
  if (loc.startsWith('https://meet.google.com')) return loc

  // Try parsing from description
  const desc = event.getDescription() || ''
  const match = desc.match(/https:\/\/meet\.google\.com\/[a-z-]+/)
  return match ? match[0] : 'https://meet.google.com'
}
