import { ChatProvider, useChat } from '../hooks/ChatContext';
import { useState, useRef, useCallback, useEffect, useId } from 'react';
import { createPortal } from 'react-dom';
import FormattedText from './FormattedText';
import ChatProjectCards from './ChatProjectCards';
import ShowreelBackdrop from './ShowreelBackdrop';
import StudioCore from './StudioCore';
import MeetingGuide from './MeetingGuide';
import { formatCivilDateES } from '../lib/civil-time';
import { parseChatProjectRequest } from '../lib/chat-project-cards';
import { chatIntentMessage, parseChatIntent } from '../lib/chat-navigation';
import { getLang, t } from '../lib/i18n';

function useLang() {
  const [lang, setLang] = useState(getLang());
  useEffect(() => {
    const handler = () => setLang(getLang());
    const observer = new MutationObserver(handler);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    window.addEventListener('lang-change', handler);
    handler();
    return () => { observer.disconnect(); window.removeEventListener('lang-change', handler); };
  }, []);
  return lang;
}

export function ChatPrivacyControl() {
  const { clearHistory, isDeleting, deletionStatus } = useChat();
  const english = useLang() === 'en';
  const [confirming, setConfirming] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const confirm = useRef<HTMLButtonElement>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useEffect(() => { if (confirming) confirm.current?.focus(); }, [confirming]);
  const cancel = () => { setConfirming(false); (disclosure.current?.open ? opener.current : summary.current)?.focus(); };
  return <aside aria-label={english ? 'Chat privacy' : 'Privacidad del chat'} className="chat-privacy-control">
    <details ref={disclosure} className="chat-privacy-panel" onToggle={event => {
      if (!event.currentTarget.open && confirming) { setConfirming(false); summary.current?.focus(); }
    }}>
      <summary ref={summary}>{english ? 'Privacy and data' : 'Privacidad y datos'}</summary>
      <div className="chat-privacy-details">
    <p>{english ? 'AI chat: your messages and derived contact details are stored for responding and following up. Messages are processed through OpenRouter and stored in Supabase. Avoid sensitive data.' : 'Chat con IA: guardamos los mensajes y el contacto derivado para responder y dar seguimiento. Los mensajes se procesan mediante OpenRouter y se guardan en Supabase. Evita datos sensibles.'}</p>
    <p className="mt-2"><a className="underline text-primary" href="/privacidad#chat">{english ? 'Storage periods, providers and rights' : 'Conservación, proveedores y derechos'}</a>{' · '}<a className="underline text-primary" href="mailto:info@akrasia.studio">info@akrasia.studio</a></p>
    <button ref={opener} type="button" disabled={isDeleting} aria-expanded={confirming} onClick={() => setConfirming(true)} className="chat-action">
      {english ? 'Delete conversation and profile' : 'Borrar conversación y perfil'}
    </button>
    {confirming && <div role="group" aria-label={english ? 'Confirm chat deletion' : 'Confirmar borrado del chat'} className="mt-3 space-y-2" onKeyDown={event => { if (event.key === 'Escape' && !isDeleting) { event.preventDefault(); cancel(); } }}>
      <p>{english ? 'This deletes this session’s conversations, derived contact profile and pending proposals on the server, then clears this browser. It keeps bookings and necessary quota/security records. It does not cancel bookings or delete notifications, provider copies or backups.' : 'Se borrarán las conversaciones, el perfil de contacto derivado y las propuestas pendientes de esta sesión en el servidor; después, el historial de este navegador. Se conservan reservas y registros necesarios de cuotas y seguridad. No cancela reservas ni borra avisos, copias en proveedores o copias de seguridad.'}</p>
      <p>{english ? 'For booking cancellation or other data, contact the rights address above.' : 'Para cancelar una reserva o solicitar otros datos, escribe al canal de derechos indicado arriba.'}</p>
      <button ref={confirm} type="button" disabled={isDeleting} onClick={() => void clearHistory().then(cancel)} className="chat-action">
        {isDeleting ? (english ? 'Deleting…' : 'Borrando…') : (english ? 'Confirm deletion' : 'Confirmar borrado')}
      </button>{' '}
      <button type="button" disabled={isDeleting} onClick={cancel} className="chat-action">{english ? 'Keep conversation' : 'Conservar conversación'}</button>
    </div>}
      </div>
    </details>
    <p role="status" aria-live="polite" className="chat-privacy-status">{deletionStatus}</p>
  </aside>;
}

