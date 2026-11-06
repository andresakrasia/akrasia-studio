import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

export const PROJECT_MEDIA_BUCKET = 'project-media-private';
export const PROJECT_UPLOAD_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const PROJECT_UPLOAD_MAX_REQUEST_BYTES = PROJECT_UPLOAD_MAX_FILE_BYTES + 16 * 1024;
export const PROJECT_IMAGE_MAX_PIXELS = 16_000_000;
export const PROJECT_IMAGE_MAX_DIMENSION = 8192;
export const PROJECT_IMAGE_OUTPUT_DIMENSION = 1920;
const MAX_HEADERS_BYTES = 8192;
const REQUEST_TIMEOUT_MS = 10_000;
const STORAGE_TIMEOUT_MS = 10_000;
const CLEANUP_TIMEOUT_MS = 3000;
const IMAGE_TIMEOUT_SECONDS = 3;
const MAX_CONCURRENT_OPERATIONS = 2;
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  return crc >>> 0;
});
let activeUploads = 0;
let activeImages = 0;

export type ProjectImageFormat = 'jpeg' | 'png' | 'webp';
export class ProjectUploadError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
const invalidMultipart = () => new ProjectUploadError('La petición de carga no es válida.', 400);
const invalidImage = () => new ProjectUploadError('La imagen está dañada o no es una imagen estática válida.', 422);
const tooLarge = () => new ProjectUploadError('La imagen debe ocupar como máximo 2 MiB.', 413);
const busy = () => new ProjectUploadError('Hay otras imágenes procesándose. Inténtalo de nuevo.', 429);
const supported = () => new ProjectUploadError('Solo se admiten imágenes JPEG, PNG o WebP estáticas.', 415);
const unavailable = () => new ProjectUploadError('No se ha podido guardar la imagen. Inténtalo de nuevo.', 503);

