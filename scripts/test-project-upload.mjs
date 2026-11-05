import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { deflateSync } from 'node:zlib';
import { createServer } from 'vite';

// Entirely synthetic raster pixels and injected Storage. Never loads .env or uses network.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: { 'import.meta.env.SUPABASE_URL': JSON.stringify('https://storage.example.invalid'),
    'import.meta.env.SUPABASE_SERVICE_ROLE_KEY': JSON.stringify('synthetic-only-key') },
});
const actualFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Unexpected network call'); };
let assertions = 0, groups = 0;
const equal = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const group = async (name, action) => { await action(); console.log(`ok ${++groups} - ${name}`); };
const reject = async (operation, status) => {
  assertions++;
  await assert.rejects(operation, error => error instanceof api.ProjectUploadError && error.status === status && !error.message.includes('INTERNAL_SECRET'));
};
const boundary = 'a10SyntheticBoundary';
const mimeFor = format => `image/${format === 'jpg' ? 'jpeg' : format}`;
function multipart(bytes, { name = 'ficticia.png', mime = 'image/png', field = 'file', header = '', ending = `\r\n--${boundary}--\r\n` } = {}) {
  return Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${field}"; filename="${name}"\r\nContent-Type: ${mime}\r\n${header}\r\n`), bytes, Buffer.from(ending)]);
}
function request(body, headers = {}) {
  return new Request('https://studio.example.invalid/api/dashboard/upload', { method: 'POST', body,
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, ...headers }, ...(body instanceof ReadableStream ? { duplex: 'half' } : {}) });
}
let calls = [];
const storage = { supabaseUrl: 'https://storage.example.invalid', serviceKey: 'synthetic-only-key',
  fetchImpl: async (url, init) => { calls.push({ url, ...init }); return new Response('{}', { status: 200 }); } };
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length); chunk.writeUInt32BE(data.length); chunk.write(type, 4, 'ascii');
  data.copy(chunk, 8); chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length); return chunk;
}
function padPng(png, size) {
  return Buffer.concat([png.subarray(0, -12), pngChunk('akRA', Buffer.alloc(size - png.length - 12)), png.subarray(-12)]);
}
function appendWebpChunk(webp, type, bytes) {
  const chunk = Buffer.alloc(8 + bytes.length + (bytes.length % 2)); chunk.write(type); chunk.writeUInt32LE(bytes.length, 4); bytes.copy(chunk, 8);
  const result = Buffer.concat([webp, chunk]); result.writeUInt32LE(result.length - 8, 4); return result;
}
let api;
try {
  api = await vite.ssrLoadModule('/src/lib/project-upload.ts');
  const auth = await vite.ssrLoadModule('/src/lib/dashboard-auth.ts');
  const endpoint = await vite.ssrLoadModule('/src/pages/api/dashboard/upload.ts');
  const pixels = { create: { width: 24, height: 16, channels: 4, background: { r: 120, g: 50, b: 90, alpha: 0.7 } } };
  const png = await sharp(pixels).png().toBuffer();
  const jpeg = await sharp(pixels).jpeg().toBuffer();
  const progressive = await sharp(pixels).jpeg({ progressive: true }).toBuffer();
  const webp = await sharp(pixels).webp().toBuffer();

  await group('JPEG, progressive JPEG, PNG and WebP decode, normalize and get server UUIDs', async () => {
    const seen = new Set();
    for (const [format, bytes] of [['jpeg', jpeg], ['jpeg', progressive], ['png', png], ['webp', webp]]) {
      calls = [];
      const url = await api.saveProjectUpload(request(multipart(bytes, { name: `imagen.${format}`, mime: mimeFor(format) })), storage);
      ok(/^\/api\/project-media\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.webp$/.test(url)); ok(!seen.has(url)); seen.add(url);
      equal(calls.length, 1); equal(calls[0].method, 'POST'); equal(calls[0].headers['Content-Type'], 'image/webp'); equal(calls[0].headers['x-upsert'], 'false');
      ok(calls[0].url.includes('/storage/v1/object/project-media-private/thumbs/')); ok(!calls[0].url.includes('imagen'));
      const metadata = await sharp(calls[0].body).metadata(); equal(metadata.format, 'webp'); equal(metadata.width, 24); equal(metadata.height, 16);
      ok(!metadata.exif && !metadata.icc && !metadata.xmp && !metadata.iptc);
    }
    const body = new FormData(); body.append('file', new Blob([png], { type: 'image/png' }), 'miniatura legítima.png');
    const req = new Request('https://studio.example.invalid/api/dashboard/upload', { method: 'POST', body });
    equal((await api.readProjectUpload(req)).format, 'png');
  });

  await group('Source metadata disappears and thumbnails resize without enlarging', async () => {
    const tagged = await sharp(pixels).withMetadata({ exif: { IFD0: { Artist: 'INTERNAL_SECRET_METADATA' } } }).jpeg().toBuffer();
    ok((await sharp(tagged).metadata()).exif);
    const safe = await api.sanitizeProjectImage(tagged); const meta = await sharp(safe).metadata();
    ok(!meta.exif && !meta.icc && !meta.xmp && !meta.iptc); ok(!safe.toString().includes('INTERNAL_SECRET_METADATA'));
    const big = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#456789' } }).png().toBuffer();
    const resized = await sharp(await api.sanitizeProjectImage(big)).metadata(); equal(resized.width, 1920); equal(resized.height, 1280);
  });

  await group('Compressed PNG metadata never reaches the native decoder; CRC is checked before removal', async () => {
    // Only test data: 8 MiB inflated ancillary content fits in a tiny valid-CRC chunk.
    // Invalid compressed bytes are also deliberately discarded, rather than inflated.
    const compressed = deflateSync(Buffer.alloc(8 * 1024 * 1024, 65));
    const chunks = [pngChunk('iCCP', Buffer.concat([Buffer.from('profile\0\0'), compressed])),
      pngChunk('zTXt', Buffer.concat([Buffer.from('memo\0\0'), compressed])),
      pngChunk('iTXt', Buffer.concat([Buffer.from('xmp\0\x01\0\0\0'), compressed])),
      pngChunk('zTXt', Buffer.from('bad\0\0not-a-deflate-stream')), pngChunk('eXIf', Buffer.from('unneeded metadata'))];
    const bomb = Buffer.concat([png.subarray(0, 33), ...chunks, png.subarray(33)]);
    ok(bomb.length < api.PROJECT_UPLOAD_MAX_FILE_BYTES);
    const originalMetadata = sharp.prototype.metadata;
    let inspected = false;
    try {
      sharp.prototype.metadata = function (...args) {
        const input = this.options.input.buffer;
        if (input?.subarray(0, 8).equals(png.subarray(0, 8))) {
          const types = []; let position = 8;
          while (position < input.length) { const length = input.readUInt32BE(position); types.push(input.toString('ascii', position + 4, position + 8)); position += length + 12; }
          for (const type of ['iCCP', 'zTXt', 'iTXt', 'eXIf']) ok(!types.includes(type));
          inspected = true;
        }
        return originalMetadata.apply(this, args);
      };
      const clean = await api.sanitizeProjectImage(bomb); ok(inspected);
      equal(clean, await api.sanitizeProjectImage(png), 'Ancillary payload cannot change decoded thumbnail pixels');
    } finally { sharp.prototype.metadata = originalMetadata; }
    const corrupt = Buffer.from(bomb); corrupt[33 + chunks[0].length - 1] ^= 1;
    calls = []; await reject(() => api.saveProjectUpload(request(multipart(corrupt)), storage), 422); equal(calls.length, 0);
    const palette = await sharp(pixels).png({ palette: true }).toBuffer();
    const gamma = Buffer.alloc(4); gamma.writeUInt32BE(45455);
    const physical = Buffer.alloc(9); physical.writeUInt32BE(1000); physical.writeUInt32BE(1000, 4);
    const colored = Buffer.concat([palette.subarray(0, 33), pngChunk('gAMA', gamma), pngChunk('sRGB', Buffer.from([0])), pngChunk('pHYs', physical), palette.subarray(33)]);
    const alpha = await sharp(await api.sanitizeProjectImage(colored)).metadata(); equal(alpha.channels, 4); equal(alpha.width, 24); equal(alpha.height, 16);
  });

  await group('MIME/extension/content disagreement and unnecessary active formats cause zero Storage effects', async () => {
    for (const [bytes, name, mime] of [[png, 'imagen.jpg', 'image/jpeg'], [png, 'imagen.png', 'image/jpeg'], [jpeg, 'imagen.png', 'image/png'],
      [png, 'imagen.svg', 'image/svg+xml'], [png, 'imagen.png.exe', 'image/png'], [png, 'imagen.png', 'application/octet-stream'],
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'imagen.png', 'image/png'],
      [Buffer.from('<html><script>alert(1)</script></html>'), 'imagen.jpg', 'image/jpeg'], [await sharp(pixels).gif().toBuffer(), 'imagen.png', 'image/png']]) {
      calls = []; await reject(() => api.saveProjectUpload(request(multipart(bytes, { name, mime })), storage), 415); equal(calls.length, 0);
    }
  });

  await group('Truncation, bad compressed pixels, appended payloads and fake signatures are rejected', async () => {
    const corruptPng = Buffer.from(png);
    const idat = corruptPng.indexOf(Buffer.from('IDAT')); corruptPng[idat + 4] ^= 0xff;
    const chunkLength = corruptPng.readUInt32BE(idat - 4); corruptPng.writeUInt32BE(crc32(corruptPng.subarray(idat, idat + 4 + chunkLength)), idat + 4 + chunkLength);
    const corruptWebp = Buffer.from(webp); corruptWebp.fill(0, 20);
    const badCrc = Buffer.from(png); badCrc[badCrc.length - 1] ^= 1;
    const badType = Buffer.concat([png.subarray(0, -12), pngChunk('abca', Buffer.from('bad reserved bit')), png.subarray(-12)]);
    const corruptJpeg = Buffer.from(jpeg); const scan = corruptJpeg.indexOf(Buffer.from([0xff, 0xda])); const start = scan + 2 + corruptJpeg.readUInt16BE(scan + 2); corruptJpeg.fill(0, start, corruptJpeg.length - 2);
    for (const [format, bytes] of [['png', png.subarray(0, -1)], ['png', corruptPng], ['png', badCrc], ['png', badType], ['png', Buffer.concat([png, Buffer.from('<script>alert(1)</script>')])],
      ['jpeg', jpeg.subarray(0, -4)], ['jpeg', Buffer.concat([jpeg, Buffer.from('<html>active</html>')])], ['webp', corruptWebp],
      ['webp', webp.subarray(0, -2)], ['png', Buffer.concat([png.subarray(0, 8), Buffer.from('not pixels')])], ['jpeg', Buffer.from([255, 216, 255, 217])]]) {
      calls = []; await reject(() => api.saveProjectUpload(request(multipart(bytes, { name: `fake.${format}`, mime: mimeFor(format) })), storage), 422); equal(calls.length, 0);
    }
    // Some changed JPEG entropy remains a valid image; corruption is judged by the decoder, not appearance.
    ok(corruptJpeg.length === jpeg.length);
  });

  await group('APNG and animated WebP markers are explicitly blocked before decoding', async () => {
    const animatedPng = Buffer.concat([png.subarray(0, 33), pngChunk('acTL', Buffer.from([0, 0, 0, 2, 0, 0, 0, 0])), png.subarray(33)]);
    const animatedWebp = appendWebpChunk(webp, 'ANIM', Buffer.alloc(6));
    for (const [format, bytes] of [['png', animatedPng], ['webp', animatedWebp]]) {
      calls = []; await reject(() => api.saveProjectUpload(request(multipart(bytes, { name: `anim.${format}`, mime: mimeFor(format) })), storage), 415); equal(calls.length, 0);
    }
  });

  await group('Decoded dimensions and total pixels are bounded independently of compressed file size', async () => {
    for (const [width, height] of [[8193, 1], [4001, 4000]]) {
      const huge = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } }).png().toBuffer();
      ok(huge.length < api.PROJECT_UPLOAD_MAX_FILE_BYTES); calls = [];
      await reject(() => api.saveProjectUpload(request(multipart(huge)), storage), 422); equal(calls.length, 0);
    }
    const edge = await sharp({ create: { width: 8192, height: 1, channels: 3, background: '#ffffff' } }).png().toBuffer();
    equal((await sharp(await api.sanitizeProjectImage(edge)).metadata()).width, 1920);
  });

  await group('The exact 2 MiB file limit works; one extra byte creates no object', async () => {
    const exact = padPng(png, api.PROJECT_UPLOAD_MAX_FILE_BYTES); equal(exact.length, api.PROJECT_UPLOAD_MAX_FILE_BYTES);
    calls = []; ok((await api.saveProjectUpload(request(multipart(exact)), storage)).startsWith('/api/project-media/')); equal(calls.length, 1);
    calls = []; await reject(() => api.saveProjectUpload(request(multipart(padPng(png, api.PROJECT_UPLOAD_MAX_FILE_BYTES + 1))), storage), 413); equal(calls.length, 0);
  });

  await group('Missing Content-Length succeeds; actual bytes override false/small declarations', async () => {
    const body = multipart(png); const req = request(body); equal(req.headers.get('content-length'), null);
    equal((await api.readProjectUpload(req)).bytes, png);
    for (const length of ['1', String(body.length - 1), String(body.length + 1)]) {
      calls = []; await reject(() => api.saveProjectUpload(request(body, { 'content-length': length }), storage), 400); equal(calls.length, 0);
    }
    const exact = request(body, { 'content-length': String(body.length) }); equal((await api.readProjectUpload(exact)).bytes, png);
    for (const length of ['-1', '+50', '1.5', '1e6', '2, 2']) await reject(() => api.readProjectUpload(request(body, { 'content-length': length })), 400);
  });

  await group('Streaming bodies exceed the bound without concatenating or reading the full stream', async () => {
    for (const declared of [undefined, '1']) {
      let chunks = 0, canceled = false;
      const stream = new ReadableStream({ pull(controller) { chunks++; controller.enqueue(new Uint8Array(64 * 1024)); if (chunks === 100) controller.close(); }, cancel() { canceled = true; } });
      calls = []; await reject(() => api.saveProjectUpload(request(stream, declared ? { 'content-length': declared } : {}), storage), 413);
      ok(canceled); ok(chunks < 100); equal(calls.length, 0);
    }
    let read = false;
    const stream = new ReadableStream({ pull() { read = true; } }, { highWaterMark: 0 });
    await reject(() => api.readProjectUpload(request(stream, { 'content-length': String(api.PROJECT_UPLOAD_MAX_REQUEST_BYTES + 1) })), 413); equal(read, false);
    await reject(() => api.readProjectUpload(request(multipart(png), { 'content-length': '9007199254740993' })), 413);
  });

  await group('Multipart must contain exactly one file, valid closing delimiter and narrow headers', async () => {
    const extra = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="other"\r\n\r\nvalue\r\n--${boundary}--\r\n`;
    const second = `\r\n--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="second.png"\r\nContent-Type: image/png\r\n\r\nanything\r\n--${boundary}--\r\n`;
    for (const body of [multipart(png, { field: 'other' }), multipart(png, { ending: extra }), multipart(png, { ending: second }),
      multipart(png, { ending: `\r\n--${boundary}\r\n` }), multipart(png, { ending: `\r\n--${boundary}--\r\nextra` }),
      multipart(png, { header: 'Content-Type: image/png\r\n' }), multipart(png, { header: 'Content-Transfer-Encoding: base64\r\n' }),
      Buffer.from('not multipart'), Buffer.from(`--${boundary}\r\n${'a'.repeat(9000)}\r\n\r\nanything\r\n--${boundary}--`)]) {
      calls = []; await reject(() => api.saveProjectUpload(request(body), storage), 400); equal(calls.length, 0);
    }
    for (const contentType of ['application/json', 'multipart/form-data', 'multipart/form-data; boundary=a; extra=b', `multipart/form-data; boundary=${'x'.repeat(71)}`]) {
      await reject(() => api.readProjectUpload(request(multipart(png), { 'content-type': contentType })), 400);
    }
    await reject(() => api.readProjectUpload(request(multipart(png), { 'content-encoding': 'gzip' })), 400);
  });

  await group('Client names cannot supply paths, headers or overwrite existing names', async () => {
    for (const name of ['../imagen.png', '..\\imagen.png', 'C:\\imagen.png', '/imagen.png', 'bad\r\nX-Evil: yes.png', 'bad\u0000.png', 'bad\u007f.png', '.hidden.png', 'bad.png ', 'bad".png']) {
      calls = []; await reject(() => api.saveProjectUpload(request(multipart(png, { name })), storage), 400); equal(calls.length, 0);
    }
    calls = []; const first = await api.saveProjectUpload(request(multipart(png, { name: 'repetida.png' })), storage);
    const second = await api.saveProjectUpload(request(multipart(png, { name: 'repetida.png' })), storage); ok(first !== second); equal(calls.length, 2);
  });

  await group('Storage failures use safe errors and cleanup only the generated object', async () => {
    for (const mode of ['status', 'transport', 'cleanupFails']) {
      calls = [];
      const bad = { ...storage, fetchImpl: async (url, init) => {
        calls.push({ url, ...init });
        if (init.method === 'POST') { if (mode === 'transport') throw new Error('INTERNAL_SECRET'); return new Response('INTERNAL_SECRET', { status: 500 }); }
        if (mode === 'cleanupFails') throw new Error('INTERNAL_SECRET'); return new Response('{}');
      } };
      await reject(() => api.saveProjectUpload(request(multipart(png)), bad), 503); equal(calls.length, 2); equal(calls[1].method, 'DELETE');
      const prefix = JSON.parse(calls[1].body).prefixes; equal(prefix.length, 1); ok(calls[0].url.endsWith(prefix[0])); ok(/^thumbs\/[a-f0-9-]+\.webp$/.test(prefix[0]));
    }
    for (const status of [400, 409]) {
      calls = []; let preexistingObject = 'synthetic pre-existing pixels';
      const conflicting = { ...storage, fetchImpl: async (url, init) => {
        calls.push({ url, ...init });
        if (init.method === 'DELETE') { preexistingObject = null; return new Response('{}'); }
        return new Response('INTERNAL_SECRET_CONFLICT', { status });
      } };
      await reject(() => api.saveProjectUpload(request(multipart(png)), conflicting), 503);
      equal(calls.length, 1); equal(calls[0].method, 'POST'); equal(preexistingObject, 'synthetic pre-existing pixels');
    }
  });

  await group('Concurrent uploads are bounded before reading a third body', async () => {
    const waiting = [];
    const pendingStorage = { ...storage, fetchImpl: async () => new Promise(resolve => waiting.push(resolve)) };
    const pending = [api.saveProjectUpload(request(multipart(png)), pendingStorage), api.saveProjectUpload(request(multipart(png)), pendingStorage)];
    while (waiting.length < 2) await new Promise(resolve => setTimeout(resolve, 5));
    let read = false;
    const stream = new ReadableStream({ pull() { read = true; } }, { highWaterMark: 0 });
    await reject(() => api.saveProjectUpload(request(stream), storage), 429); equal(read, false);
    waiting.forEach(resolve => resolve(new Response('{}'))); equal((await Promise.all(pending)).length, 2);
    const decoding = [api.sanitizeProjectImage(png), api.sanitizeProjectImage(png)];
    await reject(() => api.sanitizeProjectImage(png), 429); await Promise.all(decoding);
    ok((await api.sanitizeProjectImage(png)).length > 0);
  });

  await group('Metadata deadline keeps native concurrency slots until timed-out work actually settles', async () => {
    const metadata = await sharp(png).metadata();
    const originalMetadata = sharp.prototype.metadata;
    const release = [];
    try {
      sharp.prototype.metadata = function () { return new Promise(resolve => release.push(resolve)); };
      const first = api.sanitizeProjectImage(png); const second = api.sanitizeProjectImage(png);
      equal(release.length, 2);
      const results = await Promise.allSettled([first, second]);
      equal(results.map(result => result.status), ['rejected', 'rejected']); equal(results.map(result => result.reason.status), [422, 422]);
      await reject(() => api.sanitizeProjectImage(png), 429);
      release.forEach(resolve => resolve(metadata));
      await new Promise(resolve => setTimeout(resolve, 10));
    } finally { sharp.prototype.metadata = originalMetadata; }
    ok((await api.sanitizeProjectImage(png)).length > 0);
  });

  await group('Aborted/stalled body and Storage deadline fail without a success or unreleased slots', async () => {
    const controller = new AbortController(); let canceled = false;
    const stream = new ReadableStream({ cancel() { canceled = true; } }, { highWaterMark: 0 });
    const req = new Request('https://studio.example.invalid/api/dashboard/upload', { method: 'POST', body: stream, duplex: 'half', signal: controller.signal,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
    const pending = api.readProjectUpload(req); controller.abort(); await reject(() => pending, 408); ok(canceled);
    calls = []; let aborted = false;
    const slow = { ...storage, fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      if (init.method === 'DELETE') return new Response('{}');
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => { aborted = true; reject(new Error('INTERNAL_SECRET')); }, { once: true }));
    } };
    const stalled = new ReadableStream({}, { highWaterMark: 0 });
    const deadlineResults = await Promise.allSettled([api.saveProjectUpload(request(multipart(png)), slow), api.readProjectUpload(request(stalled))]);
    equal(deadlineResults.map(result => result.status), ['rejected', 'rejected']); equal(deadlineResults[0].reason.status, 503); equal(deadlineResults[1].reason.status, 408);
    ok(aborted); equal(calls.length, 2); equal(calls[1].method, 'DELETE');
    ok((await api.saveProjectUpload(request(multipart(png)), storage)).startsWith('/api/project-media/'));
  });

  await group('Endpoint authorization precedes even an invalid body; JSON is private and safe', async () => {
    const req = request(Buffer.from('not multipart'));
    const unauthorized = await endpoint.POST({ request: req }); equal(unauthorized.status, 401); equal(req.bodyUsed, false);
    for (const header of ['cache-control', 'cdn-cache-control', 'vercel-cdn-cache-control']) equal(unauthorized.headers.get(header), 'no-store');
    const valid = request(multipart(png)); auth.authorizeDashboardRequest(valid);
    const endpointCalls = [];
    globalThis.fetch = async (url, init) => { endpointCalls.push({ url, ...init }); return new Response('{}'); };
    const res = await endpoint.POST({ request: valid }); equal(res.status, 200); ok((await res.json()).url.startsWith('/api/project-media/')); equal(endpointCalls.length, 1);
    const invalid = request(multipart(Buffer.from('<script>active</script>'))); auth.authorizeDashboardRequest(invalid);
    const failed = await endpoint.POST({ request: invalid }); equal(failed.status, 415); ok(typeof (await failed.json()).error === 'string'); equal(endpointCalls.length, 1);
    globalThis.fetch = async () => { throw new Error('Unexpected network call'); };
  });
  console.log(`${groups} groups, ${assertions} assertions passed (synthetic images and Storage; no remote effects).`);
} finally {
  globalThis.fetch = actualFetch;
  await vite.close();
}
