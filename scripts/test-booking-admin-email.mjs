import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';
import { TEST_CHAT_SERVICE_KEY } from './chat-test-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guard = installFetchGuard([]), previousFetch = globalThis.fetch;
const environment = { SUPABASE_URL:'http://127.0.0.1:1', SUPABASE_SERVICE_ROLE_KEY:TEST_CHAT_SERVICE_KEY,
  RESEND_API_KEY:'synthetic-resend-key', EMAIL_FROM:'Synthetic <sender@example.invalid>',
  SITE_URL:'https://akrasia.studio', BOOKING_ADMIN_EMAIL:'info@akrasia.studio', SSR:true, DEV:true, PROD:false };
const vite = await createServer({ root, configFile:false, envFile:false, logLevel:'silent', appType:'custom',
  server:{ middlewareMode:true, hmr:false, watch:null }, optimizeDeps:{ noDiscovery:true },
  define:Object.fromEntries(Object.entries(environment).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)])) });
let checks=0, groups=0, calls=[], handler;
const equal=(a,b)=>{checks++;assert.deepEqual(a,b);}, ok=value=>{checks++;assert.ok(value);};
const group=async(label,run)=>{await run();console.log(`ok ${++groups} - ${label}`);};
const response=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));
  const body=init?.body?JSON.parse(init.body):null; calls.push({url,body,init}); return handler(url,body,init);};
const id='25252525-0000-4000-8000-000000000001', lease='25252525-0000-4000-8000-000000000002';
const payload={id,date:'2026-10-20',time:'14:30',email:'client@example.invalid',name:'Synthetic client',
  meetUrl:`https://meet.jit.si/Akrasia-${id}`,createdAt:'2026-10-04T12:00:00Z'};
