import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { AstroCookies } from '../node_modules/astro/dist/core/cookies/index.js';
import { loadChatFirstServices, renderServicesCatalogueSql } from './chat-first-catalogue-fixture.mjs';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { TEST_PASSWORD } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const drafts = await loadChatFirstServices();
const fixture = await createChatFirstPreviewFixture();
const origin = 'http://localhost:4322';
const guard = installFetchGuard(fixture.allowedOrigins);
const environment = fixture.environment(origin);
const vite = await createServer({ root: process.cwd(), configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  resolve: { alias: { 'astro:middleware': 'astro/middleware' } },
  define: Object.fromEntries(Object.entries({ ...environment, PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' })
    .map(([key,value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
let assertions = 0;
const equal = (actual,expected,label) => { assertions++; assert.deepEqual(actual,expected,label); };
const ok = (actual,label) => { assertions++; assert.ok(actual,label); };
const plain = markdown => markdown.replace(/\\([^a-zA-Z0-9\s])/g,'$1');
// These are the existing, explicitly documented local playback concepts in
// docs/UI_HUB_CONVERSACIONAL.md and public/media/README.md, not client cases.
const authorizedDemos = [
  { name:'ORIGEN', slug:'demo-audiovisual', asset:'origen' },
  { name:'PULSE', slug:'demo-pulse', asset:'pulse' },
  { name:'NOCTURNA', slug:'demo-nocturna', asset:'nocturna' },
  { name:'MATERIA', slug:'demo-materia', asset:'materia' },
  { name:'HORIZONTE', slug:'demo-horizonte', asset:'horizonte' },
];
try {
  equal(drafts.length,6,'Six confirmed offerings');
  equal(drafts.every(row => row.is_published === false),true,'Preparation never approves services');
  equal(drafts.map(row => row.slug),['ai-generation','marketing-strategy','content-creation','direction','vfx-post','sound-design'],'Original applicable slugs preserved');
  equal(await readFile(new URL('../supabase/seeds/services-editorial.sql',import.meta.url),'utf8'),renderServicesCatalogueSql(drafts),'Prepared SQL matches canonical editorial data');
  ok(renderServicesCatalogueSql(drafts).includes('ON CONFLICT (slug) DO NOTHING'),'Reapplication preserves existing rows and withdrawal decisions');
  equal(fixture.tables.projects.map(row => ({ title:row.title,slug:row.slug })),
    authorizedDemos.map(row => ({ title:'DEMO · '+row.name,slug:row.slug })),
    'Only the five explicitly authorized local playback concepts are seeded');
  const mediaProvenance = await readFile(new URL('../public/media/README.md',import.meta.url),'utf8');
  ok(mediaProvenance.includes('Only the isolated preview fixture adds the five DEMO projects.'),
    'The five demonstrations are documented as isolated preview data');
  ok(mediaProvenance.includes('They are not full generated') && mediaProvenance.includes('films, client work, commercial deliverables or claimed portfolio results.'),
    'Playback samples explicitly make no real portfolio or deliverable claims');
  const projects = await vite.ssrLoadModule('/src/lib/public-projects.ts');
  const publicDemos = await projects.getPublicProjects();
  equal(publicDemos.map(row => row.slug),authorizedDemos.map(row => row.slug),
    'Public projection contains exactly the authorized local demonstrations');
  for (const demo of authorizedDemos) {
    const stored = fixture.tables.projects.find(row => row.slug === demo.slug);
    const visible = publicDemos.find(row => row.slug === demo.slug);
    equal(stored.client_id,null,demo.name+' has no linked real client');
    equal(stored.is_published,true,demo.name+' is explicitly approved in the isolated preview');
    equal(visible.title,'DEMO · '+demo.name,demo.name+' is visibly labelled as a demonstration');
    equal(visible.type,'Prototipo audiovisual ficticio',demo.name+' is identified as fictional');
    equal(visible.duration,'8 s',demo.name+' advertises its actual short sample duration');
    equal(visible.resolution,'960x540',demo.name+' uses the documented sample resolution');
    equal(visible.thumbnail,'/img/demo-'+demo.asset+'.webp',demo.name+' uses its own local cover');
    equal(visible.video_url,'/media/demo-'+demo.asset+'.mp4',demo.name+' uses its own local playback file');
    ok(visible.public_description.startsWith('DEMO ficticia') && visible.public_description.includes('8 s'),
      demo.name+' publicly describes a fictional eight-second sample');
    ok(visible.case_study.brief.toLowerCase().includes('fictici') && visible.case_study.result.includes('Prototipo sintético de 8 s'),
      demo.name+' Spanish case study describes a synthetic concept');
    ok(visible.case_study_en.brief.toLowerCase().includes('fictional') && visible.case_study_en.result.startsWith('An 8-second synthetic'),
      demo.name+' English case study describes a synthetic concept');
    equal(Object.keys(visible).sort(),[...projects.PUBLIC_PROJECT_FIELDS].sort(),
      demo.name+' public projection exposes no private client details or internal notes');
    equal((await projects.getPublicProjects({slug:demo.slug})).map(row => row.id),[stored.id],
      demo.name+' can be selected directly without substituting another project');
    ok(mediaProvenance.includes('`demo-'+demo.asset+'.mp4`'),demo.name+' media has documented provenance');
    const clip = await readFile(new URL('../public/media/demo-'+demo.asset+'.mp4',import.meta.url));
    ok(clip.length > 1000 && clip.toString('ascii',4,8) === 'ftyp',demo.name+' playback asset is a nonempty MP4');
    const cover = await readFile(new URL('../public/img/demo-'+demo.asset+'.webp',import.meta.url));
    ok(cover.length > 1000 && cover.toString('ascii',0,4) === 'RIFF' && cover.toString('ascii',8,12) === 'WEBP',
      demo.name+' cover asset is a nonempty WebP');
  }
  const withdrawnDemo = fixture.tables.projects.find(row => row.slug === authorizedDemos[0].slug);
  withdrawnDemo.is_published = false;
  equal((await projects.getPublicProjects()).map(row => row.slug),authorizedDemos.slice(1).map(row => row.slug),
    'Withdrawing one demonstration removes only that approved public entry');
  equal(await projects.getPublicProjects({slug:withdrawnDemo.slug}),[],
    'A withdrawn demonstration is unavailable through its direct selector');
  withdrawnDemo.is_published = true;
  const navigation = await vite.ssrLoadModule('/src/lib/chat-navigation.ts');
  const content = await vite.ssrLoadModule('/src/lib/public-content.ts');
  const responses = await vite.ssrLoadModule('/src/lib/predefinedResponses.ts');
  for (const language of ['es','en']) {
    const catalogue = await content.loadPublicServices();
    equal(catalogue.length,6,'Published preview catalogue visible');
    const listing = await responses.resolvePredefinedResponse(navigation.chatIntentMessage('services',language),language);
    for (const service of catalogue) {
      const title = language === 'en' ? service.title_en : service.title;
      ok(plain(listing).includes(title),'Listing contains translated offering: '+title);
      const href = navigation.chatIntentPath('service:'+service.slug,language);
      const intent = navigation.parseChatIntentUrl(href,origin,language);
      equal(intent.intent,'service:'+service.slug,'Each link selects its exact service');
      const response = await responses.resolvePredefinedResponse(intent.message,language);
      const readable = plain(response);
      ok(readable.includes(title),'Each service opens its information in the chat');
      ok(readable.includes(language === 'en' ? service.hero_description_en : service.hero_description),'Service has substantive bilingual details');
      for (const feature of language === 'en' ? service.features_en : service.features) ok(readable.includes(feature.title),'Service feature included');
    }
  }
  const auth = await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');
  const middleware = await vite.ssrLoadModule('/src/middleware.ts');
  const login = await vite.ssrLoadModule('/src/pages/api/dashboard/auth/login.ts');
  const routes = await vite.ssrLoadModule('/src/pages/api/dashboard/services.ts');
  async function dispatch(path,method,body,cookie,csrf) {
    const headers = {origin,'Content-Type':'application/json',...(cookie ? {cookie} : {}),...(csrf ? {'x-dashboard-csrf':csrf} : {})};
    const request = new Request(new URL(path,origin),{method,headers,...(body === undefined ? {} : {body:JSON.stringify(body)})});
    const cookies = new AstroCookies(request);
    const context = {request,url:new URL(request.url),cookies,locals:{},params:{},clientAddress:'192.0.2.25'};
    const response = await middleware.onRequest(context,()=> path === '/api/dashboard/auth/login' ? login.POST(context) : routes[method](context));
    return {response,cookies:[...cookies.headers()]};
  }
  equal((await dispatch('/api/dashboard/services','PATCH',{id:drafts[0].id,is_published:false})).response.status,401,'No administrative bypass in preview');
  const signedIn = await dispatch('/api/dashboard/auth/login','POST',{password:TEST_PASSWORD});
  equal(signedIn.response.status,200,'Normal synthetic administrator password signs in');
  const cookie = signedIn.cookies.find(value => value.startsWith(auth.DASHBOARD_COOKIE+'=')).split(';')[0];
  const session = await auth.getDashboardSession(new Request(origin,{headers:{cookie}}));
  ok(session?.csrfToken,'Normal revocable session and CSRF obtained');
  equal((await dispatch('/api/dashboard/services','PATCH',{id:drafts[0].id,is_published:false},cookie)).response.status,403,'Administrative writes still require CSRF');
  const change = async body => {
    const result = await dispatch('/api/dashboard/services','PATCH',body,cookie,session.csrfToken);
    equal(result.response.status,200,'Administrative service change accepted');
    return result.response.json();
  };
  await change({id:drafts[0].id,is_published:false});
  equal((await content.loadPublicServices()).length,5,'Withdrawal removes service from public catalogue immediately');
  equal(await content.loadPublicServices({slug:drafts[0].slug}),[],'Withdrawn direct selector stays unavailable');
  ok((await responses.resolvePredefinedResponse(navigation.chatIntentMessage('service:'+drafts[0].slug))).includes('no está disponible'),'Withdrawn chat detail does not fall back to JSON');
  await change({id:drafts[0].id,description:'Texto editorial actualizado en la memoria local.'});
  equal(await content.loadPublicServices({slug:drafts[0].slug}),[],'Editing a withdrawn service does not republish it');
  await change({id:drafts[0].id,is_published:true});
  ok((await responses.resolvePredefinedResponse(navigation.chatIntentMessage('service:'+drafts[0].slug))).includes('Texto editorial actualizado'),'Chat reflects administrative edit after explicit approval');
  const created = await dispatch('/api/dashboard/services','POST',{title:'DEMO servicio temporal',description:'Solo prueba de crear, aprobar y eliminar.',icon:'movie'},cookie,session.csrfToken);
  equal(created.response.status,201,'Admin can create a service');
  const newService = await created.response.json();
  equal(newService.is_published,false,'New service starts as draft');
  equal(await content.loadPublicServices({slug:newService.slug}),[],'Created draft stays private');
  await change({id:newService.id,is_published:true});
  equal((await content.loadPublicServices({slug:newService.slug})).length,1,'Explicit approval exposes new service');
  const removed = await dispatch('/api/dashboard/services?id='+newService.id,'DELETE',undefined,cookie,session.csrfToken);
  equal(removed.response.status,200,'Admin can remove a service');
  equal(await content.loadPublicServices({slug:newService.slug}),[],'Removed service never falls back');
  fixture.dashboard.state.unavailable = true;
  ok((await responses.resolvePredefinedResponse(navigation.chatIntentMessage('services'))).includes('no está disponible'),'Store failure exposes no editorial fallback');
  equal(guard.blocked,[],'No remote network or paid provider requests');
  console.log(`PASS editorial catalogue: ${assertions} assertions, six service selections in ES/EN, five authorized fictional playback concepts, normal admin CRUD/session/CSRF/publication, local fixtures only.`);
} finally { await vite.close(); guard.restore(); await fixture.close(); }
