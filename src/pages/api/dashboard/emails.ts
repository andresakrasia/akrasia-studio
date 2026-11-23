import { dashboardRoute, DashboardInputError, dashboardList, requireDashboardId } from '../../../lib/dashboard';
import { isVisitorUuid } from '../../../lib/visitor-data';
export const GET = dashboardRoute(async ({ request }) => {
  const url = new URL(request.url); const lead = url.searchParams.get('lead_id'); const visitor = url.searchParams.get('visitor_id'); let query='order=created_at.desc,id.desc';
  if (lead) query += `&lead_id=eq.${requireDashboardId(lead)}`;
  if (visitor) { if (!isVisitorUuid(visitor)) throw new DashboardInputError('Visitante inválido.'); query += `&visitor_id=eq.${visitor}`; }
  return dashboardList('sent_emails', query, request);
});
