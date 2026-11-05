import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { createProjectPublicationFixture, PRIVATE_MARKER } from './project-publication-test-fixture.mjs';
import { TEST_PASSWORD } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Real handlers + middleware + SSR; synthetic HTTP store, no .env or real integrations.
// The store intentionally returns extra columns so projection is independently tested.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { AstroCookies } = await import(pathToFileURL(path.join(root, 'node_modules/astro/dist/core/cookies/index.js')));
const origin = 'http://localhost:4326';
const fixture = await createProjectPublicationFixture();
const env = fixture.environment(origin);
const network = installFetchGuard([fixture.origin, origin]);
const vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  resolve: { alias: { 'astro:middleware': 'astro/middleware' } },
  define: Object.fromEntries(Object.entries({ ...env, PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' })
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
let assertions = 0, groups = 0, child, temporary;
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const equal = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
const group = async (name, action) => { await action(); console.log(`ok ${++groups} - ${name}`); };
const routes = new Map();
function request(route, options = {}) {
  const { method = 'GET', cookie, csrf, body, headers = {} } = options;
  const outgoing = new Headers(headers);
  if (cookie) outgoing.set('cookie', cookie);
  if (csrf) outgoing.set('x-dashboard-csrf', csrf);
  if (body !== undefined) outgoing.set('content-type', 'application/json');
  return new Request(new URL(route, origin), { method, headers: outgoing,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}
function noCache(response) {
  for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) ok(response.headers.get(key)?.includes('no-store'), key);
}
function noPrivate(value) { ok(!JSON.stringify(value).includes(PRIVATE_MARKER), 'No sensitive canary in public output'); }
let middleware;
async function dispatch(route, options = {}) {
  const req = request(route, options);
  const cookies = new AstroCookies(req);
  const context = { request: req, url: new URL(req.url), cookies, locals: {}, params: {}, clientAddress: '192.0.2.6' };
  const response = await middleware(context, () => routes.get(context.url.pathname)[req.method](context));
  for (const value of cookies.headers()) response.headers.append('set-cookie', value);
  return response;
}

try {
  for (const route of ['projects', 'feed', 'logs', 'stats', 'dashboard/projects', 'dashboard/auth/login']) {
    routes.set(`/api/${route}`, await vite.ssrLoadModule(`/src/pages/api/${route}.ts`));
  }
  middleware = (await vite.ssrLoadModule('/src/middleware.ts')).onRequest;
  const contract = await vite.ssrLoadModule('/src/lib/public-projects.ts');
  const expectedFields = [...contract.PUBLIC_PROJECT_FIELDS].sort();
  await group('Explicit projection and publication independent of every production state', async () => {
    const res = await dispatch('/api/projects'); equal(res.status, 200); noCache(res);
    const rows = await res.json(); equal(rows.length, 5); noPrivate(rows);
    for (const row of rows) equal(Object.keys(row).sort(), expectedFields);
    const reads = fixture.requests.filter(r => r.path === '/rest/v1/projects');
    for (const r of reads) { equal(r.query.get('is_published'), 'eq.true'); equal(r.query.get('select'), contract.PUBLIC_PROJECT_SELECT); }
    ok(!fixture.requests.some(r => /project_tasks|clients/.test(r.path)));
  });
  await group('Known IDs/slugs, forced columns/states and duplicate filters cannot widen reads', async () => {
    for (const p of fixture.tables.projects) {
      for (const query of [`id=${p.id}`, `slug=${p.slug}`]) {
        const res = await dispatch(`/api/projects?${query}`); noCache(res);
        equal(res.status, p.is_published ? 200 : 404); noPrivate(await res.json());
      }
    }
    for (const query of ['select=*', 'is_published=eq.false', 'status=completed', 'tasks=true', 'or=(is_published.eq.false)',
      'id=invalid', 'slug=a06-public&slug=private', 'id=x%26select%3D*', 'slug=x%22%3E%3Cscript%3E', 'limit=999', 'category=test']) {
      const before = fixture.requests.length;
      const res = await dispatch(`/api/projects?${query}`); equal(res.status, 400); noCache(res); equal(fixture.requests.length, before);
    }
    fixture.state.ignoreProjectFilters = true;
    const known = fixture.tables.projects[0];
    equal((await dispatch(`/api/projects?id=${known.id}`)).status, 404);
    const rows = await (await dispatch('/api/projects')).json(); equal(rows.length, 5); noPrivate(rows);
    fixture.state.ignoreProjectFilters = false;
  });
  await group('Empty portfolio and storage/missing migration failures have no demo fallback', async () => {
    const stored = fixture.tables.projects; fixture.tables.projects = [];
    equal(await (await dispatch('/api/projects')).json(), []);
    equal((await (await dispatch('/api/stats')).json())[0].value, 0);
    fixture.tables.projects = stored;
    for (const failure of ['projectUnavailable', 'missingProjectPublication', 'malformedProjects']) {
      fixture.state[failure] = true;
      for (const route of ['/api/projects', '/api/stats']) {
        const res = await dispatch(route); equal(res.status, 503); noCache(res); noPrivate(await res.json());
      }
      fixture.state[failure] = false;
    }
  });
  await group('Public activity and metrics cannot disclose task/client text or internal counts', async () => {
    for (const route of ['/api/feed', '/api/logs']) {
      const before = fixture.requests.length;
      const res = await dispatch(route); equal(await res.json(), []); noCache(res); equal(fixture.requests.length, before+1);
      const query=fixture.requests.at(-1).query;equal(query.get('is_published'),'eq.true');
      ok(!query.get('select').split(',').some(field=>['text','level','source','is_active','log_type'].includes(field)),'Internal activity fields are never selected for public output');
    }
    const res = await dispatch('/api/stats');
    equal(await res.json(), [{ key: 'published_projects', value: 5, label: 'Proyectos publicados' }]); noCache(res);
  });
  const auth = await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');
  const login = await dispatch('/api/dashboard/auth/login', { method: 'POST', body: { password: TEST_PASSWORD }, headers: { origin } });
  equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const session = await auth.getDashboardSession(request('/api/dashboard/projects', { cookie }));
  const authorized = { cookie, csrf: session.csrfToken, headers: { origin } };
  const unpublished = fixture.tables.projects[0];
  await group('Publication mutations require persistent admin session and CSRF', async () => {
    const before = fixture.tables.projects.map(p => p.is_published);
    for (const access of [{}, { cookie }, { cookie, headers: { origin } }, { ...authorized, headers: { origin: 'https://evil.invalid' } },
      { ...authorized, csrf: 'fake' }]) {
      const res = await dispatch('/api/dashboard/projects', { method: 'PATCH', body: { id: unpublished.id, is_published: true }, ...access });
      equal(res.status, access.cookie ? 403 : 401); noCache(res);
    }
    equal(fixture.tables.projects.map(p => p.is_published), before);
    const direct = await routes.get('/api/dashboard/projects').PATCH({ request: request('/api/dashboard/projects', {
      ...authorized, method: 'PATCH', body: { id: unpublished.id, is_published: true },
    }) }); equal(direct.status, 401);
  });
  await group('Strict inputs, creation unpublished, saved publishing/withdrawal and legitimate internal access', async () => {
    for (const body of [null, [], { title: {} }, { title: 'new', is_published: true }, { title: 'new', is_published: 'false' },
      { title: 'new', public_description: null }, { title: 'new', slug: 'a'.repeat(121) }]) {
      equal((await dispatch('/api/dashboard/projects', { ...authorized, method: 'POST', body })).status, 400);
    }
    for (const body of [{ id: unpublished.id, is_published: 'true' }, { id: unpublished.id, is_published: 1 },
      { id: 'x&is_published=eq.true', is_published: true }, { id: unpublished.id, is_published: true, status: 'delivered' },
      { id: unpublished.id, future_sensitive_column: 'x' }]) {
      equal((await dispatch('/api/dashboard/projects', { ...authorized, method: 'PATCH', body })).status, 400);
    }
    const createdRes = await dispatch('/api/dashboard/projects', { ...authorized, method: 'POST', body: {
      title: 'Creado privado A06', status: 'completed', description: PRIVATE_MARKER, public_description: 'Texto editorial',
    } }); equal(createdRes.status, 201);
    const createdData = await createdRes.json(); const created = Array.isArray(createdData) ? createdData[0] : createdData;
    equal(created.is_published, false); equal((await dispatch(`/api/projects?id=${created.id}`)).status, 404);
    const publish = await dispatch('/api/dashboard/projects', { ...authorized, method: 'PATCH', body: { id: created.id, is_published: true } });
    equal(publish.status, 200); const decision = await publish.json(); equal((Array.isArray(decision) ? decision[0] : decision).is_published, true);
    const publicRes = await dispatch(`/api/projects?id=${created.id}`); equal(publicRes.status, 200); noPrivate(await publicRes.json());
    equal((await dispatch(`/api/projects?id=${created.id.toUpperCase()}`)).status, 200, 'Valid uppercase UUID keeps the same publication filter');
    await dispatch('/api/dashboard/projects', { ...authorized, method: 'PATCH', body: { id: created.id, status: 'planning' } });
    equal((await dispatch(`/api/projects?id=${created.id}`)).status, 200, 'Status does not authorize publication');
    equal((await dispatch('/api/dashboard/projects', { ...authorized, method: 'PATCH', body: { id: created.id, is_published: false } })).status, 200);
    for (const suffix of [`?id=${created.id}`, `?slug=${created.slug}`]) equal((await dispatch(`/api/projects${suffix}`)).status, 404);
    const all = await (await dispatch('/api/dashboard/projects?tasks=true', authorized)).json();
    ok(all.some(row => row.description === PRIVATE_MARKER)); ok(all.find(p => p.id === unpublished.id).tasks.length);
    fixture.state.projectUnavailable = true;
    equal((await dispatch('/api/dashboard/projects', { ...authorized, method: 'PATCH', body: { id: created.id, is_published: true } })).status, 503);
    fixture.state.projectUnavailable = false;
  });
  await group('Chat system context has no unapproved demo portfolio or private data', async () => {
    const prompt = (await vite.ssrLoadModule('/src/data/systemPrompt.ts')).AKRASIA_SYSTEM_PROMPT;
    noPrivate(prompt); ok(!/NEON ODYSSEY|CITY PULSE|VOID FRAGMENTS|CHROME DREAMS/.test(prompt));
    const source = await readFile(path.join(root, 'src/lib/chat-handler.ts'), 'utf8');
    ok(!/projects\.json|caseStudies|getPublicProjects|sbQuery\('projects'/.test(source));
  });
  await group('Actual Astro HUD, compatibility chat redirects and sitemap preserve public boundaries without cache', async () => {
    temporary = await mkdtemp(path.join(tmpdir(), 'akrasia-a06-check-'));
    let startup = '';
    child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'scripts/dashboard-test-network-guard.mjs')).href,
      path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', 'localhost', '--port', '4326', '--config', 'scripts/astro-projects-test.config.mjs'], {
      cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env,
        ASTRO_TELEMETRY_DISABLED: '1', AKRASIA_TEST_ENV_DIR: temporary, AKRASIA_TEST_ALLOWED_ORIGINS: JSON.stringify([fixture.origin, origin]) },
    });
    child.stdout.on('data', value => { startup = (startup + value).slice(-6000); });
    child.stderr.on('data', value => { startup = (startup + value).slice(-6000); });
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try { const res = await fetch(`${origin}/api/projects`); if (res.status === 200) { ready = true; break; } } catch {}
      if (child.exitCode !== null) throw new Error(`Synthetic Astro exited: ${startup}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    ok(ready, `Synthetic SSR ready: ${startup}`);
    const visible = fixture.tables.projects.find(p => p.is_published);
    for (const route of ['/', '/sitemap.xml']) {
      const res = await fetch(`${origin}${route}`); equal(res.status, 200); noCache(res);
      noPrivate(await res.text());
    }
    for (const project of [visible,unpublished]) {
      const before = fixture.requests.length;
      const res = await fetch(`${origin}/proyectos/${project.slug}`, { redirect:'manual' });
      equal(res.status,302); noCache(res);
      const location = new URL(res.headers.get('Location'),origin);
      equal(location.pathname,'/'); equal(location.searchParams.get('chat'),'project:' + project.slug);
      equal(await res.text(),'','Legacy links disclose neither title nor publication status');
      equal(fixture.requests.length,before,'Legacy links do not read storage');
    }
    fixture.tables.projects.find(p => p.id === visible.id).is_published = false;
    for (const route of ['/', '/sitemap.xml']) {
      const res = await fetch(`${origin}${route}`); equal(res.status, 200); noCache(res);
      ok(!(await res.text()).includes(visible.title), 'Withdrawn title absent in subsequent HTML');
    }
    const withdrawnApi = await fetch(`${origin}/api/projects?slug=${visible.slug}`);
    equal(withdrawnApi.status,404); noCache(withdrawnApi); noPrivate(await withdrawnApi.text());
    fixture.state.missingProjectPublication = true;
    equal((await fetch(`${origin}/proyectos/${visible.slug}`,{redirect:'manual'})).status, 302);
    const beforeSitemap = fixture.requests.length;
    const sitemap = await fetch(`${origin}/sitemap.xml`); equal(sitemap.status,200); noCache(sitemap);
    const xml = await sitemap.text(); noPrivate(xml);
    ok(!xml.includes('/proyectos/') && !xml.includes(visible.title),'Sitemap indexes only home/legal documents');
    equal(fixture.requests.length,beforeSitemap,'Sitemap remains independent of failed publication storage');
    const homeError = await fetch(`${origin}/`); noCache(homeError); noPrivate(await homeError.text());
    fixture.state.missingProjectPublication = false;
    const stored = fixture.tables.projects; fixture.tables.projects = [];
    const homeEmpty = await fetch(`${origin}/`); equal(homeEmpty.status, 200); noPrivate(await homeEmpty.text());
    fixture.tables.projects = stored;
  });
  equal(network.blocked, [], 'No external integration requests');
  console.log(`PASS A06: ${groups} groups, ${assertions} assertions (synthetic HTTP/SSR; PostgreSQL not executed).`);
} finally {
  if (child) { child.kill(); await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit', resolve); }); }
  await vite.close(); await fixture.close(); network.restore();
  if (temporary) {
    if (!path.resolve(temporary).startsWith(`${path.resolve(tmpdir())}${path.sep}`)) throw new Error('Temporary directory escaped root');
    await rm(temporary, { recursive: true, force: true });
  }
}
