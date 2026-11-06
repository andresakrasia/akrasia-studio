import { dashboardRows, DashboardStorageError, oneDashboardRow, requireDashboardId, sbQuery, sbRequest } from './dashboard';
import { extractContactData, hasWholePhrase, positiveClauses } from './extractContactData';

export const MAX_LEAD_CONTEXT_MESSAGES = 300;
export const MAX_LEAD_CONTEXT_CHARACTERS = 60000;
export const MAX_LEAD_CONTEXT_MESSAGE_CHARACTERS = 4000;
const MAX_BRIEF_CHARACTERS = 5000;

export interface LeadContextMessage {
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}
export interface LeadConversationContext {
  leadId: string;
  visitorId: string;
  conversationId: string | null;
  clientName: string;
  company: string;
  email: string;
  phone: string;
  projectTitle: string;
  brief: string;
  requestedTiming: string;
  messages: LeadContextMessage[];
  totalMessages: number;
  truncated: boolean;
  source: 'linked' | 'visitor_latest' | 'none';
}

const normalize = (value: string) => value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const field = (value: unknown, maximum = 150) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximum) : '';
const emailPattern = /(?<![A-Za-z0-9.!#$%&'*+/=?^_`{|}~-])[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;
const withoutEmails = (value: string) => value.includes('@') ? value.replace(emailPattern, '') : value;
function contactInput(content: string): string {
  if (content.length <= 700) return content;
  const declaration = content.search(/\b(?:me llamo|mi nombre es|my name is|nombre\s*:|name\s*:|empresa|marca|agencia|company|represento a|trabajo en)\b/iu);
  return content.slice(Math.max(0, declaration), Math.max(0, declaration) + 700);
}

function genuineName(value: unknown): string {
  const name = field(value, 150);
  if (!name || name.includes('@') || !/^[\p{L}][\p{L}'’.-]*(?:\s+[\p{L}][\p{L}'’.-]*){0,3}$/u.test(name)) return '';
  if (/^(?:hola|gracias|si|no|cliente|cliente interesado|sin nombre|unknown|anonimo|anonymous|lead|disenador|disenadora|fotografo|fotografa|empresario|empresaria)$/i.test(normalize(name))) return '';
  return name;
}

function personalIntroduction(value: string): string {
  const name = genuineName(value);
  if (!name) return '';
  const normalized = normalize(name);
  // "Soy" also introduces a profession, organisation or place of origin.
  // Only use clearly written personal names here; explicit name declarations
  // and answers to a name question retain their less restrictive extraction.
  if (/^(?:de|del|desde|un|una|el|la)\b/.test(normalized) ||
    /\b(?:director(?:a)?|creativ[oa]|editor(?:a)?|disenador(?:a)?|fotograf[oa]|productor(?:a)?|realizador(?:a)?|animador(?:a)?|artista|arquitect[oa]|ingenier[oa]|responsable|fundador(?:a)?|cofundador(?:a)?|empresari[oa]|autonom[oa]|freelance|freelancer|ceo|gerente|estudio|studio|empresa|agencia|productora|company|agency)\b/.test(normalized)) return '';
  const words = name.split(/\s+/);
  if (words.some((word, index) => !(index > 0 && /^(?:de|del|la|las|los|y)$/i.test(word)) &&
    (word[0] === word[0].toLocaleLowerCase() || word[0] !== word[0].toLocaleUpperCase()))) return '';
  return name;
}

// Contact extraction is based on the client's own words. An assistant's question
// can disambiguate a short reply, but its assertions never become client facts.
function contactName(content: string, previousAssistant: string): string {
  const extracted = genuineName(extractContactData(contactInput(content), previousAssistant).name);
  if (extracted) return extracted;
  const introduction = content.match(/(?:^|[.!?\n]\s*)(?:hola[,!\s]+)?soy\s+([^,;.!?\n]+)/iu)?.[1]?.split(/\s+(?:y|de|para|estoy|quiero|necesito)\s+/iu)[0];
  if (introduction && personalIntroduction(introduction)) return personalIntroduction(introduction);
  const bare = withoutEmails(content).replace(/(?:mi\s+)?(?:e-?mail|correo)(?:\s+es)?\s*:?/giu, '').replace(/[,;:]+/g, ' ').trim();
  if (content.includes('@') && content.match(emailPattern) && genuineName(bare) &&
    !/\b(?:este|es|mi|el|tu|un|una|puedes|contacto|escribir|enviar|aqui|para|presupuesto|quiero|necesito)\b/i.test(normalize(bare))) return genuineName(bare);
  return '';
}

export function redactConversationSecrets(value: string): string {
  const marker = /Synthetic administrator password|\b(?:password|contrase[nñ]a|api[_ -]?key|secret[_ -]?key)\s*[:=]|\bBearer\s+[A-Za-z0-9._-]{12,}/iu;
  return value.split(/(\r\n|\r|\n)/).map(line => marker.test(line) ? '[Dato sensible omitido]' : line).join('');
}

function timingFromPositiveClause(content: string, previousAssistant: string): string {
  const normalized = normalize(content);
  const duration = '(?:\\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|quince)\\s+(?:dias?|semanas?|meses?)';
  const explicit = new RegExp(`(?:antes (?:de|del)|fecha limite|deadline|para el\\s+(?:\\d|lunes|martes|miercoles|jueves|viernes|sabado|domingo)|(?:esta|la proxima|proxima|siguiente)\\s+(?:semana|mes)|(?:semana|mes)\\s+que viene|(?:en|dentro de)\\s+${duration})`, 'i');
  const isTimingReply = /(?:plazo|para cuando|cuando lo necesitas|fecha|deadline|when do you need)/i.test(normalize(previousAssistant)) && new RegExp(`^${duration}[.!\\s]*$`, 'i').test(normalized.trim());
  if (!explicit.test(normalized) && !isTimingReply) return '';
  const relativeDuration = content.match(new RegExp(`(?:en|dentro de)\\s+${duration}`, 'iu'))?.[0];
  if (relativeDuration) return relativeDuration.trim();
  if (isTimingReply) return content.trim().replace(/[.!]+$/, '');
  const relativeWeek = content.match(/(?:esta|(?:la\s+)?pr[oó]xima|siguiente)\s+(?:semana|mes)|(?:semana|mes)\s+que viene/iu)?.[0];
  if (relativeWeek) return relativeWeek.trim();
  return content.replace(/\s+/g, ' ').trim().slice(0, 350);
}

function requestedTimingFrom(content: string, previousAssistant: string): string | null {
  let result: string | null = '';
  const clauses = content.split(/[.!?;\n]|\b(?:pero|sino|but|however)\b/iu);
  for (const clause of clauses) {
    const normalized = normalize(clause);
    const timing = timingFromPositiveClause(clause, previousAssistant);
    const negativeRequest = /\b(?:no|nunca|tampoco)\s+(?:(?:lo|la|el)\s+)?(?:quiero|necesito|necesitamos|hace\s+falta|tiene\s+que\s+estar)\b/.test(normalized);
    const undefinedTiming = /\b(?:no\s+(?:hay|tengo|tenemos)\s+(?:un[oa]?\s+|la\s+|el\s+)?(?:fecha|plazo)|sin\s+(?:fecha|plazo))\b/.test(normalized);
    if (undefinedTiming || (timing && negativeRequest)) result = null;
    else if (timing && positiveClauses(clause).length) result = timing;
  }
  return result;
}

function projectTitleFrom(clientMessages: string[], leadType: unknown): string {
  const clauses = clientMessages.flatMap(positiveClauses);
  const has = (phrase: string) => clauses.some(clause => hasWholePhrase(clause, phrase));
  for (const content of [...clientMessages].reverse()) {
    const title = content.match(/(?:el\s+)?(?:proyecto|titulo)\s+(?:se llama|es|:)\s*[«"“]?([^\n;!?»"”]+)/iu)?.[1];
    if (title && title.length <= 150 && !title.includes('@')) return field(title);
  }
  const dimensionClause = [...clauses].reverse().find(clause => hasWholePhrase(clause, '3d') || hasWholePhrase(clause, '2d'));
  const dimension = dimensionClause && (hasWholePhrase(dimensionClause, '2d') ? '2D' : '3D');
  let title = dimension ? (has('animacion') ? `Animación ${dimension}` : `Pieza ${dimension}`)
    : has('animacion') ? 'Animación' : has('videoclip') || has('video musical') ? 'Videoclip'
    : has('documental') ? 'Documental' : has('video') || has('vídeo') ? 'Vídeo'
    : has('spot') || has('anuncio') || has('publicidad') ? 'Pieza publicitaria' : '';
  if (!title) {
    const storedType = field(leadType, 100);
    title = storedType && !storedType.includes('@') && !/^(?:proyecto|otro|other|general|unknown|sin definir)$/i.test(storedType) ? storedType : 'Propuesta de proyecto';
  }
  if (has('producto') || has('product')) title += ' de producto';
  const durations = clauses.flatMap(clause => [...clause.matchAll(/\b(\d{1,4})\s*(segundos?|secs?|s|minutos?|mins?)\b/g)]);
  const duration = durations.at(-1);
  if (duration && Number(duration[1]) > 0) title += ` · ${Number(duration[1])} ${duration[2].startsWith('min') ? 'min' : 's'}`;
  let platform = '';
  for (const clause of clauses) {
    const mentions = [...clause.matchAll(/(?:^|[^\p{L}\p{N}])(instagram|tiktok|youtube|redes sociales)(?=$|[^\p{L}\p{N}])/gu)];
    const latest = mentions.at(-1)?.[1];
    if (latest) platform = ({ instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', 'redes sociales': 'redes sociales' } as Record<string, string>)[latest];
  }
  if (platform) title += ` · ${platform}`;
  return title.slice(0, 150);
}

function conversationFacts(lead: Record<string, any>, messages: LeadContextMessage[]) {
  let name = genuineName(lead.name), company = field(lead.company), previousAssistant = '', requestedTiming = '';
  const clientMessages: string[] = [];
  for (const message of messages) {
    if (message.role === 'assistant') { previousAssistant = message.content; continue; }
    if (message.content.includes('[Dato sensible omitido]')) continue;
    const extracted = extractContactData(contactInput(message.content), previousAssistant);
    const candidate = contactName(message.content, previousAssistant);
    if (candidate) name = candidate;
    if (extracted.company) company = field(extracted.company);
    const timing = requestedTimingFrom(message.content, previousAssistant);
    if (timing !== '') requestedTiming = timing ?? '';
    const compact = message.content.replace(/\s+/g, ' ').trim();
    const withoutContact = withoutEmails(compact).replace(/[,;:]+/g, ' ').trim();
    const contactOnly = !!candidate && (!withoutContact || genuineName(withoutContact) === candidate);
    if (compact && !contactOnly && !/^(?:hola|gracias|si|no|vale|perfecto|ok|de acuerdo)[.!\s]*$/i.test(normalize(compact))) clientMessages.push(compact);
  }
  const excerpts: string[] = [];
  let remaining = MAX_BRIEF_CHARACTERS;
  for (const content of clientMessages) {
    const excerpt = content.slice(0, Math.min(900, remaining - 3));
    if (!excerpt) break;
    excerpts.push(`• ${excerpt}${excerpt.length < content.length ? '…' : ''}`);
    remaining -= excerpt.length + 4;
    if (remaining < 30) break;
  }
  return { clientName: name, company, projectTitle: projectTitleFrom(clientMessages, lead.project_type),
    brief: excerpts.join('\n').slice(0, MAX_BRIEF_CHARACTERS), requestedTiming };
}

async function messagePage(conversationId: string, offset: number, limit: number, signal?: AbortSignal) {
  const response = await sbRequest(`messages?select=id,conversation_id,role,content,created_at&conversation_id=eq.${conversationId}&order=created_at.asc,role.desc,id.asc&offset=${offset}&limit=${limit}`, 'GET', undefined, 'count=exact', signal);
  const rows = dashboardRows(response.data);
  const total = Number(response.headers.get('content-range')?.split('/')[1]);
  if (!Number.isSafeInteger(total) || total < 0 || rows.length > limit || (rows.length === 0 && offset < total) || rows.length > Math.max(0, total - offset)) throw new DashboardStorageError();
  for (const row of rows) {
    if (row.conversation_id !== conversationId || !['user', 'assistant'].includes(row.role) || typeof row.content !== 'string' ||
      !row.id || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) throw new DashboardStorageError();
  }
  return { rows, total };
}

export async function loadLeadConversationContext(leadId: string, signal?: AbortSignal): Promise<LeadConversationContext> {
  const id = requireDashboardId(leadId);
  const lead = oneDashboardRow(await sbQuery('leads', `select=id,visitor_id,conversation_id,name,company,email,phone,project_type&id=eq.${id}&limit=2`, signal), id);
  if (typeof lead.visitor_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(lead.visitor_id)) throw new DashboardStorageError();
  const visitorId = lead.visitor_id;
  let source: LeadConversationContext['source'] = 'none', conversationId: string | null = null;
  if (lead.conversation_id) {
    conversationId = requireDashboardId(lead.conversation_id);
    const conversation = oneDashboardRow(await sbQuery('conversations', `select=id,visitor_id&id=eq.${conversationId}&limit=2`, signal), conversationId);
    if (conversation.visitor_id !== visitorId) throw new DashboardStorageError(409, 'lead_conversation_mismatch');
    source = 'linked';
  } else {
    const rows = await sbQuery('conversations', `select=id,visitor_id&visitor_id=eq.${encodeURIComponent(visitorId)}&order=created_at.desc,id.desc&limit=1`, signal);
    if (rows.length > 1 || rows.some(row => row.visitor_id !== visitorId)) throw new DashboardStorageError();
    if (rows.length) { conversationId = requireDashboardId(rows[0].id); source = 'visitor_latest'; }
  }
  let totalMessages = 0;
  let retained: Record<string, any>[] = [];
  if (conversationId) {
    const first = await messagePage(conversationId, 0, 100, signal);
    totalMessages = first.total;
    retained = first.rows;
    // Preserve the original request and the latest clarifications when a very
    // long retained conversation needs to be shortened for the email context.
    const ranges = totalMessages > MAX_LEAD_CONTEXT_MESSAGES
      ? [{ offset: 100, limit: 50 }, { offset: totalMessages - 150, limit: 100 }, { offset: totalMessages - 50, limit: 50 }]
      : [{ offset: 100, limit: 100 }, { offset: 200, limit: 100 }];
    for (const range of ranges) {
      if (range.offset >= totalMessages) continue;
      const page = await messagePage(conversationId, range.offset, Math.min(range.limit, totalMessages - range.offset), signal);
      if (page.total !== totalMessages) throw new DashboardStorageError(409, 'conversation_changed');
      retained.push(...page.rows);
    }
    if (new Set(retained.map(row => row.id)).size !== retained.length) throw new DashboardStorageError();
  }
  const sourceMessages: LeadContextMessage[] = retained.map(row => ({ role: row.role, content: redactConversationSecrets(row.content).slice(0, MAX_LEAD_CONTEXT_MESSAGE_CHARACTERS), created_at: row.created_at }));
  const facts = conversationFacts(lead, sourceMessages);
  const perMessageMaximum = Math.min(MAX_LEAD_CONTEXT_MESSAGE_CHARACTERS, Math.floor(MAX_LEAD_CONTEXT_CHARACTERS / Math.max(1, sourceMessages.length)));
  let truncated = totalMessages > retained.length;
  const messages = sourceMessages.map((message, index) => {
    if (message.content.length > perMessageMaximum || retained[index].content.length > MAX_LEAD_CONTEXT_MESSAGE_CHARACTERS) truncated = true;
    return { ...message, content: message.content.slice(0, perMessageMaximum) };
  });
  return { leadId: id, visitorId, conversationId, ...facts, email: field(lead.email, 254), phone: field(lead.phone, 40),
    messages, totalMessages, truncated, source };
}
