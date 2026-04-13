export function validateDashboardSecret(request: Request): boolean {
  const secret = import.meta.env.DASHBOARD_SECRET;
  if (!secret) return false;
  const provided = request.headers.get('x-dashboard-secret') || new URL(request.url).searchParams.get('secret');
  return provided === secret;
}

export function dashResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function dashError(message: string, status = 401) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

function sbHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY!,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

export async function sbQuery(table: string, query: string) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, { headers: sbHeaders() });
  if (!res.ok) {
    console.error(`[Dashboard] Query ${table} error:`, res.status);
    return [];
  }
  return res.json();
}

export async function sbPatch(table: string, query: string, body: unknown) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    method: 'PATCH',
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[Dashboard] Patch ${table} error:`, res.status);
    return null;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function sbUpsert(table: string, body: unknown) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...sbHeaders(), Prefer: 'return=representation,resolution=merge-duplicates' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[Dashboard] Upsert ${table} error:`, res.status);
    return null;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function sbInsert(table: string, body: unknown) {
  const url = `${SUPABASE_URL}/rest/v1/${table}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: sbHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`[Dashboard] Insert ${table} error:`, res.status);
    return null;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function sbDelete(table: string, query: string) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: sbHeaders(),
  });
  if (!res.ok) {
    console.error(`[Dashboard] Delete ${table} error:`, res.status);
    return false;
  }
  return true;
}

export async function sbUpload(bucket: string, path: string, file: Blob, contentType: string) {
  const url = `${SUPABASE_URL}/storage/v1/object/${bucket}/${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': contentType,
    },
    body: file,
  });
  if (!res.ok) {
    console.error(`[Dashboard] Upload ${bucket}/${path} error:`, res.status);
    return null;
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}