export function BookingResult() {
  const { bookingAction, confirmBooking, dismissBooking, isTyping, isDeleting } = useChat();
  const lang = useLang();
  const english = lang === 'en';
  const [calendarError, setCalendarError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    setCalendarError('');
    if (bookingAction?.status !== 'confirmation_required') return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [bookingAction]);
  if (!bookingAction) return null;
  // The completed server reply already explains this outcome, and the guide
  // reopens with current availability. Avoid a second identical error card.
  if (bookingAction.status === 'unavailable') return null;
  const pending = bookingAction.status === 'confirmation_required';
  const details = pending ? bookingAction.proposal : bookingAction.booking;
  return <div role="status" className="chat-booking-card space-y-2">
    <strong>{pending ? (english ? 'Last step: confirm your booking' : 'Último paso: confirma tu reserva') : (english ? 'Booking confirmed' : 'Reserva confirmada')}</strong>
    <p>{english ? details.date : formatCivilDateES(details.date)} · {details.time} · Europe/Madrid · 30 min</p>
    {bookingAction.status === 'confirmation_required' ? <>
      <p>{bookingAction.proposal.name} · {bookingAction.proposal.email}</p>
      <p>{english ? 'Your time is reserved after you press “Confirm booking”. Check these details before confirming.' : 'Tu cita queda reservada al pulsar «Confirmar reserva». Revisa estos datos antes de confirmar.'}</p>
      {bookingAction.proposal.expiresAt * 1000 <= clock && <p>{english ? 'This proposal has expired. Choose a time again.' : 'La propuesta ha caducado. Elige un horario de nuevo.'}</p>}
      <button onClick={() => void confirmBooking()} disabled={isTyping || isDeleting || bookingAction.proposal.expiresAt * 1000 <= clock} className="chat-action">
        {english ? 'Confirm booking' : 'Confirmar reserva'}
      </button>
      <button onClick={dismissBooking} disabled={isTyping || isDeleting} className="chat-action">
        {english ? 'Cancel proposal' : 'Cancelar propuesta'}
      </button>
    </> : <>
      <button type="button" disabled={downloading || isDeleting} className="chat-action" onClick={() => {
        setDownloading(true); setCalendarError('');
        void (async () => {
          try {
            const response = await fetch(`/api/bookings/calendar?id=${bookingAction.booking.id}`, { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
            if (!response.ok || !response.headers.get('content-type')?.startsWith('text/calendar')) throw new Error();
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a'); link.href = url; link.download = 'akrasia-videollamada.ics'; document.body.append(link); link.click(); link.remove();
            window.setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch { setCalendarError(english ? 'We could not download the invitation. Contact the studio if your session has expired.' : 'No se ha podido descargar la invitación. Contacta con el estudio si tu sesión ha caducado.'); }
          finally { setDownloading(false); }
        })();
      }}>{downloading ? (english ? 'Downloading...' : 'Descargando...') : (english ? 'Add to my calendar' : 'Añadir a mi calendario')}</button>
      {calendarError && <p role="alert">{calendarError}</p>}
      {bookingAction.booking.meet_url ? <a href={bookingAction.booking.meet_url} target="_blank" rel="noopener noreferrer" className="underline">
        {english ? 'Open video call' : 'Abrir videollamada'}
      </a> : <p>{english ? 'The team will provide the call link.' : 'El equipo te facilitará el enlace de la llamada.'}</p>}
      {bookingAction.booking.meet_url?.startsWith('https://meet.jit.si/') && <p>{english ? 'If you arrive early, wait for the host to open the room.' : 'Si llegas antes, espera a que el anfitrión abra la sala.'}</p>}
      <p>{english ? 'Email confirmation is pending processing.' : 'La confirmación por correo está pendiente de procesamiento.'}</p>
    </>}
  </div>;
}

export function ChatDesktop({ onClose, autoFocus = false, immersive = false }: { onClose?: () => void; autoFocus?: boolean; immersive?: boolean }) {
  const { messages, isTyping, streamingText, sendMessage, isDeleting, bookingAction, bookingContextKey, meetingGuideRequested, openMeetingGuide, dismissMeetingGuide } = useChat();
  const lang = useLang();
  const english = lang === 'en';
  const [input, setInput] = useState('');
  const bookingReviewed = bookingAction?.status === 'confirmation_required' || bookingAction?.status === 'confirmed';
  const meetingGuideOpen = !isDeleting && !bookingReviewed && meetingGuideRequested;
  const textareaId = useId();
  const chatRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const followBottomRef = useRef(true);
  const [unseenMessages, setUnseenMessages] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [announcement, setAnnouncement] = useState('');
  const [visualPaused, setVisualPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [ambientRoot, setAmbientRoot] = useState<HTMLElement | null>(null);
  const lastAgent = messages.filter(message => message.role === 'agent').at(-1);
  const phase = !isTyping ? 'idle' : streamingText.trim() ? 'responding' : 'thinking';
  const phaseLabel = isDeleting ? (english ? 'Deleting data' : 'Borrando datos')
    : phase === 'thinking' ? (english ? 'Processing request' : 'Procesando consulta')
    : phase === 'responding' ? (english ? 'Responding' : 'Respondiendo')
    : (english ? 'Conversation' : 'Conversación');
  useEffect(() => {
    if (!immersive) return;
    setAmbientRoot(document.getElementById('studio-ambient-root'));
    const root = document.documentElement;
    const pauseControl = document.getElementById('activityPause');
    const update = () => {
      setVisualPaused(root.dataset.hudPaused === 'true');
      setUserPaused(pauseControl?.getAttribute('aria-pressed') === 'true');
    };
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ['data-hud-paused'] });
    if (pauseControl) observer.observe(pauseControl, { attributes: true, attributeFilter: ['aria-pressed'] });
    update();
    return () => observer.disconnect();
  }, [immersive]);

  const latestMessages = useCallback(() => {
    followBottomRef.current = true;
    setUnseenMessages(false);
    const area = chatRef.current;
    if (area) area.scrollTop = area.scrollHeight;
  }, []);
  useEffect(() => {
    if (followBottomRef.current) latestMessages();
    else setUnseenMessages(true);
  }, [messages, streamingText, latestMessages]);
  useEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => { if (followBottomRef.current) latestMessages(); });
    observer.observe(content);
    return () => observer.disconnect();
  }, [latestMessages]);
  useEffect(() => {
    document.addEventListener('chat-trigger', latestMessages);
    return () => document.removeEventListener('chat-trigger', latestMessages);
  }, [latestMessages]);
  useEffect(() => {
    setAnnouncement(isTyping ? t('chat.typing') : lastAgent ? lastAgent.text : '');
  }, [isTyping, lastAgent?.id]);
  useEffect(() => { if (autoFocus) textareaRef.current?.focus(); }, [autoFocus]);

  const handleSend = useCallback(() => {
    const message = input.trim();
    if (!message || isTyping || isDeleting) return;
    latestMessages();
    void sendMessage(message);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isTyping, isDeleting, sendMessage, latestMessages]);

  const requestForReply = (index: number) => messages.slice(0, index).findLast(message => message.role === 'user')?.text || '';
  const readableUserMessage = (index: number) => {
    const original = messages[index].text;
    const selector = /^(Quiero información sobre el (servicio|proyecto)|I want information about the (service|project)): (.+)$/.exec(original);
    if (!selector) return original;
    const kind = selector[2] === 'servicio' || selector[3] === 'service' ? 'service' : 'project';
    if (!parseChatIntent(`${kind}:${selector[4]}`)) return original;
    const reply = messages[index + 1];
    const title = reply?.role === 'agent' && !reply.excludeFromContext && reply.operationComplete !== false
      ? /^#{2,3} ([^\r\n]{1,200})/.exec(reply.text)?.[1] : undefined;
    return title ? `${selector[1]} ${title.replace(/\\([\\`*_{}\[\]()#+.!-])/g, '$1')}` : original;
  };
  const galleryReply = messages.findLastIndex((message, index) => message.role === 'agent' && !message.excludeFromContext &&
    message.operationComplete !== false && Boolean(parseChatProjectRequest(requestForReply(index))));
  const sendIntent = (intent: 'start' | 'portfolio' | 'services' | 'contact' | 'manifesto') => {
    latestMessages();
    void sendMessage(chatIntentMessage(intent, lang));
  };
  const intro = <div className="chat-intro">
    <div className="chat-assistant-orb" aria-hidden="true"><span>Λ</span></div>
    <div className="chat-intro-copy"><p className="chat-intro-label">AKRASIA</p>
      <h3>{english ? 'What do you want to create?' : '¿Qué quieres crear?'}</h3>
      <p>{english ? 'Human direction. AI production. Tell us your idea.' : 'Dirección humana. Producción con IA. Cuéntame tu idea.'}</p>
      <div className="chat-starter-actions">
        <button type="button" disabled={isTyping || isDeleting} onClick={() => sendIntent('start')}><span aria-hidden="true">◇</span>{english ? 'I have an idea' : 'Tengo una idea'}</button>
        <button type="button" disabled={isTyping || isDeleting} onClick={() => sendIntent('portfolio')}><span aria-hidden="true">▧</span>{english ? 'See our work' : 'Ver trabajos'}</button>
        <button type="button" disabled={isTyping || isDeleting} onClick={() => sendIntent('services')}><span aria-hidden="true">◈</span>{english ? 'Explore services' : 'Explorar servicios'}</button>
      </div>
    </div>
  </div>;

  return <>
    {immersive && ambientRoot && createPortal(<StudioCore variant="background" phase={phase} paused={visualPaused} />, ambientRoot)}
    <section className="chat-surface" data-chat-phase={isDeleting ? 'deleting' : phase} aria-label={english ? 'Akrasia AI chat' : 'Chat IA de Akrasia'}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && onClose) { event.preventDefault(); onClose(); } }}>
    <div className="chat-heading">
      <h2>{english ? 'AKRASIA // CONVERSATION' : 'AKRASIA // CONVERSACIÓN'}</h2>
      {immersive && <>
        <p className="chat-live-status" aria-live="off">{phaseLabel}</p>
        <button type="button" className="chat-motion-control" aria-pressed={userPaused}
          aria-label={userPaused ? (english ? 'Resume movement' : 'Reanudar movimiento') : (english ? 'Pause movement' : 'Pausar movimiento')}
          title={userPaused ? (english ? 'Resume movement' : 'Reanudar movimiento') : (english ? 'Pause movement' : 'Pausar movimiento')}
          onClick={() => document.getElementById('activityPause')?.click()}>
          <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">{userPaused ? <path d="m5 3 7 5-7 5V3Z" /> : <path d="M5 3v10M11 3v10" />}</svg>
        </button>
      </>}
      {onClose && <button type="button" onClick={onClose} aria-label={english ? 'Close chat' : 'Cerrar chat'} className="chat-close">×</button>}
    </div>
    {immersive && <div className="studio-hologram-stage" aria-hidden="true">
      <span className="studio-hologram-projector" />
    </div>}
    {immersive && <ShowreelBackdrop active={messages.length === 1 && !isTyping && !meetingGuideOpen} paused={visualPaused} />}
    <div ref={chatRef} className="chat-layer" role="log" aria-label={english ? 'Conversation' : 'Conversación'} aria-live="off" tabIndex={0}
      onScroll={event => {
        const area = event.currentTarget;
        followBottomRef.current = area.scrollHeight - area.scrollTop - area.clientHeight < 72;
        if (followBottomRef.current) setUnseenMessages(false);
      }}>
      <div ref={contentRef} className="chat-transcript" data-welcome-only={immersive && messages.length === 1 && !isTyping}>
      {!immersive && intro}
      {immersive && messages.length === 1 && !isTyping && !meetingGuideOpen && <div className="hub-hero" lang={lang}>
        <p className="hub-hero__eyebrow"><span>AKRASIA STUDIO</span><i aria-hidden="true" /></p>
        <p className="hub-hero__title">
          <span className="hub-hero__line">{english ? 'We don\'t prompt.' : 'No escribimos prompts.'}</span>
          <span className="hub-hero__line hub-hero__line--accent">{english ? 'We direct AI.' : 'Dirigimos la IA.'}</span>
        </p>
      </div>}
      {messages.map((message, index) => message.id === 0 && !message.excludeFromContext && !message.operationId && (!immersive || messages.length > 1) ? null : <div key={message.id} className={message.role === 'agent' ? 'chat-bubble-agent' : 'chat-bubble-user'}>
        <p className="chat-role">{message.role === 'agent' ? (immersive ? 'AKRASIA AI' : t('chat.agent')) : t('chat.you')}</p>
        {index === galleryReply ? <>
          <ChatProjectCards requestMessage={requestForReply(index)} language={lang} onSendMessage={text => { latestMessages(); return sendMessage(text); }} disabled={isTyping || isDeleting} />
          <details className="chat-project-context"><summary>{english ? 'Read the project information' : 'Leer la información del proyecto'}</summary><div className="chat-message"><FormattedText text={message.text} /></div></details>
        </> : <div className="chat-message">{message.role === 'agent' ? <FormattedText text={message.text} /> : readableUserMessage(index)}</div>}
      </div>)}
      {immersive && messages.length === 1 && !isTyping && !meetingGuideOpen && <nav className="chat-starter-actions chat-hub-starters" aria-label={english ? 'Start the conversation' : 'Empezar la conversación'}>
        <button type="button" disabled={isDeleting} onClick={() => sendIntent('start')}><span aria-hidden="true">◇</span>{english ? 'I have an idea' : 'Tengo una idea'}</button>
        <button type="button" disabled={isDeleting} onClick={() => sendIntent('portfolio')}><span aria-hidden="true">▧</span>{english ? 'See our work' : 'Ver trabajos'}</button>
        <button type="button" disabled={isDeleting} onClick={() => sendIntent('services')}><span aria-hidden="true">◈</span>{english ? 'Services' : 'Servicios'}</button>
        <button type="button" disabled={isDeleting} onClick={() => { openMeetingGuide(); latestMessages(); }}><span aria-hidden="true">◎</span>{english ? 'Book a call' : 'Reservar llamada'}</button>
      </nav>}
      {meetingGuideOpen && <MeetingGuide key={bookingContextKey} language={lang} onClose={dismissMeetingGuide} />}
      <BookingResult />
      {isTyping && <div className="chat-bubble-agent">
        <p className="chat-role">{immersive ? 'AKRASIA AI' : t('chat.agent')}</p>
        <div className="chat-message">{streamingText ? <FormattedText text={streamingText} /> : t('chat.typing')}</div>
      </div>}
      </div>
    </div>
    {unseenMessages && <button type="button" className="chat-latest" onClick={latestMessages}>{english ? 'Latest messages' : 'Últimos mensajes'} <span aria-hidden="true">↓</span></button>}
    <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
    {!immersive && <nav className="chat-shortcuts" aria-label={english ? 'Explore in the chat' : 'Explorar en el chat'}>
      {(['services', 'portfolio', 'contact', 'manifesto'] as const).map(intent => <button key={intent} type="button" disabled={isTyping || isDeleting}
        onClick={() => sendIntent(intent)}>
        {intent === 'services' ? (english ? 'Services' : 'Servicios') : intent === 'portfolio' ? (english ? 'Projects' : 'Proyectos') : intent === 'contact' ? (english ? 'Contact' : 'Contacto') : (english ? 'Manifesto' : 'Manifiesto')}
      </button>)}
    </nav>}
    <form className="chat-composer" onSubmit={event => { event.preventDefault(); handleSend(); }}>
      <label htmlFor={textareaId} className="sr-only">{english ? 'Your message' : 'Tu mensaje'}</label>
      <div className="chat-input-row">
        <span className="chat-composer-icon" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4h16v12H9l-5 4V4Z" /></svg></span>
        <textarea id={textareaId} ref={textareaRef} rows={1} maxLength={2000}
          placeholder={english ? 'Write your idea…' : 'Escribe tu idea…'} value={input} onChange={event => {
            setInput(event.target.value);
            event.target.style.height = 'auto';
            event.target.style.height = Math.min(event.target.scrollHeight, 84) + 'px';
          }}
          onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); handleSend(); } }} />
        <button type="submit" className="chat-send" disabled={isTyping || isDeleting} aria-label={t('chat.send')} title={t('chat.send')}><svg aria-hidden="true" width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="m4 11 16-7-7 16-2-7-7-2Z" /><path d="m11 13 9-9" /></svg></button>
      </div>
      <div className="chat-tools">
        <button type="button" className="chat-tool" aria-expanded={meetingGuideOpen} onClick={() => {
          if (meetingGuideOpen) dismissMeetingGuide();
          else openMeetingGuide();
          latestMessages();
        }} disabled={isTyping || isDeleting}>{english ? 'Book a video call' : 'Reservar videollamada'}</button>
        <a href="mailto:info@akrasia.studio" className="chat-tool">info@akrasia.studio</a>
        <ChatPrivacyControl />
      </div>
      <p className="chat-data-notice">{english ? 'We store the chat to reply to you. Avoid sensitive data.' : 'Guardamos el chat para responderte. Evita datos sensibles.'} <a href="/privacidad#chat">{english ? 'Privacy (ES)' : 'Privacidad'}</a></p>
      <p className="sr-only">{english ? 'Enter to send. Shift + Enter for a new line.' : 'Intro para enviar. Mayús + Intro para saltar de línea.'}</p>
    </form>
  </section></>;
}

