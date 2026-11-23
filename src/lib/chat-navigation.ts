import { isProjectSlug } from './public-catalogue-id';
import { pageLang, type PublicLang } from './public-ui';

export type ChatNavigationIntent = 'about' | 'start' | 'services' | 'manifesto' | 'portfolio' | 'contact' | `service:${string}` | `project:${string}`;
const SIMPLE_INTENTS = new Set(['about', 'start', 'services', 'manifesto', 'portfolio', 'contact']);

/** Public catalogue selectors only. They never identify private visitor data. */
export function parseChatIntent(value: unknown): ChatNavigationIntent | null {
  if (typeof value !== 'string') return null;
  if (SIMPLE_INTENTS.has(value)) return value as ChatNavigationIntent;
  const match = /^(service|project):(.+)$/.exec(value);
  return match && isProjectSlug(match[2]) ? value as ChatNavigationIntent : null;
}

export function chatIntentPath(intent: ChatNavigationIntent, lang: PublicLang = 'es'): string {
  if (!parseChatIntent(intent)) throw new TypeError('Invalid public chat intent');
  const params = new URLSearchParams({ chat: intent });
  if (lang === 'en') params.set('lang', 'en');
  return '/?' + params.toString();
}

export function chatIntentMessage(intent: ChatNavigationIntent, lang: PublicLang = 'es'): string {
  if (!parseChatIntent(intent)) throw new TypeError('Invalid public chat intent');
  const english = lang === 'en';
  if (intent.startsWith('service:')) return (english ? 'I want information about the service: ' : 'Quiero información sobre el servicio: ') + intent.slice(8);
  if (intent.startsWith('project:')) return (english ? 'I want information about the project: ' : 'Quiero información sobre el proyecto: ') + intent.slice(8);
  const messages: Record<string, [string, string]> = {
    about: ['Hola, quiero saber más sobre Akrasia Studio', 'Hi, I want to know more about Akrasia Studio'],
    start: ['Quiero iniciar un proyecto con vosotros', 'I want to start a project with you'],
    services: ['Quiero conocer vuestros servicios', 'I want to know about your services'],
    manifesto: ['Quiero conocer vuestro manifiesto, qué es lo que os define como estudio', 'I want to know your manifesto, what defines you as a studio'],
    portfolio: ['Quiero ver vuestros proyectos, qué tipo de trabajos hacéis', 'I want to see your projects, what kind of work do you do'],
    contact: ['Quiero contactar con vosotros', 'I want to contact you'],
  };
  return messages[intent][english ? 1 : 0];
}

/** Only local root links can trigger a predefined chat message. */
export function parseChatIntentUrl(href: string, origin: string, lang: PublicLang = 'es'): { intent: ChatNavigationIntent; message: string } | null {
  try {
    const base = new URL(origin);
    const url = new URL(href, base.origin);
    if (url.origin !== base.origin || url.username || url.password || url.pathname !== '/' || url.hash ||
      [...url.searchParams.keys()].some(key => !['chat', 'lang'].includes(key)) ||
      url.searchParams.getAll('chat').length !== 1 || url.searchParams.getAll('lang').length > 1 ||
      url.searchParams.has('lang') && !['es', 'en'].includes(url.searchParams.get('lang') || '')) return null;
    const intent = parseChatIntent(url.searchParams.get('chat'));
    return intent ? { intent, message: chatIntentMessage(intent, lang) } : null;
  } catch { return null; }
}

/** Retired commercial pages now open the conversation without reading a database. */
export function legacyChatRedirect(kind: 'services' | 'portfolio' | 'contact' | 'service' | 'project', url: URL, slug?: unknown): Response {
  if ((kind === 'service' || kind === 'project') && !isProjectSlug(slug)) {
    return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  const intent = kind === 'service' || kind === 'project' ? `${kind}:${slug}` as ChatNavigationIntent : kind;
  return new Response(null, { status: 302, headers: { Location: chatIntentPath(intent, pageLang(url)), 'Cache-Control': 'no-store' } });
}
