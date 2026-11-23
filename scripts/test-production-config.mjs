import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createDashboardTestFixture, TEST_PASSWORD_HASH } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture = await createDashboardTestFixture();
const origin = 'http://localhost:4334';
const local = fixture.environment(origin);
const guard = installFetchGuard([fixture.origin,origin]);
const vite = await createServer({root,configFile:false,envFile:false,logLevel:'silent',appType:'custom',
 server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},
 define:Object.fromEntries(Object.entries({...local,PROD:false,DEV:true,SSR:true,MODE:'test',BASE_URL:'/'}).map(([key,value])=>['import.meta.env.'+key,JSON.stringify(value)])),
});
let assertions=0,groups=0;
const ok=(value,message)=>{assertions++;assert.ok(value,message);};
const equal=(actual,expected,message)=>{assertions++;assert.deepEqual(actual,expected,message);};
const group=async(name,run)=>{await run();console.log('ok '+ ++groups+' - '+name);};
const logs=[];
const originalInfo=console.info;
console.info=line=>logs.push(String(line));
try {
 const config=await vite.ssrLoadModule('/src/lib/production-config.ts');
 const valid={
  SUPABASE_URL:'https://database.example.test',SUPABASE_SERVICE_ROLE_KEY:'fake-service-credential-for-tests',
  SITE_URL:'https://akrasia.example.test',DASHBOARD_ORIGIN:'https://akrasia.example.test',DASHBOARD_PASSWORD_HASH:TEST_PASSWORD_HASH,
  CHAT_ORIGIN:'https://akrasia.example.test',CHAT_SESSION_SECRET:'1'.repeat(64),OPENROUTER_API_KEY:'fake-ai-credential-for-tests',
  RETENTION_CRON_SECRET:'2'.repeat(64),INTEGRATION_WORKER_SECRET:'3'.repeat(64),INTEGRATION_WORKER_BATCH:'5',
  RESEND_API_KEY:'fake-email-credential-for-tests',EMAIL_FROM:'Synthetic team <synthetic@example.test>',
  TELEGRAM_BOT_TOKEN:'123456:'+ 'A'.repeat(35),TELEGRAM_CHAT_ID:'-100123456789',
  PUBLIC_GTM_CONTAINER_REVIEWED:'false',BOOKING_MEETING_URL:'',
 };
 const inspect=env=>config.inspectProductionConfiguration(env,{production:true,nodeVersion:'24.21.0'});
 await group('Complete and optional configurations expose only controlled states/codes',()=>{
  const report=inspect(valid);equal(report.status,'configuration_valid');
  for(const component of ['database','admin','chatSession','ai','bookings','email','telegram','integrationWorker','retention'])equal(report.components[component].state,'configured',component);
  equal(report.components.mediaConsent.state,'disabled');
  equal(report.externalChecks,'not_run');equal(report.scope,'configuration_only');
  const disabled={...valid,OPENROUTER_API_KEY:'',RESEND_API_KEY:'',TELEGRAM_BOT_TOKEN:'',TELEGRAM_CHAT_ID:'',INTEGRATION_WORKER_SECRET:''};
  const optional=inspect(disabled);equal(optional.status,'configuration_valid');
  for(const component of ['ai','email','telegram','integrationWorker'])equal(optional.components[component].state,'disabled');
  equal(optional.components.chatSession.state,'configured');equal(optional.components.retention.state,'configured');
  const bare={SUPABASE_URL:valid.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:valid.SUPABASE_SERVICE_ROLE_KEY,SITE_URL:valid.SITE_URL,DASHBOARD_ORIGIN:valid.DASHBOARD_ORIGIN,DASHBOARD_PASSWORD_HASH:valid.DASHBOARD_PASSWORD_HASH};
  equal(inspect(bare).status,'configuration_valid');
  for(const secret of Object.values(valid).filter(value=>value&&value.length>12))ok(!JSON.stringify(report).includes(secret),'No raw value in report');
 });
 await group('Invalid origins, admin credentials, runtime and chat bounds fail closed per feature',()=>{
  for(const origin of ['http://akrasia.example.test','https://user:password@akrasia.example.test','https://akrasia.example.test/path','https://akrasia.example.test?secret=canary','https://akrasia.example.test#x','not a url']){
   for(const key of ['SUPABASE_URL','DASHBOARD_ORIGIN','SITE_URL','CHAT_ORIGIN'])equal(inspect({...valid,[key]:origin}).status,'configuration_invalid',key+' invalid');
  }
  equal(inspect({...valid,DASHBOARD_PASSWORD_HASH:'secret-password'}).components.admin.state,'invalid');
  for(const version of ['18.20.8','20.9.0','22.18.0','invalid'])equal(config.inspectProductionConfiguration(valid,{nodeVersion:version}).components.runtime.state,'invalid');
  for(const pair of [['CHAT_SESSION_SECRET','short'],['CHAT_MAX_MESSAGES','0'],['CHAT_MAX_BODY_BYTES','99999999'],['CHAT_GLOBAL_CONCURRENCY','1.5'],['CHAT_PROVIDER_TIMEOUT_MS','60001'],['CHAT_LEASE_SECONDS','5']]){
   equal(inspect({...valid,[pair[0]]:pair[1]}).components.ai.state,'invalid',pair[0]);
  }
  for(const secret of ['your-service-role-key','replace-with-secret','xxxxxx',' secret\n'])equal(inspect({...valid,SUPABASE_SERVICE_ROLE_KEY:secret}).components.database.state,'invalid');
  const mismatch=inspect({...valid,CHAT_ORIGIN:'https://other.example.test'});ok(mismatch.components.chatSession.codes.includes('chat_origin_mismatch'));
 });
 await group('Worker, retention, sender and destination validation does not infer provider readiness',()=>{
  for(const length of [63,65,128])equal(inspect({...valid,INTEGRATION_WORKER_SECRET:'3'.repeat(length)}).components.integrationWorker.state,'invalid');
  equal(inspect({...valid,RETENTION_CRON_SECRET:'2'.repeat(128)}).components.retention.state,'configured');
  equal(inspect({...valid,INTEGRATION_WORKER_SECRET:valid.CHAT_SESSION_SECRET}).components.integrationWorker.state,'invalid');
  equal(inspect({...valid,RETENTION_CRON_SECRET:valid.CHAT_SESSION_SECRET}).components.retention.state,'invalid');
  for(const sender of ['','Synthetic <mail@example.test','mail@example.test>','mail@example.test\nBcc: hidden@example.test','invalid'])equal(inspect({...valid,EMAIL_FROM:sender}).components.email.state,'invalid');
  equal(inspect({...valid,EMAIL_FROM:'synthetic@example.test'}).components.email.state,'configured');
  for(const recipient of ['invalid','team@example.test\r\nBcc: hidden@example.test','Studio <team@example.test>'])equal(inspect({...valid,BOOKING_ADMIN_EMAIL:recipient}).components.email.state,'invalid');
  equal(inspect({...valid,BOOKING_ADMIN_EMAIL:'team@example.test'}).components.email.state,'configured');
  equal(inspect({...valid,BOOKING_ADMIN_EMAIL:''}).components.email.state,'configured');
  equal(inspect({...valid,SITE_URL:'https://akrasia.studio/dashboard'}).components.email.state,'invalid');
  equal(inspect({...valid,TELEGRAM_CHAT_ID:''}).components.telegram.state,'invalid');
  equal(inspect({...valid,TELEGRAM_BOT_TOKEN:''}).components.telegram.state,'invalid');
  equal(inspect({...valid,INTEGRATION_WORKER_SECRET:''}).components.integrationWorker.state,'invalid');
  for(const link of ['javascript:alert(1)','https://user:pass@example.test/meeting','https://example.test/meeting#secret'])equal(inspect({...valid,BOOKING_MEETING_URL:link}).components.bookings.state,'invalid');
  equal(inspect({...valid,BOOKING_MEETING_URL:'https://example.test/meeting'}).components.bookings.state,'configured');
  equal(inspect({...valid,PUBLIC_GTM_CONTAINER_REVIEWED:'true',PUBLIC_GTM_CONTAINER_ID:''}).components.mediaConsent.state,'invalid');
  equal(inspect({...valid,PUBLIC_GTM_CONTAINER_REVIEWED:'true',PUBLIC_GTM_CONTAINER_ID:'GTM-TEST12'}).components.mediaConsent.state,'configured');
  equal(inspect({...valid,PUBLIC_GA4_REVIEWED:'true',PUBLIC_GA4_MEASUREMENT_ID:'G-TEST123456'}).components.mediaConsent.state,'configured');
  equal(inspect({...valid,PUBLIC_GA4_REVIEWED:'true',PUBLIC_GA4_MEASUREMENT_ID:'bad-id',PUBLIC_GTM_CONTAINER_REVIEWED:'true',PUBLIC_GTM_CONTAINER_ID:'GTM-TEST12'}).components.mediaConsent.state,'invalid');
  equal(inspect({...valid,PUBLIC_GA4_REVIEWED:'false',PUBLIC_GA4_MEASUREMENT_ID:'G-TEST123456',PUBLIC_GTM_CONTAINER_REVIEWED:'true',PUBLIC_GTM_CONTAINER_ID:'GTM-TEST12'}).components.mediaConsent.state,'configured');
  equal(inspect({...valid,PUBLIC_GA4_REVIEWED:'true',PUBLIC_GA4_MEASUREMENT_ID:'G-TEST123456',PUBLIC_GTM_CONTAINER_REVIEWED:'true',PUBLIC_GTM_CONTAINER_ID:''}).components.mediaConsent.state,'configured');
  equal(inspect({...valid,PUBLIC_GA4_REVIEWED:'yes'}).components.mediaConsent.state,'invalid');
 });
 await group('Feature boundaries do not block unrelated optional-disabled public services',()=>{
  config.requireProductionComponent('database',{...valid,OPENROUTER_API_KEY:''},true);
  assert.throws(()=>config.requireProductionComponent('ai',{...valid,OPENROUTER_API_KEY:''},true),config.ProductionConfigurationError);assertions++;
  assert.throws(()=>config.requireProductionComponent('admin',{...valid,DASHBOARD_PASSWORD_HASH:''},true),config.ProductionConfigurationError);assertions++;
  equal(guard.blocked,[]);
 });
 await group('Health route requires a revocable admin session, refuses widened requests and never probes providers',async()=>{
  const health=await vite.ssrLoadModule('/src/pages/api/health.ts');
  const auth=await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');
  const dispatch=(cookie,options={})=>health.GET({request:new Request(origin+'/api/health'+(options.query||''),{headers:{...(cookie?{cookie}:{}),...options.headers}})});
  const before=fixture.requests.length;const anonymous=await dispatch();equal(anonymous.status,401);equal(fixture.requests.length,before);equal(await anonymous.json(),{error:'authentication_required'});
  const session=await auth.createDashboardSession();const cookie='akrasia_admin='+session.token;
  const result=await dispatch(cookie);equal(result.status,200);const report=await result.json();equal(report.scope,'configuration_only');
  for(const header of ['cache-control','cdn-cache-control','vercel-cdn-cache-control'])ok(result.headers.get(header)?.includes('no-store'));
  ok(result.headers.get('x-robots-tag')?.includes('noindex'));equal(result.headers.get('x-frame-options'),'DENY');
  equal((await dispatch(cookie,{query:'?token=canary'})).status,400);
  equal((await dispatch(cookie,{headers:{'sec-fetch-site':'cross-site'}})).status,403);
  equal((await dispatch(cookie,{headers:{origin:'https://evil.example.test'}})).status,403);
  equal((await dispatch(cookie,{headers:{origin}})).status,200);
  const stored=await auth.getDashboardSession(new Request(origin,{headers:{cookie}}));await auth.revokeDashboardSession(stored.tokenHash);
  equal((await dispatch(cookie)).status,401);equal((await dispatch('akrasia_admin=forged')).status,401);
  ok(!fixture.requests.some(request=>/openrouter|resend|telegram|storage/.test(request.path)),'No provider or media probe');
  equal(guard.blocked,[]);
 });
 await group('Operational logs only retain a controlled event, HTTP status and elapsed duration',()=>{
  const events=[];
  config.operationalEvent({event:'configuration_invalid',status:503,durationMs:123.8,payload:'PRIVATE_CANARY'},line=>events.push(JSON.parse(line)));
  equal(events,[{event:'configuration_invalid',status:503,durationMs:124}]);
  config.operationalEvent({event:'malicious PRIVATE_CANARY',status:503,durationMs:2},line=>events.push(line));
  equal(events.length,1);
  ok(!JSON.stringify(logs).includes('fake-')&&!JSON.stringify(logs).includes(sessionTokenCanary()),'No credentials logged');
  function sessionTokenCanary(){return 'PRIVATE_CANARY';}
 });
 console.log('PASS A41 production config: '+groups+' groups, '+assertions+' assertions; health authentication uses only a synthetic store. No remote service or provider call.');
}finally{console.info=originalInfo;await vite.close();await fixture.close();guard.restore();}