function multipartBoundary(request: Request): string {
  // Deliberately one simple browser file part; unsupported encodings/parameters are rejected.
  const type = request.headers.get('content-type') || '';
  const match = /^multipart\/form-data\s*;\s*boundary=(?:"([A-Za-z0-9'()+_,.\/:=? -]{1,70})"|([A-Za-z0-9'()+_,.\/:=?-]{1,70}))\s*$/i.exec(type);
  const boundary = match?.[1] || match?.[2];
  if (!boundary || boundary.endsWith(' ')) throw invalidMultipart();
  const encoding = request.headers.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') throw invalidMultipart();
  return boundary;
}

async function readBoundedBody(request: Request): Promise<Buffer> {
  const declared = request.headers.get('content-length');
  if (declared !== null && !/^(0|[1-9][0-9]*)$/.test(declared)) throw invalidMultipart();
  const length = declared === null ? null : Number(declared);
  if (length !== null && (!Number.isSafeInteger(length) || length > PROJECT_UPLOAD_MAX_REQUEST_BYTES)) throw tooLarge();
  if (!request.body) throw invalidMultipart();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let failed = false;
  try {
    const interruption = new Promise<never>((_, reject) => {
      const stop = () => { failed = true; reject(new ProjectUploadError('La carga ha caducado. Inténtalo de nuevo.', 408)); void reader.cancel().catch(() => {}); };
      timer = setTimeout(stop, REQUEST_TIMEOUT_MS);
      abort = stop;
      request.signal.addEventListener('abort', stop, { once: true });
      if (request.signal.aborted) stop();
    });
    while (true) {
      const { done, value } = await Promise.race([reader.read(), interruption]);
      if (done) break;
      total += value.byteLength;
      // Never retain or concatenate an oversized body, including missing/false Content-Length.
      if (total > PROJECT_UPLOAD_MAX_REQUEST_BYTES) { failed = true; void reader.cancel().catch(() => {}); throw tooLarge(); }
      chunks.push(value);
    }
    if (length !== null && total !== length) throw invalidMultipart();
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof ProjectUploadError) throw error;
    throw invalidMultipart();
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) request.signal.removeEventListener('abort', abort);
    if (failed) void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function readProjectUpload(request: Request): Promise<{ bytes: Buffer; format: ProjectImageFormat }> {
  const boundary = multipartBoundary(request);
  const body = await readBoundedBody(request);
  const opening = Buffer.from(`--${boundary}\r\n`);
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  if (!body.subarray(0, opening.length).equals(opening)) throw invalidMultipart();
  const headerEnd = body.indexOf('\r\n\r\n', opening.length, 'utf8');
  if (headerEnd < 0 || headerEnd - opening.length > MAX_HEADERS_BYTES) throw invalidMultipart();
  let headerText: string;
  try { headerText = new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(opening.length, headerEnd)); }
  catch { throw invalidMultipart(); }
  const headers = new Map<string, string>();
  for (const line of headerText.split('\r\n')) {
    const match = /^([A-Za-z-]+):[ \t]*(.*)$/.exec(line);
    if (!match || /[\u0000-\u001f\u007f]/u.test(match[2]) || headers.has(match[1].toLowerCase())) throw invalidMultipart();
    const key = match[1].toLowerCase();
    if (key !== 'content-disposition' && key !== 'content-type') throw invalidMultipart();
    headers.set(key, match[2]);
  }
  const disposition = headers.get('content-disposition') || '';
  const file = /^form-data;[ \t]*name="file";[ \t]*filename="([^"\r\n]{1,255})"$/i.exec(disposition);
  if (!file || /[\u0000-\u001f\u007f\\/<>:|?*]/u.test(file[1]) || file[1].startsWith('.') || file[1].endsWith(' ') || file[1].endsWith('.')) throw invalidMultipart();
  const extension = /\.(jpe?g|png|webp)$/i.exec(file[1])?.[1].toLowerCase();
  const mime = headers.get('content-type')?.toLowerCase();
  const format: ProjectImageFormat | undefined = extension === 'jpg' || extension === 'jpeg' ? 'jpeg' : extension === 'png' || extension === 'webp' ? extension : undefined;
  if (!format || mime !== `image/${format}`) throw supported();
  const start = headerEnd + 4;
  const end = body.indexOf(delimiter, start);
  if (end < 0) throw invalidMultipart();
  const suffix = body.subarray(end + delimiter.length);
  if (!suffix.equals(Buffer.from('--\r\n')) && !suffix.equals(Buffer.from('--'))) throw invalidMultipart();
  const bytes = body.subarray(start, end);
  if (!bytes.length) throw invalidImage();
  if (bytes.length > PROJECT_UPLOAD_MAX_FILE_BYTES) throw tooLarge();
  return { bytes, format };
}

function jpegEnvelope(bytes: Buffer): void {
  let position = 2;
  while (position < bytes.length) {
    if (bytes[position] !== 0xff) throw invalidImage();
    while (bytes[position] === 0xff) position++;
    const marker = bytes[position++];
    if (marker === 0xd9) { if (position !== bytes.length) throw invalidImage(); return; }
    if (marker === undefined || marker === 0 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) throw invalidImage();
    if (marker === 1) continue;
    if (position + 2 > bytes.length) throw invalidImage();
    const length = bytes.readUInt16BE(position);
    if (length < 2 || position + length > bytes.length) throw invalidImage();
    position += length;
    if (marker !== 0xda) continue;
    // Entropy-coded scans allow stuffed FF bytes/restart markers; progressive JPEGs
    // return to the segment parser for each subsequent scan, and require exact EOI.
    let foundMarker = false;
    while (position < bytes.length) {
      if (bytes[position++] !== 0xff) continue;
      const markerStart = position - 1;
      while (bytes[position] === 0xff) position++;
      const next = bytes[position];
      if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { position++; continue; }
      position = markerStart; foundMarker = true; break;
    }
    if (!foundMarker) throw invalidImage();
  }
  throw invalidImage();
}

