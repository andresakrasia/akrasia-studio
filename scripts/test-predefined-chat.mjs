import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Real public loaders and the admitted chat handler, with an intentionally
// untrustworthy localhost REST double. No .env, real AI or integrations.
const privateMarker = 'PRIVATE_CHAT_CATALOGUE_CANARY';
const service = {
  id: randomUUID(), slug: 'creative-direction', title: 'Dirección creativa', description: 'Descripción publicada',
  title_en: 'Creative direction', description_en: 'Published description', icon: 'movie', highlighted: true,
  cta_message: '', cta_message_en: '', tagline: 'Criterio humano', tagline_en: 'Human judgment',
  hero_description: 'Del concepto a la pieza', hero_description_en: 'From concept to the piece',
  features: [{ title: 'Concepto', description: 'Tratamiento visual' }], features_en: [{ title: 'Concept', description: 'Visual treatment' }],
  process: [{ step: '01', title: 'Explorar', description: 'Revisamos la idea' }], process_en: [{ step: '01', title: 'Explore', description: 'We review the idea' }],
  is_published: true, internal_notes: privateMarker,
};
const project = {
  id: randomUUID(), slug: 'public-piece', title: 'Pieza publicada', type: 'Spot', category: 'Film', thumbnail: '',
  video_url: 'https://example.invalid/piece?watch=1', resolution: '4K', aspect: '16:9', duration: '30s',
  public_description: 'Descripción pública del proyecto',
  case_study: { brief: 'Encargo publicado', process: 'Proceso publicado', result: 'Resultado publicado', services: ['Dirección creativa'] },
  case_study_en: { brief: 'Published brief', process: 'Published process', result: 'Published result', services: ['Creative direction'] },
  is_published: true, client_name: privateMarker, tasks: [{ text: privateMarker }],
};
const tables = {
  services: [service, { ...service, id: randomUUID(), slug: 'private-service', title: privateMarker, is_published: false }],
  projects: [project, { ...project, id: randomUUID(), slug: 'private-project', title: privateMarker, is_published: false }],
};
const requests = [];
let unavailable = false;
const server = createHttpServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  requests.push({ method: request.method, path: url.pathname, query: url.searchParams });
  response.setHeader('Content-Type', 'application/json');
  if (unavailable) { response.statusCode = 503; response.end(JSON.stringify({ error: privateMarker })); return; }
  const table = url.pathname.split('/').at(-1);
  if (request.method !== 'GET' || !tables[table]) { response.statusCode = 400; response.end('{}'); return; }
  // Ignore publication/slug filters and return extra private fields on purpose.
  response.end(JSON.stringify(tables[table]));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const fixtureOrigin = `http://127.0.0.1:${server.address().port}`;
