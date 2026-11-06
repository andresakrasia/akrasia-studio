import { createHmac, timingSafeEqual } from 'node:crypto';
import { ChatFailure, chatSession, clearChatCookie, quotaKey, type ChatConfig } from './chat-security';
import type { RetentionConfig } from './privacy-retention';

export interface ChatState { contextVersion: number }
export interface ChatLifecycleStore {
  state(config: ChatConfig, visitorId: string, expiresAt: number, signal: AbortSignal): Promise<ChatState>;
  erase(config: ChatConfig, visitorId: string, expiresAt: number, contextVersion: number, signal: AbortSignal): Promise<ChatState>;
}
export function isContextVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2147483646;
}
export async function lifecycleRpc(config: ChatConfig, name: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  try {
    const deadline = AbortSignal.timeout(config.storeTimeoutMs);
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, { method: 'POST', cache: 'no-store', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
      headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(); }
    const value = await response.json();
    if (value && typeof value === 'object' && value.error === 'chat_context_changed') throw new ChatFailure('chat_context_changed', 409);
    if (value && typeof value === 'object' && value.error === 'chat_busy') {
      if (!Number.isSafeInteger(value.retry_after) || value.retry_after < 1 || value.retry_after > 3600) throw new ChatFailure('chat_unavailable', 503);
      throw new ChatFailure('chat_busy', 409, value.retry_after);
    }
    return value;
  } catch (error) { if (error instanceof ChatFailure) throw error; throw new ChatFailure('chat_unavailable', 503, 30); }
}
function checkedState(value: unknown): ChatState {
  if (!value || typeof value !== 'object' || !isContextVersion((value as ChatState).contextVersion)) throw new ChatFailure('chat_unavailable', 503);
  return { contextVersion: (value as ChatState).contextVersion };
}
const scopeBody = (visitorId: string, expiresAt: number) => ({ p_visitor_id: visitorId, p_expires_at: expiresAt });
export const chatLifecycleStore: ChatLifecycleStore = {
  async state(config, visitorId, expiresAt, signal) { return checkedState(await lifecycleRpc(config, 'chat_context_state', scopeBody(visitorId, expiresAt), signal)); },
  async erase(config, visitorId, expiresAt, contextVersion, signal) {
    return checkedState(await lifecycleRpc(config, 'chat_erase_context', { ...scopeBody(visitorId, expiresAt), p_context_version: contextVersion,
      p_session_key: quotaKey('session', visitorId) }, signal));
  },
};
export async function requireContextVersion(config: ChatConfig, visitorId: string, expiresAt: number, version: number,
  signal: AbortSignal, store: ChatLifecycleStore = chatLifecycleStore): Promise<void> {
  const state = await store.state(config, visitorId, expiresAt, signal);
  if (state.contextVersion !== version) throw new ChatFailure('chat_context_changed', 409);
}
export function chatCsrfToken(config: ChatConfig, session: { id: string; expiresAt: number }, version: number): string {
  return createHmac('sha256', Buffer.from(config.secret, 'hex')).update(`akrasia-chat-erase-v1:${session.id}:${session.expiresAt}:${version}`).digest('base64url');
}
function verifyCsrf(request: Request, config: ChatConfig, session: { id: string; expiresAt: number }, version: number): void {
  const supplied = request.headers.get('x-chat-csrf') || '';
  const expected = chatCsrfToken(config, session, version);
  if (!/^[A-Za-z0-9_-]{43}$/.test(supplied) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new ChatFailure('invalid_request', 403);
}
// Same-process cancellation complements (never replaces) the persistent version
// guards, which also protect concurrent requests on other serverless instances.
const active = new Map<string, Set<AbortController>>();
export function registerChatWork(visitorId: string, controller: AbortController): () => void {
  const controllers = active.get(visitorId) || new Set<AbortController>(); controllers.add(controller); active.set(visitorId, controllers);
  return () => { controllers.delete(controller); if (!controllers.size) active.delete(visitorId); };
}
export function cancelChatWork(visitorId: string): void {
  for (const controller of active.get(visitorId) || []) controller.abort(new ChatFailure('chat_context_changed', 409));
}
export function privateChatJson(data: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', 'CDN-Cache-Control': 'no-store',
    'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}
export function createChatEraseHandler(dependencies: { config: () => ChatConfig; store?: ChatLifecycleStore; now?: () => number }) {
  return async ({ request }: { request: Request }): Promise<Response> => {
    let config: ChatConfig | undefined;
    try {
      config = dependencies.config();
      if (request.method !== 'DELETE') throw new ChatFailure('invalid_request', 405);
      if (request.headers.get('origin') !== config.origin || request.headers.get('sec-fetch-site') === 'cross-site' || new URL(request.url).search) throw new ChatFailure('invalid_request', 403);
      const session = chatSession(request, config, (dependencies.now || Date.now)());
      if (session.cookie) throw new ChatFailure('invalid_chat_session', 401);
      if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json' || (request.headers.get('content-encoding') || 'identity') !== 'identity') throw new ChatFailure('invalid_request', 400);
      const declared = request.headers.get('content-length');
      if (declared && (!/^\d+$/.test(declared) || Number(declared) > 1024)) throw new ChatFailure('request_too_large', 413);
      const signal = AbortSignal.any([request.signal, AbortSignal.timeout(config.storeTimeoutMs)]);
      signal.throwIfAborted();
      const reader = request.body?.getReader();
      if (!reader) throw new ChatFailure('invalid_request', 400);
      let bytes = 0; const chunks: Uint8Array[] = [];
      const stop = () => { void reader.cancel().catch(() => {}); };
      signal.addEventListener('abort', stop, { once: true });
      try { while (true) { const next = await reader.read(); signal.throwIfAborted(); if (next.done) break; bytes += next.value.byteLength; if (bytes > 1024) { stop(); throw new ChatFailure('request_too_large', 413); } chunks.push(next.value); } }
      finally { signal.removeEventListener('abort', stop); reader.releaseLock(); }
      let body: unknown;
      try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); } catch { throw new ChatFailure('invalid_request', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 || !isContextVersion((body as ChatState).contextVersion)) throw new ChatFailure('invalid_request', 400);
      const version = (body as ChatState).contextVersion;
      verifyCsrf(request, config, session, version);
      const state = await (dependencies.store || chatLifecycleStore).erase(config, session.id, session.expiresAt, version, signal);
      if (state.contextVersion !== version + 1) throw new ChatFailure('chat_unavailable', 503);
      cancelChatWork(session.id);
      return privateChatJson({ deleted: true, ...state, csrfToken: chatCsrfToken(config, session, state.contextVersion), sessionId: session.id,
        sessionExpiresAt: session.expiresAt, scope: 'chat_and_derived_profile', retained: ['bookings', 'external_notifications', 'quota_security'] });
    } catch (error) {
      const failure = error instanceof ChatFailure ? error : new ChatFailure('chat_unavailable', 503);
      const response = privateChatJson({ error: failure.code, ...(failure.retryAfter ? { retry_after: failure.retryAfter } : {}) }, failure.status,
        config && failure.code === 'invalid_chat_session' ? clearChatCookie(config) : undefined);
      if (failure.retryAfter) response.headers.set('Retry-After', String(failure.retryAfter));
      return response;
    }
  };
}
type RetentionCountKey = 'messages' | 'conversations' | 'profiles' | 'notifications' | 'bookings' | 'states' | 'visitors' | 'quota_buckets' | 'leases' | 'outbox' | 'chat_operations' | 'dashboard_operations' | 'client_journey_operations';
export type RetentionBatchResult = Record<RetentionCountKey, number> & { deferred?: boolean };
export async function runRetention(config: ChatConfig, policy: RetentionConfig, signal: AbortSignal): Promise<RetentionBatchResult> {
  const value = await lifecycleRpc(config, 'production_retention_batch', { p_chat_days: policy.chatDays, p_profile_days: policy.profileDays,
    p_notification_days: policy.notificationDays, p_batch_size: policy.batchSize }, signal);
  const keys: RetentionCountKey[] = ['messages', 'conversations', 'profiles', 'notifications', 'bookings', 'states', 'visitors', 'quota_buckets', 'leases', 'outbox', 'chat_operations', 'dashboard_operations'];
  if (!value || typeof value !== 'object' || keys.some(key => !Number.isSafeInteger((value as Record<string, number>)[key]) || (value as Record<string, number>)[key] < 0 || (value as Record<string, number>)[key] > policy.batchSize)) throw new ChatFailure('chat_unavailable', 503);
  const deferred = (value as Record<string, unknown>).deferred;
  if (deferred !== undefined && typeof deferred !== 'boolean') throw new ChatFailure('chat_unavailable', 503);
  // The v20 counter is additive: an older maintenance response remains usable
  // while a rollout is in progress, but a supplied malformed counter fails closed.
  const suppliedJourneyOperations=(value as Record<string,unknown>).client_journey_operations;
  const journeyOperations=suppliedJourneyOperations===undefined?0:suppliedJourneyOperations;
  if (!Number.isSafeInteger(journeyOperations) || Number(journeyOperations)<0 || Number(journeyOperations)>policy.batchSize) throw new ChatFailure('chat_unavailable',503);
  return { ...Object.fromEntries(keys.map(key => [key, (value as Record<string, number>)[key]])), client_journey_operations:Number(journeyOperations), ...(deferred ? { deferred: true } : {}) } as RetentionBatchResult;
}
