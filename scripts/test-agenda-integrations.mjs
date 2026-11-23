import assert from 'node:assert/strict';
import path from 'node:path';import {fileURLToPath} from 'node:url';import {createServer} from 'vite';
import {installFetchGuard} from './dashboard-test-network-guard.mjs';import {TEST_CHAT_SECRET,TEST_CHAT_SERVICE_KEY} from './chat-test-fixture.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const guard=installFetchGuard([]);const previous=globalThis.fetch;
const env={SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:TEST_CHAT_SERVICE_KEY,BOOKING_MEETING_URL:'https://example.invalid/meeting',
  RESEND_API_KEY:'synthetic-resend-key',EMAIL_FROM:'Synthetic <sender@example.invalid>',TELEGRAM_BOT_TOKEN:'synthetic-bot-token',TELEGRAM_CHAT_ID:'synthetic-chat',INTEGRATION_WORKER_SECRET:'ef'.repeat(32),CHAT_SESSION_SECRET:TEST_CHAT_SECRET};
const vite=await createServer({root,configFile:false,envFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},
  define:Object.fromEntries(Object.entries({...env,PROD:false,DEV:true,SSR:true}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
let checks=0,groups=0;const eq=(a,b)=>{checks++;assert.deepEqual(a,b);};const ok=v=>{checks++;assert.ok(v);};async function group(name,run){await run();console.log(`ok ${++groups} - ${name}`);}
const id='15151515-0000-4000-8000-000000000001',lease='15151515-0000-4000-8000-000000000002';const signal=new AbortController().signal;
let calls=[];let handler;const respond=(value,status=200)=>new Response(JSON.stringify(value),{status});
globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));calls.push({url:url.href,init,body:init?.body?JSON.parse(init.body):null});if(handler)return handler(url,init);assert.fail(`Unmocked network ${url.origin}`);};
try {
 const civil=await vite.ssrLoadModule('/src/lib/civil-time.ts');const booking=await vite.ssrLoadModule('/src/lib/bookings.ts');const mail=await vite.ssrLoadModule('/src/lib/email.ts');const notify=await vite.ssrLoadModule('/src/lib/notify.ts');const outbox=await vite.ssrLoadModule('/src/lib/integration-outbox.ts');const worker=await vite.ssrLoadModule('/src/pages/api/integrations/process.ts');
 await group('Civil dates remain in Madrid, reject impossible/DST repeated/gap times and preserve arithmetic',async()=>{
   eq(civil.madridDateKey(Date.parse('2026-10-02T23:00:00Z')),'2026-10-03');eq(civil.madridInstant('2027-03-28','02:30'),null);eq(civil.madridInstant('2026-10-25','02:30'),null);
   for(const day of ['2026-02-29','2026-04-31','2027-02-31','2026-13-01','0000-01-01'])eq(civil.isCivilDate(day),false);
   eq(civil.isCivilDate('2028-02-29'),true);eq(civil.mondayOfCivilWeek('2026-10-04'),'2026-09-28');
   for(let i=0;i<365;i++){const day=civil.addCivilDays('2026-01-01',i);eq(civil.addCivilDays(day,-i),'2026-01-01');
     const instant=civil.madridInstant(day,'12:30');ok(instant!==null);eq(civil.madridDateKey(instant),day);eq(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Madrid',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(instant),'12:30');}
 });
 await group('Legacy natural queries cannot confuse date numbers, relative days or impossible dates',async()=>{
   const now=Date.parse('2026-10-02T12:00:00Z');eq(booking.parseBookingRequest('pasado mañana a las 17:00',now),{date:'2026-10-04',time:'17:00'});
   eq(booking.parseBookingRequest('20/10/2026 a las 17:00',now),{date:'2026-10-20',time:'17:00'});eq(booking.parseBookingRequest('31/02/2027 a las 17:00',now),null);
   for(const text of ['mañana','mañana a las 25:00','2026-10-02 a las 10:00','2026-10-25 a las 02:30','2027-03-28 a las 02:30','20/10/2026'])eq(booking.parseBookingRequest(text,now),null);
 });
 await group('Availability/creation RPC fails closed and validates ownership/result before confirmation',async()=>{
   calls=[];handler=()=>respond(true);eq(await booking.checkAvailability('2026-10-10','12:00'),true);eq(calls[0].url.endsWith('/rpc/booking_available'),true);
   for(const value of [null,{},[],1,'true']){handler=()=>respond(value);checks++;await assert.rejects(()=>booking.checkAvailability('2026-10-10','12:00'),e=>e.code==='booking_unavailable');}
   calls=[];checks++;await assert.rejects(()=>booking.createBookingOnce({visitorId:id,bookingId:lease,bookedDate:'2026-10-10',bookedTime:'12:00'}),e=>e.code==='invalid_request');eq(calls.length,0);
   const data={visitorId:id,bookingId:lease,bookedDate:'2026-10-10',bookedTime:'12:00',visitorEmail:'synthetic@example.invalid',contextVersion:0,sessionExpiresAt:Date.now()/1000|0};
   handler=(url,init)=>{const input=JSON.parse(init.body);eq(input.p_context_version,0);return respond({created:true,booking:{...input.p_booking,status:'confirmed'}});};eq((await booking.createBookingOnce(data)).created,true);
   handler=()=>respond({created:true,booking:{visitor_id:lease}});checks++;await assert.rejects(()=>booking.createBookingOnce(data),e=>e.code==='booking_unavailable');
   handler=()=>respond({},503);checks++;await assert.rejects(()=>booking.checkAvailability('2026-10-10','12:00'),e=>e.code==='integration_unavailable');
 });
 await group('Calendar availability uses one bounded RPC, keeps every returned start and rejects fabricated results',async()=>{
   const now=Date.parse('2026-10-04T10:00:00Z');const from='2026-10-05',to='2026-10-31';
   const rows=Array.from({length:12},(_,index)=>({date:from,time:`${String(9+Math.floor(index/2)).padStart(2,'0')}:${index%2?'30':'00'}`}));
   calls=[];handler=()=>respond([...rows].reverse());eq(await booking.getAvailableSlotsRange(from,to,signal,now),rows);
   eq(calls.length,1);ok(calls[0].url.endsWith('/rpc/booking_slots_range'));eq(calls[0].body,{p_start_date:from,p_end_date:to});
   handler=()=>respond([]);eq(await booking.getAvailableSlotsRange(from,from,signal,now),[]);
   for(const value of [null,{},[{date:'2026-10-04',time:'15:00'}],[{date:'2026-11-01',time:'15:00'}],
     [{date:from,time:'24:00'}],[rows[0],rows[0]],[{date:'2026-10-25',time:'02:30'}]]) {
     handler=()=>respond(value);checks++;await assert.rejects(()=>booking.getAvailableSlotsRange(from,to,signal,now),e=>e.code==='booking_unavailable');
   }
   handler=()=>respond([{date:from,time:'15:00',visitor_email:'private@example.invalid'}]);
   eq(await booking.getAvailableSlotsRange(from,to,signal,now),[{date:from,time:'15:00'}]);
   handler=()=>respond([{date:'2026-10-04',time:'11:30'}]);checks++;await assert.rejects(()=>booking.getAvailableSlotsRange('2026-10-04','2026-10-04',signal,now),e=>e.code==='booking_unavailable');
   handler=()=>respond([{date:'2027-04-03',time:'12:00'}]);checks++;await assert.rejects(()=>booking.getAvailableSlotsRange('2027-04-01','2027-04-30',signal,now),e=>e.code==='booking_unavailable');
   handler=()=>respond({},404);checks++;await assert.rejects(()=>booking.getAvailableSlotsRange(from,to,signal,now),e=>e.code==='integration_unavailable');
   calls=[];for(const range of [['2026-10-01','2026-11-01'],['2026-10-06',from],['2026-02-30',from]]) {
     checks++;await assert.rejects(()=>booking.getAvailableSlotsRange(...range,signal,now),e=>e.code==='invalid_request');
   }eq(calls.length,0);
 });
 await group('Resend has stable idempotency and distinguishes acceptance from delivery/failure',async()=>{
   const payload={to:'synthetic@example.invalid',toName:'Synthetic',subject:'Subject',bodyText:'Plain',bodyHtml:mail.generateEmailHtml('<script>')};
   calls=[];handler=()=>respond({id:'synthetic-provider-id'});const result=await mail.sendEmail(payload,{idempotencyKey:'synthetic:one',signal});eq(result.disposition,'accepted');eq(result.success,true);
   eq(calls[0].init.headers['Idempotency-Key'],'synthetic:one');eq(calls[0].body.to,'synthetic@example.invalid');ok(calls[0].init.signal instanceof AbortSignal);ok(payload.bodyHtml.includes('&lt;script&gt;'));
   for(const status of [429,500,503]){handler=()=>respond({},status);eq((await mail.sendEmail(payload,{idempotencyKey:'synthetic:one'})).disposition,'retry');}
   handler=()=>respond({},400);eq((await mail.sendEmail(payload,{idempotencyKey:'synthetic:one'})).disposition,'failed');
   handler=()=>{throw new Error('Synthetic transport');};eq((await mail.sendEmail(payload,{idempotencyKey:'synthetic:one'})).disposition,'retry');
   calls=[];eq((await mail.sendEmail(payload,{idempotencyKey:'bad\nheader'})).disposition,'failed');eq(calls.length,0);
 });
 await group('Telegram is plain text and ambiguous external effects are never automatically retried',async()=>{
   const text='*[malicious](https://example.invalid) <b>plain</b>';calls=[];handler=()=>respond({ok:true,result:{message_id:12}});eq((await notify.sendTelegramText(text)).status,'accepted');
   eq(calls[0].body,{chat_id:'synthetic-chat',text});eq(calls[0].body.parse_mode,undefined);
   handler=()=>respond({},429);eq((await notify.sendTelegramText(text)).status,'retry');handler=()=>respond({},500);eq((await notify.sendTelegramText(text)).status,'uncertain');
   handler=()=>respond({ok:false});eq((await notify.sendTelegramText(text)).status,'uncertain');handler=()=>{throw new Error();};eq((await notify.sendTelegramText(text)).status,'uncertain');
 });
 await group('Outbox validates/miminizes payload and worker only returns durable saved states',async()=>{
   calls=[];handler=()=>respond({id,status:'queued'});eq((await outbox.enqueueIntegration({channel:'email',idempotencyKey:'test:one',payload:{to:'synthetic@example.invalid',subject:'Synthetic',bodyText:'<b>text</b>',bodyHtml:'<script>alert(1)</script>'}})).status,'queued');
   ok(calls[0].body.p_payload.bodyHtml.includes('&lt;b&gt;text&lt;/b&gt;'));ok(!calls[0].body.p_payload.bodyHtml.includes('<script>'));eq(calls[0].body.p_visitor_id,null);
   const finishes=[];handler=(url,init)=>{if(url.pathname.endsWith('/integration_claim'))return respond([{id,key:'test:booking',channel:'booking_email',leaseToken:lease,attempt:1,payload:{id,date:'2026-10-10',time:'12:00',email:'synthetic@example.invalid',name:'Synthetic',meetUrl:''}}]);
     if(url.pathname.endsWith('/integration_email_payload'))return respond({payload:JSON.parse(init.body).p_payload});
     if(url.hostname==='api.resend.com')return respond({id:'fake-accepted'});if(url.pathname.endsWith('/integration_finish')){finishes.push(JSON.parse(init.body));return respond({saved:true});}assert.fail('Unexpected worker request');};
   const result=await outbox.processIntegrationBatch(1);eq(result.accepted,1);eq(finishes[0].p_status,'accepted');eq(finishes[0].p_provider_id,'fake-accepted');
   const sent=calls.findLast(c=>new URL(c.url).hostname==='api.resend.com');ok(sent.body.text.includes('El equipo te facilitará el enlace'));ok(!sent.body.text.includes('meet.jit.si'));
   handler=url=>url.pathname.endsWith('/integration_claim')?respond([{id,key:'test:telegram',channel:'telegram',leaseToken:lease,attempt:1,payload:{text:'Synthetic'}}]):url.hostname==='api.telegram.org'?Promise.reject(new Error()):respond({saved:true});
   eq((await outbox.processIntegrationBatch(1)).uncertain,1);
   handler=url=>url.pathname.endsWith('/integration_claim')?respond([{id,key:'test:bad',channel:'email',leaseToken:lease,attempt:1,payload:{to:'bad'}}]):respond({saved:true});eq((await outbox.processIntegrationBatch(1)).failed,1);
 });
 await group('Worker secret/parameters reject requests before any external work',async()=>{
   calls=[];for(const headers of [{},{authorization:'Bearer bad'},{authorization:`Bearer ${TEST_CHAT_SECRET}`},{authorization:`Bearer ${'é'.repeat(64)}`}]){const res=await worker.POST({request:new Request('http://localhost/api/integrations/process',{method:'POST',headers})});eq(res.status,401);}eq(calls.length,0);
   const res=await worker.POST({request:new Request('http://localhost/api/integrations/process?bad=1',{method:'POST',headers:{authorization:`Bearer ${env.INTEGRATION_WORKER_SECRET}`}})});eq(res.status,400);eq(calls.length,0);
   const body=await worker.POST({request:new Request('http://localhost/api/integrations/process',{method:'POST',headers:{authorization:`Bearer ${env.INTEGRATION_WORKER_SECRET}`},body:'unexpected'})});eq(body.status,400);eq(calls.length,0);
 });
 eq(guard.blocked,[]);console.log(`Agenda/integrations: ${groups} groups / ${checks} checks passed; synthetic providers only.`);
}finally{globalThis.fetch=previous;guard.restore();await vite.close();}
