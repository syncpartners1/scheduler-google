import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import {makeBookingOutbox,payloadFor} from './booking-outbox.js'

function fixture(fetchImpl=async()=>({ok:true,json:async()=>({ok:true,stored:true})})) {
  const rows=new Map();let now=1000;let n=0
  const ref=id=>({id,update:async values=>rows.set(id,{...rows.get(id),...values})})
  const snap=id=>({exists:rows.has(id),data:()=>structuredClone(rows.get(id)),ref:ref(id)})
  const collection={doc:ref,where:()=>({orderBy:()=>({limit:()=>({get:async()=>({docs:[...rows.keys()].filter(k=>rows.get(k).nextAttemptAt<=now).map(snap)})})})})}
  const db={collection:()=>collection,runTransaction:async fn=>fn({get:async r=>snap(r.id),create:(r,v)=>{assert(!rows.has(r.id));rows.set(r.id,structuredClone(v))},update:(r,v)=>rows.set(r.id,{...rows.get(r.id),...structuredClone(v)})})}
  const out=makeBookingOutbox({db,fetch:fetchImpl,gasUrl:'https://gas.test/',receiverUrl:'https://app.test/',bridgeSecret:'test-secret',clock:()=>now,uuid:()=>String(++n).padStart(32,'0')})
  return {out,rows,advance:ms=>now+=ms}
}
const input={requestId:'stable1',name:'Name',email:'person@example.test',subject:'Session',startISO:'2026-10-01T12:00:00Z',duration:60}
const result={ok:true,created:true,eventId:'event1',startISO:'2026-10-01T15:00:00+03:00',endISO:'2026-10-01T16:00:00+03:00',meetLink:''}

