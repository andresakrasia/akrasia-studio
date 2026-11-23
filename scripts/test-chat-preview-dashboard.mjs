import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { TEST_PASSWORD, TEST_SERVICE_KEY } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Exercise the same gateway used by the interactive chat preview, rather than
// the standalone admin double. No .env, remote provider or real customer data.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { AstroCookies } = await import(pathToFileURL(path.join(root, 'node_modules/astro/dist/core/cookies/index.js')));
const origin = 'http://localhost:4322';
let now = Date.UTC(2026, 9, 3, 12);
const fixture = await createChatFirstPreviewFixture({ clock: () => now });
const network = installFetchGuard(fixture.allowedOrigins);
const env = fixture.environment(origin);
const vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  resolve: { alias: { 'astro:middleware': 'astro/middleware' } },
  define: Object.fromEntries(Object.entries({ ...env, PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' })
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
let assertions = 0, groups = 0, cookie = '', csrf = '';
const equal = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { assertions++; assert.ok(value, message); };
async function group(title, test) { await test(); console.log(`ok ${++groups} - ${title}`); }
const routes = new Map();
let middleware;

function request(route, { method = 'GET', body, headers = {}, session = cookie } = {}) {
  return new Request(new URL(route, origin), { method,
    headers: { ...(session ? { cookie: session } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(method === 'GET' ? {} : { origin, 'x-dashboard-csrf': csrf }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function dispatch(route, options) {
  const req = request(route, options);
  const cookies = new AstroCookies(req);
  const context = { request: req, url: new URL(req.url), cookies, locals: {}, params: {}, clientAddress: '192.0.2.42' };
  const response = await middleware(context, () => routes.get(context.url.pathname)[req.method](context));
  for (const value of cookies.headers()) response.headers.append('set-cookie', value);
  return response;
}
async function rpc(name, body, key = TEST_SERVICE_KEY) {
  const response = await fetch(`${fixture.origin}/rest/v1/rpc/${name}`, { method: 'POST', redirect: 'error',
    headers: { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  equal(response.status, 200, `Preview RPC ${name}`);
  return response.json();
}
async function saveTurn(visitor, turn, lead = null) {
  const operation = { p_visitor_id: visitor, p_expires_at: Math.floor(now / 1000) + 86400, p_context_version: 0,
    p_operation_id: randomUUID(), p_request_hash: createHash('sha256').update(`${visitor}:${turn}`).digest('hex') };
  equal(await rpc('chat_claim_turn', operation), { status: 'claimed' });
  const pair = [{ role: 'user', content: `${visitor}: consulta ${turn}` }, { role: 'assistant', content: `${visitor}: respuesta ${turn}` }];
  const result = await rpc('chat_save_turn', { ...operation, p_user_content: pair[0].content,
    p_assistant_content: pair[1].content, p_lead: lead, p_action: null });
  equal(result, { saved: true, contextVersion: 0, replayed: false });
  const stored = fixture.tables.messages.slice(-2);
  equal(stored.map(row => row.role), ['user', 'assistant']);
  equal(stored[0].created_at, stored[1].created_at);
  // Deliberately reverse UUID order relative to role order. A timestamp+ID
  // sort alone must not put the assistant's answer before the user's message.
  const index = fixture.tables.messages.length / 2;
  stored[0].id = `ffffffff-ffff-4fff-8fff-${String(index).padStart(12, '0')}`;
  stored[1].id = `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
  Object.assign(fixture.tables.chat_turn_operations.find(row => row.operation_id === operation.p_operation_id),
    { user_message_id: stored[0].id, assistant_message_id: stored[1].id });
  now += 1000;
  return pair;
}
async function list(route, expectedTotal, expectedLength, nextOffset) {
  const response = await dispatch(route);
  equal(response.status, 200, route);
  equal(response.headers.get('x-total-count'), String(expectedTotal), `${route} total count`);
  equal(response.headers.get('x-next-offset'), nextOffset === null ? '' : String(nextOffset));
  ok(response.headers.get('cache-control').includes('no-store'));
  const rows = await response.json();
  equal(rows.length, expectedLength, `${route} page length`);
  return rows;
}
async function rawRead(table, query, count = true) {
  return fetch(`${fixture.origin}/rest/v1/${table}?${query}`, { redirect: 'error', headers: {
    apikey: TEST_SERVICE_KEY, authorization: `Bearer ${TEST_SERVICE_KEY}`, ...(count ? { prefer: 'count=exact' } : {}),
  } });
}

try {
  for (const name of ['visitors', 'leads', 'conversations', 'auth/login']) {
    routes.set(`/api/dashboard/${name}`, await vite.ssrLoadModule(`/src/pages/api/dashboard/${name}.ts`));
  }
  middleware = (await vite.ssrLoadModule('/src/middleware.ts')).onRequest;
  const auth = await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');

  await group('Preview admin requires the normal login and gateway service authorization', async () => {
    const before = fixture.requests.length;
    for (const name of ['visitors', 'leads', 'conversations']) {
      equal((await dispatch(`/api/dashboard/${name}`, { session: '' })).status, 401);
      equal((await dispatch(`/api/dashboard/${name}`, { session: 'akrasia_admin=invalid' })).status, 401);
    }
    equal(fixture.requests.length, before, 'Unauthenticated reads cannot reach data storage');
    const rejected = await fetch(`${fixture.origin}/rest/v1/visitors?select=*`, {
      headers: { apikey: 'rejected-synthetic-key', authorization: 'Bearer rejected-synthetic-key' }, redirect: 'error' });
    equal(rejected.status, 403);
    const wrongOrigin = await dispatch('/api/dashboard/auth/login', { method: 'POST', body: { password: TEST_PASSWORD },
      headers: { origin: 'https://invalid.example' } });
    equal(wrongOrigin.status, 403);
    const login = await dispatch('/api/dashboard/auth/login', { method: 'POST', body: { password: TEST_PASSWORD } });
    equal(login.status, 200);
    cookie = login.headers.get('set-cookie').split(';')[0];
    ok(cookie.startsWith('akrasia_admin='));
    csrf = (await auth.getDashboardSession(request('/api/dashboard/visitors'))).csrfToken;
    ok(csrf.length > 0);
  });

  await group('Empty chat preview lists are successful with exact zero totals', async () => {
    for (const table of ['visitors', 'leads', 'conversations']) {
      equal(await list(`/api/dashboard/${table}`, 0, 0, null), []);
      const response = await rawRead(table, 'select=*&limit=50&offset=0');
      equal(response.status, 200);
      equal(response.headers.get('content-range')?.split('/')[1], '0');
      equal(await response.json(), []);
    }
  });

  const owner = randomUUID(), other = randomUUID();
  const firstSeen = new Date(now).toISOString();
  const primaryMessages = [];
  const contact = { email: 'primary@example.invalid', phone: null, name: 'Primary synthetic contact', company: 'Primary synthetic company',
    project_type: 'Synthetic film', budget_mentioned: null, interest_score: 45, interest_level: 'warm' };
  const secondContact = { ...contact, email: 'other@example.invalid', name: 'Other synthetic contact', company: 'Other synthetic company' };

  await group('Chat RPC commits become visible as a visitor, contact and chronological conversation', async () => {
    primaryMessages.push(...await saveTurn(owner, 1, contact));
    await saveTurn(other, 1, secondContact);
    const visitors = await list('/api/dashboard/visitors', 2, 2, null);
    const visitor = visitors.find(row => row.visitor_id === owner);
    ok(visitor);
    equal(visitor.first_seen, firstSeen);
    equal(visitor.last_seen, firstSeen);
    equal(visitor.source, 'web');
    const leads = await list('/api/dashboard/leads', 2, 2, null);
    const lead = leads.find(row => row.visitor_id === owner);
    equal(lead.email, contact.email);
    equal(lead.status, 'new');
    equal(lead.tags, []);
    const [conversation] = await list(`/api/dashboard/conversations?visitor_id=${owner}`, 1, 1, null);
    equal(conversation.visitor_id, owner);
    equal(conversation.message_count, 2);
    equal(conversation.messages.map(({ role, content }) => ({ role, content })), primaryMessages);
    equal(conversation.messages_next_offset, null);
    equal(lead.conversation_id, conversation.id);
    ok(!JSON.stringify(conversation).includes(other), 'A visitor filter must not mix another visitor history');
    ok(fixture.requests.some(row => row.path === '/rest/v1/conversations' && row.target === 'chat'));
    ok(fixture.requests.some(row => row.path === '/rest/v1/messages' && row.target === 'chat'));
  });

  await group('Lead search and status changes use the same shared chat records', async () => {
    const [lead] = await list('/api/dashboard/leads?search=primary%40example.invalid&status=new', 1, 1, null);
    equal(lead.visitor_id, owner);
    equal((await dispatch('/api/dashboard/leads', { method: 'PATCH', body: { id: lead.id, status: 'qualified' } })).status, 200);
    equal(fixture.tables.leads.find(row => row.id === lead.id).status, 'qualified');
    const [updated] = await list('/api/dashboard/leads?search=Primary%20synthetic%20company&status=qualified', 1, 1, null);
    equal(updated.id, lead.id);
    equal(await list('/api/dashboard/leads?search=primary%40example.invalid&status=new', 0, 0, null), []);
    const [otherLead] = await list('/api/dashboard/leads?search=other%40example.invalid&status=new', 1, 1, null);
    equal(otherLead.visitor_id, other);
    ok(fixture.requests.some(row => row.method === 'PATCH' && row.path === '/rest/v1/leads' && row.target === 'dashboard'));
  });

  await group('More than fifty visitors and conversations paginate without losing rows or exact totals', async () => {
    for (let index = 0; index < 51; index++) await saveTurn(randomUUID(), 1);
    for (const table of ['visitors', 'conversations']) {
      const ids = new Set();
      for (const offset of [0, 50]) {
        const rows = await list(`/api/dashboard/${table}?offset=${offset}`, 53, offset === 0 ? 50 : 3, offset === 0 ? 50 : null);
        for (const row of rows) { ok(!ids.has(row.id), 'Pages must not duplicate records'); ids.add(row.id); }
      }
      equal(ids.size, 53);
      equal(await list(`/api/dashboard/${table}?offset=53`, 53, 0, null), []);
      const response = await rawRead(table, 'select=id&limit=50&offset=1000');
      equal(response.status, 200);
      equal(response.headers.get('content-range')?.split('/')[1], '53');
      equal(await response.json(), []);
    }
  });

  await group('More than one hundred messages retain complete pages, visitor isolation and role order on timestamp ties', async () => {
    for (let turn = 2; turn <= 57; turn++) primaryMessages.push(...await saveTurn(owner, turn));
    const [conversation] = await list(`/api/dashboard/conversations?visitor_id=${owner}`, 1, 1, null);
    equal(conversation.message_count, 114);
    equal(conversation.messages.length, 100);
    equal(conversation.messages_next_offset, 100);
    equal(conversation.messages.map(({ role, content }) => ({ role, content })), primaryMessages.slice(-100));
    const seen = new Set(), chronological = [];
    for (const offset of [0, 100]) {
      const [page] = await list(`/api/dashboard/conversations?visitor_id=${owner}&conversation_id=${conversation.id}&messages_offset=${offset}`, 1, 1, null);
      equal(page.message_count, 114);
      equal(page.messages.length, offset === 0 ? 100 : 14);
      equal(page.messages_next_offset, offset === 0 ? 100 : null);
      for (const message of page.messages) { ok(!seen.has(message.id)); seen.add(message.id); }
      chronological.unshift(...page.messages.map(({ role, content }) => ({ role, content })));
    }
    equal(seen.size, 114);
    equal(chronological, primaryMessages);
    const [empty] = await list(`/api/dashboard/conversations?conversation_id=${conversation.id}&messages_offset=1000`, 1, 1, null);
    equal(empty.message_count, 114);
    equal(empty.messages, []);
    equal(empty.messages_next_offset, null);
    const [otherConversation] = await list(`/api/dashboard/conversations?visitor_id=${other}`, 1, 1, null);
    equal(otherConversation.message_count, 2);
    ok(otherConversation.messages.every(row => row.content.startsWith(`${other}:`)));
    equal(await list(`/api/dashboard/conversations?visitor_id=${other}&conversation_id=${conversation.id}`, 0, 0, null), []);
    const visitor = (await list('/api/dashboard/visitors', 53, 50, 50)).find(row => row.visitor_id === owner);
    ok(visitor, 'The recently active visitor remains on the first page');
    equal(visitor.first_seen, firstSeen);
    equal(visitor.last_seen, new Date(now - 1000).toISOString());
    const reads = fixture.chat.requests.filter(row => row.path === '/rest/v1/messages');
    ok(reads.some(row => row.query.get('order') === 'created_at.desc,role.asc,id.desc'));
  });

  await group('Authenticated reads and mutations reject cross-site, duplicate-cookie and invalid CSRF requests', async () => {
    const lead = fixture.tables.leads.find(row => row.visitor_id === owner);
    const before = JSON.stringify(fixture.tables.leads);
    for (const options of [{ headers: { 'sec-fetch-site': 'cross-site' } }, { session: `${cookie}; ${cookie}` }]) {
      const start = fixture.requests.length;
      const response = await dispatch('/api/dashboard/leads', options);
      equal(response.status, options.session ? 401 : 403);
      ok(fixture.requests.slice(start).every(row => row.path === '/rest/v1/dashboard_sessions'));
    }
    for (const headers of [{ 'x-dashboard-csrf': 'invalid' }, { origin: 'https://invalid.example' }]) {
      const start = fixture.requests.length;
      equal((await dispatch('/api/dashboard/leads', { method: 'PATCH', headers, body: { id: lead.id, status: 'lost' } })).status, 403);
      ok(fixture.requests.slice(start).every(row => row.path === '/rest/v1/dashboard_sessions'));
    }
    equal(JSON.stringify(fixture.tables.leads), before);
    equal((await dispatch('/api/dashboard/conversations?visitor_id=invalid%2Cfilter')).status, 400);
    equal((await dispatch('/api/dashboard/conversations?messages_offset=100')).status, 400);
  });

  equal(network.blocked, []);
  console.log(`PASS chat preview/admin: ${groups} groups, ${assertions} assertions; no remote requests.`);
} finally {
  await vite.close();
  await fixture.close();
  network.restore();
}
