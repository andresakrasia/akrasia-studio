import { dashboardRoute, dashboardJson, dashResponse, dashboardList, sbPatch, oneDashboardRow, requireDashboardId, DashboardInputError } from '../../../lib/dashboard';
export const GET = dashboardRoute(async ({ request }) => {
  const params = new URL(request.url).searchParams; let query = 'select=*&order=created_at.desc,id.desc';
  const status = params.get('status'); if (status) { if (!['new','hot','contacted','qualified','lost'].includes(status)) throw new DashboardInputError('Estado inválido.'); query += `&status=eq.${status}`; }
  const search = params.get('search'); if (search) { if (search.length > 200 || /[,()*%\\]/.test(search)) throw new DashboardInputError('Búsqueda inválida.'); const needle = encodeURIComponent(search); query += `&or=(email.ilike.*${needle}*,phone.ilike.*${needle}*,name.ilike.*${needle}*,company.ilike.*${needle}*,visitor_id.ilike.*${needle}*)`; }
  return dashboardList('leads',query,request);
});
export const PATCH = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request); const id = requireDashboardId(body.id);
  if (Object.keys(body).some(k => !['id','status'].includes(k)) || !['new','hot','contacted','qualified','lost'].includes(String(body.status))) throw new DashboardInputError('Estado inválido.');
  return dashResponse(oneDashboardRow(await sbPatch('leads',`id=eq.${id}`,{ status: body.status, updated_at: new Date().toISOString() }),id));
});
