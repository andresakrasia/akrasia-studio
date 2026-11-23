import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import sharp from 'sharp';
import { createDashboardTestFixture, TEST_PASSWORD } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { AstroCookies } = await import(pathToFileURL(path.join(root, 'node_modules/astro/dist/core/cookies/index.js')));
const fixture = await createDashboardTestFixture();
const origin = 'http://localhost:4330';
const network = installFetchGuard([fixture.origin]);
const vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  resolve: { alias: { 'astro:middleware': 'astro/middleware' } },
  define: Object.fromEntries(Object.entries({ ...fixture.environment(origin), PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' })
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
let assertions = 0, groups = 0;
const eq = (a, b, why) => { assertions++; assert.deepEqual(a, b, why); };
const ok = (value, why) => { assertions++; assert.ok(value, why); };
const group = async (name, test) => { await test(); console.log(`ok ${++groups} - ${name}`); };
const storageCalls = () => fixture.requests.filter(r => r.path.startsWith('/storage/')).length;
const routes = new Map();
let middleware;
async function dispatch(route, options = {}) {
  const { method = 'GET', cookie, csrf, body, headers = {} } = options;
  const outgoing = new Headers(headers);
  if (cookie) outgoing.set('cookie', cookie);
  if (csrf) outgoing.set('x-dashboard-csrf', csrf);
  let payload = body;
  if (body !== undefined && !(body instanceof FormData)) { outgoing.set('content-type', 'application/json'); payload = JSON.stringify(body); }
  const request = new Request(new URL(route, origin), { method, headers: outgoing, ...(body === undefined ? {} : { body: payload }) });
  const cookies = new AstroCookies(request);
  const url = new URL(request.url);
  // Astro passes decoded route parameters, while Request.url keeps encoded paths.
  const context = { request, cookies, url, locals: {}, params: { name: route.startsWith('/api/project-media/') ? decodeURIComponent(url.pathname.slice(19)) : '' }, clientAddress: '192.0.2.10' };
  const response = await middleware(context, () => (route.startsWith('/api/project-media/') ? routes.get('media') : routes.get(context.url.pathname))[method](context));
  for (const cookie of cookies.headers()) response.headers.append('set-cookie', cookie);
  return response;
}
const noCache = response => { for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) ok(response.headers.get(key)?.includes('no-store'), key); };
const png = await sharp({ create: { width: 64, height: 40, channels: 4, background: '#224488' } }).png().toBuffer();
const form = (bytes = png, name = 'ficticia.png', type = 'image/png') => { const data = new FormData(); data.append('file', new Blob([bytes], { type }), name); return data; };
try {
  for (const name of ['dashboard/auth/login', 'dashboard/auth/logout', 'dashboard/projects', 'dashboard/upload', 'dashboard/export', 'projects']) routes.set(`/api/${name}`, await vite.ssrLoadModule(`/src/pages/api/${name}.ts`));
  routes.set('media', await vite.ssrLoadModule('/src/pages/api/project-media/[...name].ts'));
  middleware = (await vite.ssrLoadModule('/src/middleware.ts')).onRequest;
  const auth = await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');
  const login = await dispatch('/api/dashboard/auth/login', { method: 'POST', body: { password: TEST_PASSWORD }, headers: { origin } });
  eq(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const session = await auth.getDashboardSession(new Request(`${origin}/api/dashboard/projects`, { headers: { cookie } }));
  const admin = { cookie, csrf: session.csrfToken, headers: { origin } };
  await group('Upload auth and CSRF reject before touching Storage', async () => {
    const before = storageCalls();
    for (const [options, status] of [[{}, 401], [{ cookie }, 403], [{ cookie, csrf: 'bad', headers: { origin } }, 403], [{ ...admin, headers: { origin: 'https://untrusted.invalid' } }, 403]]) {
      const response = await dispatch('/api/dashboard/upload', { method: 'POST', body: form(), ...options });
      eq(response.status, status); noCache(response);
    }
    eq(storageCalls(), before); eq(fixture.storage.size, 0);
  });
  let media;
  await group('Legitimate upload returns private server path and full decoded WebP', async () => {
    const response = await dispatch('/api/dashboard/upload', { method: 'POST', body: form(), ...admin });
    eq(response.status, 200); noCache(response);
    media = (await response.json()).url;
    ok(/^\/api\/project-media\/[a-f0-9-]+\.webp$/.test(media));
    eq(fixture.storage.size, 1);
    const [key, value] = [...fixture.storage][0];
    eq(key, `project-media-private/thumbs/${media.split('/').at(-1)}`);
    eq((await sharp(value).metadata()).format, 'webp');
    ok(!key.includes('ficticia'));
    eq((await dispatch(media)).status, 404);
    eq((await dispatch(media, { cookie })).status, 200);
  });
  await group('Copied revoked sessions and cross-site cookies cannot read a private upload', async () => {
    const loginCopy = await dispatch('/api/dashboard/auth/login', { method: 'POST', body: { password: TEST_PASSWORD }, headers: { origin } });
    eq(loginCopy.status, 200);
    const copiedCookie = loginCopy.headers.get('set-cookie').split(';')[0];
    const copiedSession = await auth.getDashboardSession(new Request(`${origin}/api/dashboard/projects`, { headers: { cookie: copiedCookie } }));
    eq((await dispatch(media, { cookie: copiedCookie })).status, 200);
    const logout = await dispatch('/api/dashboard/auth/logout', { method: 'POST', cookie: copiedCookie, csrf: copiedSession.csrfToken, headers: { origin } });
    eq(logout.status, 200);
    const before = storageCalls();
    for (const options of [{ cookie: copiedCookie }, { cookie, headers: { 'sec-fetch-site': 'cross-site' } }]) {
      const denied = await dispatch(media, options);
      eq(denied.status, 404); noCache(denied); eq(await denied.text(), '');
    }
    eq(storageCalls(), before);
    ok(!fixture.sessions.has(copiedSession.tokenHash));
    eq((await dispatch(media, { cookie })).status, 200, 'The separate original session remains valid');
  });
  await group('Rejections and Storage outage never confirm upload or create object', async () => {
    const before = storageCalls();
    const bad = await dispatch('/api/dashboard/upload', { method: 'POST', body: form(Buffer.from('<svg onload="alert(1)"/>'), 'fake.png'), ...admin });
    ok(bad.status >= 400); eq(storageCalls(), before); eq(fixture.storage.size, 1);
    fixture.state.storageUnavailable = true;
    const failed = await dispatch('/api/dashboard/upload', { method: 'POST', body: form(), ...admin });
    eq(failed.status, 503);
    ok(!(await failed.text()).includes('synthetic-service-role'));
    eq(fixture.storage.size, 1);
    fixture.state.storageUnavailable = false;
  });
  const project = fixture.tables.projects[0];
  await group('A06 draft, approval, withdrawal and failed database remain fail closed', async () => {
    eq((await dispatch('/api/dashboard/projects', { method: 'PATCH', body: { id: project.id, thumbnail_url: media }, ...admin })).status, 200);
    const before = storageCalls();
    eq((await dispatch(media)).status, 404); eq(storageCalls(), before);
    eq((await dispatch('/api/dashboard/projects', { method: 'PATCH', body: { id: project.id, is_published: true }, ...admin })).status, 200);
    const published = await dispatch(media); eq(published.status, 200); noCache(published); eq(published.headers.get('content-type'), 'image/webp');
    eq(published.headers.get('cross-origin-resource-policy'), 'same-origin');
    eq((await sharp(Buffer.from(await published.arrayBuffer())).metadata()).format, 'webp');
    eq((await (await dispatch('/api/projects')).json())[0].thumbnail, media);
    project.is_published = false;
    fixture.state.ignoreProjectFilters = true;
    eq((await dispatch(media)).status, 404);
    fixture.state.ignoreProjectFilters = false;
    fixture.state.projectUnavailable = true;
    eq((await dispatch(media)).status, 503);
    fixture.state.projectUnavailable = false;
    eq((await dispatch(media)).status, 404);
  });
  await group('Malformed or overbroad publication results cannot authorize a different or unapproved object', async () => {
    const saved = { thumbnail: project.thumbnail, is_published: project.is_published };
    const before = storageCalls();
    try {
      fixture.state.malformedProjects = true;
      const malformed = await dispatch(media); eq(malformed.status, 503); noCache(malformed); eq(await malformed.text(), '');
      fixture.state.malformedProjects = false;
      fixture.state.ignoreProjectFilters = true;
      for (const fields of [
        { thumbnail: '/api/project-media/00000000-0000-4000-8000-000000000009.webp', is_published: true },
        { thumbnail: media, is_published: 'true' },
        { thumbnail: media, is_published: false },
      ]) {
        Object.assign(project, fields);
        const denied = await dispatch(media); eq(denied.status, 404); noCache(denied); eq(await denied.text(), '');
      }
      eq(storageCalls(), before);
    } finally {
      fixture.state.malformedProjects = false; fixture.state.ignoreProjectFilters = false;
      Object.assign(project, saved);
    }
  });
  await group('Storage stream bounds hold without Content-Length and reject dishonest size headers', async () => {
    const initialStorage = [...fixture.storage].map(([key, value]) => [key, Buffer.from(value)]);
    try {
      fixture.state.storageResponse = { omitLength: true, chunkBytes: 17 };
      const chunked = await dispatch(media, { cookie }); eq(chunked.status, 200); noCache(chunked);
      eq((await sharp(Buffer.from(await chunked.arrayBuffer())).metadata()).format, 'webp');
      const oversized = Buffer.alloc(2 * 1024 * 1024 + 1, 0x41);
      for (const fault of [
        { contentLength: String(oversized.length) },
        { omitLength: true, bytes: oversized, chunkBytes: 32 * 1024 },
        // A real HTTP client bounds a response by its declared length. It receives
        // a truncated/corrupt image here, which must also never be returned raw.
        { contentLength: '1' },
      ]) {
        fixture.state.storageResponse = fault;
        const rejected = await dispatch(media, { cookie });
        ok(rejected.status >= 400); noCache(rejected);
        eq(await rejected.text(), '');
        eq(rejected.headers.get('content-type'), null);
        eq(rejected.headers.get('content-disposition'), null);
      }
      eq([...fixture.storage], initialStorage, 'Read transport failures did not alter the stored objects');
    } finally { delete fixture.state.storageResponse; }
  });
  await group('Legacy references normalize without changing rows or returning raw active files', async () => {
    const name = 'thumb-123456-ficticia.png';
    const old = `${fixture.origin}/storage/v1/object/public/project-thumbnails/${name}`;
    project.thumbnail = old; project.is_published = true;
    fixture.storage.set(`project-thumbnails/${name}`, png);
    const canonical = `/api/project-media/legacy/${name}`;
    eq((await (await dispatch('/api/projects')).json())[0].thumbnail, canonical);
    eq((await (await dispatch('/api/dashboard/projects', { cookie })).json())[0].thumbnail, canonical);
    eq(project.thumbnail, old);
    eq((await dispatch(canonical)).status, 200);
    project.is_published = false;
    eq((await dispatch(canonical)).status, 404);
    eq((await dispatch(canonical, { cookie })).status, 200);
    fixture.storage.set(`project-thumbnails/${name}`, Buffer.from('<html><script>alert(1)</script></html>'));
    ok((await dispatch(canonical, { cookie })).status >= 400);
  });
  await group('Manipulated names, queries, remote URLs and corrupt storage cannot widen access', async () => {
    const before = fixture.requests.length;
    for (const route of ['/api/project-media/legacy/..', '/api/project-media/legacy/a%0d.png', '/api/project-media/legacy/a.png%0A',
      '/api/project-media/legacy/a.png%0D', `${media}%0A`, `${media}%0D`, '/api/project-media/legacy/a%2fb',
      '/api/project-media/legacy/a/b', `${media}?bucket=other`, '/api/project-media/not-an-id.webp']) eq((await dispatch(route, { cookie })).status, 404);
    eq(fixture.requests.length, before);
    const helpers = await vite.ssrLoadModule('/src/lib/public-media.ts');
    eq(helpers.LEGACY_MEDIA_NAME.test('a.png\n'), false);
    eq(helpers.MANAGED_MEDIA_UUID.test(media.split('/').at(-1) + '\n'), false);
    for (const url of ['https://third.invalid/storage/v1/object/public/project-thumbnails/a.png', `${fixture.origin}/storage/v1/object/public/project-thumbnails/a.png?token=secret`, `${fixture.origin}/storage/v1/object/public/project-thumbnails/a%2fb.png`, '/api/project-media/legacy/a/b']) eq(helpers.projectImagePath(url, fixture.origin), '');
    eq(helpers.projectImagePath('/img/legitima.webp', fixture.origin), '/img/legitima.webp');
    eq(network.blocked, []);
  });
  console.log(`A10 media integration: ${groups} groups, ${assertions} assertions; synthetic Storage only.`);
} finally { await vite.close(); network.restore(); await fixture.close(); }