const job=(channel='booking_admin_email',changes={})=>({id,key:`booking:${id}:admin-email`,channel,leaseToken:lease,attempt:1,payload:{...payload,...changes}});
try {
  const builder=await vite.ssrLoadModule('/src/lib/booking-admin-email.ts');
  const outbox=await vite.ssrLoadModule('/src/lib/integration-outbox.ts');
  await group('Admin copy has the confirmed private destination, civil date, contact, trusted panel link and escaped names',()=>{
    const message=builder.buildBookingAdminEmail({...payload,name:'<img src=x onerror=evil>'});
    equal(message.to,'info@akrasia.studio');equal(message.templateType,'booking_admin_notification');
    ok(message.bodyText.includes(payload.email));ok(message.bodyText.includes('14:30'));ok(message.bodyText.includes('Europe/Madrid'));
    ok(message.bodyText.includes('https://akrasia.studio/dashboard?tab=bookings&date=2026-10-20'));
    ok(message.bodyHtml.includes('&lt;img src=x onerror=evil&gt;'));ok(!message.bodyHtml.includes('<img src=x'));
    ok(message.bodyHtml.includes(payload.meetUrl));ok(!message.subject.includes('img'));
    equal(builder.buildBookingAdminEmail(payload,{recipient:'team@example.invalid'}).to,'team@example.invalid');
    ok(builder.buildBookingAdminEmail({...payload,email:null,name:null}).bodyText.includes('No facilitado'));
    equal(builder.buildBookingAdminEmail(payload,{recipient:''}).to,'info@akrasia.studio');
  });
  await group('Invalid admin configuration and booking fields cannot redirect or inject the notice',()=>{
    for(const recipient of ['bad','team@example.invalid\r\nBcc:other@example.invalid','client@example.invalid,other@example.invalid']){checks++;assert.throws(()=>builder.buildBookingAdminEmail(payload,{recipient}),builder.BookingAdminEmailConfigurationError);}
    for(const siteUrl of ['javascript:evil','http://example.invalid','https://user:pass@example.invalid/','https://example.invalid/path','https://example.invalid/?to=attacker','https://example.invalid/#attack']){checks++;assert.throws(()=>builder.buildBookingAdminEmail(payload,{siteUrl}),builder.BookingAdminEmailConfigurationError);}
    for(const patch of [{id:'bad'},{date:'2026-02-30'},{time:'99:00'},{date:'2026-10-25',time:'02:30'},{email:'bad'},{meetUrl:'javascript:evil'}]){checks++;assert.throws(()=>builder.buildBookingAdminEmail({...payload,...patch}));}
  });
  await group('Worker adds the same calendar as client confirmation, ignores client-selected admin addresses and freezes each request',async()=>{
    let currentJob, frozen;
    const messages=[], finishes=[];
    handler=(url,body)=>{
      if(url.pathname.endsWith('/integration_claim'))return response([currentJob]);
      if(url.pathname.endsWith('/integration_email_payload')){frozen=body.p_payload;return response({payload:frozen});}
      if(url.hostname==='api.resend.com'){messages.push(body);return response({id:'synthetic-provider-id'});}
      if(url.pathname.endsWith('/integration_finish')){finishes.push(body);return response({saved:true});}
      assert.fail('Unmocked network');
    };
    currentJob=job('booking_admin_email',{adminEmail:'attacker@example.invalid',to:'attacker@example.invalid',siteUrl:'https://attacker.invalid'});
    equal((await outbox.processIntegrationBatch(1)).accepted,1);equal(messages[0].to,'info@akrasia.studio');
    ok(messages[0].text.includes(payload.email));ok(!messages[0].text.includes('attacker'));
    equal(frozen.to,'info@akrasia.studio');equal(frozen.from,environment.EMAIL_FROM);
    equal(finishes[0].p_status,'accepted');equal(finishes[0].p_provider_id,'synthetic-provider-id');
    currentJob=job('booking_email');equal((await outbox.processIntegrationBatch(1)).accepted,1);
    equal(messages[1].to,payload.email);equal(messages[0].attachments,messages[1].attachments);
    const calendar=Buffer.from(messages[0].attachments[0].content,'base64').toString('utf8');
    ok(calendar.includes('DTSTART:20261020T123000Z'));ok(calendar.replace(/\r\n /g,'').includes(payload.meetUrl));
    equal(messages[0].attachments[0].content_type,'text/calendar');
  });
  await group('Retry keeps provider key and frozen destination; cancelled/unavailable jobs never call email provider',async()=>{
    const frozen=builder.buildBookingAdminEmail(payload,{recipient:'original@example.invalid'});let sent;
    const currentJob={...job(),attempt:2};
    handler=(url,body,init)=>{if(url.pathname.endsWith('/integration_claim'))return response([currentJob]);
      if(url.pathname.endsWith('/integration_email_payload'))return response({payload:frozen});
      if(url.hostname==='api.resend.com'){sent={body,headers:init.headers};return response({id:'synthetic-provider-id'});}
      return response({saved:true});};
    equal((await outbox.processIntegrationBatch(1)).accepted,1);equal(sent.body.to,'original@example.invalid');
    equal(sent.headers['Idempotency-Key'],currentJob.key);equal(sent.body.html,frozen.bodyHtml);
    for(const state of ['cancelled','unavailable']){
      calls=[];handler=url=>url.pathname.endsWith('/integration_claim')?response([currentJob]):url.pathname.endsWith('/integration_email_payload')?
        state==='cancelled'?response({disabled:true}):new Response('{}',{status:503}):url.hostname==='api.resend.com'?assert.fail('Inactive notice must not send'):response({saved:true});
      const result=await outbox.processIntegrationBatch(1);equal(result[state==='cancelled'?'disabled':'retry'],1);
      equal(calls.filter(call=>call.url.hostname==='api.resend.com').length,0);
    }
    calls=[];handler=url=>url.pathname.endsWith('/integration_claim')?response([job('booking_admin_email',{reminderHours:24})]):response({saved:true});
    equal((await outbox.processIntegrationBatch(1)).failed,1);equal(calls.filter(call=>call.url.hostname==='api.resend.com').length,0);
  });
  await group('Missing sender credentials and invalid admin destination are disabled, without any provider request',async()=>{
    for(const change of [{RESEND_API_KEY:''},{BOOKING_ADMIN_EMAIL:'invalid'}]){
      const isolated=await createServer({root,configFile:false,envFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},
        define:Object.fromEntries(Object.entries({...environment,...change}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
      try{
        const worker=await isolated.ssrLoadModule('/src/lib/integration-outbox.ts');let finished;
        calls=[];handler=(url,body)=>{if(url.pathname.endsWith('/integration_claim'))return response([job()]);
          if(url.pathname.endsWith('/integration_email_payload'))return response({payload:body.p_payload});
          if(url.hostname==='api.resend.com')assert.fail('Unconfigured notification must never send');
          if(url.pathname.endsWith('/integration_finish')){finished=body;return response({saved:true});}
          assert.fail('Unmocked network');};
        equal((await worker.processIntegrationBatch(1)).disabled,1);equal(finished.p_status,'disabled');
        equal(finished.p_error,change.RESEND_API_KEY===''?'email_not_configured':'invalid_admin_email_configuration');
        equal(calls.filter(call=>call.url.hostname==='api.resend.com').length,0);
      }finally{await isolated.close();}
    }
  });
  equal(guard.blocked,[]);console.log(`Booking/admin email: ${groups} groups / ${checks} checks passed; synthetic provider only.`);
} finally {globalThis.fetch=previousFetch;guard.restore();await vite.close();}
