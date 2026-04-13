import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError, sbQuery, sbUpsert } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  const url = new URL(request.url);
  const type = url.searchParams.get('type');

  if (type !== 'projects' && type !== 'services') return dashError('type must be projects or services', 400);

  const stored = await sbQuery('content', `key=eq.${type}`);
  if (stored && stored.length > 0) return dashResponse(stored[0].data);

  const fallback = type === 'projects'
    ? await import('../../../data/projects.json').then((m) => m.default)
    : await import('../../../data/services.json').then((m) => m.default);

  return dashResponse(fallback);
};

export const PUT: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  let body: { key?: string; data?: unknown };
  try {
    body = await request.json();
  } catch {
    return dashError('Invalid JSON', 400);
  }

  if (!body.key || !body.data) return dashError('key and data required', 400);
  if (body.key !== 'projects' && body.key !== 'services') return dashError('Invalid key', 400);

  const result = await sbUpsert('content', {
    key: body.key,
    data: body.data,
    updated_at: new Date().toISOString(),
  });

  return dashResponse(result);
};