const guard = installFetchGuard([fixtureOrigin]);
const env = { SUPABASE_URL: fixtureOrigin, SUPABASE_SERVICE_ROLE_KEY: 'synthetic-public-catalogue-key', DEV: true, PROD: false, SSR: true, MODE: 'test', BASE_URL: '/' };
const vite = await createViteServer({ configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: Object.fromEntries(Object.entries(env).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
let groups = 0, checks = 0;
const ok = (value, message) => { checks++; assert.ok(value, message); };
const eq = (actual, expected, message) => { checks++; assert.equal(actual, expected, message); };
const group = async (name, action) => { await action(); console.log(`ok ${++groups} - ${name}`); };
const honest = output => {
  ok(output && !output.includes(privateMarker), 'No private marker');
  ok(!/\/(?:servicios|proyectos|contacto)(?:[/?#]|\b)/.test(output), 'No conventional content page navigation');
};
try {
  const predefined = await vite.ssrLoadModule('/src/lib/predefinedResponses.ts');
  const handler = await vite.ssrLoadModule('/src/lib/chat-handler.ts');
  const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const resolve = predefined.resolvePredefinedResponse;
  await group('Original and new triggers are synchronous; exploration and direct contact stay in chat', async () => {
    for (const [message, lang] of [
      ['Hola, quiero saber más sobre Akrasia Studio', 'es'], ['Hi, I want to know more about Akrasia Studio', 'en'],
      ['Quiero iniciar un proyecto con vosotros', 'es'], ['I want to start a project with you', 'en'],
      ['Quiero conocer vuestro manifiesto, qué es lo que os define como estudio', 'es'], ['I want to know your manifesto, what defines you as a studio', 'en'],
      ['Quiero conocer vuestros servicios', 'es'], ['I want to know about your services', 'en'],
      ['Quiero ver vuestros proyectos, qué tipo de trabajos hacéis', 'es'], ['I want to see your projects, what kind of work do you do', 'en'],
      ['Quiero contactar con vosotros', 'es'], ['I want to contact you', 'en'],
      ['Me interesa vuestro servicio de dirección creativa', 'es'], ['Tell me about your creative direction service', 'en'],
    ]) { const output = predefined.getPredefinedResponse(message, lang); eq(typeof output, 'string'); honest(output); }
    eq(predefined.getPredefinedResponse('Mensaje libre que requiere conversación'), null);
    const before = requests.length;
    const contact = await resolve('Quiero contactar con vosotros'); honest(contact);
    ok(contact.includes('mailto:info@akrasia.studio') && contact.includes('+34 637 26 40 41'));
    eq(requests.length, before, 'Static intents have no database access');
  });
  await group('Live catalogues expose only public contract and create in-chat detail actions in both languages', async () => {
    for (const [message, lang, title, expectedIntent] of [
      ['Quiero conocer vuestros servicios', 'es', 'Dirección creativa', 'service:creative-direction'],
      ['I want to know about your services', 'en', 'Creative direction', 'service:creative-direction'],
      ['Quiero ver vuestros proyectos, qué tipo de trabajos hacéis', 'es', 'Pieza publicada', 'project:public-piece'],
      ['I want to see your projects, what kind of work do you do', 'en', 'Pieza publicada', 'project:public-piece'],
    ]) {
      const output = await resolve(message, lang); honest(output); ok(output.includes(title));
      const href = /\]\((\/\?[^)]+)\)/.exec(output)?.[1]; ok(href, 'Chat detail link');
      const url = new URL(href, 'https://akrasia.studio'); eq(url.pathname, '/'); eq(url.searchParams.get('chat'), expectedIntent);
      eq(url.searchParams.get('lang'), lang === 'en' ? 'en' : null);
      eq(requests.at(-1).query.get('is_published'), 'eq.true'); ok(!requests.at(-1).query.get('select').includes('internal_notes'));
    }
  });
  await group('Slug details include features/process/case/media; free-form titles and malformed references have no authority', async () => {
    const spanish = await resolve('Quiero información sobre el servicio: creative-direction'); honest(spanish);
    for (const field of ['Descripción publicada', 'Criterio humano', 'Del concepto a la pieza', 'Tratamiento visual', 'Revisamos la idea']) ok(spanish.includes(field));
    eq(requests.at(-1).query.get('slug'), 'eq.creative-direction');
    const english = await resolve('I want information about the service: creative-direction', 'en'); honest(english);
    for (const field of ['Creative direction', 'Published description', 'Visual treatment', 'We review the idea']) ok(english.includes(field));
    const piece = await resolve('I want information about the project: public-piece', 'en'); honest(piece);
    for (const field of ['Published brief', 'Published process', 'Published result', 'Creative direction', 'https://example.invalid/piece?watch=1']) ok(piece.includes(field));
    for (const slug of ['private-project', 'does-not-exist']) { const result = await resolve('Quiero información sobre el proyecto: ' + slug); honest(result); ok(result.includes('no está disponible')); }
    for (const suffix of ['../../private', 'Public Piece', 'x?select=*', 'public-piece\nprivate-service', privateMarker, '']) {
      const before = requests.length;
      const result = await resolve('Quiero información sobre el servicio: ' + suffix); honest(result); ok(result.includes('no está disponible'));
      eq(requests.length, before, 'Invalid slug stops before catalogue access');
    }
    const before = requests.length;
    honest(await resolve('Me interesa vuestro servicio de Private Service')); eq(requests.length, before, 'Title never selects a private record');
  });
  await group('Withdrawal, outages and empty catalogues are honest; translated prose is not fabricated', async () => {
    project.is_published = false;
    const withdrawn = await resolve('Quiero información sobre el proyecto: public-piece'); honest(withdrawn); ok(!withdrawn.includes('Pieza publicada')); ok(withdrawn.includes('no está disponible'));
    const empty = await resolve('Quiero ver vuestros proyectos, qué tipo de trabajos hacéis'); honest(empty); ok(empty.includes('Todavía no hay proyectos')); project.is_published = true;
    unavailable = true;
    for (const message of ['Quiero conocer vuestros servicios', 'Quiero información sobre el proyecto: public-piece']) { const failed = await resolve(message); honest(failed); ok(failed.includes('no está disponible en este momento')); }
    unavailable = false;
    const englishFields = { title_en: service.title_en, description_en: service.description_en, features_en: service.features_en, process_en: service.process_en };
    Object.assign(service, { title_en: '', description_en: '', features_en: [], process_en: [] });
    const original = await resolve('I want information about the service: creative-direction', 'en'); honest(original); ok(original.includes('currently available in Spanish')); ok(original.includes('Tratamiento visual'));
    Object.assign(service, englishFields);
  });
  await group('Large catalogues/editorial text respect output budgets and preserve safe text/links', async () => {
    const originalServices = tables.services;
    tables.services = Array.from({ length: 40 }, (_, index) => ({ ...service, id: randomUUID(), slug: `service-${index}`, title: `Service ${index}`, description: 'A'.repeat(3000) }));
    const output = await resolve('Quiero conocer vuestros servicios'); honest(output); eq((output.match(/Conocer este servicio/g) || []).length, 8); ok(output.includes('primeros 8')); ok(Buffer.byteLength(output) <= 8000);
    tables.services = originalServices;
    const saved = service.hero_description;
    service.hero_description = '[Injected](javascript:alert(1)) ' + '字'.repeat(10000);
    for (const maximum of [16, 128, 500, 8000]) { const limited = await resolve('Quiero información sobre el servicio: creative-direction', 'es', { maxBytes: maximum }); ok(Buffer.byteLength(limited) <= maximum); ok(!limited.includes('\uFFFD')); }
    const escaped = await resolve('Quiero información sobre el servicio: creative-direction', 'es', { maxBytes: 16000 }); ok(!escaped.includes('[Injected]('));
    service.hero_description = saved;
    const aborted = new AbortController(); aborted.abort();
    checks++; await assert.rejects(() => resolve('Quiero conocer vuestros servicios', 'es', { signal: aborted.signal }));
  });
  await group('Actual admitted handler bypasses AI but retains quota/effects; rejected requests cannot query public content', async () => {
    const origin = 'http://localhost:4322';
    const config = security.readChatConfig({ CHAT_SESSION_SECRET: 'ab'.repeat(32), CHAT_ORIGIN: origin, SUPABASE_URL: fixtureOrigin,
      SUPABASE_SERVICE_ROLE_KEY: 'synthetic-public-catalogue-key', OPENROUTER_API_KEY: '' }, false, false);
    const calls = { provider: 0, effects: 0, admission: 0 }; let denied = false;
    const dispatch = handler.createChatHandler({ config: () => config,
      provider: async () => { calls.provider++; throw new Error('No AI permitted'); }, effects: async () => { calls.effects++; },
      store: { admit: async () => { calls.admission++; return denied ? { allowed: false, reason: 'rate', retryAfter: 60 } : { allowed: true, reason: null, retryAfter: 0 }; }, release: async () => {} },
      lifecycle: { state: async () => ({ contextVersion: 0 }), erase: async () => { throw new Error('Unexpected deletion'); } },
      operations: { claim: async () => ({ status: 'claimed' }) }, loadContext: async () => ({ messages: [], visitorName: null, visitorCompany: null }),
    });
    const request = (content, lang = 'es', requestOrigin = origin) => new Request(origin + '/api/chat', { method: 'POST',
      headers: { origin: requestOrigin, 'content-type': 'application/json' },
      body: JSON.stringify({ language: lang, operation_id: randomUUID(), context_version: 0, messages: [{ role: 'user', content }] }),
    });
    for (const [content, lang] of [
      ['Quiero conocer vuestros servicios', 'es'], ['Quiero información sobre el servicio: creative-direction', 'es'],
      ['I want to see your projects, what kind of work do you do', 'en'], ['I want information about the project: public-piece', 'en'],
      ['Quiero contactar con vosotros', 'es'],
    ]) {
      const result = await dispatch({ request: request(content, lang), clientAddress: '192.0.2.7' }); eq(result.status, 200);
      const sse = await result.text(); ok(sse.includes('data: [DONE]')); ok(!sse.includes('"error"')); ok(!sse.includes(privateMarker));
    }
    eq(calls.provider, 0, 'All catalogue/detail/static intents bypass AI even without provider key'); eq(calls.effects, 5); eq(calls.admission, 5);
    const before = requests.length; denied = true;
    eq((await dispatch({ request: request('Quiero conocer vuestros servicios') })).status, 429); eq(requests.length, before);
    denied = false;
    eq((await dispatch({ request: request('Quiero conocer vuestros servicios', 'es', 'https://other.invalid') })).status, 403); eq(requests.length, before);
    eq((await dispatch({ request: request('Consulta libre') })).status, 503); eq(requests.length, before); eq(calls.provider, 0);
  });
  eq(guard.blocked.length, 0, 'No remote request attempted');
  console.log(`PASS: ${groups} predefined-chat groups, ${checks} assertions; only synthetic localhost catalogue requests.`);
} finally {
  await vite.close(); guard.restore(); await new Promise(resolve => server.close(resolve));
}
