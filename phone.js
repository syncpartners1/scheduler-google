// Phone numbers as E.164 (+972501234567). Same rules as the AICOACH receiver
// (autogpt/coaching/phone.py): a leading + or 00 means international, anything
// else is Israeli. Not a plausible number returns null, never a guess.
const SEPARATORS = /[\s\-().\u200e\u200f\u202a-\u202e]/g

function israeliNational(digits) {
  return /^[1-9]\d{7,8}$/.test(digits)
}

export function normalizePhone(raw) {
  let text = String(raw ?? '').replace(SEPARATORS, '')
  if (!text) return null
  let international = false
  if (text.startsWith('+')) { international = true; text = text.slice(1) }
  else if (text.startsWith('00')) { international = true; text = text.slice(2) }
  if (!/^[0-9]+$/.test(text)) return null
  if (!international) {
    if (text.startsWith('972')) text = text.slice(3)
    else if (text.startsWith('0')) text = text.slice(1)
    return israeliNational(text) ? `+972${text}` : null
  }
  if (text.startsWith('972')) return israeliNational(text.slice(3)) ? `+972${text.slice(3)}` : null
  if (text[0] === '0' || text.length < 8 || text.length > 15) return null
  return `+${text}`
}
