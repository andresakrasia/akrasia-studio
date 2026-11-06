import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { loadChatProjectCards, parseChatProjectRequest, projectCardsAfterRefresh, projectInspirationMessage,
  activeChatProjectVideo, browseChatProjects, CHAT_PROJECT_PAGE_SIZE, chatProjectVideoSource, type ChatProjectCard, type ChatProjectVideoSelection } from '../lib/chat-project-cards';
import { chatIntentMessage } from '../lib/chat-navigation';
import { hasExternalMediaConsent, openPrivacySettings, PRIVACY_CHANGE_EVENT } from '../lib/privacy-consent';
import '../styles/chat-project-cards.css';

export interface ChatProjectCardsProps {
  requestMessage: string;
  language: 'es' | 'en';
  onSendMessage: (text: string) => void | Promise<void>;
  disabled?: boolean;
}

export function ChatProjectVideoPanel({ project, language, onClose, externalMediaAllowed = false }: {
  project: ChatProjectCard; language: 'es' | 'en'; onClose: () => void; externalMediaAllowed?: boolean;
}) {
  const english = language === 'en';
  const source = chatProjectVideoSource(project.videoUrl);
  const youtubePage = source?.provider === 'YouTube'
    ? `https://www.youtube.com/watch?v=${new URL(source.src).pathname.slice('/embed/'.length)}` : '';
  const panelRef = useRef<HTMLElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    let frame: number | undefined;
    const reveal = () => {
      if (!panel.contains(document.activeElement)) return;
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const area = panel.closest<HTMLElement>('.chat-layer');
        if (!area) return;
        const player = panel.getBoundingClientRect(), reading = area.getBoundingClientRect();
        if (player.top < reading.top + 2) area.scrollTop += player.top - reading.top - 2;
        else if (player.bottom > reading.bottom - 2) area.scrollTop += player.bottom - reading.bottom + 2;
      });
    };
    panel?.focus({ preventScroll: true });
    reveal();
    const resizing = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reveal);
    resizing?.observe(panel);
    window.addEventListener('resize', reveal);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      resizing?.disconnect();
      window.removeEventListener('resize', reveal);
    };
  }, []);
  return <section ref={panelRef} className="chat-project-video-panel" tabIndex={-1}
    aria-label={`${english ? 'Video player' : 'Reproductor de vídeo'}: ${project.title}`}
    onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <div className="chat-project-video-header">
      <div><h3>{project.title}</h3></div>
      <div className="chat-project-video-header-actions">
      {youtubePage && <a className="chat-project-video-provider-link" href={youtubePage} target="_blank" rel="noopener noreferrer"
        aria-label={english ? 'Watch on YouTube' : 'Ver en YouTube'}>
        YouTube <span aria-hidden="true">↗</span>
      </a>}
      <button type="button" className="chat-project-video-close" onClick={onClose} aria-label={english ? 'Close video' : 'Cerrar vídeo'}>
        <span aria-hidden="true">×</span><span className="sr-only">{english ? 'Back to projects' : 'Volver a proyectos'}</span>
      </button>
      </div>
    </div>
    <div className="chat-project-video-frame" data-video-provider={source?.provider}>
      {source?.kind === 'local' ? <video controls playsInline preload="metadata" poster={project.image || undefined}
        src={source.src} aria-label={project.title} onError={() => setFailed(true)} />
        : source?.kind === 'external' && externalMediaAllowed ? <iframe src={source.src} title={project.title}
          referrerPolicy={source.provider === 'YouTube' ? 'strict-origin-when-cross-origin' : 'no-referrer'} allow="encrypted-media; picture-in-picture" sandbox="allow-scripts allow-same-origin allow-presentation" allowFullScreen />
          : <div className="chat-project-video-placeholder">
            {source?.kind === 'external' ? <>
              <p>{english ? `This video uses ${source.provider}. Allow external videos to load it; the provider will receive connection data.`
                : `Este vídeo utiliza ${source.provider}. Permite los vídeos externos para cargarlo; el proveedor recibirá datos de conexión.`}</p>
              <button type="button" onClick={openPrivacySettings}>{english ? 'Configure external videos' : 'Configurar vídeos externos'}</button>
              <a href="/cookies">{english ? 'Cookie information (Spanish)' : 'Información de cookies'}</a>
            </> : source?.kind === 'link' ? <>
              <p>{english ? 'This provider does not support playback here.' : 'Este proveedor no permite la reproducción aquí.'}</p>
              <a href={source.src} target="_blank" rel="noopener noreferrer">{english ? 'Visit video provider' : 'Visitar el proveedor del vídeo'}</a>
            </> : <p>{english ? 'This video is unavailable.' : 'Este vídeo no está disponible.'}</p>}
          </div>}
    </div>
    {failed && <p className="chat-project-video-error" role="status">{english ? 'The video could not be loaded. You can return to the projects and try again.' : 'No se ha podido cargar el vídeo. Puedes volver a proyectos e intentarlo de nuevo.'}</p>}
    {(project.demo || !youtubePage) && <div className="chat-project-video-footer">
      <p>{project.demo ? (english ? 'Fictional preview · No real client work.' : 'Previsualización ficticia · No es un encargo real.')
        : [project.category, project.duration].filter(Boolean).join(' / ')}</p>
      {project.demo && project.duration && <span>{project.duration}</span>}
    </div>}
  </section>;
}

