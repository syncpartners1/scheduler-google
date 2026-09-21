import { Firestore, FieldValue } from '@google-cloud/firestore'

const db = new Firestore()
const SESSION_TTL_MS = 2 * 60 * 60 * 1000

export async function getBotSession(chatId) {
  const ref = db.collection('telegramBotSessions').doc(String(chatId))
  const snap = await ref.get()
  if (!snap.exists) return {}
  const data = snap.data()
  if (data.expiresAt?.toMillis?.() < Date.now()) {
    await ref.delete()
    return {}
  }
  return data.state || {}
}

export async function saveBotSession(chatId, state) {
  await db.collection('telegramBotSessions').doc(String(chatId)).set({
    state,
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + SESSION_TTL_MS),
  })
  return state
}

export async function clearBotSession(chatId) {
  await db.collection('telegramBotSessions').doc(String(chatId)).delete()
}

export function authFlowRef(flowId) { return db.collection('authFlows').doc(flowId) }
export function userRef(userId) { return db.collection('users').doc(String(userId)) }
export function credentialRef(credentialId) { return db.collection('passkeys').doc(credentialId) }
export { db, FieldValue }
