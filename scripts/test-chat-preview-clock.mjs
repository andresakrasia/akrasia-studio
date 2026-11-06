import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer as createViteServer } from 'vite';
import { createChatTestFixture, TEST_CHAT_SERVICE_KEY } from './chat-test-fixture.mjs';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { TEST_SERVICE_KEY } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Local RPC fixtures only. No .env, paid provider, notification or real data.
let groups = 0;
let assertions = 0;
const equal = (actual, expected) => { assertions++; assert.deepEqual(actual, expected); };
const ok = actual => { assertions++; assert.ok(actual); };
async function group(title, test) { await test(); groups++; console.log(`ok ${groups} - ${title}`); }
const beginning = Date.UTC(2026, 9, 3, 12);
let current = beginning;
const frozen = await createChatTestFixture();
const ticking = await createChatTestFixture({ clock: () => current });
const preview = await createChatFirstPreviewFixture({ clock: () => current });
const proposalPreview = await createChatFirstPreviewFixture({ clock: () => current,
  syntheticBookingSlots: [{ date: '2026-10-05', time: '10:00' }] });
const network = installFetchGuard([frozen.origin, ticking.origin, ...preview.allowedOrigins, ...proposalPreview.allowedOrigins]);
const env = frozen.environment();
const vite = await createViteServer({ root: process.cwd(), configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: Object.fromEntries(Object.entries({ ...env, PROD: false, DEV: true, SSR: true })
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
const owner = randomUUID();
const sessionKey = 'a'.repeat(64);
const ipKey = 'b'.repeat(64);
const policy = { session_requests: 2, ip_requests: 3, global_requests: 4, global_units: 100,
  window_seconds: 120, global_window_seconds: 120, session_concurrency: 1, ip_concurrency: 2,
  global_concurrency: 4, lease_seconds: 60 };
const admission = () => ({ p_session_key: sessionKey, p_ip_key: ipKey, p_lease_id: randomUUID(), p_input_units: 10, p_policy: policy });
const scope = () => ({ p_visitor_id: owner, p_expires_at: Math.floor(current / 1000) + 86400, p_context_version: 0 });
async function rpc(fixture, name, body, key = TEST_CHAT_SERVICE_KEY) {
  const response = await fetch(`${fixture.origin}/rest/v1/rpc/${name}`, { method: 'POST', redirect: 'error',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: response.status, value: await response.json() };
}

try {
  await group('Default fixture clock remains deterministic and manually advanceable', async () => {
    const initial = frozen.state.now;
    equal((await rpc(frozen, 'chat_admit', admission())).value.allowed, true);
    equal((await rpc(frozen, 'chat_admit', admission())).value.reason, 'busy');
    equal(frozen.state.now, initial);
    frozen.advance(60000);
    equal(frozen.state.now, initial + 60000);
    equal((await rpc(frozen, 'chat_admit', admission())).value.allowed, true);
  });
  await group('Injected time expires failed-work leases without refunding quotas or bypassing outages', async () => {
    const first = admission();
    equal((await rpc(ticking, 'chat_admit', first)).value.allowed, true);
    ticking.state.releaseUnavailable = true;
    equal((await rpc(ticking, 'chat_release', { p_lease_id: first.p_lease_id })).status, 503);
    current = beginning + 59999;
    const busy = (await rpc(ticking, 'chat_admit', admission())).value;
    equal(busy.reason, 'busy');
    equal(busy.retry_after, 1);
    current++;
    equal((await rpc(ticking, 'chat_admit', admission())).value.allowed, true);
    equal(ticking.buckets.get(`session:${sessionKey}`).requests, 2);
    equal(ticking.buckets.get('global').units, 20);
    current = beginning + 120000;
    ticking.state.unavailable = true;
    equal((await rpc(ticking, 'chat_admit', admission())).status, 503);
    equal(ticking.buckets.get('global').requests, 2);
    ticking.state.unavailable = false;
    equal((await rpc(ticking, 'chat_admit', admission())).value.allowed, true);
    equal(ticking.buckets.get('global').requests, 1);
    equal(ticking.state.now, current);
  });
  await group('Lifecycle and pending operations observe the same injected time', async () => {
    ticking.reset(); current = beginning;
    const operation = { ...scope(), p_operation_id: randomUUID(), p_request_hash: 'c'.repeat(64) };
    equal((await rpc(ticking, 'chat_claim_turn', operation)).value, { status: 'claimed' });
    current = beginning + 89999;
    equal((await rpc(ticking, 'chat_claim_turn', operation)).value, { error: 'chat_busy', retry_after: 1 });
    current++;
    equal((await rpc(ticking, 'chat_claim_turn', operation)).value, { status: 'claimed' });
    const active = admission();
    equal((await rpc(ticking, 'chat_admit', active)).value.allowed, true);
    equal((await rpc(ticking, 'chat_erase_context', { ...scope(), p_session_key: sessionKey })).value.error, 'chat_busy');
    current += 60000;
    equal((await rpc(ticking, 'chat_erase_context', { ...scope(), p_session_key: sessionKey })).value.contextVersion, 1);
    assertions++; assert.throws(() => ticking.advance(60000), /controlled by their owner/u);
    equal(ticking.state.now, current);
  });
  await group('Composed preview forwards the ticking clock and keeps normal local authorization', async () => {
    current = beginning;
    const first = admission();
    equal((await rpc(preview, 'chat_admit', first, TEST_SERVICE_KEY)).value.allowed, true);
    equal((await rpc(preview, 'chat_admit', admission(), TEST_SERVICE_KEY)).value.reason, 'busy');
    current += 60000;
    equal((await rpc(preview, 'chat_admit', admission(), TEST_SERVICE_KEY)).value.allowed, true);
    equal(preview.chat.state.now, current);
    equal((await rpc(preview, 'chat_context_state', scope(), 'fake-rejected-service-key')).status, 403);
    ok(preview.requests.some(value => value.path === '/rest/v1/rpc/chat_admit' && value.target === 'chat'));
    equal(network.blocked.length, 0);
  });
  await group('Stored multi-turn history retains the latest chronological suffix and role order on timestamp ties', async () => {
    frozen.reset();
    const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
    const data = await vite.ssrLoadModule('/src/lib/visitor-data.ts');
    const config = { ...security.readChatStorageConfig(env), maxMessages: 4 };
    const visitor = randomUUID();
    const expected = [];
    for (let turn = 1; turn <= 4; turn++) {
      const operation = { p_visitor_id: visitor, p_expires_at: Math.floor(frozen.state.now / 1000) + 86400,
        p_context_version: 0, p_operation_id: randomUUID(), p_request_hash: String(turn).repeat(64) };
      equal((await rpc(frozen, 'chat_claim_turn', operation)).value.status, 'claimed');
      const pair = [{ role: 'user', content: `Consulta ${turn}` }, { role: 'assistant', content: `Respuesta ${turn}` }];
      equal((await rpc(frozen, 'chat_save_turn', { ...operation, p_user_content: pair[0].content,
        p_assistant_content: pair[1].content, p_lead: null, p_action: null })).value.saved, true);
      const stored = frozen.tables.messages.slice(-2);
      equal(stored[0].created_at, stored[1].created_at);
      // Force UUID order opposite to role order: an ID-only tie breaker would
      // make the chronological history contain assistant before user.
      stored[0].id = `ffffffff-ffff-4fff-8fff-${String(turn).padStart(12, '0')}`;
      stored[1].id = `00000000-0000-4000-8000-${String(turn).padStart(12, '0')}`;
      Object.assign(frozen.tables.chat_turn_operations.find(row => row.operation_id === operation.p_operation_id),
        { user_message_id: stored[0].id, assistant_message_id: stored[1].id });
      expected.push(...pair);
      frozen.advance(1000);
    }
    const signal = new AbortController().signal;
    const context = await data.loadVisitorContext({ visitorId: visitor, config, signal });
    equal(context.messages, expected.slice(-4));
    equal(context.messages.at(-1), expected.at(-1));
    const messageRead = frozen.requests.filter(request => request.method === 'GET' && request.path === '/rest/v1/messages').at(-1);
    equal(messageRead.query.get('order'), 'created_at.desc,role.asc,id.desc');
    equal(messageRead.query.get('limit'), '4');
    const lastPairBytes = expected.slice(-2).reduce((sum, message) => sum + Buffer.byteLength(message.content, 'utf8'), 0);
    const bounded = await data.loadVisitorContext({ visitorId: visitor, config: { ...config, maxHistoryBytes: lastPairBytes }, signal });
    equal(bounded.messages, expected.slice(-2));
    equal(network.blocked.length, 0);
  });
  await group('Preview REST reads filter retention and sort before applying limit and offset', async () => {
    const conversation = frozen.tables.conversations[0];
    const expired = new Date(Date.now() - 120 * 86400000).toISOString();
    frozen.tables.messages.unshift({ id: randomUUID(), conversation_id: conversation.id, role: 'user', content: 'Expired message', created_at: expired });
    frozen.tables.leads.push(
      { id: randomUUID(), visitor_id: conversation.visitor_id, source: 'web', name: 'Expired profile', updated_at: expired },
      { id: randomUUID(), visitor_id: conversation.visitor_id, source: 'web', name: 'Older profile', updated_at: new Date(frozen.state.now - 1000).toISOString() },
      { id: randomUUID(), visitor_id: conversation.visitor_id, source: 'web', name: 'Latest profile', updated_at: new Date(frozen.state.now).toISOString() },
    );
    const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
    const data = await vite.ssrLoadModule('/src/lib/visitor-data.ts');
    const context = await data.loadVisitorContext({ visitorId: conversation.visitor_id, config: security.readChatStorageConfig(env), signal: new AbortController().signal });
    equal(context.visitorName, 'Latest profile');
    equal(context.messages.length, 8);
    ok(!JSON.stringify(context.messages).includes('Expired message'));
    const query = new URLSearchParams({ select: 'role,content', conversation_id: `eq.${conversation.id}`,
      created_at: `gte.${new Date(Date.now() - 30 * 86400000).toISOString()}`,
      order: 'created_at.desc,role.asc,id.desc', offset: '1', limit: '2' });
    const response = await fetch(`${frozen.origin}/rest/v1/messages?${query}`, { redirect: 'error',
      headers: { apikey: TEST_CHAT_SERVICE_KEY, Authorization: `Bearer ${TEST_CHAT_SERVICE_KEY}` } });
    equal(response.status, 200);
    equal(await response.json(), [{ role: 'user', content: 'Consulta 4' }, { role: 'assistant', content: 'Respuesta 3' }]);
    equal(network.blocked.length, 0);
  });
  await group('Real availability adapter reads only explicitly allowed synthetic slots and never books a call', async () => {
    for (const [fixture, expected] of [[preview, false], [proposalPreview, true]]) {
      const before = JSON.stringify(fixture.tables);
      const firstRequest = fixture.requests.length;
      const environment = fixture.environment('http://localhost:4322');
      const agendaVite = await createViteServer({ root: process.cwd(), configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
        server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
        define: Object.fromEntries(Object.entries({ ...environment, PROD: false, DEV: true, SSR: true })
          .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
      });
      try {
        const bookings = await agendaVite.ssrLoadModule('/src/lib/bookings.ts');
        equal(await bookings.checkAvailability('2026-10-05', '10:00'), expected);
        equal(await bookings.checkAvailability('2026-10-05', '10:30'), false);
        equal(await bookings.checkAvailability('2026-10-06', '10:00'), false);
        equal(fixture.requests.slice(firstRequest).map(request => request.target),
          ['synthetic-agenda', 'synthetic-agenda', 'synthetic-agenda']);
        equal(JSON.stringify(fixture.tables), before);
        equal(fixture.tables.bookings.length, 0);
        ok(!fixture.requests.slice(firstRequest).some(request => request.path.includes('booking_create_once')));
      } finally { await agendaVite.close(); }
    }
    for (const syntheticBookingSlots of [null, [{ date: '2026-02-30', time: '10:00' }],
      [{ date: '2026-10-05', time: '25:00' }], [{ date: '2026-10-05', time: '10:00', extra: true }]]) {
      assertions++; await assert.rejects(() => createChatFirstPreviewFixture({ syntheticBookingSlots }), /Invalid synthetic booking slots/u);
    }
    equal(network.blocked.length, 0);
  });
  console.log(`PASS: ${groups} groups, ${assertions} assertions; fixture clocks and local RPC only.`);
} finally {
  network.restore();
  await vite.close();
  await Promise.all([frozen.close(), ticking.close(), preview.close(), proposalPreview.close()]);
}
