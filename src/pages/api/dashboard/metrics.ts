import { dashboardRoute, dashResponse, sbRpc, DashboardStorageError } from '../../../lib/dashboard';
const numeric = ['visitorsToday','leadsThisWeek','leadsThisMonth','totalConversations','avgMessages','avgDurationSec','avgDurationMin','conversionRatio'];
export const GET = dashboardRoute(async () => {
  const data = await sbRpc('dashboard_metrics',{ p_now:new Date().toISOString() }) as Record<string,unknown>;
  if (!data || typeof data !== 'object' || Array.isArray(data) || numeric.some(key => typeof data[key] !== 'number' || !Number.isFinite(data[key]) || Number(data[key]) < 0) || !Array.isArray(data.leadsPerWeek) || !Array.isArray(data.visitsPerDay) || !data.leadsByStatus || typeof data.leadsByStatus !== 'object') throw new DashboardStorageError();
  return dashResponse(data);
});
