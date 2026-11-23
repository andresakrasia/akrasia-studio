import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createServer} from 'vite';
import {createDashboardTestFixture,TEST_PASSWORD} from './dashboard-auth-test-fixture.mjs';
import {installFetchGuard} from './dashboard-test-network-guard.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {AstroCookies}=await import(pathToFileURL(path.join(root,'node_modules/astro/dist/core/cookies/index.js')));
const fixture=await createDashboardTestFixture();const origin='http://localhost:4341';const env={...fixture.environment(origin),OPENROUTER_API_KEY:'synthetic-ai-key'};
const network=installFetchGuard([fixture.origin]);const realFetch=globalThis.fetch;
let failure='',providerCalls=0,providerBody={tasks:[{title:'Validated proposal',description:'Synthetic only'}]},providerFinish='stop',commitFailure=false,exportRows=null;
const operations=new Map();
globalThis.fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.origin==='https://openrouter.ai'){providerCalls++;return Response.json({choices:[{finish_reason:providerFinish,message:{content:JSON.stringify(providerBody)}}]});}
 if(url.origin===fixture.origin&&url.pathname==='/rest/v1/rpc/dashboard_claim_ai'){
  const body=JSON.parse(init.body);const existing=operations.get(body.p_operation);if(existing){if(existing.fingerprint!==body.p_fingerprint)return Response.json({error:'Conflict'},{status:409});return Response.json(existing);}operations.set(body.p_operation,{state:'running',fingerprint:body.p_fingerprint});return Response.json({state:'claimed'});
 }
 if(url.origin===fixture.origin&&url.pathname==='/rest/v1/rpc/dashboard_commit_ai'){
  if(commitFailure)return Response.json({error:'SYNTHETIC_PRIVATE_CANARY'},{status:503});const body=JSON.parse(init.body);const record=operations.get(body.p_operation);const result=Object.fromEntries(Object.entries(body.p_payload).map(([key,items])=>[key,items.map(item=>({id:randomUUID(),...item,is_active:false}))]));record.state='complete';record.result=result;return Response.json(result);
 }
 if(url.origin===fixture.origin&&url.pathname==='/rest/v1/leads'&&exportRows){
  const offset=url.searchParams.has('or')?exportRows.findIndex(row=>url.searchParams.get('or').includes(row.id))+1:0;
  return Response.json(exportRows.slice(offset,offset+500));
 }
 if(url.origin===fixture.origin&&url.pathname.startsWith('/rest/v1/')&&!url.pathname.includes('dashboard_sessions')&&!url.pathname.includes('dashboard_consume_login_attempt')&&failure){
  if(failure==='malformed')return Response.json({internal:'SYNTHETIC_PRIVATE_CANARY'});if(failure==='empty')return Response.json([]);if(failure==='throw')throw new Error('SYNTHETIC_PRIVATE_CANARY');return Response.json({internal:'SYNTHETIC_PRIVATE_CANARY'},{status:503});
 }
 return realFetch(input,init);
};
const vite=await createServer({root,configFile:false,envFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},resolve:{alias:{'astro:middleware':'astro/middleware'}},define:Object.fromEntries(Object.entries({...env,PROD:false,DEV:true,SSR:true,MODE:'test',BASE_URL:'/'}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
let assertions=0,groups=0;const equal=(a,b,msg)=>{assertions++;assert.deepEqual(a,b,msg);};const ok=(v,msg)=>{assertions++;assert.ok(v,msg);};const group=async(name,fn)=>{await fn();console.log(`ok ${++groups} - ${name}`);};const routes=new Map();let middleware,cookie,csrf;
function request(route,{method='GET',body,headers={}}={}){return new Request(new URL(route,origin),{method,headers:{...headers,...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...(method!=='GET'?{'origin':origin,'x-dashboard-csrf':csrf||''}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function dispatch(route,options){const req=request(route,options);const cookies=new AstroCookies(req);const context={request:req,url:new URL(req.url),cookies,locals:{},params:{},clientAddress:'192.0.2.41'};const response=await middleware(context,()=>routes.get(context.url.pathname)[req.method](context));for(const value of cookies.headers())response.headers.append('set-cookie',value);return response;}
try{
 for(const name of ['clients','tasks','services','feed-entries','studio-logs','stats','leads','visitors','conversations','content','projects','metrics','ai-generate','export','auth/login'])routes.set(`/api/dashboard/${name}`,await vite.ssrLoadModule(`/src/pages/api/dashboard/${name}.ts`));
 routes.set('/api/services',await vite.ssrLoadModule('/src/pages/api/services.ts'));
 const publicProjects=await vite.ssrLoadModule('/src/lib/public-projects.ts');const publicContent=await vite.ssrLoadModule('/src/lib/public-content.ts');middleware=(await vite.ssrLoadModule('/src/middleware.ts')).onRequest;
 const login=await dispatch('/api/dashboard/auth/login',{method:'POST',body:{password:TEST_PASSWORD}});equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];const auth=await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');csrf=(await auth.getDashboardSession(request('/api/dashboard/clients'))).csrfToken;
 await group('Lists navigate beyond historical limits with exact counts and stable order',async()=>{
  fixture.tables.clients=Array.from({length:123},(_,i)=>({id:randomUUID(),name:`Client ${String(i).padStart(4,'0')}`}));const seen=new Set();
  for(const offset of [0,50,100]){const response=await dispatch(`/api/dashboard/clients?offset=${offset}`);equal(response.status,200);equal(response.headers.get('x-total-count'),'123');const rows=await response.json();equal(rows.length,offset===100?23:50);for(const row of rows){ok(!seen.has(row.id));seen.add(row.id);}equal(response.headers.get('x-next-offset'),offset===100?'':String(offset+50));}equal(seen.size,123);
  for(const query of ['limit=0','limit=101','offset=-1','offset=NaN']){const before=fixture.requests.length;equal((await dispatch(`/api/dashboard/clients?${query}`)).status,400);equal(fixture.requests.length,before+1,'Only auth lookup permitted');}
  fixture.tables.leads=Array.from({length:75},(_,index)=>({id:randomUUID(),name:`Profile ${index}`,company:index===74?'Target company':'Other company',status:index===74?'qualified':'new',created_at:new Date(Date.UTC(2026,0,1,0,index)).toISOString()}));
  const filtered=await dispatch('/api/dashboard/leads?search=Target%20company&status=qualified');equal(filtered.status,200);equal(filtered.headers.get('x-total-count'),'1');const leadRows=await filtered.json();equal(leadRows.length,1);equal(leadRows[0].company,'Target company');
  const wrongStatus=await dispatch('/api/dashboard/leads?search=Target%20company&status=new');equal(wrongStatus.headers.get('x-total-count'),'0');equal(await wrongStatus.json(),[]);
 });
 await group('Creates return one object, replay one logical operation, reject payload conflict',async()=>{
  const operation_id=randomUUID();const body={operation_id,name:'Idempotent client',email:'client@example.invalid'};const first=await dispatch('/api/dashboard/clients',{method:'POST',body});equal(first.status,201);const saved=await first.json();equal(saved.id,operation_id);ok(!Array.isArray(saved));const again=await dispatch('/api/dashboard/clients',{method:'POST',body});equal(again.status,200);equal((await again.json()).id,operation_id);equal(fixture.tables.clients.filter(row=>row.id===operation_id).length,1);equal((await dispatch('/api/dashboard/clients',{method:'POST',body:{...body,name:'Different'}})).status,409);
 });
 await group('Invalid fields/IDs/types fail before writes and missing rows are not success',async()=>{
  for(const body of [{name:''},{name:'a',id:randomUUID()},{name:'a',created_at:'fake'},{name:'a',notes:'x'.repeat(10001)},{name:'a',email:1}]){const before=fixture.requests.filter(r=>r.method!=='GET').length;equal((await dispatch('/api/dashboard/clients',{method:'POST',body})).status,400);equal(fixture.requests.filter(r=>r.method!=='GET').length,before);}
  equal((await dispatch('/api/dashboard/clients',{method:'PATCH',body:{id:randomUUID(),name:'Missing'}})).status,404);equal((await dispatch(`/api/dashboard/clients?id=${randomUUID()}`,{method:'DELETE'})).status,404);
 });
 await group('Read/write/delete outages and malformed results cannot show success or expose details',async()=>{
  for(const state of ['provider','throw','malformed']){failure=state;for(const [route,options] of [['/api/dashboard/clients',{}],['/api/dashboard/clients',{method:'POST',body:{name:'Attempt'}}],['/api/dashboard/clients',{method:'PATCH',body:{id:fixture.tables.clients[0].id,name:'Attempt'}}],[`/api/dashboard/clients?id=${fixture.tables.clients[0].id}`,{method:'DELETE'}]]){const res=await dispatch(route,options);equal(res.status,503);const wire=await res.text();ok(!wire.includes('SYNTHETIC_PRIVATE_CANARY'));ok(!wire.includes(env.SUPABASE_SERVICE_ROLE_KEY));ok(res.headers.get('cache-control').includes('no-store'));}}failure='';
 });
 await group('Project PATCH preserves thumbnail, nullable client, saved object and publication',async()=>{
  const row=fixture.tables.projects[0];row.thumbnail='/img/synthetic.webp';const response=await dispatch('/api/dashboard/projects',{method:'PATCH',body:{id:row.id,title:'Changed title'}});equal(response.status,200);const saved=await response.json();equal(saved.thumbnail,'/img/synthetic.webp');equal(saved.is_published,false);equal((await dispatch('/api/dashboard/projects',{method:'PATCH',body:{id:row.id,client_id:null}})).status,200);equal(row.client_id,null);
  const operation_id=randomUUID();const body={operation_id,title:'New safe project',client_id:null};const created=await dispatch('/api/dashboard/projects',{method:'POST',body});equal(created.status,201);equal((await created.json()).id,operation_id);equal((await dispatch('/api/dashboard/projects',{method:'POST',body})).status,201);equal(fixture.tables.projects.filter(p=>p.id===operation_id).length,1);
 });
 await group('Editor writes canonical source with strict cases; approval remains separate',async()=>{
  const project=fixture.tables.projects[0];const case_study={brief:'Approved brief',process:'Approved process',result:'Documented result',services:['Direction']};
  const saved=await dispatch('/api/dashboard/content',{method:'PUT',body:{key:'case-studies',data:[{id:project.id,case_study}]}});equal(saved.status,200);equal((await saved.json()).saved,1);equal(project.case_study,case_study);equal(project.is_published,false);equal((await publicProjects.getPublicProjects()).length,0);
  for(const fields of [{is_published:true},{case_study:{...case_study,client_email:'Private'}},{case_study:{...case_study,result:1}}])equal((await dispatch('/api/dashboard/content',{method:'PUT',body:{key:'case-studies',data:[{id:project.id,...fields}]}})).status,400);
  project.is_published=true;const publicRow=(await publicProjects.getPublicProjects())[0];equal(publicRow.case_study,case_study);ok(!('client_id' in publicRow));
 });
 await group('Public services rebuild approved fields, bilingual content and no fallback',async()=>{
  fixture.tables.services=[{id:randomUUID(),slug:'real-service',title:'Service',description:'Description',is_published:true,features:[{title:'Feature',description:'Desc'}],process:[],private_notes:'SYNTHETIC_PRIVATE_CANARY',icon:'movie'},{id:randomUUID(),slug:'draft',title:'Draft',is_published:false}];
  const res=await dispatch('/api/services');equal(res.status,200);const data=await res.json();equal(data.services.length,1);equal(data.services[0].slug,'real-service');ok(!JSON.stringify(data).includes('SYNTHETIC_PRIVATE_CANARY'));equal(res.headers.get('cache-control'),'no-store');equal((await dispatch('/api/services?slug=draft')).status,404);
  failure='provider';equal((await dispatch('/api/services')).status,503);failure='';fixture.tables.services=[];equal((await (await dispatch('/api/services')).json()).services,[]);
  const originalFetch=globalThis.fetch;const cancel=new AbortController();let storeAborted=false;
  globalThis.fetch=async(input,init)=>{const url=new URL(input instanceof Request?input.url:String(input));if(url.origin===fixture.origin&&url.pathname==='/rest/v1/services')return new Promise((resolve,reject)=>{init.signal.addEventListener('abort',()=>{storeAborted=true;reject(new DOMException('Synthetic cancelled read','AbortError'));},{once:true});});return originalFetch(input,init);};
  try{const pending=publicContent.loadPublicServices({signal:cancel.signal});setTimeout(()=>cancel.abort(),10);await assert.rejects(()=>pending);assertions++;ok(storeAborted,'Cancellation reaches the active store request, not just page boundaries');}finally{globalThis.fetch=originalFetch;}
 });
 await group('Conversation and each history have independent pages without truncation masquerading as complete',async()=>{
  const id=randomUUID();fixture.tables.conversations=[{id,visitor_id:'visitor-owner',created_at:'2026-01-01T00:00:00Z'}];fixture.tables.messages=Array.from({length:225},(_,i)=>({id:randomUUID(),conversation_id:id,role:i%2?'assistant':'user',content:`Message ${i}`,created_at:new Date(Date.UTC(2026,0,1,0,i)).toISOString()}));
  const seen=new Set();for(const offset of [0,100,200]){const res=await dispatch(`/api/dashboard/conversations?conversation_id=${id}&messages_offset=${offset}`);equal(res.status,200);const [conv]=await res.json();equal(conv.message_count,225);equal(conv.messages.length,offset===200?25:100);equal(conv.messages_next_offset,offset===200?null:offset+100);for(const msg of conv.messages){ok(!seen.has(msg.id));seen.add(msg.id);}}equal(seen.size,225);
 });
 await group('Export paginates all 1201 rows, neutralizes formulas and refuses over-limit downloads',async()=>{
  exportRows=Array.from({length:1201},(_,i)=>({id:randomUUID(),created_at:new Date(Date.UTC(2025,0,1,0,i)).toISOString(),name:i===600?'=FORMULA()':`Lead ${i}`,status:'new',tags:[]})).sort((a,b)=>b.created_at.localeCompare(a.created_at));
  const response=await dispatch('/api/dashboard/export');equal(response.status,200);const csv=await response.text();equal(csv.trim().split('\r\n').length,1202);ok(csv.includes("\t'=FORMULA()"));
  exportRows=Array.from({length:10001},(_,i)=>({id:randomUUID(),created_at:new Date(Date.UTC(2025,0,1,0,i)).toISOString(),name:'Bound',status:'new',tags:[]})).sort((a,b)=>b.created_at.localeCompare(a.created_at));const over=await dispatch('/api/dashboard/export');equal(over.status,413);equal(over.headers.get('content-disposition'),null);exportRows=null;
 });
 await group('Admin AI validates all output before atomic commit, replays without another provider call',async()=>{
  const project=fixture.tables.projects[0].id;const body={operation_id:randomUUID(),action:'generate_tasks',project_id:project,project_title:'Synthetic'};
  const first=await dispatch('/api/dashboard/ai-generate',{method:'POST',body});equal(first.status,200);equal((await first.json()).tasks.length,1);const calls=providerCalls;equal((await dispatch('/api/dashboard/ai-generate',{method:'POST',body})).status,200);equal(providerCalls,calls);
  const variants=[{tasks:[]},{tasks:[{title:'x',description:'ok',status:'completed'}]},{tasks:[{title:'x',description:2}]},{tasks:[{title:'x',description:'ok'}],logs:[]},{tasks:Array.from({length:13},()=>({title:'x',description:'ok'}))}];
  for(const invalid of variants){providerBody=invalid;const operation_id=randomUUID();equal((await dispatch('/api/dashboard/ai-generate',{method:'POST',body:{...body,operation_id}})).status,503);equal(operations.get(operation_id).state,'running');}
  providerBody={tasks:[{title:'x',description:'ok'}]};providerFinish='length';equal((await dispatch('/api/dashboard/ai-generate',{method:'POST',body:{...body,operation_id:randomUUID()}})).status,503);providerFinish='stop';commitFailure=true;const operation_id=randomUUID();equal((await dispatch('/api/dashboard/ai-generate',{method:'POST',body:{...body,operation_id}})).status,503);const before=providerCalls;equal((await dispatch('/api/dashboard/ai-generate',{method:'POST',body:{...body,operation_id}})).status,409);equal(providerCalls,before);commitFailure=false;
 });
 equal(network.blocked,[]);console.log(`PASS panel/data: ${groups} groups, ${assertions} assertions; no remote requests.`);
}finally{globalThis.fetch=realFetch;await vite.close();await fixture.close();network.restore();}
