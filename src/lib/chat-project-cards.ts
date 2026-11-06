import { chatIntentMessage, parseChatIntent } from './chat-navigation';
import { isProjectSlug } from './public-catalogue-id';
import { localProjectImage, projectImagePath } from './public-media';
import { externalVideoEmbed } from './privacy-consent';

export type ChatProjectQuery = { intent: 'portfolio' | `project:${string}` };
export interface ChatProjectCard {
  id: string; slug: string; title: string; category: string; duration: string;
  description: string; image: string; videoUrl: string; demo: boolean;
}
export const CHAT_PROJECT_CARD_LIMIT = 1000;
export const CHAT_PROJECT_PAYLOAD_BYTES = 2 * 1024 * 1024;
export const CHAT_PROJECT_PAGE_SIZE = 6;
export interface ChatProjectBrowseOptions { search?: string; category?: string; page?: number; }
export interface ChatProjectBrowseResult {
  items: ChatProjectCard[]; total: number; pageCount: number; page: number; categories: string[];
}
const catalogueText = (value: string): string => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** A filtered page keeps the publication order and adapts when projects are withdrawn. */
export function browseChatProjects(projects: readonly ChatProjectCard[], options: ChatProjectBrowseOptions = {}, pageSize = CHAT_PROJECT_PAGE_SIZE): ChatProjectBrowseResult {
  const size = Number.isFinite(pageSize) && pageSize >= 1 ? Math.floor(pageSize) : CHAT_PROJECT_PAGE_SIZE;
  const search = catalogueText(options.search || '').split(/\s+/u).filter(Boolean);
  const category = catalogueText(options.category || '');
  const categories: string[] = [], seenCategories = new Set<string>();
  const filtered = projects.filter(project => {
    const label = project.category.trim(), key = catalogueText(label);
    if (key && !seenCategories.has(key)) { categories.push(label); seenCategories.add(key); }
    if (category && key !== category) return false;
    const text = catalogueText(`${project.title} ${project.category} ${project.description}`);
    return search.every(term => text.includes(term));
  });
  const total = filtered.length, pageCount = Math.max(1, Math.ceil(total / size));
  const requestedPage = Number.isFinite(options.page) ? Math.floor(options.page!) : 0;
  const page = Math.min(pageCount - 1, Math.max(0, requestedPage));
  return { items: filtered.slice(page * size, (page + 1) * size), total, pageCount, page, categories };
}
const projectId = (value: unknown): value is string => typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(value);
const unavailable = () => new Error('Published project cards unavailable');

/** User intent selects a public catalogue query; assistant prose has no role. */
export function parseChatProjectRequest(requestMessage: string): ChatProjectQuery | null {
  if (typeof requestMessage !== 'string' || requestMessage.length > 2000) return null;
  const text = requestMessage.trim();
  const direct = parseChatIntent(text);
  if (direct === 'portfolio' || direct?.startsWith('project:')) return { intent: direct as ChatProjectQuery['intent'] };
  if (['es', 'en'].some(language => text === chatIntentMessage('portfolio', language as 'es' | 'en'))) return { intent: 'portfolio' };
  const match = /^(?:Quiero información sobre el proyecto: |I want information about the project: )(.+)$/u.exec(text);
  return match && isProjectSlug(match[1]) ? { intent: `project:${match[1]}` } : null;
}

function field(row: Record<string, unknown>, key: string, maximum: number, required = false): string {
  const value = row[key];
  if ((value === undefined || value === null) && !required) return '';
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0') || required && !value.trim()) throw unavailable();
  return value;
}
export function localChatProjectVideo(value: string): string {
  return /^\/media\/[a-z0-9][a-z0-9_-]*\.(?:mp4|webm)$/u.test(value) ? value : '';
}
function safeVideo(value: string): string {
  if (!value || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return '';
  if (localChatProjectVideo(value)) return value;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; }
  catch { return ''; }
}
/** Consent controls provider requests; opening an inline player never starts playback. */
export function chatProjectVideoSource(value: string): { kind: 'local' | 'external' | 'link'; src: string; provider?: string } | null {
  const safe = safeVideo(value);
  if (!safe) return null;
  if (localChatProjectVideo(safe)) return { kind: 'local', src: safe };
  const embed = externalVideoEmbed(safe);
  if (!embed) return { kind: 'link', src: safe };
  const url = new URL(embed.src);
  url.searchParams.delete('autoplay');
  return { kind: 'external', src: url.href, provider: embed.provider };
}
export interface ChatProjectVideoSelection { id: string; videoUrl: string; }
/** The current public projection is the authority for an open video too. */
export function activeChatProjectVideo(projects: ChatProjectCard[], selection: ChatProjectVideoSelection | null): ChatProjectCard | null {
  if (!selection) return null;
  return projects.find(project => project.id === selection.id && project.videoUrl === selection.videoUrl && Boolean(chatProjectVideoSource(project.videoUrl))) || null;
}
function translatedBrief(row: Record<string, unknown>): string {
  if (row.case_study_en == null) return '';
  if (!row.case_study_en || typeof row.case_study_en !== 'object' || Array.isArray(row.case_study_en)) throw unavailable();
  return field(row.case_study_en as Record<string, unknown>, 'brief', 6000);
}
function summary(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  return compact.length > 180 ? compact.slice(0, 179) + '…' : compact;
}

