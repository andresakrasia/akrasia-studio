import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { createServer as createPortReservation } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { createDashboardTestFixture, TEST_PASSWORD, TEST_SERVICE_KEY } from './dashboard-auth-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Real Astro HTTP/Request runtime, chunked multipart bodies and a synthetic local
// PostgREST/Storage fixture. No project .env, paid AI or deployed service is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = await createDashboardTestFixture();
const portReservation = createPortReservation();
let child, temporary, network;
let groups = 0, assertions = 0;
const equal = (a, b, why) => { assertions++; assert.deepEqual(a, b, why); };
const ok = (value, why) => { assertions++; assert.ok(value, why); };
const group = async (name, test) => { await test(); console.log(`ok ${++groups} - ${name}`); };
const boundary = 'A10HttpSyntheticBoundary';
const MAX_REQUEST_BYTES = 2 * 1024 * 1024 + 16 * 1024;
const storageCalls = () => fixture.requests.filter(value => value.path.startsWith('/storage/')).length;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
let origin;

function multipart(bytes, { filename = 'ficticia.png', closing = `\r\n--${boundary}--\r\n` } = {}) {
  return Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: image/png\r\n\r\n`), bytes, Buffer.from(closing)]);
}

// This transport deliberately avoids fetch/FormData: Node sends actual HTTP
// chunk framing and omits Content-Length, then Astro constructs its Request.
function sendChunked(body, { cookie, csrf, requestOrigin = origin, chunkBytes = 32 * 1024 } = {}) {
  const url = new URL('/api/dashboard/upload', origin);
  if (url.origin !== origin || url.hostname !== 'localhost') throw new Error('HTTP test destination must be its own local Astro server');
  return new Promise((resolve, reject) => {
    let responseStarted = false;
    const headers = { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Transfer-Encoding': 'chunked' };
    if (cookie) headers.Cookie = cookie;
    if (csrf) headers['X-Dashboard-CSRF'] = csrf;
    if (requestOrigin) headers.Origin = requestOrigin;
    const request = httpRequest(url, { method: 'POST', headers, agent: false }, response => {
      responseStarted = true;
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('error', reject);
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text: Buffer.concat(chunks).toString('utf8'),
        sentContentLength: request.getHeader('content-length'), transferEncoding: request.getHeader('transfer-encoding') }));
    });
    request.setTimeout(15_000, () => request.destroy(new Error('Synthetic HTTP request timed out')));
    request.on('error', error => { if (!responseStarted) reject(error); });
    void (async () => {
      try {
        for (let offset = 0; offset < body.length; offset += chunkBytes) {
          if (request.destroyed || request.writableEnded) break;
          request.write(body.subarray(offset, offset + chunkBytes));
          // Let the real server consume fragments rather than one client buffer.
          await pause(1);
        }
        if (!request.destroyed && !request.writableEnded) request.end();
      } catch (error) { request.destroy(); if (!responseStarted) reject(error); }
    })();
  });
}

function privateHeaders(result) {
  for (const key of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) ok(result.headers[key]?.includes('no-store'), key);
  equal(result.headers['x-content-type-options'], 'nosniff');
  equal(result.sentContentLength, undefined, 'The real HTTP upload did not send Content-Length');
  equal(result.transferEncoding, 'chunked');
  ok(!result.text.includes(TEST_SERVICE_KEY));
}

try {
  // Reserve an unused port before launch; never probe another project preview.
  await new Promise((resolve, reject) => { portReservation.once('error', reject); portReservation.listen(0, 'localhost', resolve); });
  const address = portReservation.address();
  if (!address || typeof address === 'string') throw new Error('No local HTTP test port');
  origin = `http://localhost:${address.port}`;
  await new Promise((resolve, reject) => portReservation.close(error => error ? reject(error) : resolve()));
  temporary = await mkdtemp(path.join(tmpdir(), 'akrasia-a10-http-empty-env-'));
  network = installFetchGuard([fixture.origin, origin]);
  let startup = '';
  child = spawn(process.execPath, [
    '--import', pathToFileURL(path.join(root, 'scripts/dashboard-test-network-guard.mjs')).href,
    path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', 'localhost', '--port', String(address.port),
    '--config', 'scripts/astro-dashboard-test.config.mjs',
  ], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: {
    ...process.env, ...fixture.environment(origin), ASTRO_TELEMETRY_DISABLED: '1',
    AKRASIA_TEST_ENV_DIR: temporary, AKRASIA_TEST_ALLOWED_ORIGINS: JSON.stringify([fixture.origin, origin]),
  } });
  child.stdout.on('data', value => { startup = (startup + value).slice(-6000); });
  child.stderr.on('data', value => { startup = (startup + value).slice(-6000); });
  let startupError;
  child.on('error', error => { startupError = error; });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (startupError) throw new Error(`Isolated Astro could not start: ${startupError.message}`);
    if (child.exitCode !== null) throw new Error(`Isolated Astro exited before testing: ${startup}`);
    // Require the child to announce its own bound port before any request.
    if (startup.includes(origin)) {
      try { if ((await fetch(`${origin}/api/dashboard/export`)).status === 401) { ready = true; break; } } catch {}
    }
    await pause(200);
  }
  ok(ready, `Isolated Astro did not become ready: ${startup}`);

  const login = await fetch(`${origin}/api/dashboard/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ password: TEST_PASSWORD }) });
  equal(login.status, 200);
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  ok(cookie?.startsWith('akrasia_admin='), 'A synthetic session cookie was created');
  const token = cookie.slice(cookie.indexOf('=') + 1);
  // Fixture cookie only: independently reproduce the A01 server CSRF contract;
  // never print either token, and never extract credentials from a real page.
  const csrf = createHmac('sha256', token).update('akrasia-dashboard-csrf-v1').digest('base64url');
  const authorized = { cookie, csrf };
  const png = await sharp({ create: { width: 38, height: 22, channels: 4, background: '#6b3a87' } }).png().toBuffer();
  const legitimateBody = multipart(png);

  await group('Real Astro accepts a fragmented chunked PNG with no Content-Length', async () => {
    const result = await sendChunked(legitimateBody, { ...authorized, chunkBytes: 13 });
    equal(result.status, 200); privateHeaders(result);
    const value = JSON.parse(result.text);
    ok(/^\/api\/project-media\/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.webp$/.test(value.url));
    equal(fixture.storage.size, 1);
    const [key, pixels] = [...fixture.storage][0];
    equal(key, `project-media-private/thumbs/${value.url.split('/').at(-1)}`);
    const decoded = await sharp(pixels).metadata(); equal(decoded.format, 'webp'); equal(decoded.width, 38); equal(decoded.height, 22);
  });
  await group('An excessive chunked request rejects before malformed multipart is parsed or Storage is called', async () => {
    const before = storageCalls();
    const malformedOversized = Buffer.alloc(MAX_REQUEST_BYTES + 1, 0x41);
    const result = await sendChunked(malformedOversized, authorized);
    equal(result.status, 413); privateHeaders(result);
    equal(JSON.parse(result.text).error, 'La imagen debe ocupar como máximo 2 MiB.');
    equal(storageCalls(), before); equal(fixture.storage.size, 1);
  });
  await group('Real HTTP malformed multipart and multiple files reject without creating objects', async () => {
    const before = storageCalls();
    const secondFile = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="second.png"\r\nContent-Type: image/png\r\n\r\n`;
    const multiple = Buffer.concat([multipart(png, { closing: secondFile }), png, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    for (const body of [Buffer.from('This is not multipart.'), multipart(png, { closing: `\r\n--${boundary}\r\n` }), multiple]) {
      const result = await sendChunked(body, { ...authorized, chunkBytes: 19 });
      equal(result.status, 400); privateHeaders(result);
      equal(JSON.parse(result.text).error, 'La petición de carga no es válida.');
    }
    equal(storageCalls(), before); equal(fixture.storage.size, 1);
  });
  await group('Authentication, CSRF and origin reject real HTTP uploads before any Storage side effect', async () => {
    const before = storageCalls();
    for (const [options, status] of [[{}, 401], [{ cookie }, 403], [{ cookie, csrf: 'wrong' }, 403],
      [{ ...authorized, requestOrigin: 'https://untrusted.example.invalid' }, 403], [{ ...authorized, requestOrigin: null }, 403]]) {
      const result = await sendChunked(legitimateBody, options);
      equal(result.status, status);
      if (Object.hasOwn(options, 'requestOrigin') && options.requestOrigin !== origin) {
        // Astro 7's built-in origin guard precedes application middleware for
        // form-like requests. Keep that protection enabled and verify its
        // generic response instead of attributing it to our JSON handler.
        equal(result.text, 'Cross-site POST form submissions are forbidden');
        equal(result.sentContentLength, undefined);
        equal(result.transferEncoding, 'chunked');
        ok(!result.text.includes(TEST_SERVICE_KEY) && !result.text.includes(token) && !result.text.includes(csrf));
        equal(result.headers['access-control-allow-origin'], undefined);
      } else {
        privateHeaders(result);
        ok(typeof JSON.parse(result.text).error === 'string');
      }
    }
    equal(storageCalls(), before); equal(fixture.storage.size, 1);
    equal(network.blocked, []);
    ok(!startup.includes(token) && !startup.includes(csrf), 'Synthetic bearer tokens were not logged');
  });
  console.log(`A10 real HTTP uploads: ${groups} groups, ${assertions} assertions; isolated Astro, chunked bodies, synthetic Storage only.`);
} finally {
  if (child) {
    child.kill();
    await Promise.race([new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)), pause(5000)]);
    if (child.exitCode === null && child.signalCode === null) throw new Error('Isolated Astro process did not stop');
  }
  if (portReservation.listening) await new Promise(resolve => portReservation.close(resolve));
  await fixture.close(); network?.restore();
  if (temporary) {
    const temporaryRoot = path.resolve(tmpdir());
    const target = path.resolve(temporary);
    if (!target.toLowerCase().startsWith(`${temporaryRoot}${path.sep}`.toLowerCase()) || !path.basename(target).startsWith('akrasia-a10-http-empty-env-')) throw new Error('Temporary environment escaped its named root');
    await rm(target, { recursive: true, force: true });
  }
}
