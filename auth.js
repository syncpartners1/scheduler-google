import crypto from 'crypto'
import { generateRegistrationOptions, verifyRegistrationResponse } from '@simplewebauthn/server'
import { authFlowRef, userRef, credentialRef, passkeyHandoffRef, getBotSession, db, FieldValue } from './storage.js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
const BREVO_KEY = process.env.BREVO_API_KEY || ''
const RP_ID = process.env.WEBAUTHN_RP_ID || 'changenavigator.co.il'
const RP_ORIGIN = process.env.WEBAUTHN_ORIGIN || 'https://auth.changenavigator.co.il'
const RP_NAME = 'Change Navigator'
const FLOW_TTL_MS = 15 * 60 * 1000
const OTP_TTL_MS = 10 * 60 * 1000
const HANDOFF_TTL_MS = 5 * 60 * 1000

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

async function loadHandoff(token) {
  if (!token) throw new Error('Passkey handoff token missing')
  const tokenHash = hash(token)
  const ref = passkeyHandoffRef(tokenHash)
  const snap = await ref.get()
  if (!snap.exists) throw new Error('Passkey handoff is invalid or already used')
  const handoff = snap.data()
  if (handoff.expiresAt.toMillis() < Date.now()) throw new Error('Passkey handoff expired')
  return { tokenHash, ref, handoff }
}

