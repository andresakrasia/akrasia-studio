import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError, sbQuery, sbPatch } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  const url = new URL(request.url);
  const withTasks = url.searchParams.get('tasks') === 'true';
  const projects = await sbQuery('projects', 'order=sort_order.asc&select=*');
  if (!withTasks || !projects) return dashResponse(projects || []);

  const projectIds = projects.map((p: { id: string }) => p.id).join(',');
  const tasks = projectIds ? await sbQuery('project_tasks', `project_id=in.(${projectIds})&order=created_at.asc`) : [];
  const tasksByProject: Record<string, unknown[]> = {};
  for (const t of (tasks || [])) {
    if (!tasksByProject[t.project_id]) tasksByProject[t.project_id] = [];
    tasksByProject[t.project_id].push(t);
  }
  const result = projects.map((p: { id: string }) => ({ ...p, tasks: tasksByProject[p.id] || [] }));
  return dashResponse(result);
};

export const POST: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  let body: Record<string, unknown>;
  try { body = await request.json(); } catch { return dashError('Invalid JSON', 400); }

  const slug = (body.title as string || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

  const cleanBody: Record<string, unknown> = {};
  const allowedFields = ['title', 'slug', 'type', 'client_name', 'client_id', 'description', 'status', 'thumbnail', 'video_url', 'resolution', 'aspect', 'duration', 'category', 'sort_order'];
  for (const key of allowedFields) {
    if (body[key] !== undefined) cleanBody[key] = body[key];
  }
  if (body.thumbnail_url !== undefined) cleanBody.thumbnail = body.thumbnail_url;
  cleanBody.slug = slug;
  cleanBody.updated_at = new Date().toISOString();

  const SUPABASE_URL = import.meta.env.SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=representation',
    },
    body: JSON.stringify(cleanBody),
  });
  if (!res.ok) {
    const err = await res.text();
    return dashError(err, res.status);
  }
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

  const cleanBody: Record<string, unknown> = { updated_at: new Date().toISOString() };
  const allowedFields = ['title', 'slug', 'type', 'client_name', 'client_id', 'description', 'status', 'thumbnail', 'video_url', 'resolution', 'aspect', 'duration', 'category', 'sort_order'];
  for (const key of allowedFields) {
    if (body[key] !== undefined) cleanBody[key] = body[key];
  }
  if (body.thumbnail_url !== undefined) cleanBody.thumbnail = body.thumbnail_url;
  const result = await sbPatch('projects', `id=eq.${id}`, cleanBody);
  return dashResponse(result);
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  if (!id) return dashError('id required', 400);

  const SUPABASE_URL = import.meta.env.SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  await fetch(`${SUPABASE_URL}/rest/v1/projects?id=eq.${id}`, {
    method: 'DELETE',
    headers: { apikey: SUPABASE_KEY!, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  return dashResponse({ deleted: true });
};
