import { loadPublicServices, type PublicService } from './public-content';
import { getPublicProjects, isProjectSlug, type PublicProject } from './public-projects';
import { chatIntentPath } from './chat-navigation';

export type ChatLanguage = 'es' | 'en';
type StaticIntent = 'about' | 'start' | 'service' | 'manifesto' | 'services' | 'portfolio' | 'contact';
type Intent = { key: StaticIntent } | { key: 'service-detail' | 'project-detail'; slug: string };
const triggers: Array<{ messages: string[]; key: StaticIntent }> = [
  { messages: ['Hola, quiero saber más sobre Akrasia Studio', 'Hi, I want to know more about Akrasia Studio', 'I want to know more about Akrasia Studio'], key: 'about' },
  { messages: ['Quiero iniciar un proyecto con vosotros', 'I want to start a project with you'], key: 'start' },
  { messages: ['Quiero conocer vuestro manifiesto, qué es lo que os define como estudio', 'I want to know your manifesto, what defines you as a studio'], key: 'manifesto' },
  { messages: ['Quiero conocer vuestros servicios', 'I want to know about your services'], key: 'services' },
  { messages: ['Quiero ver vuestros proyectos, qué tipo de trabajos hacéis', 'I want to see your projects, what kind of work do you do'], key: 'portfolio' },
  { messages: ['Quiero contactar con vosotros', 'I want to contact you'], key: 'contact' },
];
const responses: Record<StaticIntent, Record<ChatLanguage, string>> = {
  about: {
    es: 'Somos Akrasia Studio, una productora audiovisual de Barcelona. Somos directores, creadores y productores que han convertido la IA en su ventaja definitiva. Trabajamos en producción audiovisual, marketing y estrategia, creación de contenido, dirección creativa, VFX/postproducción y diseño sonoro. Desde esta conversación puedes elegir un servicio, descubrir los trabajos publicados o desarrollar tu idea con nosotros. ¿Qué te gustaría crear?',
    en: 'We are Akrasia Studio, an audiovisual production studio in Barcelona. We are directors, creators and producers who have made AI their definitive advantage. Our work spans audiovisual production, marketing and strategy, content creation, creative direction, VFX/post-production and sound design. In this conversation you can choose a service, discover published work or develop your idea with us. What would you like to create?',
  },
  start: {
    es: 'Cuéntanos tu idea: qué pieza quieres crear, para quién y para cuándo. Si tienes un presupuesto aproximado, nos ayuda a orientar el alcance. Puedes seguir desarrollándola aquí y, si quieres que el equipo te contacte, dejar tu nombre y un email o teléfono. El equipo revisará alcance, disponibilidad y presupuesto antes de confirmar un encargo.',
    en: 'Tell us your idea: what you want to create, who it is for and when you need it. An approximate budget helps us understand the scope. You can develop it here and, if you want the team to contact you, leave your name and an email or phone number. The team will review scope, availability and price before confirming a commission.',
  },
  service: {
    es: 'Podemos hablar de ese servicio aquí. Elige su nombre en el panel para ver la información publicada, o cuéntame qué pieza necesitas, su uso y plazo. El equipo revisará el alcance antes de confirmar disponibilidad o presupuesto.',
    en: 'We can discuss that service here. Choose its name in the panel to see its published information, or tell me what you need to create, how it will be used and your deadline. The team will review the scope before confirming availability or price.',
  },
  manifesto: {
    es: 'No somos una agencia de prompts.\nSomos directores, creadores y productores\nque han convertido la IA en su ventaja definitiva.\nHacemos lo que antes no era posible.\n\nEl criterio creativo dirige cada decisión: idea, narrativa, imagen, montaje y sonido. La IA forma parte de nuestro proceso de producción. Puedes descubrir cómo trabajamos desde las fichas de servicios y los proyectos publicados en este mismo chat. ¿Qué quieres explorar?',
    en: 'We are not a prompt agency.\nWe are directors, creators and producers\nwho have made AI their definitive advantage.\nWe make what used to be impossible.\n\nCreative judgment guides every decision: concept, story, image, editing and sound. AI is part of our production process. Discover how we work through the service details and published projects in this chat. What would you like to explore?',
  },
  // Detection remains available without database or AI work. The admitted
  // handler replaces these two markers with the current public catalogue.
  services: { es: 'Consulto los servicios publicados para mostrártelos aquí.', en: 'I will show you the published services here.' },
  portfolio: { es: 'Consulto los proyectos publicados para mostrártelos aquí.', en: 'I will show you the published projects here.' },
  contact: {
    es: 'Podemos desarrollar tu idea aquí o hablarla contigo en una videollamada de 30 minutos. Pulsa «Reservar videollamada»: elige un horario disponible, deja tu email y revisa la propuesta antes de confirmarla. Si prefieres contacto directo, escribe a [info@akrasia.studio](mailto:info@akrasia.studio) o llama al **+34 637 26 40 41**. Puedes seguir explorando sin reservar ni dejar contacto.',
    en: 'We can develop your idea here or discuss it in a 30-minute video call. Press “Book a video call”: choose an available time, leave your email and review the proposal before confirming. For direct contact, write to [info@akrasia.studio](mailto:info@akrasia.studio) or call **+34 637 26 40 41**. You can keep exploring without booking or leaving contact details.',
  },
};

