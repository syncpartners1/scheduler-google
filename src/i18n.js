/**
 * Booking app i18n strings — English & Hebrew.
 * Usage: import { t } from '../i18n.js'
 *        t(lang, 'key')
 */

const strings = {
  en: {
    // ── Header ────────────────────────────────────────────────────────────────
    book_a_meeting:   'Book a Meeting',
    with_owner:       'with',
    switch_lang:      'עברית',
    powered_by:       'Powered by Google Calendar · Times shown in your local timezone',

    // ── Calendar ──────────────────────────────────────────────────────────────
    select_date:      'Select a Date',
    select_date_sub:  'Choose a day to see available times',
    days:             ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    months:           ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'],

    // ── Time slots ────────────────────────────────────────────────────────────
    select_time:      'Select a Time',
    meeting_type_lbl: 'Meeting Type',
    no_slots:         'No available slots',
    no_slots_hint:    'Try a different date or meeting type',
    loading:          'Loading availability…',
    times_in_tz:      'Times shown in your local timezone',

    // ── Meeting type labels & subtitles ───────────────────────────────────────
    mt_intro_30_label:    'Introduction Meeting',
    mt_intro_30_sub:      'First call',
    mt_general_30_label:  '30 min · General',
    mt_general_30_sub:    'Quick meeting',
    mt_virtual_30_label:  '30 min · Virtual',
    mt_virtual_30_sub:    'Online only',
    mt_general_60_label:  '60 min · General',
    mt_general_60_sub:    'Extended meeting',
    mt_coaching_60_label: '60 min · Coaching / Advisory',
    mt_coaching_60_sub:   'Paid session',

    // ── Booking form ─────────────────────────────────────────────────────────
    your_details:       'Your Details',
    israel_time_lbl:    'Israel time',
    full_name:          'Full Name',
    name_placeholder:   'Jane Smith',
    email_address:      'Email Address',
    email_placeholder:  'jane@example.com',
    meeting_subject:    'Meeting Subject',
    subject_placeholder:"Brief description of what you'd like to discuss",
    meeting_format:     'Meeting Format',
    virtual:            'Virtual',
    hybrid:             'Hybrid',
    in_person:          'In-Person',
    fmt_virtual_desc:   'Google Meet link',
    fmt_hybrid_desc:    'In-person + Meet link',
    fmt_inperson_desc:  'Provide an address',
    meeting_address:    'Meeting Address',
    addr_placeholder:   '123 Main St, Tel Aviv',
    confirm_booking:    'Confirm Booking',
    booking_loading:    'Booking…',

    // ── Validation errors ────────────────────────────────────────────────────
    err_name:           'Name is required',
    err_email_required: 'Email is required',
    err_email_invalid:  'Enter a valid email address',
    err_subject:        'Meeting subject is required',
    err_address:        'Meeting address is required for in-person meetings',

    // ── Confirmation ─────────────────────────────────────────────────────────
    youre_booked:       "You're booked!",
    invite_sent:        'A calendar invite has been sent to',
    det_meeting:        'Meeting',
    det_type:           'Type',
    det_your_time:      'Your time',
    det_israel:         'Israel time',
    det_format:         'Format',
    det_address:        'Address',
    det_with:           'With',
    fmt_virtual_lbl:    '🎥 Virtual',
    fmt_hybrid_lbl:     '🔀 Hybrid (In-person + Online)',
    fmt_inperson_lbl:   '📍 In-Person',
    join_meet:          'Join Google Meet',
    copy_meet:          'Copy Meet Link',
    copied:             'Copied!',
    add_google_cal:     'Add to Google Calendar',
    add_ics:            'Download .ics File',
    book_another:       'Book another meeting',
    hybrid_note:        "Can't make it in person? Join online via the Meet link above.",
  },

  he: {
    // ── Header ────────────────────────────────────────────────────────────────
    book_a_meeting:   'קביעת פגישה',
    with_owner:       'עם',
    switch_lang:      'English',
    powered_by:       'מופעל על ידי Google Calendar · השעות מוצגות באזור הזמן המקומי שלך',

    // ── Calendar ──────────────────────────────────────────────────────────────
    select_date:      'בחר תאריך',
    select_date_sub:  'בחר יום כדי לראות זמנים פנויים',
    days:             ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
    months:           ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
                       'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'],

    // ── Time slots ────────────────────────────────────────────────────────────
    select_time:      'בחר שעה',
    meeting_type_lbl: 'סוג פגישה',
    no_slots:         'אין זמנים פנויים',
    no_slots_hint:    'נסה תאריך אחר או סוג פגישה אחר',
    loading:          'טוען זמינות…',
    times_in_tz:      'השעות מוצגות באזור הזמן המקומי שלך',

    // ── Meeting type labels & subtitles ───────────────────────────────────────
    mt_intro_30_label:    'הכרות',
    mt_intro_30_sub:      'שיחה ראשונה',
    mt_general_30_label:  '30 דק׳ · כללי',
    mt_general_30_sub:    'פגישה קצרה',
    mt_virtual_30_label:  '30 דק׳ · וירטואלי',
    mt_virtual_30_sub:    'אונליין בלבד',
    mt_general_60_label:  '60 דק׳ · כללי',
    mt_general_60_sub:    'פגישה מורחבת',
    mt_coaching_60_label: '60 דק׳ · אימון / ייעוץ',
    mt_coaching_60_sub:   'פגישה בתשלום',

    // ── Booking form ─────────────────────────────────────────────────────────
    your_details:       'הפרטים שלך',
    israel_time_lbl:    'שעון ישראל',
    full_name:          'שם מלא',
    name_placeholder:   'ישראל ישראלי',
    email_address:      'כתובת אימייל',
    email_placeholder:  'israel@example.com',
    meeting_subject:    'נושא הפגישה',
    subject_placeholder:'תיאור קצר של מה שתרצה לדון בו',
    meeting_format:     'פורמט הפגישה',
    virtual:            'וירטואלי',
    hybrid:             'היברידי',
    in_person:          'פנים אל פנים',
    fmt_virtual_desc:   'קישור Google Meet',
    fmt_hybrid_desc:    'פנים אל פנים + Meet',
    fmt_inperson_desc:  'הזן כתובת',
    meeting_address:    'כתובת הפגישה',
    addr_placeholder:   'רחוב הרצל 1, תל אביב',
    confirm_booking:    'אישור הזמנה',
    booking_loading:    'מזמין…',

    // ── Validation errors ────────────────────────────────────────────────────
    err_name:           'שם הוא שדה חובה',
    err_email_required: 'אימייל הוא שדה חובה',
    err_email_invalid:  'הזן כתובת אימייל תקינה',
    err_subject:        'נושא הפגישה הוא שדה חובה',
    err_address:        'כתובת הפגישה נדרשת לפגישות פנים אל פנים',

    // ── Confirmation ─────────────────────────────────────────────────────────
    youre_booked:       '!ההזמנה אושרה',
    invite_sent:        'הזמנה ליומן נשלחה אל',
    det_meeting:        'פגישה',
    det_type:           'סוג',
    det_your_time:      'השעה שלך',
    det_israel:         'שעון ישראל',
    det_format:         'פורמט',
    det_address:        'כתובת',
    det_with:           'עם',
    fmt_virtual_lbl:    '🎥 וירטואלי',
    fmt_hybrid_lbl:     '🔀 היברידי (פנים + אונליין)',
    fmt_inperson_lbl:   '📍 פנים אל פנים',
    join_meet:          'הצטרף ל-Google Meet',
    copy_meet:          'העתק קישור Meet',
    copied:             '!הועתק',
    add_google_cal:     'הוסף ל-Google Calendar',
    add_ics:            'הורד קובץ .ics',
    book_another:       'קבע פגישה נוספת',
    hybrid_note:        'לא מצליח להגיע? הצטרף אונליין דרך קישור ה-Meet.',
  },
}

/**
 * Translate a key for the given language.
 * Returns the English fallback if the key is missing in the requested language.
 */
export function t(lang, key) {
  return strings[lang]?.[key] ?? strings.en[key] ?? key
}
