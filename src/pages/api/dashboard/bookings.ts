import { dashboardRoute, dashboardJson, dashResponse, DashboardInputError, DashboardStorageError, requireDashboardId, dashboardList, oneDashboardRow, sbRpc, dashboardRows } from '../../../lib/dashboard';
import { addCivilDays, isCivilDate, madridDateKey } from '../../../lib/civil-time';
export const GET = dashboardRoute(async ({ request }) => {
  const url = new URL(request.url); const from = url.searchParams.get('from') || madridDateKey(); const to = url.searchParams.get('to') || addCivilDays(from, 30);
  if (!isCivilDate(from) || !isCivilDate(to) || to < from || to > addCivilDays(from, 366)) throw new DashboardInputError('Intervalo de fechas inválido.');
  return dashboardList('bookings', `booked_date=gte.${from}&booked_date=lte.${to}&order=booked_date,booked_time,id`, request);
});
export const PATCH = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request, 1024); const id = requireDashboardId(body.id);
  if (Object.keys(body).some(key => !['id','status'].includes(key)) || !['cancelled','completed'].includes(String(body.status))) throw new DashboardInputError('Solo se puede cancelar o completar una reserva. Para cambiar fecha, crea una nueva propuesta.');
  const result=await sbRpc('booking_admin_status',{p_id:id,p_status:body.status});
  if (result && typeof result==='object' && !Array.isArray(result) && (result as Record<string,unknown>).error==='not_found') throw new DashboardStorageError(404);
  const rows=dashboardRows(result);
  return dashResponse([oneDashboardRow(rows, id)]);
});
