import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createServer} from 'vite';
import {createDashboardTestFixture,TEST_PASSWORD} from './dashboard-auth-test-fixture.mjs';
import {installFetchGuard} from './dashboard-test-network-guard.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {AstroCookies}=await import(pathToFileURL(path.join(root,'node_modules/astro/dist/core/cookies/index.js')));
const fixture=await createDashboardTestFixture();const origin='http://localhost:4349';const guard=installFetchGuard([fixture.origin]);
const vite=await createServer({root,configFile:false,envFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},resolve:{alias:{'astro:middleware':'astro/middleware'}},define:Object.fromEntries(Object.entries({...fixture.environment(origin),PROD:false,DEV:true,SSR:true,MODE:'test',BASE_URL:'/'}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
let count=0,groups=0,cookie='',csrf='';const routes=new Map();let middleware;
const eq=(actual,expected,message)=>{count++;assert.deepEqual(actual,expected,message);};const ok=(value,message)=>{count++;assert.ok(value,message);};
const group=async(name,fn)=>{await fn();console.log(`ok ${++groups} - ${name}`);};
const makeRequest=(route,{method='GET',body,headers={}}={})=>new Request(new URL(route,origin),{method,headers:{...(cookie?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...(method!=='GET'?{origin,'x-dashboard-csrf':csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function dispatch(route,options){const request=makeRequest(route,options);const cookies=new AstroCookies(request);const context={request,url:new URL(request.url),cookies,locals:{},params:{},clientAddress:'192.0.2.49'};const result=await middleware(context,()=>routes.get(context.url.pathname)[request.method](context));for(const value of cookies.headers())result.headers.append('set-cookie',value);return result;}
const requestBody={lead_id:fixture.tables.leads[0].id,operation_id:randomUUID(),client_name:'Cliente humano',project_title:'Proyecto privado',brief:'Una propuesta audiovisual.'};
let journey,draft;
try {
  for (const name of ['client-journeys','email-drafts','projects','tasks','clients','auth/login']) routes.set(`/api/dashboard/${name}`,await vite.ssrLoadModule(`/src/pages/api/dashboard/${name}.ts`));
  middleware=(await vite.ssrLoadModule('/src/middleware.ts')).onRequest;
  eq((await dispatch('/api/dashboard/client-journeys')).status,401);
  const login=await dispatch('/api/dashboard/auth/login',{method:'POST',body:{password:TEST_PASSWORD}});eq(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];const auth=await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');csrf=(await auth.getDashboardSession(makeRequest('/api/dashboard/client-journeys'))).csrfToken;
  await group('Atomic conversion and every replay create one client and private project',async()=>{
    const before={clients:fixture.tables.clients.length,projects:fixture.tables.projects.length};
    const first=await dispatch('/api/dashboard/client-journeys',{method:'POST',body:requestBody});eq(first.status,201);journey=await first.json();ok(!Array.isArray(journey));eq(journey.stage,'received');eq(fixture.tables.clients.length,before.clients+1);eq(fixture.tables.projects.length,before.projects+1);eq(fixture.tables.projects.find(row=>row.id===journey.project_id).is_published,false);eq(fixture.tables.projects.find(row=>row.id===journey.project_id).status,'planning');
    for (const body of [requestBody,{...requestBody,operation_id:randomUUID()}]) {const res=await dispatch('/api/dashboard/client-journeys',{method:'POST',body});eq(res.status,201);eq((await res.json()).id,journey.id);}
    eq(fixture.tables.client_journeys.length,1);eq(fixture.tables.client_journey_events.length,1);eq((await dispatch('/api/dashboard/client-journeys',{method:'POST',body:{...requestBody,brief:'Changed'}})).status,409);
    const total=fixture.tables.clients.length;eq((await dispatch('/api/dashboard/client-journeys',{method:'POST',body:{...requestBody,lead_id:randomUUID(),operation_id:randomUUID()}})).status,404);eq(fixture.tables.clients.length,total);
  });
  await group('Stages, quote edits and notes create actual history with paginated continuation',async()=>{
    const patch={id:journey.id,operation_id:randomUUID(),stage:'evaluating',note:'El equipo está revisando la idea.'};eq((await dispatch('/api/dashboard/client-journeys',{method:'PATCH',body:patch})).status,200);eq((await dispatch('/api/dashboard/client-journeys',{method:'PATCH',body:patch})).status,200);eq(fixture.tables.client_journey_events.filter(row=>row.event_type==='stage_changed').length,1);
    eq((await dispatch('/api/dashboard/client-journeys',{method:'PATCH',body:{id:journey.id,operation_id:randomUUID(),budget_amount:0.29,budget_scope:'Pieza de 30 segundos',budget_timing:'Dos semanas'}})).status,200);eq(fixture.tables.client_journey_events.filter(row=>row.event_type==='quote_updated').length,1);
    eq((await dispatch('/api/dashboard/client-journeys',{method:'PATCH',body:{id:journey.id,operation_id:randomUUID(),stage:'evaluating'}})).status,200);eq(fixture.tables.client_journey_events.length,3,'Unchanged stage is not invented history');
    for (let i=0;i<103;i++)fixture.tables.client_journey_events.push({id:randomUUID(),journey_id:journey.id,event_type:'note',stage:'evaluating',note:`Nota ${i}`,created_at:new Date(Date.UTC(2026,0,1,0,i)).toISOString()});
    const seen=new Set();for (const offset of [0,50,100]){const response=await dispatch(`/api/dashboard/client-journeys?id=${journey.id}&events=true&offset=${offset}`);eq(response.status,200);eq(response.headers.get('x-total-count'),'106');const rows=await response.json();for (const row of rows){ok(!seen.has(row.id));seen.add(row.id);}eq(response.headers.get('x-next-offset'),offset===100?'':String(offset+50));}eq(seen.size,106);
  });
  await group('Current client and project names and contacts survive opening from project',async()=>{
    fixture.tables.clients.find(row=>row.id===journey.client_id).name='Nombre actualizado';fixture.tables.projects.find(row=>row.id===journey.project_id).title='Título actualizado';
    const rows=await (await dispatch(`/api/dashboard/client-journeys?project_id=${journey.project_id}`)).json();eq(rows.length,1);eq(rows[0].client_name,'Nombre actualizado');eq(rows[0].project_title,'Título actualizado');eq(rows[0].lead_email,'synthetic@example.invalid');eq(rows[0].client_email,'synthetic@example.invalid');
  });
  await group('Every real phase is sequential, confirmed and linked to completed production work',async()=>{
    const patch=body=>dispatch('/api/dashboard/client-journeys',{method:'PATCH',body:{id:journey.id,operation_id:randomUUID(),...body}});
    const change=async(stage,note='')=>{const response=await patch({stage,note});eq(response.status,200);return fixture.tables.projects.find(row=>row.id===journey.project_id).status;};
    eq((await patch({budget_amount:null,budget_scope:'',budget_timing:''})).status,200);
    eq((await patch({stage:'closed',note:'Intento de saltar todo el proceso'})).status,400);
    eq(await change('quote_preparation'),'planning');eq((await patch({stage:'quote_sent',note:'Confirmación de envío'})).status,400);
    eq((await patch({budget_amount:1500,budget_currency:'EUR',budget_scope:'Vídeo 3D de 30 segundos, dos revisiones.',budget_timing:'Diez días laborables desde aceptación y materiales.'})).status,200);
    eq((await patch({stage:'quote_sent'})).status,400);eq(await change('quote_sent','Presupuesto enviado y verificado por el equipo.'),'planning');
    eq((await patch({stage:'accepted'})).status,400);eq(await change('accepted','El cliente confirmó alcance, importe y plazo.'),'planning');
    eq((await patch({stage:'in_production'})).status,400);
    const added=await dispatch('/api/dashboard/tasks',{method:'POST',body:{project_id:journey.project_id,title:'Producir animación',status:'pending',priority:'high'}});eq(added.status,201);const task=await added.json();
    eq(await change('in_production'),'in_production');eq((await dispatch('/api/dashboard/tasks',{method:'PATCH',body:{id:task.id,status:'in_progress'}})).status,200);
    eq(await change('review'),'post_production');eq((await patch({stage:'delivered',note:'Entrega intentada con tarea pendiente.'})).status,400);
    const counted=(await(await dispatch(`/api/dashboard/client-journeys?id=${journey.id}`)).json())[0];eq(counted.tasks_total,1);eq(counted.tasks_pending,1);eq(counted.tasks_completed,0);
    eq((await dispatch('/api/dashboard/tasks',{method:'PATCH',body:{id:task.id,status:'completed'}})).status,200);eq((await patch({stage:'delivered'})).status,400);
    eq(await change('delivered','Máster final entregado y enlace verificado.'),'delivered');eq((await patch({stage:'closed'})).status,400);eq(await change('closed','Cliente confirma recepción; sin asuntos pendientes.'),'completed');
    eq((await dispatch('/api/dashboard/tasks',{method:'PATCH',body:{id:task.id,status:'pending'}})).status,400);
    eq((await dispatch('/api/dashboard/tasks',{method:'POST',body:{project_id:journey.project_id,title:'Trabajo pendiente después de cerrar'}})).status,400);
    eq((await patch({stage:'review'})).status,400);eq(await change('review','El cliente solicita una revisión adicional.'),'post_production');
    eq((await dispatch('/api/dashboard/tasks',{method:'PATCH',body:{id:task.id,status:'pending'}})).status,200);
    eq((await patch({stage:'lost'})).status,400);eq(await change('lost','El cliente cancela la ampliación.'),'planning');
    eq((await patch({stage:'evaluating'})).status,400);eq(await change('evaluating','Se retoma el encargo con nuevo alcance.'),'planning');eq(fixture.tables.projects.find(row=>row.id===journey.project_id).is_published,false);
  });
  await group('The linked journey owns project status and client while precise record lookups remain available',async()=>{
    for(const fields of [{status:'delivered'},{client_id:fixture.tables.clients[0].id}])eq((await dispatch('/api/dashboard/projects',{method:'PATCH',body:{id:journey.project_id,...fields}})).status,409);
    eq((await dispatch('/api/dashboard/projects',{method:'PATCH',body:{id:journey.project_id,title:'Título actualizado'}})).status,200);
    const response=await dispatch(`/api/dashboard/projects?id=${journey.project_id}&tasks=true&limit=1`);eq(response.status,200);eq(response.headers.get('x-total-count'),'1');const rows=await response.json();eq(rows.length,1);eq(rows[0].id,journey.project_id);eq(rows[0].journey_id,journey.id);eq(rows[0].journey_stage,'evaluating');eq(rows[0].tasks.length,1);
    const clientResponse=await dispatch(`/api/dashboard/clients?id=${journey.client_id}&limit=1`);eq(clientResponse.status,200);eq((await clientResponse.json())[0].id,journey.client_id);
    eq((await dispatch('/api/dashboard/clients',{method:'PATCH',body:{id:journey.client_id,name:'Nombre corregido por el equipo',email:'updated@example.invalid'}})).status,200);
    const currentClient=(await(await dispatch(`/api/dashboard/client-journeys?id=${journey.id}`)).json())[0];eq(currentClient.client_name,'Nombre corregido por el equipo');eq(currentClient.client_email,'updated@example.invalid');eq(currentClient.lead_email,'synthetic@example.invalid','Original lead history is preserved separately from current contact');
    eq((await(await dispatch(`/api/dashboard/projects?id=${journey.project_id}`)).json())[0].client_name,'Nombre corregido por el equipo');
    eq((await dispatch('/api/dashboard/projects?id=invalid')).status,400);eq((await dispatch('/api/dashboard/clients?id=invalid')).status,400);
  });
  await group('Project task pages load in a bounded pool of six and retain stable project ordering',async()=>{
    for(let i=0;i<12;i++)fixture.tables.projects.push({...fixture.tables.projects[0],id:randomUUID(),slug:`pool-${i}`,title:`Pool ${i}`,sort_order:i+2});
    const originalFetch=globalThis.fetch;let active=0,peak=0,reads=0;
    globalThis.fetch=async(input,options)=>{const url=new URL(typeof input==='string'?input:input.url);const isTask=url.origin===fixture.origin&&url.pathname==='/rest/v1/project_tasks'&&url.searchParams.get('select')?.includes('description');if(!isTask)return originalFetch(input,options);active++;peak=Math.max(peak,active);reads++;try{await new Promise(resolve=>setTimeout(resolve,15));return await originalFetch(input,options);}finally{active--;}};
    try{const response=await dispatch('/api/dashboard/projects?tasks=true&limit=100');eq(response.status,200);const rows=await response.json();eq(reads,rows.length);eq(peak,6);eq(rows[0].id,journey.project_id);eq(rows.length,14);eq(rows[0].tasks_next_offset,null);}finally{globalThis.fetch=originalFetch;}
  });
  await group('Saved drafts replay safely, derive linked records and reject stale overwrite',async()=>{
    const body={id:randomUUID(),revision:0,operation_id:randomUUID(),to_email:'client@example.invalid',to_name:'Cliente',subject:'Estamos revisando tu propuesta',body_text:'Hola, Cliente.\nEl equipo está revisando tu propuesta y te escribiremos con el presupuesto.',template_type:'evaluation',journey_id:journey.id};
    const first=await dispatch('/api/dashboard/email-drafts',{method:'POST',body});eq(first.status,200);draft=await first.json();eq(draft.revision,1);eq(draft.lead_id,journey.lead_id);eq(draft.client_id,journey.client_id);eq(draft.project_id,journey.project_id);eq(draft.status,'draft');eq((await dispatch('/api/dashboard/email-drafts',{method:'POST',body})).status,200);eq(fixture.tables.email_drafts.length,1);
    const changed={...body,revision:1,operation_id:randomUUID(),subject:'Nueva revisión'};const saved=await dispatch('/api/dashboard/email-drafts',{method:'POST',body:changed});eq(saved.status,200);draft=await saved.json();eq(draft.revision,2);eq((await dispatch('/api/dashboard/email-drafts',{method:'POST',body:{...changed,operation_id:randomUUID(),subject:'Cambio tardío'}})).status,409);eq(fixture.tables.email_drafts[0].subject,'Nueva revisión');
    eq((await dispatch('/api/dashboard/email-drafts',{method:'POST',body:{...body,id:randomUUID(),operation_id:randomUUID(),project_id:randomUUID()}})).status,409);
  });
  await group('Queue consumes only the saved revision, replays once and reports provider status separately',async()=>{
    const rpc=(body)=>fetch(`${fixture.origin}/rest/v1/rpc/dashboard_queue_email_draft`,{method:'POST',headers:{'content-type':'application/json',apikey:fixture.environment(origin).SUPABASE_SERVICE_ROLE_KEY,authorization:`Bearer ${fixture.environment(origin).SUPABASE_SERVICE_ROLE_KEY}`},body:JSON.stringify(body)});
    eq((await rpc({p_id:draft.id,p_revision:1,p_operation:randomUUID()})).status,409);
    const operation={p_id:draft.id,p_revision:draft.revision,p_operation:randomUUID()};const first=await rpc(operation);eq(first.status,200);const queued=await first.json();eq(queued.status,'queued');eq(queued.provider_status,'queued');ok(queued.queue_id);eq((await (await rpc(operation)).json()).queue_id,queued.queue_id);eq((await (await rpc({...operation,p_operation:randomUUID()})).json()).queue_id,queued.queue_id);eq(fixture.tables.integration_outbox.length,1);eq(fixture.tables.sent_emails.length,1);eq(fixture.tables.sent_emails[0].lead_id,journey.lead_id);eq(fixture.tables.sent_emails[0].template_type,'evaluation');
    const list=await dispatch(`/api/dashboard/email-drafts?journey_id=${journey.id}`);eq(list.headers.get('x-total-count'),'1');eq((await list.json())[0].provider_status,'queued');fixture.tables.sent_emails[0].status='accepted';const accepted=(await (await dispatch(`/api/dashboard/email-drafts?id=${draft.id}`)).json())[0];eq(accepted.provider_status,'accepted');eq(accepted.status,'queued');eq(fixture.tables.client_journeys[0].stage,'evaluating','Email queue is not quote delivery or acceptance');
    const events=(await(await dispatch(`/api/dashboard/client-journeys?id=${journey.id}&events=true`)).json()).filter(row=>row.event_type==='email_queued');eq(events.length,1);eq(events[0].provider_status,'accepted');
  });
  await group('Production updates, revision delivery, final delivery and closure are distinct saved templates',async()=>{
    for(const template_type of ['progress','delivery','final_delivery','closure']){const response=await dispatch('/api/dashboard/email-drafts',{method:'POST',body:{id:randomUUID(),revision:0,operation_id:randomUUID(),to_email:'client@example.invalid',to_name:'Cliente',subject:'Comunicación sintética',body_text:'Texto revisable sin envío.',template_type,journey_id:journey.id}});eq(response.status,200);eq((await response.json()).template_type,template_type);}
  });
  await group('Bad inputs, authorization and storage outage cannot mutate records',async()=>{
    for (const body of [{...requestBody,is_published:true},{...requestBody,client_name:''},{...requestBody,lead_id:'invalid'}])eq((await dispatch('/api/dashboard/client-journeys',{method:'POST',body})).status,400);
    eq((await dispatch('/api/dashboard/client-journeys',{method:'PATCH',body:{id:journey.id,operation_id:randomUUID(),budget_amount:1.234}})).status,400);eq((await dispatch('/api/dashboard/client-journeys?limit=101')).status,400);eq((await dispatch('/api/dashboard/client-journeys',{method:'POST',body:requestBody,headers:{'x-dashboard-csrf':'invalid'}})).status,403);
    fixture.state.journeyUnavailable=true;eq((await dispatch('/api/dashboard/client-journeys',{method:'POST',body:{...requestBody,operation_id:randomUUID()}})).status,503);fixture.state.journeyUnavailable=false;eq(fixture.tables.client_journeys.length,1);eq(guard.blocked,[]);
  });
  console.log(`PASS client journey: ${groups} groups, ${count} assertions; local synthetic data, no external providers.`);
} finally {await vite.close();await fixture.close();guard.restore();}
