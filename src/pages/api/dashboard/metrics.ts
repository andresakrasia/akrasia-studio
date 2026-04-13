import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError, sbQuery } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7).toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const [visitorsToday, leadsThisWeek, leadsByStatus, totalConversations, leadsThisMonth] =
    await Promise.all([
      sbQuery('visitors', `last_seen=gte.${todayStart}&select=id`),
      sbQuery('leads', `created_at=gte.${weekStart}&select=id`),
      sbQuery('leads', 'select=status'),
      sbQuery('conversations', `created_at=gte.${monthStart}&select=id`),
      sbQuery('leads', `created_at=gte.${monthStart}&select=id`),
    ]);

  const statusCounts: Record<string, number> = {};
  for (const l of leadsByStatus) {
    statusCounts[l.status] = (statusCounts[l.status] || 0) + 1;
  }

  return dashResponse({
    visitorsToday: visitorsToday?.length || 0,
    leadsThisWeek: leadsThisWeek?.length || 0,
    leadsThisMonth: leadsThisMonth?.length || 0,
    totalConversations: totalConversations?.length || 0,
    leadsByStatus: statusCounts,
  });
};
