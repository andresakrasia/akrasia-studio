import { dashboardRoute, dashboardList } from '../../../lib/dashboard';
export const GET = dashboardRoute(async ({ request }) => dashboardList('visitors','select=id,visitor_id,first_seen,last_seen,source&order=last_seen.desc,id.desc',request));