function prepareImage(bytes: Buffer): { format: ProjectImageFormat; decoderInput: Buffer } {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) { jpegEnvelope(bytes); return { format: 'jpeg', decoderInput: bytes }; }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    let position = 8, first = true, hasPixels = false;
    const decoderChunks = [bytes.subarray(0, 8)];
    while (position + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(position);
      const type = bytes.toString('latin1', position + 4, position + 8);
      if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) || (first && (type !== 'IHDR' || length !== 13)) || (!first && type === 'IHDR') || position + 12 + length > bytes.length) throw invalidImage();
      if (type[0] === type[0].toUpperCase() && !['IHDR', 'PLTE', 'IDAT', 'IEND'].includes(type)) throw invalidImage();
      let crc = 0xffffffff;
      for (let offset = position + 4; offset < position + 8 + length; offset++) crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ bytes[offset]) & 0xff];
      if (((crc ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(position + 8 + length)) throw invalidImage();
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) throw supported();
      if (type === 'IDAT') hasPixels = true;
      // Validate the whole original envelope/CRC first, but never ask libpng to
      // inflate optional iCCP/zTXt/iTXt (or interpret EXIF/XMP/private metadata).
      // A small compressed ancillary chunk can expand independently of pixel caps.
      // Keep only raster chunks and uncompressed, fixed-size color/alpha hints.
      if (['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'pHYs', 'sBIT'].includes(type)) {
        if ((['gAMA', 'sRGB', 'pHYs', 'cHRM'].includes(type) && length !== ({ gAMA: 4, sRGB: 1, pHYs: 9, cHRM: 32 } as Record<string, number>)[type]) || (type === 'sBIT' && (length < 1 || length > 4)) || (type === 'tRNS' && (length < 1 || length > 256))) throw invalidImage();
        decoderChunks.push(bytes.subarray(position, position + 12 + length));
      }
      position += 12 + length; first = false;
      if (type === 'IEND') {
        if (length !== 0 || position !== bytes.length || !hasPixels) throw invalidImage();
        return { format: 'png', decoderInput: Buffer.concat(decoderChunks) };
      }
    }
    throw invalidImage();
  }
  if (bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length) throw invalidImage();
    let position = 12;
    while (position + 8 <= bytes.length) {
      const type = bytes.toString('ascii', position, position + 4);
      const length = bytes.readUInt32LE(position + 4);
      if (position + 8 + length + (length % 2) > bytes.length) throw invalidImage();
      if (['ANIM', 'ANMF'].includes(type) || (type === 'VP8X' && length > 0 && (bytes[position + 8] & 2))) throw supported();
      position += 8 + length + (length % 2);
    }
    if (position !== bytes.length) throw invalidImage();
    return { format: 'webp', decoderInput: bytes };
  }
  throw supported();
}

/** Only decoded, static raster pixels leave this function; source metadata is dropped. */
export async function sanitizeProjectImage(input: Uint8Array, expectedFormat?: ProjectImageFormat): Promise<Buffer> {
  if (!input.length) throw invalidImage();
  if (input.byteLength > PROJECT_UPLOAD_MAX_FILE_BYTES) throw tooLarge();
  if (activeImages >= MAX_CONCURRENT_OPERATIONS) throw busy();
  activeImages++;
  let processing: Promise<Buffer> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    const { format, decoderInput } = prepareImage(bytes);
    if (expectedFormat && format !== expectedFormat) throw supported();
    const image = sharp(decoderInput, { failOn: 'warning', limitInputPixels: PROJECT_IMAGE_MAX_PIXELS, limitInputChannels: 4, sequentialRead: true });
    let expired = false;
    processing = (async () => {
      const metadata = await image.metadata();
      if (expired) throw invalidImage();
      if (metadata.format !== format || (metadata.pages ?? 1) !== 1 || metadata.delay || metadata.loop !== undefined) throw supported();
      if (!metadata.width || !metadata.height || metadata.width > PROJECT_IMAGE_MAX_DIMENSION || metadata.height > PROJECT_IMAGE_MAX_DIMENSION || metadata.width * metadata.height > PROJECT_IMAGE_MAX_PIXELS) {
        throw new ProjectUploadError('La imagen debe tener como máximo 8192 píxeles por lado y 16 millones de píxeles.', 422);
      }
      const result = await image.rotate().resize({ width: PROJECT_IMAGE_OUTPUT_DIMENSION, height: PROJECT_IMAGE_OUTPUT_DIMENSION, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80, effort: 3 }).timeout({ seconds: IMAGE_TIMEOUT_SECONDS }).toBuffer();
      if (result.length > PROJECT_UPLOAD_MAX_FILE_BYTES) throw tooLarge();
      return result;
    })();
    // A JS deadline also bounds metadata and the libuv queue, which libvips'
    // processing timeout excludes. Native work may outlive destroy(); keep its
    // slot occupied until it actually settles, preventing repeated timeout bypass.
    void processing.then(() => { activeImages--; }, () => { activeImages--; });
    return await Promise.race([processing, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; image.destroy(); reject(invalidImage()); }, IMAGE_TIMEOUT_SECONDS * 1000);
    })]);
  } catch (error) {
    if (error instanceof ProjectUploadError) throw error;
    throw invalidImage();
  } finally {
    if (timer) clearTimeout(timer);
    if (!processing) activeImages--;
  }
}

