import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createChatTestFixture, TEST_CHAT_SECRET, TEST_CHAT_PROVIDER_KEY } from './chat-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// No .env is loaded. All admission requests go to a synthetic local RPC server;
// every provider response and business effect is simulated. No paid AI, email,
// Telegram, booking or deployed database is contacted by this script.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://localhost:4322';
const fixture = await createChatTestFixture();
const network = installFetchGuard([fixture.origin]);
const applications = [];
const warnings = [];
const originalWarn = console.warn;
const originalError = console.error;
const originalVercel = process.env.VERCEL;
delete process.env.VERCEL;
console.warn = (...values) => warnings.push(values.map(String).join(' '));
console.error = (...values) => warnings.push(values.map(String).join(' '));
let groups = 0;
let assertions = 0;

const equal = (actual, expected, message) => { assertions++; assert.equal(actual, expected, message); };
const ok = (actual, message) => { assertions++; assert.ok(actual, message); };
const rejects = async (action, message) => { assertions++; await assert.rejects(action, message); };
async function group(name, test) { await test(); groups++; console.log(`ok ${groups} - ${name}`); }

async function loadApplication(production = false, overrides = {}) {
  const env = { ...fixture.environment(), ...overrides };
  const vite = await createServer({
    root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
    define: Object.fromEntries(Object.entries({ ...env, PROD: production, DEV: !production, SSR: true, MODE: 'test', BASE_URL: '/' })
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
  });
  applications.push(vite);
  const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const handler = await vite.ssrLoadModule('/src/lib/chat-handler.ts');
  return { vite, security, handler, env };
}

function setup(app, changes = {}, options = {}) {
  const config = app.security.readChatConfig({ ...app.env, ...changes });
  const calls = [];
  const effects = [];
  const provider = options.provider || (async () => (async function* () { yield 'Respuesta sintética '; yield 'sin IA.'; })());
  const handle = app.handler.createChatHandler({
    config: () => config,
    operations: options.operations || { claim: async () => ({ status: "claimed" }) },
    now: () => fixture.state.now,
    provider: async input => { calls.push(input); return provider(input); },
    effects: async input => { effects.push(input); if (options.effects) return options.effects(input); },
    ...(options.store ? { store: options.store } : {}),
  });
  return { config, calls, effects, handle };
}

function request(options = {}) {
  const { method = 'POST', body = { messages: [{ role: 'user', content: 'Mensaje sintético.' }] }, headers = {}, cookie,
    signal, contentType = 'application/json', ...rest } = options;
  const outgoing = new Headers({ origin, ...headers });
  if (contentType) outgoing.set('content-type', contentType);
  if (cookie) outgoing.set('cookie', cookie);
  return new Request(`${origin}/api/chat`, { method, headers: outgoing, signal, ...rest,
    ...(body === undefined || method === 'GET' || method === 'HEAD' ? {} : { body: typeof body === 'string' || body instanceof ReadableStream ? body : JSON.stringify(body && typeof body === "object" && !Array.isArray(body) ? { operation_id: randomUUID(), language: "es", ...body } : body) }),
  });
}
async function dispatch(test, options = {}) {
  const req = request(options);
  return test.handle({ request: req, clientAddress: options.clientAddress || '192.0.2.7' });
}
function cookieFrom(response) {
  const header = response.headers.get('set-cookie');
  ok(header, 'Server emits a chat session cookie');
  return header.split(';')[0];
}
async function success(test, options = {}) {
  const response = await dispatch(test, options);
  equal(response.status, 200);
  const content = await response.text();
  ok(content.includes('data: [DONE]'), 'Complete provider response terminates the event stream');
  return response;
}
function totals(test) { return { provider: test.calls.length, effects: test.effects.length, store: fixture.requests.length }; }
function noWork(test, before) {
  equal(test.calls.length, before.provider, 'Blocked request never reaches provider');
  equal(test.effects.length, before.effects, 'Blocked request never writes/notifies/books');
}
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const aborted = signal => new Promise((_, reject) => {
  if (signal.aborted) reject(signal.reason || new Error('Aborted synthetic operation'));
  else signal.addEventListener('abort', () => reject(signal.reason || new Error('Aborted synthetic operation')), { once: true });
});
async function readFailure(response) {
  try { return await response.text(); } catch { return ''; }
}
function fakeProviderStream(content = 'Respuesta del proveedor sintético.', terminal = true) {
  const chunks = [`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`];
  if (terminal) chunks.push(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n');
  return new Response(chunks.join(''), { headers: { 'content-type': 'text/event-stream' } });
}

try {
  const app = await loadApplication();
  const other = await loadApplication();

  await group('Normal anonymous chat streams and receives a signed, HttpOnly server session', async () => {
    fixture.reset();
    const test = setup(app);
    const response = await success(test);
    const header = response.headers.get('set-cookie');
    ok(header.includes('HttpOnly'));
    ok(/SameSite=(Lax|Strict)/i.test(header));
    ok(header.includes('Path=/'));
    ok(!header.includes('Domain='));
    ok(header.startsWith('akrasia_chat='));
    equal(test.calls.length, 1);
    equal(test.effects.length, 1);
    equal(fixture.leases.size, 0, 'Successful call releases concurrency lease');
    const admission = fixture.requests.find(value => value.path.endsWith('/chat_admit')).body;
    ok(/^[a-f0-9]{64}$/.test(admission.p_session_key));
    ok(/^[a-f0-9]{64}$/.test(admission.p_ip_key));
    ok(!JSON.stringify(admission).includes(cookieFrom(response)), 'RPC receives hashes rather than cookie credentials');
    ok(admission.p_input_units > 500, 'Input and output reservations include provider system instructions');
    equal(response.headers.get('cache-control'), 'no-store, private');
  });

  await group('Absent or changed visitor_id cannot reset a retained server session quota', async () => {
    fixture.reset();
    const test = setup(app, { CHAT_SESSION_REQUESTS: '3', CHAT_IP_REQUESTS: '10' });
    const first = await success(test);
    const cookie = cookieFrom(first);
    for (const visitorId of ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002']) {
      const before = totals(test);
      equal((await dispatch(test, { cookie, body: { visitor_id: visitorId, messages: [{ role: 'user', content: 'UUID ajeno.' }] } })).status, 403);
      equal(fixture.requests.length, before.store, 'Foreign UUID stops before quota admission');
      noWork(test, before);
    }
    await success(test, { cookie, body: { messages: [{ role: 'user', content: 'Segundo mensaje.' }] } });
    await success(test, { cookie, body: { messages: [{ role: 'user', content: 'Tercer mensaje.' }] } });
    const before = totals(test);
    const limited = await dispatch(test, { cookie, clientAddress: '192.0.2.99' });
    equal(limited.status, 429);
    ok(Number(limited.headers.get('retry-after')) > 0);
    noWork(test, before);
    const keys = fixture.requests.filter(value => value.path.endsWith('/chat_admit')).map(value => value.body.p_session_key);
    equal(new Set(keys).size, 1);
    equal(new Set(test.effects.map(value => value.visitorId)).size, 1, 'Client visitor IDs never become the server session identity');
  });

  await group('Fresh sessions, omitted IDs and spoofed forwarding headers still consume one IP quota', async () => {
    fixture.reset();
    const test = setup(app, { CHAT_IP_REQUESTS: '3' });
    for (let index = 0; index < 3; index++) await success(test, { headers: { 'x-forwarded-for': `192.0.2.${index}`, 'x-real-ip': `192.0.2.${index}`, 'x-vercel-forwarded-for': `192.0.2.${index}` } });
    const before = totals(test);
    for (let index = 0; index < 25; index++) {
      const storeBefore = fixture.requests.length;
      equal((await dispatch(test, { headers: { 'x-forwarded-for': `198.51.100.${index}` }, body: { visitor_id: `client-selected-${index}`, messages: [{ role: 'user', content: 'Abuso sintético.' }] } })).status, 403);
      equal(fixture.requests.length, storeBefore, 'Unsigned identity cannot consume or reset an IP ledger');
      const response = await dispatch(test, { headers: { 'x-forwarded-for': `198.51.100.${index}` }, body: { messages: [{ role: 'user', content: 'Abuso sintético.' }] } });
      equal(response.status, 429);
      ok(response.headers.get('set-cookie'), 'Quota denied fresh requests retain their new session identity');
    }
    noWork(test, before);
    equal(new Set(fixture.requests.filter(value => value.path.endsWith('/chat_admit')).map(value => value.body.p_ip_key)).size, 1);
  });

  await group('Original 25-request bypass is closed with default quotas even when every cookie is discarded', async () => {
    fixture.reset();
    const test = setup(app);
    let accepted = 0;
    let limited = 0;
    for (let index = 0; index < 25; index++) {
      const response = await dispatch(test);
      if (response.status === 200) { accepted++; ok((await response.text()).includes('[DONE]')); }
      else { equal(response.status, 429); limited++; }
    }
    equal(accepted, 20);
    equal(limited, 5);
    equal(test.calls.length, 20);
    equal(test.effects.length, 20);
    equal(fixture.buckets.get('global').requests, 20);
  });

  await group('Tampered, forged, duplicate, expired and rotated-secret cookies fail before admission', async () => {
    fixture.reset();
    const test = setup(app);
    const cookie = cookieFrom(await success(test));
    const before = totals(test);
    const name = cookie.slice(0, cookie.indexOf('='));
    const token = cookie.slice(cookie.indexOf('=') + 1);
    for (const attack of [`${name}=fabricated`, `${cookie}; ${cookie}`, `${name}=${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`, `${name}=${token}%00`, `${name}=00000000-0000-4000-8000-000000000001.9999999999.${'A'.repeat(43)}`]) {
      const response = await dispatch(test, { cookie: attack });
      equal(response.status, 401);
      ok(/Max-Age=0/i.test(response.headers.get('set-cookie') || ''));
    }
    const rotated = setup(other, { CHAT_SESSION_SECRET: 'cd'.repeat(32) });
    equal((await dispatch(rotated, { cookie })).status, 401);
    equal(rotated.calls.length, 0);
    equal(rotated.effects.length, 0);
    fixture.advance(test.config.sessionSeconds * 1000 + 1);
    equal((await dispatch(test, { cookie })).status, 401);
    equal(fixture.requests.length, before.store, 'Invalid cookies made no admission request');
    noWork(test, before);
  });

  await group('Global request quota protects multiple IPs and sessions and expires at its window', async () => {
    fixture.reset();
    const test = setup(app, { CHAT_GLOBAL_REQUESTS: '3' });
    for (let index = 1; index <= 3; index++) await success(test, { clientAddress: `192.0.2.${index}` });
    const before = totals(test);
    equal((await dispatch(test, { clientAddress: '192.0.2.100' })).status, 429);
    noWork(test, before);
    const until = fixture.buckets.get('global').until;
    fixture.advance(until - fixture.state.now - 1);
    equal((await dispatch(test, { clientAddress: '192.0.2.100' })).status, 429);
    fixture.advance(1);
    await success(test, { clientAddress: '192.0.2.100' });
    equal(fixture.buckets.get('global').requests, 1);
  });

  await group('Session/IP windows expire and successful release never refunds request reservations', async () => {
    fixture.reset();
    const test = setup(app, { CHAT_SESSION_REQUESTS: '1', CHAT_IP_REQUESTS: '1' });
    const cookie = cookieFrom(await success(test));
    equal((await dispatch(test, { cookie })).status, 429);
    equal(fixture.leases.size, 0);
    const until = fixture.buckets.get('ip:' + fixture.requests[0].body.p_ip_key).until;
    fixture.advance(until - fixture.state.now);
    await success(test, { cookie });
    equal(fixture.buckets.get('global').requests, 2);
  });

  await group('Global input/output reservation quota rejects before provider or side effects', async () => {
    fixture.reset();
    const test = setup(app);
    await success(test);
    const reserved = fixture.buckets.get('global').units;
    test.config.policy.global_units = reserved * 2 - 1;
    const before = totals(test);
    equal((await dispatch(test, { clientAddress: '192.0.2.99' })).status, 429);
    noWork(test, before);
    equal(fixture.buckets.get('global').units, reserved);
    fixture.advance(fixture.buckets.get('global').until - fixture.state.now);
    await success(test, { clientAddress: '192.0.2.99' });
  });

  await group('Concurrent requests from separate application instances share session, IP and global leases', async () => {
    for (const scope of ['session', 'ip', 'global']) {
      fixture.reset();
      const gate = deferred();
      const changes = scope === 'session' ? {} : scope === 'ip' ? { CHAT_IP_CONCURRENCY: '1' } : { CHAT_GLOBAL_CONCURRENCY: '1' };
      const initial = setup(app, changes);
      const cookie = cookieFrom(await success(initial));
      const held = setup(app, changes, { provider: async () => (async function* () { yield 'Inicio '; await gate.promise; yield 'fin.'; })() });
      const blocked = setup(other, changes);
      const response = await dispatch(held, { cookie });
      equal(response.status, 200);
      const read = response.text();
      // Fresh cookies/IPs can evade narrower scopes, but never the target lease.
      const second = await dispatch(blocked, scope === 'session' ? { cookie, clientAddress: '192.0.2.99' } : scope === 'ip' ? {} : { clientAddress: '192.0.2.99' });
      equal(second.status, 429, `${scope} concurrency is shared across modules`);
      equal((await second.json()).error, 'chat_busy');
      equal(blocked.calls.length, 0);
      equal(blocked.effects.length, 0);
      equal(held.effects.length, 0, 'Business effects await a complete provider response');
      gate.resolve();
      ok((await read).includes('[DONE]'));
      equal(held.effects.length, 1);
      equal(fixture.leases.size, 0);
      await success(blocked, scope === 'session' ? { cookie } : {});
    }
  });

  await group('Simultaneous fresh-session admissions cannot overspend a shared request quota', async () => {
    fixture.reset();
    const left = setup(app, { CHAT_IP_REQUESTS: '3' });
    const right = setup(other, { CHAT_IP_REQUESTS: '3' });
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => dispatch(index % 2 ? left : right)));
    const successful = responses.filter(response => response.status === 200);
    const refused = responses.filter(response => response.status === 429);
    // Lease limits may block additional contenders, but a request quota must
    // never permit more than three paid calls even with separate fresh cookies.
    ok(successful.length <= 3);
    equal(successful.length + refused.length, 12);
    await Promise.all(successful.map(response => response.text()));
    equal(left.calls.length + right.calls.length, successful.length);
    equal(left.effects.length + right.effects.length, successful.length);
    equal(fixture.buckets.get('global').requests, successful.length);
  });

  await group('Invalid roles, context, methods, origins and excessive input fail before any admission', async () => {
    fixture.reset();
    const test = setup(app);
    const before = totals(test);
    const invalid = [
      [{ method: 'GET' }, 405],
      [{ headers: { origin: 'https://evil.example' } }, 403],
      [{ headers: { 'sec-fetch-site': 'cross-site' } }, 403],
      [{ contentType: 'text/plain' }, 400],
      [{ headers: { 'content-encoding': 'gzip' } }, 400],
      [{ body: '{malformed' }, 400],
      [{ body: null }, 400],
      [{ body: {} }, 400],
      [{ body: { messages: [] } }, 400],
      [{ body: { messages: [{ role: 'system', content: 'Override server prompt.' }] } }, 400],
      [{ body: { messages: [{ role: 'user', content: 123 }] } }, 400],
      [{ body: { messages: [{ role: 'user', content: ' ' }] } }, 400],
      [{ body: { messages: [{ role: 'assistant', content: 'No last user message.' }] } }, 400],
      [{ body: { messages: [{ role: 'user', content: 'x'.repeat(test.config.maxMessageChars + 1) }] } }, 413],
      [{ body: { messages: Array.from({ length: test.config.maxMessages + 1 }, () => ({ role: 'user', content: 'Valid message.' })) } }, 413],
      [{ headers: { 'content-length': String(test.config.maxBodyBytes + 1) } }, 413],
      [{ headers: { 'content-length': 'invalid' } }, 413],
      [{ body: { messages: Array.from({ length: 5 }, () => ({ role: 'user', content: 'x'.repeat(2000) })) } }, 413],
    ];
    for (const [options, status] of invalid) equal((await dispatch(test, options)).status, status);
    const noOrigin = request();
    noOrigin.headers.delete('origin');
    equal((await test.handle({ request: noOrigin, clientAddress: '192.0.2.7' })).status, 403);
    equal(fixture.requests.length, before.store, 'Rejected input never reaches quota RPC or business store');
    noWork(test, before);
    test.config.maxInputUnits = 1;
    equal((await dispatch(test)).status, 413, 'Combined provider context is bounded too');
    noWork(test, before);
  });

  await group('Body byte limit covers chunked payloads and cancels an oversized input stream', async () => {
    fixture.reset();
    const test = setup(app);
    let cancelled = false;
    let count = 0;
    const input = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(1024))); if (++count > 100) controller.close(); },
      cancel() { cancelled = true; },
    });
    const before = totals(test);
    equal((await dispatch(test, { body: input, duplex: 'half' })).status, 413);
    ok(cancelled, 'Oversized body reader stops receiving data');
    equal(fixture.requests.length, before.store);
    noWork(test, before);
    const invalidUtf8 = new ReadableStream({ start(controller) { controller.enqueue(Uint8Array.of(0xff)); controller.close(); } });
    equal((await dispatch(test, { body: invalidUtf8, duplex: 'half' })).status, 400);
    equal(fixture.requests.length, before.store);
    noWork(test, before);
  });

  await group('Unavailable or malformed persistent quota responses fail closed', async () => {
    fixture.reset();
    const test = setup(app);
    fixture.state.unavailable = true;
    equal((await dispatch(test)).status, 503);
    fixture.state.unavailable = false;
    for (const value of [{ allowed: true, reason: 'rate', retry_after: 0 }, { allowed: 'true', reason: null, retry_after: 0 },
      { allowed: true, reason: null, retry_after: 1 }, { allowed: false, reason: 'rate', retry_after: 0 },
      { allowed: false, reason: 'unknown', retry_after: 10 }, { allowed: false, reason: 'busy', retry_after: 1.5 }, []]) {
      fixture.state.malformed = value;
      equal((await dispatch(test)).status, 503);
    }
    equal(test.calls.length, 0);
    equal(test.effects.length, 0);
    equal(fixture.buckets.size, 0);
    fixture.state.malformed = null;
    await success(test);
  });

  await group('Store deadline failure never invokes AI, and release failure retains the lease', async () => {
    fixture.reset();
    const hanging = setup(app, {}, { store: { admit: async (_config, _session, _ip, _lease, _units, signal) => aborted(signal), release: async () => {} } });
    hanging.config.providerTimeoutMs = 100;
    const before = totals(hanging);
    const response = await dispatch(hanging);
    ok([503, 504].includes(response.status));
    noWork(hanging, before);
    fixture.reset();
    const releaseFailed = setup(app);
    fixture.state.releaseUnavailable = true;
    const cookie = cookieFrom(await success(releaseFailed));
    equal(fixture.leases.size, 1);
    const limitedBefore = totals(releaseFailed);
    equal((await dispatch(releaseFailed, { cookie })).status, 429);
    noWork(releaseFailed, limitedBefore);
    fixture.state.releaseUnavailable = false;
    fixture.advance(releaseFailed.config.policy.lease_seconds * 1000);
    await success(releaseFailed, { cookie });
    equal(fixture.leases.size, 0);
  });

  await group('Persistent RPC adapter applies its own deadline independently of provider duration', async () => {
    fixture.reset();
    const test = setup(app);
    test.config.storeTimeoutMs = 100;
    const savedFetch = globalThis.fetch;
    let observedSignal;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === `${fixture.origin}/rest/v1/rpc/chat_admit`) { observedSignal = init.signal; return aborted(init.signal); }
      return savedFetch(input, init);
    };
    try {
      const began = Date.now();
      equal((await dispatch(test)).status, 503);
      ok(Date.now() - began < 1500);
      ok(observedSignal.aborted);
      equal(test.calls.length, 0);
      equal(test.effects.length, 0);
    } finally { globalThis.fetch = savedFetch; }
  });

  await group('Already aborted requests and slow body streams stop before any admission', async () => {
    fixture.reset();
    const test = setup(app);
    const abort = new AbortController();
    abort.abort(new Error('Synthetic visitor disconnect'));
    const before = totals(test);
    equal((await dispatch(test, { signal: abort.signal })).status, 503);
    noWork(test, before);
    equal(fixture.requests.length, before.store);
    let cancelled = false;
    const body = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } });
    test.config.providerTimeoutMs = 100;
    equal((await dispatch(test, { body, duplex: 'half' })).status, 504);
    ok(cancelled);
    noWork(test, before);
    equal(fixture.requests.length, before.store);
  });

  await group('Provider opening failure/timeout conserves reservations and performs no business effects', async () => {
    for (const failure of ['reject', 'timeout']) {
      fixture.reset();
      const test = setup(app, {}, { provider: async ({ signal }) => {
        if (failure === 'reject') throw new Error('Synthetic provider failure contains no credentials');
        await aborted(signal);
      } });
      test.config.providerTimeoutMs = 100;
      const response = await dispatch(test);
      equal(response.status, failure === 'timeout' ? 504 : 503);
      const body = await response.json();
      equal(body.error, failure === 'timeout' ? 'chat_timeout' : 'chat_unavailable');
      equal(test.calls.length, 1);
      equal(test.effects.length, 0);
      equal(fixture.buckets.get('global').requests, 1, 'Failed opening does not refund reserved requests');
      equal(fixture.leases.size, 1, 'Uncertain provider lifecycle remains limited until lease expiry');
      const cookie = cookieFrom(response);
      equal((await dispatch(test, { cookie })).status, 429);
      equal(test.calls.length, 1);
    }
  });

  await group('Streaming timeout and disconnected clients cannot run completion effects', async () => {
    fixture.reset();
    let timedSignal;
    const timed = setup(app, {}, { provider: async ({ signal }) => {
      timedSignal = signal;
      return (async function* () { yield 'Respuesta parcial.'; await aborted(signal); })();
    } });
    timed.config.providerTimeoutMs = 100;
    const response = await dispatch(timed);
    equal(response.status, 200);
    const content = await readFailure(response);
    ok(!content.includes('data: [DONE]'));
    ok(timedSignal.aborted);
    equal(timed.effects.length, 0);
    equal(fixture.leases.size, 1);

    fixture.reset();
    let cancelledSignal;
    const cancelled = setup(app, {}, { provider: async ({ signal }) => {
      cancelledSignal = signal;
      return (async function* () { yield 'Respuesta parcial.'; await aborted(signal); })();
    } });
    const output = await dispatch(cancelled);
    const reader = output.body.getReader();
    await reader.read();
    await reader.cancel('Synthetic client closed the chat');
    ok(cancelledSignal.aborted);
    equal(cancelled.effects.length, 0);
    equal(fixture.leases.size, 1);
    equal(fixture.buckets.get('global').requests, 1);
  });

  await group('Ignoring provider abort cannot keep the client waiting past the configured deadline', async () => {
    fixture.reset();
    const release = deferred();
    const test = setup(app, {}, { provider: async () => (async function* () { yield 'Parcial.'; await release.promise; yield 'Tardío.'; })() });
    test.config.providerTimeoutMs = 100;
    const response = await dispatch(test);
    const began = Date.now();
    const content = await readFailure(response);
    ok(Date.now() - began < 1500, 'Iterator ignoring cancellation is bounded by handler deadline');
    ok(!content.includes('[DONE]'));
    equal(test.effects.length, 0);
    release.resolve();
  });

  await group('Arbitrary client metadata is ignored and provider output bytes remain bounded', async () => {
    fixture.reset();
    const test = setup(app);
    equal((await dispatch(test, { body: { messages: [{ role: 'user', content: 'Valid user text.' }], visitor_id: 'synthetic-selected' } })).status, 403);
    equal(fixture.requests.length, 0, 'Arbitrary identity is rejected before any quota access');
    await success(test, { body: { messages: [{ role: 'user', content: 'Valid user text.' }], visitor_history: 'CLIENT-CONTEXT-OVERRIDE', visitor_name: 'CLIENT-NAME-OVERRIDE', visitor_company: 'CLIENT-COMPANY-OVERRIDE' } });
    const payload = JSON.stringify(test.calls[0].messages);
    ok(!payload.includes('CLIENT-CONTEXT-OVERRIDE'));
    ok(!payload.includes('CLIENT-NAME-OVERRIDE'));
    ok(!payload.includes('CLIENT-COMPANY-OVERRIDE'));
    equal(test.calls[0].messages.filter(value => value.role === 'system').length, 1);
    fixture.reset();
    const oversized = setup(app, {}, { provider: async ({ config }) => (async function* () { yield 'x'.repeat(config.maxOutputTokens * 16 + 1); })() });
    const response = await dispatch(oversized);
    const content = await readFailure(response);
    ok(!content.includes('[DONE]'));
    equal(oversized.effects.length, 0);
    equal(fixture.leases.size, 1);
  });

  await group('IP attribution trusts platform headers only in Vercel and uses stable IPv4/IPv6 buckets', async () => {
    const config = app.security.readChatConfig(app.env);
    const saved = process.env.VERCEL;
    try {
      delete process.env.VERCEL;
      const spoofed = request({ headers: { 'x-forwarded-for': '198.51.100.1', 'x-real-ip': '198.51.100.2', 'x-vercel-forwarded-for': '198.51.100.3' } });
      equal(app.security.resolveChatIp(spoofed, config, '192.0.2.7'), '192.0.2.7');
      equal(app.security.resolveChatIp(spoofed, { ...config, production: true }, '192.0.2.7'), 'unknown');
      equal(app.security.resolveChatIp(spoofed, config, ''), 'unknown');
      equal(app.security.resolveChatIp(spoofed, config, '::ffff:192.0.2.7'), '192.0.2.7');
      equal(app.security.resolveChatIp(spoofed, config, '2001:db8:ab:cd::1'), app.security.resolveChatIp(spoofed, config, '2001:0db8:00ab:00cd::99'));
      process.env.VERCEL = '1';
      equal(app.security.resolveChatIp(spoofed, config, '192.0.2.7'), '198.51.100.3');
      equal(app.security.resolveChatIp(request({ headers: { 'x-vercel-forwarded-for': '198.51.100.3,192.0.2.1' } }), config, '192.0.2.7'), 'unknown');
      equal(app.security.resolveChatIp(request(), config, '192.0.2.7'), 'unknown');
    } finally { if (saved === undefined) delete process.env.VERCEL; else process.env.VERCEL = saved; }
  });

  await group('Configuration rejects unsafe origins, keys, bounds and leases shorter than provider lifetime', async () => {
    const invalid = [
      { CHAT_SESSION_SECRET: '' }, { CHAT_SESSION_SECRET: 'not-a-secret' }, { OPENROUTER_API_KEY: '' }, { SUPABASE_SERVICE_ROLE_KEY: '' },
      { CHAT_ORIGIN: 'https://example.invalid/path' }, { CHAT_ORIGIN: 'https://user:pass@example.invalid' }, { CHAT_ORIGIN: 'http://example.invalid' },
      { SUPABASE_URL: 'https://example.invalid/path' }, { CHAT_SESSION_REQUESTS: '0' }, { CHAT_IP_REQUESTS: '-1' }, { CHAT_GLOBAL_REQUESTS: '1.5' },
      { CHAT_MAX_BODY_BYTES: 'Infinity' }, { CHAT_PROVIDER_TIMEOUT_MS: '60001' }, { CHAT_LEASE_SECONDS: '5' },
    ];
    for (const changes of invalid) { assertions++; assert.throws(() => app.security.readChatConfig({ ...app.env, ...changes }), /chat_unavailable/); }
    const production = app.security.readChatConfig({ ...app.env, CHAT_ORIGIN: 'https://synthetic.example.invalid', SUPABASE_URL: 'https://database.example.invalid' }, true);
    const session = app.security.chatSession(request(), production, fixture.state.now);
    ok(session.cookie.startsWith('__Host-akrasia_chat='));
    ok(session.cookie.includes('Secure'));
    ok(session.cookie.includes('HttpOnly'));
    ok(!session.cookie.includes('Domain='));
  });

  await group('Real provider adapter disables SDK retries and sends the configured output limit', async () => {
    const { openRouterProvider } = await app.vite.ssrLoadModule('/src/lib/chat-provider.ts');
    const savedFetch = globalThis.fetch;
    const captured = [];
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (new URL(url).origin !== 'https://openrouter.ai') return savedFetch(input, init);
      const payload = input instanceof Request ? await input.clone().json() : JSON.parse(init.body);
      captured.push(payload);
      return new Response(JSON.stringify({ error: { message: 'Synthetic transient provider error' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    };
    try {
      const config = app.security.readChatConfig(app.env);
      await rejects(() => openRouterProvider({ messages: [{ role: 'system', content: 'Synthetic prompt.' }, { role: 'user', content: 'Synthetic user.' }], config, signal: new AbortController().signal }));
      equal(captured.length, 1, 'A transient SDK error causes one paid attempt per admission');
      equal(captured[0].max_tokens, config.maxOutputTokens);
      equal(captured[0].stream, true);
      equal(captured[0].provider.allow_fallbacks, false);
      equal(captured[0].reasoning.enabled, false);
    } finally { globalThis.fetch = savedFetch; }
  });

  await group('Client keeps SSE fragments across every byte boundary and refuses incomplete/error streams', async () => {
    const client = await app.vite.ssrLoadModule('/src/lib/chat-client.ts');
    const wire = new TextEncoder().encode(': keepalive\r\n\r\ndata: {"content":"Vídeo 🎬"}\r\n\r\ndata: {"content":" segundo"}\n\ndata: [DONE]\n\n');
    for (let split = 0; split <= wire.length; split++) {
      const parser = client.createChatSSEParser();
      const decoder = new TextDecoder();
      const events = [...parser.push(decoder.decode(wire.slice(0, split), { stream: true })), ...parser.push(decoder.decode(wire.slice(split), { stream: true })), ...parser.push(decoder.decode())];
      parser.finish();
      equal(events.filter(value => 'content' in value).map(value => value.content).join(''), 'Vídeo 🎬 segundo');
      equal(events.filter(value => value.done).length, 1);
    }
    const parser = client.createChatSSEParser();
    const decoder = new TextDecoder();
    const events = [];
    for (const byte of wire) events.push(...parser.push(decoder.decode(Uint8Array.of(byte), { stream: true })));
    events.push(...parser.push(decoder.decode()));
    parser.finish();
    equal(events.filter(value => 'content' in value).map(value => value.content).join(''), 'Vídeo 🎬 segundo');
    for (const incomplete of ['data: {"content":"partial"}\n\n', 'data: {broken}\n\n', 'data: [DONE]\n\ntruncated', 'data: [DONE]\n\ndata: {"content":"late"}\n\n']) {
      assertions++; assert.throws(() => { const failed = client.createChatSSEParser(); failed.push(incomplete); failed.finish(); }, /chat_interrupted/);
    }
    assertions++; assert.throws(() => client.createChatSSEParser().push('data: {"error":"chat_timeout"}\n\n'), /chat_timeout/);
  });

  await group('Client selects bounded recent context and explains quota/busy/wait failures without provider text', async () => {
    const client = await app.vite.ssrLoadModule('/src/lib/chat-client.ts');
    const messages = Array.from({ length: 50 }, (_, index) => ({ role: index % 2 ? 'assistant' : 'user', content: `message-${index}` }));
    messages.push({ role: 'user', content: 'Newest message stays complete.' });
    const selected = client.buildChatMessages(messages);
    equal(selected.length, client.MAX_CHAT_MESSAGES);
    equal(selected[selected.length - 1].content, messages[messages.length - 1].content);
    const large = [{ role: 'assistant', content: 'x'.repeat(3000) }, { role: 'user', content: 'Complete new text.' }];
    equal(client.buildChatMessages(large).length, 1);
    const unicode = Array.from({ length: 10 }, (_, index) => ({ role: index === 9 ? 'user' : 'assistant', content: '🎬'.repeat(500) }));
    const bounded = client.buildChatMessages(unicode);
    equal(bounded.length, 4);
    ok(bounded.reduce((sum, message) => sum + new TextEncoder().encode(message.content).length, 0) <= client.MAX_CHAT_INPUT_BYTES);
    assertions++; assert.throws(() => client.buildChatMessages([{ role: 'user', content: 'x'.repeat(2001) }]), /request_too_large/);
    const error = client.getChatError({ error: 'private-provider-secret', retry_after: 61 }, 429, null);
    equal(error.code, 'chat_rate_limited');
    const busy = client.getChatError({ error: 'chat_busy' }, 429, '10');
    equal(busy.code, 'chat_busy');
    equal(busy.retryAfter, 10);
    equal(client.getChatError({ error: 'chat_busy', retry_after: 3.5 }, 429, '100').retryAfter, 4);
    equal(client.getChatError({ retry_after: -1 }, 503, '5').retryAfter, 5);
    const translations = { 'chat.rateLimited': 'Límite alcanzado.', 'chat.busy': 'Espera la respuesta.', 'chat.waitMinutes': 'Reintenta en {count} minutos.', 'chat.waitSeconds': 'Reintenta en {count} segundos.' };
    equal(client.formatChatError(error, key => translations[key]), 'Límite alcanzado. Reintenta en 2 minutos.');
    equal(client.formatChatError(busy, key => translations[key]), 'Espera la respuesta. Reintenta en 10 segundos.');
    ok(!client.formatChatError(error, key => translations[key]).includes('private-provider-secret'));
  });

  await group('Exported chat API fails closed with real adapters before any provider/business access', async () => {
    fixture.reset();
    const route = await app.vite.ssrLoadModule('/src/pages/api/chat.ts');
    fixture.state.unavailable = true;
    const response = await route.POST({ request: request(), clientAddress: '192.0.2.7' });
    equal(response.status, 503);
    equal((await response.json()).error, 'chat_unavailable');
    equal(fixture.requests.length, 1, 'Exported route actually attempted its configured synthetic quota RPC');
    equal(fixture.requests[0].path, '/rest/v1/rpc/chat_admit');
    equal(network.blocked.length, 0);
    const effects = await app.vite.ssrLoadModule('/src/lib/chat-effects.ts');
    const abort = new AbortController(); abort.abort();
    await rejects(() => effects.saveChatEffects({ visitorId: '00000000-0000-4000-8000-000000000001', messages: [{ role: 'user', content: 'Synthetic contact test@example.invalid' }], response: '[BOOKING_CONFIRM: día=2030-01-01 hora=10:00 email=test@example.invalid]', signal: abort.signal }));
    equal(fixture.requests.length, 1, 'Already cancelled default effects cannot write or initiate notifications/bookings');
  });

  await group('Exported chat API streams a mocked provider and awaits synthetic messages/lead/notification effects', async () => {
    fixture.reset();
    const integrated = await loadApplication(false, { CHAT_SESSION_REQUESTS: '1', TELEGRAM_BOT_TOKEN: 'synthetic-telegram-token', TELEGRAM_CHAT_ID: 'synthetic-telegram-chat' });
    const route = await integrated.vite.ssrLoadModule('/src/pages/api/chat.ts');
    const savedFetch = globalThis.fetch;
    const paid = [];
    const business = [];
    const telegram = [];
    const syntheticRows = { visitors: [], conversations: [], messages: [], leads: [] };
    let pendingEffects = false;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init.method || (input instanceof Request ? input.method : 'GET');
      const raw = init.body || (input instanceof Request && method !== 'GET' ? await input.clone().text() : undefined);
      const body = raw ? JSON.parse(String(raw)) : null;
      const signal = init.signal || (input instanceof Request ? input.signal : undefined);
      if (url.origin === 'https://openrouter.ai') { paid.push(body); return fakeProviderStream(); }
      if (url.origin === 'https://api.telegram.org') { telegram.push({ body, signal }); return new Response('{"ok":true}', { headers: { 'content-type': 'application/json' } }); }
      if (url.origin === fixture.origin && (url.pathname.endsWith('/rpc/chat_save_turn') || pendingEffects && url.pathname.endsWith('/rpc/chat_context_state'))) {
        business.push({ method, table: url.pathname.slice('/rest/v1/'.length), body, signal });
        if (pendingEffects) return aborted(signal);
        return savedFetch(input, init);
      }
      if (url.origin === fixture.origin && !url.pathname.includes('/rpc/')) {
        const table = url.pathname.slice('/rest/v1/'.length);
        business.push({ method, table, body, signal });
        if (pendingEffects) return aborted(signal);
        let rows;
        if (method === 'GET' || method === 'PATCH') {
          rows = syntheticRows[table].filter(row => [...url.searchParams].every(([key, value]) => value.startsWith('eq.') ? String(row[key]) === value.slice(3) : true));
          if (method === 'PATCH') for (const row of rows) Object.assign(row, body);
        } else {
          rows = [{ id: randomUUID(), ...body }];
          syntheticRows[table].push(...rows);
        }
        return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } });
      }
      return savedFetch(input, init);
    };
    try {
      const selectedId = '00000000-0000-4000-8000-000000000099';
      const foreign = await route.POST({ request: request({ body: { visitor_id: selectedId, messages: [{ role: 'user', content: 'Quiero un videoclip. Mi email es persona@example.invalid.' }] } }), clientAddress: '192.0.2.7' });
      equal(foreign.status, 403);
      equal(paid.length, 0); equal(business.length, 0); equal(telegram.length, 0);
      equal(fixture.requests.length, 0, 'Exported route rejects a foreign identity before persistent quota access');
      const response = await route.POST({ request: request({ body: { messages: [{ role: 'user', content: 'Quiero un videoclip. Mi email es persona@example.invalid.' }] } }), clientAddress: '192.0.2.7' });
      equal(response.status, 200);
      ok((await response.text()).includes('[DONE]'));
      equal(paid.length, 1);
      const cookie = cookieFrom(response);
      const serverId = cookie.slice(cookie.indexOf('=') + 1).split('.')[0];
      ok(serverId !== selectedId);
      const turn = business.find(value => value.table === 'rpc/chat_save_turn').body;
      equal(turn.p_visitor_id, serverId);
      equal(turn.p_context_version, 0);
      equal(fixture.tables.messages.length, 2);
      equal(fixture.tables.messages[0].role, 'user'); equal(fixture.tables.messages[1].role, 'assistant');
      equal(fixture.tables.conversations[0].visitor_id, serverId);
      equal(turn.p_lead.email, 'persona@example.invalid'); equal(turn.p_lead.project_type, 'videoclip');
      equal(telegram.length, 0, 'Completion queues notifications transactionally instead of contacting Telegram');
      equal(fixture.tables.integration_outbox.length, 1, 'One durable lead notification accompanies the atomic turn');
      ok(!JSON.stringify(fixture.tables.integration_outbox).includes(selectedId));
      const workBefore = { paid: paid.length, business: business.length, telegram: telegram.length };
      const rejected = await route.POST({ request: request({ cookie, body: { visitor_id: 'changed', messages: [{ role: 'user', content: 'More synthetic abuse.' }] } }), clientAddress: '192.0.2.7' });
      equal(rejected.status, 403);
      equal(paid.length, workBefore.paid); equal(business.length, workBefore.business); equal(telegram.length, workBefore.telegram);
      const limited = await route.POST({ request: request({ cookie, body: { messages: [{ role: 'user', content: 'More synthetic abuse.' }] } }), clientAddress: '192.0.2.7' });
      equal(limited.status, 429);
      equal(paid.length, workBefore.paid);
      equal(business.length, workBefore.business);
      equal(telegram.length, workBefore.telegram);

      const effects = await integrated.vite.ssrLoadModule('/src/lib/chat-effects.ts');
      pendingEffects = true;
      const abort = new AbortController();
      const pending = effects.saveChatEffects({ visitorId: serverId, operationId: randomUUID(), language: 'es', messages: [{ role: 'user', content: 'Synthetic person@example.invalid' }], response: 'Complete synthetic output.', signal: abort.signal });
      abort.abort();
      await rejects(() => pending);
      equal(business.length, workBefore.business + 1, 'Aborting a pending generation check prevents the atomic turn write and notification');
      equal(telegram.length, workBefore.telegram);
      equal(network.blocked.length, 0);
    } finally { globalThis.fetch = savedFetch; }
  });

  await group('Real provider adapter treats premature clean EOF as failure and cannot trigger effects', async () => {
    fixture.reset();
    const { openRouterProvider } = await app.vite.ssrLoadModule('/src/lib/chat-provider.ts');
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === 'https://openrouter.ai') return fakeProviderStream('Partial provider answer.', false);
      return savedFetch(input, init);
    };
    try {
      const test = setup(app, {}, { provider: openRouterProvider });
      const response = await dispatch(test);
      equal(response.status, 200);
      const body = await response.text();
      ok(body.includes('Partial provider answer.'));
      ok(body.includes('chat_unavailable'));
      ok(!body.includes('[DONE]'));
      equal(test.effects.length, 0);
      equal(fixture.leases.size, 1);
    } finally { globalThis.fetch = savedFetch; }
  });

  await group('Malformed upstream SSE returns only a public error and never logs its private response text', async () => {
    fixture.reset();
    const { openRouterProvider } = await app.vite.ssrLoadModule('/src/lib/chat-provider.ts');
    const marker = 'SYNTHETIC-UPSTREAM-PRIVATE-CONTENT';
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.origin === 'https://openrouter.ai') return new Response(`data: {broken ${marker}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
      return savedFetch(input, init);
    };
    try {
      const test = setup(app, {}, { provider: openRouterProvider });
      const response = await dispatch(test);
      const body = await readFailure(response);
      ok(!body.includes(marker));
      ok(!body.includes('[DONE]'));
      equal(test.effects.length, 0);
      ok(warnings.every(value => !value.includes(marker)));
    } finally { globalThis.fetch = savedFetch; }
  });

  await group('History follows the signed session and cannot expose a client-selected visitor identity', async () => {
    fixture.reset();
    const route = await app.vite.ssrLoadModule('/src/pages/api/visitor-history.ts');
    const get = async (cookie, visitorId) => {
      const headers = new Headers(); if (cookie) headers.set('cookie', cookie);
      return route.GET({ request: new Request(`${origin}/api/visitor-history${visitorId ? `?visitor_id=${visitorId}` : ''}`, { headers }) });
    };
    const foreign = '00000000-0000-4000-8000-000000000099';
    const bootstrap = await get();
    equal(bootstrap.status, 200);
    equal((await bootstrap.json()).conversations.length, 0);
    equal(bootstrap.headers.get('cache-control'), 'no-store, private');
    ok(bootstrap.headers.get('set-cookie'), 'History bootstrap creates a signed server session');
    const metadataCalls = fixture.requests.length;
    equal((await get(undefined, foreign)).status, 403);
    equal(fixture.requests.length, metadataCalls);
    const bad = await get('akrasia_chat=forged', foreign);
    equal(bad.status, 401);
    ok(/Max-Age=0/i.test(bad.headers.get('set-cookie') || ''));
    equal(fixture.requests.length, metadataCalls);
    const test = setup(app);
    const cookie = cookieFrom(await success(test));
    const visitorId = test.effects[0].visitorId;
    const ownConversation = randomUUID(); const foreignConversation = randomUUID();
    fixture.tables.conversations.push({ id: ownConversation, visitor_id: visitorId, created_at: '2026-10-01T12:00:00Z' }, { id: foreignConversation, visitor_id: foreign, created_at: '2026-10-01T12:00:00Z' });
    fixture.tables.messages.push({ id: randomUUID(), conversation_id: ownConversation, role: 'user', content: 'OWN-SYNTHETIC-MESSAGE', created_at: new Date(fixture.state.now).toISOString() }, { id: randomUUID(), conversation_id: foreignConversation, role: 'user', content: 'FOREIGN-SYNTHETIC-MESSAGE', created_at: new Date(fixture.state.now).toISOString() });
    fixture.tables.leads.push({ id: randomUUID(), visitor_id: visitorId, source: 'web', updated_at: new Date(fixture.state.now).toISOString(), name: 'Own synthetic name' }, { id: randomUUID(), visitor_id: foreign, source: 'web', updated_at: new Date(fixture.state.now).toISOString(), name: 'Foreign synthetic name' });
    const before = fixture.requests.length;
    equal((await get(cookie, foreign)).status, 403);
    equal(fixture.requests.length, before, 'Foreign history selection is rejected before the store');
    const response = await get(cookie, visitorId);
    equal(response.status, 200);
    const text = await response.text();
    ok(text.includes('OWN-SYNTHETIC-MESSAGE'));
    ok(text.includes('Own synthetic name'));
    ok(!text.includes('FOREIGN-SYNTHETIC-MESSAGE'));
    ok(!text.includes('Foreign synthetic name'));
    ok(fixture.requests.filter(value => value.method === 'GET' && value.path !== '/rest/v1/messages').every(value => value.query.get('visitor_id') === `eq.${visitorId}`));
  });

  await group('No external requests, real effects, dotenv secrets or credentials in logs', async () => {
    equal(network.blocked.length, 0);
    ok(fixture.requests.every(value => ['/rest/v1/rpc/chat_admit', '/rest/v1/rpc/chat_release', '/rest/v1/rpc/chat_context_state'].includes(value.path) || value.method === 'GET' && ['/rest/v1/conversations', '/rest/v1/messages', '/rest/v1/leads'].includes(value.path)));
    for (const value of warnings) {
      ok(!value.includes(TEST_CHAT_SECRET));
      ok(!value.includes(TEST_CHAT_PROVIDER_KEY));
      ok(!value.includes(app.env.SUPABASE_SERVICE_ROLE_KEY));
    }
  });
  console.log(`PASS: ${groups} groups, ${assertions} assertions; synthetic chat data only.`);
  console.log('Limit: the shared local RPC double verifies application contracts, not deployed SQL/RLS or platform proxy behavior.');
} finally {
  console.warn = originalWarn;
  console.error = originalError;
  await Promise.all(applications.map(application => application.close()));
  network.restore();
  if (originalVercel === undefined) delete process.env.VERCEL; else process.env.VERCEL = originalVercel;
  await fixture.close();
}
