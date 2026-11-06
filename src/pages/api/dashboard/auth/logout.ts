import type { APIRoute } from 'astro';
import { DASHBOARD_COOKIE, revokeDashboardSession } from '../../../../lib/dashboard-auth';
import { dashError, dashResponse, validateDashboardSession } from '../../../../lib/dashboard';

export const POST: APIRoute = async ({ request, locals, cookies }) => {
  if (!validateDashboardSession(request) || !locals.dashboardSession) return dashError('Authentication required');
  try {
    // Revoke before clearing the cookie: a copied cookie must also stop working.
    await revokeDashboardSession(locals.dashboardSession.tokenHash);
    cookies.delete(DASHBOARD_COOKIE, { path: '/', secure: import.meta.env.PROD, httpOnly: true, sameSite: 'strict' });
    cookies.delete('dashboard_pin_verified', { path: '/' });
    return dashResponse({ ok: true });
  } catch {
    return dashError('Authentication temporarily unavailable', 503);
  }
};
