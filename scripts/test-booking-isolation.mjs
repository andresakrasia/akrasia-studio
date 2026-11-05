import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { TEST_CHAT_SECRET, TEST_CHAT_PROVIDER_KEY, TEST_CHAT_SERVICE_KEY } from './chat-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Pure synthetic dependencies. No .env is loaded and every network request is
// blocked, including AI, email, Telegram, availability and real booking stores.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://localhost:4322';
const network = installFetchGuard([]);
const env = {
  CHAT_SESSION_SECRET: TEST_CHAT_SECRET, CHAT_ORIGIN: origin, SUPABASE_URL: 'http://127.0.0.1:1',
  SUPABASE_SERVICE_ROLE_KEY: TEST_CHAT_SERVICE_KEY, OPENROUTER_API_KEY: TEST_CHAT_PROVIDER_KEY,
};
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
async function group(name, run) { await run(); console.log(`ok ${++groups} - ${name}`); }
const date = '2026-10-05';
const convA = '00000000-0000-4000-8000-000000000001';
const convB = '00000000-0000-4000-8000-000000000002';
const missing = '00000000-0000-4000-8000-000000000003';
const body = { booked_date: date, booked_time: '12:00', visitor_email:'synthetic@example.invalid', contextVersion:0 };

try {
  const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const module = await vite.ssrLoadModule('/src/lib/bookings-handler.ts');
  const config = security.readChatConfig(env);
  const now = Date.now();
  const a = security.chatSession(new Request(origin), config, now);
  const b = security.chatSession(new Request(origin), config, now);
  const cookieA = a.cookie.split(';')[0];
  const cookieB = b.cookie.split(';')[0];
  const owners = new Map([[convA, a.id], [convB, b.id]]);
  let clock = now;

  function setup(options = {}) {
    const calls = [];
    const record = (type, value) => calls.push({ type, value });
    const handlers = module.createBookingHandlers({
      config: () => config, now: () => clock,
      quotaStore:{admit:async()=>({allowed:true,reason:null,retryAfter:0}),release:async()=>{}},
      lifecycle:{state:async()=>({contextVersion:0})},
      requireConversation: async (visitorId, id, signal) => {
        signal.throwIfAborted(); record('owner', { visitorId, id });
        if (options.ownerError) throw new Error('Synthetic store outage');
        if (owners.get(id) !== visitorId) throw new security.ChatFailure('invalid_reference', 403);
      },
      availability: async (date, time, signal) => { signal.throwIfAborted(); record('availability', { date, time }); return options.available !== false; },
      slots: async (date, count, signal) => { signal.throwIfAborted(); record('slots', { date, count }); return [{ date, time: '13:00' }]; },
      rangeSlots: async (from, to, signal, now) => {
        signal.throwIfAborted(); record('rangeSlots', { from, to, now });
        if (options.rangeError) throw new Error('Synthetic unavailable calendar');
        return options.rangeEmpty ? [] : Array.from({length:12}, (_,index) => ({date:from,time:`${String(9+Math.floor(index/2)).padStart(2,'0')}:${index%2?'30':'00'}`,visitor_email:'private-marker@example.invalid'}));
      },
      create: async (data, signal) => {
        signal.throwIfAborted(); record('create', data);
        if (options.createError) throw new Error('Synthetic write failure');
        return options.unavailable ? null : { id: missing, booked_date: data.bookedDate, booked_time: data.bookedTime,
          duration_min: 30, status: 'confirmed', meet_url: 'https://example.invalid/synthetic-meeting',
          visitor_id: data.visitorId, visitor_email: 'private-contact@example.invalid', visitor_name: 'Private marker',
          conversation_id: data.conversationId, lead_id: missing, notes: 'Private note marker' };
      },
      notify: async (data, signal) => { signal.throwIfAborted(); record('notify', data); },
    });
    return { calls, ...handlers };
  }

  function request(options = {}) {
    const { method = 'POST', cookie = cookieA, input = body, query = '', headers = {}, signal } = options;
    const outgoing = new Headers({ origin, 'content-type': 'application/json', 'x-booking-request-id':missing, ...headers });
    if (cookie) outgoing.set('cookie', cookie);
    if (headers.origin === null) outgoing.delete('origin');
    return new Request(`${origin}/api/bookings${query}`, { method, headers: outgoing, signal,
      ...(method === 'GET' ? {} : { body: typeof input === 'string' || input instanceof ReadableStream ? input : JSON.stringify(input),
        ...(input instanceof ReadableStream ? { duplex: 'half' } : {}) }),
    });
  }
  async function dispatch(test, options = {}) {
    return test[options.method || 'POST']({ request: request(options) });
  }
  function noEffects(test, ownership = 0) {
    equal(test.calls.filter(call => call.type === 'owner').length, ownership, 'Only explicit ownership checks may run');
    equal(test.calls.filter(call => call.type !== 'owner').length, 0, 'Rejected request performs no availability, bookings or notifications');
  }
  function privateResponse(response) {
    equal(response.headers.get('cache-control'), 'no-store, private');
    equal(response.headers.get('cdn-cache-control'), 'no-store');
    equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
    equal(response.headers.get('x-content-type-options'), 'nosniff');
  }

  await group('Missing and legacy sessions never create an identity or perform work', async () => {
    for (const cookie of [null, `visitor_id=${b.id}`, `akrasia_visitor_id=${b.id}`]) {
      const test = setup();
      const response = await dispatch(test, { cookie, input: { ...body, visitor_id: b.id, conversation_id: convB } });
      equal(response.status, 401); equal(response.headers.get('set-cookie'), null); privateResponse(response); noEffects(test);
    }
  });

  await group('Tampered, duplicate, expired and rotated cookies clear without effects', async () => {
    const rotatedConfig = security.readChatConfig({ ...env, CHAT_SESSION_SECRET: 'cd'.repeat(32) });
    const rotated = security.chatSession(new Request(origin), rotatedConfig, now).cookie.split(';')[0];
    for (const cookie of [cookieA.slice(0, -1) + (cookieA.endsWith('a') ? 'b' : 'a'), `${cookieA}; ${cookieA}`, rotated]) {
      const test = setup(); const response = await dispatch(test, { cookie });
      equal(response.status, 401); ok(response.headers.get('set-cookie')?.includes('Max-Age=0')); privateResponse(response); noEffects(test);
    }
    clock = now + config.sessionSeconds * 1000 + 1000;
    const test = setup(); const response = await dispatch(test);
    equal(response.status, 401); ok(response.headers.get('set-cookie')?.includes('Max-Age=0')); noEffects(test);
    clock = now;
  });

  await group('A cannot choose B by visitor ID, JSON references or query', async () => {
    const test = setup(); const response = await dispatch(test, { input: { ...body, visitor_id: b.id, conversation_id: convB } });
    equal(response.status, 403); privateResponse(response); noEffects(test);
    for (const key of ['visitor_id', 'conversation_id', 'lead_id', 'contact_id', 'booking_id']) {
      const queryTest = setup(); const queryResponse = await dispatch(queryTest, { query: `?${key}=${convB}` });
      equal(queryResponse.status, 403); noEffects(queryTest);
      if (key === 'visitor_id' || key === 'conversation_id') continue;
      const jsonTest = setup(); const jsonResponse = await dispatch(jsonTest, { input: { ...body, [key]: convB } });
      equal(jsonResponse.status, 403); noEffects(jsonTest);
    }
  });

  await group('B conversations and nonexistent conversations fail before availability, booking or notification', async () => {
    for (const conversation_id of [convB, missing]) {
      for (const input of [{ ...body, conversation_id }, { action: 'availability', text: 'el lunes a las 12h', conversation_id }]) {
        const test = setup(); const response = await dispatch(test, { input });
        equal(response.status, 403); noEffects(test, 1);
        equal(test.calls[0].value.visitorId, a.id); equal(test.calls[0].value.id, conversation_id);
      }
    }
  });

  await group('A and B may create bookings attached only to their own identity and conversation', async () => {
    for (const [id, cookie, conversation_id] of [[a.id, cookieA, convA], [b.id, cookieB, convB]]) {
      for (const visitor_id of [undefined, id]) {
        const test = setup(); const response = await dispatch(test, { cookie, input: { ...body, visitor_id, conversation_id } });
        equal(response.status, 200); privateResponse(response); equal(response.headers.get('set-cookie'), null);
        equal(test.calls.map(call => call.type).join(','), 'owner,create');
        equal(test.calls[1].value.visitorId, id); equal(test.calls[1].value.conversationId, conversation_id);
        equal(test.calls.filter(call => call.type === 'notify').length, 0);
        const result = await response.json(); equal(result.success, true);
        equal(Object.keys(result.booking).sort().join(','), 'booked_date,booked_time,duration_min,id,meet_url,status');
        ok(!JSON.stringify(result).includes('Private')); ok(!JSON.stringify(result).includes('private-contact'));
      }
    }
  });

  await group('Legacy cookies cannot select a visitor and renewal cannot recover an old conversation', async () => {
    const legacyTest = setup();
    const legacyResponse = await dispatch(legacyTest, { cookie: `${cookieA}; akrasia_visitor_id=${b.id}; visitor_id=${b.id}` });
    equal(legacyResponse.status, 200); equal(legacyTest.calls[0].value.visitorId, a.id);
    clock = now + config.sessionSeconds * 1000 + 1000;
    const fresh = security.chatSession(new Request(origin), config, clock);
    ok(fresh.id !== a.id);
    const newCookie = fresh.cookie.split(';')[0];
    const test = setup(); const response = await dispatch(test, { cookie: newCookie, input: { ...body, conversation_id: convA } });
    equal(response.status, 403); noEffects(test, 1); equal(test.calls[0].value.visitorId, fresh.id);
    const cleanTest = setup(); equal((await dispatch(cleanTest, { cookie: newCookie })).status, 200);
    equal(cleanTest.calls[0].value.visitorId, fresh.id);
    clock = now;
  });

  await group('Availability validates ownership and only reports time slots', async () => {
    for (const available of [true, false]) {
      const test = setup({ available });
      const response = await dispatch(test, { input: { action: 'availability', text: 'el lunes a las 12h', conversation_id: convA } });
      equal(response.status, 200); privateResponse(response); equal((await response.json()).available, available);
      equal(test.calls[0].type, 'owner'); equal(test.calls[1].type, 'availability');
      equal(test.calls.filter(call => ['create', 'notify'].includes(call.type)).length, 0);
    }
  });

  await group('Invalid origin and cross-site requests never read references or do work', async () => {
    for (const headers of [{ origin: null }, { origin: 'https://example.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
      const test = setup(); const response = await dispatch(test, { headers, input: { ...body, conversation_id: convA } });
      equal(response.status, 403); noEffects(test);
    }
  });

  await group('Malformed JSON, reference syntax and contacts fail before any lookup', async () => {
    for (const input of ['{', 'null', '[]', { ...body, visitor_id: 'legacy-uuid' }, { ...body, conversation_id: 'known&visitor_id=eq.other' },
      { ...body, booked_date: '2026-02-30' }, { ...body, booked_time: '24:01' }, { ...body, visitor_name: 'name\nInjected' },
      { ...body, visitor_email: 'x'.repeat(255) }, { ...body, action: 'cancel' }, { action: 'availability' }]) {
      const test = setup(); const response = await dispatch(test, { input }); equal(response.status, 400); noEffects(test);
    }
    for (const headers of [{ 'content-type': 'text/plain' }, { 'content-encoding': 'gzip' }, { 'content-length': 'invalid' }]) {
      const test = setup(); const response = await dispatch(test, { headers });
      equal(response.status, headers['content-length'] ? 413 : 400); noEffects(test);
    }
  });

  await group('Oversized bodies, declared size and streaming size perform no work', async () => {
    const huge = JSON.stringify({ ...body, ignored: 'x'.repeat(9000) });
    for (const options of [{ input: huge }, { headers: { 'content-length': '9000' } }, {
      input: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(huge)); controller.close(); } }),
    }]) {
      const test = setup(); const response = await dispatch(test, options); equal(response.status, 413); noEffects(test);
    }
  });

  await group('Failed references/store, unavailable slot and cancelled request do not notify', async () => {
    const referenceTest = setup({ ownerError: true });
    equal((await dispatch(referenceTest, { input: { ...body, conversation_id: convA } })).status, 503); noEffects(referenceTest, 1);
    for (const options of [{ unavailable: true }, { createError: true }]) {
      const test = setup(options); const response = await dispatch(test); equal(response.status, options.unavailable ? 409 : 503);
      equal(test.calls.filter(call => call.type === 'notify').length, 0);
    }
    const controller = new AbortController(); controller.abort();
    const test = setup(); equal((await dispatch(test, { signal: controller.signal })).status, 503); noEffects(test);
  });

  await group('Public GET remains anonymous but no supplied reference may reach availability', async () => {
    const test = setup(); const response = await dispatch(test, { method: 'GET', cookie: null, query: `?date=${date}` });
    equal(response.status, 200); privateResponse(response); equal(test.calls[0].type, 'slots'); equal(test.calls[0].value.count, 5);
    equal(response.headers.get('set-cookie'), null);
    const publicResult = await response.json();
    equal(Object.keys(publicResult.available_slots[0]).sort().join(','), 'date,formatted,time');
    equal(publicResult.available_slots[0].date, date);
    for (const key of ['visitor_id', 'conversation_id', 'lead_id', 'contact_id', 'booking_id']) {
      const test = setup(); equal((await dispatch(test, { method: 'GET', cookie: null, query: `?date=${date}&${key}=${convB}` })).status, 403);
      noEffects(test);
    }
    for (const value of ['', '2026-02-30', '2026-10-05&status=neq.cancelled', 'not-a-date']) {
      const test = setup(); equal((await dispatch(test, { method: 'GET', query: `?date=${encodeURIComponent(value)}` })).status, 400); noEffects(test);
    }
  });
  await group('Calendar queries return all times for the requested window without private data or booking effects', async () => {
    for (const query of [`?date_from=${date}&date_to=2026-10-31`, `?date=${date}&mode=day`]) {
      const test=setup(); const response=await dispatch(test,{method:'GET',cookie:null,query});
      equal(response.status,200);privateResponse(response);equal(response.headers.get('set-cookie'),null);
      const result=await response.json();equal(result.time_zone,'Europe/Madrid');equal(result.duration_min,30);equal(result.available_slots.length,12);
      equal(result.available_slots[11].time,'14:30');equal(Object.keys(result.available_slots[0]).sort().join(','),'date,formatted,time');
      ok(!JSON.stringify(result).includes('private-marker'));equal(test.calls.length,1);equal(test.calls[0].type,'rangeSlots');
      equal(test.calls[0].value.from,date);equal(test.calls[0].value.to,query.includes('date_from')?'2026-10-31':date);
      equal(test.calls[0].value.now,clock);
    }
    for (const options of [{rangeEmpty:true},{rangeError:true}]) {
      const test=setup(options);const response=await dispatch(test,{method:'GET',query:`?date=${date}&mode=day`});
      equal(response.status,options.rangeError?503:200);
      const result=await response.json();equal(options.rangeError?result.error:result.available_slots.length,options.rangeError?'booking_unavailable':0);
    }
  });
  await group('Calendar rejects oversized, invalid, ambiguous and reference-bearing queries before any lookup', async () => {
    for (const query of ['?date_from=2026-10-01&date_to=2026-11-01','?date_from=2026-10-05','?date_to=2026-10-05',
      '?date_from=2026-10-06&date_to=2026-10-05','?date_from=2026-02-30&date_to=2026-03-01',
      `?date=${date}&mode=month`,`?date=${date}&mode=day&mode=day`,`?date=${date}&date=${date}`,
      `?date=${date}&date_from=${date}&date_to=${date}`,`?date_from=${date}&date_to=${date}&mode=day`,`?date=${date}&unknown=1`]) {
      const test=setup();equal((await dispatch(test,{method:'GET',query})).status,400);noEffects(test);
    }
    for (const key of ['visitor_id','conversation_id','lead_id','contact_id','booking_id']) {
      const test=setup();equal((await dispatch(test,{method:'GET',query:`?date_from=${date}&date_to=${date}&${key}=${convB}`})).status,403);noEffects(test);
    }
    const controller=new AbortController();controller.abort();const test=setup();
    equal((await dispatch(test,{method:'GET',query:`?date=${date}&mode=day`,signal:controller.signal})).status,503);noEffects(test);
  });
  equal(network.blocked.length, 0, 'Synthetic handlers never attempt outbound network access');
  console.log(`Booking isolation: ${groups} groups, ${assertions} assertions passed. No real integrations contacted.`);
} finally {
  network.restore();
  await vite.close();
}
