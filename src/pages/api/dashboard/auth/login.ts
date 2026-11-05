import type { APIRoute } from 'astro';
import {
  consumeDashboardLoginAttempt, createDashboardSession, DASHBOARD_COOKIE,
  DASHBOARD_SESSION_SECONDS, hasDashboardOrigin, verifyDashboardPassword,
} from '../../../../lib/dashboard-auth';
import { dashError, dashResponse } from '../../../../lib/dashboard';

export const POST: APIRoute = async (context) => {
  const { request, cookies } = context;
  try {
    if (!hasDashboardOrigin(request)) return dashError('Invalid request origin', 403);
    const limit = await consumeDashboardLoginAttempt(context.clientAddress);
    if (!limit.allowed) {
      return new Response(JSON.stringify({ error: 'Demasiados intentos. Espera antes de volver a acceder.' }), {
        status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(limit.retryAfter) },
      });
    }
    if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return dashError('Invalid content type', 415);
    // Bound even streamed bodies, rather than trusting Content-Length.
    const reader = request.body?.getReader();
    if (!reader) return dashError('Invalid request', 400);
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 2048) { await reader.cancel(); return dashError('Request too large', 413); }
      chunks.push(value);
    }
    let body: unknown;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { return dashError('Invalid JSON', 400); }
    if (!body || typeof body !== 'object' || !('password' in body) || typeof body.password !== 'string') return dashError('Invalid request', 400);
    if (!await verifyDashboardPassword(body.password)) return dashError('Credenciales incorrectas.', 401);
    const session = await createDashboardSession();
    cookies.set(DASHBOARD_COOKIE, session.token, {
      httpOnly: true, secure: import.meta.env.PROD, sameSite: 'strict', path: '/',
      maxAge: DASHBOARD_SESSION_SECONDS,
    });
    cookies.delete('dashboard_pin_verified', { path: '/' });
    return dashResponse({ ok: true, expiresAt: session.expiresAt });
  } catch {
    return dashError('Authentication temporarily unavailable', 503);
  }
};
