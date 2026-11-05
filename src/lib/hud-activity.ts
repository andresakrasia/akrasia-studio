import { isProjectSlug } from './public-catalogue-id';
import { chatIntentMessage, chatIntentPath } from './chat-navigation';
import type { PublicActivityEntry } from './public-activity';
import type { PublicLang } from './public-ui';

export function activityDate(value: string, lang: PublicLang): string {
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'es-ES', {
    dateStyle: 'short', timeStyle: 'short', timeZone: 'Europe/Madrid',
  }).format(new Date(value));
}

/** Revalidate the limited API projection before displaying it as plain text. */
export function parseActivityPayload(value: unknown, limit: number): PublicActivityEntry[] {
  if (!Array.isArray(value) || value.length > limit) throw new TypeError('Invalid activity');
  const seen = new Set<string>();
  const field = (input: unknown, max: number, required = false): string => {
    if (typeof input !== 'string' || input.length > max || required && !input.trim()) throw new TypeError('Invalid activity');
    return input;
  };
  return value.map(input => {
    if (!input || typeof input !== 'object') throw new TypeError('Invalid activity');
    const row = input as Record<string, unknown>;
    const id = field(row.id, 128, true);
    if (seen.has(id)) throw new TypeError('Invalid activity');
    seen.add(id);
    const occurred_at = field(row.occurred_at, 64, true);
    if (!/^\d{4}-\d{2}-\d{2}T/.test(occurred_at) || !Number.isFinite(Date.parse(occurred_at))) throw new TypeError('Invalid activity');
    if (!['milestone', 'process', 'studio'].includes(String(row.event_type))) throw new TypeError('Invalid activity');
    let project: PublicActivityEntry['project'] = null;
    if (row.project !== null) {
      if (!row.project || typeof row.project !== 'object') throw new TypeError('Invalid activity');
      const item = row.project as Record<string, unknown>;
      if (!isProjectSlug(item.slug)) throw new TypeError('Invalid activity');
      project = { slug: item.slug, title: field(item.title, 256, true) };
    }
    return { id, title: field(row.title, 256, true), title_en: field(row.title_en, 256),
      text: field(row.text, 4096, true), text_en: field(row.text_en, 4096),
      event_type: row.event_type as PublicActivityEntry['event_type'], occurred_at, project };
  });
}

/** A visual pause never preserves a withdrawn or changed public entry. */
export function activityWhilePaused(previous: PublicActivityEntry[], current: PublicActivityEntry[], paused: boolean): PublicActivityEntry[] {
  if (!paused) return current;
  const approved = new Map(current.map(entry => [entry.id, JSON.stringify(entry)]));
  return previous.filter(entry => approved.get(entry.id) === JSON.stringify(entry));
}

export function renderActivityEntry(entry: PublicActivityEntry, lang: PublicLang, doc: Document = document): HTMLLIElement {
  const english = lang === 'en';
  const item = doc.createElement('li'); item.className = 'hud-activity-entry'; item.dataset.activityId = entry.id;
  const meta = doc.createElement('div'); meta.className = 'hud-activity-meta';
  const time = doc.createElement('time'); time.dateTime = entry.occurred_at; time.textContent = activityDate(entry.occurred_at, lang);
  const kind = doc.createElement('span');
  kind.textContent = entry.event_type === 'milestone' ? (english ? 'MILESTONE' : 'HITO') : entry.event_type === 'process' ? (english ? 'PROCESS' : 'PROCESO') : 'STUDIO';
  meta.append(time, kind);
  const title = doc.createElement('strong'); title.textContent = english && entry.title_en ? entry.title_en : entry.title;
  title.lang = english && !entry.title_en ? 'es' : lang;
  const text = doc.createElement('p'); text.textContent = english && entry.text_en ? entry.text_en : entry.text;
  text.lang = english && !entry.text_en ? 'es' : lang;
  item.append(meta, title, text);
  if (entry.project) {
    const intent = `project:${entry.project.slug}` as const;
    const link = doc.createElement('a'); link.href = chatIntentPath(intent, lang); link.lang = 'es';
    link.dataset.chatMessage = chatIntentMessage(intent, lang); link.textContent = entry.project.title + ' ↗';
    item.append(link);
  }
  return item;
}

