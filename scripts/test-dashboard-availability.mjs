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
const origin = 'http://localhost:4341', env = fixture.environment(origin);
const network = installFetchGuard([fixture.origin]);
const guardedFetch = globalThis.fetch;
let failure = '';
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === fixture.origin && ['/rest/v1/availability', '/rest/v1/availability_overrides'].includes(url.pathname) && failure) {
    if (failure === 'malformed') return Response.json({ private: 'SYNTHETIC_PRIVATE_CANARY' });
    return Response.json({ private: 'SYNTHETIC_PRIVATE_CANARY' }, { status: 503 });
  }
  return guardedFetch(input, init);
};
const vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  resolve: { alias: { 'astro:middleware': 'astro/middleware' } },
  define: Object.fromEntries(Object.entries({ ...env, PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' }).map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
let cookie = '', csrf = '', middleware, routes;
let checks = 0, groups = 0;
const equal = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { checks++; assert.ok(value, message); };
async function group(label, action) { await action(); console.log(`ok ${++groups} - ${label}`); }
function request(url, { method = 'GET', body, headers = {} } = {}) {
  return new Request(new URL(url, origin), { method, headers: { ...(cookie ? { cookie } : {}),
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(method === 'GET' ? {} : { origin, 'x-dashboard-csrf': csrf }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function dispatch(url, options) {
  const req = request(url, options), cookies = new AstroCookies(req);
  const context = { request: req, url: new URL(req.url), cookies, locals: {}, params: {}, clientAddress: '192.0.2.42' };
  const response = await middleware(context, () => routes.get(context.url.pathname)[req.method](context));
  for (const value of cookies.headers()) response.headers.append('set-cookie', value);
  return response;
}
const endpoint = '/api/dashboard/availability';
const recurring = { day_of_week: 1, start_time: '10:00', end_time: '14:00' };
const opening = { kind: 'override', override_date: '2026-10-06', start_time: '15:00', end_time: '17:00', is_available: true, note: 'Extra hours' };
try {
  routes = new Map([[endpoint, await vite.ssrLoadModule('/src/pages/api/dashboard/availability.ts')],
    ['/api/dashboard/auth/login', await vite.ssrLoadModule('/src/pages/api/dashboard/auth/login.ts')]]);
  middleware = (await vite.ssrLoadModule('/src/middleware.ts')).onRequest;
  await group('Agenda reads and writes require dashboard authorization', async () => {
    equal((await dispatch(endpoint)).status, 401);
    equal((await dispatch(endpoint, { method: 'POST', body: recurring })).status, 401);
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const before = fixture.requests.filter(row => ['/rest/v1/availability', '/rest/v1/availability_overrides'].includes(row.path)).length;
      equal((await dispatch(endpoint, { method, body: { ...opening, id: randomUUID() } })).status, 401);
      equal(fixture.requests.filter(row => ['/rest/v1/availability', '/rest/v1/availability_overrides'].includes(row.path)).length, before);
    }
    equal(fixture.tables.availability.length, 0);
    equal(fixture.tables.availability_overrides.length, 0);
  });
  const login = await dispatch('/api/dashboard/auth/login', { method: 'POST', body: { password: TEST_PASSWORD } });
  equal(login.status, 200); cookie = login.headers.get('set-cookie').split(';')[0];
  const auth = await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');
  csrf = (await auth.getDashboardSession(request(endpoint))).csrfToken;
  await group('Origin and CSRF checks stop every mutation before schedule writes', async () => {
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      for (const headers of [{ 'x-dashboard-csrf': '' }, { origin: 'https://untrusted.example.invalid' }, { 'sec-fetch-site': 'cross-site' }]) {
        const before = fixture.requests.filter(row => ['/rest/v1/availability', '/rest/v1/availability_overrides'].includes(row.path)).length;
        equal((await dispatch(endpoint, { method, body: opening, headers })).status, 403);
        equal(fixture.requests.filter(row => ['/rest/v1/availability', '/rest/v1/availability_overrides'].includes(row.path)).length, before);
      }
    }
  });
  await group('Weekly legacy creates, full edits, pause and resume keep one row', async () => {
    const saved = await dispatch(endpoint, { method: 'POST', body: recurring }); equal(saved.status, 200);
    const [row] = await saved.json(); equal(row.is_active, true); equal(fixture.tables.availability.length, 1);
    const edited = await dispatch(endpoint, { method: 'PATCH', body: { kind: 'recurring', id: row.id, day_of_week: 2, start_time: '11:00', end_time: '13:00', is_active: false } });
    equal(edited.status, 200); const [paused] = await edited.json(); equal(paused.day_of_week, 2); equal(paused.is_active, false);
    const withoutActive = await dispatch(endpoint, { method: 'PATCH', body: { id: row.id, day_of_week: 2, start_time: '12:00', end_time: '14:00' } });
    equal(withoutActive.status, 200); equal((await withoutActive.json())[0].is_active, false);
    equal((await dispatch(endpoint, { method: 'PATCH', body: { id: row.id, day_of_week: 2, start_time: '12:00', end_time: '14:00', is_active: true } })).status, 200);
    equal(fixture.tables.availability.length, 1); equal(fixture.tables.availability[0].is_active, true);
  });
  await group('Dated openings, partial/full-day blocks and edits preserve SQL semantics', async () => {
    const saved = await dispatch(endpoint, { method: 'POST', body: opening }); equal(saved.status, 200);
    const [row] = await saved.json(); equal(row.note, 'Extra hours'); equal(row.is_available, true);
    const edited = await dispatch(endpoint, { method: 'PATCH', body: { ...opening, id: row.id, start_time: '16:00', end_time: '18:00', note: '  Edited hours  ' } });
    equal(edited.status, 200); equal((await edited.json())[0].note, 'Edited hours');
    const partial = await dispatch(endpoint, { method: 'POST', body: { ...opening, start_time: '16:30', end_time: '17:00', is_available: false, note: null } });
    equal(partial.status, 200); equal((await partial.json())[0].is_available, false);
    const closed = await dispatch(endpoint, { method: 'POST', body: { ...opening, override_date: '2026-10-07', start_time: null, end_time: null, is_available: false } });
    equal(closed.status, 200); const [block] = await closed.json(); equal(block.start_time, null); equal(block.end_time, null);
    const allDayOpening = await dispatch(endpoint, { method: 'POST', body: { ...opening, override_date: '2026-10-08', start_time: null, end_time: null } });
    equal(allDayOpening.status, 200);
    const withoutNote = { ...opening, id: row.id, start_time: '17:00', end_time: '19:00' }; delete withoutNote.note;
    equal((await dispatch(endpoint, { method: 'PATCH', body: withoutNote })).status, 200);
    equal(fixture.tables.availability_overrides.find(item => item.id === row.id).note, 'Edited hours');
    const rows = (await (await dispatch(endpoint)).json()).overrides;
    equal(rows.length, 4); equal(rows[0].override_date, '2026-10-08');
  });
  await group('Exact duplicates are rejected while overlapping windows and blocks can coexist', async () => {
    fixture.tables.availability[0].start_time = '12:00:00'; fixture.tables.availability[0].end_time = '14:00:00';
    equal((await dispatch(endpoint, { method: 'POST', body: { day_of_week: 2, start_time: '12:00', end_time: '14:00' } })).status, 400);
    equal((await dispatch(endpoint, { method: 'POST', body: { day_of_week: 2, start_time: '13:00', end_time: '15:00' } })).status, 200);
    equal((await dispatch(endpoint, { method: 'POST', body: { ...opening, start_time: '17:00', end_time: '19:00' } })).status, 400);
    equal((await dispatch(endpoint, { method: 'POST', body: { ...opening, start_time: '17:00', end_time: '19:00', is_available: false } })).status, 200);
  });
  await group('Invalid clocks, civil dates, flags, identities and extra fields never write data', async () => {
    const invalid = [
      { ...recurring, day_of_week: '1' }, { ...recurring, day_of_week: 7 }, { ...recurring, start_time: '25:00' },
      { ...recurring, start_time: '10:00:00' }, { ...recurring, end_time: '09:00' }, { ...recurring, is_active: 'true' },
      { ...recurring, start_time: '10:00', end_time: '10:15' },
      { ...recurring, start_time: '10:15', end_time: '10:45' },
      { ...recurring, id: randomUUID() }, { ...recurring, kind: 'unknown' }, { ...recurring, created_at: 'private' },
      { ...opening, override_date: '2026-02-30' }, { ...opening, is_available: 1 }, { ...opening, note: 'x'.repeat(501) },
      { ...opening, note: '\u0000' }, { ...opening, start_time: null }, { ...opening, end_time: null },
      { ...opening, day_of_week: 1 }, { ...opening, end_time: '24:00' }, { ...opening, override_date: '2200-01-01' },
      { ...opening, start_time: '10:00', end_time: '10:15' },
      { ...opening, start_time: '10:15', end_time: '10:45' },
    ];
    for (const body of invalid) {
      const writes = fixture.requests.filter(row => row.method !== 'GET').length;
      equal((await dispatch(endpoint, { method: 'POST', body })).status, 400);
      equal(fixture.requests.filter(row => row.method !== 'GET').length, writes);
    }
    equal((await dispatch(endpoint, { method: 'PATCH', body: { ...recurring, id: 'invalid' } })).status, 400);
    equal((await dispatch(endpoint, { method: 'DELETE', body: { id: fixture.tables.availability[0].id, extra: true } })).status, 400);
    equal((await dispatch(endpoint, { method: 'PATCH', body: { ...recurring, id: randomUUID() } })).status, 404);
    equal((await dispatch(endpoint, { method: 'POST', body: { ...opening, start_time: '10:00', end_time: '10:15', is_available: false } })).status, 200);
    equal((await dispatch(endpoint, { method: 'POST', body: { ...opening, start_time: '10:15', end_time: '11:00' } })).status, 200);
  });
  await group('Visible date ranges return all dated rules and reject malformed/excessive ranges', async () => {
    const distinctDay = { ...opening, override_date: '2026-10-05', start_time: null, end_time: null, is_available: false };
    equal((await dispatch(endpoint, { method: 'POST', body: distinctDay })).status, 200);
    const exactPreviousDay = await dispatch(`${endpoint}?from=2026-10-04&to=2026-10-04`);
    equal(exactPreviousDay.status, 200); equal((await exactPreviousDay.json()).overrides, []);
    const exactBlockedDay = await dispatch(`${endpoint}?from=2026-10-05&to=2026-10-05`);
    equal(exactBlockedDay.status, 200);
    const blockedRows = (await exactBlockedDay.json()).overrides;
    equal(blockedRows.length, 1); equal(blockedRows[0].override_date, '2026-10-05'); equal(blockedRows[0].is_available, false);
    const strictRange = await fetch(`${fixture.origin}/rest/v1/availability_overrides?override_date=gt.2026-10-05&override_date=lt.2026-10-07`, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
    equal(strictRange.status, 200); const strictRows = await strictRange.json(); ok(strictRows.length > 0); ok(strictRows.every(row => row.override_date === '2026-10-06'));
    const previous = [...fixture.tables.availability_overrides];
    fixture.tables.availability_overrides = Array.from({ length: 125 }, (_, index) => ({ id: randomUUID(), override_date: '2026-10-06', start_time: `${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}`, end_time: '23:00', is_available: false }));
    fixture.tables.availability_overrides.push({ id: randomUUID(), override_date: '2027-01-01', start_time: null, end_time: null, is_available: false });
    equal((await (await dispatch(endpoint)).json()).overrides.length, 100);
    const response = await dispatch(`${endpoint}?from=2026-10-05&to=2026-10-11`); equal(response.status, 200);
    const data = await response.json(); equal(data.overrides.length, 125); ok(data.overrides.every(row => row.override_date === '2026-10-06'));
    equal(data.availability.length, fixture.tables.availability.length);
    const read = fixture.requests.findLast(row => row.path === '/rest/v1/availability_overrides');
    equal(read.query.getAll('override_date'), ['gte.2026-10-05', 'lte.2026-10-11']); equal(read.query.has('limit'), false);
    for (const query of ['from=2026-10-05', 'to=2026-10-11', 'from=2026-02-30&to=2026-10-11', 'from=2026-10-11&to=2026-10-05', 'from=2026-10-05&to=2027-10-07', 'from=2026-10-05&from=2026-10-06&to=2026-10-11']) equal((await dispatch(`${endpoint}?${query}`)).status, 400);
    fixture.tables.availability_overrides = previous;
  });
  await group('Deleting targets the chosen schedule table and missing/outage results do not succeed', async () => {
    const weekly = fixture.tables.availability[0], override = fixture.tables.availability_overrides[0];
    equal((await dispatch(endpoint, { method: 'DELETE', body: { id: weekly.id } })).status, 200);
    equal(fixture.tables.availability.some(row => row.id === weekly.id), false);
    equal(fixture.tables.availability_overrides.some(row => row.id === override.id), true);
    equal((await dispatch(endpoint, { method: 'DELETE', body: { id: override.id, kind: 'override' } })).status, 200);
    equal((await dispatch(endpoint, { method: 'DELETE', body: { id: override.id, kind: 'override' } })).status, 404);
    for (const state of ['outage', 'malformed']) {
      failure = state;
      for (const options of [{}, { method: 'POST', body: recurring }, { method: 'PATCH', body: { ...recurring, id: fixture.tables.availability[0].id } }, { method: 'DELETE', body: { id: fixture.tables.availability[0].id } }]) {
        const response = await dispatch(endpoint, options); equal(response.status, 503);
        ok(!(await response.text()).includes('SYNTHETIC_PRIVATE_CANARY')); ok(response.headers.get('cache-control').includes('no-store'));
      }
      failure = '';
    }
  });
  equal(network.blocked, []);
  console.log(`PASS admin availability: ${groups} groups, ${checks} checks; synthetic data only, no remote requests.`);
} finally {
  globalThis.fetch = guardedFetch;
  await vite.close(); await fixture.close(); network.restore();
}
