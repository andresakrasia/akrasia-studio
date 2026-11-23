import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { TEST_CHAT_SECRET, TEST_CHAT_SERVICE_KEY } from './chat-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const env={SUPABASE_URL:'http://127.0.0.1:1',SUPABASE_SERVICE_ROLE_KEY:TEST_CHAT_SERVICE_KEY,
  CHAT_ORIGIN:'http://localhost:4322',CHAT_SESSION_SECRET:TEST_CHAT_SECRET,BOOKING_MEETING_URL:'',JITSI_MEET_BASE_URL:'https://meet.jit.si/',
  RESEND_API_KEY:'synthetic-resend-key',EMAIL_FROM:'Synthetic <sender@example.invalid>'};
const guard=installFetchGuard([]);const previousFetch=globalThis.fetch;
const vite=await createServer({root,configFile:false,envFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},
 define:Object.fromEntries(Object.entries({...env,PROD:false,DEV:true,SSR:true}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
let checks=0,groups=0;const equal=(a,b)=>{checks++;assert.deepEqual(a,b);};const ok=(v)=>{checks++;assert.ok(v);};
async function group(label,fn){await fn();console.log(`ok ${++groups} - ${label}`);}
const id='22222222-0000-4000-8000-000000000001',other='22222222-0000-4000-8000-000000000002',lease='22222222-0000-4000-8000-000000000003';
const row={id,booked_date:'2026-10-20',booked_time:'14:00:00',duration_min:30,buffer_min:30,status:'confirmed',meet_url:`https://meet.jit.si/Akrasia-${id}`,created_at:'2026-10-04T12:00:00Z'};
let calls=[],handler=()=>assert.fail('Unexpected synthetic network');
globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));const body=init?.body?JSON.parse(init.body):null;calls.push({url,body,init});return handler(url,body,init);};
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
try{
 const calendar=await vite.ssrLoadModule('/src/lib/booking-calendar.ts');const booking=await vite.ssrLoadModule('/src/lib/bookings.ts');
 const security=await vite.ssrLoadModule('/src/lib/chat-security.ts');const publicRoute=await vite.ssrLoadModule('/src/pages/api/bookings/calendar.ts');
 const adminRoute=await vite.ssrLoadModule('/src/pages/api/dashboard/bookings/calendar.ts');const auth=await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');
 const outbox=await vite.ssrLoadModule('/src/lib/integration-outbox.ts');const production=await vite.ssrLoadModule('/src/lib/production-config.ts');
 await group('Jitsi links are unique, deterministic and contain no visitor contact',()=>{
   equal(booking.configuredMeetingUrl(id),row.meet_url);equal(booking.configuredMeetingUrl(id),booking.configuredMeetingUrl(id));
   ok(booking.configuredMeetingUrl(id)!==booking.configuredMeetingUrl(other));
   for(const value of [undefined,'someone@example.invalid','short','https://example.invalid']){checks++;assert.throws(()=>booking.configuredMeetingUrl(value));}
   for(const value of ['javascript:alert(1)','http://meet.jit.si/room','https://user:pass@meet.jit.si/room','https://meet.jit.si/room#secret','https://meet.jit.si/room\r\nSUMMARY:injected']){checks++;assert.throws(()=>calendar.safeMeetingUrl(value));}
   const base={SUPABASE_URL:'https://db.example.test',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-only',CHAT_SESSION_SECRET:TEST_CHAT_SECRET,CHAT_ORIGIN:'https://akrasia.studio'};
   equal(production.inspectProductionConfiguration({...base,JITSI_MEET_BASE_URL:'https://meet.jit.si/'},{nodeVersion:'24.21.0'}).components.bookings.state,'configured');
   for(const value of ['https://meet.jit.si/room','https://meet.jit.si/?secret=x','http://meet.jit.si','https://user:pass@meet.jit.si'])equal(production.inspectProductionConfiguration({...base,JITSI_MEET_BASE_URL:value},{nodeVersion:'24.21.0'}).components.bookings.state,'invalid');
 });
 await group('Calendar expresses Madrid DST in UTC, folds UTF-8 and rejects line injection',()=>{
   const input={id,date:'2026-10-20',time:'14:00',meetUrl:row.meet_url,createdAt:row.created_at};
   const ics=calendar.bookingCalendar(input);equal(ics,calendar.bookingCalendar(input));ok(ics.includes('DTSTART:20261020T120000Z'));ok(ics.includes('DTEND:20261020T123000Z'));
   ok(ics.includes('X-WR-TIMEZONE:Europe/Madrid'));ok(ics.includes('STATUS:CONFIRMED'));ok(ics.replace(/\r\n /g,'').includes(`LOCATION:${row.meet_url}`));
   for(const line of ics.split('\r\n'))ok(Buffer.byteLength(line,'utf8')<=75);
   const winter=calendar.bookingCalendar({...input,date:'2026-10-26'});ok(winter.includes('DTSTART:20261026T130000Z'));
   const cancelled=calendar.bookingCalendar({...input,status:'cancelled'});ok(cancelled.includes('STATUS:CANCELLED'));
   for(const invalid of [{time:'25:00'},{date:'2026-02-30'},{date:'2026-10-25',time:'02:30'},{date:'2027-03-28',time:'02:30'},{id:'bad'},{duration:60},{meetUrl:'https://meet.jit.si/room\nEND:VCALENDAR'}]){checks++;assert.throws(()=>calendar.bookingCalendar({...input,...invalid}));}
 });
 await group('Visitor calendar requires signed session and own booking, admin calendar requires authorization',async()=>{
   calls=[];equal((await publicRoute.GET({request:new Request(env.CHAT_ORIGIN+`/api/bookings/calendar?id=${id}`)})).status,401);equal(calls.length,0);
   const config=security.readChatConfig(env,false,false);const session=security.chatSession(new Request(env.CHAT_ORIGIN),config);const cookie=session.cookie.split(';')[0];
   handler=(url,body)=>{equal(body.p_visitor_id,session.id);return response(row);};
   const result=await publicRoute.GET({request:new Request(env.CHAT_ORIGIN+`/api/bookings/calendar?id=${id}`,{headers:{cookie}})});
   equal(result.status,200);ok(result.headers.get('content-type').startsWith('text/calendar'));ok(result.headers.get('cache-control').includes('no-store'));ok((await result.text()).includes(row.meet_url));
   handler=()=>response({error:'invalid_reference'});
   equal((await publicRoute.GET({request:new Request(env.CHAT_ORIGIN+`/api/bookings/calendar?id=${other}`,{headers:{cookie}})})).status,403);
   for(const query of [`?id=${id}&id=${id}`,`?id=${id}&visitor_id=${session.id}`])equal((await publicRoute.GET({request:new Request(env.CHAT_ORIGIN+'/api/bookings/calendar'+query,{headers:{cookie}})})).status,400);
   const cross=new Request(env.CHAT_ORIGIN+`/api/bookings/calendar?id=${id}`,{headers:{cookie,'sec-fetch-site':'cross-site'}});equal((await publicRoute.GET({request:cross})).status,400);
   const req=new Request(env.CHAT_ORIGIN+`/api/dashboard/bookings/calendar?id=${id}`);equal((await adminRoute.GET({request:req})).status,401);
   auth.authorizeDashboardRequest(req);handler=url=>{ok(url.searchParams.get('select').includes('created_at'));return response([row]);};
   const admin=await adminRoute.GET({request:req});equal(admin.status,200);ok((await admin.text()).includes(row.meet_url));
 });
 await group('Confirmation and reminders attach identical calendar and share the persisted Jitsi URL',async()=>{
   const messages=[];const results=[];const payload={id,date:'2026-10-20',time:'14:00',name:'Synthetic',email:'synthetic@example.invalid',meetUrl:row.meet_url,createdAt:row.created_at};
   for(const hours of [undefined,24,1]){
     handler=(url,body)=>{if(url.pathname.endsWith('/integration_claim'))return response([{id,key:`booking:${id}:${hours||'confirm'}`,channel:'booking_email',leaseToken:lease,attempt:1,payload:{...payload,...(hours?{reminderHours:hours}:{})}}]);
       if(url.pathname.endsWith('/integration_email_payload'))return response({payload:body.p_payload});
       if(url.hostname==='api.resend.com'){messages.push(body);return response({id:'synthetic-accepted'});}if(url.pathname.endsWith('/integration_finish')){results.push(body);return response({saved:true});}assert.fail('Unexpected provider');};
     equal((await outbox.processIntegrationBatch(1)).accepted,1);
   }
   equal(results.length,3);equal(messages.length,3);
   const files=messages.map(mail=>{ok(mail.html.includes(row.meet_url));ok(mail.text.includes(row.meet_url));equal(mail.attachments[0].content_type,'text/calendar');return Buffer.from(mail.attachments[0].content,'base64').toString('utf8');});
   equal(files[0],files[1]);equal(files[1],files[2]);ok(files[0].includes('DTSTART:20261020T120000Z'));
   handler=url=>url.pathname.endsWith('/integration_claim')?response([{id,key:'bad:reminder',channel:'booking_email',leaseToken:lease,attempt:1,payload:{...payload,reminderHours:100}}]):response({saved:true});equal((await outbox.processIntegrationBatch(1)).failed,1);
 });
 await group('Worker sends frozen server HTML after deploy changes and checks cancellation before email',async()=>{
   const frozen={to:'synthetic@example.invalid',subject:'Version A',bodyText:'Saved original text',bodyHtml:'<div>Original server renderer</div>'};let sent;
   const job={id,key:'frozen:one',channel:'email',leaseToken:lease,attempt:2,payload:{to:frozen.to,subject:'Version B',bodyText:'New renderer input',templateType:'quote'}};
   handler=(url,body)=>{if(url.pathname.endsWith('/integration_claim'))return response([job]);
     if(url.pathname.endsWith('/integration_email_payload')){equal(body.p_payload.subject,'Version B');ok(body.p_payload.bodyHtml!==frozen.bodyHtml);return response({payload:frozen});}
     if(url.hostname==='api.resend.com'){sent=body;return response({id:'synthetic-accepted'});}return response({saved:true});};
   equal((await outbox.processIntegrationBatch(1)).accepted,1);equal(sent.html,frozen.bodyHtml);equal(sent.text,frozen.bodyText);equal(sent.subject,frozen.subject);
   sent=undefined;handler=url=>url.pathname.endsWith('/integration_claim')?response([job]):url.pathname.endsWith('/integration_email_payload')?response({disabled:true}):url.hostname==='api.resend.com'?assert.fail('Cancelled email must never call provider'):response({saved:true});
   equal((await outbox.processIntegrationBatch(1)).disabled,1);equal(sent,undefined);
   handler=url=>url.pathname.endsWith('/integration_claim')?response([job]):url.pathname.endsWith('/integration_email_payload')?new Response('{}',{status:503}):url.hostname==='api.resend.com'?assert.fail('Unfrozen email must never call provider'):response({saved:true});
   equal((await outbox.processIntegrationBatch(1)).retry,1);
 });
 equal(guard.blocked,[]);console.log(`Booking/calendar: ${groups} groups / ${checks} checks passed; no real providers or bookings.`);
}finally{globalThis.fetch=previousFetch;guard.restore();await vite.close();}
