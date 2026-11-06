import { ChatFailure } from './chat-security';

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

const enabled = !!(SUPABASE_URL && SUPABASE_KEY);

if (!enabled) {
  console.warn('[Supabase] Missing env vars — DB features disabled');
}

function headers() {
  return {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY!,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };
}

export async function sbFetch(table: string, options: RequestInit & { query?: string; strict?: boolean }) {
  options.signal?.throwIfAborted();
  if (!enabled) {
    if (options.strict) throw new ChatFailure('chat_unavailable', 503);
    return null;
  }
  const { query, strict, ...init } = options;
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const res = await fetch(url, { ...init, cache: 'no-store', redirect: 'error', headers: { ...headers(), ...(init.headers as Record<string, string>) } });
  options.signal?.throwIfAborted();
  if (!res.ok) {
    await res.body?.cancel();
    options.signal?.throwIfAborted();
    if (strict) throw new ChatFailure('chat_unavailable', 503);
    if (res.status === 409) return null;
    // Database error bodies can contain contact fields, queries and credentials.
    console.error(`[Supabase] ${init.method} ${table} error ${res.status}`);
    return null;
  }
  const text = await res.text();
  options.signal?.throwIfAborted();
  const value = text ? JSON.parse(text) : null;
  if (strict && (!Array.isArray(value) || (init.method !== 'GET' && value.length === 0))) throw new ChatFailure('chat_unavailable', 503);
  return value;
}

export function isVisitorUuid(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
}

function validOwner(visitorId: string) {
  if (!isVisitorUuid(visitorId)) throw new ChatFailure('invalid_reference', 403);
}

function verifiedMutation(rows: unknown, ownerKey: 'visitor_id' | 'conversation_id', owner: string): void {
  if (!Array.isArray(rows) || !rows.length || rows.some(row => !row || row[ownerKey] !== owner)) throw new ChatFailure('chat_unavailable', 503);
}

async function requireOwnedRecord(table: 'conversations' | 'leads', visitorId: string, id: string, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  validOwner(visitorId);
  if (!isVisitorUuid(id)) throw new ChatFailure('invalid_reference', 403);
  const rows = await sbFetch(table, { method: 'GET', strict: true, signal,
    query: `select=id,visitor_id&id=eq.${id}&visitor_id=eq.${visitorId}&limit=1` });
  if (!Array.isArray(rows)) throw new ChatFailure('chat_unavailable', 503);
  if (rows.length !== 1 || rows[0].id !== id || rows[0].visitor_id !== visitorId) throw new ChatFailure('invalid_reference', 403);
}

export const requireOwnedConversation = (visitorId: string, id: string, signal?: AbortSignal) => requireOwnedRecord('conversations', visitorId, id, signal);
export const requireOwnedLead = (visitorId: string, id: string, signal?: AbortSignal) => requireOwnedRecord('leads', visitorId, id, signal);

export async function upsertVisitor(visitorId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  validOwner(visitorId);
  if (!enabled) return;
  const rows = await sbFetch('visitors', {
    signal, strict: true,
    method: 'POST',
    body: JSON.stringify({ visitor_id: visitorId, last_seen: new Date().toISOString(), page_views: 1 }),
    query: 'on_conflict=visitor_id',
    headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
  });
  verifiedMutation(rows, 'visitor_id', visitorId);
}

export async function getOrCreateConversation(visitorId: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  validOwner(visitorId);
  if (!enabled) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = await sbFetch('conversations', {
    signal, strict: true,
    method: 'GET',
    query: `select=id,visitor_id&visitor_id=eq.${visitorId}&created_at=gte.${today.toISOString()}&order=created_at.desc&limit=1`,
  });
  if (!Array.isArray(existing)) throw new ChatFailure('chat_unavailable', 503);

  if (existing && existing.length > 0) {
    if (!isVisitorUuid(existing[0].id) || existing[0].visitor_id !== visitorId) throw new ChatFailure('invalid_reference', 403);
    const patched = await sbFetch('conversations', {
      signal, strict: true,
      method: 'PATCH',
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
      query: `id=eq.${existing[0].id}&visitor_id=eq.${visitorId}`,
    });
    verifiedMutation(patched, 'visitor_id', visitorId);
    return existing[0].id;
  }

  const created = await sbFetch('conversations', {
    signal, strict: true,
    method: 'POST',
    body: JSON.stringify({ visitor_id: visitorId }),
  });

  const row = created?.[0] ?? created;
  if (!row || !isVisitorUuid(row.id) || row.visitor_id !== visitorId) throw new ChatFailure('chat_unavailable', 503);
  return row.id as string;
}

