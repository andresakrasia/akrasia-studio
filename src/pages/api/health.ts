import type { APIRoute } from 'astro';
import { dashboardSecurityHeaders, getDashboardSession } from '../../lib/dashboard-auth';
import { inspectProductionConfiguration, operationalEvent } from '../../lib/production-config';

const respond = (body: unknown, status: number) => dashboardSecurityHeaders(new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type':'application/json; charset=utf-8' },
}));

/** Read-only, protected by the same revocable session as the admin panel.
 * The session check has its existing five-second store deadline.
 * No AI/email/Telegram call, SQL mutation, storage probe or public fingerprint.
 */
export const GET: APIRoute = async ({ request }) => {
  const started = performance.now();
  try {
    const session = await getDashboardSession(request);
    if (!session) return respond({ error:'authentication_required' },401);
    if (request.headers.get('sec-fetch-site') === 'cross-site') return respond({ error:'invalid_request_origin' },403);
    const origin = request.headers.get('origin');
    if (origin && origin !== new URL(request.url).origin) return respond({ error:'invalid_request_origin' },403);
    if (new URL(request.url).search) return respond({ error:'invalid_request' },400);
    const report = inspectProductionConfiguration(import.meta.env,{ production:import.meta.env.PROD });
    const status = report.status === 'configuration_valid' ? 200 : 503;
    operationalEvent({ event:status === 200 ? 'authenticated_health_check' : 'configuration_invalid',status,durationMs:performance.now()-started });
    return respond(report,status);
  } catch {
    operationalEvent({ event:'health_auth_unavailable',status:503,durationMs:performance.now()-started });
    return respond({ error:'health_unavailable' },503);
  }
};

