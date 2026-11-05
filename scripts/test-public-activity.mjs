import assert from 'node:assert/strict';
import { createServer } from 'vite';
import path from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { createDashboardTestFixture,TEST_PASSWORD } from './dashboard-auth-test-fixture.mjs';
import { configurePublicActivityFixture,ACTIVITY_DEMO_ID } from './public-activity-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fixture=configurePublicActivityFixture(await createDashboardTestFixture());
const origin='http://localhost:4346';const env=fixture.environment(origin);
const network=installFetchGuard([fixture.origin]);const realFetch=globalThis.fetch;
const keys=['project_id','public_title','public_title_en','public_text','public_text_en','public_event_type','public_occurred_at'];
let fail=false,race='',cookie='',csrf='';
globalThis.fetch=async(input,init)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 if(url.origin===fixture.origin&&['/rest/v1/feed_entries','/rest/v1/studio_logs'].includes(url.pathname)){
  if(fail)return Response.json({error:'PRIVATE_FAILURE_CANARY'},{status:503});
  if(init?.method==='PATCH'){
   const body=JSON.parse(init.body);const table=fixture.tables[url.pathname.split('/').at(-1)];const row=table.find(row=>`eq.${row.id}`===url.searchParams.get('id'));
   if(row&&body.is_published===true){
    if(race==='revision'){row.public_revision++;race='';}
    if(race==='withdraw'){fixture.tables.projects.find(project=>project.id===row.project_id).is_published=false;race='';}
    if(row.project_id&&!fixture.tables.projects.some(project=>project.id===row.project_id&&project.is_published))return Response.json({error:'DB prevents private project approval'},{status:409});
   }
   if(row&&keys.some(key=>Object.hasOwn(body,key)&&JSON.stringify(body[key])!==JSON.stringify(row[key]))){body.public_revision=(row.public_revision??0)+1;body.is_published=false;init={...init,body:JSON.stringify(body)};}
  }
 }
 if(url.origin===fixture.origin&&url.pathname==='/rest/v1/projects'&&init?.method==='PATCH'){
  const body=JSON.parse(init.body);if(body.is_published===false){const id=url.searchParams.get('id')?.slice(3);for(const table of ['feed_entries','studio_logs'])for(const row of fixture.tables[table])if(row.project_id===id)row.is_published=false;}
 }
 return realFetch(input,init);
};
const vite=await createServer({root,configFile:false,envFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},resolve:{alias:{'astro:middleware':'astro/middleware'}},define:Object.fromEntries(Object.entries({...env,PROD:false,DEV:true,SSR:true,MODE:'test',BASE_URL:'/'}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
const {AstroCookies}=await import(pathToFileURL(path.join(root,'node_modules/astro/dist/core/cookies/index.js')));
let checks=0,groups=0;const equal=(a,b,msg)=>{checks++;assert.deepEqual(a,b,msg);};const ok=(v,msg)=>{checks++;assert.ok(v,msg);};const group=async(name,fn)=>{await fn();console.log(`ok ${++groups} - ${name}`);};
const routes=new Map();let middleware,auth;
function request(route,{method='GET',body,headers={},authenticated=true}={}){
 return new Request(new URL(route,origin),{method,headers:{...(authenticated&&cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'}),...(method==='GET'?{}:{origin,'x-dashboard-csrf':csrf}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
}
async function dispatch(route,options){const req=request(route,options);const cookies=new AstroCookies(req);const context={request:req,url:new URL(req.url),cookies,locals:{},params:{},clientAddress:'192.0.2.46'};const response=await middleware(context,()=>routes.get(context.url.pathname)[req.method](context));for(const value of cookies.headers())response.headers.append('set-cookie',value);return response;}
const draft={text:'INTERNAL_ONLY_CANARY',project_id:null,public_title:'Título aprobado',public_title_en:'Approved title',public_text:'Texto editorial',public_text_en:'Editorial text',public_event_type:'studio',public_occurred_at:'2026-01-01T00:00:00.000Z'};
try{
 for(const route of ['feed','logs','dashboard/feed-entries','dashboard/studio-logs','dashboard/projects','dashboard/auth/login'])routes.set(`/api/${route}`,await vite.ssrLoadModule(`/src/pages/api/${route}.ts`));
 middleware=(await vite.ssrLoadModule('/src/middleware.ts')).onRequest;auth=await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');
 const publicActivity=await vite.ssrLoadModule('/src/lib/public-activity.ts');
 const login=await dispatch('/api/dashboard/auth/login',{method:'POST',body:{password:TEST_PASSWORD}});equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await auth.getDashboardSession(request('/api/dashboard/feed-entries'))).csrfToken;
 await group('Public channels project only editorial allowlist, actual dates and approved project summaries',async()=>{
  for(const route of ['/api/feed','/api/logs']){const response=await dispatch(route,{authenticated:false});equal(response.status,200);equal(response.headers.get('cache-control'),'no-store');const data=await response.json();ok(data.length>0);for(const row of data){equal(Object.keys(row).sort(),['id','title','title_en','text','text_en','event_type','occurred_at','project'].sort());ok(Number.isFinite(Date.parse(row.occurred_at)));ok(!JSON.stringify(row).includes('CANARY'));if(row.project)equal(Object.keys(row.project).sort(),['slug','title']);}}
 });
 await group('is_active/internal text or a public project alone never authorize publication',async()=>{
  const id=randomUUID();fixture.tables.feed_entries.push({id,project_id:ACTIVITY_DEMO_ID,text:'INTERNAL_PRIVATE_CANARY',is_active:true,is_published:false});equal((await (await dispatch('/api/feed')).json()).some(row=>row.id===id),false);
  const linked=fixture.tables.feed_entries.find(row=>row.project_id===ACTIVITY_DEMO_ID&&row.is_published);const project=fixture.tables.projects.find(row=>row.id===ACTIVITY_DEMO_ID);project.is_published=false;equal((await (await dispatch('/api/feed')).json()).some(row=>row.id===linked.id),false);const logs=await (await dispatch('/api/logs')).json();equal(logs.length,1);equal(logs[0].project,null);project.is_published=true;
 });
 await group('Session, origin and CSRF reject writes before side effects',async()=>{
  for(const route of ['/api/dashboard/feed-entries','/api/dashboard/studio-logs'])for(const options of [{authenticated:false},{headers:{'x-dashboard-csrf':''}},{headers:{origin:'https://evil.invalid'}}]){const before=fixture.requests.filter(row=>row.method!=='GET').length;const response=await dispatch(route,{method:'POST',body:draft,...options});ok([401,403].includes(response.status));equal(fixture.requests.filter(row=>row.method!=='GET').length,before);}
 });
 await group('Bilingual drafts save and replay one operation; approval is separate and revision bound',async()=>{
  const operation_id=randomUUID();const created=await dispatch('/api/dashboard/feed-entries',{method:'POST',body:{...draft,operation_id}});equal(created.status,201);const row=await created.json();equal(row.is_published,false);equal(row.public_revision,0);equal((await dispatch('/api/dashboard/feed-entries',{method:'POST',body:{...draft,operation_id}})).status,200);
  equal((await dispatch('/api/dashboard/feed-entries',{method:'PATCH',body:{id:row.id,is_published:true}})).status,400);
  equal((await dispatch('/api/dashboard/feed-entries',{method:'PATCH',body:{id:row.id,is_published:true,public_revision:1}})).status,409);
  equal((await dispatch('/api/dashboard/feed-entries',{method:'PATCH',body:{id:row.id,is_published:true,public_revision:0}})).status,200);
  ok((await (await dispatch('/api/feed')).json()).some(entry=>entry.id===row.id));
  equal((await dispatch('/api/dashboard/feed-entries',{method:'PATCH',body:{id:row.id,public_text:'Revisión pendiente'}})).status,200);const stored=fixture.tables.feed_entries.find(entry=>entry.id===row.id);equal(stored.is_published,false);equal(stored.public_revision,1);equal((await dispatch('/api/dashboard/feed-entries',{method:'PATCH',body:{id:row.id,is_published:true,public_revision:0}})).status,409);
  race='revision';equal((await dispatch('/api/dashboard/feed-entries',{method:'PATCH',body:{id:row.id,is_published:true,public_revision:1}})).status,409);equal(stored.is_published,false);
 });
 await group('Empty, excessive, manipulated and invalid/future dates cannot be approved or saved',async()=>{
  const invalid=[{...draft,is_published:true},{...draft,public_revision:9},{...draft,public_title:'x'.repeat(201)},{...draft,public_text:3},{...draft,public_event_type:'render-complete'},{...draft,public_occurred_at:'2026-02-30T00:00:00.000Z'},{...draft,public_occurred_at:'2999-01-01T00:00:00.000Z'},{...draft,public_occurred_at:'2026-01-01T00:00:00+00:00'}];
  for(const body of invalid){const before=fixture.requests.filter(row=>row.method!=='GET').length;equal((await dispatch('/api/dashboard/studio-logs',{method:'POST',body})).status,400);equal(fixture.requests.filter(row=>row.method!=='GET').length,before);}
  const empty=await (await dispatch('/api/dashboard/studio-logs',{method:'POST',body:{text:'Private only'}})).json();equal((await dispatch('/api/dashboard/studio-logs',{method:'PATCH',body:{id:empty.id,is_published:true,public_revision:0}})).status,400);
 });
 await group('Private project approval is denied; withdrawal and reapproval do not resurrect events',async()=>{
  const privateId=fixture.tables.projects.find(row=>!row.is_published).id;
  const created=await (await dispatch('/api/dashboard/studio-logs',{method:'POST',body:{...draft,project_id:privateId}})).json();equal((await dispatch('/api/dashboard/studio-logs',{method:'PATCH',body:{id:created.id,is_published:true,public_revision:0}})).status,400);
  equal((await dispatch('/api/dashboard/projects',{method:'PATCH',body:{id:ACTIVITY_DEMO_ID,is_published:false}})).status,200);equal((await (await dispatch('/api/feed')).json()).some(row=>row.project?.slug==='demo-audiovisual'),false);
  equal((await dispatch('/api/dashboard/projects',{method:'PATCH',body:{id:ACTIVITY_DEMO_ID,is_published:true}})).status,200);equal((await (await dispatch('/api/feed')).json()).some(row=>row.project?.slug==='demo-audiovisual'),false);
 });
 await group('Public windows stop at 20/15 without scanning a large approved archive',async()=>{
  for(const [channel,table,limit] of [['feed','feed_entries',20],['logs','studio_logs',15]]){fixture.tables[table]=Array.from({length:1200},(_,index)=>({id:randomUUID(),...draft,public_title:`Event ${index}`,public_occurred_at:new Date(Date.UTC(2000,0,1,0,index)).toISOString(),is_published:true,public_revision:0}));const before=fixture.requests.length;const result=await publicActivity.loadPublicActivity(channel);equal(result.length,limit);equal(fixture.requests.slice(before).filter(row=>row.path===`/rest/v1/${table}`).length,1);}
 });
 await group('PostgREST timestamps normalize in the editor; HTML stays plain text in the public contract',async()=>{
  const editor=await vite.ssrLoadModule('/src/components/dashboard/DashboardActivity.tsx');const normal=editor.activityEditorialDraft({...draft,public_occurred_at:'2026-01-01T00:00:00.123456+00:00'});equal(normal.public_occurred_at,'2026-01-01T00:00:00.123Z');equal((await dispatch('/api/dashboard/feed-entries',{method:'POST',body:{...normal,text:'Internal'}})).status,201);
  const hostile='<img src=x onerror=window.__activity_executed=true>';fixture.tables.feed_entries=[{id:randomUUID(),...draft,public_title:hostile,public_text:hostile,is_published:true,public_revision:0}];const response=await dispatch('/api/feed');equal(response.status,200);const [row]=await response.json();equal(row.title,hostile);equal(row.text,hostile);equal(response.headers.get('content-type'),'application/json; charset=utf-8');
 });
 await group('Failures, malformed public data and query expansion fail closed without private details',async()=>{
  fail=true;for(const route of ['/api/feed','/api/logs']){const response=await dispatch(route);equal(response.status,503);ok(!(await response.text()).includes('PRIVATE_FAILURE_CANARY'));}fail=false;
  const sample=fixture.tables.feed_entries[0];for(const change of [{public_occurred_at:'2026-02-30T00:00:00Z'},{public_text:''},{public_event_type:'private'},{project_id:'not-an-id'}]){fixture.tables.feed_entries=[{...sample,...change}];equal((await dispatch('/api/feed')).status,503);}fixture.tables.feed_entries=[];equal(await (await dispatch('/api/feed')).json(),[]);
  for(const route of ['/api/feed?select=*','/api/logs?is_published=false']){const before=fixture.requests.length;equal((await dispatch(route)).status,400);equal(fixture.requests.length,before);}
  const cancel=new AbortController();cancel.abort();await assert.rejects(()=>publicActivity.loadPublicActivity('feed',{signal:cancel.signal}));checks++;
 });
 equal(network.blocked,[]);
 await mkdir(path.join(root,'docs/evidence'),{recursive:true});
 await writeFile(path.join(root,'docs/evidence/public-activity-local.json'),JSON.stringify({completedAt:new Date().toISOString(),passed:true,groups,assertions:checks,scope:'Synthetic guarded HTTP; no real environment, external services, model calls or production writes.',publicLimits:{feed:20,logs:15},blockedRequests:network.blocked},null,2)+'\n');
 console.log(`PASS public activity: ${groups} groups, ${checks} assertions; synthetic HTTP only, no external requests.`);
} finally {globalThis.fetch=realFetch;await vite.close();await fixture.close();network.restore();}
