import type { APIRoute } from 'astro';
import { getDashboardSession } from '../../../lib/dashboard-auth';
import { MANAGED_MEDIA_UUID, LEGACY_MEDIA_NAME } from '../../../lib/public-media';
import { PUBLIC_PROJECT_CACHE_HEADERS } from '../../../lib/public-projects';
import { sanitizeProjectImage, PROJECT_MEDIA_BUCKET, PROJECT_UPLOAD_MAX_FILE_BYTES } from '../../../lib/project-upload';

const failure = (status: number) => new Response(null, { status, headers: PUBLIC_PROJECT_CACHE_HEADERS });

/** Private Storage is read only here, after admin authentication or current A06 approval. */
export const GET: APIRoute = async ({ request, params }) => {
  const name = params.name || '';
  const legacy = name.startsWith('legacy/');
  const key = legacy ? name.slice(7) : name;
  if (!(legacy ? LEGACY_MEDIA_NAME : MANAGED_MEDIA_UUID).test(key) || new URL(request.url).search) return failure(404);
  const base = import.meta.env.SUPABASE_URL?.replace(/\/$/, '');
  const secret = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !secret) return failure(503);
  const canonical = `/api/project-media/${name}`;
  const bucket = legacy ? 'project-thumbnails' : PROJECT_MEDIA_BUCKET;
  const objectKey = legacy ? key : `thumbs/${key}`;
  const headers = { apikey: secret, Authorization: `Bearer ${secret}` };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const admin = request.headers.get('sec-fetch-site') !== 'cross-site' && await getDashboardSession(request);
    if (!admin) {
      // Query the exact reference, never accept user-selected filters or trust REST alone.
      const references = [canonical];
      if (legacy) references.push(`${base}/storage/v1/object/public/project-thumbnails/${key}`);
      let published = false;
      for (const reference of references) {
        const query = new URLSearchParams({ select: 'thumbnail,is_published', thumbnail: `eq.${reference}`, is_published: 'eq.true', limit: '1' });
        const result = await fetch(`${base}/rest/v1/projects?${query}`, { headers, signal: controller.signal, cache: 'no-store', redirect: 'error' });
        if (!result.ok) { await result.body?.cancel(); return failure(503); }
        const rows: unknown = await result.json();
        if (!Array.isArray(rows)) return failure(503);
        if (rows.some(row => row && typeof row === 'object' && row.is_published === true && row.thumbnail === reference)) { published = true; break; }
      }
      if (!published) return failure(404);
    }
    const object = await fetch(`${base}/storage/v1/object/authenticated/${bucket}/${objectKey}`, {
      headers, signal: controller.signal, cache: 'no-store', redirect: 'error',
    });
    if (!object.ok) { await object.body?.cancel(); return failure(object.status === 404 ? 404 : 503); }
    const length = object.headers.get('content-length');
    if (length && (!/^\d+$/.test(length) || Number(length) > PROJECT_UPLOAD_MAX_FILE_BYTES)) {
      await object.body?.cancel(); return failure(422);
    }
    if (!object.body) return failure(422);
    const reader = object.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > PROJECT_UPLOAD_MAX_FILE_BYTES) { await reader.cancel(); return failure(422); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    // Legacy Storage may contain active or corrupt content from before A10.
    const image = await sanitizeProjectImage(Buffer.concat(chunks, total));
    return new Response(new Uint8Array(image), { headers: {
      ...PUBLIC_PROJECT_CACHE_HEADERS, 'Content-Type': 'image/webp',
      'Content-Disposition': 'inline; filename="thumbnail.webp"',
      'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin',
    } });
  } catch { return failure(503); }
  finally { clearTimeout(timeout); }
};
