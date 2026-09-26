/** Normalize untrusted bridge HTML to Telegram's supported, balanced subset. */
const INLINE = new Set(['b', 'i', 'u', 's', 'a', 'code', 'tg-spoiler'])
const BLOCK = new Set(['pre', 'blockquote'])
const ENTITIES = /&(?:amp|lt|gt|quot|#(?:[0-9]+|x[0-9a-f]+));/gi

function escapeText(text) {
  // Keep already-encoded HTML entities from AICOACH intact, escape raw metacharacters.
  return text.replace(ENTITIES, (entity) => `\u0000${entity.slice(1)}\u0000`)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\u0000([^\u0000]+)\u0000/g, '&$1')
}

function allowedTag(raw) {
  const match = /^<\s*(\/?)\s*([\w-]+)([^>]*)>$/.exec(raw)
  if (!match) return null
  const [, slash, nameRaw, attributes] = match
  const name = nameRaw.toLowerCase()
  if (name === 'br' && !slash && /^\s*\/?\s*$/.test(attributes)) return { lineBreak: true }
  if (!INLINE.has(name) && !BLOCK.has(name)) return null
  if (slash) return /^\s*$/.test(attributes) ? { name, closing: true } : null
  if (name === 'a') {
    const href = /^\s+href\s*=\s*(["'])(.*?)\1\s*$/i.exec(attributes)
    if (!href) return null
    let url
    try { url = new URL(href[2].replace(/&amp;/gi, '&')) } catch { return null }
    if (!['https:', 'http:'].includes(url.protocol)) return null
    return { name, opening: `<a href="${escapeText(url.href).replace(/"/g, '&quot;')}">`, closing: false }
  }
  if (!/^\s*$/.test(attributes)) return null
  return { name, opening: `<${name}>`, closing: false }
}

export function telegramHtml(value) {
  const text = String(value ?? '')
  const stack = []
  let out = ''
  for (const token of text.match(/<[^>]*>|<|[^<]+/g) || []) {
    if (!token.startsWith('<') || token === '<') {
      out += escapeText(token)
      continue
    }
    const tag = allowedTag(token)
    if (!tag) { out += escapeText(token); continue } // Show unsupported markup literally, safely escaped.
    if (tag.lineBreak) { out += '\n'; continue }
    if (tag.closing) {
      const index = stack.lastIndexOf(tag.name)
      if (index < 0) continue
      while (stack.length > index) out += `</${stack.pop()}>`
    } else {
      // Telegram disallows arbitrary nesting inside code/pre/blockquote.
      if (stack.some(name => name === 'code' || BLOCK.has(name))) continue
      if (BLOCK.has(tag.name) || tag.name === 'code') {
        while (stack.length) out += `</${stack.pop()}>`
      }
      out += tag.opening
      stack.push(tag.name)
    }
  }
  while (stack.length) out += `</${stack.pop()}>`
  return out
}

/** Only retry as plain text on Telegram's deterministic HTML-parse rejection. */
export async function sendBridgeHtml(ctx, value) {
  const raw = String(value ?? '')
  try {
    return await ctx.reply(telegramHtml(raw), { parse_mode: 'HTML' })
  } catch (err) {
    const description = String(err?.description || err?.response?.description || '')
    if (!/can't parse entities|unsupported start tag|entity/i.test(description)) throw err
    console.warn('[coach/html] Telegram rejected formatted text, sending plain text')
    const plain = raw.replace(/<[^>]*>/g, (token) => allowedTag(token) ? '' : token)
    return ctx.reply(plain)
  }
}
