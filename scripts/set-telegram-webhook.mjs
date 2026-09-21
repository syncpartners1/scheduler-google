const token = process.env.TELEGRAM_BOT_TOKEN
const path = process.env.TELEGRAM_WEBHOOK_PATH
const secret = process.env.TELEGRAM_WEBHOOK_SECRET
const base = process.env.WEBAUTHN_ORIGIN || 'https://auth.changenavigator.co.il'
if (!token || !path || !secret) throw new Error('TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_PATH and TELEGRAM_WEBHOOK_SECRET are required')
const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: `${base}/telegram/${path}`, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true }),
})
const data = await res.json()
if (!res.ok || !data.ok) throw new Error(JSON.stringify(data))
console.log(data.description)
