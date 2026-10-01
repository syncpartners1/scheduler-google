/** Durable pre-booking intent + confirmed notification outbox.
 * Drain never creates a calendar event. It only looks up an ambiguous booking.
 * Notification retry must not change an already-created booking's result.
 */
import crypto from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

export function payloadFor(input, result) {
  return {
    event_id: result.eventId.replace(/@google\.com$/, ''),
    name: input.name,
    email: input.email,
    subject: input.subject || '',
    meeting_type: input.meetingTypeLabel || input.meetingTypeId || '',
    start: new Date(result.startISO).toISOString(),
    end: new Date(result.endISO).toISOString(),
    meet_link: result.meetLink || '',
    location: input.location || '',
  }
}

export function makeBookingOutbox({ db, fetch, gasUrl, receiverUrl, bridgeSecret,
                                   clock = () => Date.now(), uuid = () => crypto.randomUUID() }) {
  const collection = db.collection('bookingNotificationOutbox')
  const docFor = key => collection.doc(crypto.createHash('sha256').update(key).digest('hex'))

  async function prepare(input) {
    if (!input.requestId || input.requestId.length > 512) throw new Error('stable requestId required')
    const ref = docFor(input.requestId)
    return db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      const request = {
        name: input.name, email: input.email, subject: input.subject || '',
        startISO: input.startISO, duration: Number(input.duration), userTz: input.userTz || 'UTC',
        meetingTypeId: input.meetingTypeId || '', meetingTypeLabel: input.meetingTypeLabel || '',
        locationMode: input.locationMode || 'virtual', location: input.location || '',
      }
      if (snap.exists) {
        const row = snap.data()
        if (!isDeepStrictEqual(row.input,request)) throw new Error('requestId identity conflict')
        return { ref, ...row }
      }
      // High-entropy lookup key for reconciliation. It is not sent in API
      // responses/errors; the calendar event description contains it, as
      // existing requestId logging does. Guests can see their own event key.
      const row = { input: request, gasRequestId: 'notify_'+uuid().replace(/-/g,''),
                    state: 'awaiting_calendar', createdAt: clock(), nextAttemptAt: clock()+60000, attempts: 0 }
      tx.create(ref, row)
      return { ref, ...row }
    })
  }

  async function confirm(intent, result) {
    if (!result.ok || !result.eventId) return
    // Refuse old GAS versions: notification semantics require a reliable flag.
    if (typeof result.created !== 'boolean') throw new Error('GAS notification contract unavailable')
    const payload = payloadFor(intent.input, result)
    await db.runTransaction(async tx => {
      const snap = await tx.get(intent.ref)
      if (!snap.exists) throw new Error('missing durable intent')
      const row = snap.data()
      if (row.payload && !isDeepStrictEqual(row.payload,payload)) throw new Error('event identity conflict')
      // Both a true new creation and replay of OUR recorded opaque intent are
      // eligible. No pre-deployment requestId is ever reused as the GAS key.
      if (['delivered','pending','sending'].includes(row.state)) return
      tx.update(intent.ref, { payload, state:'pending', nextAttemptAt:clock(), confirmedAt:clock() })
    })
  }

  async function failed(intent, uncertain) {
    // Transport failure could follow calendar acceptance. Explicit rejection
    // without event is terminal; the drain only reconciles ambiguous transport.
    await intent.ref.update({ state:uncertain ? 'awaiting_calendar' : 'booking_rejected',
                               nextAttemptAt:uncertain ? clock()+60000 : Number.MAX_SAFE_INTEGER })
  }

  async function deliver(ref) {
    if (!receiverUrl || !bridgeSecret) throw new Error('AICOACH receiver is not configured')
    const parsed = new URL(receiverUrl)
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Invalid receiver URL')
    const claimId=uuid()
    const claimed=await db.runTransaction(async tx => {
      const snap=await tx.get(ref); if(!snap.exists)return null
      const row=snap.data()
      if(!['pending','sending'].includes(row.state) || (row.nextAttemptAt||0)>clock()) return null
      tx.update(ref,{state:'sending',claimId,nextAttemptAt:clock()+120000,attempts:(row.attempts||0)+1})
      return row
    })
    if(!claimed)return false
    try {
      const response=await fetch(receiverUrl.replace(/\/$/,'')+'/internal/booking-notifications',{
        method:'POST',headers:{'Content-Type':'application/json','X-Bridge-Secret':bridgeSecret},
        body:JSON.stringify(claimed.payload),signal:AbortSignal.timeout(15000) })
      const result=await response.json()
      if(!response.ok || !result.ok || !result.stored) throw new Error('receiver did not acknowledge durable receipt')
      await db.runTransaction(async tx=>{
        const snap=await tx.get(ref); if(snap.data()?.claimId===claimId)
          tx.update(ref,{state:'delivered',deliveredAt:clock(),nextAttemptAt:Number.MAX_SAFE_INTEGER})
      })
      return true
    } catch(error) {
      await db.runTransaction(async tx=>{
        const snap=await tx.get(ref);if(snap.data()?.claimId===claimId)
          tx.update(ref,{state:'pending',nextAttemptAt:clock()+300000,lastError:'receiver_unconfirmed'})
      })
      return false
    }
  }

  async function reconcile(ref,row) {
    const response=await fetch(gasUrl,{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({action:'lookupNotificationBooking',requestId:row.gasRequestId,startISO:row.input.startISO}),
      signal:AbortSignal.timeout(15000)})
    const result=await response.json()
    if(!response.ok || !result.ok)throw new Error('calendar lookup unavailable')
    if(result.found) {
      await confirm({ref,...row},{...result,ok:true,created:false})
    } else {
      // Do not create an event during reconciliation. Keep absent/ambiguous
      // results visible for manual investigation, with no automatic booking.
      await ref.update({state:'needs_review',lastError:'calendar_not_found',nextAttemptAt:Number.MAX_SAFE_INTEGER})
    }
  }

  async function drain() {
    // One simple range index; filter state client-side, cap batch at 50.
    const snap=await collection.where('nextAttemptAt','<=',clock()).orderBy('nextAttemptAt').limit(50).get()
    let attempted=0,delivered=0,errors=0
    for(const doc of snap.docs) {
      const row=doc.data()
      try {
        if(row.state==='awaiting_calendar')await reconcile(doc.ref,row)
        if(['awaiting_calendar','pending','sending'].includes(row.state)) {
          attempted++; if(await deliver(doc.ref))delivered++
        }
      } catch(error) { errors++;await doc.ref.update({nextAttemptAt:clock()+300000,lastError:'drain_failed'}) }
    }
    return {ok:true,attempted,delivered,errors}
  }
  return {prepare,confirm,failed,deliver,drain}
}
