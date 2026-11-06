import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { createVisitorIsolationFixture } from './visitor-isolation-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// All content, session keys, stores, reservations and providers are fictitious.
// No remote SQL, AI, email or Telegram is contacted or cleaned by these tests.
const fixture = await createVisitorIsolationFixture();
const network = installFetchGuard([fixture.origin]);
const env = { ...fixture.environment(), RETENTION_CRON_SECRET: 'cd'.repeat(32) };
const vite = await createServer({ root: process.cwd(), configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: Object.fromEntries(Object.entries({ ...env, PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' })
    .map(([key,value]) => [`import.meta.env.${key}`, JSON.stringify(value)])) });
let checks = 0; let groups = 0;
const eq = (actual, expected, label) => { checks++; assert.deepEqual(actual, expected, label); };
const ok = (value, label) => { checks++; assert.ok(value, label); };
const reject = async (work, code) => { checks++; await assert.rejects(work, error => error.code === code); };
const group = async (name, work) => { fixture.reset(); await work(); console.log(`ok ${++groups} - ${name}`); };
const origin = env.CHAT_ORIGIN;
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function request(path = '/api/visitor-history', { method = 'GET', cookie, csrf, body, headers = {}, signal } = {}) {
  return new Request(`${origin}${path}`, { method, signal, headers: { origin, ...(cookie ? { cookie } : {}),
    ...(csrf ? { 'x-chat-csrf': csrf } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) });
}
try {
  const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const life = await vite.ssrLoadModule('/src/lib/chat-lifecycle.ts');
  const route = await vite.ssrLoadModule('/src/pages/api/visitor-history.ts');
  const chat = await vite.ssrLoadModule('/src/lib/chat-handler.ts');
  const effects = await vite.ssrLoadModule('/src/lib/chat-effects.ts');
  const operations=await vite.ssrLoadModule('/src/lib/chat-operations.ts');
  const actions = await vite.ssrLoadModule('/src/lib/chat-actions.ts');
  const policy = await vite.ssrLoadModule('/src/lib/privacy-retention.ts');
  const retentionRoute = await vite.ssrLoadModule('/src/pages/api/maintenance/retention.ts');
  const data = await vite.ssrLoadModule('/src/lib/visitor-data.ts');
  const config = security.readChatConfig(env);
  const session = (at = fixture.state.now) => {
    const value = security.chatSession(request(), config, at); return { ...value, cookie: value.cookie.split(';')[0] };
  };
  const erase = life.createChatEraseHandler({ config: () => config, now: () => fixture.state.now });
  const metadata = async current => { const response = await route.GET({ request: request(undefined, { cookie: current.cookie }) }); eq(response.status,200); return response.json(); };
  const wipe = (current, meta, overrides = {}) => erase({ request: request(undefined, { method: 'DELETE', cookie: current.cookie,
    csrf: meta.csrfToken, body: { contextVersion: meta.contextVersion }, ...overrides }) });
  const freshSignal = () => new AbortController().signal;
  const save = async (current, version, text = 'Consulta ficticia') => {const operationId=randomUUID();const signal=freshSignal();await operations.chatOperationStore.claim({visitorId:current.id,expiresAt:current.expiresAt,contextVersion:version,operationId,requestHash:operations.chatRequestHash(config,text,'es'),config,signal});return effects.saveChatEffects({ visitorId: current.id,
    config, sessionExpiresAt: current.expiresAt, contextVersion: version, messages: [{ role:'user',content:text }],operationId,language:'es',
    response:'Respuesta ficticia', signal });};
  const handle = (calls, options = {}) => chat.createChatHandler({ config: () => ({...config,...(options.config||{})}), now: () => fixture.state.now,
    provider: async input => { calls.push(input); return options.provider ? options.provider(input) : (async function*(){yield 'Respuesta ficticia';})(); },
    effects: options.effects || effects.saveChatEffects,
    ...(options.lifecycle ? { lifecycle:options.lifecycle } : {}),
    ...(options.loadContext ? { loadContext: options.loadContext } : {}) });
  const chatRequest = (current, version, text = 'Consulta nueva', signal) => request('/api/chat', { method:'POST',cookie:current.cookie, signal,
    body:{ context_version:version,operation_id:randomUUID(),language:'es', messages:[{role:'user',content:text}] } });

  await group('A erasure removes chat/derived profiles, preserves B, bookings, notifications and live quotas', async () => {
    const a=session(), b=session(); const own=fixture.seed(a.id,'A'); fixture.seed(b.id,'B');
    fixture.tables.leads.push({ id:randomUUID(),visitor_id:a.id,source:'telegram',name:'Other-channel-only',conversation_id:own.conversation.id });
    fixture.tables.bookings.push({ id:randomUUID(),visitor_id:a.id,status:'confirmed',conversation_id:own.conversation.id,lead_id:own.lead.id,visitor_email:'booking@synthetic.invalid' });
    fixture.tables.sent_emails.push({ id:randomUUID(),visitor_id:a.id,lead_id:own.lead.id,to_email:'mail@synthetic.invalid',body_text:'Independent sent record' });
    fixture.tables.chat_quota_buckets.push({ id:'session',bucket:security.quotaKey('session',a.id),requests:19,units:900,expires_at:new Date(fixture.state.now+3600000).toISOString() });
    fixture.tables.chat_concurrency_leases.push({ id:'lease',session_key:security.quotaKey('session',b.id),expires_at:new Date(fixture.state.now+60000).toISOString() },
      {id:'expired-own',session_key:security.quotaKey('session',a.id),expires_at:new Date(fixture.state.now-1000).toISOString()});
    const beforeB=JSON.stringify(Object.fromEntries(Object.entries(fixture.tables).map(([key,rows])=>[key,rows.filter(row=>row.visitor_id===b.id || key==='messages' && fixture.tables.conversations.some(c=>c.visitor_id===b.id && c.id===row.conversation_id))])));
    const quotas=JSON.stringify([fixture.tables.chat_quota_buckets,fixture.tables.chat_concurrency_leases]);
    const meta=await metadata(a); eq(meta.contextVersion,0); ok(meta.csrfToken);
    const response=await wipe(a,meta); eq(response.status,200); eq(response.headers.get('set-cookie'),null);
    const result=await response.json(); eq(result.deleted,true);eq(result.sessionId,a.id);eq(result.sessionExpiresAt,a.expiresAt);eq(result.contextVersion,1);
    eq(result.scope,'chat_and_derived_profile');eq(result.retained,['bookings','external_notifications','quota_security']);
    ok(response.headers.get('cache-control').includes('no-store'));eq(response.headers.get('vercel-cdn-cache-control'),'no-store');
    eq(fixture.tables.conversations.filter(row=>row.visitor_id===a.id).length,0);
    eq(fixture.tables.messages.filter(row=>row.conversation_id===own.conversation.id).length,0);
    eq(fixture.tables.leads.filter(row=>row.visitor_id===a.id && row.source==='web').length,0);
    eq(fixture.tables.leads.find(row=>row.visitor_id===a.id).source,'telegram');
    eq(fixture.tables.bookings[0].status,'confirmed');eq(fixture.tables.bookings[0].lead_id,null);eq(fixture.tables.bookings[0].conversation_id,null);
    eq(fixture.tables.sent_emails[0].body_text,'Independent sent record');eq(fixture.tables.sent_emails[0].lead_id,null);
    eq(JSON.stringify([fixture.tables.chat_quota_buckets,fixture.tables.chat_concurrency_leases]),quotas);
    const afterB=JSON.stringify(Object.fromEntries(Object.entries(fixture.tables).map(([key,rows])=>[key,rows.filter(row=>row.visitor_id===b.id || key==='messages' && fixture.tables.conversations.some(c=>c.visitor_id===b.id && c.id===row.conversation_id))])));eq(afterB,beforeB);
    const reload=await metadata(a);eq(reload.contextVersion,1);eq(reload.conversations,[]);eq(reload.visitorName,null);eq(reload.visitorCompany,null);ok(reload.csrfToken!==meta.csrfToken);
    const calls=[];const continued=await handle(calls)({request:chatRequest(a,1)});eq(continued.status,200);ok((await continued.text()).includes('[DONE]'));
    ok(!JSON.stringify(calls[0].messages).includes('A-history-private'));ok(!JSON.stringify(calls[0].messages).includes('Other-channel-only'));
    const keys=fixture.requests.filter(row=>row.table==='rpc/chat_admit').map(row=>row.body.p_session_key);eq(new Set(keys).size,1);eq(keys[0],security.quotaKey('session',a.id));
  });

  await group('Unsigned/expired/manipulated sessions and cross-origin/CSRF attacks cannot touch data', async () => {
    const a=session(), b=session();fixture.seed(a.id,'A');const meta=await metadata(a);const before=JSON.stringify(fixture.tables);const dbCalls=fixture.requests.length;
    const expired=session(fixture.state.now-config.sessionSeconds*1000-1000);
    for(const [cookie,status] of [[undefined,401],['akrasia_chat=forged',401],[`${a.cookie}; ${a.cookie}`,401],[expired.cookie,401]]) eq((await wipe(a,meta,{cookie})).status,status);
    for(const headers of [{origin:'https://attacker.invalid'},{origin:''},{'sec-fetch-site':'cross-site'},{'x-chat-csrf':'x'.repeat(43)}]) eq((await wipe(a,meta,{headers})).status,403);
    eq((await wipe(a,meta,{csrf:undefined})).status,403);
    eq((await wipe(a,meta,{csrf:life.chatCsrfToken(config,b,0)})).status,403);
    const query=await erase({request:request(`?visitor_id=${b.id}`,{method:'DELETE',cookie:a.cookie,csrf:meta.csrfToken,body:{contextVersion:0}})});eq(query.status,403);
    eq(fixture.requests.length,dbCalls);eq(JSON.stringify(fixture.tables),before);
    for(const body of [null,[],{contextVersion:0,visitor_id:b.id},{contextVersion:-1},{contextVersion:'0'},'{']) eq((await wipe(a,meta,{body})).status,400);
    eq((await wipe(a,meta,{body:'x'.repeat(1025)})).status,413);eq((await wipe(a,meta,{headers:{'content-type':'text/plain'}})).status,400);
    eq(fixture.requests.length,dbCalls);
  });

  await group('Failed or malformed store results do not claim deletion; retry cannot erase newer turns', async () => {
    const a=session();fixture.seed(a.id,'A');const meta=await metadata(a);const before=JSON.stringify(fixture.tables);
    fixture.state.unavailable=true;eq((await wipe(a,meta)).status,503);eq(JSON.stringify(fixture.tables),before);fixture.state.unavailable=false;
    const bad=life.createChatEraseHandler({config:()=>config,store:{...life.chatLifecycleStore,erase:async()=>({contextVersion:999})}});
    eq((await bad({request:request(undefined,{method:'DELETE',cookie:a.cookie,csrf:meta.csrfToken,body:{contextVersion:0}})})).status,503);eq(JSON.stringify(fixture.tables),before);
    const deleted=await wipe(a,meta);eq(deleted.status,200);eq((await deleted.json()).contextVersion,1);
    await save(a,1,'New content after deletion');const messages=JSON.stringify(fixture.tables.messages);
    const retry=await wipe(a,meta);eq(retry.status,200);eq((await retry.json()).contextVersion,1);eq(JSON.stringify(fixture.tables.messages),messages);
    const latest=await metadata(a);eq((await wipe(a,latest)).status,200);eq(fixture.tables.messages.length,0);
    eq((await wipe(a,meta)).status,409);
    // A retention increment is not evidence that an erasure happened.
    const b=session();const bmeta=await metadata(b);fixture.contextStates.get(b.id).contextVersion++;
    eq((await wipe(b,bmeta)).status,409);
  });

  await group('Active/cancelled leases fence erasure until expiry; stale remote turn/proposal writes reject afterwards', async () => {
    const a=session();fixture.seed(a.id,'A');const meta=await metadata(a);const gate=deferred();const calls=[];let writes=0;
    const abort=new AbortController();
    const response=await handle(calls,{provider:async()=> (async function*(){yield 'Started';await gate.promise;yield 'Late old text';})(),effects:async input=>{writes++;await effects.saveChatEffects(input);}})({request:chatRequest(a,0,'Consulta nueva',abort.signal)});
    eq(response.status,200);const collecting=response.text();const busy=await wipe(a,meta);eq(busy.status,409);eq(busy.headers.get('retry-after'),'60');
    eq(await busy.json(),{error:'chat_busy',retry_after:60});eq(fixture.contextStates.get(a.id).contextVersion,0);eq(fixture.tables.messages.length,2);
    abort.abort();gate.resolve();const text=await collecting;
    ok(!text.includes('[DONE]'));eq(writes,0);eq(fixture.tables.messages.length,2);
    eq((await wipe(a,meta)).status,409);fixture.state.now+=61000;eq((await wipe(a,meta)).status,200);eq(fixture.tables.messages.length,0);
    await reject(()=>save(a,0,'Stale request'), 'chat_context_changed');
    await reject(()=>life.lifecycleRpc(config,'chat_save_turn',{p_visitor_id:a.id,p_expires_at:a.expiresAt,p_context_version:0,p_user_content:'Remote stale',p_assistant_content:'Remote answer',p_lead:null},freshSignal()),'chat_context_changed');
    const token=actions.issueBookingProposal({date:'2030-01-07',time:'12:00',email:'proposal@synthetic.invalid',name:''},{id:a.id,expiresAt:a.expiresAt,contextVersion:0},config).token;
    let created=0;await reject(()=>actions.confirmBookingAction(token,{visitorId:a.id,config,signal:freshSignal(),contextVersion:1,sessionExpiresAt:a.expiresAt},{create:async()=>{created++;}}),'chat_context_changed');eq(created,0);
    await reject(()=>life.lifecycleRpc(config,'chat_insert_booking',{p_visitor_id:a.id,p_expires_at:a.expiresAt,p_context_version:0,p_booking:{}},freshSignal()),'chat_context_changed');eq(fixture.tables.bookings.length,0);
    const freshCalls=[];const stale=await handle(freshCalls)({request:chatRequest(a,0)});eq(stale.status,409);eq(freshCalls.length,0);
    const continued=await handle(freshCalls)({request:chatRequest(a,1)});eq(continued.status,200);ok((await continued.text()).includes('[DONE]'));
    ok(!JSON.stringify(freshCalls[0].messages).includes('A-history-private'));eq(fixture.tables.messages.length,2);
  });

  await group('A returned old generation immediately before provider dispatch still fences erasure until request settles', async () => {
    const a=session();fixture.seed(a.id,'A');const meta=await metadata(a);const gate=deferred();const entered=deferred();const calls=[];let states=0;
    const lifecycle={...life.chatLifecycleStore,state:async(...args)=>{const snapshot=await life.chatLifecycleStore.state(...args);if(++states===2){entered.resolve();await gate.promise;}return snapshot;}};
    const pending=handle(calls,{lifecycle})({request:chatRequest(a,0)});
    await entered.promise;eq((await wipe(a,meta)).status,409);eq(fixture.contextStates.get(a.id).contextVersion,0);eq(calls.length,0);
    const deferredCleanup=await life.runRetention(config,policy.RETENTION_DEFAULTS,freshSignal());eq(deferredCleanup.deferred,true);eq(deferredCleanup.messages,0);
    gate.resolve();const response=await pending;eq(response.status,200);ok((await response.text()).includes('[DONE]'));eq(calls.length,1);
    eq((await wipe(a,meta)).status,200);eq(fixture.tables.messages.length,0);
    const rejected=await handle(calls)({request:chatRequest(a,0)});eq(rejected.status,409);eq(calls.length,1);
    fixture.state.now+=61000;const fresh=await handle(calls)({request:chatRequest(a,1)});eq(fresh.status,200);ok((await fresh.text()).includes('[DONE]'));eq(calls.length,2);
    ok(!JSON.stringify(calls[1].messages).includes('A-history-private'));
  });

  await group('Retention has bounded age-specific cleanup, preserves active/held bookings and live quota entries', async () => {
    const a=session(),b=session();const own=fixture.seed(a.id,'A');fixture.seed(b.id,'B');await metadata(a);await metadata(b);
    const stamp=days=>new Date(fixture.state.now-days*86400000).toISOString();
    fixture.tables.messages.find(row=>row.conversation_id===own.conversation.id).created_at=stamp(31);
    own.lead.updated_at=stamp(91);
    fixture.tables.leads.push({id:randomUUID(),visitor_id:a.id,source:'telegram',updated_at:stamp(200),name:'Separate channel'});
    fixture.tables.sent_emails.push({id:randomUUID(),visitor_id:a.id,lead_id:own.lead.id,created_at:stamp(91)},{id:randomUUID(),visitor_id:b.id,created_at:stamp(2)});
    fixture.tables.bookings.push(...[['confirmed',stamp(2)],['cancelled',null],['completed',stamp(1)],['cancelled',new Date(fixture.state.now+86400000).toISOString()]].map(([status,date])=>({id:randomUUID(),visitor_id:a.id,status,privacy_retention_until:date,lead_id:own.lead.id})));
    fixture.tables.chat_quota_buckets.push({id:'live',expires_at:new Date(fixture.state.now+1000).toISOString(),requests:20},{id:'old',expires_at:stamp(1),requests:20});
    fixture.tables.chat_concurrency_leases.push({id:'old',expires_at:stamp(1)});
    fixture.tables.visitors.push({id:randomUUID(),visitor_id:randomUUID(),last_seen:stamp(38)});
    const beforeB=JSON.stringify(fixture.tables.messages.filter(row=>fixture.tables.conversations.some(c=>c.visitor_id===b.id&&c.id===row.conversation_id)));
    const result=await life.runRetention(config,{...policy.RETENTION_DEFAULTS,batchSize:1},freshSignal());
    eq(result.messages,1);eq(result.profiles,1);eq(result.notifications,1);eq(result.bookings,1);eq(result.visitors,1);eq(result.quota_buckets,1);eq(result.leases,1);
    ok(Object.values(result).every(value=>value<=1));eq(fixture.tables.bookings.length,3);ok(fixture.tables.bookings.some(row=>row.status==='confirmed'));ok(fixture.tables.bookings.some(row=>row.privacy_retention_until===null));
    eq(fixture.tables.chat_quota_buckets[0].id,'live');eq(fixture.tables.chat_quota_buckets[0].requests,20);eq(fixture.tables.chat_concurrency_leases.length,0);
    eq(fixture.tables.leads.filter(row=>row.source==='telegram').length,1);
    eq(JSON.stringify(fixture.tables.messages.filter(row=>fixture.tables.conversations.some(c=>c.visitor_id===b.id&&c.id===row.conversation_id))),beforeB);
    const reload=await metadata(a);ok(reload.contextVersion>0);eq(reload.visitorName,null);
    eq(await life.runRetention(config,{...policy.RETENTION_DEFAULTS,batchSize:1},freshSignal()),{messages:0,conversations:0,profiles:0,notifications:0,bookings:0,states:0,visitors:0,quota_buckets:0,leases:0,outbox:0,chat_operations:0,dashboard_operations:0,client_journey_operations:0});
  });

  await group('Expired content is excluded from history/AI even before cleanup and retention rejects malformed config', async () => {
    const a=session();const own=fixture.seed(a.id,'A');const old=new Date(fixture.state.now-100*86400000).toISOString();own.lead.updated_at=old;for(const row of fixture.tables.messages)row.created_at=old;
    const meta=await metadata(a);eq(meta.visitorName,null);eq(meta.conversations.flatMap(c=>c.messages).length,0);
    const context=await data.loadVisitorContext({visitorId:a.id,config,signal:freshSignal()});eq(context.messages,[]);eq(context.visitorName,null);
    eq(policy.readRetentionConfig({CHAT_RETENTION_DAYS:'14',CHAT_PROFILE_RETENTION_DAYS:'60',NOTIFICATION_RETENTION_DAYS:'45',RETENTION_BATCH_SIZE:'5'}),{chatDays:14,profileDays:60,notificationDays:45,batchSize:5});
    for(const key of ['CHAT_RETENTION_DAYS','CHAT_PROFILE_RETENTION_DAYS','NOTIFICATION_RETENTION_DAYS','RETENTION_BATCH_SIZE'])for(const value of ['0','-1','1.5','x','99999',1]){checks++;assert.throws(()=>policy.readRetentionConfig({[key]:value}));}
  });

  await group('Journey receipt retention counter is additive, bounded and cannot mask malformed storage output', async () => {
    const originalFetch=globalThis.fetch;
    const counts={messages:0,conversations:0,profiles:0,notifications:0,bookings:0,states:0,visitors:0,quota_buckets:0,leases:0,outbox:0,chat_operations:0,dashboard_operations:0};
    let reply=counts;
    globalThis.fetch=async()=>Response.json(reply);
    try {
      eq((await life.runRetention(config,policy.RETENTION_DEFAULTS,freshSignal())).client_journey_operations,0);
      reply={...counts,client_journey_operations:1};eq((await life.runRetention(config,policy.RETENTION_DEFAULTS,freshSignal())).client_journey_operations,1);
      for (const counter of [null,'1',-1,0.1,policy.RETENTION_DEFAULTS.batchSize+1]) {reply={...counts,client_journey_operations:counter};await reject(()=>life.runRetention(config,policy.RETENTION_DEFAULTS,freshSignal()),'chat_unavailable');}
    } finally {globalThis.fetch=originalFetch;}
  });

  await group('Operational retention endpoint requires distinct secret and accepts one private bounded POST', async () => {
    const current=session();fixture.seed(current.id,'A');
    const post=(headers={},path='/api/maintenance/retention')=>retentionRoute.POST({request:new Request(`${origin}${path}`,{method:'POST',headers})});
    for(const authorization of ['',`Bearer ${env.CHAT_SESSION_SECRET}`,`Bearer ${'x'.repeat(64)}`,`Bearer ${'é'.repeat(64)}`])eq((await post({authorization})).status,401);
    eq(fixture.requests.length,0);
    for(const headers of [{origin},{cookie:current.cookie}])eq((await post({authorization:`Bearer ${env.RETENTION_CRON_SECRET}`,...headers})).status,403);
    eq((await post({authorization:`Bearer ${env.RETENTION_CRON_SECRET}`},'/api/maintenance/retention?policy=0')).status,403);eq(fixture.requests.length,0);
    const response=await post({authorization:`Bearer ${env.RETENTION_CRON_SECRET}`});eq(response.status,200);ok(response.headers.get('cache-control').includes('no-store'));
    const result=await response.json();eq(result.completed,true);eq(Object.keys(result.counts).length,13);eq(result.counts.client_journey_operations,0);eq(result.moreMayRemain,true);
    eq(fixture.requests.filter(row=>row.table==='rpc/production_retention_batch').length,1);
    fixture.tables.chat_concurrency_leases.push({id:'live',expires_at:new Date(fixture.state.now+1000).toISOString()});
    const blocked=await post({authorization:`Bearer ${env.RETENTION_CRON_SECRET}`});const pending=await blocked.json();eq(pending.completed,false);eq(pending.deferred,true);ok(Object.values(pending.counts).every(value=>value===0));
    fixture.state.unavailable=true;eq((await post({authorization:`Bearer ${env.RETENTION_CRON_SECRET}`})).status,503);
    eq(network.blocked.length,0);
  });
  await group('Slow or disconnected erasure bodies time out and perform no database mutation', async () => {
    const current=session();fixture.seed(current.id,'A');const meta=await metadata(current);const before=fixture.requests.length;let cancelled=false;
    const limited=life.createChatEraseHandler({config:()=>({...config,storeTimeoutMs:100})});
    const stream=new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'));},cancel(){cancelled=true;}});
    const response=await limited({request:new Request(`${origin}/api/visitor-history`,{method:'DELETE',headers:{origin,cookie:current.cookie,'x-chat-csrf':meta.csrfToken,'content-type':'application/json'},body:stream,duplex:'half'})});
    eq(response.status,503);ok(cancelled);eq(fixture.requests.length,before);eq(fixture.tables.messages.length,2);
    eq((await wipe(current,meta,{headers:{'content-length':'2048'}})).status,413);eq(fixture.requests.length,before);
  });
  await group('History, erasure and maintenance remain usable with the AI key absent; chat fails closed', async () => {
    const inactiveEnv={...env,OPENROUTER_API_KEY:''};
    const storage=security.readChatStorageConfig(inactiveEnv);eq(storage.apiKey,'');
    checks++;assert.throws(()=>security.readChatConfig(inactiveEnv),error=>error.code==='chat_unavailable');
    const storageVite=await createServer({root:process.cwd(),configFile:false,envFile:false,appType:'custom',logLevel:'silent',
      server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},
      define:Object.fromEntries(Object.entries({...inactiveEnv,PROD:false,DEV:true,SSR:true,MODE:'test',BASE_URL:'/'}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
    try {
      const history=await storageVite.ssrLoadModule('/src/pages/api/visitor-history.ts');
      const maintenance=await storageVite.ssrLoadModule('/src/pages/api/maintenance/retention.ts');
      const chatApi=await storageVite.ssrLoadModule('/src/pages/api/chat.ts');
      const current=session();fixture.seed(current.id,'A');
      const response=await history.GET({request:request(undefined,{cookie:current.cookie})});eq(response.status,200);const meta=await response.json();
      eq((await history.DELETE({request:request(undefined,{method:'DELETE',cookie:current.cookie,csrf:meta.csrfToken,body:{contextVersion:meta.contextVersion}})})).status,200);
      eq((await maintenance.POST({request:new Request(`${origin}/api/maintenance/retention`,{method:'POST',headers:{authorization:`Bearer ${env.RETENTION_CRON_SECRET}`}})})).status,200);
      const before=fixture.requests.length;eq((await chatApi.POST({request:chatRequest(current,1),clientAddress:'192.0.2.7'})).status,503);eq(fixture.requests.length,before);eq(network.blocked.length,0);
    } finally {await storageVite.close();}
  });
  await group('A delayed timeout callback cannot dispatch old context after its monotonic request deadline', async () => {
    const current=session();fixture.seed(current.id,'A');const meta=await metadata(current);const calls=[];let states=0;
    const lifecycle={...life.chatLifecycleStore,state:async(...args)=>{const snapshot=await life.chatLifecycleStore.state(...args);if(++states===2){const end=performance.now()+150;while(performance.now()<end){/* Simulated event-loop suspension. */}}return snapshot;}};
    const response=await handle(calls,{config:{providerTimeoutMs:100},lifecycle})({request:chatRequest(current,0)});
    eq(response.status,504);eq(calls.length,0);eq((await wipe(current,meta)).status,409);
    fixture.state.now+=61000;eq((await wipe(current,meta)).status,200);eq(fixture.tables.messages.length,0);
  });
  console.log(`A09 chat lifecycle: ${groups} groups / ${checks} checks passed. Local transaction doubles only; PostgreSQL/RLS and deployment remain unverified.`);
} finally { await vite.close(); await fixture.close(); network.restore(); }
