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

async function sbFetch(table: string, options: RequestInit & { query?: string }) {
  if (!enabled) return null;
  const { query, ...init } = options;
  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const res = await fetch(url, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string>) } });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 409) return null;
    console.error(`[Supabase] ${init.method} ${table} error ${res.status}:`, body);
    return null;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export async function upsertVisitor(visitorId: string) {
  if (!enabled) return;
  await sbFetch('visitors', {
    method: 'POST',
    body: JSON.stringify({ visitor_id: visitorId, last_seen: new Date().toISOString(), page_views: 1 }),
    query: 'on_conflict=visitor_id',
    headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
  });
}

export async function getOrCreateConversation(visitorId: string) {
  if (!enabled) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = await sbFetch('conversations', {
    method: 'GET',
    query: `visitor_id=eq.${visitorId}&created_at=gte.${today.toISOString()}&order=created_at.desc&limit=1`,
  });

  if (existing && existing.length > 0) {
    await sbFetch('conversations', {
      method: 'PATCH',
      body: JSON.stringify({ updated_at: new Date().toISOString() }),
      query: `id=eq.${existing[0].id}`,
    });
    return existing[0].id;
  }

  const created = await sbFetch('conversations', {
    method: 'POST',
    body: JSON.stringify({ visitor_id: visitorId }),
  });

  return created?.[0]?.id ?? created?.id ?? null;
}

export async function saveMessage(conversationId: string, role: 'user' | 'assistant', content: string) {
  if (!enabled || !conversationId) return;
  await sbFetch('messages', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId, role, content }),
  });
  await sbFetch('conversations', {
    method: 'PATCH',
    body: JSON.stringify({ updated_at: new Date().toISOString() }),
    query: `id=eq.${conversationId}`,
  });
}

export interface LeadData {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  name?: string | null;
  project_type?: string | null;
}

export async function upsertLead(visitorId: string, conversationId: string | null, data: LeadData) {
  if (!enabled) return false;

  const hasData = data.email || data.phone || data.company || data.name;
  if (!hasData && !data.project_type) return false;

  const existing = await sbFetch('leads', {
    method: 'GET',
    query: `visitor_id=eq.${visitorId}&limit=1`,
  });

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
    const merged = { ...payload };
    if (!data.email && existing[0].email) merged.email = existing[0].email;
    if (!data.phone && existing[0].phone) merged.phone = existing[0].phone;
    await sbFetch('leads', {
      method: 'PATCH',
      body: JSON.stringify(merged),
      query: `id=eq.${existing[0].id}`,
    });
    return true;
  }

  const hasContact = data.email || data.phone;
  if (!hasContact && data.project_type) {
    await sbFetch('leads', { method: 'POST', body: JSON.stringify(payload) });
    return false;
  }

  await sbFetch('leads', { method: 'POST', body: JSON.stringify(payload) });
  return true;
}
