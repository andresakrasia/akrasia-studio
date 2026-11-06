import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { createDashboardTestFixture, TEST_PASSWORD, TEST_LEGACY_SECRET, TEST_PASSWORD_HASH, tokenDigest } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Run with: node scripts/test-dashboard-auth.mjs
// No .env is loaded, no deployed provider is contacted, and all stored rows are synthetic.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { AstroCookies } = await import(pathToFileURL(path.join(root, 'node_modules/astro/dist/core/cookies/index.js')));
const fixture = await createDashboardTestFixture();
const network = installFetchGuard([fixture.origin]);
const origin = 'http://localhost:4322';
const environment = fixture.environment(origin);
const applications = [];
const warnings = [];
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...values) => warnings.push(values.map(String).join(' '));
console.error = (...values) => warnings.push(values.map(String).join(' '));
let groups = 0;
let assertions = 0;

async function loadApplication(env, production = false) {
  const vite = await createServer({
    root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
    resolve: { alias: { 'astro:middleware': 'astro/middleware' } },
    define: Object.fromEntries(Object.entries({ ...env, PROD: production, DEV: !production, SSR: true, MODE: 'test', BASE_URL: '/' })
      .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
  });
  applications.push(vite);
  const auth = await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');
  const { onRequest } = await vite.ssrLoadModule('/src/middleware.ts');
  const routes = new Map();
  async function discover(directory, relative = '') {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const name = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await discover(path.join(directory, entry.name), name);
      else if (entry.name.endsWith('.ts')) {
        routes.set(`/api/dashboard${name.slice(0, -3)}`, await vite.ssrLoadModule(`/src/pages/api/dashboard${name}`));
      }
    }
  }
  await discover(path.join(root, 'src/pages/api/dashboard'));
  return { auth, onRequest, routes };
}

function equal(actual, expected, message) {
  assertions++;
  assert.equal(actual, expected, message);
}
function ok(actual, message) { assertions++; assert.ok(actual, message); }
async function group(name, test) {
  await test();
  groups++;
  console.log(`ok ${groups} - ${name}`);
}
function request(url, options = {}) {
  const { method = 'GET', headers = {}, body, cookie, csrf, ...rest } = options;
  const outgoingHeaders = new Headers(headers);
  if (cookie) outgoingHeaders.set('cookie', cookie);
  if (csrf) outgoingHeaders.set('x-dashboard-csrf', csrf);
  if (body !== undefined && !(body instanceof FormData) && !outgoingHeaders.has('content-type')) outgoingHeaders.set('content-type', 'application/json');
  return new Request(new URL(url, origin), { method, headers: outgoingHeaders, ...rest,
    ...(body === undefined ? {} : { body: typeof body === 'string' || body instanceof FormData ? body : JSON.stringify(body) }),
  });
}
async function dispatch(app, url, options = {}, nextOverride) {
  const req = request(url, options);
  const cookies = new AstroCookies(req);
  const context = { request: req, url: new URL(req.url), cookies, locals: {}, params: {},
    clientAddress: options.clientAddress || '192.0.2.7' };
  let nextCalls = 0;
  const response = await app.onRequest(context, async () => {
    nextCalls++;
    if (nextOverride) return nextOverride(context);
    const pathname = context.url.pathname.replace(/\/+$/, '');
    const handler = app.routes.get(pathname)?.[req.method];
    return handler ? handler(context) : new Response('Synthetic route missing', { status: 404 });
  });
  return { response, cookies: [...cookies.headers()], context, nextCalls };
}
function securityHeaders(response) {
  equal(response.headers.get('cache-control'), 'no-store, private');
  equal(response.headers.get('cdn-cache-control'), 'no-store');
  equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
  equal(response.headers.get('referrer-policy'), 'no-referrer');
  equal(response.headers.get('x-frame-options'), 'DENY');
  equal(response.headers.get('x-content-type-options'), 'nosniff');
  ok(response.headers.get('x-robots-tag')?.includes('noindex'));
  ok(response.headers.get('content-security-policy')?.includes("frame-ancestors 'none'"));
  ok(response.headers.get('content-security-policy')?.includes("connect-src 'self'"));
}
async function login(app, password = TEST_PASSWORD, options = {}) {
  return dispatch(app, '/api/dashboard/auth/login', { method: 'POST', body: { password }, headers: { origin }, ...options });
}
function cookieFrom(result, name) {
  const header = result.cookies.find(value => value.startsWith(`${name}=`));
  ok(header, 'Session cookie emitted');
  return header.split(';')[0];
}