test('prepare commits durable intent before calendar call and duplicates reuse key',async()=>{
 const {out,rows}=fixture();const a=await out.prepare(input),b=await out.prepare(input)
 assert.equal(a.gasRequestId,b.gasRequestId);assert.equal(rows.size,1);assert.equal(a.state,'awaiting_calendar')
 assert.match(a.gasRequestId,/^notify_[a-f0-9]{32}$/)
})
test('request identity conflict is blocked before calendar',async()=>{
 const {out}=fixture();await out.prepare(input);await assert.rejects(out.prepare({...input,name:'Other'}))
})
test('missing key rejected',async()=>{
 const {out}=fixture();await assert.rejects(out.prepare({...input,requestId:''}))
})
test('payload canonicalizes event ID and timezone',()=>{
 const p=payloadFor(input,{...result,eventId:'event1@google.com'})
 assert.equal(p.event_id,'event1');assert.equal(p.start,'2026-10-01T12:00:00.000Z')
})
test('confirmed new intent yields one durable delivery despite replay',async()=>{
 let calls=0;const {out,rows}=fixture(async()=>{calls++;return {ok:true,json:async()=>({ok:true,stored:true})}})
 const a=await out.prepare(input);await out.confirm(a,result);assert(await out.deliver(a.ref))
 await out.confirm(a,{...result,created:false,eventId:'event1@google.com',startISO:'2026-10-01T12:00:00Z',endISO:'2026-10-01T13:00:00Z'})
 assert.equal(await out.deliver(a.ref),false);assert.equal(calls,1);assert.equal([...rows.values()][0].state,'delivered')
})
test('old GAS contract refuses confirm, preserving reconcilable intent',async()=>{
 const {out,rows}=fixture();const a=await out.prepare(input);const r={...result};delete r.created
 await assert.rejects(out.confirm(a,r));assert.equal([...rows.values()][0].state,'awaiting_calendar')
})
test('unconfirmed receiver retries only receipt, never booking',async()=>{
 let calls=[];let fail=true
 const {out,advance,rows}=fixture(async(url,opts)=>{calls.push({url,body:JSON.parse(opts.body)});if(fail)throw Error('transport');return{ok:true,json:async()=>({ok:true,stored:true})}})
 const a=await out.prepare(input);await out.confirm(a,result);assert.equal(await out.deliver(a.ref),false)
 assert.equal([...rows.values()][0].state,'pending');fail=false;advance(300001);assert(await out.deliver(a.ref))
 assert.equal(calls.length,2);assert(calls.every(c=>c.url.endsWith('/internal/booking-notifications')))
})
test('ambiguous calendar transport reconciles read-only lookup then delivers',async()=>{
 const calls=[];const {out,advance,rows}=fixture(async(url,opts)=>{const data=JSON.parse(opts.body);calls.push(data);return{ok:true,json:async()=> data.action ? {...result,created:false,found:true}: {ok:true,stored:true}}})
 const a=await out.prepare(input);await out.failed(a,true);advance(60001);await out.drain()
 assert.equal(calls[0].action,'lookupNotificationBooking');assert(calls.every(c=>c.action!=='createEvent'))
 assert.equal([...rows.values()][0].state,'delivered')
})
test('missing calendar outcome becomes manual review without booking',async()=>{
 const {out,advance,rows}=fixture(async()=>({ok:true,json:async()=>({ok:true,found:false})}))
 await out.prepare(input);advance(60001);await out.drain();assert.equal([...rows.values()][0].state,'needs_review')
})
test('explicit booking rejection terminal, no notifications',async()=>{
 const {out,advance,rows}=fixture();const a=await out.prepare(input);await out.failed(a,false);advance(1000000)
 assert.equal((await out.drain()).attempted,0);assert.equal([...rows.values()][0].state,'booking_rejected')
})
test('leases recover interrupted sending after deadline',async()=>{
 const {out,advance,rows}=fixture();const a=await out.prepare(input);await out.confirm(a,result)
 await a.ref.update({state:'sending',nextAttemptAt:120000,claimId:'old'});assert.equal(await out.deliver(a.ref),false)
 advance(120001);assert(await out.deliver(a.ref));assert.equal([...rows.values()][0].state,'delivered')
})
test('reschedule path has no new-booking notification',()=>{
 const source=fs.readFileSync(new URL('./server.js',import.meta.url),'utf8')
 const block=source.slice(source.indexOf("app.post('/api/admin/reschedule'"),source.indexOf("app.get('/admin-bookings'"))
 assert(!block.includes('bookingOutbox'));assert(!block.includes('recordConfirmedBooking'))
 assert(source.includes("app.post('/api/admin/booking-notifications/drain',requireApiKey"))
})
test('both new booking routes prepare before GAS and preserve calendar success',()=>{
 const source=fs.readFileSync(new URL('./server.js',import.meta.url),'utf8')
 for(const route of ["app.post('/api/book'","app.post('/api/public/book'"]){
 const start=source.indexOf(route),block=source.slice(start,source.indexOf('/**',start))
 assert(block.indexOf('bookingOutbox.prepare')<block.indexOf('gasFetch(GAS_URL'))
 assert(block.includes('await recordConfirmedBooking(intent,data)'));assert(block.includes('res.json(data)'))
 }
})
test('GAS lookup is read only, rejects guessable old keys',()=>{
 const source=fs.readFileSync(new URL('./gas/Code.gs',import.meta.url),'utf8')
 const ctx={findEventByRequestId:()=>null};vm.createContext(ctx);vm.runInContext(source,ctx);ctx.findEventByRequestId=()=>null
 assert.equal(ctx.lookupNotificationBooking({requestId:'old',startISO:input.startISO}).ok,false)
 assert.equal(ctx.lookupNotificationBooking({requestId:'notify_'+'a'.repeat(32),startISO:input.startISO}).found,false)
})
test('browser preserves intent across retries and reloads',()=>{
 const source=fs.readFileSync(new URL('./src/App.jsx',import.meta.url),'utf8')
 assert(source.includes("sessionStorage.getItem('booking-intent')"))
 assert(source.includes('previous?.identity === identity'))
 assert(!source.includes('`${email}-${selectedSlot.start}-${Date.now()}`'))
})

test('payload carries the phone only when there is one',()=>{
 assert.equal(payloadFor({...input,phone:'+972501234567'},result).phone,'+972501234567')
 assert.equal('phone' in payloadFor(input,result),false)
})
test('phone is part of the booking identity, and old intents without it still match',async()=>{
 const {out}=fixture();await out.prepare(input)
 await out.prepare(input)
 await assert.rejects(out.prepare({...input,phone:'+972501234567'}))
 const b=fixture();await b.out.prepare({...input,phone:'+972501234567'})
 await b.out.prepare({...input,phone:'+972501234567'})
 await assert.rejects(b.out.prepare({...input,phone:'+972509999999'}))
})
test('the confirmed notification sent to AICOACH includes the phone',async()=>{
 let body
 const {out}=fixture(async(url,opts)=>{body=JSON.parse(opts.body);return {ok:true,json:async()=>({ok:true,stored:true})}})
 const a=await out.prepare({...input,phone:'+972501234567'});await out.confirm(a,result);assert(await out.deliver(a.ref))
 assert.equal(body.phone,'+972501234567')
})
