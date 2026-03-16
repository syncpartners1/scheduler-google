import { useState } from 'react'
import { CheckCircle2, Video, Calendar, Copy, Check, RotateCcw, MapPin, Globe2 } from 'lucide-react'
import { formatDateTimeInTz } from '../utils/timeSlots.js'
import { buildIcsDataUri, tzAbbr } from '../utils/timezone.js'
import { OWNER_TZ } from '../config.js'

export default function ConfirmationScreen({ booking, userTz, onReset }) {
  const [copied, setCopied] = useState(false)

  if (!booking) return null

  const {
    name, email, subject, startISO, endISO, meetLink, duration,
    meetingTypeLabel, locationMode, meetingLocation,
  } = booking

  const userLabel  = formatDateTimeInTz(startISO, userTz)
  const ownerLabel = formatDateTimeInTz(startISO, OWNER_TZ)
  const userTzAbbr = tzAbbr(userTz)

  const icsUri = buildIcsDataUri(booking)
  const isInPerson = locationMode === 'in_person'
  const hasMeetLink = !!meetLink && !isInPerson

  const copyMeetLink = async () => {
    try {
      await navigator.clipboard.writeText(meetLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('Copy this link:', meetLink)
    }
  }

  const locationModeLabel = {
    virtual:   '🎥 Virtual',
    hybrid:    '🔀 Hybrid (In-person + Online)',
    in_person: '📍 In-Person',
  }[locationMode] || ''

  return (
    <div className="p-6 text-center">
      {/* Success icon */}
      <div className="inline-flex items-center justify-center w-16 h-16 bg-green-100 rounded-full mb-4">
        <CheckCircle2 className="w-9 h-9 text-green-500" />
      </div>

      <h2 className="text-xl font-bold text-gray-900 mb-1">You're booked!</h2>
      <p className="text-sm text-gray-500 mb-6">
        A calendar invite has been sent to <strong>{email}</strong>
      </p>

      {/* Meeting details card */}
      <div className="text-left bg-gray-50 rounded-2xl p-4 mb-5 border border-gray-100 space-y-3">
        <Detail label="Meeting">
          <span className="font-medium text-gray-800">{subject}</span>
        </Detail>

        {meetingTypeLabel && (
          <Detail label="Type">
            <span className="text-gray-800">{meetingTypeLabel}</span>
          </Detail>
        )}

        <Detail label={`Your time (${userTzAbbr})`}>
          <span className="text-gray-800">{userLabel} · {duration} min</span>
        </Detail>

        {ownerLabel !== userLabel && (
          <Detail label="Israel time">
            <span className="text-gray-500">{ownerLabel}</span>
          </Detail>
        )}

        <Detail label="Format">
          <span className="text-gray-800">{locationModeLabel}</span>
        </Detail>

        {isInPerson && meetingLocation && (
          <Detail label="Address">
            <span className="text-gray-800">{meetingLocation}</span>
          </Detail>
        )}

        <Detail label="With">
          <span className="text-gray-800">{name}</span>
        </Detail>
      </div>

      {/* Action buttons */}
      <div className="space-y-3">

        {/* In-person: show address prominently */}
        {isInPerson && meetingLocation && (
          <div className="flex items-center gap-2 w-full py-3 px-4 rounded-xl
                          bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <MapPin className="w-4 h-4 flex-shrink-0 text-amber-600" />
            <span className="font-medium">{meetingLocation}</span>
          </div>
        )}

        {/* Virtual / Hybrid: Google Meet link as primary CTA */}
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
              Join Google Meet
            </a>

            <button
              onClick={copyMeetLink}
              className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                         border border-gray-200 text-gray-700 font-medium text-sm
                         hover:bg-gray-50 transition"
            >
              {copied ? (
                <><Check className="w-4 h-4 text-green-500" /> Copied!</>
              ) : (
                <><Copy className="w-4 h-4" /> Copy Meet Link</>
              )}
            </button>
          </>
        )}

        {/* Hybrid: also show the Meet link even with an address */}
        {locationMode === 'hybrid' && meetLink && (
          <p className="text-xs text-gray-400">
            Can't make it in person? Join online via the Meet link above.
          </p>
        )}

        {/* Add to calendar (.ics) */}
        <a
          href={icsUri}
          download={`meeting-${startISO.slice(0,10)}.ics`}
          className="flex items-center justify-center gap-2 w-full py-3 rounded-xl
                     border border-gray-200 text-gray-700 font-medium text-sm
                     hover:bg-gray-50 transition"
        >
          <Calendar className="w-4 h-4" />
          Add to My Calendar
        </a>

        {/* Book another */}
        <button
          onClick={onReset}
          className="flex items-center justify-center gap-2 w-full py-2.5 text-sm
                     text-gray-400 hover:text-gray-600 transition"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Book another meeting
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
