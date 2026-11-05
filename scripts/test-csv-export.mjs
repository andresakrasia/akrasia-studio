import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { createDashboardTestFixture, TEST_PASSWORD, TEST_SERVICE_KEY } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Real export/auth/middleware, a local synthetic store and Python's independent
// csv parser. No .env, deployed storage, email, Telegram or paid AI is contacted.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { AstroCookies } = await import(pathToFileURL(path.join(root, 'node_modules/astro/dist/core/cookies/index.js')));
const fixture = await createDashboardTestFixture();
const origin = 'http://localhost:4330';
const network = installFetchGuard([fixture.origin]);
const guardedFetch = globalThis.fetch;
let exportFailure = null;
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin === fixture.origin && url.pathname === '/rest/v1/leads' && exportFailure) {
    if (exportFailure === 'throw') throw new Error('INTERNAL_EXPORT_CANARY');
    if (exportFailure === 'invalid-json') return new Response('{INTERNAL_EXPORT_CANARY', { status: 200 });
    if (exportFailure === 'provider') return new Response('INTERNAL_EXPORT_CANARY', { status: 503 });
    return Response.json(exportFailure);
  }
  return guardedFetch(input, init);
};
const env = fixture.environment(origin);
const vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  resolve: { alias: { 'astro:middleware': 'astro/middleware' } },
  define: Object.fromEntries(Object.entries({ ...env, PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' })
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
let groups = 0, assertions = 0;
const equal = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const group = async (name, test) => { await test(); console.log(`ok ${++groups} - ${name}`); };

const parserScript = [
  'import csv, io, json, sys',
  'documents = json.load(sys.stdin)',
  'rows = [list(csv.reader(io.StringIO(doc.lstrip("\\ufeff"), newline=""), strict=True)) for doc in documents]',
  'json.dump(rows, sys.stdout, ensure_ascii=True)',
].join('\n');
function independentParse(documents) {
  const bundledPython = path.join(homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'python', 'python.exe');
  const candidates = [process.env.AKRASIA_CSV_TEST_PYTHON, bundledPython, 'python3', 'python'].filter(Boolean);
  for (const command of candidates) {
    const result = spawnSync(command, ['-c', parserScript], { input: JSON.stringify(documents), encoding: 'utf8',
      env: { ...process.env, PYTHONUTF8: '1' }, maxBuffer: 4 * 1024 * 1024, timeout: 10000, windowsHide: true });
    if (result.error?.code === 'ENOENT') continue;
    if (result.error || result.status !== 0) throw new Error(`Independent CSV parser failed: ${result.error?.message || result.stderr}`);
    return JSON.parse(result.stdout);
  }
  throw new Error('Python CSV parser unavailable; set AKRASIA_CSV_TEST_PYTHON to a Python executable.');
}
function request(route, { method = 'GET', cookie, headers = {}, body } = {}) {
  const outgoing = new Headers(headers);
  if (cookie) outgoing.set('cookie', cookie);
  if (body !== undefined) outgoing.set('content-type', 'application/json');
  return new Request(new URL(route, origin), { method, headers: outgoing,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
let middleware, exportRoute, loginRoute;
async function dispatch(route, options = {}) {
  const req = request(route, options);
  const cookies = new AstroCookies(req);
  const context = { request: req, url: new URL(req.url), cookies, locals: {}, params: {}, clientAddress: '192.0.2.30' };
  const response = await middleware(context, () => (route.startsWith('/api/dashboard/auth/login') ? loginRoute.POST : exportRoute.GET)(context));
  for (const value of cookies.headers()) response.headers.append('set-cookie', value);
  return response;
}
function privateHeaders(response) {
  equal(response.headers.get('cache-control'), 'no-store, private');
  equal(response.headers.get('cdn-cache-control'), 'no-store');
  equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
  equal(response.headers.get('x-content-type-options'), 'nosniff');
}

try {
  const csv = await vite.ssrLoadModule('/src/lib/csv.ts');
  exportRoute = await vite.ssrLoadModule('/src/pages/api/dashboard/export.ts');
  loginRoute = await vite.ssrLoadModule('/src/pages/api/dashboard/auth/login.ts');
  middleware = (await vite.ssrLoadModule('/src/middleware.ts')).onRequest;
  const guard = "\t'";
  const benign = ['', 'Texto normal', '  espacios preservados  ', 'a=b+c-d@e', '0', '00123',
    'Ákrasia ∆ — 中文 🎬', 'uno,dos; tres', 'Dijo "hola"', 'línea 1\nlínea 2', 'línea 1\r\nlínea 2',
    'x\ty', 'x\ry', 'texto",=SUM(1,2)', "'texto normal"];
  const risky = ['=1+2', '+SUM(1,2)', '-1+2', '@SUM(1,2)', '-42', '+34600100200',
    ' =1+2', '   +1', '\t=1', '\r=1', '\n=1', ' \t\r\n@SUM(1,2)', '\u00a0=1', '\u200b=1',
    '\ufeff-1', '\u0000=1', '\u001f+1', '\u007f@x', '＝1', '＋1', '－1', '＠SUM(1)',
    '\ttexto', '\rtexto', '\ntexto', '  \ttexto', '\u200btexto', '=1+2";,=1+2', '=1+2\r\n+3',
    "'=1+2", "''+SUM(1,2)", " ' -42", "'\t=1", "'\u200b@SUM(1,2)"];

  await group('Independent parser preserves CSV delimiters, quotes, newlines and Unicode', async () => {
    const expected = benign.map((value, index) => [value, `r${index}`, 'última']);
    const serialized = csv.serializeCsv(expected);
    equal(independentParse([serialized])[0], expected);
    ok(serialized.includes('\r\n'));
    equal(csv.serializeCsv([]), '');
    equal(csv.serializeCsv([[null, undefined, '']]), '"","",""');
  });
  await group('Formula/control prefixes and whitespace/full-width bypasses are guarded without lost bytes', async () => {
    const rows = risky.map(value => [value, 'resto']);
    const parsed = independentParse([csv.serializeCsv(rows)])[0];
    equal(parsed, risky.map(value => [guard + value, 'resto']));
    for (let index = 0; index < parsed.length; index++) {
      equal(parsed[index][0].slice(guard.length), risky[index]);
      equal(parsed[index].length, 2);
    }
  });
  await group('Headers are guarded too; finite server numbers stay numeric and numeric user text stays text', async () => {
    const serialized = csv.serializeCsv([['=Cabecera', 'Número', 'Texto'], ['dato', -42, csv.csvText(-42)], ['dato', 0, csv.csvText(0)]]);
    equal(independentParse([serialized])[0], [[guard + '=Cabecera', 'Número', 'Texto'], ['dato', '-42', guard + '-42'], ['dato', '0', '0']]);
    ok(serialized.includes('"dato",-42,"'));
    equal(csv.csvText({ unexpected: '=1' }), '');
    equal(csv.csvText(null), '');
    for (const value of [NaN, Infinity, -Infinity, {}, true]) {
      assertions++; assert.throws(() => csv.serializeCsv([[value]]), TypeError);
    }
    assertions++; assert.throws(() => csv.serializeCsv([['one'], ['two', 'three']]), TypeError);
  });
  await group('Export rejects anonymous/direct/legacy authorization with no lead read', async () => {
    const before = fixture.requests.length;
    for (const options of [{}, { cookie: 'dashboard_pin_verified=true' }, { headers: { 'x-dashboard-secret': 'fake' } }]) {
      const response = await exportRoute.GET({ request: request('/api/dashboard/export?secret=fake', options) });
      equal(response.status, 401); privateHeaders(response);
      equal(response.headers.get('content-disposition'), null);
    }
    equal(fixture.requests.length, before);
    const response = await dispatch('/api/dashboard/export'); equal(response.status, 401); privateHeaders(response);
  });
  const login = await dispatch('/api/dashboard/auth/login', { method: 'POST', headers: { origin }, body: { password: TEST_PASSWORD } });
  equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  await group('Authorized export has fixed safe headers, selected columns and neutralized synthetic values', async () => {
    fixture.tables.leads = [
      { id: '=fake-id', email: '=HYPERLINK("https://example.invalid")', phone: '+34600100200', name: 'Dijo "hola", Ákrasia',
        company: 'línea 1\r\nlínea 2 🎬', project_type: '@tipo', status: 'new', tags: ['=etiqueta', 'normal;extra'], created_at: '2026-10-02T12:00:00Z' },
      { id: 'benigno', email: 'test@example.invalid', phone: null, name: 'Visita ficticia', company: '',
        project_type: 'vídeo', status: 'new', tags: [], created_at: '2026-10-02T12:00:00Z' },
    ];
    const response = await dispatch('/api/dashboard/export?filename=evil%0d%0aX-Evil%3a+yes&select=*&limit=999999', { cookie });
    equal(response.status, 200); privateHeaders(response);
    equal(response.headers.get('content-type'), 'text/csv; charset=utf-8; header=present');
    equal(response.headers.get('content-disposition'), 'attachment; filename="akrasia-leads.csv"');
    const bytes = new Uint8Array(await response.arrayBuffer());
    equal([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf]);
    const content = new TextDecoder().decode(bytes);
    const parsed = independentParse([content])[0];
    equal(parsed[0], ['ID', 'Email', 'Phone', 'Name', 'Company', 'Project Type', 'Status', 'Tags', 'Created At']);
    equal(parsed.find(row => row[0] === guard + '=fake-id'), [guard + '=fake-id', guard + '=HYPERLINK("https://example.invalid")', guard + '+34600100200',
      'Dijo "hola", Ákrasia', 'línea 1\r\nlínea 2 🎬', guard + '@tipo', 'new', guard + '=etiqueta; normal;extra', '2026-10-02T12:00:00Z']);
    equal(parsed.length, 3);
    for (const row of parsed) equal(row.length, 9);
    const leadRead = fixture.requests.findLast(value => value.path === '/rest/v1/leads');
    equal(leadRead.query.get('select'), 'id,email,phone,name,company,project_type,status,tags,created_at');
    equal(leadRead.query.get('limit'), '500');
    equal(leadRead.query.get('order'), 'created_at.desc,id.desc');
    ok(!content.includes(TEST_SERVICE_KEY));
    equal(response.headers.get('x-evil'), null);
  });
  await group('Cross-site reads and revoked sessions cannot download lead data', async () => {
    const before = fixture.requests.filter(value => value.path === '/rest/v1/leads').length;
    const foreign = await dispatch('/api/dashboard/export', { cookie, headers: { 'sec-fetch-site': 'cross-site' } });
    equal(foreign.status, 403); privateHeaders(foreign);
    equal(fixture.requests.filter(value => value.path === '/rest/v1/leads').length, before);
    const saved = new Map(fixture.sessions); fixture.sessions.clear();
    const revoked = await dispatch('/api/dashboard/export', { cookie }); equal(revoked.status, 401);
    equal(fixture.requests.filter(value => value.path === '/rest/v1/leads').length, before);
    for (const [key, value] of saved) fixture.sessions.set(key, value);
  });
  await group('Provider/network/JSON/data failures return a private generic error without a download', async () => {
    for (const failure of ['throw', 'invalid-json', 'provider', { internal: 'INTERNAL_EXPORT_CANARY' }, [null], [['nested']], Array.from({ length: 1001 }, () => ({}))]) {
      exportFailure = failure;
      const response = await dispatch('/api/dashboard/export', { cookie });
      equal(response.status, 503); privateHeaders(response);
      equal(response.headers.get('content-disposition'), null);
      const body = await response.text();
      ok(!body.includes('INTERNAL_EXPORT_CANARY')); ok(!body.includes(TEST_SERVICE_KEY));
      equal(JSON.parse(body).error, 'No se ha podido generar la exportación. Inténtalo de nuevo.');
    }
    exportFailure = null;
  });
  await group('A genuinely empty table still exports one valid header row, without writes or external requests', async () => {
    fixture.tables.leads = [];
    const response = await dispatch('/api/dashboard/export', { cookie }); equal(response.status, 200); privateHeaders(response);
    equal(independentParse([await response.text()])[0].length, 1);
    equal(fixture.requests.filter(value => value.path === '/rest/v1/leads' && value.method !== 'GET'), []);
    equal(network.blocked, []);
  });
  console.log(`PASS: ${groups} groups, ${assertions} assertions; independent Python CSV parser and synthetic local store.`);
} finally {
  await vite.close(); await fixture.close(); network.restore();
}

