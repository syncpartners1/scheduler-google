import crypto from 'crypto'
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
import { authFlowRef, userRef, credentialRef, getBotSession, db, FieldValue } from './storage.js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const BREVO_KEY = process.env.BREVO_API_KEY || ''
const RP_ID = process.env.WEBAUTHN_RP_ID || 'changenavigator.co.il'
const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'https://auth.changenavigator.co.il'
const RP_NAME = 'Change Navigator'
const FLOW_TTL_MS = 15 * 60 * 1000
const OTP_TTL_MS = 10 * 60 * 1000

function b64url(input) { return Buffer.from(input).toString('base64url') }
function randomId(bytes = 24) { return b64url(crypto.randomBytes(bytes)) }
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex') }
function safeEqual(a, b) {
  const aa = Buffer.from(String(a)); const bb = Buffer.from(String(b))
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb)
}
function normalizeEmail(value) { return String(value || '').trim().toLowerCase() }
function normalizePhone(value) {
  const phone = String(value || '').replace(/[\s()-]/g, '')
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error('Phone must be in E.164 format')
  return phone
}

export function validateTelegramInitData(initData) {
  if (!BOT_TOKEN) throw new Error('Telegram bot is not configured')
  const params = new URLSearchParams(initData)
  const suppliedHash = params.get('hash') || ''
  params.delete('hash')
  const authDate = Number(params.get('auth_date'))
  if (!authDate || Math.abs(Date.now() / 1000 - authDate) > 600) throw new Error('Telegram session expired')
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest()
  const expected = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex')
  if (!safeEqual(suppliedHash, expected)) throw new Error('Invalid Telegram signature')
  const user = JSON.parse(params.get('user') || '{}')
  if (!user.id) throw new Error('Telegram user missing')
  return user
}

async function loadFlow(flowId, telegramId) {
  const snap = await authFlowRef(flowId).get()
  if (!snap.exists) throw new Error('Registration flow not found')
  const flow = snap.data()
  if (flow.telegramId !== String(telegramId) || flow.expiresAt.toMillis() < Date.now()) throw new Error('Registration flow expired')
  return flow
}

async function sendBrevoCode(email, code) {
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
    body: JSON.stringify({
      sender: { email: 'office@changenavigator.co.il', name: 'Change Navigator' },
      to: [{ email }], subject: 'Your Change Navigator verification code',
      htmlContent: `<p>Your verification code is:</p><p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p><p>It expires in 10 minutes.</p>`,
    }),
  })
  if (!res.ok) throw new Error(`Email delivery failed (${res.status})`)
}

const phoneVerifier = {
  async verifyNativeTelegramContact({ phone }) {
    // Bot ownership was proven when contact.user_id matched ctx.from.id.
    return { verified: true, phone }
  },
}


