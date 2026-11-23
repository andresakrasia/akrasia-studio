import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDashboardTestFixture, TEST_SERVICE_KEY } from './dashboard-auth-test-fixture.mjs';
import { createChatTestFixture, TEST_CHAT_SERVICE_KEY } from './chat-test-fixture.mjs';
import { loadChatFirstServices } from './chat-first-catalogue-fixture.mjs';
import { configurePublicActivityFixture } from './public-activity-test-fixture.mjs';
import { attachPreviewProductionAiFixture } from './preview-production-ai-fixture.mjs';

// One local gateway, normal application authorization, shared memory. This
// composition is preview-only and is never part of production routing.
export async function createChatFirstPreviewFixture({ clock = Date.now, syntheticBookingSlots = [], chatSessionSecret: preservedSecret, youtubeDemo = false } = {}) {
  if (typeof clock !== 'function' || typeof youtubeDemo !== 'boolean' || preservedSecret !== undefined && (typeof preservedSecret !== 'string' || !/^[a-f0-9]{64,128}$/i.test(preservedSecret))) throw new Error('Invalid synthetic preview configuration');
  // Explicit exact slots for proposal audits only. Empty by default; this is
  // neither the SQL agenda implementation nor a claim of real availability.
  if (!Array.isArray(syntheticBookingSlots) || syntheticBookingSlots.length > 50 || syntheticBookingSlots.some(slot =>
    !slot || typeof slot !== 'object' || Array.isArray(slot) || Object.keys(slot).sort().join(',') !== 'date,time' ||
    typeof slot.date !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(slot.date) ||
    !Number.isFinite(Date.parse(`${slot.date}T00:00:00Z`)) || new Date(`${slot.date}T00:00:00Z`).toISOString().slice(0, 10) !== slot.date ||
    typeof slot.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(slot.time))) {
    throw new Error('Invalid synthetic booking slots');
  }
  const proposalSlots = new Set(syntheticBookingSlots.map(slot => `${slot.date} ${slot.time}`));
  const dashboard = await createDashboardTestFixture();
  const chat = await createChatTestFixture({ clock });
  // Default restarts require a fresh browser session. A caller restoring its
  // local snapshot can explicitly preserve the signing key; that key does not
  // restore rows, expiry or context versions on its own.
  const chatSessionSecret = preservedSecret ?? randomBytes(32).toString('hex');
  for (const [table, rows] of Object.entries(chat.tables)) {
    dashboard.tables[table] = rows;
    Object.defineProperty(chat.tables, table, { enumerable: true, configurable: true,
      get: () => dashboard.tables[table], set: value => { dashboard.tables[table] = value; } });
  }
  dashboard.tables.integration_outbox = [];
  Object.defineProperty(chat.tables, 'integration_outbox', { enumerable: true, configurable: true,
    get: () => dashboard.tables.integration_outbox, set: value => { dashboard.tables.integration_outbox = value; } });
  dashboard.tables.services = await loadChatFirstServices({ published: true });
  dashboard.tables.projects = [];
  for (const table of ['clients','project_tasks','studio_stats','feed_entries','studio_logs']) dashboard.tables[table] = [];
  const productionAi = attachPreviewProductionAiFixture(dashboard.tables, dashboard.state, { clock });
  configurePublicActivityFixture(dashboard);
  // Synthetic concepts for the local preview only. Neither this catalogue nor
  // its media is inserted into the production database or regression fixtures.
  const conceptProject = dashboard.tables.projects.find(project => project.slug === 'demo-audiovisual');
  if (conceptProject) {
    conceptProject.title = 'DEMO · ORIGEN';
    conceptProject.thumbnail = '/img/demo-origen.webp';
    conceptProject.duration = '8 s';
    conceptProject.type = 'Prototipo audiovisual ficticio';
    conceptProject.category = 'Dirección creativa';
    conceptProject.resolution = '960x540';
    conceptProject.video_url = '/media/demo-origen.mp4';
    conceptProject.public_description = 'DEMO ficticia: portada IA animada con sonido sintetizado. Muestra de reproducción de 8 s; no es un encargo ni una película entregada.';
    conceptProject.case_study = {
      brief: 'Exploración ficticia de una apertura audiovisual. La portada IA ilustra la idea; el vídeo es una muestra de reproducción.',
      process: 'Movimiento de encuadre sobre una portada generada con IA y una atmósfera sonora sintetizada. Creado únicamente para esta vista local.',
      result: 'Prototipo sintético de 8 s; sin cliente, producción comercial ni resultados atribuidos.',
      services: ['Dirección creativa', 'Producción IA'],
    };
    conceptProject.case_study_en = {
      brief: 'Fictional audiovisual opening. The AI cover illustrates the idea; the video is a playback sample.',
      process: 'Animated framing of an AI-generated cover with a synthesized soundscape, created only for this local preview.',
      result: 'An 8-second synthetic prototype; no client, commercial production or claimed results.',
      services: ['Creative direction', 'AI production'],
    };
    const concepts = [
      { name: 'PULSE', slug: 'pulse', category: 'Motion design',
        description: 'DEMO ficticia de motion design. Portada IA animada con sonido sintetizado; muestra de reproducción de 8 s, sin cliente real.',
        brief: 'Estudio ficticio de identidad en movimiento, con ritmo y energía visual.',
        briefEn: 'Fictional motion identity study with rhythmic light and geometry.',
        process: 'Movimiento de encuadre sobre una portada IA de luz y geometría, con un pulso sonoro sintetizado.',
        services: ['Creación de contenido', 'Diseño sonoro'] },
      { name: 'NOCTURNA', slug: 'nocturna', category: 'Pieza musical',
        description: 'DEMO ficticia de pieza musical. Portada IA animada con una atmósfera sonora sintetizada; muestra de 8 s, sin artista ni cliente real.',
        brief: 'Atmósfera nocturna ficticia para explorar una dirección de videoclip.',
        briefEn: 'Fictional nocturnal music-video direction with abstract city lights.',
        process: 'Movimiento de encuadre sobre una portada IA nocturna, con una base sonora sintetizada.',
        services: ['Dirección creativa', 'Diseño sonoro'] },
      { name: 'MATERIA', slug: 'materia', category: 'VFX y producto',
        description: 'DEMO ficticia de VFX y producto. Portada IA animada y audio sintetizado; muestra de reproducción de 8 s, sin producto comercial real.',
        brief: 'Estudio ficticio de forma y luz para una pieza de producto imaginaria.',
        briefEn: 'Fictional form and light study for an imaginary product piece.',
        process: 'Movimiento de encuadre sobre una portada IA de una forma flotante, con sonido sintetizado.',
        services: ['VFX y postproducción', 'Creación de contenido'] },
      { name: 'HORIZONTE', slug: 'horizonte', category: 'Film de marca',
        description: 'DEMO ficticia de film de marca. Portada IA animada y atmósfera sonora sintetizada; muestra de 8 s, sin marca ni encargo comercial.',
        brief: 'Exploración ficticia de un paisaje de apertura para una marca imaginaria.',
        briefEn: 'Fictional luminous landscape opening for an imaginary brand film.',
        process: 'Movimiento de encuadre sobre una portada IA de un paisaje luminoso, con una atmósfera sonora sintetizada.',
        services: ['Producción audiovisual con IA', 'Dirección creativa'] },
    ];
    concepts.forEach((concept, index) => dashboard.tables.projects.push({
      ...structuredClone(conceptProject),
      id: `00000000-0000-4000-8000-${String(911 + index).padStart(12, '0')}`,
      slug: `demo-${concept.slug}`, title: `DEMO · ${concept.name}`,
      category: concept.category, sort_order: index + 1,
      thumbnail: `/img/demo-${concept.slug}.webp`, video_url: `/media/demo-${concept.slug}.mp4`,
      public_description: concept.description,
      case_study: { brief: concept.brief, process: concept.process,
        result: 'Prototipo sintético de 8 s para la interfaz local. No representa trabajo entregado ni resultados comerciales.', services: concept.services },
      case_study_en: { brief: concept.briefEn,
        process: 'Animated framing of an AI-generated cover and synthesized audio created only for this local interface preview.',
        result: 'An 8-second synthetic interface prototype. No delivered commercial work or claimed results.', services: concept.services },
    }));
  }
  for (const project of dashboard.tables.projects) {
    project.description = 'Notas internas de la demostración. Este texto permanece privado.';
    project.client_name = 'Cliente ficticio de demostración';
  }
  // Explicit opt-in changes only the first local preview piece. The existing
  // cover illustrates the interface; the linked film belongs to Blender.
  if (youtubeDemo && conceptProject) Object.assign(conceptProject, {
    title: 'PRUEBA · TEARS OF STEEL',
    type: 'Prueba técnica de vídeo externo',
    category: 'Prueba YouTube · Blender Foundation',
    video_url: 'https://www.youtube.com/watch?v=OHOpb2fS-cM',
    thumbnail: '/img/demo-origen.webp',
    duration: '', resolution: '', aspect: '16:9',
    public_description: 'Prueba de reproducción de Tears of Steel, vídeo externo de Blender Foundation en YouTube. No es un trabajo de Akrasia. La portada local es ilustrativa y no pertenece a la película.',
    description: 'Prueba técnica local de un vídeo externo de Blender Foundation; sin cliente ni producción de Akrasia.',
    client_name: '',
    case_study: {
      brief: 'Prueba técnica del reproductor de YouTube con Tears of Steel, película de Blender Foundation. No es un proyecto ni un trabajo de Akrasia.',
      process: 'Inserción del enlace oficial de YouTube en el visor existente, con consentimiento para vídeos externos. La portada local de la interfaz es ilustrativa y no es una imagen de la película.',
      result: 'Ejemplo para comprobar el visor de vídeo de la interfaz local; sin cliente ni resultados comerciales atribuidos. La película y sus créditos corresponden a Blender Foundation.',
      services: [],
    },
    case_study_en: {
      brief: 'Technical YouTube player test using Tears of Steel, a Blender Foundation film. This is not an Akrasia project or delivered work.',
      process: 'The official YouTube link is embedded in the existing viewer after consent to external videos. The local interface cover is illustrative and is not a frame from the film.',
      result: 'A sample for checking the local interface video viewer; no client or claimed commercial results. The film and its credits belong to Blender Foundation.',
      services: [],
    },
  });
  for (const table of ['feed_entries', 'studio_logs']) for (const entry of dashboard.tables[table]) {
    entry.text = 'DEMO · Registro interno de prueba. Su texto no se publica en el hub.';
  }
  // This local model mirrors the public agenda contract for an interactive
  // audit. It never sends notifications or establishes PostgreSQL guarantees.
  const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
  const date = value => typeof value === 'string' && /^20\d{2}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0,10) === value;
  const time = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
  const madridFormatter = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Madrid',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const madridParts = instant => Object.fromEntries(madridFormatter.formatToParts(new Date(instant)).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  const dateKey = instant => { const p=madridParts(instant); return `${p.year}-${p.month}-${p.day}`; };
  const addDays = (day, amount) => new Date(Date.parse(`${day}T00:00:00Z`)+amount*86400000).toISOString().slice(0,10);
  const minutes = value => Number(value.slice(0,2))*60+Number(value.slice(3,5));
  const clockInstant = (day, hour) => {
    if (!date(day) || !time(hour)) return null;
    const base=Date.parse(`${day}T${hour}:00Z`);
    const matches=[60,120].map(offset=>base-offset*60000).filter(instant=>{const p=madridParts(instant);return `${p.year}-${p.month}-${p.day}`===day && `${p.hour}:${p.minute}`===hour;});
    return matches.length===1?matches[0]:null;
  };
  const windowTime = value => typeof value==='string' && /^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value);
  const available = (day,hour) => {
    const instant=clockInstant(day,hour),now=clock();
    if (instant===null || instant<=now || day>addDays(dateKey(now),180)) return false;
    const start=minutes(hour),end=start+30;
    const weekly=dashboard.tables.availability || [],overrides=(dashboard.tables.availability_overrides || []).filter(row=>row.override_date===day);
    if (weekly.some(row=>row.is_active && (!Number.isInteger(row.day_of_week) || row.day_of_week<0 || row.day_of_week>6 || !windowTime(row.start_time) || !windowTime(row.end_time) || minutes(row.end_time)<=minutes(row.start_time))) || overrides.some(row=>typeof row.is_available!=='boolean' || (row.start_time==null)!==(row.end_time==null) || row.start_time!=null && (!windowTime(row.start_time) || !windowTime(row.end_time) || minutes(row.end_time)<=minutes(row.start_time)))) throw new Error('Invalid synthetic agenda');
    if (overrides.some(row=>!row.is_available && (row.start_time==null || start<minutes(row.end_time) && end>minutes(row.start_time)))) return false;
    const weekday=new Date(`${day}T00:00:00Z`).getUTCDay();
    const offered=proposalSlots.has(`${day} ${hour}`) || weekly.some(row=>row.is_active && row.day_of_week===weekday && start>=minutes(row.start_time) && end<=minutes(row.end_time)) || overrides.some(row=>row.is_available && (row.start_time==null?end<=1440:start>=minutes(row.start_time)&&end<=minutes(row.end_time)));
    if (!offered) return false;
    const proposedStart=Date.parse(`${day}T${hour}:00Z`),proposedEnd=proposedStart+3600000;
    return !(dashboard.tables.bookings || []).some(row=>['pending','confirmed'].includes(row.status) && (()=>{const existing=Date.parse(`${row.booked_date}T${row.booked_time.slice(0,5)}:00Z`);return existing<proposedEnd && existing+(row.duration_min+row.buffer_min)*60000>proposedStart;})());
  };
  const exact = (value,keys) => value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).sort().join(',')===keys.slice().sort().join(',');
  const stamp = () => new Date(clock()).toISOString();
  const agendaRpc = (name,body) => {
    if (name==='booking_available') {
      if (!exact(body,['p_date','p_time']) || typeof body.p_date!=='string' || typeof body.p_time!=='string') throw new Error('Invalid synthetic availability query');
      return available(body.p_date,body.p_time);
    }
    if (name==='booking_slots') {
      if (!exact(body,['p_date','p_count']) || !date(body.p_date) || !Number.isInteger(body.p_count) || body.p_count<1 || body.p_count>10) throw new Error('Invalid synthetic slots query');
      const result=[];
      for(let day=0;day<14;day++)for(let half=0;half<48;half++){
        const proposedDay=addDays(body.p_date,day),proposedTime=`${String(Math.floor(half/2)).padStart(2,'0')}:${half%2?'30':'00'}`;
        if(available(proposedDay,proposedTime))result.push({date:proposedDay,time:proposedTime});
        if(result.length>=body.p_count)return result;
      }
      return result;
    }
    if (name==='booking_slots_range') {
      if (!exact(body,['p_start_date','p_end_date']) || !date(body.p_start_date) || !date(body.p_end_date) ||
        body.p_end_date<body.p_start_date || Date.parse(body.p_end_date)-Date.parse(body.p_start_date)>30*86400000) throw new Error('Invalid synthetic calendar query');
      const result=[];
      for(let proposedDay=body.p_start_date;proposedDay<=body.p_end_date;proposedDay=addDays(proposedDay,1))for(let half=0;half<48;half++){
        const proposedTime=`${String(Math.floor(half/2)).padStart(2,'0')}:${half%2?'30':'00'}`;
        if(available(proposedDay,proposedTime))result.push({date:proposedDay,time:proposedTime});
      }
      return result;
    }
    if (name==='booking_create_once' || name==='chat_insert_booking') {
      if (!exact(body,['p_visitor_id','p_expires_at','p_context_version','p_booking']) || !uuid(body.p_visitor_id) || !Number.isSafeInteger(body.p_expires_at) || body.p_expires_at<=clock()/1000 || body.p_expires_at>clock()/1000+2592001 || !Number.isSafeInteger(body.p_context_version) || body.p_context_version<0) throw new Error('Invalid synthetic booking session');
      let context=chat.contextStates.get(body.p_visitor_id);
      if(!context){context={contextVersion:0,expiresAt:body.p_expires_at,cleanupAfter:body.p_expires_at*1000+604800000};chat.contextStates.set(body.p_visitor_id,context);}
      if(context.contextVersion!==body.p_context_version)return {error:'chat_context_changed'};
      const incoming=body.p_booking,allowed=['id','visitor_id','conversation_id','lead_id','booked_date','booked_time','duration_min','buffer_min','meet_url','visitor_email','visitor_phone','visitor_name','notes'];
      if(!incoming || typeof incoming!=='object' || Array.isArray(incoming) || Object.keys(incoming).some(key=>!allowed.includes(key)) || Buffer.byteLength(JSON.stringify(incoming))>4096 || !uuid(incoming.id) || incoming.visitor_id!==body.p_visitor_id || !date(incoming.booked_date) || !time(incoming.booked_time) || incoming.duration_min!==30 || incoming.buffer_min!==30 || [['visitor_name',150],['visitor_phone',64],['visitor_email',254],['notes',1000]].some(([key,max])=>incoming[key]!=null && (typeof incoming[key]!=='string'||incoming[key].length>max)) || incoming.meet_url!=null && (typeof incoming.meet_url!=='string' || incoming.meet_url.length>1024 || incoming.meet_url && !incoming.meet_url.startsWith('https://')))throw new Error('Invalid synthetic booking');
      for(const [key,table]of [['conversation_id','conversations'],['lead_id','leads']])if(incoming[key]!=null && (!uuid(incoming[key]) || !dashboard.tables[table].some(row=>row.id===incoming[key]&&row.visitor_id===body.p_visitor_id)))return {error:'invalid_reference'};
      const existing=dashboard.tables.bookings.find(row=>row.id===incoming.id);
      if(existing){
        if(['visitor_id','booked_date','booked_time','visitor_email','visitor_name','visitor_phone','conversation_id','lead_id'].some(key=>(existing[key]??null)!==(incoming[key]??null)))throw new Error('Synthetic idempotency conflict');
        return {created:false,booking:structuredClone(existing)};
      }
      if(!available(incoming.booked_date,incoming.booked_time))return {created:false,booking:null};
      const row={...incoming,meet_url:incoming.meet_url||'',status:'confirmed',context_version:context.contextVersion,starts_at:new Date(clockInstant(incoming.booked_date,incoming.booked_time)).toISOString(),created_at:stamp(),updated_at:stamp()};
      dashboard.tables.bookings.push(row);
      if(!dashboard.tables.visitors.some(visitor=>visitor.visitor_id===body.p_visitor_id))dashboard.tables.visitors.push({id:randomUUID(),visitor_id:body.p_visitor_id,first_seen:stamp(),last_seen:stamp(),source:'web',page_views:0});
      for(const channel of ['telegram',...(row.visitor_email!=null?['email']:[]),'admin_email'])dashboard.tables.integration_outbox.push({id:randomUUID(),idempotency_key:`booking:${row.id}:${channel==='admin_email'?'admin-email':channel}`,channel:`booking_${channel}`,payload:{},booking_id:row.id,visitor_id:body.p_visitor_id,context_version:null,status:'queued',attempts:0,available_at:stamp(),created_at:stamp(),updated_at:stamp()});
      return {created:true,booking:structuredClone(row)};
    }
    if(name==='booking_owned_action' || name==='booking_admin_status'){
      const admin=name==='booking_admin_status';
      if(!exact(body,admin?['p_id','p_status']:['p_visitor_id','p_booking_id','p_action']) || !uuid(admin?body.p_id:body.p_booking_id) || !admin && !uuid(body.p_visitor_id) || !['cancelled','completed'].includes(body.p_status) && admin || !['get','cancel'].includes(body.p_action) && !admin)throw new Error('Invalid synthetic booking action');
      const row=dashboard.tables.bookings.find(value=>value.id===(admin?body.p_id:body.p_booking_id) && (admin||value.visitor_id===body.p_visitor_id));
      if(!row)return {error:admin?'not_found':'invalid_reference'};
      if(admin||body.p_action==='cancel'&&['pending','confirmed'].includes(row.status)){
        row.status=admin?body.p_status:'cancelled';row.updated_at=stamp();
        for(const job of dashboard.tables.integration_outbox)if(job.booking_id===row.id&&job.status==='queued'){job.status='disabled';job.error_code=admin?'booking_inactive':'booking_cancelled';job.updated_at=stamp();}
      }
      return admin?[structuredClone(row)]:Object.fromEntries(['id','booked_date','booked_time','duration_min','status','meet_url'].map(key=>[key,row[key]]));
    }
    return undefined;
  };
  const metricsRpc = body => {
    if(!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(key=>key!=='p_now') || body.p_now!==undefined && (typeof body.p_now!=='string'||!Number.isFinite(Date.parse(body.p_now))))throw new Error('Invalid synthetic metrics query');
    const now=body.p_now===undefined?clock():Date.parse(body.p_now),today=dateKey(now),month=today.slice(0,7)+'-01',weekday=new Date(`${today}T00:00:00Z`).getUTCDay(),week=addDays(today,-((weekday+6)%7));
    const observed=value=>Number.isFinite(Date.parse(value))&&Date.parse(value)<=now;
    const since=(value,day)=>observed(value)&&dateKey(Date.parse(value))>=day;
    const contact=lead=>Boolean(String(lead.email||'').trim()||String(lead.phone||'').trim());
    const captured=lead=>lead.contact_captured_at||lead.created_at;
    const leads=dashboard.tables.leads.filter(contact),monthly=leads.filter(lead=>since(captured(lead),month));
    const cohort=dashboard.tables.conversations.filter(row=>since(row.created_at,month)),cohortIds=new Set(cohort.map(row=>row.id));
    const allMessages=dashboard.tables.messages.filter(row=>observed(row.created_at)),people=new Set(allMessages.filter(row=>row.role==='user'&&since(row.created_at,today)).map(row=>dashboard.tables.conversations.find(conversation=>conversation.id===row.conversation_id)?.visitor_id).filter(Boolean));
    const perConversation=cohort.map(row=>{const times=allMessages.filter(message=>message.conversation_id===row.id).map(message=>Date.parse(message.created_at));return {messages:times.length,seconds:times.length?(Math.max(...times)-Math.min(...times))/1000:0};});
    const average=key=>perConversation.length?perConversation.reduce((sum,row)=>sum+row[key],0)/perConversation.length:0;
    const leadsByStatus={};for(const lead of monthly)leadsByStatus[lead.status]=(leadsByStatus[lead.status]||0)+1;
    const label=day=>`${day.slice(8,10)}/${day.slice(5,7)}`;
    const rangeCount=(rows,value,start,end)=>rows.filter(row=>observed(value(row))&&dateKey(Date.parse(value(row)))>=start&&dateKey(Date.parse(value(row)))<end).length;
    return {visitorsToday:people.size,leadsThisWeek:leads.filter(lead=>since(captured(lead),week)).length,leadsThisMonth:monthly.length,totalConversations:cohort.length,leadsByStatus,avgMessages:Math.round(average('messages')),avgDurationSec:Math.round(average('seconds')),avgDurationMin:Math.round(average('seconds')/60),conversionRatio:cohort.length?Math.round(100*new Set(monthly.filter(lead=>cohortIds.has(lead.conversation_id)).map(lead=>lead.conversation_id)).size/cohort.length):0,
      leadsPerWeek:Array.from({length:8},(_,index)=>{const start=addDays(week,(index-7)*7);return {week:label(start),leads:rangeCount(leads,captured,start,addDays(start,7))};}),
      visitsPerDay:Array.from({length:14},(_,index)=>{const start=addDays(today,index-13);return {date:label(start),visits:rangeCount(dashboard.tables.conversations,row=>row.created_at,start,addDays(start,1))};}),
      definitions:{timezone:'Europe/Madrid',cohort:'Conversaciones iniciadas en el mes civil hasta ahora; contacto observado en el mismo periodo.',traffic:'No se mide tráfico web. Son chats y contactos conservados.',retention:'Los datos eliminados por retención no se reconstruyen; los gráficos representan datos conservados.'}};
  };
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (request.headers.apikey !== TEST_SERVICE_KEY || request.headers.authorization !== `Bearer ${TEST_SERVICE_KEY}`) {
        response.writeHead(403, { 'Content-Type': 'application/json' }); response.end('{"error":"Synthetic credential rejected"}'); return;
      }
      const chatRequest = url.pathname.startsWith('/rest/v1/rpc/chat_') || /^\/rest\/v1\/(?:visitors|conversations|messages|leads)$/.test(url.pathname) && request.method === 'GET';
      const target = chatRequest ? chat : dashboard;
      const key = chatRequest ? TEST_CHAT_SERVICE_KEY : TEST_SERVICE_KEY;
      const chunks = []; let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 16 * 1024 * 1024) throw new Error('Synthetic request too large'); chunks.push(chunk); }
      const body = Buffer.concat(chunks);
      const rpcName=url.pathname.startsWith('/rest/v1/rpc/')?url.pathname.slice('/rest/v1/rpc/'.length):'';
      if(['dashboard_claim_ai','dashboard_commit_ai','dashboard_ai_result'].includes(rpcName)){
        if(request.method!=='POST'||url.search){response.writeHead(400,{'Content-Type':'application/json'});response.end('{"error":"Invalid synthetic production RPC request"}');return;}
        const json=(value,status=200)=>{response.writeHead(status,{'Content-Type':'application/json'});response.end(JSON.stringify(value));};
        requests.push({method:request.method,path:url.pathname,target:'synthetic-production'});
        if(dashboard.state.unavailable)return json({error:'Synthetic production storage unavailable'},503);
        productionAi({url,body:JSON.parse(body.toString('utf8')||'{}'),json});return;
      }
      if(['booking_available','booking_slots','booking_slots_range','booking_create_once','booking_owned_action','booking_admin_status','chat_insert_booking','dashboard_metrics'].includes(rpcName)){
        if(request.method!=='POST'||url.search){response.writeHead(400,{'Content-Type':'application/json'});response.end('{"error":"Invalid synthetic RPC request"}');return;}
        if(dashboard.state.unavailable || rpcName!=='dashboard_metrics' && chat.state.unavailable){response.writeHead(503,{'Content-Type':'application/json'});response.end('{"error":"Synthetic agenda or metrics storage unavailable"}');return;}
        try{
          const input=JSON.parse(body.toString('utf8')||'{}'),result=rpcName==='dashboard_metrics'?metricsRpc(input):agendaRpc(rpcName,input);
          requests.push({method:request.method,path:url.pathname,target:rpcName==='dashboard_metrics'?'synthetic-metrics':'synthetic-agenda'});
          response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify(result));return;
        }catch{response.writeHead(400,{'Content-Type':'application/json'});response.end('{"error":"Invalid synthetic agenda or metrics request"}');return;}
      }
      const headers = new Headers(Object.entries(request.headers).filter(([name,value]) => typeof value === 'string' && !['host','connection','content-length'].includes(name)));
      headers.set('apikey', key); headers.set('authorization', `Bearer ${key}`);
      const upstream = await fetch(target.origin + url.pathname + url.search, { method: request.method, headers,
        ...(body.length ? { body } : {}), signal: AbortSignal.timeout(15000), redirect: 'error' });
      // Model the v19 withdrawal trigger for this in-memory preview only.
      if (upstream.ok && request.method === 'PATCH' && url.pathname === '/rest/v1/projects') {
        const change = JSON.parse(body.toString('utf8') || '{}');
        const projectId = url.searchParams.get('id')?.replace(/^eq\./, '');
        if (change.is_published === false && projectId) for (const table of ['feed_entries','studio_logs']) {
          for (const entry of dashboard.tables[table] || []) if (entry.project_id === projectId) entry.is_published = false;
        }
      }
      requests.push({ method: request.method, path: url.pathname, target: chatRequest ? 'chat' : 'dashboard' });
      response.writeHead(upstream.status, Object.fromEntries([...upstream.headers].filter(([name]) => !['connection','transfer-encoding','content-length'].includes(name))));
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end('{"error":"Synthetic gateway unavailable"}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, tables: dashboard.tables, requests, dashboard, chat,
    allowedOrigins: [origin, dashboard.origin, chat.origin],
    environment(previewOrigin) { return { ...dashboard.environment(previewOrigin), ...chat.environment(),
      SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
      CHAT_ORIGIN: previewOrigin, CHAT_SESSION_SECRET: chatSessionSecret,
      DASHBOARD_ORIGIN: previewOrigin, SITE_URL: previewOrigin, OPENROUTER_API_KEY: '' }; },
    async close() { await new Promise((resolve,reject) => server.close(error => error ? reject(error) : resolve())); await Promise.all([dashboard.close(),chat.close()]); },
  };
}
