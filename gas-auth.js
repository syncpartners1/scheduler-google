/** fetch for calls to the Apps Script web app only: adds the shared secret (JSON body for POST, query for GET).
 *  Any other URL is passed through untouched. Without a secret nothing is added (this allows the rollout order). */
export function makeGasFetch(gasUrl, secret, baseFetch) {
  return function gasFetch(url, init) {
    if (!secret || !gasUrl || !String(url).startsWith(gasUrl)) return baseFetch(url, init)
    if (init && String(init.method || '').toUpperCase() === 'POST' && typeof init.body === 'string') {
      return baseFetch(url, { ...init, body: JSON.stringify({ ...JSON.parse(init.body), secret }) })
    }
    return baseFetch(`${url}${String(url).includes('?') ? '&' : '?'}secret=${encodeURIComponent(secret)}`, init)
  }
}
