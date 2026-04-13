import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError, sbQuery, sbPatch } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  const stats = await sbQuery('studio_stats', 'order=key.asc');
  return dashResponse(stats || []);
};

export const PATCH: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  let body: { key?: string; value?: number; label?: string };
  try { body = await request.json(); } catch { return dashError('Invalid JSON', 400); }
  if (!body.key) return dashError('key required', 400);
  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.value !== undefined) updateData.value = body.value;
  if (body.label) updateData.label = body.label;
  const result = await sbPatch('studio_stats', `key=eq.${body.key}`, updateData);
  return dashResponse(result);
};