/** Project publication is decided by /api/projects, never by browser fixtures. */
export function parseChatProjectPayload(payload: unknown, query: ChatProjectQuery, language: 'es' | 'en' = 'es'): ChatProjectCard[] {
  if (!parseChatProjectRequest(query.intent) || !Array.isArray(payload) || payload.length > 1000 ||
      query.intent !== 'portfolio' && payload.length > 1) throw unavailable();
  const ids = new Set<string>(), slugs = new Set<string>();
  const projects = payload.map(value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
    const row = value as Record<string, unknown>;
    if (!projectId(row.id) || !isProjectSlug(row.slug) || Object.hasOwn(row, 'is_published') && row.is_published !== true ||
        ids.has(row.id) || slugs.has(row.slug) || query.intent !== 'portfolio' && row.slug !== query.intent.slice(8)) throw unavailable();
    ids.add(row.id); slugs.add(row.slug);
    const title = field(row, 'title', 200, true).trim();
    const description = field(row, 'public_description', 6000);
    const image = localProjectImage(projectImagePath(field(row, 'thumbnail', 2048), undefined));
    return { id: row.id, slug: row.slug, title,
      category: field(row, 'category', 120) || field(row, 'type', 120), duration: field(row, 'duration', 80),
      description: summary(language === 'en' ? translatedBrief(row) || description : description),
      image, videoUrl: safeVideo(field(row, 'video_url', 2048)), demo: /^DEMO\b/iu.test(title) };
  });
  return projects.slice(0, CHAT_PROJECT_CARD_LIMIT);
}

export function projectInspirationMessage(project: ChatProjectCard, language: 'es' | 'en'): string {
  return language === 'en'
    ? `I would like something inspired by the project “${project.title}” (${project.slug}). Help me define the brief.`
    : `Quiero algo inspirado en el proyecto «${project.title}» (${project.slug}). Ayúdame a definir el encargo.`;
}

/** A withdrawal event removes cards immediately; a subsequent GET revalidates. */
export function projectCardsAfterRefresh(projects: ChatProjectCard[], detail: unknown): ChatProjectCard[] {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return [];
  const data = detail as Record<string, unknown>;
  if (data.unavailable === true || !Array.isArray(data.ids) || data.ids.length > 1000 || data.ids.some(id => !projectId(id))) return [];
  const ids = new Set(data.ids);
  return projects.filter(project => ids.has(project.id));
}

export async function loadChatProjectCards(query: ChatProjectQuery, language: 'es' | 'en', options: {
  signal?: AbortSignal; fetch?: typeof fetch;
} = {}): Promise<ChatProjectCard[]> {
  if (!parseChatProjectRequest(query.intent)) throw unavailable();
  options.signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(abort, 6000);
  const path = query.intent === 'portfolio' ? '/api/projects' : `/api/projects?${new URLSearchParams({ slug: query.intent.slice(8) })}`;
  try {
    const response = await (options.fetch || fetch)(path, { cache: 'no-store', credentials: 'same-origin',
      redirect: 'error', signal: controller.signal });
    if (!response.ok || response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' || !response.body ||
        Number(response.headers.get('content-length')) > CHAT_PROJECT_PAYLOAD_BYTES) {
      await response.body?.cancel(); throw unavailable();
    }
    controller.signal.throwIfAborted();
    const reader = response.body.getReader();
    const cancelReader = () => { void reader.cancel().catch(() => {}); };
    controller.signal.addEventListener('abort', cancelReader, { once: true });
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let bytes = 0, text = '';
    try {
      while (true) {
        const next = await reader.read(); controller.signal.throwIfAborted();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > CHAT_PROJECT_PAYLOAD_BYTES) { await reader.cancel(); throw unavailable(); }
        text += decoder.decode(next.value, { stream: true });
      }
      text += decoder.decode();
    } finally { controller.signal.removeEventListener('abort', cancelReader); reader.releaseLock(); }
    return parseChatProjectPayload(JSON.parse(text), query, language);
  } catch { throw unavailable(); }
  finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}