export async function saveMessage(visitorId: string, conversationId: string, role: 'user' | 'assistant', content: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!enabled || !conversationId) return;
  await requireOwnedConversation(visitorId, conversationId, signal);
  const saved = await sbFetch('messages', {
    signal, strict: true,
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, role, content }),
  });
  verifiedMutation(saved, 'conversation_id', conversationId);
  const patched = await sbFetch('conversations', {
    signal, strict: true,
    method: 'PATCH',
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
    query: `id=eq.${conversationId}&visitor_id=eq.${visitorId}`,
  });
  verifiedMutation(patched, 'visitor_id', visitorId);
}

export interface LeadData {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  name?: string | null;
  project_type?: string | null;
}

export async function upsertLead(visitorId: string, conversationId: string | null, data: LeadData, signal?: AbortSignal) {
  signal?.throwIfAborted();
  validOwner(visitorId);
  if (!enabled) return false;

  const hasData = data.email || data.phone || data.company || data.name;
  if (!hasData && !data.project_type) return false;
  if (conversationId) await requireOwnedConversation(visitorId, conversationId, signal);

  const existing = await sbFetch('leads', {
    signal, strict: true,
    method: 'GET',
    query: `visitor_id=eq.${visitorId}&limit=1`,
  });
  if (!Array.isArray(existing)) throw new ChatFailure('chat_unavailable', 503);

  const payload: Record<string, unknown> = {
    visitor_id: visitorId,
    conversation_id: conversationId,
    updated_at: new Date().toISOString(),
  };
  if (data.email) payload.email = data.email;
  if (data.phone) payload.phone = data.phone;
  if (data.company) payload.company = data.company;
  if (data.name) payload.name = data.name;
  if (data.project_type) payload.project_type = data.project_type;

  if (existing && existing.length > 0) {
    if (!isVisitorUuid(existing[0].id) || existing[0].visitor_id !== visitorId) throw new ChatFailure('invalid_reference', 403);
    const merged = { ...payload };
    if (!data.email && existing[0].email) merged.email = existing[0].email;
    if (!data.phone && existing[0].phone) merged.phone = existing[0].phone;
    const patched = await sbFetch('leads', {
      signal, strict: true,
      method: 'PATCH',
      body: JSON.stringify(merged),
      query: `id=eq.${existing[0].id}&visitor_id=eq.${visitorId}`,
    });
    verifiedMutation(patched, 'visitor_id', visitorId);
    return true;
  }

  const hasContact = data.email || data.phone;
  if (!hasContact && data.project_type) {
    const rows = await sbFetch('leads', { method: 'POST', body: JSON.stringify(payload), signal, strict: true });
    verifiedMutation(rows, 'visitor_id', visitorId);
    return false;
  }

  const rows = await sbFetch('leads', { method: 'POST', body: JSON.stringify(payload), signal, strict: true });
  verifiedMutation(rows, 'visitor_id', visitorId);
  return true;
}

export async function updateLeadStatus(visitorId: string, status: string, extra?: { budget_mentioned?: string }, signal?: AbortSignal) {
  signal?.throwIfAborted();
  validOwner(visitorId);
  if (!enabled) return false;

  const existing = await sbFetch('leads', {
    signal, strict: true,
    method: 'GET',
    query: `visitor_id=eq.${visitorId}&limit=1`,
  });
  if (!Array.isArray(existing)) throw new ChatFailure('chat_unavailable', 503);

  if (!existing || existing.length === 0) return false;
  if (!isVisitorUuid(existing[0].id) || existing[0].visitor_id !== visitorId) throw new ChatFailure('invalid_reference', 403);

  const payload: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
  };
  if (extra?.budget_mentioned) payload.budget_mentioned = extra.budget_mentioned;

  const patched = await sbFetch('leads', {
    signal, strict: true,
    method: 'PATCH',
    body: JSON.stringify(payload),
    query: `id=eq.${existing[0].id}&visitor_id=eq.${visitorId}`,
  });
  verifiedMutation(patched, 'visitor_id', visitorId);
  return true;
}
