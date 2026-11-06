import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

export const DASHBOARD_SESSION_SECONDS = 8 * 60 * 60;
export const DASHBOARD_COOKIE = import.meta.env.PROD ? '__Host-akrasia_admin' : 'akrasia_admin';
// Colons avoid dotenv-expand interpreting the hash delimiters as variables.
const PASSWORD_FORMAT = /^scrypt:131072:8:1:([a-f0-9]{32}):([a-f0-9]{128})$/;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
const authorizedRequests = new WeakSet<Request>();

export interface DashboardSession {
  tokenHash: string;
  csrfToken: string;
  expiresAt: string;
}

export class DashboardAuthUnavailable extends Error {
  constructor() { super('Dashboard authentication unavailable'); }
}

function configuration() {
  const passwordHash = import.meta.env.DASHBOARD_PASSWORD_HASH;
  const originValue = import.meta.env.DASHBOARD_ORIGIN;
  const supabaseUrl = import.meta.env.SUPABASE_URL;
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!passwordHash || !PASSWORD_FORMAT.test(passwordHash) || !originValue || !supabaseUrl || !serviceKey) {
    throw new DashboardAuthUnavailable();
  }
  let origin: URL;
  try { origin = new URL(originValue); } catch { throw new DashboardAuthUnavailable(); }
  const local = !import.meta.env.PROD && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  if ((origin.protocol !== 'https:' && !(local && origin.protocol === 'http:')) ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new DashboardAuthUnavailable();
  }
  return { passwordHash, origin: origin.origin, supabaseUrl: supabaseUrl.replace(/\/$/, ''), serviceKey };
}

export function dashboardOrigin(): string { return configuration().origin; }

export function hasDashboardOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  return site !== 'cross-site' && request.headers.get('origin') === dashboardOrigin();
}

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }

function csrfToken(token: string): string {
  // This token authorizes no request without the separate HttpOnly session cookie.
  return createHmac('sha256', token).update('akrasia-dashboard-csrf-v1').digest('base64url');
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

async function authStore(path: string, init: RequestInit = {}): Promise<unknown> {
  const { supabaseUrl, serviceKey } = configuration();
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      signal: AbortSignal.timeout(5000),
      cache: 'no-store',
      redirect: 'error',
    });
    if (!response.ok) throw new DashboardAuthUnavailable();
    const body = await response.text();
    return body ? JSON.parse(body) : null;
  } catch {
    // Never log provider responses, cookies, passwords or service credentials.
    throw new DashboardAuthUnavailable();
  }
}

function readToken(request: Request): string | null {
  const entries = (request.headers.get('cookie') || '').split(';')
    .map(entry => entry.trim()).filter(entry => entry.startsWith(`${DASHBOARD_COOKIE}=`));
  // Duplicate cookies are ambiguous and can be injected by other paths in local development.
  if (entries.length !== 1) return null;
  const token = entries[0].slice(DASHBOARD_COOKIE.length + 1);
  return TOKEN_FORMAT.test(token) ? token : null;
}

export async function getDashboardSession(request: Request): Promise<DashboardSession | null> {
  const token = readToken(request);
  if (!token) return null;
  const { passwordHash } = configuration();
  const tokenHash = digest(token);
  const rows = await authStore(`dashboard_sessions?token_hash=eq.${tokenHash}&credential_version=eq.${digest(passwordHash)}&select=expires_at&limit=1`);
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.expires_at !== 'string') return null;
  const expiresAt = rows[0].expires_at;
  const expires = Date.parse(expiresAt);
  if (!Number.isFinite(expires) || expires <= Date.now()) return null;
  return { tokenHash, csrfToken: csrfToken(token), expiresAt };
}

export function validDashboardCsrf(request: Request, session: DashboardSession): boolean {
  const provided = request.headers.get('x-dashboard-csrf') || '';
  return TOKEN_FORMAT.test(provided) && hasDashboardOrigin(request) && equal(provided, session.csrfToken);
}

export function authorizeDashboardRequest(request: Request): void { authorizedRequests.add(request); }
export function isDashboardRequestAuthorized(request: Request): boolean { return authorizedRequests.has(request); }

export async function verifyDashboardPassword(password: string): Promise<boolean> {
  const { passwordHash } = configuration();
  if (password.length < 16 || password.length > 256) return false;
  const [, salt, hash] = PASSWORD_FORMAT.exec(passwordHash)!;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(salt, 'hex'), 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
  return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
}

export async function createDashboardSession(): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DASHBOARD_SESSION_SECONDS * 1000).toISOString();
  await authStore('dashboard_sessions', {
    method: 'POST',
    body: JSON.stringify({ token_hash: digest(token), credential_version: digest(configuration().passwordHash), expires_at: expiresAt }),
  });
  return { token, expiresAt };
}

export async function revokeDashboardSession(tokenHash: string): Promise<void> {
  await authStore(`dashboard_sessions?token_hash=eq.${tokenHash}`, { method: 'DELETE' });
}

export async function consumeDashboardLoginAttempt(clientAddress: string): Promise<{ allowed: boolean; retryAfter: number }> {
  // IP comes from Astro's adapter, never from a user-selected header here. The global
  // bucket still limits attacks if a proxy's address configuration is unreliable.
  const result = await authStore('rpc/dashboard_consume_login_attempt', {
    method: 'POST', body: JSON.stringify({ p_ip_key: digest(`akrasia-login:${clientAddress || 'unknown'}`) }),
  });
  if (!result || typeof result !== 'object' || !('allowed' in result) || !('retry_after' in result) ||
      typeof result.allowed !== 'boolean' || typeof result.retry_after !== 'number') throw new DashboardAuthUnavailable();
  return { allowed: result.allowed, retryAfter: Math.max(1, Math.ceil(result.retry_after)) };
}

export function dashboardSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store, private');
  headers.set('CDN-Cache-Control', 'no-store');
  headers.set('Vercel-CDN-Cache-Control', 'no-store');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