function ChatController() {
  const english = useLang() === 'en';
  const [desktopRoot, setDesktopRoot] = useState<HTMLElement | null>(null);
  const [mobileChatSlot, setMobileChatSlot] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  const embedded = !!desktopRoot;
  const focusEmbedded = useCallback(() => {
    const root = document.getElementById('chat-desktop-root');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (root) {
      const rect = root.getBoundingClientRect();
      if (rect.top < 0 || rect.top >= window.innerHeight) root.scrollIntoView({ behavior: reduced ? 'instant' : 'smooth', block: 'start' });
    }
    root?.querySelector<HTMLTextAreaElement>('textarea')?.focus({ preventScroll: true });
  }, []);

  const close = useCallback(() => {
    dialogRef.current?.close();
    setOpen(false);
  }, []);
  useEffect(() => {
    // Restore focus after React has made the launcher visible again.
    if (!open && wasOpenRef.current) openerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open]);
  useEffect(() => {
    setDesktopRoot(document.getElementById('chat-desktop-root'));
    setMobileChatSlot(document.getElementById('mobileChatSlot'));
    document.documentElement.setAttribute('data-chat-ready', '');
    const trigger = () => {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
      focusEmbedded();
    };
    document.addEventListener('chat-trigger', trigger);
    document.addEventListener('mobile-chat-close', close);
    return () => {
      document.documentElement.removeAttribute('data-chat-ready');
      document.removeEventListener('chat-trigger', trigger);
      document.removeEventListener('mobile-chat-close', close);
    };
  }, [close, focusEmbedded]);
  useEffect(() => {
    if (open && !embedded && dialogRef.current && !dialogRef.current.open) {
      dialogRef.current.showModal();
      dialogRef.current.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    }
    if (embedded) dialogRef.current?.close();
  }, [open, embedded]);

  const launch = () => document.dispatchEvent(new CustomEvent('chat-trigger', { detail: { message: '' } }));
  const launcher = <button type="button" onClick={launch} className="chat-launcher" aria-haspopup={embedded ? undefined : 'dialog'} aria-expanded={embedded || open}>
    <span aria-hidden="true">◈</span> {embedded ? (english ? 'Back to chat' : 'Volver al chat') : (english ? 'Open chat' : 'Abrir chat')}
  </button>;

  return <>
    {desktopRoot && createPortal(<div className="embedded-chat"><ChatDesktop immersive /></div>, desktopRoot)}
    {mobileChatSlot ? createPortal(launcher, mobileChatSlot) : !embedded && launcher}
    {!embedded && <dialog ref={dialogRef} className="chat-dialog" aria-label={english ? 'Akrasia AI chat' : 'Chat IA de Akrasia'}
      onCancel={event => { event.preventDefault(); close(); }}
      onClick={event => { if (event.target === dialogRef.current) close(); }}>
      {open && <ChatDesktop onClose={close} autoFocus={open} />}
    </dialog>}
  </>;
}

export default function ChatWrapper() {
  return <ChatProvider><ChatController /></ChatProvider>;
}