export function ChatProjectCardList({ projects, language, onSendMessage, disabled = false }: {
  projects: ChatProjectCard[]; language: 'es' | 'en'; onSendMessage: ChatProjectCardsProps['onSendMessage']; disabled?: boolean;
}) {
  const english = language === 'en';
  const [selection, setSelection] = useState<ChatProjectVideoSelection | null>(null);
  const [mediaAllowed, setMediaAllowed] = useState(false);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(0);
  const controlsId = useId();
  const catalogue = projects.length > 1;
  const browsing = useMemo(() => browseChatProjects(projects, { search, category, page }), [projects, search, category, page]);
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const catalogueRef = useRef<HTMLElement>(null);
  const video = activeChatProjectVideo(projects, selection);
  useEffect(() => { if (selection && !video) setSelection(null); }, [selection, video]);
  useEffect(() => { if (category && !browsing.categories.includes(category)) { setCategory(''); setPage(0); } }, [category, browsing.categories]);
  useEffect(() => {
    const update = () => setMediaAllowed(hasExternalMediaConsent());
    const visible = () => { if (document.visibilityState === 'visible') update(); };
    update();
    window.addEventListener(PRIVACY_CHANGE_EVENT, update);
    document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener(PRIVACY_CHANGE_EVENT, update); document.removeEventListener('visibilitychange', visible); };
  }, []);
  const closeVideo = () => {
    setSelection(null);
    requestAnimationFrame(() => {
      // The same card button is restored when the gallery returns.
      const selector = `[data-chat-project-id="${selection?.id}"]`;
      const root = catalogueRef.current;
      const button = openerRef.current?.isConnected && root?.contains(openerRef.current) ? openerRef.current : root?.querySelector<HTMLButtonElement>(selector);
      (button || root?.querySelector<HTMLInputElement>('input[type="search"]') || root?.querySelector<HTMLButtonElement>('.chat-project-cover'))?.focus();
    });
  };
  const openVideo = (project: ChatProjectCard, button: HTMLButtonElement) => {
    openerRef.current = button;
    setSelection({ id: project.id, videoUrl: project.videoUrl });
  };
  return <section ref={catalogueRef} className="chat-project-cards" data-project-layout={catalogue ? 'catalogue' : 'single'}
    data-player-open={Boolean(video)} aria-label={english ? 'Published audiovisual projects' : 'Proyectos audiovisuales publicados'}>
    {video && <ChatProjectVideoPanel key={`${video.id}:${video.videoUrl}`} project={video} language={language} onClose={closeVideo} externalMediaAllowed={mediaAllowed} />}
    <div className="chat-project-browser" hidden={Boolean(video)}>
    <header className="chat-project-browser-header">
      <div><p className="chat-project-cards-label">{english ? 'AUDIOVISUAL ARCHIVE' : 'ARCHIVO AUDIOVISUAL'}</p>
        <h3>{catalogue ? (english ? 'Explore the projects' : 'Explora los proyectos') : (english ? 'Discover this piece' : 'Descubre esta pieza')}</h3>
        <p className="chat-project-browser-hint">{english ? 'Watch a piece or use it as inspiration for your idea.' : 'Reproduce una pieza o úsala como inspiración para tu idea.'}</p>
      </div>
      <span className="chat-project-browser-count" aria-label={`${projects.length} ${english ? (projects.length === 1 ? 'project' : 'projects') : (projects.length === 1 ? 'proyecto' : 'proyectos')}`}>
        {String(projects.length).padStart(2, '0')}<small>{english ? (projects.length === 1 ? 'PIECE' : 'PIECES') : (projects.length === 1 ? 'PIEZA' : 'PIEZAS')}</small>
      </span>
    </header>
    {catalogue && <div className="chat-project-browser-controls">
      <div className="chat-project-search"><label className="sr-only" htmlFor={`${controlsId}-search`}>{english ? 'Search projects' : 'Buscar proyectos'}</label>
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="m12 12 5 5"/></svg>
        <input id={`${controlsId}-search`} type="search" value={search} placeholder={english ? 'Search projects…' : 'Buscar proyectos…'}
          onChange={event => { setSearch(event.target.value); setPage(0); }} />
      </div>
      <div className="chat-project-filter"><label className="sr-only" htmlFor={`${controlsId}-category`}>{english ? 'Project type' : 'Tipo de proyecto'}</label>
        <select id={`${controlsId}-category`} value={category} onChange={event => { setCategory(event.target.value); setPage(0); }}>
          <option value="">{english ? 'All types' : 'Todos los tipos'}</option>
          {browsing.categories.map(value => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>
    </div>}
    <ul className="chat-project-cards-grid" hidden={Boolean(video)}>
      {browsing.items.map((project, index) => {
        const cover = <>
          <span className="chat-project-cover-fallback" aria-hidden="true"><svg viewBox="0 0 160 90" fill="none"><path d="M0 75 40 25 80 65 125 10 160 50M0 40h160M80 0v90" stroke="currentColor" /></svg></span>
          {project.image && <img src={project.image} alt={project.title} loading="lazy" decoding="async" referrerPolicy="no-referrer"
            onError={event => { event.currentTarget.hidden = true; }} onLoad={event => { event.currentTarget.hidden = false; }} />}
          {project.videoUrl && <span className="chat-project-play" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor"><path d="m9 5 11 7-11 7V5Z" /></svg></span>}
          <span className="chat-project-cover-caption chat-project-meta"><span>{project.category || (english ? 'Visual concept' : 'Concepto visual')}</span>
            {project.duration && <span className="chat-project-duration">{project.duration}</span>}</span>
          {project.demo && <span className="chat-project-demo">DEMO</span>}
          <span className="chat-project-sequence" aria-hidden="true">{String(browsing.page * CHAT_PROJECT_PAGE_SIZE + index + 1).padStart(2, '0')}</span>
        </>;
        return <li key={project.id} className="chat-project-card">
          {project.videoUrl ? <button type="button" className="chat-project-cover" data-chat-project-id={project.id}
            onClick={event => openVideo(project, event.currentTarget)}
            aria-label={`${english ? 'Watch' : 'Ver'} ${project.title}`} disabled={disabled}>{cover}</button>
            : <div className="chat-project-cover">{cover}</div>}
          <div className="chat-project-card-body">
            <h3>{project.title}</h3>
            {project.description && <p className="chat-project-description">{project.description}</p>}
            {project.demo && <p className="chat-project-demo-note">{english ? 'Fictional concept · No client work.' : 'Concepto ficticio · Sin encargo real.'}</p>}
            <div className="chat-project-actions">
            <button type="button" className="chat-project-watch" disabled={disabled}
              aria-label={`${project.videoUrl ? (english ? 'Play' : 'Reproducir') : (english ? 'Discover' : 'Conocer')} ${project.title}`}
              onClick={event => project.videoUrl ? openVideo(project, event.currentTarget) : void onSendMessage(chatIntentMessage(`project:${project.slug}`, language))}>
              <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m5 3 8 5-8 5Z"/></svg>
              {project.videoUrl ? (english ? 'Watch' : 'Ver vídeo') : (english ? 'Details' : 'Detalles')}
            </button>
            <button type="button" className="chat-project-action" disabled={disabled}
              onClick={() => void onSendMessage(projectInspirationMessage(project, language))}>
              {english ? 'I want something like this' : 'Quiero algo así'} <span aria-hidden="true">↗</span>
            </button>
            </div>
          </div>
        </li>;
      })}
    </ul>
    {!browsing.items.length && <div className="chat-project-empty" role="status">
      <p>{english ? 'No projects match this search.' : 'No hay proyectos con esta búsqueda.'}</p>
      <button type="button" onClick={() => { setSearch(''); setCategory(''); setPage(0); }}>{english ? 'Show all projects' : 'Ver todos los proyectos'}</button>
    </div>}
    {catalogue && <footer className="chat-project-browser-footer">
      <p role="status">{browsing.total ? `${browsing.page * CHAT_PROJECT_PAGE_SIZE + 1}–${Math.min((browsing.page + 1) * CHAT_PROJECT_PAGE_SIZE, browsing.total)}` : '0'}
        {' '}{english ? 'of' : 'de'} {browsing.total} {english ? (browsing.total === 1 ? 'project' : 'projects') : (browsing.total === 1 ? 'proyecto' : 'proyectos')}</p>
      <nav aria-label={english ? 'Project pages' : 'Páginas de proyectos'}>
        <button type="button" aria-label={english ? 'Previous projects' : 'Proyectos anteriores'} disabled={browsing.page === 0}
          onClick={() => setPage(browsing.page - 1)}>←</button>
        <span>{browsing.page + 1} / {browsing.pageCount}</span>
        <button type="button" aria-label={english ? 'Next projects' : 'Siguientes proyectos'} disabled={browsing.page + 1 >= browsing.pageCount}
          onClick={() => setPage(browsing.page + 1)}>→</button>
      </nav>
    </footer>}
    </div>
  </section>;
}

export default function ChatProjectCards({ requestMessage, language, onSendMessage, disabled = false }: ChatProjectCardsProps) {
  const query = useMemo(() => parseChatProjectRequest(requestMessage), [requestMessage]);
  const [state, setState] = useState<{ key: string; status: 'loading' | 'ready' | 'unavailable'; projects: ChatProjectCard[] }>({ key: '', status: 'loading', projects: [] });
  useEffect(() => {
    if (!query) return;
    const key = `${query.intent}:${language}`;
    let active = true, pending: AbortController | undefined;
    setState({ key, status: 'loading', projects: [] });
    const refresh = async () => {
      if (document.visibilityState === 'hidden') return;
      pending?.abort(); const current = new AbortController(); pending = current;
      try {
        const projects = await loadChatProjectCards(query, language, { signal: current.signal });
        if (active && pending === current) setState({ key, status: 'ready', projects });
      } catch {
        if (active && pending === current && !current.signal.aborted) setState({ key, status: 'unavailable', projects: [] });
      }
    };
    const portfolioRefresh = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      setState(previous => ({ ...previous, projects: projectCardsAfterRefresh(previous.projects, detail) }));
      void refresh();
    };
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void refresh(); };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30000);
    document.addEventListener('portfolio-refresh', portfolioRefresh);
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('pageshow', restored);
    return () => { active = false; pending?.abort(); window.clearInterval(interval);
      document.removeEventListener('portfolio-refresh', portfolioRefresh); document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('pageshow', restored); };
  }, [query, language]);
  if (!query) return null;
  const english = language === 'en';
  const current = state.key === `${query.intent}:${language}` ? state : { status: 'loading', projects: [] };
  if (current.status === 'loading') return <p className="chat-project-cards-status" role="status">{english ? 'Loading published work…' : 'Consultando trabajos publicados…'}</p>;
  if (!current.projects.length) return <p className="chat-project-cards-status" role="status">{current.status === 'unavailable'
    ? (english ? 'Published projects are temporarily unavailable.' : 'Los proyectos publicados no están disponibles temporalmente.')
    : (english ? 'There are no projects available for this request.' : 'No hay proyectos publicados disponibles para esta consulta.')}</p>;
  return <ChatProjectCardList projects={current.projects} language={language} onSendMessage={onSendMessage} disabled={disabled} />;
}
