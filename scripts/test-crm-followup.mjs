import assert from 'node:assert/strict';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createServer} from 'vite';
import {createDashboardTestFixture,TEST_PASSWORD,TEST_VISITOR_ID} from './dashboard-auth-test-fixture.mjs';
import {installFetchGuard} from './dashboard-test-network-guard.mjs';

// v26 behaviour through the real routes and middleware: manual contacts, the dated
// next step, the lead/journey/video-call links and the notice link. Synthetic data only.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const {AstroCookies}=await import(pathToFileURL(path.join(root,'node_modules/astro/dist/core/cookies/index.js')));
const fixture=await createDashboardTestFixture();const origin='http://localhost:4351';const guard=installFetchGuard([fixture.origin]);
const vite=await createServer({root,configFile:false,envFile:false,logLevel:'silent',appType:'custom',server:{middlewareMode:true,hmr:false,watch:null},optimizeDeps:{noDiscovery:true},resolve:{alias:{'astro:middleware':'astro/middleware'}},define:Object.fromEntries(Object.entries({...fixture.environment(origin),PROD:false,DEV:true,SSR:true,MODE:'test',BASE_URL:'/'}).map(([key,value])=>[`import.meta.env.${key}`,JSON.stringify(value)]))});
let count=0,groups=0,cookie='',csrf='';const routes=new Map();let middleware;
const eq=(actual,expected,message)=>{count++;assert.deepEqual(actual,expected,message);};const ok=(value,message)=>{count++;assert.ok(value,message);};
const group=async(name,fn)=>{await fn();console.log(`ok ${++groups} - ${name}`);};
const makeRequest=(route,{method='GET',body,headers={},anonymous=false}={})=>new Request(new URL(route,origin),{method,headers:{...(cookie&&!anonymous?{cookie}:{}),...(body!==undefined?{'content-type':'application/json'}:{}),...(method!=='GET'?{origin,'x-dashboard-csrf':csrf}:{}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
async function dispatch(route,options){const request=makeRequest(route,options);const cookies=new AstroCookies(request);const context={request,url:new URL(request.url),cookies,locals:{},params:{},clientAddress:'192.0.2.51'};const result=await middleware(context,()=>routes.get(context.url.pathname)?.[request.method](context)??new Response('page',{status:200}));for(const value of cookies.headers())result.headers.append('set-cookie',value);return result;}
const day=(offset)=>{const value=new Date(Date.now()+offset*86400000);return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit'}).format(value);};
const chatLead=fixture.tables.leads[0];
const manual={name:' Marta Ficticia ',email:'marta@example.invalid',phone:'',company:'Sello Ficticio',project_type:'videoclip',origin:'Instagram',summary:'Videoclip para el single de otoño.'};
let manualLead,journey;
try {
  for (const name of ['leads','client-journeys','lead-context','auth/login']) routes.set(`/api/dashboard/${name}`,await vite.ssrLoadModule(`/src/pages/api/dashboard/${name}.ts`));
  middleware=(await vite.ssrLoadModule('/src/middleware.ts')).onRequest;
  const login=await dispatch('/api/dashboard/auth/login',{method:'POST',body:{password:TEST_PASSWORD}});eq(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];
  const auth=await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');csrf=(await auth.getDashboardSession(makeRequest('/api/dashboard/leads'))).csrfToken;

  await group('A contact from outside the chat is created once and never linked to a visitor',async()=>{
    const operation_id=randomUUID();const before=fixture.tables.leads.length;
    eq((await dispatch('/api/dashboard/leads',{method:'POST',body:{...manual,operation_id},anonymous:true})).status,401);
    const first=await dispatch('/api/dashboard/leads',{method:'POST',body:{...manual,operation_id}});eq(first.status,201);manualLead=await first.json();
    eq(manualLead.id,operation_id);eq(manualLead.source,'manual');eq(manualLead.visitor_id,null);eq(manualLead.name,'Marta Ficticia');eq(manualLead.phone,null);eq(manualLead.origin,'Instagram');eq(manualLead.status,'new');eq(manualLead.expires_at,null);eq(manualLead.journey,null);
    const retry=await dispatch('/api/dashboard/leads',{method:'POST',body:{...manual,operation_id}});eq(retry.status,201);eq((await retry.json()).id,operation_id);eq(fixture.tables.leads.length,before+1,'A retry does not duplicate the contact');
    eq((await dispatch('/api/dashboard/leads',{method:'POST',body:{...manual,email:'otra@example.invalid',operation_id}})).status,409);
    for (const body of [{...manual,name:'   '},{...manual,email:'sin-arroba'},{...manual,status:'qualified'},{...manual,name:'Dos\nlíneas'},{...manual,origin:'x'.repeat(81)},{...manual,phone:5},{...manual,operation_id:'invalid'}]) {
      eq((await dispatch('/api/dashboard/leads',{method:'POST',body:{operation_id:randomUUID(),...body}})).status,400);
    }
    eq(fixture.tables.leads.length,before+1,'Rejected input writes nothing');
  });

  await group('The list answers where each contact is: expiry, journey stage and one-contact link',async()=>{
    const all=await dispatch('/api/dashboard/leads');eq(all.status,200);eq(all.headers.get('x-total-count'),'2');const rows=await all.json();
    const chat=rows.find(row=>row.id===chatLead.id),hand=rows.find(row=>row.id===manualLead.id);
    eq(chat.journey,null);eq(chat.booking,null);eq(chat.expires_at,new Date(Date.parse(chatLead.updated_at)+90*86400000).toISOString(),'Chat contacts expire with the 90-day profile retention');
    eq(hand.expires_at,null,'Manual contacts are outside the chat retention');
    const one=await dispatch(`/api/dashboard/leads?id=${manualLead.id}`);eq(one.headers.get('x-total-count'),'1');eq((await one.json())[0].id,manualLead.id);
    eq((await dispatch('/api/dashboard/leads?id=not-a-uuid')).status,400);
    const created=await dispatch('/api/dashboard/client-journeys',{method:'POST',body:{lead_id:manualLead.id,operation_id:randomUUID(),client_name:'Marta Ficticia',project_title:'Videoclip de otoño',brief:manual.summary}});eq(created.status,201);journey=await created.json();
    eq(journey.next_action_date,null);
    const linked=(await (await dispatch(`/api/dashboard/leads?id=${manualLead.id}`)).json())[0];eq(linked.journey,{id:journey.id,stage:'received',next_action_date:null});
  });

  await group('A manual contact has an explicit empty conversation context instead of a failure',async()=>{
    const response=await dispatch(`/api/dashboard/lead-context?lead_id=${manualLead.id}`);eq(response.status,200);const context=await response.json();
    eq(context.source,'none');eq(context.visitorId,'');eq(context.conversationId,null);eq(context.messages,[]);eq(context.email,'marta@example.invalid');
    const writing=await vite.ssrLoadModule('/src/lib/client-email-writing.ts');
    eq(writing.checkedLeadConversationContext(context,manualLead.id).leadId,manualLead.id);
    assert.throws(()=>writing.checkedLeadConversationContext({...context,source:'linked'},manualLead.id));count++;
    assert.throws(()=>writing.checkedLeadConversationContext({...context,totalMessages:1,messages:[{role:'user',content:'x',created_at:'2026-01-01T00:00:00Z'}]},manualLead.id));count++;
    // A chat lead whose visitor reference is missing is still a storage error, not an empty chat.
    const broken={...chatLead,id:randomUUID(),visitor_id:null};fixture.tables.leads.push(broken);
    eq((await dispatch(`/api/dashboard/lead-context?lead_id=${broken.id}`)).status,503);fixture.tables.leads.pop();
  });

  await group('The dated next step is saved, validated and cleared without inventing client history',async()=>{
    const events=fixture.tables.client_journey_events.length;const patch=(body)=>dispatch('/api/dashboard/client-journeys',{method:'PATCH',body:{id:journey.id,operation_id:randomUUID(),...body}});
    const saved=await patch({next_action_date:day(7),next_action_note:'  Reclamar respuesta al presupuesto  '});eq(saved.status,200);const row=await saved.json();
    eq(row.next_action_date,day(7));eq(row.next_action_note,'Reclamar respuesta al presupuesto');eq(row.stage,'received');
    eq(fixture.tables.client_journey_events.length,events,'A reminder date is not a client milestone');
    for (const body of [{next_action_date:'2026-02-31'},{next_action_date:'mañana'},{next_action_date:20261120},{next_action_note:'Dos\nlíneas'},{next_action_note:'x'.repeat(301)},{next_action_time:'09:00'}]) eq((await patch(body)).status,400);
    eq(fixture.tables.client_journeys.find(item=>item.id===journey.id).next_action_date,day(7),'Rejected input keeps the saved step');
    const list=(await (await dispatch(`/api/dashboard/client-journeys?id=${journey.id}`)).json())[0];eq(list.next_action_date,day(7));eq(list.booking,null);
    eq((await (await dispatch(`/api/dashboard/leads?id=${manualLead.id}`)).json())[0].journey.next_action_date,day(7));
    const cleared=await (await patch({next_action_date:null,next_action_note:''})).json();eq(cleared.next_action_date,null);eq(cleared.next_action_note,'');
  });

  await group('The booked video call appears beside its lead and its journey',async()=>{
    const booking=(id,date,time,status,visitor=TEST_VISITOR_ID)=>({id,visitor_id:visitor,booked_date:date,booked_time:`${time}:00`,status,meet_url:`https://meet.jit.si/Akrasia-${id}`,visitor_email:'synthetic@example.invalid',created_at:new Date().toISOString()});
    const ids=Array.from({length:5},()=>randomUUID());
    fixture.tables.bookings.push(booking(ids[0],day(-10),'10:00','completed'),booking(ids[1],day(3),'12:30','confirmed'),booking(ids[2],day(9),'09:00','confirmed'),booking(ids[3],day(1),'11:00','cancelled'),booking(ids[4],day(2),'16:00','confirmed','00000000-0000-4000-8000-00000000ffff'));
    const lead=(await (await dispatch(`/api/dashboard/leads?id=${chatLead.id}`)).json())[0];
    eq(lead.booking,{id:ids[1],date:day(3),time:'12:30',status:'confirmed',meet_url:`https://meet.jit.si/Akrasia-${ids[1]}`},'The next confirmed call wins over later, past, cancelled and foreign ones');
    eq((await (await dispatch(`/api/dashboard/leads?id=${manualLead.id}`)).json())[0].booking,null);
    const chatJourney=await (await dispatch('/api/dashboard/client-journeys',{method:'POST',body:{lead_id:chatLead.id,operation_id:randomUUID(),client_name:'Cliente del chat',project_title:'Proyecto del chat',brief:''}})).json();
    eq((await (await dispatch(`/api/dashboard/client-journeys?id=${chatJourney.id}`)).json())[0].booking.id,ids[1]);
    fixture.tables.bookings.splice(0);fixture.tables.bookings.push(booking(ids[0],day(-10),'10:00','completed'));
    eq((await (await dispatch(`/api/dashboard/leads?id=${chatLead.id}`)).json())[0].booking.status,'completed','Without upcoming calls the last one remains visible');
    fixture.tables.bookings.push({...booking(randomUUID(),'not-a-date','10:00','confirmed')});
    eq((await dispatch(`/api/dashboard/leads?id=${chatLead.id}`)).status,503,'A malformed booking is an error, never a missing call');fixture.tables.bookings.pop();
  });

  await group('A notice link survives login and cleaning only as one well-formed record',async()=>{
    const id=randomUUID();const location=async(route)=>{const response=await dispatch(route,{anonymous:true});ok(response.status>=300&&response.status<400);return new URL(response.headers.get('location'),origin);};
    const lead=await location(`/dashboard?tab=leads&lead=${id}`);eq(lead.pathname,'/dashboard/login');eq(lead.searchParams.get('returnTo'),`/dashboard?tab=leads&lead=${id}`);
    eq((await location(`/dashboard?tab=journeys&journey=${id}`)).searchParams.get('returnTo'),`/dashboard?tab=journeys&journey=${id}`);
    for (const query of [`tab=leads&lead=not-a-uuid`,`tab=overview&lead=${id}`,`tab=leads&journey=${id}`,`tab=leads&lead=${id}&lead=${randomUUID()}`]) {
      const target=await location(`/dashboard?${query}`);ok(!/[?&](lead|journey)=/.test(target.searchParams.get('returnTo')||''),`A malformed, mismatched or repeated record id must not survive: ${query}`);
    }
    const signedIn=await dispatch(`/dashboard?tab=leads&lead=${id}`);eq(signedIn.status,200,'A valid link is not rewritten for a signed-in owner');
    const cleaned=await dispatch(`/dashboard?tab=leads&lead=not-a-uuid`);eq(cleaned.status,303);eq(cleaned.headers.get('location'),'/dashboard?tab=leads');
  });

  await group('The worker builds the panel link from private configuration, never from the queue',async()=>{
    const outbox=await vite.ssrLoadModule('/src/lib/integration-outbox.ts');const id=randomUUID();
    eq(outbox.telegramNotice({text:'Nuevo contacto en el chat · videoclip · interés alto.',panel:`lead:${id}`},'https://akrasia.studio').text,`Nuevo contacto en el chat · videoclip · interés alto.\nAbrir en el panel: https://akrasia.studio/dashboard?tab=leads&lead=${id}`);
    eq(outbox.telegramNotice({text:'Próximo paso pendiente hoy · Presupuesto enviado',panel:`journey:${id}`},'https://akrasia.studio/').text.split('\n')[1],`Abrir en el panel: https://akrasia.studio/dashboard?tab=journeys&journey=${id}`);
    eq(outbox.telegramNotice({text:'Aviso sin ficha'},'https://akrasia.studio'),{text:'Aviso sin ficha'});
    for (const site of ['http://akrasia.studio','https://user:secret@akrasia.studio','https://akrasia.studio/path','not a url']) eq(outbox.telegramNotice({text:'Aviso',panel:`lead:${id}`},site),{text:'Aviso'},'An unusable site sends the notice without a link');
    for (const payload of [{text:'Aviso',panel:'lead:not-a-uuid'},{text:'Aviso',panel:`project:${id}`},{text:'Aviso',panel:`lead:${id}`,url:'https://evil.example'},{text:'Aviso',panel:{id}},{panel:`lead:${id}`},{text:''},null]) { assert.throws(()=>outbox.telegramNotice(payload,'https://akrasia.studio'));count++; }
  });

  await group('Shared date helpers use Madrid civil days and the retention deadline',async()=>{
    const ui=await vite.ssrLoadModule('/src/lib/client-journey-ui.ts');const links=await vite.ssrLoadModule('/src/lib/lead-links.ts');
    eq(ui.nextActionState(null,'2026-11-20'),'none');eq(ui.nextActionState('2026-11-19','2026-11-20'),'overdue');eq(ui.nextActionState('2026-11-20','2026-11-20'),'today');eq(ui.nextActionState('2026-11-21','2026-11-20'),'upcoming');
    eq(ui.shortCivilDate('2026-11-20'),'20 nov 2026');eq(ui.shortCivilDate('20/11/2026'),'');
    eq(ui.daysUntil('2026-01-11T00:00:00Z',Date.parse('2026-01-01T00:00:00Z')),10);eq(ui.daysUntil('2025-12-31T00:00:00Z',Date.parse('2026-01-01T00:00:00Z')),-1);eq(ui.daysUntil(null),null);
    eq(Object.keys(ui.JOURNEY_STAGE_LABELS).length,10);
    eq(links.chatLeadExpiry({source:'manual',updated_at:'2026-01-01T00:00:00Z'}),null);eq(links.chatLeadExpiry({updated_at:'2026-01-01T00:00:00Z'},30),'2026-01-31T00:00:00.000Z');eq(links.chatLeadExpiry({source:'web',updated_at:'nunca'}),null);
  });

  eq(guard.blocked,[]);
  console.log(`PASS CRM follow-up: ${groups} groups, ${count} assertions; local synthetic data, no external providers.`);
} finally {await vite.close();await fixture.close();guard.restore();}
