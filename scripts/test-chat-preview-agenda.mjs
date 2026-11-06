import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { TEST_SERVICE_KEY } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Application booking actions, signed proposals and shared local rows only.
// No .env, provider, actual messages, PostgreSQL or production data.
let now=Date.UTC(2026,9,3,12),groups=0,checks=0;
const equal=(actual,expected)=>{checks++;assert.deepEqual(actual,expected);};
const ok=value=>{checks++;assert.ok(value);};
const group=async(title,test)=>{await test();console.log(`ok ${++groups} - ${title}`);};
const secret='cd'.repeat(32);
const fixture=await createChatFirstPreviewFixture({clock:()=>now,chatSessionSecret:secret});
const guard=installFetchGuard(fixture.allowedOrigins);
const environment=fixture.environment('http://localhost:4322');
const vite=await createServer({root:process.cwd(),configFile:false,envFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},define:Object.fromEntries(Object.entries({...environment,PROD:false,DEV:true,SSR:true}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
const owner=randomUUID(),other=randomUUID();
const scope=(visitorId=owner)=>({p_visitor_id:visitorId,p_expires_at:Math.floor(now/1000)+86400,p_context_version:0});
const payload=(visitorId=owner,time='10:00')=>({id:randomUUID(),visitor_id:visitorId,conversation_id:null,lead_id:null,booked_date:'2026-10-05',booked_time:time,duration_min:30,buffer_min:30,meet_url:'',visitor_email:'audit@example.invalid',visitor_phone:null,visitor_name:'Cliente de auditoría',notes:null});
async function rpc(name,body,key=TEST_SERVICE_KEY){const response=await fetch(`${fixture.origin}/rest/v1/rpc/${name}`,{method:'POST',headers:{apikey:key,authorization:`Bearer ${key}`,'content-type':'application/json'},body:JSON.stringify(body)});return {status:response.status,value:await response.json()};}
const availability=(date,time)=>rpc('booking_available',{p_date:date,p_time:time});

try{
  const actions=await vite.ssrLoadModule('/src/lib/chat-actions.ts');
  const security=await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const bookings=await vite.ssrLoadModule('/src/lib/bookings.ts');
  const config=security.readChatConfig(environment,false,false);
  await group('Stable optional session key is validated before starting fixtures',async()=>{
    equal(environment.CHAT_SESSION_SECRET,secret);
    for(const value of ['',123,'a'.repeat(63),'not-a-secret'.repeat(8),'ab'.repeat(65)]){checks++;await assert.rejects(()=>createChatFirstPreviewFixture({chatSessionSecret:value}),/Invalid synthetic preview configuration/);}
    const fresh=await createChatFirstPreviewFixture();
    try{ok(/^[a-f0-9]{64}$/.test(fresh.environment('http://localhost:4322').CHAT_SESSION_SECRET));ok(fresh.environment('http://localhost:4322').CHAT_SESSION_SECRET!==secret);}finally{await fresh.close();}
  });
  await group('Shared weekly agenda provides future Madrid slots and handles blocks and DST',async()=>{
    fixture.tables.availability.push({id:randomUUID(),day_of_week:1,start_time:'09:00:00',end_time:'14:00:00',is_active:true});
    equal((await availability('2026-10-05','10:00')).value,true);
    equal((await availability('2026-10-05','13:45')).value,false);
    equal((await availability('2026-10-02','10:00')).value,false);
    equal((await availability('2026-10-05','24:00')).value,false);
    equal((await availability('2026-02-30','10:00')).value,false);
    equal((await availability('2026-10-25','02:30')).value,false);
    fixture.tables.availability_overrides.push({id:randomUUID(),override_date:'2026-10-05',is_available:false,start_time:'09:30',end_time:'10:00'});
    equal((await availability('2026-10-05','09:15')).value,false);
    equal((await availability('2026-10-05','10:00')).value,true);
    const slots=await rpc('booking_slots',{p_date:'2026-10-05',p_count:3});
    equal(slots.value,[{date:'2026-10-05',time:'09:00'},{date:'2026-10-05',time:'10:00'},{date:'2026-10-05',time:'10:30'}]);
    equal(fixture.tables.bookings.length,0);
    equal((await rpc('booking_slots',{p_date:'2026-10-05',p_count:11})).status,400);
  });
  await group('Calendar preview returns complete actual days in one bounded range query',async()=>{
    fixture.tables.availability_overrides.push(
      {id:randomUUID(),override_date:'2026-10-06',is_available:true,start_time:'08:00',end_time:'20:00'},
      {id:randomUUID(),override_date:'2026-10-06',is_available:false,start_time:'12:00',end_time:'13:00'});
    const requestsBefore=fixture.requests.length;
    const starts=await bookings.getAvailableSlotsRange('2026-10-05','2026-10-06',new AbortController().signal,now);
    equal(fixture.requests.length,requestsBefore+1);
    equal(starts.filter(slot=>slot.date==='2026-10-05').length,9);
    equal(starts.filter(slot=>slot.date==='2026-10-06').length,22);
    equal(starts.at(-1),{date:'2026-10-06',time:'19:30'});
    ok(starts.every(slot=>slot.date!=='2026-10-06'||!['12:00','12:30'].includes(slot.time)));
    equal((await rpc('booking_slots_range',{p_start_date:'2026-10-01',p_end_date:'2026-11-01'})).status,400);
    equal((await rpc('booking_slots_range',{p_start_date:'2026-10-06',p_end_date:'2026-10-05'})).status,400);
    equal((await rpc('booking_slots_range',{p_start_date:'2026-10-07',p_end_date:'2026-10-07'})).value,[]);
    equal(fixture.tables.bookings.length,0);equal(fixture.tables.integration_outbox.length,0);
  });
  let confirmed,proposal;
  await group('A real signed proposal confirms once and queues notifications in shared admin rows',async()=>{
    const context={visitorId:owner,config,signal:new AbortController().signal,contextVersion:0,sessionExpiresAt:scope().p_expires_at};
    const preparation=await actions.prepareBookingAction({name:'prepare_booking',arguments:JSON.stringify({date:'2026-10-05',time:'10:00',email:'audit@example.invalid',name:'Cliente de auditoría'})},context,{now:()=>now});
    equal(preparation.status,'confirmation_required');equal(fixture.tables.bookings.length,0);
    proposal=preparation.proposal;
    confirmed=await actions.confirmBookingAction(proposal.token,context,{now:()=>now});
    equal(confirmed.status,'confirmed');equal(confirmed.notification,'queued');
    equal(fixture.tables.bookings.length,1);equal(fixture.dashboard.tables.bookings,fixture.chat.tables.bookings);
    equal(fixture.tables.bookings[0].starts_at,'2026-10-05T08:00:00.000Z');
    equal(fixture.tables.integration_outbox.map(row=>row.channel),['booking_telegram','booking_email','booking_admin_email']);
    ok(fixture.tables.integration_outbox.every(row=>row.booking_id===confirmed.booking.id&&row.status==='queued'&&row.attempts===0));
    const repeated=await actions.confirmBookingAction(proposal.token,context,{now:()=>now});
    equal(repeated.booking,confirmed.booking);equal(repeated.notification,'already_processed');
    equal(fixture.tables.bookings.length,1);equal(fixture.tables.integration_outbox.length,3);
    const restarted=await createChatFirstPreviewFixture({clock:()=>now,chatSessionSecret:secret});
    try{
      const restoredConfig=security.readChatConfig(restarted.environment('http://localhost:4322'),false,false);
      equal(actions.verifyBookingProposal(proposal.token,owner,restoredConfig,now).bookingId,confirmed.booking.id);
      equal(restarted.tables.bookings.length,0); // Keeping a key never restores customer rows implicitly.
    }finally{await restarted.close();}
    const response=await fetch(`${fixture.origin}/rest/v1/bookings?select=*&id=eq.${confirmed.booking.id}`,{headers:{apikey:TEST_SERVICE_KEY,authorization:`Bearer ${TEST_SERVICE_KEY}`}});
    equal(response.status,200);equal((await response.json())[0].id,confirmed.booking.id);
    checks++;await assert.rejects(()=>actions.confirmBookingAction(proposal.token,{...context,visitorId:other},{now:()=>now}),error=>error.code==='invalid_reference');
  });
  await group('Foreign references, changed context and expired sessions cannot create bookings or notifications',async()=>{
    const before={bookings:fixture.tables.bookings.length,jobs:fixture.tables.integration_outbox.length};
    const foreignConversation=randomUUID();fixture.tables.conversations.push({id:foreignConversation,visitor_id:other,created_at:new Date(now).toISOString()});
    equal((await rpc('booking_create_once',{...scope(),p_booking:{...payload(owner,'11:00'),conversation_id:foreignConversation}})).value,{error:'invalid_reference'});
    fixture.chat.contextStates.get(owner).contextVersion=1;
    equal((await rpc('booking_create_once',{...scope(),p_booking:payload(owner,'11:00')})).value,{error:'chat_context_changed'});
    equal((await rpc('booking_create_once',{...scope(),p_context_version:1,p_expires_at:Math.floor(now/1000),p_booking:payload(owner,'11:00')})).status,400);
    equal((await rpc('booking_create_once',{...scope(),p_context_version:1,p_expires_at:Math.floor(now/1000)+2592002,p_booking:payload(owner,'11:00')})).status,400);
    const existing=fixture.tables.bookings[0];
    equal((await rpc('booking_create_once',{...scope(),p_context_version:1,p_booking:{...payload(),id:existing.id,visitor_email:'different@example.invalid'}})).status,400);
    equal(fixture.tables.bookings.length,before.bookings);equal(fixture.tables.integration_outbox.length,before.jobs);
  });
  await group('The buffer blocks occupied times; two concurrent visitors cannot acquire the same slot',async()=>{
    equal((await availability('2026-10-05','10:30')).value,false);
    equal((await availability('2026-10-05','11:00')).value,true);
    equal((await rpc('booking_create_once',{...scope(other),p_booking:payload(other,'10:30')})).value,{created:false,booking:null});
    const owners=[randomUUID(),randomUUID()],results=await Promise.all(owners.map(id=>rpc('booking_create_once',{...scope(id),p_booking:payload(id,'11:00')})));
    equal(results.filter(row=>row.value.created).length,1);equal(results.filter(row=>row.value.booking===null).length,1);
    equal(fixture.tables.bookings.filter(row=>row.booked_time==='11:00').length,1);
    equal(fixture.tables.integration_outbox.length,6);
  });
  await group('Ownership protects read/cancel, cancellation frees slots and disables only related queued jobs',async()=>{
    const id=confirmed.booking.id;
    equal((await rpc('booking_owned_action',{p_visitor_id:other,p_booking_id:id,p_action:'get'})).value,{error:'invalid_reference'});
    equal((await rpc('booking_owned_action',{p_visitor_id:other,p_booking_id:id,p_action:'cancel'})).value,{error:'invalid_reference'});
    equal((await bookings.ownedBooking(owner,id,'get')).status,'confirmed');
    equal((await bookings.ownedBooking(owner,id,'cancel')).status,'cancelled');
    equal((await availability('2026-10-05','10:00')).value,true);
    ok(fixture.tables.integration_outbox.filter(row=>row.booking_id===id).every(row=>row.status==='disabled'&&row.error_code==='booking_cancelled'));
    ok(fixture.tables.integration_outbox.filter(row=>row.booking_id!==id).every(row=>row.status==='queued'));
    const second=fixture.tables.bookings.find(row=>row.id!==id);
    equal((await rpc('booking_admin_status',{p_id:second.id,p_status:'completed'})).value[0].status,'completed');
    ok(fixture.tables.integration_outbox.filter(row=>row.booking_id===second.id).every(row=>row.status==='disabled'));
    equal((await rpc('booking_admin_status',{p_id:id,p_status:'confirmed'})).status,400);
    equal((await rpc('booking_available',{p_date:'2026-10-05',p_time:'10:00'},'foreign-key')).status,403);
  });
  await group('Preview Overview computes shared monthly cohorts, contacts, messages and full zero-filled series',async()=>{
    fixture.tables.conversations.length=0;fixture.tables.messages.length=0;fixture.tables.leads.length=0;
    const cOld=randomUUID(),cBoundary=randomUUID(),cToday=randomUUID(),cEmpty=randomUUID();
    const conversation=(id,created_at)=>({id,visitor_id:randomUUID(),created_at});
    fixture.tables.conversations.push(conversation(cOld,'2026-09-30T21:59:00Z'),conversation(cBoundary,'2026-09-30T22:00:00Z'),conversation(cToday,'2026-10-03T10:00:00Z'),conversation(cEmpty,'2026-10-02T10:00:00Z'),conversation(randomUUID(),'2026-10-04T10:00:00Z'));
    const message=(id,role,created_at)=>({id:randomUUID(),conversation_id:id,role,created_at});
    fixture.tables.messages.push(message(cBoundary,'user','2026-09-30T22:00:00Z'),message(cBoundary,'assistant','2026-09-30T22:02:00Z'),message(cToday,'user','2026-10-03T10:00:00Z'),message(cToday,'assistant','2026-10-03T10:01:00Z'),message(cOld,'user','2026-10-03T09:00:00Z'),message(cToday,'assistant','2026-10-04T10:00:00Z'));
    fixture.tables.leads.push({id:randomUUID(),conversation_id:cBoundary,email:'boundary@example.invalid',status:'qualified',created_at:'2026-09-30T21:00:00Z',contact_captured_at:'2026-09-30T22:00:00Z'},{id:randomUUID(),conversation_id:cToday,phone:'000000000',status:'new',created_at:'2026-10-03T10:00:00Z'},{id:randomUUID(),conversation_id:cOld,email:'old@example.invalid',status:'lost',created_at:'2026-09-30T21:59:00Z'},{id:randomUUID(),email:' ',phone:'',status:'new',created_at:'2026-10-03T10:00:00Z'},{id:randomUUID(),email:'future@example.invalid',status:'new',created_at:'2026-10-04T10:00:00Z'});
    const metrics=(await rpc('dashboard_metrics',{})).value;
    equal(metrics.visitorsToday,2);equal(metrics.totalConversations,3);equal(metrics.leadsThisMonth,2);equal(metrics.leadsThisWeek,3);equal(metrics.leadsByStatus,{qualified:1,new:1});equal(metrics.avgMessages,1);equal(metrics.avgDurationSec,60);equal(metrics.avgDurationMin,1);equal(metrics.conversionRatio,67);equal(metrics.leadsPerWeek.length,8);equal(metrics.visitsPerDay.length,14);equal(metrics.visitsPerDay.at(-1),{date:'03/10',visits:1});equal(metrics.leadsPerWeek.at(-1).leads,3);equal(metrics.definitions.timezone,'Europe/Madrid');
    const boundary=(await rpc('dashboard_metrics',{p_now:'2026-09-30T22:00:00Z'})).value;
    equal(boundary.totalConversations,1);equal(boundary.leadsThisMonth,1);equal(boundary.visitorsToday,1);equal(boundary.avgMessages,1);equal(boundary.avgDurationSec,0);equal(boundary.conversionRatio,100);
    now=Date.UTC(2026,9,31,23);const november=(await rpc('dashboard_metrics',{})).value;
    equal(november.totalConversations,0);equal(november.leadsThisMonth,0);equal(november.visitorsToday,0);equal(november.avgMessages,0);equal(november.avgDurationSec,0);equal(november.conversionRatio,0);equal(november.visitsPerDay.at(-1).date,'01/11');
    equal((await rpc('dashboard_metrics',{p_now:'not-a-date'})).status,400);
    equal(guard.blocked.length,0);
  });
  console.log(`PASS: ${groups} groups, ${checks} checks; signed local bookings and shared metrics, no external sends.`);
}finally{guard.restore();await vite.close();await fixture.close();}
