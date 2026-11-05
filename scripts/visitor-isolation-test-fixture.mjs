import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { TEST_CHAT_SECRET, TEST_CHAT_SERVICE_KEY, TEST_CHAT_PROVIDER_KEY } from './chat-test-fixture.mjs';
import { createLifecycleFixture } from './chat-lifecycle-test-fixture.mjs';

// A synthetic REST/RPC service. This checks application ownership and request
// ordering only; PostgreSQL constraints and RLS must be verified independently.
export async function createVisitorIsolationFixture() {
  const requests = [];
  const tables = Object.fromEntries(['visitors', 'conversations', 'messages', 'leads', 'bookings', 'availability', 'availability_overrides', 'sent_emails', 'chat_quota_buckets', 'chat_concurrency_leases'].map(name => [name, []]));
  const contextStates = new Map();
  const state = { now: Date.now(), unavailable: false, failTable: null, failMethod: null, errorText: null, denied: false, malformedTable: null, ignoredOwnerTable: null, invalidWriteTable: null, invalidWriteMethod: null, invalidWriteValue: null, bookingPostWithoutMeetUrl: false };
  const lifecycle = createLifecycleFixture(tables, contextStates, () => state.now);
  const matches = (row, query) => [...query].every(([key, value]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key)) return true;
    const actual = key.split('.').reduce((current, part) => current?.[part], row);
    if (value.startsWith('eq.')) return String(actual) === value.slice(3);
    if (value.startsWith('neq.')) return String(actual) !== value.slice(4);
    if (value.startsWith('gte.')) return String(actual) >= value.slice(4);
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(actual));
    throw new Error(`Unsupported synthetic filter: ${key}`);
  });
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const json = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString() || 'null');
      const table = url.pathname.slice('/rest/v1/'.length);
      requests.push({ method: request.method, path: url.pathname, table, query: new URLSearchParams(url.searchParams), body });
      if (request.headers.apikey !== TEST_CHAT_SERVICE_KEY || request.headers.authorization !== `Bearer ${TEST_CHAT_SERVICE_KEY}`) return json({ error: 'Synthetic credential rejected' }, 403);
      if (state.unavailable || (state.failTable === table && (!state.failMethod || state.failMethod === request.method))) return json({ error: state.errorText || 'Synthetic store outage' }, 503);
      if (table === 'rpc/chat_admit' && request.method === 'POST') {
        if (state.denied) return json({ allowed: false, reason: 'rate', retry_after: 30 });
        tables.chat_concurrency_leases.push({ id: body.p_lease_id, lease_id: body.p_lease_id, session_key: body.p_session_key,
          ip_key: body.p_ip_key, expires_at: new Date(state.now + body.p_policy.lease_seconds*1000).toISOString() });
        return json({ allowed: true, reason: null, retry_after: 0 });
      }
      if (table === 'rpc/chat_release' && request.method === 'POST') { tables.chat_concurrency_leases = tables.chat_concurrency_leases.filter(row=>row.lease_id!==body.p_lease_id); return json(null); }
      if (table === 'rpc/booking_create_once' && request.method === 'POST') {
        const booking = body.p_booking;
        if (booking.visitor_id !== body.p_visitor_id ||
          booking.conversation_id && !tables.conversations.some(row => row.id === booking.conversation_id && row.visitor_id === body.p_visitor_id) ||
          booking.lead_id && !tables.leads.some(row => row.id === booking.lead_id && row.visitor_id === body.p_visitor_id)) return json({error:'invalid_reference'},403);
        const existing = tables.bookings.find(row => row.id === booking.id);
        if (existing) return json({booking:existing,created:false});
        const row = {...booking,status:'confirmed',created_at:new Date(state.now).toISOString()};
        if (typeof state.bookingRepresentation === 'function') return json({booking:state.bookingRepresentation(row),created:true});
        if (state.bookingPostWithoutMeetUrl) row.meet_url=null;
        tables.bookings.push(row);
        return json({booking:row,created:true});
      }
      if (table === 'rpc/chat_save_turn' && (state.invalidWriteTable || ['visitors', 'messages', 'leads'].includes(state.failTable))) return json({ error: 'Synthetic atomic write failure' }, 503);
      if (table.startsWith('rpc/') && request.method === 'POST') { const result = lifecycle.rpc(table.slice(4), body); if (result !== undefined) return json(result); }
      if (!(table in tables)) return json({ error: 'Unexpected synthetic table' }, 404);
      if (state.invalidWriteTable === table && ['POST', 'PATCH'].includes(request.method) && (!state.invalidWriteMethod || state.invalidWriteMethod === request.method)) return json(state.invalidWriteValue);
      if (request.method === 'GET') {
        if (state.malformedTable === table) return json({ malformed: true });
        const query = new URLSearchParams(url.searchParams);
        if (state.ignoredOwnerTable === table) { query.delete('visitor_id'); query.delete('conversations.visitor_id'); }
        const expanded = table === 'messages' && query.get('select')?.includes('conversations!inner(')
          ? tables[table].map(row => ({ ...row, conversations: { visitor_id: tables.conversations.find(conversation => conversation.id === row.conversation_id)?.visitor_id } })) : tables[table];
        let rows = expanded.filter(row => matches(row, query));
        const order = query.get('order');
        if (order) {
          rows = [...rows].sort((a, b) => {
            for (const specification of order.split(',')) {
              const [column, direction] = specification.split('.');
              const compared = String(a[column] || '').localeCompare(String(b[column] || '')) * (direction === 'desc' ? -1 : 1);
              if (compared) return compared;
            }
            return 0;
          });
        }
        rows = rows.slice(Number(query.get('offset')) || 0, (Number(query.get('offset')) || 0) + (Number(query.get('limit')) || rows.length));
        const select = query.get('select');
        return json(select && select !== '*' ? rows.map(row => Object.fromEntries(select.split(/,(?![^()]*\))/)
          .map(key => key.startsWith('conversations!inner(') ? 'conversations' : key).filter(key => key in row).map(key => [key, row[key]]))) : rows);
      }
      if (request.method === 'POST') {
        const incoming = Array.isArray(body) ? body : [body];
        const rows = incoming.map(value => {
          if (!value || typeof value !== 'object') throw new Error('Invalid synthetic insert');
          const conflict = url.searchParams.get('on_conflict');
          const existing = conflict && tables[table].find(row => row[conflict] === value[conflict]);
          if (existing && request.headers.prefer?.includes('merge-duplicates')) { Object.assign(existing, value); return existing; }
          const row = { id: randomUUID(), created_at: new Date(state.now).toISOString(), updated_at: new Date(state.now).toISOString(), ...value };
          if (table === 'bookings' && state.bookingPostWithoutMeetUrl) row.meet_url = null;
          tables[table].push(row);
          return row;
        });
        return json(rows, 201);
      }
      if (request.method === 'PATCH') {
        const rows = tables[table].filter(row => matches(row, url.searchParams));
        for (const row of rows) Object.assign(row, body);
        return json(rows);
      }
      return json({ error: 'Unsupported synthetic operation' }, 405);
    } catch { return json({ error: 'Invalid synthetic request' }, 400); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, requests, tables, state, contextStates,
    environment() { return {
      CHAT_SESSION_SECRET: TEST_CHAT_SECRET, CHAT_ORIGIN: 'http://localhost:4322', SUPABASE_URL: origin,
      SUPABASE_SERVICE_ROLE_KEY: TEST_CHAT_SERVICE_KEY, OPENROUTER_API_KEY: TEST_CHAT_PROVIDER_KEY,
      RESEND_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
    }; },
    reset() { contextStates.clear(); requests.length = 0; for (const rows of Object.values(tables)) rows.length = 0; Object.assign(state, { now: Date.now(), unavailable: false, failTable: null, failMethod: null, errorText: null, denied: false, malformedTable: null, ignoredOwnerTable: null, invalidWriteTable: null, invalidWriteMethod: null, invalidWriteValue: null, bookingPostWithoutMeetUrl: false }); },
    seed(visitorId, label) {
      const conversation = { id: randomUUID(), visitor_id: visitorId, created_at: new Date(state.now).toISOString(), updated_at: new Date(state.now).toISOString(), private_notes: `${label}-internal-conversation-secret` };
      const lead = { id: randomUUID(), visitor_id: visitorId, source: 'web', conversation_id: conversation.id, name: `${label}-name-private`, company: `${label}-company-private`, email: `${label}@synthetic.invalid`, phone: '000000000', internal_notes: `${label}-internal-contact-secret`, created_at: new Date(state.now).toISOString(), updated_at: new Date(state.now).toISOString() };
      tables.visitors.push({ id: randomUUID(), visitor_id: visitorId });
      tables.conversations.push(conversation);
      tables.leads.push(lead);
      tables.messages.push({ id: randomUUID(), conversation_id: conversation.id, role: 'user', content: `${label}-history-private`, created_at: new Date(state.now - 1000).toISOString(), metadata: `${label}-internal-message-secret` });
      tables.messages.push({ id: randomUUID(), conversation_id: conversation.id, role: 'assistant', content: `${label}-reply-private`, created_at: new Date(state.now).toISOString() });
      return { conversation, lead };
    },
    async close() { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
