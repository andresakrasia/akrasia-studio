import { defineMiddleware } from 'astro:middleware';
import {
  authorizeDashboardRequest, dashboardSecurityHeaders, getDashboardSession,
  hasDashboardOrigin, validDashboardCsrf,
} from './lib/dashboard-auth';
import { PUBLIC_PROJECT_CACHE_HEADERS } from './lib/public-projects';
import { isCivilDate } from './lib/civil-time';

function dashboardNavigationParams(search: URLSearchParams): URLSearchParams {
  const clean = new URLSearchParams();
  for (const key of ['tab', 'visitor_id']) {
    const value = search.get(key);
    if (value) clean.set(key, value.slice(0, 128));
  }
  const date = search.get('date');
  if (search.get('tab') === 'bookings' && search.getAll('tab').length === 1 && search.getAll('date').length === 1 && isCivilDate(date)) clean.set('date', date);
  return clean;
}

function loginReturnDestination(url: URL): string {
  const candidate = url.searchParams.get('returnTo');
  if (!candidate || url.searchParams.getAll('returnTo').length !== 1) return '/dashboard';
  try {
    const requested = new URL(candidate, url.origin);
    if (requested.origin !== url.origin || requested.pathname !== '/dashboard') return '/dashboard';
    const clean = dashboardNavigationParams(requested.searchParams);
    const tab = clean.get('tab');
    if (tab && !['overview', 'visitors', 'conversations', 'leads', 'projects', 'feed', 'studio', 'content', 'bookings'].includes(tab)) clean.delete('tab');
    const visitor = clean.get('visitor_id');
    if (visitor && !/^[a-zA-Z0-9_-]{1,128}$/.test(visitor)) clean.delete('visitor_id');
    return `/dashboard${clean.size ? `?${clean}` : ''}`;
  } catch { return '/dashboard'; }
}

const jsonError = (error: string, status: number) => new Response(JSON.stringify({ error }), {
  status, headers: { 'Content-Type': 'application/json' },
});

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, locals, url } = context;
  // Normalize encoded path segments too, so encoding never bypasses the guard.
  let path: string;
  try { path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/'; }
  catch { return jsonError('Invalid path', 400); }
  const api = path === '/api/dashboard' || path.startsWith('/api/dashboard/');
  const page = path === '/dashboard' || path.startsWith('/dashboard/');
  if (!api && !page) {
    const response = await next();
    if (path === '/' || path === '/sitemap.xml' || path.startsWith('/proyectos/') ||
        ['/api/projects', '/api/feed', '/api/logs', '/api/stats'].includes(path)) {
      for (const [key, value] of Object.entries(PUBLIC_PROJECT_CACHE_HEADERS)) response.headers.set(key, value);
    }
    return response;
  }

  const respond = dashboardSecurityHeaders;
  const loginApi = path === '/api/dashboard/auth/login';
  const loginPage = path === '/dashboard/login';
  const read = request.method === 'GET' || request.method === 'HEAD';
  // Retire every credential-bearing legacy URL before rendering any content.
  if (page && !loginPage && path !== '/dashboard') {
    return respond(new Response(null, { status: 303, headers: { Location: '/dashboard' } }));
  }
  if (page && path === '/dashboard' && read && ([...url.searchParams.keys()].some(key => !['tab', 'visitor_id', 'date'].includes(key)) ||
      (url.searchParams.has('date') && !dashboardNavigationParams(url.searchParams).has('date')))) {
    const clean = dashboardNavigationParams(url.searchParams);
    return respond(new Response(null, { status: 303, headers: { Location: `/dashboard${clean.size ? `?${clean}` : ''}` } }));
  }
  if (loginPage && read) {
    try {
      if (await getDashboardSession(request)) {
        return respond(new Response(null, { status: 303, headers: { Location: loginReturnDestination(url) } }));
      }
    } catch {
      return respond(jsonError('Authentication temporarily unavailable', 503));
    }
    return respond(await next());
  }
  if (loginApi) {
    if (request.method !== 'POST') return respond(jsonError('Method not allowed', 405));
    try {
      if (!hasDashboardOrigin(request)) return respond(jsonError('Invalid request origin', 403));
    } catch {
      return respond(jsonError('Authentication temporarily unavailable', 503));
    }
    return respond(await next());
  }
  try {
    const session = await getDashboardSession(request);
    if (!session) {
      if (api) return respond(jsonError('Authentication required', 401));
      // Only benign dashboard navigation fields survive the login redirect.
      const params = dashboardNavigationParams(url.searchParams);
      const returnTo = `/dashboard${params.size ? `?${params}` : ''}`;
      const location = `/dashboard/login${params.size ? `?returnTo=${encodeURIComponent(returnTo)}` : ''}`;
      return respond(new Response(null, { status: 303, headers: { Location: location } }));
    }
    if (!read && !validDashboardCsrf(request, session)) return respond(jsonError('Invalid request origin or CSRF token', 403));
    if (request.headers.get('sec-fetch-site') === 'cross-site') return respond(jsonError('Invalid request origin', 403));
    locals.dashboardSession = session;
    authorizeDashboardRequest(request);
  } catch {
    return respond(jsonError('Authentication temporarily unavailable', 503));
  }
  return respond(await next());
});
