// This record is a display cache, never a credential. Only a fresh server
// response can select the session whose local messages may be displayed.
export const CHAT_HISTORY_KEY = 'akrasia_chat_session_history';
export const CHAT_ERASURE_KEY = 'akrasia_chat_erasure';
export const MAX_LOCAL_HISTORY = 50;

export interface VerifiedChatSession {
  sessionId: string;
  sessionExpiresAt: number;
  contextVersion: number;
}

export interface StoredChatMessage {
  id: number;
  role: 'user' | 'agent';
  text: string;
  excludeFromContext?: boolean;
  operationId?:string;
  operationComplete?:boolean;
}

export function parseChatSession(id: unknown, expiresAt: unknown, contextVersion: unknown = 0): VerifiedChatSession | null {
  const seconds = typeof expiresAt === 'string' && /^\d+$/.test(expiresAt) ? Number(expiresAt) : expiresAt;
  const version = typeof contextVersion === 'string' && /^\d+$/.test(contextVersion) ? Number(contextVersion) : contextVersion;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
    typeof seconds !== 'number' || !Number.isSafeInteger(seconds) || seconds * 1000 <= Date.now() ||
    typeof version !== 'number' || !Number.isSafeInteger(version) || version < 0 || version > 2147483646) return null;
  return { sessionId: id, sessionExpiresAt: seconds, contextVersion: version };
}

// A tombstone contains no transcript or credential. It invalidates stale tabs;
// the signed server session and database version remain the authority.
export function latestErasure(): VerifiedChatSession | null {
  try {
    const record = JSON.parse(localStorage.getItem(CHAT_ERASURE_KEY) || 'null');
    const valid = record?.version === 1 ? parseChatSession(record.sessionId, record.sessionExpiresAt, record.contextVersion) : null;
    if (!valid) localStorage.removeItem(CHAT_ERASURE_KEY);
    return valid;
  } catch { try { localStorage.removeItem(CHAT_ERASURE_KEY); } catch {} return null; }
}

export function recordErasure(session: VerifiedChatSession) {
  const existing = latestErasure();
  if (existing?.sessionId === session.sessionId && existing.sessionExpiresAt === session.sessionExpiresAt &&
    existing.contextVersion > session.contextVersion) return;
  try { localStorage.setItem(CHAT_ERASURE_KEY, JSON.stringify({ version: 1, ...session })); } catch {}
}

export function isErasedSession(session: VerifiedChatSession): boolean {
  const erased = latestErasure();
  return !!erased && erased.sessionId === session.sessionId && erased.contextVersion > session.contextVersion;
}

export function purgeLegacyVisitorState() {
  if (typeof window === 'undefined') return;
  try {
    for (const key of ['akrasia_visitor_id', 'akrasia_vid', 'akrasia_chat_history']) localStorage.removeItem(key);
  } catch {}
  // The former public UUID is not proof of ownership and is never sent again.
  if (/(?:^|;\s*)akrasia_vid=/.test(document.cookie)) {
    document.cookie = 'akrasia_vid=; Max-Age=0; Path=/; SameSite=Lax';
  }
}

export function clearSessionHistory() {
  if (typeof window === 'undefined') return;
  try { localStorage.removeItem(CHAT_HISTORY_KEY); } catch {}
}

export function loadSessionMessages(session: VerifiedChatSession): StoredChatMessage[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(CHAT_HISTORY_KEY);
    if (!stored) return null;
    const record: unknown = JSON.parse(stored);
    if (!record || typeof record !== 'object') { clearSessionHistory(); return null; }
    const cache = record as Record<string, unknown>;
    if (cache.version !== 2 || cache.sessionId !== session.sessionId || cache.sessionExpiresAt !== session.sessionExpiresAt ||
      cache.contextVersion !== session.contextVersion || isErasedSession(session) ||
      session.sessionExpiresAt * 1000 <= Date.now() || !Array.isArray(cache.messages)) {
      clearSessionHistory(); return null;
    }
    const messages = cache.messages.slice(-MAX_LOCAL_HISTORY).filter((message): message is StoredChatMessage =>
      message && Number.isSafeInteger(message.id) && message.id >= 0 &&
      (message.role === 'user' || message.role === 'agent') && typeof message.text === 'string' &&
      message.text.length <= 64 * 1024 &&
      (message.operationId===undefined || typeof message.operationId==='string'&&/^[a-f0-9-]{36}$/i.test(message.operationId)) &&
      (message.operationComplete===undefined || typeof message.operationComplete==='boolean') &&
      (message.excludeFromContext === undefined || typeof message.excludeFromContext === 'boolean')
    );
    return messages.length ? messages : null;
  } catch { clearSessionHistory(); return null; }
}

export function saveSessionMessages(session: VerifiedChatSession | null, messages: readonly StoredChatMessage[]) {
  if (typeof window === 'undefined' || !session || session.sessionExpiresAt * 1000 <= Date.now() || isErasedSession(session)) return;
  try {
    localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify({
      version: 2, ...session, messages: messages.slice(-MAX_LOCAL_HISTORY),
    }));
  } catch {}
}
