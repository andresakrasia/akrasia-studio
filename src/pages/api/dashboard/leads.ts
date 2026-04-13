import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError, sbQuery, sbPatch } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  const url = new URL(request.url);
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search');

  let query = 'order=created_at.desc&limit=500';
  if (status) query += `&status=eq.${status}`;
  if (search) query += `&or=(email.ilike.*${search}*,phone.ilike.*${search}*,name.ilike.*${search}*,company.ilike.*${search}*)`;

  const leads = await sbQuery('leads', query);
  return dashResponse(leads);
};

export const PATCH: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  let body: { id?: string; status?: string };
  try {
    body = await request.json();
  } catch {
    return dashError('Invalid JSON', 400);
  }

  if (!body.id || !body.status) return dashError('id and status required', 400);

  const validStatuses = ['new', 'contacted', 'qualified', 'lost'];
  if (!validStatuses.includes(body.status)) return dashError('Invalid status', 400);

  const result = await sbPatch('leads', `id=eq.${body.id}`, {
    status: body.status,
    updated_at: new Date().toISOString(),
  });

  return dashResponse(result);
};
