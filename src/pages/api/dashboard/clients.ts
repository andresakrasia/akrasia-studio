import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError, sbQuery, sbPatch } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  const clients = await sbQuery('clients', 'order=name.asc');
  return dashResponse(clients || []);
};

export const POST: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return dashError('Invalid JSON', 400); }
  const SUPABASE_URL = import.meta.env.SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return dashResponse(data, 201);
};

export const PATCH: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return dashError('Invalid JSON', 400); }
  const id = body.id as string;
  if (!id) return dashError('id required', 400);
  delete body.id;
  body.updated_at = new Date().toISOString();
  const result = await sbPatch('clients', `id=eq.${id}`, body);
  return dashResponse(result);
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return dashError('id required', 400);
  const SUPABASE_URL = import.meta.env.SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${SUPABASE_URL}/rest/v1/clients?id=eq.${id}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return dashResponse({ deleted: true });
};
