import { createServer } from 'node:http';
import { createHash, scryptSync, randomUUID } from 'node:crypto';
import { attachClientJourneyFixture } from './client-journey-test-fixture.mjs';

export const TEST_PASSWORD = 'Synthetic administrator password 2026';
export const TEST_SERVICE_KEY = 'synthetic-service-role-only';
export const TEST_LEGACY_SECRET = 'synthetic-retired-secret';
export const TEST_VISITOR_ID = '00000000-0000-4000-8000-000000000001';
const salt = Buffer.from('0102030405060708090a0b0c0d0e0f10', 'hex');
export const TEST_PASSWORD_HASH = `scrypt:131072:8:1:${salt.toString('hex')}:${scryptSync(TEST_PASSWORD, salt, 64, {
  N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024,
}).toString('hex')}`;
export const tokenDigest = value => createHash('sha256').update(value).digest('hex');

const copy = value => structuredClone(value);
const initialTables = {
  clients: [{ id: '00000000-0000-4000-8000-000000000007', name: 'Cliente de prueba', company: 'Empresa ficticia', email: 'synthetic@example.invalid', phone: '', notes: 'Datos ficticios', created_at: '2026-01-01T00:00:00Z' }],
  projects: [{ id: '00000000-0000-4000-8000-000000000006', title: 'Proyecto sintético', slug: 'proyecto-sintetico', type: 'video', status: 'in_production', client_name: 'Cliente de prueba', client_id: '00000000-0000-4000-8000-000000000007', sort_order: 1, is_active: true, is_published: false, public_description: '', thumbnail: '', thumbnail_url: '', video_url: '', resolution: '1920x1080', aspect: '16:9', duration: '30s', category: 'Prueba', description: 'Solo datos ficticios', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:01:00Z' }],
  project_tasks: [{ id: '00000000-0000-4000-8000-000000000008', project_id: '00000000-0000-4000-8000-000000000006', title: 'Tarea de prueba', description: 'Tarea ficticia', status: 'pending', priority: 'medium', created_at: '2026-01-01T00:00:00Z' }],
  services: [{ id: '00000000-0000-4000-8000-000000000009', title: 'Servicio de prueba', name: 'Servicio de prueba', slug: 'servicio-prueba', description: 'Solo datos ficticios', icon: 'movie', is_active: true,is_published:false, sort_order: 1 }],
  studio_stats: [{ key: 'projects', value: 1, label: 'Proyectos de prueba', updated_at: '2026-01-01T00:00:00Z' }],
  feed_entries: [{ id: '00000000-0000-4000-8000-000000000010', text: 'Actividad sintética', level: 'mid', is_active: true, created_at: '2026-01-01T00:00:00Z' }],
  studio_logs: [{ id: '00000000-0000-4000-8000-000000000011', text: 'Registro sintético', log_type: 'info', is_active: true, created_at: '2026-01-01T00:00:00Z' }],
  visitors: [{ id: '00000000-0000-4000-8000-000000000012', visitor_id: TEST_VISITOR_ID, name: 'Visita sintética', company: 'Empresa ficticia', email: 'synthetic@example.invalid', first_seen: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z', last_seen: '2026-01-01T00:01:00Z', source: 'direct', page_views: 1, total_messages: 2 }],
  conversations: [{ id: '00000000-0000-4000-8000-000000000013', visitor_id: TEST_VISITOR_ID, message_count: 2, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:01:00Z' }],
  messages: [
    { id: '00000000-0000-4000-8000-000000000014', conversation_id: '00000000-0000-4000-8000-000000000013', role: 'user', content: 'Mensaje sintético', created_at: '2026-01-01T00:00:00Z' },
    { id: '00000000-0000-4000-8000-000000000015', conversation_id: '00000000-0000-4000-8000-000000000013', role: 'assistant', content: 'Respuesta ficticia sin IA', created_at: '2026-01-01T00:01:00Z' },
  ],
  leads: [{ id: '00000000-0000-4000-8000-000000000016', visitor_id: TEST_VISITOR_ID, conversation_id: '00000000-0000-4000-8000-000000000013', name: 'Lead sintético', email: 'synthetic@example.invalid', phone: null, company: 'Empresa ficticia', project_type: 'Video de prueba', tags: ['sintético'], status: 'new',interest_level:'warm',interest_score:45, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:01:00Z' }],
  bookings: [], sent_emails: [], availability: [], availability_overrides: [],
  content: [{ key: 'projects', data: [] }, { key: 'services', data: [] }, { key: 'case-studies', data: [] }],
};

// A small HTTP PostgREST double, independent of application authentication code.
// It implements filtering and durable-in-fixture rows instead of accepting arbitrary tokens.
export async function createDashboardTestFixture() {
  const sessions = new Map();
  const tables = copy(initialTables);
  const requests = [];
  const storage = new Map();
  const rate = new Map();
  const state = { unavailable: false, malformedSessions: false, malformedRate: false, sessionLifetimeSeconds: null };
  const clientJourney=attachClientJourneyFixture(tables,state);
  let sequence = 0;
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const json = (data, status = 200, headers = {}) => {
      response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      response.end(data === null ? '' : JSON.stringify(data));
    };
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const bytes = Buffer.concat(chunks);
      if (url.pathname.startsWith('/storage/v1/')) {
        requests.push({ method: request.method, path: url.pathname, query: url.searchParams, byteLength: bytes.length });
        if (request.headers.apikey !== TEST_SERVICE_KEY || request.headers.authorization !== `Bearer ${TEST_SERVICE_KEY}`) return json({ error: 'Synthetic credential rejected' }, 403);
        if (state.storageUnavailable) return json({ error: 'Synthetic Storage failure' }, 503);
        if (request.method === 'POST' && url.pathname.startsWith('/storage/v1/object/project-media-private/thumbs/')) {
          const key = url.pathname.replace('/storage/v1/object/', '');
          if (storage.has(key) || request.headers['x-upsert'] === 'true') return json({ error: 'Synthetic collision' }, 409);
          storage.set(key, bytes);
          return json({ Key: key }, 200);
        }
        if (request.method === 'GET' && url.pathname.startsWith('/storage/v1/object/authenticated/')) {
          const key = url.pathname.replace('/storage/v1/object/authenticated/', '');
          const value = storage.get(key);
          if (!value) return json({ error: 'Synthetic object missing' }, 404);
          // Optional GET-only transport faults for A10. Auth/JSON routes and the
          // stored object itself remain unchanged; real HTTP framing is exercised.
          const fault = state.storageResponse;
          const payload = fault?.bytes ?? value;
          const headers = { 'Content-Type': 'image/webp' };
          if (!fault?.omitLength) headers['Content-Length'] = fault?.contentLength ?? payload.length;
          response.writeHead(200, headers);
          if (fault?.omitLength || fault?.chunkBytes) {
            const chunkBytes = fault?.chunkBytes ?? 16 * 1024;
            for (let offset = 0; offset < payload.length; offset += chunkBytes) response.write(payload.subarray(offset, offset + chunkBytes));
            return response.end();
          }
          return response.end(payload);
        }
        if (request.method === 'DELETE' && url.pathname.startsWith('/storage/v1/object/')) {
          const body = JSON.parse(bytes.toString());
          const bucket = url.pathname.replace('/storage/v1/object/', '');
          for (const key of body.prefixes || []) storage.delete(`${bucket}/${key}`);
          return json([]);
        }
        return json({ error: 'Synthetic Storage route unavailable' }, 404);
      }
      const text = Buffer.concat(chunks).toString();
      const body = text ? JSON.parse(text) : null;
      requests.push({ method: request.method, path: url.pathname, query: url.searchParams, body });
      if (state.unavailable) return json({ error: 'Synthetic outage' }, 503);
      if (request.headers.apikey !== TEST_SERVICE_KEY || request.headers.authorization !== `Bearer ${TEST_SERVICE_KEY}`) {
        return json({ error: 'Synthetic service credential rejected' }, 403);
      }
      if (clientJourney({url,body,json})) return;
      if (url.pathname === '/rest/v1/rpc/dashboard_consume_login_attempt') {
        if (state.malformedRate) return json({ allowed: 'invalid', retry_after: null });
        if (request.method !== 'POST' || !/^[a-f0-9]{64}$/.test(body?.p_ip_key)) return json({ error: 'Invalid RPC request' }, 400);
        const now = Date.now();
        const keys = [['global', 30], [body.p_ip_key, 5]];
        const buckets = keys.map(([key, maximum]) => {
          let bucket = rate.get(key);
          if (!bucket || bucket.until <= now) {
            bucket = { attempts: 0, until: now + 15 * 60 * 1000 };
            rate.set(key, bucket);
          }
          return { bucket, maximum };
        });
        const allowed = buckets.every(({ bucket, maximum }) => bucket.attempts < maximum);
        if (allowed) for (const { bucket } of buckets) bucket.attempts++;
        return json({ allowed, retry_after: Math.ceil(Math.max(...buckets.map(({ bucket }) => bucket.until - now)) / 1000) });
      }
      if(url.pathname==='/rest/v1/rpc/dashboard_metrics') return json({visitorsToday:1,leadsThisWeek:0,leadsThisMonth:0,totalConversations:0,leadsByStatus:{},leadsPerWeek:[],avgMessages:0,avgDurationSec:0,avgDurationMin:0,conversionRatio:0,visitsPerDay:[]});
      if(url.pathname==='/rest/v1/rpc/dashboard_save_content') {
        const target=tables[body.p_entity];const changed=body.p_changes.map(item=>target.find(row=>row.id===item.id));
        if(changed.some(row=>!row)) return json({error:'Synthetic missing content'},404);
        body.p_changes.forEach((item,index)=>Object.assign(changed[index],item.fields));return json(changed);
      }
      const matches = row => [...url.searchParams].every(([key, value]) => {
        if(key==='or')return value.slice(1,-1).split(',').some(term=>{const match=/^(\w+)\.ilike\.\*(.*)\*$/.exec(term);return match&&String(row[match[1]]??'').toLocaleLowerCase().includes(match[2].toLocaleLowerCase());});
        if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
        if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(row[key]));
        const comparison = /^(gte|lte|gt|lt)\.(.*)$/.exec(value);
        if (comparison) {
          if (row[key] === null || row[key] === undefined) return false;
          const left = row[key], right = typeof left === 'number' ? Number(comparison[2]) : comparison[2];
          if (comparison[1] === 'gte') return left >= right;
          if (comparison[1] === 'lte') return left <= right;
          if (comparison[1] === 'gt') return left > right;
          return left < right;
        }
        return true;
      });
      if (url.pathname === '/rest/v1/dashboard_sessions') {
        if (request.method === 'POST') {
          if (!/^[a-f0-9]{64}$/.test(body?.token_hash) || !/^[a-f0-9]{64}$/.test(body?.credential_version)) return json({ error: 'Invalid session row' }, 400);
          const stored = copy(body);
          if (state.sessionLifetimeSeconds !== null) {
            stored.expires_at = new Date(Date.now() + state.sessionLifetimeSeconds * 1000).toISOString();
          }
          sessions.set(body.token_hash, stored);
          return json(null, 201);
        }
        if (request.method === 'DELETE') {
          for (const [key, row] of sessions) if (matches(row)) sessions.delete(key);
          return json(null, 204);
        }
        if (state.malformedSessions) return json({ unexpected: true });
        const rows = [...sessions.values()].filter(matches);
        const limit = Number(url.searchParams.get('limit')) || rows.length;
        return json(rows.slice(0, limit).map(row => ({ expires_at: row.expires_at })));
      }
      const table = url.pathname.replace('/rest/v1/', '');
      if (!(table in tables)) return json({ error: 'Synthetic table not implemented' }, 404);
      // A06 failure modes apply only to project storage, leaving auth available.
      if (table === 'projects' && state.projectUnavailable) return json({ error: 'Synthetic project outage' }, 503);
      if (table === 'projects' && state.missingProjectPublication) return json({ error: 'Synthetic missing publication column' }, 400);
      if (table === 'projects' && request.method === 'GET' && state.malformedProjects) return json({ unexpected: true });
      if (table === 'projects' && request.method === 'GET' && state.ignoreProjectFilters) return json(tables.projects);
      if (request.method === 'GET') {
        let rows=tables[table].filter(matches);
        const order=url.searchParams.get('order'); if(order) rows.sort((a,b)=> {for(const part of order.split(',')){const [key,direction]=part.split('.');const compare=typeof a[key]==='number'&&typeof b[key]==='number'?a[key]-b[key]:String(a[key]??'').localeCompare(String(b[key]??''));if(compare)return direction==='desc'?-compare:compare;}return 0;});
        const total=rows.length;const offset=Number(url.searchParams.get('offset')||0);const limit=Number(url.searchParams.get('limit')||rows.length||1);
        const headers=request.headers.prefer?.includes('count=exact')?{'Content-Range':`${offset}-${Math.max(offset,offset+Math.min(limit,total-offset)-1)}/${total}`} : {};
        return json(rows.slice(offset,offset+limit),200,headers);
      }
      if (request.method === 'POST') {
        const inserted = (Array.isArray(body) ? body : [body]).map(row => ({ id:randomUUID(),created_at:new Date().toISOString(),...row }));
        if(inserted.some(row=>tables[table].some(existing=>existing.id===row.id))) return json({error:'Synthetic duplicate primary key'},409);
        for (const row of inserted) {
          if (request.headers.prefer?.includes('resolution=merge-duplicates') && row.key) {
            tables[table] = tables[table].filter(existing => existing.key !== row.key);
          }
          tables[table].push(row);
        }
        return json(inserted, 201);
      }
      if (request.method === 'PATCH') {
        const changed = tables[table].filter(matches);
        for (const row of changed) Object.assign(row, body);
        return json(changed);
      }
      if (request.method === 'DELETE') {
        const removed = tables[table].filter(matches);
        tables[table] = tables[table].filter(row => !matches(row));
        if (request.headers.prefer?.includes('return=representation')) return json(removed);
        return json(null, 204);
      }
      return json({ error: 'Unsupported synthetic request' }, 405);
    } catch {
      return json({ error: 'Malformed synthetic request' }, 400);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, sessions, tables, requests, rate, state, storage,
    environment(dashboardOrigin) {
      return {
        DASHBOARD_ORIGIN: dashboardOrigin, DASHBOARD_PASSWORD_HASH: TEST_PASSWORD_HASH,
        DASHBOARD_SECRET: TEST_LEGACY_SECRET, DASHBOARD_PIN: '1111',
        SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_KEY,
        OPENROUTER_API_KEY: '', RESEND_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
        SITE_URL: dashboardOrigin, EMAIL_FROM: 'Synthetic <synthetic@example.invalid>',
      };
    },
    resetRate() { rate.clear(); },
    async close() { await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); },
  };
}
