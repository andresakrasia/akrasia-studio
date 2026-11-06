import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';
import { createVisitorIsolationFixture } from './visitor-isolation-test-fixture.mjs';

// All visitor records are synthetic. The only allowed fetch origin is this
// local fixture; providers and notifications are never contacted by this test.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://localhost:4322';
const fixture = await createVisitorIsolationFixture();
const network = installFetchGuard([fixture.origin]);
const env = fixture.environment();
const logs = [];
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...values) => logs.push(values.map(String).join(' '));
console.error = (...values) => logs.push(values.map(String).join(' '));
const vite = await createServer({
  root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: Object.fromEntries(Object.entries({ ...env, PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' })
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
let groups = 0;
let assertions = 0;
const equal = (actual, expected, message) => { assertions++; assert.equal(actual, expected, message); };
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const rejects = async (action, message) => { assertions++; await assert.rejects(action, message); };
async function group(name, action) { await action(); groups++; console.log(`ok ${groups} - ${name}`); }

function request(pathname, { method = 'GET', cookie, body, headers = {} } = {}) {
  const outgoing = new Headers({ origin, ...headers });
  if (cookie) outgoing.set('cookie', cookie);
  if (body !== undefined) outgoing.set('content-type', 'application/json');
  return new Request(`${origin}${pathname}`, { method, headers: outgoing, ...(body !== undefined ? { body: JSON.stringify(pathname === "/api/chat" && body && typeof body === "object" ? { operation_id:randomUUID(), language:"es", ...body } : body) } : {}) });
}
function cookieFrom(response) { const cookie = response.headers.get('set-cookie'); ok(cookie, 'Session bootstrap issues cookie'); return cookie.split(';')[0]; }
function privateResponse(response) {
  ok(response.headers.get('cache-control')?.includes('no-store'), 'Private response bypasses browser caches');
  equal(response.headers.get('cdn-cache-control'), 'no-store', 'Private response bypasses CDN caches');
  equal(response.headers.get('vercel-cdn-cache-control'), 'no-store', 'Private response bypasses platform caches');
}
function mutations() { return fixture.requests.filter(value => !['GET'].includes(value.method) && !value.table.startsWith('rpc/')); }
function admissions() { return fixture.requests.filter(value => value.table === 'rpc/chat_admit'); }
function expiryTime(value) { return typeof value === 'number' ? value * (value < 1e12 ? 1000 : 1) : Date.parse(value); }

try {
  const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const handler = await vite.ssrLoadModule('/src/lib/chat-handler.ts');
  const history = await vite.ssrLoadModule('/src/pages/api/visitor-history.ts');
  const database = await vite.ssrLoadModule('/src/lib/supabase.ts');
  const effects = await vite.ssrLoadModule('/src/lib/chat-effects.ts');
  const booking = await vite.ssrLoadModule('/src/lib/bookings.ts');
  const config = security.readChatConfig(env);
  const session = (time = fixture.state.now) => {
    const value = security.chatSession(request('/api/visitor-history'), config, time);
    return { id: value.id, cookie: value.cookie.split(';')[0], expiresAt: value.expiresAt };
  };
  const ownHistory = async (cookie, query = '') => history.GET({ request: request(`/api/visitor-history${query}`, { cookie }) });
  const chat = (options = {}) => {
    const calls = [];
    const work = [];
    const handle = handler.createChatHandler({
      config: () => config, now: () => fixture.state.now,
      provider: async input => { calls.push(input); return (async function* () { yield 'Respuesta simulada segura.'; })(); },
      effects: async input => { work.push(input); if (options.persist) await effects.saveChatEffects(input); },
      ...(options.loadContext ? { loadContext: options.loadContext } : {}),
    });
    return { calls, work, dispatch: (cookie, body = { messages: [{ role: 'user', content: 'Nuevo mensaje neutro.' }] }) =>
      handle({ request: request('/api/chat', { method: 'POST', cookie, body }), clientAddress: '192.0.2.34' }) };
  };
  const complete = async response => { equal(response.status, 200); ok((await response.text()).includes('[DONE]'), 'Admitted chat completes'); privateResponse(response); };

  await group('Session bootstrap isolates unauthenticated UUIDs and old unsigned cookies', async () => {
    fixture.reset();
    const b = session();
    fixture.seed(b.id, 'B');
    for (const query of [`?visitor_id=${b.id}`, `?conversation_id=${randomUUID()}`]) {
      const response = await ownHistory(undefined, query);
      equal(response.status, 403);
      privateResponse(response);
    }
    equal(fixture.requests.length, 0, 'Unsigned identifiers cannot authorize a database lookup');
    const response = await ownHistory(`akrasia_visitor=${b.id}; visitor_id=${b.id}`);
    equal(response.status, 200);
    privateResponse(response);
    const data = await response.json();
    const cookie = cookieFrom(response);
    ok(cookie.includes('akrasia_chat='));
    ok(data.sessionId && data.sessionId !== b.id, 'Old UUID is not linked to a newly minted identity');
    ok(expiryTime(data.sessionExpiresAt) > Date.now(), 'Client receives session lifetime without cookie credentials');
    equal(data.conversations.length, 0);
    equal(data.visitorName, null);
    ok(fixture.requests.every(row => row.table === 'rpc/chat_context_state'), 'Fresh anonymous bootstrap persists only minimal generation metadata, never reads historical rows');
  });

  await group('A and B read only their own minimized history and profile', async () => {
    fixture.reset();
    const a = session(); const b = session();
    fixture.seed(a.id, 'A'); fixture.seed(b.id, 'B');
    for (const [current, label, foreign] of [[a, 'A', 'B'], [b, 'B', 'A']]) {
      const response = await ownHistory(`${current.cookie}; visitor_id=${label === 'A' ? b.id : a.id}`, `?visitor_id=${current.id}`);
      equal(response.status, 200); privateResponse(response);
      const data = await response.json();
      equal(data.sessionId, current.id);
      equal(data.visitorName, `${label}-name-private`);
      equal(data.visitorCompany, `${label}-company-private`);
      ok(JSON.stringify(data).includes(`${label}-history-private`));
      // csrfToken is random base64url and may contain e.g. "B-" by chance; it carries no visitor data.
      ok(!JSON.stringify({ ...data, csrfToken: undefined }).includes(`${foreign}-`), 'Other visitor data never crosses the response');
      ok(!JSON.stringify(data).includes('synthetic.invalid'), 'History excludes contact address');
      ok(!JSON.stringify(data).includes('internal-'), 'History excludes database metadata and notes');
      for (const conversation of data.conversations) {
        equal(Object.keys(conversation).sort().join(','), 'created_at,id,messages');
        for (const message of conversation.messages) equal(Object.keys(message).sort().join(','), 'content,role');
      }
    }
    const before = fixture.requests.length;
    equal((await ownHistory(a.cookie, `?visitor_id=${b.id}`)).status, 403);
    equal((await ownHistory(a.cookie, `?visitor_id=${b.id}&visitor_id=${a.id}`)).status, 403);
    equal((await ownHistory(a.cookie, `?conversation_id=${fixture.tables.conversations[1].id}`)).status, 403);
    equal(fixture.requests.length, before, 'Forbidden URL references stop before querying data');
    equal(mutations().length, 0, 'Reading private history never modifies existing records');
  });

  await group('Malformed, duplicate and expired sessions fail before reads; renewal cannot claim the old history', async () => {
    fixture.reset();
    const expired = session(fixture.state.now - (config.sessionSeconds + 10) * 1000);
    fixture.seed(expired.id, 'Expired');
    const a = session();
    const token = a.cookie.slice(a.cookie.indexOf('=') + 1);
    for (const cookie of ['akrasia_chat=fabricated', `${a.cookie}; ${a.cookie}`, `akrasia_chat=${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, expired.cookie]) {
      const response = await ownHistory(cookie);
      equal(response.status, 401); privateResponse(response);
      ok(response.headers.get('set-cookie')?.includes('Max-Age=0'), 'Invalid credential is explicitly cleared');
      const test = chat();
      equal((await test.dispatch(cookie)).status, 401);
      equal(test.calls.length, 0); equal(test.work.length, 0);
    }
    equal(fixture.requests.length, 0, 'Untrusted sessions produce no data/quota lookup');
    const renewed = await ownHistory();
    const data = await renewed.json();
    equal(renewed.status, 200); ok(data.sessionId !== expired.id);
    equal(data.conversations.length, 0);
    const before = fixture.requests.length;
    equal((await ownHistory(cookieFrom(renewed), `?visitor_id=${expired.id}`)).status, 403);
    equal(fixture.requests.length, before, 'Renewal requires proof beyond the previous UUID');
  });

  await group('JSON identity and record references cannot bypass the signed chat owner', async () => {
    fixture.reset();
    const a = session(); const b = session();
    const own = fixture.seed(a.id, 'A'); const foreign = fixture.seed(b.id, 'B');
    const test = chat();
    const base = { messages: [{ role: 'user', content: 'Solicitud neutra.' }] };
    for (const extra of [{ visitor_id: b.id }, { visitor_id: randomUUID() }, { visitor_id: 'malformed' },
      { conversation_id: foreign.conversation.id }, { conversation_id: own.conversation.id }, { conversation_id: randomUUID() },
      { lead_id: foreign.lead.id }, { contact_id: foreign.lead.id }, { booking_id: randomUUID() }]) {
      const before = fixture.requests.length;
      const response = await test.dispatch(a.cookie, { ...base, ...extra });
      equal(response.status, 403); privateResponse(response);
      equal(fixture.requests.length, before, 'Rejected record selection occurs before quota or business reads');
      equal(test.calls.length, 0); equal(test.work.length, 0);
    }
    const before = fixture.requests.length;
    equal((await test.dispatch(undefined, { ...base, visitor_id: b.id })).status, 403);
    equal(fixture.requests.length, before, 'Fresh anonymous session cannot claim a UUID from JSON');
    equal(mutations().length, 0);
    await complete(await test.dispatch(a.cookie, { ...base, visitor_id: a.id }));
    equal(test.work[0].visitorId, a.id, 'Compatibility ID never replaces the signed identity');
  });

  await group('AI context is loaded from A after quota and ignores all browser personal context', async () => {
    fixture.reset();
    const a = session(); const b = session();
    fixture.seed(a.id, 'A'); fixture.seed(b.id, 'B');
    const test = chat();
    await complete(await test.dispatch(`${a.cookie}; akrasia_visitor=${b.id}`, {
      messages: [{ role: 'user', content: 'B-browser-forged-history' }, { role: 'assistant', content: 'B-browser-forged-reply' }, { role: 'user', content: 'Último mensaje válido.' }],
      visitor_history: 'B-history-private', visitor_name: 'B-name-private', visitor_company: 'B-company-private',
    }));
    const messages = test.calls[0].messages;
    const content = JSON.stringify(messages);
    ok(content.includes('A-history-private'), 'Provider gets A stored conversation');
    ok(content.includes('A-name-private')); ok(content.includes('A-company-private'));
    ok(!content.includes('B-'), 'B rows and forged browser context never reach provider');
    equal(messages[messages.length - 1].content, 'Último mensaje válido.');
    equal(test.work[0].visitorId, a.id);
    ok(!JSON.stringify(test.work[0].messages).includes('B-browser-'), 'Forged browser history cannot become stored/contact context');
    const firstRead = fixture.requests.findIndex(value => value.method === 'GET');
    const admission = fixture.requests.findIndex(value => value.table === 'rpc/chat_admit');
    ok(admission >= 0 && firstRead > admission, 'Private context is not queried until quota permits the request');
    ok(!JSON.stringify(admissions()[0].body).includes('A-history-private'), 'Quota ledger contains reservation units, never private context');
  });

  await group('Denied admission and failed history store stop context, provider and effects', async () => {
    fixture.reset();
    const a = session(); fixture.seed(a.id, 'A');
    const test = chat();
    fixture.state.denied = true;
    const response = await test.dispatch(a.cookie);
    equal(response.status, 429); privateResponse(response);
    equal(fixture.requests.filter(value => value.method === 'GET').length, 0);
    equal(test.calls.length, 0); equal(test.work.length, 0);
    fixture.state.denied = false;
    fixture.state.errorText = 'A-history-private A-name-private a@synthetic.invalid';
    for (const table of ['conversations', 'messages', 'leads']) {
      fixture.state.failTable = table;
      const unavailable = await test.dispatch(a.cookie);
      equal(unavailable.status, 503, `Unavailable ${table} fails closed`); privateResponse(unavailable);
      equal(test.calls.length, 0); equal(test.work.length, 0);
      const read = await ownHistory(a.cookie);
      equal(read.status, 503); privateResponse(read);
    }
    fixture.state.failTable = null;
    for (const table of ['conversations', 'messages', 'leads']) {
      fixture.state.malformedTable = table;
      equal((await test.dispatch(a.cookie)).status, 503);
      equal((await ownHistory(a.cookie)).status, 503);
    }
    fixture.state.malformedTable = null;
    fixture.seed(session().id, 'B');
    fixture.state.ignoredOwnerTable = 'conversations';
    equal((await test.dispatch(a.cookie)).status, 503, 'Even a store response violating scoped ownership is refused');
    equal((await ownHistory(a.cookie)).status, 503);
    equal(test.calls.length, 0); equal(test.work.length, 0); equal(mutations().length, 0);
  });

  await group('Server history is bounded before private response and AI context', async () => {
    fixture.reset();
    const a = session(); const data = fixture.seed(a.id, 'A');
    for (let index = 0; index < 200; index++) fixture.tables.messages.push({ id: randomUUID(), conversation_id: data.conversation.id,
      role: index % 2 ? 'assistant' : 'user', content: `A-bounded-${index}-` + 'x'.repeat(config.maxMessageChars), created_at: new Date(fixture.state.now + index).toISOString() });
    const response = await ownHistory(a.cookie); equal(response.status, 200);
    const result = await response.json();
    const returned = result.conversations.flatMap(value => value.messages);
    ok(returned.length <= config.maxMessages, 'Private history has an overall message bound');
    ok(returned.reduce((sum, value) => sum + Buffer.byteLength(value.content), 0) <= config.maxHistoryBytes, 'Private history has an overall byte bound');
    ok(returned.every(value => value.content.length <= config.maxMessageChars));
    const test = chat();
    await complete(await test.dispatch(a.cookie));
    const messages = test.calls[0].messages;
    ok(messages.filter(value => value.role !== 'system').length <= config.maxMessages + 1, 'Stored context and current message remain bounded');
    const units = messages.reduce((sum, value) => sum + Buffer.byteLength(value.content) + 16, 256);
    ok(units <= config.maxInputUnits, 'Provider context never exceeds A02 total budget');
    ok(admissions().at(-1).body.p_input_units >= units + config.maxOutputTokens, 'Admission conservatively reserves provider context and output');
  });

  await group('Own chat persists under A, and helper writes reject B or nonexistent references', async () => {
    fixture.reset();
    const a = session(); const b = session();
    const own = fixture.seed(a.id, 'A'); const foreign = fixture.seed(b.id, 'B');
    const foreignBefore = JSON.stringify({ conversation: foreign.conversation, lead: foreign.lead, messages: fixture.tables.messages.filter(row => row.conversation_id === foreign.conversation.id) });
    const test = chat({ persist: true });
    await complete(await test.dispatch(a.cookie));
    ok(fixture.tables.messages.some(row => row.conversation_id === own.conversation.id && row.content === 'Nuevo mensaje neutro.'));
    await database.upsertLead(a.id, own.conversation.id, { name: 'A updated synthetic name', company: 'A updated synthetic company', email: 'a-updated@synthetic.invalid' });
    equal(own.lead.name, 'A updated synthetic name');
    await database.updateLeadStatus(a.id, 'hot'); equal(own.lead.status, 'hot');
    for (const id of [foreign.conversation.id, randomUUID()]) {
      const before = mutations().length;
      await rejects(() => database.saveMessage(a.id, id, 'user', 'Forbidden synthetic message'));
      await rejects(() => database.upsertLead(a.id, id, { email: 'attacker@synthetic.invalid' }));
      equal(mutations().length, before, 'Foreign or nonexistent conversation causes no write');
    }
    fixture.state.ignoredOwnerTable = 'conversations';
    const writesBefore = mutations().length;
    await rejects(() => database.saveMessage(a.id, foreign.conversation.id, 'user', 'Foreign row returned by broken store'));
    await rejects(() => database.upsertLead(a.id, foreign.conversation.id, { name: 'Do not modify B' }));
    equal(mutations().length, writesBefore, 'Returned foreign owner cannot authorize helper writes');
    fixture.state.ignoredOwnerTable = null;
    equal(JSON.stringify({ conversation: foreign.conversation, lead: foreign.lead, messages: fixture.tables.messages.filter(row => row.conversation_id === foreign.conversation.id) }), foreignBefore, 'B conversation, contact and messages remain unchanged');
    for (const value of mutations().filter(value => value.method === 'PATCH' && ['conversations', 'leads'].includes(value.table))) {
      equal(value.query.get('visitor_id'), `eq.${a.id}`, 'Mutations scope ID and signed visitor together');
    }
  });

  await group('Booking helpers reject cross-owner links before availability or reservation effects', async () => {
    fixture.reset();
    const a = session(); const b = session();
    const own = fixture.seed(a.id, 'A'); const foreign = fixture.seed(b.id, 'B');
    const base = { visitorId: a.id, contextVersion: 0, sessionExpiresAt: a.expiresAt, bookedDate: '2030-01-07', bookedTime: '10:00', visitorEmail: 'a@synthetic.invalid' };
    for (const references of [{ conversationId: foreign.conversation.id }, { conversationId: randomUUID() },
      { conversationId: own.conversation.id, leadId: foreign.lead.id }, { leadId: randomUUID() }]) {
      const before = fixture.requests.length;
      await rejects(() => booking.createBooking({ ...base, ...references }));
      ok(fixture.requests.slice(before).every(value => value.table === 'rpc/booking_create_once' && value.body.p_visitor_id === a.id), 'Reference validation is part of the atomic server-owned reservation RPC');
      equal(fixture.tables.bookings.length, 0); equal(mutations().length, 0);
    }
    fixture.tables.availability.push({ id: randomUUID(), day_of_week: new Date(`${base.bookedDate}T00:00:00`).getDay(), start_time: '09:00', end_time: '18:00', is_active: true });
    const result = await booking.createBooking({ ...base, conversationId: own.conversation.id, leadId: own.lead.id });
    ok(result); equal(fixture.tables.bookings.length, 1);
    equal(fixture.tables.bookings[0].visitor_id, a.id);
    equal(fixture.tables.bookings[0].conversation_id, own.conversation.id);
    equal(fixture.tables.bookings[0].lead_id, own.lead.id);
  });

  await group('Null or malformed mutation representations fail before follow-up effects', async () => {
    fixture.reset();
    const a = session(); const own = fixture.seed(a.id, 'A');
    for (const value of [null, { malformed: true }, []]) {
      fixture.state.invalidWriteValue = value;
      fixture.state.invalidWriteTable = 'visitors';
      await rejects(() => database.upsertVisitor(a.id));
      fixture.state.invalidWriteTable = 'messages';
      const before = fixture.requests.length;
      await rejects(() => database.saveMessage(a.id, own.conversation.id, 'user', 'Failed synthetic representation'));
      ok(!fixture.requests.slice(before).some(row => row.table === 'conversations' && row.method === 'PATCH'), 'Failed message write cannot initiate a later conversation mutation');
      fixture.state.invalidWriteTable = 'leads';
      await rejects(() => database.upsertLead(a.id, own.conversation.id, { email: 'a-updated@synthetic.invalid' }));
      await rejects(() => database.updateLeadStatus(a.id, 'hot'));
    }
    fixture.state.invalidWriteTable = 'visitors'; fixture.state.invalidWriteValue = null;
    const test = chat({ persist: true });
    const before = fixture.requests.length;
    const response = await test.dispatch(a.cookie);
    equal(response.status, 200);
    const body = await response.text();
    ok(body.includes('chat_unavailable')); ok(!body.includes('[DONE]'), 'Incomplete persistence cannot report successful stream completion');
    ok(!fixture.requests.slice(before).some(row => row.method !== 'GET' && !row.table.startsWith('rpc/') && row.table !== 'visitors'), 'Failed first mutation stops subsequent business effects');
  });

  await group('Returned booking rows preserve owner references and get a unique Jitsi room by default', async () => {
    fixture.reset(); const a=session(), b=session(); const own=fixture.seed(a.id,'A'), foreign=fixture.seed(b.id,'B');
    const base={visitorId:a.id,contextVersion:0,sessionExpiresAt:a.expiresAt,conversationId:own.conversation.id,leadId:own.lead.id,
      bookedDate:'2030-01-07',bookedTime:'10:00',visitorEmail:'a@synthetic.invalid'};
    for(const malformed of [() => [], () => ({malformed:true}), row=>({...row,id:'invalid-uuid'}),
      row=>({...row,visitor_id:b.id}),row=>({...row,conversation_id:foreign.conversation.id}),row=>({...row,lead_id:foreign.lead.id}),
      row=>({...row,conversation_id:null}),row=>({...row,lead_id:null}),row=>({...row,meet_url:null})]) {
      fixture.state.bookingRepresentation=malformed;
      const before=fixture.requests.length; await rejects(()=>booking.createBooking(base));
      equal(fixture.tables.bookings.length,0,'Malformed representations do not trigger another write');
      ok(!fixture.requests.slice(before).some(row=>row.method==='PATCH'),'No URL repair or follow-up write is attempted');
    }
    fixture.state.bookingRepresentation=null;
    const result=await booking.createBooking(base);ok(result);equal(result.visitor_id,a.id);
    ok(/^https:\/\/meet\.jit\.si\/Akrasia-[0-9a-f-]{36}$/.test(result.meet_url),'Without an explicit meeting URL, each booking gets its own Jitsi room');
  });

  await group('Tests contacted only the local fixture and never logged visitor secrets', async () => {
    equal(network.blocked.length, 0, 'No paid provider, email, Telegram or deployed database access was attempted');
    for (const marker of ['A-history-private', 'B-history-private', 'A-name-private', 'B-name-private', 'synthetic.invalid', 'internal-contact-secret']) ok(!logs.join('\n').includes(marker), 'Server logs contain no personal response/body data');
  });

  console.log(`Visitor isolation: ${groups} groups, ${assertions} assertions passed. Synthetic application tests only; SQL/RLS remains a separate deployment check.`);
} finally {
  console.warn = originalWarn; console.error = originalError;
  network.restore();
  await vite.close();
  await fixture.close();
}
