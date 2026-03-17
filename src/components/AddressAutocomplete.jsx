import { useEffect, useRef } from 'react'
import { MapPin } from 'lucide-react'
import { GOOGLE_MAPS_API_KEY } from '../config.js'

// ── Singleton script loader ───────────────────────────────────────────────────
// Ensures the Maps JS API is only injected once per page load.
let _mapsReady   = false
let _mapsPromise = null

function loadMapsApi() {
  if (_mapsReady)   return Promise.resolve()
  if (_mapsPromise) return _mapsPromise

  _mapsPromise = new Promise((resolve, reject) => {
    const script  = document.createElement('script')
    script.src    = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_API_KEY}&libraries=places`
    script.async  = true
    script.defer  = true
    script.onload = () => { _mapsReady = true; resolve() }
    script.onerror = () => reject(new Error('Google Maps failed to load'))
    document.head.appendChild(script)
  })
  return _mapsPromise
}

// ── Component ─────────────────────────────────────────────────────────────────
/**
 * Address autocomplete input powered by Google Places API.
 *
 * Uses an uncontrolled DOM input so Google's autocomplete widget can write
 * to it freely. The parent receives updates via `onChange(formattedAddress)`.
 *
 * Pass a new `resetKey` (e.g. the current locationMode) to force a remount
 * and clear the field when the parent resets its state.
 */
export default function AddressAutocomplete({ value, onChange, disabled, placeholder, hasError }) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !inputRef.current) return

    let ac = null

    loadMapsApi()
      .then(() => {
        if (!inputRef.current || !window.google?.maps?.places) return

        ac = new window.google.maps.places.Autocomplete(inputRef.current, {
          fields: ['formatted_address', 'geometry'],
          types:  ['address'],
        })

        ac.addListener('place_changed', () => {
          const place = ac.getPlace()
          if (!place.geometry) return
          const addr = place.formatted_address || ''
          // Sync the DOM value that Google wrote back to React state
          onChange(addr)
        })
      })
      .catch(() => { /* API key missing or network error — falls back to plain text */ })

    return () => {
      if (ac && window.google?.maps?.event) {
        window.google.maps.event.clearInstanceListeners(ac)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative">
      <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none z-10" />
      <input
        ref={inputRef}
        type="text"
        defaultValue={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="new-password"  /* prevents browser autocomplete from overlapping Places dropdown */
        className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-sm transition
          focus:outline-none focus:ring-2 focus:ring-brand-300
          ${hasError
            ? 'border-red-300 bg-red-50 focus:ring-red-200'
            : 'border-gray-200 focus:border-brand-400'
          }`}
      />
    </div>
  )
}
