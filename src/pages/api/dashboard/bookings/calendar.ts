import { dashboardRoute, requireDashboardId, DashboardInputError, sbQuery, oneDashboardRow } from '../../../../lib/dashboard';
import { calendarResponse } from '../../../../lib/booking-calendar';
export const GET = dashboardRoute(async ({ request }) => {
  const url = new URL(request.url); const ids = url.searchParams.getAll('id');
  if (ids.length !== 1 || [...url.searchParams].some(([key]) => key !== 'id')) throw new DashboardInputError('Referencia de reserva inválida.');
  const id = requireDashboardId(ids[0]);
  const row = oneDashboardRow(await sbQuery('bookings', `id=eq.${id}&select=id,booked_date,booked_time,duration_min,meet_url,status,created_at&limit=1`), id);
  return calendarResponse({ id, date: row.booked_date, time: row.booked_time.slice(0,5), duration: row.duration_min,
    meetUrl: row.meet_url, status: row.status, createdAt: row.created_at });
});
