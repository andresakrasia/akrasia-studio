import { createServer } from 'node:http';
import { createLifecycleFixture } from './chat-lifecycle-test-fixture.mjs';

export const TEST_CHAT_SECRET = 'ab'.repeat(32);
export const TEST_CHAT_SERVICE_KEY = 'synthetic-chat-service-role-only';
export const TEST_CHAT_PROVIDER_KEY = 'synthetic-chat-provider-only';

// A local RPC double with a controllable clock and shared state. It models the
// public contract; these tests do not claim to execute PostgreSQL or verify RLS.
export async function createChatTestFixture({ clock } = {}) {
  if (clock !== undefined && typeof clock !== 'function') throw new Error('Invalid synthetic fixture clock');
  const requests = [];
  const buckets = new Map();
  const leases = new Map();
  const tables = { visitors: [], conversations: [], messages: [], leads: [], sent_emails: [], bookings: [], chat_quota_buckets: [], chat_concurrency_leases: [] };
  const contextStates = new Map();
  const state = { now: Date.now(), unavailable: false, malformed: null, releaseUnavailable: false };
  // Unit suites retain their manually advanced clock. Interactive previews
  // inject Date.now so failed-work leases and rate windows really expire.
  if (clock) Object.defineProperty(state, 'now', { enumerable: true, get: clock });
  const lifecycle = createLifecycleFixture(tables, contextStates, () => state.now,
    () => [...leases.values()].map(lease=>({ session_key:lease.session,expires_at:new Date(lease.until).toISOString() })));

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const json = (data, status = 200, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      response.end(JSON.stringify(data));
    };
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || 'null');
      requests.push({ method: request.method, path: url.pathname, query: url.searchParams, body });
      if (state.unavailable) return json({ error: 'Synthetic store outage' }, 503);
      if (request.headers.apikey !== TEST_CHAT_SERVICE_KEY || request.headers.authorization !== `Bearer ${TEST_CHAT_SERVICE_KEY}`) {
        return json({ error: 'Synthetic service credential rejected' }, 403);
      }
      if (request.method === 'GET' && url.pathname.startsWith('/rest/v1/')) {
        const table = url.pathname.slice('/rest/v1/'.length);
        if (!(table in tables)) return json({ error: 'Unexpected synthetic table' }, 404);
        const expanded = table === 'messages' && url.searchParams.get('select')?.includes('conversations!inner(')
          ? tables[table].map(row => ({ ...row, conversations: { visitor_id: tables.conversations.find(conversation => conversation.id === row.conversation_id)?.visitor_id } })) : tables[table];
        const rows = expanded.filter(row => [...url.searchParams].every(([key, value]) => {
          if (['select', 'order', 'limit', 'offset'].includes(key)) return true;
          if (key === 'or') return value.slice(1, -1).split(',').some(term => {
            const match = /^(\w+)\.ilike\.\*(.*)\*$/.exec(term);
            return match && String(row[match[1]] ?? '').toLocaleLowerCase().includes(match[2].toLocaleLowerCase());
          });
          const actual = key.split('.').reduce((current, part) => current?.[part], row);
          if (value.startsWith('eq.')) return String(actual) === value.slice(3);
          if (value.startsWith('gte.')) return actual !== undefined && actual !== null && String(actual) >= value.slice(4);
          if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(actual));
          throw new Error(`Unsupported synthetic filter: ${key}`);
        }));
        const order = url.searchParams.get('order');
        if (order) rows.sort((left, right) => {
          for (const specification of order.split(',')) {
            const [column, direction] = specification.split('.');
            const a = String(left[column] ?? '');
            const b = String(right[column] ?? '');
            const compared = (a < b ? -1 : a > b ? 1 : 0) * (direction === 'desc' ? -1 : 1);
            if (compared) return compared;
          }
          return 0;
        });
        const offset = Number(url.searchParams.get('offset')) || 0;
        const limit = url.searchParams.has('limit') ? Number(url.searchParams.get('limit')) : rows.length;
        const bounded = rows.slice(offset, offset + limit);
        // The shared preview's admin requires the filtered total, before paging.
        const headers = request.headers.prefer?.split(',').some(value => value.trim() === 'count=exact')
          ? { 'Content-Range': `${bounded.length ? `${offset}-${offset + bounded.length - 1}` : '*'}/${rows.length}`,
              'Preference-Applied': 'count=exact' } : {};
        const select = url.searchParams.get('select');
        return json(select && select !== '*' ? bounded.map(row => Object.fromEntries(select.split(/,(?![^()]*\))/)
          .map(key => key.startsWith('conversations!inner(') ? 'conversations' : key).filter(key => key in row).map(key => [key, row[key]]))) : bounded, 200, headers);
      }
      if (request.method !== 'POST') return json({ error: 'Unsupported synthetic request' }, 405);
      if (url.pathname === '/rest/v1/rpc/chat_admit') {
        if (state.malformed !== null) return json(state.malformed);
        return json(admit(body));
      }
      if (url.pathname === '/rest/v1/rpc/chat_release') {
        if (state.releaseUnavailable) return json({ error: 'Synthetic release outage' }, 503);
        leases.delete(body.p_lease_id);
        return json(null);
      }
      if (url.pathname.startsWith('/rest/v1/rpc/')) { const result = lifecycle.rpc(url.pathname.slice('/rest/v1/rpc/'.length), body); if (result !== undefined) return json(result); }
      return json({ error: 'Unexpected synthetic store access' }, 404);
    } catch {
      return json({ error: 'Invalid synthetic request' }, 400);
    }
  });

  function admit(body) {
    if (!/^[a-f0-9]{64}$/.test(body?.p_session_key) || !/^[a-f0-9]{64}$/.test(body?.p_ip_key) ||
        !/^[a-f0-9-]{36}$/i.test(body?.p_lease_id) || !Number.isSafeInteger(body?.p_input_units) || body.p_input_units < 1) {
      throw new Error('Invalid admission contract');
    }
    const policy = body.p_policy;
    const now = state.now;
    // This section is intentionally synchronous: multiple HTTP clients observe
    // one atomic transaction, just as two serverless instances must.
    for (const [key, bucket] of buckets) if (bucket.until <= now) buckets.delete(key);
    for (const [key, lease] of leases) if (lease.until <= now) leases.delete(key);
    return consume(policy, body, now);
  }

  // Policy field names match the application's documented RPC contract, not any
  // imported implementation. Request and input reservations are never refunded.
  function consume(policy, body, now) {
    const scopes = [
      { key: `session:${body.p_session_key}`, maximum: policy.session_requests, seconds: policy.window_seconds },
      { key: `ip:${body.p_ip_key}`, maximum: policy.ip_requests, seconds: policy.window_seconds },
      { key: 'global', maximum: policy.global_requests, seconds: policy.global_window_seconds },
    ];
    const touched = scopes.map(scope => ({ ...scope, bucket: buckets.get(scope.key) || {
      requests: 0, units: 0,
      until: (Math.floor(now / (scope.seconds * 1000)) + 1) * scope.seconds * 1000,
    } }));
    const exhausted = touched.filter(scope => scope.bucket.requests >= scope.maximum ||
      (scope.key === 'global' && scope.bucket.units + body.p_input_units > policy.global_units));
    if (exhausted.length) return { allowed: false, reason: 'rate', retry_after: Math.max(1,
      ...exhausted.map(scope => Math.ceil((scope.bucket.until - now) / 1000))) };
    const active = [...leases.values()];
    const constrained = [
      [active.filter(lease => lease.session === body.p_session_key), policy.session_concurrency],
      [active.filter(lease => lease.ip === body.p_ip_key), policy.ip_concurrency],
      [active, policy.global_concurrency],
    ].filter(([matches, maximum]) => matches.length >= maximum);
    if (leases.has(body.p_lease_id) || constrained.length) return { allowed: false, reason: 'busy', retry_after: Math.max(1,
      ...constrained.map(([matches]) => Math.ceil((Math.min(...matches.map(lease => lease.until)) - now) / 1000))) };
    for (const scope of touched) {
      scope.bucket.requests++;
      scope.bucket.units += body.p_input_units;
      buckets.set(scope.key, scope.bucket);
    }
    leases.set(body.p_lease_id, { session: body.p_session_key, ip: body.p_ip_key, until: now + policy.lease_seconds * 1000 });
    return { allowed: true, reason: null, retry_after: 0 };
  }

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, requests, buckets, leases, tables, state, contextStates,
    environment() {
      return {
        CHAT_SESSION_SECRET: TEST_CHAT_SECRET, CHAT_ORIGIN: 'http://localhost:4322', SUPABASE_URL: origin,
        SUPABASE_SERVICE_ROLE_KEY: TEST_CHAT_SERVICE_KEY, OPENROUTER_API_KEY: TEST_CHAT_PROVIDER_KEY,
        RESEND_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
      };
    },
    reset() { contextStates.clear(); buckets.clear(); leases.clear(); for (const rows of Object.values(tables)) rows.length = 0; requests.length = 0; if (!clock) state.now = Date.now(); state.unavailable = false; state.malformed = null; state.releaseUnavailable = false; },
    advance(milliseconds) { if (clock) throw new Error('Injected fixture clocks are controlled by their owner'); state.now += milliseconds; },
    async close() { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
