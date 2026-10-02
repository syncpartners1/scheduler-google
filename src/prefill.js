/** Read optional ?name=&email=&subject= from a URL query string.
 * Values only pre-fill the booking form; the visitor can edit them. Control
 * characters are removed, lengths are capped, and an invalid email is dropped. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function clean(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max)
}

export function readPrefill(search) {
  const params = new URLSearchParams(search || '')
  const email = clean(params.get('email'), 254)
  return {
    name:    clean(params.get('name'), 160),
    email:   EMAIL_RE.test(email) ? email : '',
    subject: clean(params.get('subject'), 500),
  }
}