export function registerAuthRoutes(app) {
  app.get('/register', (_req, res) => res.type('html').send(REGISTRATION_HTML))

  app.post('/api/auth/register/start', async (req, res) => {
    try {
      const tg = validateTelegramInitData(req.body.initData)
      const email = normalizeEmail(req.body.email)
      const botSession = await getBotSession(tg.id)
      const phone = normalizePhone(botSession.registrationPhone)
      if (!phone) throw new Error('Share your phone with the bot before opening registration')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Invalid email')
      const duplicate = await db.collection('users').where('email', '==', email).limit(1).get()
      if (!duplicate.empty && duplicate.docs[0].id !== String(tg.id)) throw new Error('Email already registered')
      const flowId = randomId(); const emailCode = String(crypto.randomInt(100000, 1000000))
      await authFlowRef(flowId).set({
        telegramId: String(tg.id), telegramUsername: tg.username || '', displayName: [tg.first_name, tg.last_name].filter(Boolean).join(' '),
        email, phone, emailCodeHash: hash(`${flowId}:${emailCode}`), emailVerified: false, phoneVerified: false,
        createdAt: FieldValue.serverTimestamp(), expiresAt: new Date(Date.now() + FLOW_TTL_MS),
      })
      await sendBrevoCode(email, emailCode)
      const phoneProof = await phoneVerifier.verifyNativeTelegramContact({ phone })
      await authFlowRef(flowId).update({ phoneVerified: phoneProof.verified, phoneVerificationMethod: 'telegram_native_contact' })
      res.json({ ok: true, flowId })
    } catch (err) {
      console.error('[auth/register/start]', err)
      res.status(400).json({ ok: false, error: err.message })
    }
  })

  app.post('/api/auth/register/verify', async (req, res) => {
    try {
      const tg = validateTelegramInitData(req.body.initData)
      const flow = await loadFlow(req.body.flowId, tg.id)
      if (!safeEqual(hash(`${req.body.flowId}:${req.body.emailCode}`), flow.emailCodeHash)) throw new Error('Invalid email code')
      if (!flow.phoneVerified) throw new Error('Share your own Telegram contact before registering')
      await authFlowRef(req.body.flowId).update({ emailVerified: true })
      res.json({ ok: true })
    } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
  })

  app.post('/api/auth/passkey/options', async (req, res) => {
    try {
      const tg = validateTelegramInitData(req.body.initData)
      const flow = await loadFlow(req.body.flowId, tg.id)
      if (!flow.emailVerified || !flow.phoneVerified) throw new Error('Email and phone must be verified first')
      const existing = await db.collection('passkeys').where('userId', '==', String(tg.id)).get()
      const options = await generateRegistrationOptions({
        rpName: RP_NAME, rpID: RP_ID, userName: flow.email, userDisplayName: flow.displayName || flow.email,
        attestationType: 'none', excludeCredentials: existing.docs.map(d => ({ id: d.id, transports: d.data().transports || [] })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      })
      await authFlowRef(req.body.flowId).update({ webauthnChallenge: options.challenge })
      res.json({ ok: true, options })
    } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
  })

  app.post('/api/auth/passkey/verify', async (req, res) => {
    try {
      const tg = validateTelegramInitData(req.body.initData)
      const flow = await loadFlow(req.body.flowId, tg.id)
      const verification = await verifyRegistrationResponse({ response: req.body.credential, expectedChallenge: flow.webauthnChallenge, expectedOrigin: RP_ORIGIN, expectedRPID: RP_ID, requireUserVerification: true })
      if (!verification.verified || !verification.registrationInfo) throw new Error('Passkey verification failed')
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
      const batch = db.batch()
      batch.set(userRef(tg.id), { email: flow.email, phone: flow.phone, telegramId: String(tg.id), telegramUsername: flow.telegramUsername, displayName: flow.displayName, emailVerified: true, phoneVerified: true, passwordEnabled: false, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
      batch.set(credentialRef(credential.id), { userId: String(tg.id), publicKey: b64url(credential.publicKey), counter: credential.counter, transports: credential.transports || [], deviceType: credentialDeviceType, backedUp: credentialBackedUp, createdAt: FieldValue.serverTimestamp() })
      batch.delete(authFlowRef(req.body.flowId)); await batch.commit()
      res.json({ ok: true, user: { email: flow.email, name: flow.displayName } })
    } catch (err) { res.status(400).json({ ok: false, error: err.message }) }
  })

  app.get('/api/auth/profile/:telegramId', async (req, res) => {
    if (!process.env.API_KEY || !safeEqual(req.get('X-Api-Key'), process.env.API_KEY)) return res.sendStatus(401)
    const snap = await userRef(req.params.telegramId).get()
    if (!snap.exists) return res.status(404).json({ ok: false })
    const u = snap.data(); res.json({ ok: true, profile: { email: u.email, name: u.displayName, phoneVerified: u.phoneVerified } })
  })
}

const REGISTRATION_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Change Navigator registration</title><script src="https://telegram.org/js/telegram-web-app.js"></script><style>body{font-family:system-ui;max-width:480px;margin:auto;padding:20px}input,button{width:100%;box-sizing:border-box;padding:12px;margin:6px 0}button{background:#1a2b4a;color:white;border:0;border-radius:8px}.hidden{display:none}.err{color:#b91c1c}</style></head><body><h2>Passwordless registration</h2><p>Verify your email and phone, then create a passkey. No password is used.</p><section id="details"><input id="email" type="email" placeholder="Email (your username)"><p>Your phone comes from the contact you shared with the bot.</p><button onclick="start()">Send verification codes</button></section><section id="codes" class="hidden"><input id="emailCode" inputmode="numeric" placeholder="Email code"><button onclick="verify()">Verify email and create passkey</button></section><p id="status"></p><script>
const tg=window.Telegram.WebApp; tg.ready(); let flowId; const status=document.getElementById('status');
const b64=b=>Uint8Array.from(atob(b.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)); const enc=o=>{o.challenge=b64(o.challenge);o.user.id=b64(o.user.id);o.excludeCredentials=(o.excludeCredentials||[]).map(x=>({...x,id:b64(x.id)}));return o}; const out=c=>({id:c.id,rawId:buf(c.rawId),type:c.type,response:{attestationObject:buf(c.response.attestationObject),clientDataJSON:buf(c.response.clientDataJSON)},clientExtensionResults:c.getClientExtensionResults(),transports:c.response.getTransports?.()||[]}); const buf=b=>btoa(String.fromCharCode(...new Uint8Array(b))).split('+').join('-').split('/').join('_').replace(/=+$/,'');
async function call(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,initData:tg.initData})});const d=await r.json();if(!d.ok)throw Error(d.error);return d}
async function start(){try{status.textContent='Sending codes…';const d=await call('/api/auth/register/start',{email:email.value});flowId=d.flowId;details.classList.add('hidden');codes.classList.remove('hidden');status.textContent='Codes sent.'}catch(e){status.textContent=e.message;status.className='err'}}
async function verify(){try{status.textContent='Verifying…';await call('/api/auth/register/verify',{flowId,emailCode:emailCode.value});const d=await call('/api/auth/passkey/options',{flowId});const credential=await navigator.credentials.create({publicKey:enc(d.options)});await call('/api/auth/passkey/verify',{flowId,credential:out(credential)});status.textContent='Registration complete. You can close this window.';tg.MainButton.setText('Done').show().onClick(()=>tg.close())}catch(e){status.textContent=e.message;status.className='err'}}
</script></body></html>`