export interface ProjectUploadStorage {
  supabaseUrl: string;
  serviceKey: string;
  fetchImpl?: typeof fetch;
}

async function storageFetch(fetcher: typeof fetch, url: string, init: RequestInit, timeout: number): Promise<Response> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([fetcher(url, { ...init, signal: controller.signal }), new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, timeout);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}

export async function saveProjectUpload(request: Request, storage: ProjectUploadStorage): Promise<string> {
  if (activeUploads >= MAX_CONCURRENT_OPERATIONS) throw busy();
  activeUploads++;
  try {
    const { bytes, format } = await readProjectUpload(request);
    const safeImage = await sanitizeProjectImage(bytes, format);
    const id = randomUUID();
    const key = `thumbs/${id}.webp`;
    let base: URL;
    try { base = new URL(storage.supabaseUrl); }
    catch { throw unavailable(); }
    if (!storage.serviceKey || !['https:', 'http:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw unavailable();
    const baseUrl = base.href.replace(/\/$/, '');
    const fetcher = storage.fetchImpl ?? fetch;
    const credentials = { apikey: storage.serviceKey, Authorization: `Bearer ${storage.serviceKey}` };
    let cleanupRequired = true;
    try {
      const response = await storageFetch(fetcher, `${baseUrl}/storage/v1/object/${PROJECT_MEDIA_BUCKET}/${key}`, {
        method: 'POST', headers: { ...credentials, 'Content-Type': 'image/webp', 'x-upsert': 'false' }, body: new Uint8Array(safeImage),
      }, STORAGE_TIMEOUT_MS);
      // Storage error bodies are never read or relayed; they can contain internal details.
      void response.body?.cancel().catch(() => {});
      // Standard Storage uploads document duplicate assets as 400; newer error
      // codes also use 409. Neither rejected write owns a pre-existing object.
      // Do not inspect an unbounded error body to distinguish 400 variants.
      if (response.status === 400 || response.status === 409) cleanupRequired = false;
      if (!response.ok) throw unavailable();
      return `/api/project-media/${id}.webp`;
    } catch {
      // An uncertain write can have created an object. Cleanup only this server UUID;
      // no user-provided name can select an existing object. Late commits/outages still
      // require the documented orphan review on the real platform.
      if (cleanupRequired) {
        try {
          const cleanup = await storageFetch(fetcher, `${baseUrl}/storage/v1/object/${PROJECT_MEDIA_BUCKET}`, {
            method: 'DELETE', headers: { ...credentials, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }),
          }, CLEANUP_TIMEOUT_MS);
          void cleanup.body?.cancel().catch(() => {});
        } catch { /* Preserve a safe failure even if cleanup is unavailable. */ }
      }
      throw unavailable();
    }
  } finally { activeUploads--; }
}