export function initializeStudioActivity(): void {
  const sections = Array.from(document.querySelectorAll<HTMLElement>('[data-studio-activity]'));
  if (!sections.length || document.documentElement.dataset.activityInitialized) return;
  document.documentElement.dataset.activityInitialized = 'true';
  const lang: PublicLang = document.documentElement.lang === 'en' ? 'en' : 'es';
  const english = lang === 'en';
  const button = document.getElementById('activityPause') as HTMLButtonElement | null;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let userPaused = false;
  try { userPaused = sessionStorage.getItem('akrasia-hud-paused') === 'true'; } catch { /* Optional visual preference. */ }
  const paused = () => userPaused;
  const active = () => !paused() && !motion.matches && document.visibilityState === 'visible';
  let frame = 0;
  let lastFrame = 0;
  const controllers = sections.map(section => ({ section,
    channel: section.dataset.studioActivity === 'feed' ? 'feed' : 'logs',
    list: section.querySelector<HTMLUListElement>('.hud-activity-list'),
    scroll: section.querySelector<HTMLElement>('.hud-activity-scroll'),
    empty: section.querySelector<HTMLElement>('.hud-activity-empty'),
    shown: [] as PublicActivityEntry[], latest: [] as PublicActivityEntry[], pending: false, initialized: false,
    snapshot: '', hovering: false, waitingUntil: 0,
  }));
  function display(controller: typeof controllers[number], entries: PublicActivityEntry[], unavailable = false) {
    const snapshot = JSON.stringify(entries);
    if (controller.snapshot !== snapshot) {
      controller.shown = entries; controller.snapshot = snapshot;
      controller.list?.replaceChildren(...entries.map(entry => renderActivityEntry(entry, lang)));
      if (controller.scroll) controller.scroll.scrollTop = 0;
    }
    if (controller.empty) {
      controller.empty.hidden = entries.length > 0;
      controller.empty.textContent = unavailable
        ? (english ? 'Activity temporarily unavailable.' : 'Actividad no disponible en este momento.')
        : (english ? 'New approved updates will appear here.' : 'Aquí aparecerán los nuevos avances aprobados.');
    }
  }
  async function refresh(controller: typeof controllers[number]) {
    if (controller.pending || document.visibilityState === 'hidden') return;
    controller.pending = true;
    try {
      const response = await fetch(`/api/${controller.channel}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error('Unavailable');
      controller.latest = parseActivityPayload(await response.json(), controller.channel === 'feed' ? 20 : 15);
      display(controller, activityWhilePaused(controller.shown, controller.latest, controller.initialized && paused()));
      controller.initialized = true;
    } catch { controller.latest = []; controller.initialized = false; display(controller, [], true); }
    finally { controller.pending = false; }
  }
  function tick(now: number) {
    frame = 0;
    if (!active()) { lastFrame = 0; return; }
    const elapsed = lastFrame ? Math.min(now - lastFrame, 100) : 0;
    lastFrame = now;
    for (const controller of controllers) {
      const scroll = controller.scroll;
      if (!scroll || controller.hovering || scroll.contains(document.activeElement) || now < controller.waitingUntil) continue;
      const maximum = scroll.scrollHeight - scroll.clientHeight;
      if (maximum < 8) continue;
      if (scroll.scrollTop >= maximum - 1) {
        scroll.scrollTop = 0; controller.waitingUntil = now + 4000;
      } else scroll.scrollTop += elapsed * .009;
    }
    frame = requestAnimationFrame(tick);
  }
  function applyPause() {
    document.documentElement.dataset.hudPaused = String(!active());
    if (button) {
      button.setAttribute('aria-pressed', String(paused()));
      button.textContent = userPaused ? (english ? 'Resume activity' : 'Reanudar actividad') : (english ? 'Pause activity' : 'Pausar actividad');
    }
    if (active() && !frame) frame = requestAnimationFrame(tick);
    if (!active() && frame) { cancelAnimationFrame(frame); frame = 0; lastFrame = 0; }
  }
  button?.addEventListener('click', () => {
    userPaused = !userPaused;
    try { sessionStorage.setItem('akrasia-hud-paused', String(userPaused)); } catch { /* Visual preference can remain in memory. */ }
    applyPause();
    if (!paused()) controllers.forEach(controller => void refresh(controller));
  });
  motion.addEventListener('change', () => { applyPause(); controllers.forEach(controller => void refresh(controller)); });
  document.addEventListener('visibilitychange', () => {
    applyPause();
    if (document.visibilityState === 'visible') controllers.forEach(controller => void refresh(controller));
  });
  window.addEventListener('pageshow', event => { if (event.persisted) controllers.forEach(controller => void refresh(controller)); });
  for (const controller of controllers) {
    controller.scroll?.addEventListener('mouseenter', () => { controller.hovering = true; });
    controller.scroll?.addEventListener('mouseleave', () => { controller.hovering = false; controller.waitingUntil = performance.now() + 2500; });
    void refresh(controller);
  }
  const ambient = document.getElementById('hudAmbientText');
  const ambience = english ? ['CHAT // Explore the studio', 'CATALOGUE // Choose a service', 'PORTFOLIO // Discover the work', 'PROJECT // Tell us your idea']
    : ['CHAT // Explora el estudio', 'CATÁLOGO // Elige un servicio', 'PORTFOLIO // Descubre los trabajos', 'PROYECTO // Cuéntanos tu idea'];
  let ambientIndex = 0;
  setInterval(() => {
    if (active() && ambient) { ambientIndex = (ambientIndex + 1) % ambience.length; ambient.textContent = ambience[ambientIndex]; }
  }, 8000);
  // Publication is rechecked even while visuals are paused, so withdrawn entries disappear.
  setInterval(() => controllers.forEach(controller => void refresh(controller)), 30000);
  applyPause();
}
