import { useState } from 'react'
import { CheckCircle2, Video, Calendar, Copy, Check, RotateCcw, MapPin, ExternalLink } from 'lucide-react'
import { formatDateTimeInTz } from '../utils/timeSlots.js'
import { buildIcsDataUri, buildGoogleCalendarUrl, tzAbbr } from '../utils/timezone.js'
import { OWNER_TZ } from '../config.js'
import { t } from '../i18n.js'

export default function ConfirmationScreen({ booking, userTz, onReset, lang = 'en' }) {
  const [copied, setCopied] = useState(false)

  if (!booking) return null

  const {
    name, email, subject, startISO, endISO, meetLink, duration,
    meetingTypeLabel, locationMode, meetingLocation,
  } = booking

  const userLabel  = formatDateTimeInTz(startISO, userTz)
  const ownerLabel = formatDateTimeInTz(startISO, OWNER_TZ)
  const userTzAbbr = tzAbbr(userTz)
  const isInPerson = locationMode === 'in_person'
  const hasMeetLink = !!meetLink && !isInPerson

  const icsUri      = buildIcsDataUri(booking)
  const gCalUrl     = buildGoogleCalendarUrl(booking)
  const minLabel    = lang === 'he' ? 'דק׳' : 'min'

  const fmtLabel = {
    virtual:   t(lang, 'fmt_virtual_lbl'),
    hybrid:    t(lang, 'fmt_hybrid_lbl'),
    in_person: t(lang, 'fmt_inperson_lbl'),
  }[locationMode] || ''

  const copyMeetLink = async () => {
    try {
      await navigator.clipboard.writeText(meetLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link:', meetLink)
    }
  }

  return (
    <div className="p-6 text-center">
      {/* Success icon */}
      <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
        <CheckCircle2 className="w-9 h-9 text-green-500" />
      </div>

      <h2 className="text-xl font-bold text-gray-900 mb-1">{t(lang, 'youre_booked')}</h2>
      <p className="text-sm text-gray-500 mb-6">
        {t(lang, 'invite_sent')} <strong>{email}</strong>
      </p>

      {/* Meeting details card */}
      <div className="text-left bg-gray-50 rounded-2xl p-4 mb-5 border border-gray-100 space-y-3">
        <Detail label={t(lang, 'det_meeting')}>
          <span className="font-medium text-gray-800">{subject}</span>
        </Detail>

        {meetingTypeLabel && (
          <Detail label={t(lang, 'det_type')}>
            <span className="text-gray-800">{meetingTypeLabel}</span>
          </Detail>
        )}

        <Detail label={`${t(lang, 'det_your_time')} (${userTzAbbr})`}>
          <span className="text-gray-800">{userLabel} · {duration} {minLabel}</span>
        </Detail>

        {ownerLabel !== userLabel && (
          <Detail label={t(lang, 'det_israel')}>
            <span className="text-gray-500">{ownerLabel}</span>
          </Detail>
        )}

        <Detail label={t(lang, 'det_format')}>
          <span className="text-gray-800">{fmtLabel}</span>
        </Detail>

        {isInPerson && meetingLocation && (
          <Detail label={t(lang, 'det_address')}>
            <span className="text-gray-800">{meetingLocation}</span>
          </Detail>
        )}

        <Detail label={t(lang, 'det_with')}>
          <span className="text-gray-800">{name}</span>
        </Detail>
      </div>

      {/* Action buttons */}
      <div className="space-y-3">
        {/* In-person: address card */}
        {isInPerson && meetingLocation && (
          <div className="flex items-center gap-2 w-full py-3 px-4 rounded-xl
                          bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <MapPin className="w-4 h-4 flex-shrink-0 text-amber-600" />
            <span className="font-medium">{meetingLocation}</span>
          </div>
        )}

        {/* Virtual / Hybrid: Google Meet CTA */}
        {hasMeetLink && (
          <>
            <a
              href={meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                         bg-brand-600 text-white font-semibold text-sm
                         hover:bg-brand-700 transition shadow-sm"
            >
              <Video className="w-4 h-4" />
              {t(lang, 'join_meet')}
            </a>

            <button
              onClick={copyMeetLink}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                         border border-gray-200 text-gray-700 font-medium text-sm
                         hover:bg-gray-50 transition"
            >
              {copied ? (
                <><Check className="w-4 h-4 text-green-500" /> {t(lang, 'copied')}</>
              ) : (
                <><Copy className="w-4 h-4" /> {t(lang, 'copy_meet')}</>
              )}
            </button>
          </>
        )}

        {locationMode === 'hybrid' && meetLink && (
          <p className="text-xs text-gray-400">{t(lang, 'hybrid_note')}</p>
        )}

        {/* Add to Google Calendar */}
        <a
          href={gCalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                     bg-white border border-blue-200 text-blue-700 font-medium text-sm
                     hover:bg-blue-50 transition"
        >
          <ExternalLink className="w-4 h-4" />
          {t(lang, 'add_google_cal')}
        </a>

        {/* Download .ics */}
        <a
          href={icsUri}
          download={`meeting-${startISO.slice(0,10)}.ics`}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                     border border-gray-200 text-gray-700 font-medium text-sm
                     hover:bg-gray-50 transition"
        >
          <Calendar className="w-4 h-4" />
          {t(lang, 'add_ics')}
        </a>

        {/* Book another */}
        <button
          onClick={onReset}
          className="flex items-center justify-center gap-2 w-full py-2.5 text-sm
                     text-gray-400 hover:text-gray-600 transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          {t(lang, 'book_another')}
        </button>
      </div>
    </div>
  )
}

function Detail({ label, children }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs text-gray-400 uppercase tracking-wide font-medium w-28 flex-shrink-0 pt-0.5">
        {label}
      </span>
      <div className="text-sm">{children}</div>
    </div>
  )
}
