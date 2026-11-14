import { useState } from 'react'
import { ChevronLeft, Loader2, User, Mail, Phone, MessageSquare, Video, Globe2, MapPin, AlertCircle } from 'lucide-react'
import { formatDateTimeInTz } from '../utils/timeSlots.js'
import { OWNER_TZ } from '../config.js'
import { t } from '../i18n.js'
import { normalizePhone } from '../../phone.js'
import { isDiagnosticClinicSlot, CLINIC_ADDRESS } from '../../booking-format.js'
import AddressAutocomplete from './AddressAutocomplete.jsx'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function BookingForm({ selectedSlot, meetingType, userTz, formData, onChange, onSubmit, onBack, lang = 'en' }) {
  // form state is lifted to App.jsx (formData + onChange) so it survives back navigation
  const form    = formData
  const setForm = onChange
  const [errors,     setErrors]     = useState({})
  const [submitting, setSubmitting] = useState(false)
  const [apiError,   setApiError]   = useState(null)

  const LOCATION_MODES = [
    { id: 'virtual',   label: t(lang, 'virtual'),   icon: Video,  desc: t(lang, 'fmt_virtual_desc')  },
    { id: 'hybrid',    label: t(lang, 'hybrid'),    icon: Globe2, desc: t(lang, 'fmt_hybrid_desc')   },
    { id: 'in_person', label: t(lang, 'in_person'), icon: MapPin, desc: t(lang, 'fmt_inperson_desc') },
  ]

  // The dedicated diagnostic route (?type=diagnostic_60) offers Google Meet,
  // or a clinic meeting when the selected slot is inside the Friday
  // 09:00-12:00 (Asia/Jerusalem) clinic window — never hybrid, and the clinic
  // address is fixed, not client-supplied. server.js validates the same rule.
  const isDiagnostic = meetingType.id === 'diagnostic_60'
  const clinicAvailable = isDiagnostic && isDiagnosticClinicSlot(selectedSlot?.start, meetingType.duration)
  const MODES = isDiagnostic
    ? [
        { id: 'virtual',   label: t(lang, 'virtual'), icon: Video,  desc: t(lang, 'fmt_virtual_desc') },
        ...(clinicAvailable
          ? [{ id: 'in_person', label: t(lang, 'clinic'), icon: MapPin, desc: t(lang, 'fmt_clinic_desc') }]
          : []),
      ]
    : LOCATION_MODES
  // Coerce a stale choice (e.g. clinic picked, then the slot changed) so the
  // form never submits a format the diagnostic route does not allow.
  const activeMode = MODES.some(m => m.id === form.locationMode) ? form.locationMode : 'virtual'

  const validate = () => {
    const e = {}
    if (!form.name.trim())    e.name    = t(lang, 'err_name')
    if (!form.email.trim())   e.email   = t(lang, 'err_email_required')
    else if (!EMAIL_RE.test(form.email)) e.email = t(lang, 'err_email_invalid')
    if (!form.phone.trim())   e.phone   = t(lang, 'err_phone_required')
    else if (!normalizePhone(form.phone)) e.phone = t(lang, 'err_phone_invalid')
    if (!isDiagnostic && !form.subject.trim()) e.subject = t(lang, 'err_subject')
    // Diagnostic clinic bookings use the fixed clinic address, so only public
    // types require an entered address.
    if (!isDiagnostic && form.locationMode === 'in_person' && !form.meetingLocation.trim())
      e.meetingLocation = t(lang, 'err_address')
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const handleChange = (field) => (e) => {
    setForm(prev => ({ ...prev, [field]: e.target.value }))
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: undefined }))
  }

  const handleLocationMode = (mode) => {
    setForm(prev => ({ ...prev, locationMode: mode, meetingLocation: '' }))
    setErrors(prev => ({ ...prev, meetingLocation: undefined }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setSubmitting(true)
    setApiError(null)
    try {
      if (isDiagnostic) {
        // Subject is fixed on this route; the lead may add a free-text focus
        // area, which rides along in the existing subject field.
        const fixedSubject = t(lang, 'subject_fixed_diagnostic')
        const focus = (form.focus || '').trim()
        await onSubmit({ ...form,
          subject: focus ? `${fixedSubject} - ${focus}` : fixedSubject,
          locationMode: activeMode, meetingLocation: '' })
      } else {
        await onSubmit(form)
      }
    } catch (err) {
      setApiError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const slotLabel  = selectedSlot ? formatDateTimeInTz(selectedSlot.start, userTz)   : ''
  const ownerLabel = selectedSlot ? formatDateTimeInTz(selectedSlot.start, OWNER_TZ) : ''
  const minLabel   = lang === 'he' ? 'דק׳' : 'min'

  return (
    <div className="p-6">
      {/* Back + title */}
      <div className="flex items-center gap-2 mb-1">
        <button onClick={onBack} className="p-1.5 rounded-lg hover:bg-gray-100 transition" aria-label="Back">
          <ChevronLeft className="w-5 h-5 text-gray-500" />
        </button>
        <h2 className="text-lg font-semibold text-gray-800">{t(lang, 'your_details')}</h2>
      </div>

      {/* Selected slot + meeting type summary */}
      <div className="ml-8 mb-5 p-3 bg-brand-50 rounded-xl border border-brand-100">
        <p className="text-sm font-medium text-brand-800">{slotLabel} · {meetingType.duration} {minLabel}</p>
        <p className="text-xs text-brand-600 mt-0.5">{t(lang, `mt_${meetingType.id}_label`)}</p>
        {ownerLabel !== slotLabel && (
          <p className="text-xs text-brand-500 mt-0.5">{t(lang, 'israel_time_lbl')}: {ownerLabel}</p>
        )}
      </div>

      {/* API error */}
      {apiError && (
        <div className="flex items-start gap-2 mb-4 p-3 bg-red-50 rounded-xl text-sm text-red-600">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{apiError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t(lang, 'full_name')}</label>
          <div className="relative">
            <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={form.name}
              onChange={handleChange('name')}
              placeholder={t(lang, 'name_placeholder')}
              disabled={submitting}
              className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition
                focus:outline-none focus:ring-2 focus:ring-brand-300
                ${errors.name ? 'border-red-300 bg-red-50 focus:ring-red-200' : 'border-gray-200 focus:border-brand-400'}`}
            />
          </div>
          {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
        </div>

        {/* Email */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t(lang, 'email_address')}</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="email"
              value={form.email}
              onChange={handleChange('email')}
              placeholder={t(lang, 'email_placeholder')}
              disabled={submitting}
              className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition
                focus:outline-none focus:ring-2 focus:ring-brand-300
                ${errors.email ? 'border-red-300 bg-red-50 focus:ring-red-200' : 'border-gray-200 focus:border-brand-400'}`}
            />
          </div>
          {errors.email && <p className="text-xs text-red-500 mt-1">{errors.email}</p>}
        </div>

        {/* Phone */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t(lang, 'phone_label')}</label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="tel"
              dir="ltr"
              inputMode="tel"
              autoComplete="tel"
              value={form.phone}
              onChange={handleChange('phone')}
              placeholder={t(lang, 'phone_placeholder')}
              disabled={submitting}
              className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition
                focus:outline-none focus:ring-2 focus:ring-brand-300
                ${errors.phone ? 'border-red-300 bg-red-50 focus:ring-red-200' : 'border-gray-200 focus:border-brand-400'}`}
            />
          </div>
          {errors.phone
            ? <p className="text-xs text-red-500 mt-1">{errors.phone}</p>
            : <p className="text-xs text-gray-400 mt-1">{t(lang, 'phone_hint')}</p>}
        </div>

        {/* Subject: free text on public types; fixed on the diagnostic route,
            where the lead may add an optional focus area instead */}
        {!isDiagnostic && (
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t(lang, 'meeting_subject')}</label>
          <div className="relative">
            <MessageSquare className="absolute left-3 top-3 w-4 h-4 text-gray-400" />
            <textarea
              value={form.subject}
              onChange={handleChange('subject')}
              placeholder={t(lang, 'subject_placeholder')}
              rows={3}
              disabled={submitting}
              className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition resize-none
                focus:outline-none focus:ring-2 focus:ring-brand-300
                ${errors.subject ? 'border-red-300 bg-red-50 focus:ring-red-200' : 'border-gray-200 focus:border-brand-400'}`}
            />
          </div>
          {errors.subject && <p className="text-xs text-red-500 mt-1">{errors.subject}</p>}
        </div>
        )}
        {isDiagnostic && (
        <>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t(lang, 'meeting_subject')}</label>
          <div className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-700">
            {t(lang, 'subject_fixed_diagnostic')}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{t(lang, 'focus_label')}</label>
          <input
            type="text"
            value={form.focus || ''}
            onChange={handleChange('focus')}
            disabled={submitting}
            className="w-full px-4 py-2.5 rounded-xl border text-sm transition
              focus:outline-none focus:ring-2 focus:ring-brand-300 border-gray-200 focus:border-brand-400"
          />
          <p className="text-xs text-gray-400 mt-1">{t(lang, 'focus_hint')}</p>
        </div>
        </>
        )}

        {/* Location mode */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">{t(lang, 'meeting_format')}</label>
          <div className={`grid gap-2 ${MODES.length === 3 ? 'grid-cols-3' : MODES.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {MODES.map(({ id, label, icon: Icon, desc }) => {
              const active = activeMode === id
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => handleLocationMode(id)}
                  disabled={submitting}
                  className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-sm transition
                    ${active
                      ? 'bg-brand-600 text-white border-brand-600 shadow-sm'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-brand-300 hover:text-brand-600'
                    }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="font-medium text-xs">{label}</span>
                  <span className={`text-xs leading-tight text-center ${active ? 'text-brand-100' : 'text-gray-400'}`}>
                    {desc}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Clinic bookings on the diagnostic route meet at the clinic; the
            address is fixed, not entered by the lead. */}
        {isDiagnostic && activeMode === 'in_person' && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t(lang, 'meeting_address')}</label>
            <p className="w-full px-4 py-2.5 rounded-xl border border-gray-200 bg-gray-50 text-sm text-gray-700">{CLINIC_ADDRESS}</p>
          </div>
        )}

        {/* Address — shown for in-person and hybrid on public types */}
        {!isDiagnostic && (form.locationMode === 'in_person' || form.locationMode === 'hybrid') && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t(lang, 'meeting_address')}</label>
            <AddressAutocomplete
              key={form.locationMode}
              value={form.meetingLocation}
              onChange={addr => {
                setForm(prev => ({ ...prev, meetingLocation: addr }))
                if (errors.meetingLocation) setErrors(prev => ({ ...prev, meetingLocation: undefined }))
              }}
              placeholder={t(lang, 'addr_placeholder')}
              disabled={submitting}
              hasError={!!errors.meetingLocation}
            />
            {errors.meetingLocation && (
              <p className="text-xs text-red-500 mt-1">{errors.meetingLocation}</p>
            )}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-xl bg-brand-600 text-white font-semibold text-sm
                     hover:bg-brand-700 active:scale-[0.98] transition-all
                     disabled:opacity-70 disabled:cursor-not-allowed
                     flex items-center justify-center gap-2 shadow-sm"
        >
          {submitting ? (
            <><Loader2 className="w-4 h-4 animate-spin" />{t(lang, 'booking_loading')}</>
          ) : (
            t(lang, 'confirm_booking')
          )}
        </button>
      </form>
    </div>
  )
}
