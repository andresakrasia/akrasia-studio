import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

export class ChatFailure extends Error {
  constructor(public code: string, public status = 503, public retryAfter = 0) { super(code); }
}

export interface ChatConfig {
  production: boolean;
  secret: string;
  origin: string;
  supabaseUrl: string;
  serviceKey: string;
  apiKey: string;
  sessionSeconds: number;
  providerTimeoutMs: number;
  storeTimeoutMs: number;
  maxBodyBytes: number;
  maxMessages: number;
  maxMessageChars: number;
  maxHistoryBytes: number;
  maxInputUnits: number;
  maxOutputTokens: number;
  policy: Record<string, number>;
}

export function readChatConfig(env: Record<string, unknown>, production = false, requireProvider = true): ChatConfig {
  const unavailable = () => { throw new ChatFailure('chat_unavailable', 503, 30); };
  const integer = (key: string, fallback: number, max: number, min = 1): number => {
    const value = env[key];
    if (value === undefined || value === '') return fallback;
    if (typeof value !== 'string' || !/^\d+$/.test(value)) return unavailable();
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= min && number <= max ? number : unavailable();
  };
  const secret = String(env.CHAT_SESSION_SECRET || '');
  const serviceKey = String(env.SUPABASE_SERVICE_ROLE_KEY || '');
  const apiKey = String(env.OPENROUTER_API_KEY || '');
  if (!/^[a-f0-9]{64,128}$/i.test(secret) || !serviceKey || requireProvider && !apiKey) unavailable();
  let origin: URL;
  let database: URL;
  try {
    origin = new URL(String(env.CHAT_ORIGIN || ''));
    database = new URL(String(env.SUPABASE_URL || ''));
  } catch { return unavailable(); }
  const local = (url: URL) => !production && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  for (const url of [origin!, database!]) {
    if ((url.protocol !== 'https:' && !(local(url) && url.protocol === 'http:')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash) unavailable();
  }
  const policy = {
    session_requests: integer('CHAT_SESSION_REQUESTS', 20, 1000000),
    ip_requests: integer('CHAT_IP_REQUESTS', 20, 1000000),
    global_requests: integer('CHAT_GLOBAL_REQUESTS', 200, 10000000),
    global_units: integer('CHAT_GLOBAL_UNITS', 1000000, 1000000000000),
    window_seconds: integer('CHAT_WINDOW_SECONDS', 3600, 86400),
    global_window_seconds: integer('CHAT_GLOBAL_WINDOW_SECONDS', 86400, 604800),
    session_concurrency: integer('CHAT_SESSION_CONCURRENCY', 1, 100),
    ip_concurrency: integer('CHAT_IP_CONCURRENCY', 2, 1000),
    global_concurrency: integer('CHAT_GLOBAL_CONCURRENCY', 4, 10000),
    lease_seconds: integer('CHAT_LEASE_SECONDS', 60, 3600, 5),
  };
  const providerTimeoutMs = integer('CHAT_PROVIDER_TIMEOUT_MS', 25000, 60000, 100);
  const storeTimeoutMs = integer('CHAT_STORE_TIMEOUT_MS', 5000, 10000, 100);
  // Timer starts before admission; margin covers clock skew, cancellation and cleanup.
  if (policy.lease_seconds * 1000 < providerTimeoutMs + storeTimeoutMs + 10000) unavailable();
  return {
    production, secret, origin: origin!.origin, supabaseUrl: database!.origin, serviceKey, apiKey, policy,
    sessionSeconds: integer('CHAT_SESSION_SECONDS', 86400, 2592000, 60),
    providerTimeoutMs, storeTimeoutMs,
    maxBodyBytes: integer('CHAT_MAX_BODY_BYTES', 32768, 131072),
    maxMessages: integer('CHAT_MAX_MESSAGES', 20, 50),
    maxMessageChars: integer('CHAT_MAX_MESSAGE_CHARS', 2000, 8000),
    maxHistoryBytes: integer('CHAT_MAX_HISTORY_BYTES', 8192, 32768),
    maxInputUnits: integer('CHAT_MAX_INPUT_UNITS', 24000, 65536),
    maxOutputTokens: integer('CHAT_MAX_OUTPUT_TOKENS', 500, 1000),
  };
}

// Privacy/history maintenance must remain available if the AI key is revoked.
// Only storage/session settings and bounded history projection apply here.
export function readChatStorageConfig(env: Record<string, unknown>, production = false): ChatConfig {
  const keys = ['CHAT_SESSION_SECRET', 'CHAT_ORIGIN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
    'CHAT_SESSION_SECONDS', 'CHAT_STORE_TIMEOUT_MS', 'CHAT_MAX_MESSAGES', 'CHAT_MAX_MESSAGE_CHARS', 'CHAT_MAX_HISTORY_BYTES'];
  return readChatConfig(Object.fromEntries(keys.map(key => [key, env[key]])), production, false);
}

export function chatCookieName(config: ChatConfig): string {
  return config.production ? '__Host-akrasia_chat' : 'akrasia_chat';
}

function signature(config: ChatConfig, value: string): string {
  return createHmac('sha256', Buffer.from(config.secret, 'hex')).update(`akrasia-chat-v1:${value}`).digest('base64url');
}

export function chatSession(request: Request, config: ChatConfig, now = Date.now()): { id: string; expiresAt: number; cookie?: string } {
  const name = chatCookieName(config);
  const entries = (request.headers.get('cookie') || '').split(';').map(item => item.trim())
    .filter(item => item.startsWith(`${name}=`));
  if (!entries.length) {
    const id = randomUUID();
    const expiresAt = Math.floor(now / 1000) + config.sessionSeconds;
    const value = `${id}.${expiresAt}`;
    return { id, expiresAt, cookie: `${name}=${value}.${signature(config, value)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${config.sessionSeconds}${config.production ? '; Secure' : ''}` };
  }
  const token = entries[0].slice(name.length + 1);
  const match = /^([a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (entries.length !== 1 || !match) throw new ChatFailure('invalid_chat_session', 401);
  const [, id, expires, mac] = match;
  const expiry = Number(expires);
  const expected = signature(config, `${id}.${expires}`);
  if (expiry <= Math.floor(now / 1000) || expiry > Math.floor(now / 1000) + config.sessionSeconds ||
    !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) throw new ChatFailure('invalid_chat_session', 401);
  return { id, expiresAt: expiry };
}

export function clearChatCookie(config: ChatConfig): string {
  return `${chatCookieName(config)}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${config.production ? '; Secure' : ''}`;
}

function normalizedIp(value: string): string | null {
  if (!isIP(value) || value.includes('%')) return null;
  if (value.includes(':')) {
    // URL normalizes equivalent compressed IPv6 spellings. Group /64 to avoid address rotation.
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const [left, right = ''] = canonical.split('::');
    const lhs = left ? left.split(':') : [];
    const rhs = right ? right.split(':') : [];
    const groups = canonical.includes('::') ? [...lhs, ...Array(8 - lhs.length - rhs.length).fill('0'), ...rhs] : lhs;
    // Normalize IPv4-mapped IPv6 to the same IPv4 bucket.
    if (groups.slice(0, 5).every(group => parseInt(group, 16) === 0) && parseInt(groups[5], 16) === 65535) {
      const a = parseInt(groups[6], 16); const b = parseInt(groups[7], 16);
      return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;
    }
    return `${groups.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(':')}::/64`;
  }
  return value;
}

export function resolveChatIp(request: Request, config: ChatConfig, clientAddress?: string): string {
  // A header alone never establishes trust. Only the actual Vercel runtime may use
  // its platform-owned header; no XFF/Forwarded/client-supplied fallback in production.
  if (process.env.VERCEL === '1') return normalizedIp(request.headers.get('x-vercel-forwarded-for') || '') || 'unknown';
  if (!config.production) return normalizedIp(clientAddress || '') || 'unknown';
  return 'unknown';
}

export function quotaKey(kind: 'session' | 'ip', value: string): string {
  // Stable across cookie-secret rotation; no raw IPs/cookie tokens in the limit tables.
  return createHash('sha256').update(`akrasia-chat-v1:${kind}:${value}`).digest('hex');
}

export interface Admission { allowed: boolean; reason: 'rate' | 'busy' | null; retryAfter: number }
export interface ChatQuotaStore {
  admit(config: ChatConfig, sessionKey: string, ipKey: string, leaseId: string, units: number, signal: AbortSignal): Promise<Admission>;
  release(config: ChatConfig, leaseId: string): Promise<void>;
}

async function rpc(config: ChatConfig, name: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const deadline = AbortSignal.timeout(config.storeTimeoutMs);
  const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
      method: 'POST', headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: combined, redirect: 'error', cache: 'no-store',
    });
    if (!response.ok) throw new Error();
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } catch { throw new ChatFailure('chat_unavailable', 503, 30); }
}

export const chatQuotaStore: ChatQuotaStore = {
  async admit(config, sessionKey, ipKey, leaseId, units, signal) {
    const value = await rpc(config, 'chat_admit', { p_session_key: sessionKey, p_ip_key: ipKey, p_lease_id: leaseId, p_policy: config.policy, p_input_units: units }, signal);
    if (!value || typeof value !== 'object') throw new ChatFailure('chat_unavailable', 503, 30);
    const data = value as Record<string, unknown>;
    if (typeof data.allowed !== 'boolean' || !Number.isSafeInteger(data.retry_after) || (data.retry_after as number) < 0 ||
      (data.allowed ? data.reason !== null || data.retry_after !== 0 : !['rate', 'busy'].includes(String(data.reason)) || (data.retry_after as number) < 1)) {
      throw new ChatFailure('chat_unavailable', 503, 30);
    }
    return { allowed: data.allowed, reason: data.reason as Admission['reason'], retryAfter: data.retry_after as number };
  },
  async release(config, leaseId) { await rpc(config, 'chat_release', { p_lease_id: leaseId }); },
};