try {
  const app = await loadApplication(environment);
  const protectedRoutes = [...app.routes].filter(([url]) => !url.includes('/auth/'));
  const protectedHandlers = protectedRoutes.flatMap(([url, module]) => Object.entries(module)
    .filter(([method, value]) => /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|ALL)$/.test(method) && typeof value === 'function')
    .map(([method, handler]) => ({ url, method, handler })));
  let cookie;
  let token;
  let csrf;

  await group('Coverage: all 24 administrative routes and 50 handlers discovered', async () => {
    equal(protectedRoutes.length, 24);
    equal(protectedHandlers.length, 50);
  });

  await group('Each handler rejects direct requests before any data/provider access', async () => {
    const countBefore = fixture.requests.length;
    const attacks = [
      {}, { cookie: 'dashboard_pin_verified=true' },
      { cookie: `${app.auth.DASHBOARD_COOKIE}=${'A'.repeat(43)}` },
      { headers: { 'x-dashboard-secret': TEST_LEGACY_SECRET } },
      { suffix: `?secret=${TEST_LEGACY_SECRET}` },
      { cookie: 'dashboard_pin_verified=true', headers: { 'x-dashboard-secret': TEST_LEGACY_SECRET }, suffix: `?secret=${TEST_LEGACY_SECRET}` },
    ];
    for (const { url, method, handler } of protectedHandlers) {
      for (const { suffix = '', ...attack } of attacks) {
        const req = request(`${url}${suffix}`, { method, ...attack, ...(method === 'GET' || method === 'HEAD' ? {} : { body: {} }) });
        const result = await handler({ request: req, url: new URL(req.url), params: {}, locals: {}, cookies: new AstroCookies(req) });
        equal(result.status, 401, `${method} ${url} must reject request without middleware authorization`);
      }
    }
    equal(fixture.requests.length, countBefore, 'Unauthorized direct handlers made no REST/provider request');
  });

  await group('Middleware rejects all administrative methods without a real server session', async () => {
    const attacks = [
      {}, { cookie: 'dashboard_pin_verified=true' },
      { cookie: `${app.auth.DASHBOARD_COOKIE}=true` },
      { cookie: `${app.auth.DASHBOARD_COOKIE}=${'A'.repeat(43)}` },
      { headers: { 'x-dashboard-secret': TEST_LEGACY_SECRET } },
      { suffix: `?secret=${TEST_LEGACY_SECRET}` },
    ];
    for (const { url, method } of protectedHandlers) {
      for (const { suffix = '', ...attack } of attacks) {
        const result = await dispatch(app, `${url}${suffix}`, { method, ...attack, ...(method === 'GET' ? {} : { body: {} }) });
        equal(result.response.status, 401, `${method} ${url}`);
        equal(result.nextCalls, 0, 'Guard rejected request before handler');
      }
    }
  });

  await group('HEAD, OPTIONS, missing, encoded and trailing paths remain guarded', async () => {
    for (const url of ['/api/dashboard', '/api/dashboard/', '/api/dashboard/missing', '/api/dashboard/projects/', '/api/%64ashboard/projects', '/api/dashboard%2Fprojects', '/api/dashboard/projects//']) {
      for (const method of ['GET', 'HEAD', 'OPTIONS', 'POST']) {
        const result = await dispatch(app, url, { method });
        equal(result.response.status, 401, `${method} ${url}`);
        equal(result.nextCalls, 0);
        securityHeaders(result.response);
      }
    }
    equal((await dispatch(app, '/api/dashboard/%ZZ')).response.status, 400);
    const unrelated = await dispatch(app, '/api/projects', {}, () => new Response('public', { status: 200 }));
    equal(unrelated.response.status, 200);
    equal(unrelated.nextCalls, 1);
  });

  await group('Anonymous dashboard navigation and old credential URLs safely redirect', async () => {
    const panel = await dispatch(app, '/dashboard');
    equal(panel.response.status, 303);
    equal(panel.response.headers.get('location'), '/dashboard/login');
    securityHeaders(panel.response);
    const legacy = await dispatch(app, `/dashboard/${TEST_LEGACY_SECRET}?secret=${TEST_LEGACY_SECRET}`);
    equal(legacy.response.status, 303);
    equal(legacy.response.headers.get('location'), '/dashboard');
    equal(legacy.nextCalls, 0);
    const params = await dispatch(app, `/dashboard?tab=chat&visitor_id=synthetic&secret=${TEST_LEGACY_SECRET}&returnTo=https://evil.example`);
    let target = params.response.headers.get('location');
    ok(!target.includes(TEST_LEGACY_SECRET));
    ok(!target.includes('evil.example'));
    if (target.startsWith('/dashboard?')) target = (await dispatch(app, target)).response.headers.get('location');
    ok(target.includes('returnTo='));
    ok(decodeURIComponent(target).includes('tab=chat'));
    const loginPage = await dispatch(app, '/dashboard/login', {}, () => new Response('Synthetic login form'));
    equal(loginPage.response.status, 200);
    securityHeaders(loginPage.response);
  });

  await group('Booking email links preserve only one valid booking date through anonymous login', async () => {
    const requested = '/dashboard?tab=bookings&date=2026-10-20';
    const result = await dispatch(app, requested);
    equal(result.response.status, 303);
    equal(new URL(result.response.headers.get('location'), origin).searchParams.get('returnTo'), requested);
    securityHeaders(result.response);
    const secret = await dispatch(app, `${requested}&secret=${TEST_LEGACY_SECRET}&returnTo=https://evil.example`);
    equal(secret.response.headers.get('location'), requested);
    ok(!secret.response.headers.get('location').includes(TEST_LEGACY_SECRET));
    for (const query of ['tab=bookings&date=2026-02-30','tab=bookings&date=20-10-2026','tab=bookings&date=2026-10-20&date=2026-10-21',
      'tab=bookings&tab=bookings&date=2026-10-20','tab=overview&date=2026-10-20','date=2026-10-20',
      'tab=bookings&date=https%3A%2F%2Fevil.example','tab=bookings&date=2026-10-20%0Asecret']) {
      const invalid = await dispatch(app, `/dashboard?${query}`);
      equal(invalid.response.status, 303);
      const destination = new URL(invalid.response.headers.get('location'), origin);
      equal(destination.searchParams.has('date'), false);
      equal(destination.pathname, '/dashboard');
    }
  });

  await group('Login rejects foreign/missing Origin and methods before expensive verification', async () => {
    const before = fixture.requests.length;
    for (const headers of [{}, { origin: 'https://evil.example' }, { origin, 'sec-fetch-site': 'cross-site' }]) {
      const response = await dispatch(app, '/api/dashboard/auth/login', { method: 'POST', headers, body: { password: TEST_PASSWORD } });
      equal(response.response.status, 403);
      equal(response.nextCalls, 0);
    }
    for (const method of ['GET', 'HEAD', 'OPTIONS', 'PUT']) equal((await dispatch(app, '/api/dashboard/auth/login', { method, headers: { origin } })).response.status, 405);
    equal(fixture.requests.length, before);
  });

  await group('Login handles malformed, oversized and incorrect credentials', async () => {
    for (const [options, status] of [
      [{ body: '{}', headers: { origin, 'content-type': 'text/plain' } }, 415],
      [{ body: '{malformed' }, 400],
      [{ body: { password: 123 } }, 400],
      [{ body: { password: 'wrong' } }, 401],
      [{ body: { password: 'Incorrect synthetic password 2026' } }, 401],
      [{ body: { password: 'x'.repeat(2050) } }, 413],
    ]) {
      fixture.resetRate();
      const result = await dispatch(app, '/api/dashboard/auth/login', { method: 'POST', headers: { origin }, ...options });
      equal(result.response.status, status);
      equal(result.cookies.length, 0);
    }
    fixture.resetRate();
    const noType = await dispatch(app, '/api/dashboard/auth/login', { method: 'POST', headers: { origin }, body: undefined });
    equal(noType.response.status, 415);
    equal(fixture.sessions.size, 0);
  });

  await group('Successful login stores only a hash and emits an HttpOnly Strict expiring cookie', async () => {
    fixture.resetRate();
    const result = await login(app);
    equal(result.response.status, 200);
    securityHeaders(result.response);
    cookie = cookieFrom(result, app.auth.DASHBOARD_COOKIE);
    token = cookie.slice(cookie.indexOf('=') + 1);
    ok(/^[A-Za-z0-9_-]{43}$/.test(token));
    const header = result.cookies.find(value => value.startsWith(`${app.auth.DASHBOARD_COOKIE}=`));
    ok(header.includes('HttpOnly'));
    ok(/SameSite=Strict/i.test(header));
    ok(header.includes('Path=/'));
    ok(header.includes('Max-Age=28800'));
    const row = fixture.sessions.get(tokenDigest(token));
    ok(row);
    equal(row.credential_version, tokenDigest(TEST_PASSWORD_HASH));
    ok(!JSON.stringify(row).includes(token), 'Database did not store bearer cookie');
    const body = await result.response.json();
    equal(body.ok, true);
    equal(body.expiresAt, row.expires_at);
    ok(!JSON.stringify(body).includes(token), 'Login JSON did not disclose bearer cookie');
    const lifetime = Date.parse(row.expires_at) - Date.now();
    ok(lifetime > 28790_000 && lifetime <= 28800_000);
    const session = await app.auth.getDashboardSession(request('/api/dashboard/projects', { cookie }));
    csrf = session.csrfToken;
    ok(csrf && csrf !== token);
  });

  await group('Signed-in login redirects retain the booking day and strip foreign destinations and credentials', async () => {
    const requested = '/dashboard?tab=bookings&date=2026-10-20';
    const link = `/dashboard/login?returnTo=${encodeURIComponent(requested)}`;
    const result = await dispatch(app, link, { cookie });
    equal(result.response.status, 303);
    equal(result.response.headers.get('location'), requested);
    equal(result.nextCalls, 0);
    securityHeaders(result.response);
    const panel = await dispatch(app, requested, { cookie }, () => new Response('Synthetic booking panel'));
    equal(panel.response.status, 200);
    equal(panel.nextCalls, 1);
    for (const target of ['https://evil.example/dashboard?tab=bookings&date=2026-10-20','//evil.example/dashboard',
      `/dashboard/${TEST_LEGACY_SECRET}?tab=bookings&date=2026-10-20`,'/api/dashboard/bookings']) {
      const invalid = await dispatch(app, `/dashboard/login?returnTo=${encodeURIComponent(target)}`, { cookie });
      equal(invalid.response.headers.get('location'), '/dashboard');
    }
    const clean = await dispatch(app, `/dashboard/login?returnTo=${encodeURIComponent(`${requested}&secret=${TEST_LEGACY_SECRET}&redirect=https://evil.example`)}`, { cookie });
    equal(clean.response.headers.get('location'), requested);
    for (const query of ['tab=bookings&date=2026-02-30','tab=overview&date=2026-10-20','tab=bookings&date=2026-10-20&date=2026-10-21']) {
      const invalid = await dispatch(app, `/dashboard/login?returnTo=${encodeURIComponent(`/dashboard?${query}`)}`, { cookie });
      equal(new URL(invalid.response.headers.get('location'), origin).searchParams.has('date'), false);
    }
    const duplicate = await dispatch(app, `${link}&returnTo=${encodeURIComponent(requested)}`, { cookie });
    equal(duplicate.response.headers.get('location'), '/dashboard');
  });

  await group('Valid server session reaches every read handler and synthetic data', async () => {
    const calendarBooking = { id: '00000000-0000-4000-8000-000000000032', booked_date: '2026-10-06', booked_time: '10:00:00', duration_min: 30, meet_url: 'https://example.invalid/synthetic-meeting', status: 'confirmed', created_at: '2026-10-04T12:00:00Z' };
    fixture.tables.bookings.push(calendarBooking);
    for (const { url, method } of protectedHandlers.filter(value => value.method === 'GET')) {
      const suffix = url.endsWith('/bookings/calendar') ? `?id=${calendarBooking.id}` : url.endsWith('/content') ? '?type=projects' : url.endsWith('/conversations') ? '?visitor_id=synthetic' : url.endsWith('/lead-context') ? `?lead_id=${fixture.tables.leads[0].id}` : '';
      const result = await dispatch(app, `${url}${suffix}`, { cookie });
      equal(result.response.status, 200, `Authorized ${url}`);
      equal(result.nextCalls, 1);
      ok(result.context.locals.dashboardSession);
      securityHeaders(result.response);
    }
    const direct = await app.routes.get('/api/dashboard/projects').GET({ request: request('/api/dashboard/projects', { cookie }), locals: {} });
    equal(direct.status, 401, 'Cookie itself never replaces middleware authorization');
  });

  await group('Each write method requires both same-origin headers and correct CSRF', async () => {
    for (const { url, method } of protectedHandlers.filter(value => value.method !== 'GET')) {
      for (const headers of [{}, { origin }, { origin: 'https://evil.example', 'x-dashboard-csrf': csrf }, { origin, 'x-dashboard-csrf': 'A'.repeat(43) }, { origin, 'x-dashboard-csrf': csrf, 'sec-fetch-site': 'cross-site' }]) {
        const result = await dispatch(app, url, { method, cookie, headers, body: {} });
        equal(result.response.status, 403, `${method} ${url} CSRF protection`);
        equal(result.nextCalls, 0);
      }
    }
    const crossSiteRead = await dispatch(app, '/api/dashboard/projects', { cookie, headers: { 'sec-fetch-site': 'cross-site' } });
    equal(crossSiteRead.response.status, 403);
  });

  await group('Authorized synthetic writes create, change and remove administrative data', async () => {
    const headers = { origin };
    const created = await dispatch(app, '/api/dashboard/clients', { method: 'POST', cookie, csrf, headers, body: { name: 'Nuevo cliente sintético', email: 'test@example.invalid' } });
    equal(created.response.status, 201);
    const client = await created.response.json();
    ok(fixture.tables.clients.some(row => row.id === client.id));
    const changed = await dispatch(app, '/api/dashboard/clients', { method: 'PATCH', cookie, csrf, headers, body: { id: client.id, name: 'Cliente actualizado' } });
    equal(changed.response.status, 200);
    equal(fixture.tables.clients.find(row => row.id === client.id).name, 'Cliente actualizado');
    const deleted = await dispatch(app, `/api/dashboard/clients?id=${client.id}`, { method: 'DELETE', cookie, csrf, headers });
    equal(deleted.response.status, 200);
    ok(!fixture.tables.clients.some(row => row.id === client.id));
    const content = await dispatch(app, '/api/dashboard/content', { method: 'PUT', cookie, csrf, headers, body: { key: 'case-studies', data: [{ id:'00000000-0000-4000-8000-000000000006',case_study:{brief:'Encargo ficticio',process:'Proceso ficticio',result:'Resultado ficticio',services:[]} }] } });
    equal(content.response.status, 200);
    equal(fixture.tables.projects[0].case_study.brief,'Encargo ficticio');
    const stats = await dispatch(app, '/api/dashboard/stats', { method: 'PATCH', cookie, csrf, headers, body: { key: 'projects', value: 2 } });
    equal(stats.response.status, 200);
    equal(fixture.tables.studio_stats.find(row => row.key === 'projects').value, 2);
    // These paths stop at local validation/configuration; they cannot send anything.
    equal((await dispatch(app, '/api/dashboard/send-email', { method: 'POST', cookie, csrf, headers, body: {} })).response.status, 400);
    equal((await dispatch(app, '/api/dashboard/ai-generate', { method: 'POST', cookie, csrf, headers, body: {} })).response.status, 400);
    equal((await dispatch(app, '/api/dashboard/upload', { method: 'POST', cookie, csrf, headers, body: new FormData() })).response.status, 400);
  });

  await group('Tampered, duplicate and malformed cookies cannot reuse a valid session', async () => {
    const mutated = `${app.auth.DASHBOARD_COOKIE}=${token[0] === 'A' ? 'B' : 'A'}${token.slice(1)}`;
    for (const attack of [mutated, `${cookie}; ${cookie}`, `${app.auth.DASHBOARD_COOKIE}=${token}%00`, `${app.auth.DASHBOARD_COOKIE}=${token.slice(1)}`, `dashboard_pin_verified=true; ${app.auth.DASHBOARD_COOKIE}=true`]) {
      const result = await dispatch(app, '/api/dashboard/projects', { cookie: attack });
      equal(result.response.status, 401);
      equal(result.nextCalls, 0);
    }
  });

  await group('Server expiry rejects an otherwise unchanged valid cookie', async () => {
    const row = fixture.sessions.get(tokenDigest(token));
    const expires = row.expires_at;
    for (const value of [new Date(Date.now() - 1).toISOString(), 'not-a-date']) {
      row.expires_at = value;
      const result = await dispatch(app, '/api/dashboard/projects', { cookie });
      equal(result.response.status, 401);
      equal(result.nextCalls, 0);
    }
    row.expires_at = expires;
    equal((await dispatch(app, '/api/dashboard/projects', { cookie })).response.status, 200);
  });

  await group('Credential rotation invalidates previously issued cookies immediately', async () => {
    const rotatedHash = `${TEST_PASSWORD_HASH.slice(0, -1)}${TEST_PASSWORD_HASH.endsWith('a') ? 'b' : 'a'}`;
    const rotated = await loadApplication({ ...environment, DASHBOARD_PASSWORD_HASH: rotatedHash });
    const result = await dispatch(rotated, '/api/dashboard/projects', { cookie });
    equal(result.response.status, 401);
    equal(result.nextCalls, 0);
    equal((await dispatch(app, '/api/dashboard/projects', { cookie })).response.status, 200);
  });

  await group('Store outages and malformed auth responses fail closed', async () => {
    fixture.state.unavailable = true;
    equal((await dispatch(app, '/api/dashboard/projects', { cookie })).response.status, 503);
    equal((await login(app)).response.status, 503);
    equal((await dispatch(app, '/api/dashboard/auth/logout', { method: 'POST', cookie, csrf, headers: { origin } })).response.status, 503);
    ok(fixture.sessions.has(tokenDigest(token)), 'Outage did not pretend to revoke session');
    fixture.state.unavailable = false;
    fixture.state.malformedSessions = true;
    equal((await dispatch(app, '/api/dashboard/projects', { cookie })).response.status, 401);
    fixture.state.malformedSessions = false;
    fixture.state.malformedRate = true;
    equal((await login(app)).response.status, 503);
    fixture.state.malformedRate = false;
  });

  await group('Missing or malformed authentication configuration cannot authorize requests', async () => {
    for (const changes of [{ DASHBOARD_PASSWORD_HASH: '' }, { DASHBOARD_ORIGIN: 'https://akrasia.studio/path' }, { DASHBOARD_ORIGIN: 'http://akrasia.studio' }, { SUPABASE_SERVICE_ROLE_KEY: '' }]) {
      const invalid = await loadApplication({ ...environment, ...changes });
      equal((await dispatch(invalid, '/api/dashboard/projects', { cookie })).response.status, 503);
      equal((await login(invalid)).response.status, 503);
    }
  });

  await group('Persistent rate RPC limits per-IP and global attempts, including concurrent requests', async () => {
    fixture.resetRate();
    const attempts = await Promise.all(Array.from({ length: 5 }, () => login(app, 'wrong')));
    for (const attempt of attempts) equal(attempt.response.status, 401);
    const limited = await login(app);
    equal(limited.response.status, 429);
    ok(Number(limited.response.headers.get('retry-after')) > 0);
    equal(limited.cookies.length, 0);
    // Altering a forwarding header never changes the adapter-derived bucket.
    equal((await login(app, TEST_PASSWORD, { headers: { origin, 'x-forwarded-for': '192.0.2.99' } })).response.status, 429);
    fixture.resetRate();
    for (let index = 0; index < 30; index++) {
      equal((await login(app, 'wrong', { clientAddress: `192.0.2.${index + 1}` })).response.status, 401);
    }
    equal((await login(app, TEST_PASSWORD, { clientAddress: '192.0.2.200' })).response.status, 429);
    fixture.resetRate();
  });

  await group('Logout requires CSRF and revokes a copied cookie in the server store', async () => {
    equal((await dispatch(app, '/api/dashboard/auth/logout', { method: 'POST', cookie, headers: { origin } })).response.status, 403);
    const direct = await app.routes.get('/api/dashboard/auth/logout').POST({ request: request('/api/dashboard/auth/logout', { method: 'POST', cookie }), locals: {} });
    equal(direct.status, 401);
    const result = await dispatch(app, '/api/dashboard/auth/logout', { method: 'POST', cookie, csrf, headers: { origin } });
    equal(result.response.status, 200);
    ok(!fixture.sessions.has(tokenDigest(token)));
    ok(result.cookies.some(value => {
      const expires = /Expires=([^;]+)/i.exec(value)?.[1];
      return value.startsWith(`${app.auth.DASHBOARD_COOKIE}=`) && expires && Date.parse(expires) < Date.now();
    }));
    equal((await dispatch(app, '/api/dashboard/projects', { cookie })).response.status, 401);
    equal((await dispatch(app, '/dashboard', { cookie })).response.status, 303);
    equal((await dispatch(app, '/api/dashboard/auth/logout', { method: 'POST', cookie, csrf, headers: { origin } })).response.status, 401);
  });

  await group('Production cookies use the host prefix and secure-only transport', async () => {
    const production = await loadApplication({ ...environment, DASHBOARD_ORIGIN: 'https://synthetic.example.invalid' }, true);
    equal(production.auth.DASHBOARD_COOKIE, '__Host-akrasia_admin');
    fixture.resetRate();
    const result = await login(production, TEST_PASSWORD, { headers: { origin: 'https://synthetic.example.invalid' } });
    equal(result.response.status, 200);
    const header = result.cookies.find(value => value.startsWith('__Host-akrasia_admin='));
    ok(header.includes('Secure'));
    ok(header.includes('HttpOnly'));
    ok(header.includes('Path=/'));
    ok(!header.includes('Domain='));
    const productionCookie = cookieFrom(result, production.auth.DASHBOARD_COOKIE);
    equal((await dispatch(production, '/api/dashboard/projects', { cookie: productionCookie })).response.status, 200);
  });

  await group('No provider/network side effects or credential logging occurred', async () => {
    equal(network.blocked.length, 0, 'Application attempted no external fetch');
    for (const item of warnings) {
      ok(!item.includes(TEST_PASSWORD));
      ok(!item.includes(TEST_PASSWORD_HASH));
      ok(!item.includes(token));
      ok(!item.includes(environment.SUPABASE_SERVICE_ROLE_KEY));
    }
    ok(!fixture.requests.some(value => value.path.includes('/storage/') || value.path.includes('notifications')));
  });
  console.log(`PASS: ${groups} groups, ${assertions} assertions; ${protectedRoutes.length} routes / ${protectedHandlers.length} handlers; synthetic data only.`);
  console.log('Limit: the local PostgREST/RPC double verifies application contracts, not deployed SQL/RLS or proxy behavior.');
} finally {
  console.warn = originalWarn;
  console.error = originalError;
  await Promise.all(applications.map(application => application.close()));
  network.restore();
  await fixture.close();
}
