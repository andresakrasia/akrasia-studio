import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError, sbQuery, sbPatch } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  const entries = await sbQuery('feed_entries', 'order=created_at.desc&limit=50');
  return dashResponse(entries || []);
};

export const POST: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return dashError('Invalid JSON', 400); }
  const SUPABASE_URL = import.meta.env.SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feed_entries`, {
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
  const result = await sbPatch('feed_entries', `id=eq.${id}`, body);
  return dashResponse(result);
};
