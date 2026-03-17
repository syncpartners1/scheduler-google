import { useState, useEffect, useCallback } from 'react'
import CalendarPicker     from './components/CalendarPicker.jsx'
import TimeSlotPicker     from './components/TimeSlotPicker.jsx'
import BookingForm        from './components/BookingForm.jsx'
import ConfirmationScreen from './components/ConfirmationScreen.jsx'
import { GAS_URL, OWNER_NAME, OWNER_PHOTO_URL, DEFAULT_MEETING_TYPE, MEETING_TYPES } from './config.js'
import { saveBooking }    from './supabaseClient.js'
import { t }              from './i18n.js'

// Detect if we are embedded as an iframe (Wix or other)
const IS_EMBED = window.self !== window.top ||
  new URLSearchParams(window.location.search).get('embed') === 'true'

/** Read ?lang=he|en from URL, default to 'en' */
function detectLang() {
  const p = new URLSearchParams(window.location.search).get('lang')
  return p === 'he' ? 'he' : 'en'
}

/** Read ?type=<meeting_type_id> from URL */
function detectMeetingType() {
  const id = new URLSearchParams(window.location.search).get('type')
  return MEETING_TYPES.find(mt => mt.id === id) || DEFAULT_MEETING_TYPE
}

export default function App() {
  const [lang,          setLang]          = useState(detectLang)
  const [step,          setStep]          = useState('calendar')
  const [selectedDate,  setSelectedDate]  = useState(null)
  const [busySlots,     setBusySlots]     = useState([])
  const [slotsLoading,  setSlotsLoading]  = useState(false)
  const [slotsError,    setSlotsError]    = useState(null)
  const [selectedSlot,  setSelectedSlot]  = useState(null)
  const [meetingType,   setMeetingType]   = useState(detectMeetingType)
  const [booking,       setBooking]       = useState(null)
  const [userTz]                          = useState(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone
  )

  // Lifted form state — preserved when user goes back to change time slot
  const [formData, setFormData] = useState({
    name:            '',
    email:           '',
    subject:         '',
    locationMode:    DEFAULT_MEETING_TYPE.defaultMode,
    meetingLocation: '',
  })

  const isRTL = lang === 'he'

  // Sync lang into <html dir> so the whole page gets RTL layout
  useEffect(() => {
    document.documentElement.dir  = isRTL ? 'rtl' : 'ltr'
    document.documentElement.lang = lang
  }, [lang, isRTL])

  const toggleLang = () => setLang(l => l === 'en' ? 'he' : 'en')

  // Fetch busy slots from GAS whenever the selected date or meeting type changes
  const fetchBusySlots = useCallback(async (date, mt) => {
    if (!date) return
    setSlotsLoading(true)
    setSlotsError(null)
    setBusySlots([])

    const yyyy    = date.getFullYear()
    const mm      = String(date.getMonth() + 1).padStart(2, '0')
    const dd      = String(date.getDate()).padStart(2, '0')
    const params  = new URLSearchParams({
      action:   'getBusySlots',
      date:     `${yyyy}-${mm}-${dd}`,
      tz:       userTz,
      duration: String(mt.duration),
    })

    try {
      const res  = await fetch(`${GAS_URL}?${params}`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setBusySlots(data.busySlots || [])
    } catch (err) {
      console.error('[GAS] getBusySlots failed:', err)
      setSlotsError('Could not load availability. Please try again.')
    } finally {
      setSlotsLoading(false)
    }
  }, [userTz])

  useEffect(() => {
    if (selectedDate) fetchBusySlots(selectedDate, meetingType)
  }, [selectedDate, meetingType, fetchBusySlots])

  const handleBooking = useCallback(async (formData) => {
    const { name, email, subject, locationMode, meetingLocation } = formData
    const requestId = `${email}-${selectedSlot.start}-${Date.now()}`

    const body = {
      action:           'createEvent',
      name, email, subject,
      startISO:         selectedSlot.start,
      duration:         meetingType.duration,
      meetingTypeId:    meetingType.id,
      meetingTypeLabel: t(lang, `mt_${meetingType.id}_label`),
      locationMode,
      location:         meetingLocation || '',
      userTz,
      requestId,
    }

    const res  = await fetch(GAS_URL, {
      method: 'POST',
      body:   JSON.stringify(body),
    })
    const data = await res.json()
    if (!data.ok) throw new Error(data.error || 'Booking failed')

    const confirmed = {
      name, email, subject,
      duration:         meetingType.duration,
      meetingTypeLabel: t(lang, `mt_${meetingType.id}_label`),
      locationMode,
      meetingLocation:  meetingLocation || '',
      userTz,
      startISO:  data.startISO,
      endISO:    data.endISO,
      meetLink:  data.meetLink,
      eventId:   data.eventId,
    }

    saveBooking(confirmed)

    if (IS_EMBED) {
      window.parent.postMessage({ type: 'BOOKING_SUCCESS', booking: confirmed }, '*')
    }

    setBooking(confirmed)
    setStep('confirm')
  }, [selectedSlot, meetingType, userTz, lang])

  const handleDateSelect = (date) => {
    setSelectedDate(date)
    setSelectedSlot(null)
    setStep('slots')
  }

  const handleMeetingTypeChange = (mt) => {
    setMeetingType(mt)
    setBusySlots([])
    // Reset locationMode to new type's default when type changes
    setFormData(prev => ({ ...prev, locationMode: mt.defaultMode, meetingLocation: '' }))
    fetchBusySlots(selectedDate, mt)
  }

  const handleSlotSelect = (slot) => {
    setSelectedSlot(slot)
    setStep('form')
  }

  const handleReset = () => {
    setStep('calendar')
    setSelectedDate(null)
    setSelectedSlot(null)
    setBusySlots([])
    setBooking(null)
    setMeetingType(DEFAULT_MEETING_TYPE)
    setFormData({
      name:            '',
      email:           '',
      subject:         '',
      locationMode:    DEFAULT_MEETING_TYPE.defaultMode,
      meetingLocation: '',
    })
  }

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`min-h-screen bg-gradient-to-br from-brand-50 to-blue-50 ${IS_EMBED ? 'p-2' : 'p-4'}`}
    >
      <div className={`mx-auto ${IS_EMBED ? 'max-w-full' : 'max-w-xl'}`}>

        {/* Header — hidden in embed mode */}
        {!IS_EMBED && (
          <header className="text-center mb-8 pt-6 relative">
            {/* Language toggle */}
            <button
              onClick={toggleLang}
              className="absolute top-0 right-0 text-xs px-3 py-1.5 rounded-lg border border-gray-200
                         bg-white text-gray-600 hover:bg-gray-50 transition font-medium"
            >
              {t(lang, 'switch_lang')}
            </button>

            {/* Owner photo */}
            <div className="inline-block mb-3">
              <img
                src={OWNER_PHOTO_URL}
                alt="Book a meeting with Adi Ben-Nesher"
                className="w-20 h-20 rounded-full object-cover shadow-lg border-2 border-white ring-2 ring-brand-200"
                onError={e => { e.currentTarget.style.display = 'none' }}
              />
            </div>

            <h1 className="text-2xl font-bold text-gray-900">{t(lang, 'book_a_meeting')}</h1>
            <p className="text-gray-500 mt-1 text-sm">{t(lang, 'with_owner')} {OWNER_NAME}</p>
          </header>
        )}

        {/* Embed mode: lang toggle in top-right corner */}
        {IS_EMBED && (
          <div className="flex justify-end mb-2">
            <button
              onClick={toggleLang}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200
                         bg-white text-gray-600 hover:bg-gray-50 transition font-medium"
            >
              {t(lang, 'switch_lang')}
            </button>
          </div>
        )}

        {/* Step card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

          {step === 'calendar' && (
            <CalendarPicker onSelect={handleDateSelect} userTz={userTz} lang={lang} />
          )}

          {step === 'slots' && (
            <TimeSlotPicker
              selectedDate={selectedDate}
              busySlots={busySlots}
              loading={slotsLoading}
              error={slotsError}
              userTz={userTz}
              meetingType={meetingType}
              onMeetingTypeChange={handleMeetingTypeChange}
              onSelect={handleSlotSelect}
              onBack={() => setStep('calendar')}
              lang={lang}
            />
          )}

          {step === 'form' && (
            <BookingForm
              selectedSlot={selectedSlot}
              meetingType={meetingType}
              userTz={userTz}
              formData={formData}
              onChange={setFormData}
              onSubmit={handleBooking}
              onBack={() => {
                fetchBusySlots(selectedDate, meetingType)
                setStep('slots')
              }}
              lang={lang}
            />
          )}

          {step === 'confirm' && (
            <ConfirmationScreen
              booking={booking}
              userTz={userTz}
              onReset={handleReset}
              lang={lang}
            />
          )}
        </div>

        {/* Footer — hidden in embed mode */}
        {!IS_EMBED && (
          <p className="text-center text-xs text-gray-400 mt-6 pb-4">
            {t(lang, 'powered_by')}
          </p>
        )}
      </div>
    </div>
  )
}