function intentFor(message: string): Intent | null {
  const trimmed = message.trim();
  const trigger = triggers.find(item => item.messages.includes(trimmed));
  if (trigger) return { key: trigger.key };
  const detail = /^(?:Quiero información sobre el (servicio|proyecto)|I want information about the (service|project)):\s*([\s\S]*)$/u.exec(trimmed);
  if (detail) return { key: detail[1] === 'servicio' || detail[2] === 'service' ? 'service-detail' : 'project-detail', slug: detail[3] };
  if (/^(?:Me interesa vuestro servicio de|Me interesa saber más sobre|I am interested in your|I'm interested in your|Tell me about your) [\p{L}\p{N} ,&'’\-]{2,120}$/u.test(trimmed)) return { key: 'service' };
  return null;
}

/** Detection is pure, synchronous and never trusts a free-form title for access. */
export function getPredefinedResponse(message: string, language: ChatLanguage = 'es'): string | null {
  const intent = intentFor(message);
  if (!intent) return null;
  return intent.key === 'service-detail' ? responses.services[language]
    : intent.key === 'project-detail' ? responses.portfolio[language] : responses[intent.key][language];
}

export interface PublicChatContentOptions {
  signal?: AbortSignal;
  maxBytes?: number;
  services?: typeof loadPublicServices;
  projects?: typeof getPublicProjects;
}
// Editorial fields are text; only this module creates navigation/media links.
const text = (value: string) => value.replace(/[\\`*_{}\[\]()#+.!<>|~-]/g, '\\$&');
const snippet = (value: string, maximum = 240) => {
  const normalized = value.trim().replace(/\s+/gu, ' ');
  return text(normalized.length > maximum ? normalized.slice(0, maximum) + '…' : normalized);
};
function chatPath(kind: 'service' | 'project', slug: string, language: ChatLanguage): string {
  return chatIntentPath(`${kind}:${slug}`, language);
}
function bounded(parts: string[], language: ChatLanguage, maximum: number): string {
  const notice = language === 'en'
    ? '\n\nSome published content does not fit in this message. Ask the team for the complete information at info@akrasia.studio.'
    : '\n\nParte del contenido publicado no cabe en este mensaje. Puedes pedir la información completa al equipo en info@akrasia.studio.';
  const whole = parts.filter(Boolean).join('\n\n');
  if (Buffer.byteLength(whole, 'utf8') <= maximum) return whole;
  const budget = Math.max(0, maximum - Buffer.byteLength(notice, 'utf8'));
  let result = '';
  for (const part of parts.filter(Boolean)) {
    const candidate = result ? result + '\n\n' + part : part;
    if (Buffer.byteLength(candidate, 'utf8') > budget) break;
    result = candidate;
  }
  // Never cut a link or UTF-8 sequence. Tiny configured budgets have a plain
  // bounded failure message instead of invalid Markdown or an oversized SSE.
  if (!result) {
    const fallback = language === 'en' ? 'Information is too long. Contact info@akrasia.studio.' : 'Información demasiado extensa. Contacta con info@akrasia.studio.';
    let output = '';
    for (const char of fallback) { if (Buffer.byteLength(output + char, 'utf8') > maximum) break; output += char; }
    return output;
  }
  return result + notice;
}
const footer = (language: ChatLanguage) => language === 'en'
  ? 'Tell me what you would like to create. Scope, availability and price require review by the team.'
  : 'Cuéntame qué te gustaría crear. El alcance, la disponibilidad y el presupuesto requieren revisión del equipo.';

function serviceParts(service: PublicService, language: ChatLanguage): string[] {
  const english = language === 'en';
  const choose = (original: string, translated: string) => english ? translated || original : original;
  const parts = [`## ${text(choose(service.title, service.title_en))}`];
  if (english && (!service.title_en || (!service.description_en && service.description) || (!service.tagline_en && service.tagline) || (!service.hero_description_en && service.hero_description) || (!service.features_en.length && service.features.length) || (!service.process_en.length && service.process.length))) parts.push('Some editorial content is currently available in Spanish. You can continue the conversation in English.');
  parts.push(text(choose(service.tagline, service.tagline_en)), text(choose(service.description, service.description_en)), text(choose(service.hero_description, service.hero_description_en)));
  const features = english && service.features_en.length ? service.features_en : service.features;
  const process = english && service.process_en.length ? service.process_en : service.process;
  if (features.length) parts.push(english ? '### What we can create' : '### Qué podemos crear');
  features.forEach(feature => parts.push(`**${text(feature.title)}**\n${text(feature.description)}`));
  if (process.length) parts.push(english ? '### How we work' : '### Cómo trabajamos');
  process.forEach((step, index) => parts.push(`**${index + 1}. ${text(step.title)}**\n${text(step.description)}`));
  parts.push(footer(language));
  return parts;
}
function projectParts(project: PublicProject, language: ChatLanguage): string[] {
  const english = language === 'en';
  const translated = project.case_study_en.brief || project.case_study_en.process || project.case_study_en.result || project.case_study_en.services.length;
  const study = english && translated ? project.case_study_en : project.case_study;
  const parts = [`## ${text(project.title)}`, text([project.type, project.category, project.duration, project.resolution, project.aspect].filter(Boolean).join(' · '))];
  if (english && (project.public_description || (!translated && (study.brief || study.process || study.result || study.services.length)))) parts.push('Some editorial content is currently available in Spanish. You can continue the conversation in English.');
  if (project.public_description) parts.push(text(project.public_description));
  if (study.brief) parts.push(`### ${english ? 'Brief' : 'Encargo'}\n${text(study.brief)}`);
  if (study.process) parts.push(`### ${english ? 'Process' : 'Proceso'}\n${text(study.process)}`);
  if (study.result) parts.push(`### ${english ? 'Result' : 'Resultado'}\n${text(study.result)}`);
  if (study.services.length) parts.push(`### ${english ? 'Services involved' : 'Servicios utilizados'}\n${study.services.map(service => '- ' + text(service)).join('\n')}`);
  if (project.video_url) {
    try {
      const media = new URL(project.video_url);
      if (media.protocol === 'https:' && !media.username && !media.password && !/[\s\u0000-\u001f\u007f\\]/u.test(project.video_url)) parts.push(`[${english ? 'Watch the piece' : 'Ver la pieza'}](${media.href.replace(/\(/g, '%28').replace(/\)/g, '%29')})`);
    } catch { /* Missing media never prevents reading the case. */ }
  }
  parts.push(footer(language));
  return parts;
}

/** Called only after signed-session, quota, lifecycle and operation admission. */
export async function resolvePredefinedResponse(message: string, language: ChatLanguage = 'es', options: PublicChatContentOptions = {}): Promise<string | null> {
  const intent = intentFor(message);
  if (!intent) return null;
  const maximum = Math.max(0, Math.min(options.maxBytes ?? 8000, 16000));
  const isService = intent.key === 'services' || intent.key === 'service-detail';
  const isProject = intent.key === 'portfolio' || intent.key === 'project-detail';
  if (!isService && !isProject) return bounded([responses[intent.key as StaticIntent][language]], language, maximum);
  const detail = intent.key === 'service-detail' || intent.key === 'project-detail';
  const notFound = language === 'en' ? 'That item is not available in the published catalogue. Choose another item in this chat or contact info@akrasia.studio.' : 'Ese contenido no está disponible en el catálogo publicado. Elige otro en este chat o escribe a info@akrasia.studio.';
  if (detail && !isProjectSlug(intent.slug)) return bounded([notFound], language, maximum);
  options.signal?.throwIfAborted();
  try {
    const query = { ...(detail ? { slug: intent.slug } : {}), signal: options.signal };
    if (isService) {
      const services = await (options.services || loadPublicServices)(query);
      options.signal?.throwIfAborted();
      if (detail) return bounded(services[0] && services[0].slug === intent.slug ? serviceParts(services[0], language) : [notFound], language, maximum);
      if (!services.length) return bounded([language === 'en' ? 'There are no services published in the catalogue yet. Tell us what you would like to create here, or contact info@akrasia.studio.' : 'Todavía no hay servicios publicados en el catálogo. Cuéntanos aquí qué te gustaría crear o escribe a info@akrasia.studio.'], language, maximum);
      const parts = [language === 'en' ? '## Our services\nChoose a service to see its details here in the chat.' : '## Nuestros servicios\nElige un servicio para ver su información aquí, en el chat.'];
      if (language === 'en' && services.slice(0, 8).some(service => !service.title_en || (!service.description_en && service.description))) parts.push('Some editorial content is currently available in Spanish. You can continue the conversation in English.');
      services.slice(0, 8).forEach(service => parts.push(`### ${text(language === 'en' ? service.title_en || service.title : service.title)}\n${snippet(language === 'en' ? service.description_en || service.description : service.description)}\n[${language === 'en' ? 'Explore this service' : 'Conocer este servicio'}](${chatPath('service', service.slug, language)})`));
      if (services.length > 8) parts.push(language === 'en' ? 'This message shows the first 8 published services. You can choose another published service in the panel.' : 'Este mensaje muestra los primeros 8 servicios publicados. Puedes elegir otro servicio publicado en el panel.');
      parts.push(footer(language));
      return bounded(parts, language, maximum);
    }
    const projects = await (options.projects || getPublicProjects)(query);
    options.signal?.throwIfAborted();
    if (detail) return bounded(projects[0] && projects[0].slug === intent.slug ? projectParts(projects[0], language) : [notFound], language, maximum);
    if (!projects.length) return bounded([language === 'en' ? 'There are no projects approved for publication yet. Tell us what kind of piece interests you here, or ask the team for available references at info@akrasia.studio.' : 'Todavía no hay proyectos aprobados para publicación. Cuéntanos aquí qué tipo de pieza te interesa o pide referencias disponibles al equipo en info@akrasia.studio.'], language, maximum);
    const parts = [language === 'en' ? '## Published projects\nChoose a project to discover its brief, process and result here in the chat.' : '## Proyectos publicados\nElige un proyecto para descubrir su encargo, proceso y resultado aquí, en el chat.'];
    if (language === 'en' && projects.slice(0, 8).some(project => !project.case_study_en.brief && project.public_description)) parts.push('Some editorial content is currently available in Spanish. You can continue the conversation in English.');
    projects.slice(0, 8).forEach(project => parts.push(`### ${text(project.title)}\n${snippet(language === 'en' ? project.case_study_en.brief || project.public_description : project.public_description)}\n[${language === 'en' ? 'Explore this project' : 'Conocer este proyecto'}](${chatPath('project', project.slug, language)})`));
    if (projects.length > 8) parts.push(language === 'en' ? 'This message shows the first 8 published projects. You can choose another published project in the panel.' : 'Este mensaje muestra los primeros 8 proyectos publicados. Puedes elegir otro proyecto publicado en el panel.');
    return bounded(parts, language, maximum);
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return bounded([language === 'en' ? 'Published information is temporarily unavailable. We can continue discussing your idea here, or you can contact the team at info@akrasia.studio.' : 'La información publicada no está disponible en este momento. Podemos seguir hablando de tu idea aquí o puedes contactar con el equipo en info@akrasia.studio.'], language, maximum);
  }
}
