import { ChatFailure, type ChatConfig } from './chat-security';
import { sbFetch, isVisitorUuid } from './supabase';
import { readRetentionConfig } from './privacy-retention';
export { isVisitorUuid, requireOwnedConversation, requireOwnedLead } from './supabase';

export interface VisitorMessage { role: 'user' | 'assistant'; content: string }
export interface VisitorContext { messages: VisitorMessage[]; visitorName: string | null; visitorCompany: string | null }
export interface VisitorDataInput { visitorId: string; config: ChatConfig; signal: AbortSignal }
export interface VisitorHistory {
  conversations: Array<{ id: string; created_at: string; messages: VisitorMessage[] }>;
  summary: string | null;
  visitorName: string | null;
  visitorCompany: string | null;
}

export function emptyVisitorHistory(): VisitorHistory {
  return { conversations: [], summary: null, visitorName: null, visitorCompany: null };
}

function boundedText(value: unknown, maxChars: number, maxBytes: number): string | null {
  if (typeof value !== 'string') return null;
  let text = value.slice(0, maxChars);
  while (text && Buffer.byteLength(text, 'utf8') > maxBytes) text = text.slice(0, -1);
  return text || null;
}

// Every read begins with a server-authenticated owner and an explicit projection.
// No email, phone, lead IDs, notes or complete records leave this boundary.
export async function loadVisitorData({ visitorId, config, signal }: VisitorDataInput): Promise<VisitorHistory> {
  if (!isVisitorUuid(visitorId)) throw new ChatFailure('invalid_reference', 403);
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(config.storeTimeoutMs)]);
  const retention = readRetentionConfig(import.meta.env);
  const chatCutoff = new Date(Date.now() - retention.chatDays * 86400000).toISOString();
  const profileCutoff = new Date(Date.now() - retention.profileDays * 86400000).toISOString();
  const conversations = await sbFetch('conversations', { method: 'GET', strict: true, signal: deadline,
    query: `select=id,visitor_id,created_at&visitor_id=eq.${visitorId}&order=created_at.desc,id.desc&limit=10` });
  if (!Array.isArray(conversations) || conversations.length > 10 || conversations.some(row => !isVisitorUuid(row?.id) || row.visitor_id !== visitorId)) {
    throw new ChatFailure('chat_unavailable', 503);
  }
  const leads = await sbFetch('leads', { method: 'GET', strict: true, signal: deadline,
    query: `select=visitor_id,name,company&visitor_id=eq.${visitorId}&source=eq.web&updated_at=gte.${profileCutoff}&order=updated_at.desc,id.desc&limit=1` });
  if (!Array.isArray(leads) || leads.length > 1 || leads.some(row => row?.visitor_id !== visitorId)) throw new ChatFailure('chat_unavailable', 503);
  const result = emptyVisitorHistory();
  result.visitorName = boundedText(leads[0]?.name, 160, 640);
  result.visitorCompany = boundedText(leads[0]?.company, 160, 640);
  if (!conversations.length) return result;
  const ownedIds = new Set<string>(conversations.map(row => row.id));
  // The IDs come solely from the scoped lookup above. A second ownership filter
  // on the FK join protects this read even if a conversation is reassigned.
  // A turn's two inserts share the transaction timestamp. Fetch its assistant
  // first so unshift below restores user then assistant, regardless of UUIDs.
  const rows = await sbFetch('messages', { method: 'GET', strict: true, signal: deadline,
    query: `select=conversation_id,role,content,created_at,conversations!inner(visitor_id)&conversations.visitor_id=eq.${visitorId}&conversation_id=in.(${[...ownedIds].join(',')})&created_at=gte.${chatCutoff}&order=created_at.desc,role.asc,id.desc&limit=${config.maxMessages}` });
  if (!Array.isArray(rows) || rows.length > config.maxMessages) throw new ChatFailure('chat_unavailable', 503);
  const byConversation = new Map<string, VisitorMessage[]>();
  let budget = config.maxHistoryBytes;
  for (const row of rows) {
    if (!ownedIds.has(row?.conversation_id) || !row.conversations || row.conversations.visitor_id !== visitorId) throw new ChatFailure('chat_unavailable', 503);
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    const content = boundedText(row.content, config.maxMessageChars, budget);
    if (!content) continue;
    budget -= Buffer.byteLength(content, 'utf8');
    const list = byConversation.get(row.conversation_id) || [];
    list.unshift({ role: row.role, content });
    byConversation.set(row.conversation_id, list);
  }
  result.conversations = conversations.map(row => ({ id: row.id,
    created_at: typeof row.created_at === 'string' ? row.created_at : '', messages: byConversation.get(row.id) || [] }));
  const topics = result.conversations.map(conversation => conversation.messages.find(message => message.role === 'user')?.content.slice(0, 100)).filter(Boolean);
  result.summary = topics.length ? topics.slice(0, 5).map((topic, index) => `Conversación ${index + 1}: ${topic}`).join('\n') : null;
  deadline.throwIfAborted();
  return result;
}

export async function loadVisitorContext(input: VisitorDataInput): Promise<VisitorContext> {
  const data = await loadVisitorData(input);
  return { messages: [...data.conversations].reverse().flatMap(conversation => conversation.messages),
    visitorName: data.visitorName, visitorCompany: data.visitorCompany };
}
