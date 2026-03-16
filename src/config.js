/**
 * Scheduling App Configuration
 *
 * Update these values to match your setup:
 *  1. Set GAS_URL after deploying your Google Apps Script web app
 *  2. Adjust WORKING_HOURS for your availability
 *  3. Update OWNER_NAME / OWNER_TZ if needed
 */

// ── GAS Backend URL ──────────────────────────────────────────────────────────
// Override in production via the VITE_GAS_URL environment variable.
// The fallback below is the deployed Google Apps Script Web App.
export const GAS_URL =
  import.meta.env.VITE_GAS_URL ||
  'https://script.google.com/macros/s/AKfycbxVe7r1QIZus4kwPlWk5T6ntKO8ebAtouz6dQzRuVgVd1bhbQMX5ZbQteJIORhv0LLB/exec'

// ── Owner / Calendar settings ────────────────────────────────────────────────
export const OWNER_NAME      = import.meta.env.VITE_OWNER_NAME      || 'Adi Ben-Nesher'
export const OWNER_PHOTO_URL = import.meta.env.VITE_OWNER_PHOTO_URL || '/adi.png'
export const OWNER_TZ        = 'Asia/Jerusalem'   // owner's timezone (Israel)

// ── Working hours (in OWNER_TZ) ──────────────────────────────────────────────
export const WORKING_HOURS = {
  start: 9,   // 09:00
  end:   18,  // 18:00
}

// ── Slot options (minutes) ───────────────────────────────────────────────────
// Kept for any code that still references it; meeting type durations are the source of truth.
export const SLOT_DURATIONS = [30, 60]

// ── Meeting types ─────────────────────────────────────────────────────────────
// defaultMode: 'virtual' | 'hybrid' | 'in_person'
export const MEETING_TYPES = [
  {
    id:          'intro_30',
    label:       'Introduction Meeting',
    subtitle:    'First call',
    duration:    30,
    defaultMode: 'virtual',
  },
  {
    id:          'general_30',
    label:       '30 min · General',
    subtitle:    'Quick meeting',
    duration:    30,
    defaultMode: 'hybrid',
  },
  {
    id:          'virtual_30',
    label:       '30 min · Virtual',
    subtitle:    'Online only',
    duration:    30,
    defaultMode: 'virtual',
  },
  {
    id:          'general_60',
    label:       '60 min · General',
    subtitle:    'Extended meeting',
    duration:    60,
    defaultMode: 'hybrid',
  },
  {
    id:          'coaching_60',
    label:       '60 min · Coaching / Advisory',
    subtitle:    'Paid session',
    duration:    60,
    defaultMode: 'hybrid',
  },
]

export const DEFAULT_MEETING_TYPE = MEETING_TYPES[0]  // Introduction Meeting (website default)

// ── Booking constraints ───────────────────────────────────────────────────────
export const MIN_NOTICE_HOURS = 2   // cannot book within 2 hours of now
export const BUFFER_MINS      = 15  // padding added around each busy block

// ── Days ahead to allow booking ───────────────────────────────────────────────
export const MAX_DAYS_AHEAD = 60
