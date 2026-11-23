import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { createDashboardTestFixture, TEST_PASSWORD } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { AstroCookies } = await import(pathToFileURL(path.join(root, 'node_modules/astro/dist/core/cookies/index.js')));
const fixture = await createDashboardTestFixture();
const origin = 'http://localhost:4351';
const guard = installFetchGuard([fixture.origin]);
const vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true }, resolve: { alias: { 'astro:middleware': 'astro/middleware' } }, define: Object.fromEntries(Object.entries({ ...fixture.environment(origin), PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])) });
let assertions = 0, groups = 0, cookie = '';
const eq = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const group = async (name, fn) => { await fn(); console.log(`ok ${++groups} - ${name}`); };
const lead = fixture.tables.leads[0];
const conversation = fixture.tables.conversations[0];
let routes, middleware, library;
async function dispatch(route, { method = 'GET', body, headers = {} } = {}) {
  const request = new Request(new URL(route, origin), { method, headers: { ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json', origin }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const cookies = new AstroCookies(request);
  const context = { request, url: new URL(request.url), cookies, locals: {}, params: {}, clientAddress: '192.0.2.51' };
  const response = await middleware(context, () => routes.get(context.url.pathname)[method](context));
  for (const value of cookies.headers()) response.headers.append('set-cookie', value);
  return response;
}
const endpoint = () => `/api/dashboard/lead-context?lead_id=${lead.id}`;
const message = (role, content, index, conversationId = conversation.id) => ({ id: randomUUID(), conversation_id: conversationId, role, content, created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() });
const context = async () => { const response = await dispatch(endpoint()); eq(response.status, 200); return response.json(); };

try {
  routes = new Map([
    ['/api/dashboard/lead-context', await vite.ssrLoadModule('/src/pages/api/dashboard/lead-context.ts')],
    ['/api/dashboard/auth/login', await vite.ssrLoadModule('/src/pages/api/dashboard/auth/login.ts')],
  ]);
  middleware = (await vite.ssrLoadModule('/src/middleware.ts')).onRequest;
  library = await vite.ssrLoadModule('/src/lib/lead-conversation-context.ts');
  await group('Authentication and a unique lead reference are required', async () => {
    eq((await dispatch(endpoint())).status, 401);
    const login = await dispatch('/api/dashboard/auth/login', { method: 'POST', body: { password: TEST_PASSWORD } });
    eq(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
    for (const route of ['/api/dashboard/lead-context', '/api/dashboard/lead-context?lead_id=invalid', `${endpoint()}&conversation_id=${randomUUID()}`, `${endpoint()}&lead_id=${lead.id}`]) eq((await dispatch(route)).status, 400);
    eq((await dispatch(`/api/dashboard/lead-context?lead_id=${randomUUID()}`)).status, 404);
  });
  await group('Original client messages fill genuine name, project and requested timing, without assistant inventions', async () => {
    lead.name = lead.email; lead.company = null; lead.project_type = null;
    lead.summary = 'An obsolete credential field must not become a project requirement.';
    fixture.tables.messages = [
      message('user', 'Necesito una animación 3D de un producto de chocolates, un vídeo de 30 segundos para Instagram.', 0),
      message('assistant', '¿Tu nombre y email para contactar contigo?', 1),
      message('user', 'Andrés, andres@example.invalid', 2),
      message('assistant', 'Te llamas Marta y necesitas un documental para YouTube. Podemos entregar mañana por 999 EUR.', 3),
      message('user', 'Mi empresa se llama Cacao Norte.', 4),
      message('user', 'Me gustaría tenerla la próxima semana.', 5),
      message('user', TEST_PASSWORD, 6),
    ];
    const before = JSON.stringify(fixture.tables);
    const result = await context();
    eq(result.leadId, lead.id); eq(result.visitorId, lead.visitor_id); eq(result.conversationId, conversation.id); eq(result.source, 'linked');
    eq(result.clientName, 'Andrés'); eq(result.company, 'Cacao Norte'); eq(result.email, lead.email);
    ok(result.projectTitle.includes('Animación 3D')); ok(result.projectTitle.includes('producto')); ok(result.projectTitle.includes('30 s')); ok(result.projectTitle.includes('Instagram'));
    ok(result.brief.includes('chocolates')); ok(result.brief.includes('próxima semana')); eq(result.requestedTiming, 'la próxima semana');
    ok(!result.brief.includes('Marta')); ok(!result.brief.includes('999')); ok(!result.brief.includes(TEST_PASSWORD)); ok(!JSON.stringify(result).includes(TEST_PASSWORD));
    eq(result.totalMessages, 7); eq(result.messages.length, 7); eq(result.truncated, false); eq(JSON.stringify(fixture.tables), before, 'Reading context cannot modify the lead, project or stored messages');
  });
  await group('An explicit client introduction and a short answer to a name question are recognized', async () => {
    lead.name = null; lead.company = null; lead.project_type = null;
    fixture.tables.messages = [message('assistant', '¿Cómo te llamas?', 0), message('user', 'Lucía Fernández', 1), message('assistant', 'El proyecto es un spot para Instagram y tú eres Carlos.', 2)];
    let result = await context(); eq(result.clientName, 'Lucía Fernández'); eq(result.projectTitle, 'Propuesta de proyecto'); ok(!result.brief.includes('Carlos')); ok(!result.projectTitle.includes('Instagram'));
    fixture.tables.messages = [message('user', 'Hola, soy Óscar Ruiz y quiero un videoclip.', 0)];
    result = await context(); eq(result.clientName, 'Óscar Ruiz'); eq(result.projectTitle, 'Videoclip');
    fixture.tables.messages = [message('user', 'Mi correo es otro@example.invalid', 0)];
    result = await context(); eq(result.clientName, ''); eq(result.email, lead.email, 'Canonical contact comes from the linked lead, not a different incidental address');
    fixture.tables.messages = [message('assistant', '¿Para cuándo lo necesitas?', 0), message('user', 'Una semana', 1)];
    result = await context(); eq(result.requestedTiming, 'Una semana');
    fixture.tables.messages = [message('user', 'Lo necesitaría en una semana.', 0)];
    result = await context(); eq(result.requestedTiming, 'en una semana');
    fixture.tables.messages = [message('user', 'Quiero animación 3D para Instagram.', 0), message('user', 'Mejor hagamos animación 2D para YouTube.', 1)];
    result = await context(); ok(result.projectTitle.includes('2D')); ok(result.projectTitle.includes('YouTube')); ok(!result.projectTitle.includes('Instagram'));
  });
  await group('A profession or place of origin is not a personal introduction', async () => {
    lead.name = null; lead.company = null; lead.project_type = null;
    for (const content of ['Hola, soy director creativo y necesito una animación.', 'Soy Director Creativo y necesito una animación.', 'Soy de Madrid y quiero un vídeo.']) {
      fixture.tables.messages = [message('user', content, 0)];
      eq((await context()).clientName, '');
    }
    fixture.tables.messages = [message('user', 'Hola, soy Elena Martín y necesito una animación.', 0)];
    eq((await context()).clientName, 'Elena Martín');
    fixture.tables.messages = [message('user', 'Me llamo elena martín y necesito una animación.', 0)];
    eq((await context()).clientName, 'elena martín');
    fixture.tables.messages = [message('assistant', '¿Cómo te llamas?', 0), message('user', 'elena martín', 1)];
    eq((await context()).clientName, 'elena martín');
  });
  await group('Negated deadlines are not requests and later timing corrections replace earlier ones', async () => {
    for (const content of ['No lo necesito la próxima semana.', 'No tiene que estar en dos semanas.']) {
      fixture.tables.messages = [message('user', content, 0)];
      eq((await context()).requestedTiming, '');
    }
    fixture.tables.messages = [message('user', 'No tengo referencias pero lo quiero en 1 semana.', 0)];
    eq((await context()).requestedTiming, 'en 1 semana');
    fixture.tables.messages = [message('user', 'Lo necesito en 1 semana.', 0), message('user', 'No tengo referencias.', 1)];
    eq((await context()).requestedTiming, 'en 1 semana');
    fixture.tables.messages = [message('user', 'Lo necesito en 1 semana.', 0), message('user', 'No lo necesito la próxima semana; aún no hay fecha.', 1)];
    eq((await context()).requestedTiming, '');
    fixture.tables.messages = [message('user', 'Lo necesito en 1 semana.', 0), message('user', 'No tiene que estar en dos semanas.', 1)];
    eq((await context()).requestedTiming, '');
    fixture.tables.messages = [message('user', 'Lo necesito en 1 semana.', 0), message('user', 'No lo necesito la próxima semana; mejor dentro de tres semanas.', 1)];
    eq((await context()).requestedTiming, 'dentro de tres semanas');
  });
  await group('History beyond the first hundred messages is fetched in chronological pages', async () => {
    fixture.tables.messages = Array.from({ length: 157 }, (_, index) => message(index % 2 ? 'assistant' : 'user', index === 0 ? 'Necesito animación 3D de producto.' : index === 156 ? 'Me gustaría el vídeo de 30 segundos para Instagram la próxima semana.' : index % 2 ? 'Respuesta del estudio.' : 'Gracias.', index));
    const before = fixture.requests.length;
    const result = await context(); eq(result.totalMessages, 157); eq(result.messages.length, 157); eq(result.truncated, false);
    eq(result.messages[0].content, 'Necesito animación 3D de producto.'); ok(result.messages.at(-1).content.includes('Instagram')); ok(result.projectTitle.includes('30 s')); ok(result.projectTitle.includes('Instagram'));
    const pages = fixture.requests.slice(before).filter(row => row.path === '/rest/v1/messages');
    eq(pages.length, 2); eq(pages.map(row => Number(row.query.get('offset'))), [0, 100]);
    ok(pages.every(row => Number(row.query.get('limit')) <= 100));
  });
  await group('Long transcripts retain the original request and latest clarification within strict bounds', async () => {
    fixture.tables.messages = Array.from({ length: 401 }, (_, index) => message(index % 2 ? 'assistant' : 'user', index === 0 ? 'Necesito animación 3D de producto para Instagram.' : index === 400 ? 'La duración sería 30 segundos. Lo necesito en 2 semanas.' : `Detalle ${index}: ${'x'.repeat(5000)}`, index));
    const result = await context(); eq(result.totalMessages, 401); eq(result.messages.length, library.MAX_LEAD_CONTEXT_MESSAGES); eq(result.truncated, true);
    ok(result.messages[0].content.includes('animación 3D')); ok(result.messages.at(-1).content.includes('30 segundos'));
    ok(result.messages.every(row => row.content.length <= library.MAX_LEAD_CONTEXT_MESSAGE_CHARACTERS));
    ok(result.messages.reduce((total, row) => total + row.content.length, 0) <= library.MAX_LEAD_CONTEXT_CHARACTERS);
    ok(result.brief.length <= 5000); ok(result.projectTitle.includes('30 s')); ok(result.requestedTiming.includes('2 semanas'));
    eq(library.redactConversationSecrets('Plazo: próxima semana\npassword: fake-secret\nAlcance: {{alcance}}'), 'Plazo: próxima semana\n[Dato sensible omitido]\nAlcance: {{alcance}}');
    eq(library.redactConversationSecrets('Diseño de una app para gestionar contraseñas.'), 'Diseño de una app para gestionar contraseñas.');
  });
  await group('A linked foreign conversation is rejected without reading or guessing its history', async () => {
    const foreignId = randomUUID();
    fixture.tables.conversations.push({ id: foreignId, visitor_id: randomUUID(), created_at: '2026-10-02T00:00:00Z' });
    fixture.tables.messages.push(message('user', 'Foreign conversation must remain private.', 0, foreignId));
    const originalId = lead.conversation_id; lead.conversation_id = foreignId;
    const before = fixture.requests.length;
    const denied = await dispatch(endpoint());
    eq(denied.status, 409);
    eq(fixture.requests.slice(before).filter(row => row.path === '/rest/v1/messages').length, 0);
    lead.conversation_id = randomUUID(); eq((await dispatch(endpoint())).status, 404); lead.conversation_id = originalId;
  });
  await group('Legacy missing links use only the same visitor and missing history stays empty', async () => {
    const originalId = lead.conversation_id; lead.conversation_id = null;
    const newestId = randomUUID(); fixture.tables.conversations.push({ id: newestId, visitor_id: lead.visitor_id, created_at: '2026-10-01T00:00:00Z' });
    fixture.tables.messages.push(message('user', 'Quiero un documental.', 0, newestId));
    let result = await context(); eq(result.source, 'visitor_latest'); eq(result.conversationId, newestId); eq(result.messages.length, 1); eq(result.messages[0].content, 'Quiero un documental.');
    fixture.tables.messages = fixture.tables.messages.filter(row => row.conversation_id !== newestId);
    result = await context(); eq(result.totalMessages, 0); eq(result.messages.length, 0); eq(result.brief, '');
    fixture.tables.conversations = fixture.tables.conversations.filter(row => row.visitor_id !== lead.visitor_id);
    result = await context(); eq(result.source, 'none'); eq(result.conversationId, null); eq(result.messages.length, 0);
    lead.conversation_id = originalId;
  });
  await group('Storage errors fail visibly and context never calls external providers or writes data', async () => {
    fixture.state.unavailable = true; eq((await dispatch(endpoint())).status, 503); fixture.state.unavailable = false;
    eq(guard.blocked, []);
    ok(fixture.requests.filter(row => row.path !== '/rest/v1/dashboard_sessions' && !row.path.startsWith('/rest/v1/rpc/dashboard_')).every(row => row.method === 'GET'));
  });
  console.log(`PASS lead conversation context: ${groups} groups, ${assertions} assertions; local synthetic records, no external providers.`);
} finally { await vite.close(); await fixture.close(); guard.restore(); }
