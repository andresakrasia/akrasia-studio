import { dashboardRoute, dashboardJson, dashResponse, dashboardList, sbPatch, sbRpc, oneDashboardRow, requireDashboardId, dashboardId, DashboardInputError, DashboardStorageError } from '../../../lib/dashboard';
import { bookingsByVisitor, journeysByLead, chatLeadExpiry } from '../../../lib/lead-links';
import { readRetentionConfig, RETENTION_DEFAULTS } from '../../../lib/privacy-retention';

const STATUSES = ['new','hot','contacted','qualified','lost'];
const MANUAL_FIELDS: Record<string, number> = { name: 150, company: 150, email: 254, phone: 40, project_type: 80, summary: 8000, origin: 80 };
function profileDays(): number {
  try { return readRetentionConfig(import.meta.env).profileDays; } catch { return RETENTION_DEFAULTS.profileDays; }
}

export const GET = dashboardRoute(async ({ request }) => {
  const params = new URL(request.url).searchParams; let query = 'select=*&order=created_at.desc,id.desc';
  const status = params.get('status'); if (status) { if (!STATUSES.includes(status)) throw new DashboardInputError('Estado inválido.'); query += `&status=eq.${status}`; }
  const search = params.get('search'); if (search) { if (search.length > 200 || /[,()*%\\]/.test(search)) throw new DashboardInputError('Búsqueda inválida.'); const needle = encodeURIComponent(search); query += `&or=(email.ilike.*${needle}*,phone.ilike.*${needle}*,name.ilike.*${needle}*,company.ilike.*${needle}*,visitor_id.ilike.*${needle}*)`; }
  // A notice links to one contact by its id.
  if (params.has('id')) query += `&id=eq.${requireDashboardId(params.get('id'))}`;
  const response = await dashboardList('leads',query,request); const rows = await response.json() as Record<string, any>[];
  const ids = rows.map(row => requireDashboardId(row.id));
  const [journeys, bookings] = await Promise.all([journeysByLead(ids), bookingsByVisitor(rows.map(row => row.visitor_id))]);
  const days = profileDays();
  // Stage, booked call and expiry travel with the contact so the list answers
  // "where is this person" without opening three sections.
  return dashResponse(rows.map(row => ({ ...row, journey: journeys.get(row.id) ?? null, booking: bookings.get(row.visitor_id) ?? null, expires_at: chatLeadExpiry(row, days) })), 200, Object.fromEntries(response.headers));
});

/** A contact that arrived outside the chat. The operation id is the row id, so a
 * retry after an uncertain response returns the same contact. */
export const POST = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request, 16000); const id = requireDashboardId(body.operation_id);
  if (Object.keys(body).some(key => key !== 'operation_id' && !(key in MANUAL_FIELDS))) throw new DashboardInputError('Campos de contacto no admitidos.');
  const fields: Record<string, string> = {};
  for (const [key, maximum] of Object.entries(MANUAL_FIELDS)) {
    const value = body[key] ?? '';
    if (typeof value !== 'string' || /\u0000/.test(value) || (key !== 'summary' && /[\r\n]/.test(value))) throw new DashboardInputError(`El campo ${key} no es válido.`);
    fields[key] = value.trim();
    if (fields[key].length > maximum) throw new DashboardInputError(`El campo ${key} admite hasta ${maximum} caracteres.`);
  }
  if (!fields.name) throw new DashboardInputError('Indica el nombre del contacto.');
  if (fields.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(fields.email)) throw new DashboardInputError('El email no es válido.');
  const row = await sbRpc('dashboard_create_manual_lead', { p_id: id, p_fields: fields });
  if (!row || typeof row !== 'object' || Array.isArray(row) || !dashboardId((row as Record<string, unknown>).id) || (row as Record<string, unknown>).id !== id) throw new DashboardStorageError();
  return dashResponse({ ...row, journey: null, booking: null, expires_at: null }, 201);
});

export const PATCH = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request); const id = requireDashboardId(body.id);
  if (Object.keys(body).some(k => !['id','status'].includes(k)) || !STATUSES.includes(String(body.status))) throw new DashboardInputError('Estado inválido.');
  return dashResponse(oneDashboardRow(await sbPatch('leads',`id=eq.${id}`,{ status: body.status, updated_at: new Date().toISOString() }),id));
});
