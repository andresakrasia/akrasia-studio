import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError, sbQuery } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  const visitors = await sbQuery('visitors', 'order=last_seen.desc&limit=500');
  return dashResponse(visitors);
};