async function loadVerifiedHandoffFlow(token) {
  const loaded = await loadHandoff(token)
  const flowSnap = await authFlowRef(loaded.handoff.flowId).get()
  if (!flowSnap.exists) throw new Error('Registration flow not found')
  const flow = flowSnap.data()
  if (flow.telegramId !== loaded.handoff.telegramId || flow.expiresAt.toMillis() < Date.now()) throw new Error('Registration flow expired')
  if (!flow.emailVerified || !flow.phoneVerified) throw new Error('Email and phone must be verified first')
  return { ...loaded, flowRef: flowSnap.ref, flow }
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

      const token = randomId(32)
      const tokenHash = hash(token)
      const handoffRef = passkeyHandoffRef(tokenHash)
      const batch = db.batch()
      batch.update(authFlowRef(req.body.flowId), { emailVerified: true })
      batch.create(handoffRef, {
        flowId: req.body.flowId,
        telegramId: String(tg.id),
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + HANDOFF_TTL_MS),
      })
      await batch.commit()
      res.json({ ok: true, continueUrl: `${RP_ORIGIN}/passkey/continue?t=${encodeURIComponent(token)}` })
    } catch (err) {
      console.error('[auth/register/verify]', err)
      res.status(400).json({ ok: false, error: err.message })
    }
  })

  app.get('/passkey/continue', (_req, res) => res.type('html').send(PASSKEY_CONTINUE_HTML))

  app.post('/api/auth/passkey/handoff/options', async (req, res) => {
    try {
      const { ref, handoff, flow } = await loadVerifiedHandoffFlow(req.body.token)
      const existing = await db.collection('passkeys').where('userId', '==', handoff.telegramId).get()
      const options = await generateRegistrationOptions({
        rpName: RP_NAME, rpID: RP_ID, userName: flow.email, userDisplayName: flow.displayName || flow.email,
        attestationType: 'none', excludeCredentials: existing.docs.map(d => ({ id: d.id, transports: d.data().transports || [] })),
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      })
      await ref.update({ webauthnChallenge: options.challenge })
      res.json({ ok: true, options })
    } catch (err) {
      console.error('[auth/passkey/handoff/options]', err)
      res.status(400).json({ ok: false, error: err.message })
    }
  })

  app.post('/api/auth/passkey/handoff/verify', async (req, res) => {
    try {
      const loaded = await loadVerifiedHandoffFlow(req.body.token)
      if (!loaded.handoff.webauthnChallenge) throw new Error('Passkey challenge missing')
      const verification = await verifyRegistrationResponse({
        response: req.body.credential,
        expectedChallenge: loaded.handoff.webauthnChallenge,
        expectedOrigin: RP_ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: true,
      })
      if (!verification.verified || !verification.registrationInfo) throw new Error('Passkey verification failed')
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo

      await db.runTransaction(async transaction => {
        const [handoffSnap, flowSnap] = await Promise.all([
          transaction.get(loaded.ref),
          transaction.get(loaded.flowRef),
        ])
        if (!handoffSnap.exists || !flowSnap.exists) throw new Error('Passkey handoff is invalid or already used')
        const handoff = handoffSnap.data(); const flow = flowSnap.data()
        if (handoff.expiresAt.toMillis() < Date.now()) throw new Error('Passkey handoff expired')
        if (handoff.flowId !== loaded.handoff.flowId || handoff.telegramId !== loaded.handoff.telegramId) throw new Error('Passkey handoff changed')
        if (!safeEqual(handoff.webauthnChallenge, loaded.handoff.webauthnChallenge)) throw new Error('Passkey challenge changed')
        if (!flow.emailVerified || !flow.phoneVerified || flow.telegramId !== handoff.telegramId) throw new Error('Registration proof is no longer valid')

        transaction.set(userRef(handoff.telegramId), {
          email: flow.email, phone: flow.phone, telegramId: handoff.telegramId,
          telegramUsername: flow.telegramUsername, displayName: flow.displayName,
          emailVerified: true, phoneVerified: true, passwordEnabled: false,
          createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true })
        transaction.set(credentialRef(credential.id), {
          userId: handoff.telegramId, publicKey: b64url(credential.publicKey), counter: credential.counter,
          transports: credential.transports || [], deviceType: credentialDeviceType,
          backedUp: credentialBackedUp, createdAt: FieldValue.serverTimestamp(),
        })
        transaction.delete(flowSnap.ref)
        transaction.delete(handoffSnap.ref)
      })
      res.json({ ok: true, user: { email: loaded.flow.email, name: loaded.flow.displayName } })
    } catch (err) {
      console.error('[auth/passkey/handoff/verify]', err)
      res.status(400).json({ ok: false, error: err.message })
    }
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
async function verify(){try{status.textContent='Verifying…';const d=await call('/api/auth/register/verify',{flowId,emailCode:emailCode.value});status.textContent='Opening your browser to create the passkey…';tg.openLink(d.continueUrl)}catch(e){status.textContent=e.message;status.className='err'}}
</script></body></html>`


const PASSKEY_CONTINUE_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Create your Change Navigator passkey</title><style>body{font-family:system-ui;max-width:480px;margin:auto;padding:20px}button{width:100%;box-sizing:border-box;padding:12px;margin:6px 0;background:#1a2b4a;color:white;border:0;border-radius:8px}.err{color:#b91c1c}.ok{color:#166534}</style></head><body><h2>Create your passkey</h2><p>This continues the registration you verified in Telegram. The link expires in 5 minutes and works once.</p><button id="createButton">Create passkey</button><p id="status"></p><script>
const status=document.getElementById('status'); const button=document.getElementById('createButton'); const token=new URLSearchParams(location.search).get('t');
const b64=b=>Uint8Array.from(atob(b.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0)); const enc=o=>{o.challenge=b64(o.challenge);o.user.id=b64(o.user.id);o.excludeCredentials=(o.excludeCredentials||[]).map(x=>({...x,id:b64(x.id)}));return o}; const buf=b=>btoa(String.fromCharCode(...new Uint8Array(b))).split('+').join('-').split('/').join('_').replace(/=+$/,''); const out=c=>({id:c.id,rawId:buf(c.rawId),type:c.type,response:{attestationObject:buf(c.response.attestationObject),clientDataJSON:buf(c.response.clientDataJSON)},clientExtensionResults:c.getClientExtensionResults(),transports:c.response.getTransports?.()||[]});
async function call(url,body){const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const d=await r.json();if(!d.ok)throw Error(d.error||'Request failed');return d}
async function createPasskey(){try{button.disabled=true;status.className='';status.textContent='Preparing passkey…';if(!window.PublicKeyCredential||!navigator.credentials?.create)throw Error('Passkey creation is not supported in this browser. Open this link in the latest Safari or Chrome.');if(!token)throw Error('Passkey handoff token missing');const d=await call('/api/auth/passkey/handoff/options',{token});const credential=await navigator.credentials.create({publicKey:enc(d.options)});await call('/api/auth/passkey/handoff/verify',{token,credential:out(credential)});status.className='ok';status.textContent='Registration complete. You can close this page and return to Telegram.';button.hidden=true}catch(e){console.error('[passkey/continue]',e);status.className='err';status.textContent=e.message||'Could not create passkey';button.disabled=false}}
button.addEventListener('click',createPasskey);
</script></body></html>`
