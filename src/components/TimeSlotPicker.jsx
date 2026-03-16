import { useMemo } from 'react'
import { ChevronLeft, Clock, Loader2, AlertCircle } from 'lucide-react'
import { generateAvailableSlots, formatDateTimeInTz } from '../utils/timeSlots.js'
import { MEETING_TYPES } from '../config.js'
import { t } from '../i18n.js'

export default function TimeSlotPicker({
  selectedDate,
  busySlots,
  loading,
  error,
  userTz,
  meetingType,
  onMeetingTypeChange,
  onSelect,
  onBack,
  lang = 'en',
}) {
  const slots = useMemo(
    () => loading || error
      ? []
      : generateAvailableSlots(selectedDate, busySlots, userTz, meetingType.duration),
    [selectedDate, busySlots, loading, error, userTz, meetingType.duration]
  )

  const MONTHS    = t(lang, 'months')
  const dateLabel = selectedDate
    ? `${MONTHS[selectedDate.getMonth()]} ${selectedDate.getDate()}, ${selectedDate.getFullYear()}`
    : ''

  return (
    <div className="p-6">
      {/* Back + title */}
      <div className="flex items-center gap-2 mb-1">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-gray-100 transition"
          aria-label="Back to calendar"
        >
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <h2 className="text-lg font-semibold text-gray-800">{t(lang, 'select_time')}</h2>
      </div>
      <p className="text-sm text-gray-400 mb-5 ml-8">{dateLabel}</p>

      {/* Meeting type selector */}
      <div className="mb-5">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
          {t(lang, 'meeting_type_lbl')}
        </p>
        <div className="space-y-1.5">
          {MEETING_TYPES.map(mt => {
            const active = meetingType.id === mt.id
            const label  = t(lang, `mt_${mt.id}_label`)
            const sub    = t(lang, `mt_${mt.id}_sub`)
            return (
              <button
                key={mt.id}
                onClick={() => onMeetingTypeChange(mt)}
                className={`
                  w-full flex items-center justify-between px-4 py-2.5 rounded-xl border text-sm transition text-left
                  ${active
                    ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                    : 'bg-white text-gray-700 border-gray-200 hover:border-brand-300 hover:text-brand-600'
                  }
                `}
              >
                <span className="font-medium">{label}</span>
                <span className={`text-xs ${active ? 'text-brand-100' : 'text-gray-400'}`}>
                  {mt.duration} {lang === 'he' ? 'דק׳' : 'min'} · {sub}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Slot list */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-14 text-gray-400">
          <Loader2 className="w-6 h-6 animate-spin mb-2" />
          <span className="text-sm">{t(lang, 'loading')}</span>
        </div>
      )}

      {error && !loading && (
        <div className="flex items-center gap-2 p-4 bg-red-50 rounded-xl text-sm text-red-600">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {!loading && !error && slots.length === 0 && (
        <div className="text-center py-14 text-gray-400">
          <Clock className="w-8 h-8 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">{t(lang, 'no_slots')}</p>
          <p className="text-xs mt-1">{t(lang, 'no_slots_hint')}</p>
        </div>
      )}

      {!loading && !error && slots.length > 0 && (
        <div className="grid grid-cols-2 gap-2 max-h-72 overflow-y-auto scrollbar-hide">
          {slots.map((slot) => (
            <button
              key={slot.start}
              onClick={() => onSelect(slot)}
              className="py-2.5 px-3 rounded-xl border border-gray-200 text-sm font-medium text-gray-700
                         hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700
                         active:scale-95 transition-all"
            >
              {slot.label}
            </button>
          ))}
        </div>
      )}

      {!loading && slots.length > 0 && (
        <p className="text-xs text-gray-400 mt-4 text-center">
          {t(lang, 'times_in_tz')} ({userTz})
        </p>
      )}
    </div>
  )
}
