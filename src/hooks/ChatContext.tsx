import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { t, getLang } from '../lib/i18n';
import { parseChatIntentUrl } from '../lib/chat-navigation';
import { guidedBookingMessage, type GuidedBookingRequest } from '../lib/booking-guide';
import { declinesMeetingGuide } from '../lib/meeting-intent';
import { trackPublicEvent } from '../lib/analytics';
import {
  buildChatMessages,
  ChatClientError,
  createChatSSEParser,
  formatChatError,
  getChatError,
  MAX_CHAT_MESSAGE_CHARS,
  type ChatActionResult,
  type BookingProposal,
} from '../lib/chat-client';
import {
  clearSessionHistory,
  CHAT_ERASURE_KEY,
  isErasedSession,
  latestErasure,
  recordErasure,
  loadSessionMessages,
  MAX_LOCAL_HISTORY,
  parseChatSession,
  purgeLegacyVisitorState,
  saveSessionMessages,
  type VerifiedChatSession,
} from '../lib/visitorId';

const MAX_HISTORY = MAX_LOCAL_HISTORY;
const REQUEST_TIMEOUT_MS = 120_000;

export interface Message {
  id: number;
  role: 'user' | 'agent';
  text: string;
  excludeFromContext?: boolean;
  operationId?:string;
  operationComplete?:boolean;
}

function getWelcome(): string {
  return t('chat.welcome');
}

function welcomeMessages(): Message[] {
  return [{ id: 0, role: 'agent', text: getWelcome() }];
}

function cleanAgentText(text: string): string {
  return text.trim();
}

interface VisitorHistorySummary extends VerifiedChatSession {
  csrfToken: string;
  conversations: Array<{
    id: string;
    created_at: string;
    messages: Array<{ role: string; content: string }>;
  }>;
  summary: string | null;
  visitorName: string | null;
  visitorCompany: string | null;
}

function returningMessages(data: VisitorHistorySummary): Message[] {
  const lastConv = Array.isArray(data.conversations) ? data.conversations[0] : null;
  if (!lastConv || !Array.isArray(lastConv.messages)) return welcomeMessages();
  const firstUser = lastConv.messages.find((message) => message?.role === 'user' && typeof message.content === 'string');
  const lastTopic = firstUser?.content.substring(0, 80) || '';
  const displayName = typeof data.visitorName === 'string' ? data.visitorName.substring(0, 120)
    : typeof data.visitorCompany === 'string' ? data.visitorCompany.substring(0, 120) : '';
  const greeting = `${t('chat.welcomeBack')}${displayName ? `, ${displayName}` : ''}`;
  const text = lastTopic
    ? `${greeting}. ${t('chat.lastTime')} "${lastTopic}". ${t('chat.helpToday')}`
    : `${greeting}. ${t('chat.helpThisTime')}`;
  return [{ id: 0, role: 'agent', text, excludeFromContext: true }];
}

interface ChatContextType {
  messages: Message[];
  isTyping: boolean;
  streamingText: string;
  sendMessage: (text: string) => Promise<void>;
  requestBooking: (request: GuidedBookingRequest) => Promise<void>;
  bookingContextKey: string | null;
  meetingGuideRequested: boolean;
  openMeetingGuide: () => void;
  dismissMeetingGuide: () => void;
  clearHistory: () => Promise<void>;
  isDeleting: boolean;
  deletionStatus: string;
  bookingAction: ChatActionResult | null;
  confirmBooking: () => Promise<void>;
  dismissBooking: () => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  // Never render local personal data before the HttpOnly session is verified.
  const [messages, setMessages] = useState<Message[]>(welcomeMessages);
  const [session, setSession] = useState<VerifiedChatSession | null>(null);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [bookingAction, setBookingAction] = useState<ChatActionResult | null>(null);
  const [meetingGuideRequested, setMeetingGuideRequested] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState('');
  const deletingRef = useRef(false);
  const csrfRef = useRef<string | null>(null);
  const erasureChannelRef = useRef<BroadcastChannel | null>(null);
  const proposalRef = useRef<BookingProposal | null>(null);
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const nextId = useRef(Math.max(...messages.map((m) => m.id), 0) + 1);
  const isTypingRef = useRef(false);
  const sendSequenceRef = useRef(0);
  const sendingOperationRef = useRef<number | null>(null);
  const predefinedOperationRef = useRef<number | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const cooldownRef = useRef<{ until: number; error: ChatClientError } | null>(null);
  const sessionRef = useRef<VerifiedChatSession | null>(null);
  const sessionRequestRef = useRef<Promise<VerifiedChatSession> | null>(null);
  const mountedRef = useRef(true);
  const initialIntentHandledRef = useRef(false);
  const generationRef = useRef(0);
  const chatStartedRef = useRef(false);
  // Kept only in memory to avoid counting a replayed confirmation twice. Never sent to analytics.
  const measuredBookingsRef = useRef(new Set<string>());

  const replaceMessages = useCallback((next: Message[]) => {
    messagesRef.current = next;
    nextId.current = Math.max(...next.map((message) => message.id), 0) + 1;
    setMessages(next);
  }, []);

  const stopSending = useCallback(() => {
    sendingOperationRef.current = null;
    predefinedOperationRef.current = null;
    isTypingRef.current = false;
    setIsTyping(false);
  }, []);

  const discardSession = useCallback(() => {
    generationRef.current++;
    if (activeRequestRef.current || predefinedOperationRef.current !== null) {
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      stopSending();
    }
    sessionRef.current = null;
    csrfRef.current = null;
    setSession(null);
    cooldownRef.current = null;
    clearSessionHistory();
    replaceMessages(welcomeMessages());
    setStreamingText('');
    proposalRef.current = null;
    setBookingAction(null);
    setMeetingGuideRequested(false);
  }, [replaceMessages, stopSending]);

  const ensureSession = useCallback((refresh = false): Promise<VerifiedChatSession> => {
    const existing = sessionRef.current;
    if (!refresh && existing && existing.sessionExpiresAt * 1000 > Date.now()) return Promise.resolve(existing);
    if (sessionRequestRef.current) return sessionRequestRef.current;
    purgeLegacyVisitorState();
    if (existing && existing.sessionExpiresAt * 1000 <= Date.now()) discardSession();
    const pending = (async () => {
      const requestGeneration = generationRef.current;
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch('/api/visitor-history', { credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(10000) });
        if (response.status === 401) {
          if (mountedRef.current) discardSession();
          if (attempt === 0) continue; // The server has cleared the invalid cookie.
        }
        if (!response.ok) throw getChatError(await response.json().catch(() => null), response.status, response.headers.get('Retry-After'));
        const data = await response.json() as VisitorHistorySummary;
        const verified = parseChatSession(data?.sessionId, data?.sessionExpiresAt, data?.contextVersion);
        if (!verified || isErasedSession(verified) || requestGeneration !== generationRef.current && sessionRef.current) throw new ChatClientError('chat_interrupted');
        if (!mountedRef.current) throw new ChatClientError('chat_interrupted');
        const previous = sessionRef.current;
        if (previous?.sessionId === verified.sessionId && previous.sessionExpiresAt === verified.sessionExpiresAt &&
          verified.contextVersion < previous.contextVersion) throw new ChatClientError('chat_interrupted');
        const changed = !previous || previous.sessionId !== verified.sessionId || previous.sessionExpiresAt !== verified.sessionExpiresAt || previous.contextVersion !== verified.contextVersion;
        if (changed) {
          generationRef.current++;
          if (activeRequestRef.current || predefinedOperationRef.current !== null) {
            activeRequestRef.current?.abort();
            activeRequestRef.current = null;
            stopSending();
          }
          cooldownRef.current = null;
          const stored = loadSessionMessages(verified);
          replaceMessages(stored && stored.length > 1 ? stored : returningMessages(data));
          setStreamingText('');
          proposalRef.current = null;
          setBookingAction(null);
          setMeetingGuideRequested(false);
        }
        sessionRef.current = verified;
        csrfRef.current = typeof data.csrfToken === 'string' ? data.csrfToken : null;
        setSession(verified);
        return verified;
      }
      throw new ChatClientError('invalid_chat_session');
    })();
    sessionRequestRef.current = pending;
    void pending.finally(() => {
      if (sessionRequestRef.current === pending) sessionRequestRef.current = null;
    }).catch(() => {});
    return pending;
  }, [discardSession, replaceMessages, stopSending]);

  useEffect(() => {
    mountedRef.current = true;
    void ensureSession().catch(() => {});
    return () => { mountedRef.current = false; activeRequestRef.current?.abort(); };
  }, [ensureSession]);

  useEffect(() => {
    if (!deletingRef.current) saveSessionMessages(session, messages);
  }, [messages, session]);

  useEffect(() => {
    const invalidate = (event?: MessageEvent) => {
      const current = sessionRef.current;
      const stored = latestErasure();
      const signalled = event?.data && parseChatSession(event.data.sessionId, event.data.sessionExpiresAt, event.data.contextVersion);
      const erased = current && signalled && signalled.sessionId === current.sessionId && signalled.sessionExpiresAt === current.sessionExpiresAt &&
        (!stored || signalled.contextVersion > stored.contextVersion) ? signalled : stored;
      if (!current || !erased || current.sessionId !== erased.sessionId || current.contextVersion >= erased.contextVersion) return;
      generationRef.current++;
      activeRequestRef.current?.abort();
      activeRequestRef.current = null;
      sessionRef.current = erased;
      csrfRef.current = null;
      setSession(erased);
      clearSessionHistory();
      replaceMessages(welcomeMessages());
      proposalRef.current = null;
      setBookingAction(null);
      setMeetingGuideRequested(false);
      setStreamingText('');
      stopSending();
      setDeletionStatus(getLang() === 'en' ? 'The conversation was deleted in another tab.' : 'La conversación se ha borrado en otra pestaña.');
      void ensureSession(true).catch(() => {});
    };
    const onStorage = (event: StorageEvent) => { if (event.key === CHAT_ERASURE_KEY) invalidate(); };
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel('akrasia-chat-erasure'); channel.onmessage = invalidate; erasureChannelRef.current = channel; } catch {}
    window.addEventListener('storage', onStorage);
    return () => { window.removeEventListener('storage', onStorage); channel?.close(); erasureChannelRef.current = null; };
  }, [ensureSession, replaceMessages, stopSending]);

  useEffect(() => {
    if (!session) return;
    let timeout: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const remaining = session.sessionExpiresAt * 1000 - Date.now();
      if (remaining > 0) { timeout = setTimeout(schedule, Math.min(remaining, 2_147_483_647)); return; }
      discardSession();
      void ensureSession(true).catch(() => {});
    };
    schedule();
    return () => clearTimeout(timeout);
  }, [session, discardSession, ensureSession]);

  useEffect(() => {
    const refresh = () => {
      if (!isTypingRef.current && !deletingRef.current && document.visibilityState !== 'hidden') void ensureSession(true).catch(() => {});
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [ensureSession]);

  const sendMessage = useCallback(
    async (text: string, confirmation?: BookingProposal, bookingRequest?: GuidedBookingRequest, expectedBookingContext?: string) => {
      const sendLanguage = getLang();
      const msg = text.trim();
      if (!msg || isTypingRef.current || deletingRef.current) return;

      const appendError = (error: ChatClientError) => {
        if (!mountedRef.current) return;
        const notice: Message = {
          id: nextId.current++, role: 'agent' as const,
          text: formatChatError(error, t), excludeFromContext: true,
        };
        setMessages((prev) => [...prev, notice].slice(-MAX_HISTORY));
      };
      if (msg.length > MAX_CHAT_MESSAGE_CHARS) {
        appendError(new ChatClientError('request_too_large'));
        return;
      }

      const operation = ++sendSequenceRef.current;
      sendingOperationRef.current = operation;
      setIsTyping(true);
      isTypingRef.current = true;
      setStreamingText('');
      try {
        // Also detects a cookie changed by another tab before displaying or
        // saving this message, including responses that are handled locally.
        await ensureSession(true);
      } catch (error) {
        if (sendingOperationRef.current === operation) {
          appendError(error instanceof ChatClientError ? error : new ChatClientError('chat_unavailable'));
          stopSending();
        }
        return;
      }
      if (!mountedRef.current || deletingRef.current || sendingOperationRef.current !== operation) {
        if (sendingOperationRef.current === operation) stopSending();
        return;
      }
      if (bookingRequest && (!expectedBookingContext || expectedBookingContext !== `${sessionRef.current?.sessionId}:${sessionRef.current?.sessionExpiresAt}:${sessionRef.current?.contextVersion}`)) {
        stopSending();
        appendError(new ChatClientError('chat_context_changed'));
        return;
      }
      // Session refresh may have cleared or replaced the pending proposal.
      if (confirmation && (proposalRef.current?.token !== confirmation.token || confirmation.expiresAt * 1000 <= Date.now())) {
        setBookingAction(null);
        proposalRef.current = null;
        stopSending();
        appendError(new ChatClientError('invalid_request'));
        return;
      }
      if (!confirmation && !bookingRequest && declinesMeetingGuide(msg)) setMeetingGuideRequested(false);
      if (!confirmation) {
        proposalRef.current = null;
        setBookingAction(null);
      }
      let generation = generationRef.current;
      const retry=messagesRef.current.findLast(message=>message.role==='user'&&message.text===msg&&message.operationId&&!message.operationComplete);
      const operationId=confirmation?crypto.randomUUID():retry?.operationId||crypto.randomUUID();
      const userMsg: Message = { id: nextId.current++, role: 'user', text: msg,operationId,operationComplete:false };
      setMessages((prev) => prev.some(message=>message.role==='user'&&message.operationId===operationId)?prev:[...prev, userMsg].slice(-MAX_HISTORY));

      const controller = new AbortController();
      activeRequestRef.current = controller;
      let timedOut = false;
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, REQUEST_TIMEOUT_MS);
      try {
        const cooldown = cooldownRef.current;
        if (cooldown && cooldown.until > Date.now()) {
          throw new ChatClientError(cooldown.error.code, Math.ceil((cooldown.until - Date.now()) / 1000));
        }
        cooldownRef.current = null;
        // History and personal context come from the authenticated server store.
        const currentMessages = buildChatMessages([{ role: 'user', content: msg }]);

        if (!chatStartedRef.current) {
          chatStartedRef.current = true;
          trackPublicEvent('chat_start', { language: sendLanguage });
        }

        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          cache: 'no-store',
          signal: controller.signal,
          body: JSON.stringify({ messages: currentMessages, context_version: sessionRef.current?.contextVersion ?? 0,operation_id:operationId,language:sendLanguage, ...(confirmation ? { booking_confirmation: confirmation.token } : {}), ...(bookingRequest ? { booking_request: bookingRequest } : {}) }),
        });

        if (!res.ok) {
          const data: unknown = await res.json().catch(() => null);
          throw getChatError(data, res.status, res.headers.get('Retry-After'));
        }

        const responseSession = parseChatSession(res.headers.get('X-Chat-Session-Id'), res.headers.get('X-Chat-Session-Expires'), res.headers.get('X-Chat-Context-Version') ?? 0);
        if (!responseSession) throw new ChatClientError('chat_unavailable');
        const currentSession = sessionRef.current;
        if (generation !== generationRef.current || isErasedSession(responseSession) ||
          responseSession.sessionId === currentSession?.sessionId && responseSession.contextVersion !== currentSession.contextVersion) throw new ChatClientError('chat_interrupted');
        if (responseSession.sessionId !== currentSession?.sessionId || responseSession.sessionExpiresAt !== currentSession.sessionExpiresAt) {
          generation = ++generationRef.current;
          clearSessionHistory();
          sessionRef.current = responseSession;
          setSession(responseSession);
          cooldownRef.current = null;
          proposalRef.current = null;
          setBookingAction(null);
          setMeetingGuideRequested(false);
          replaceMessages([...welcomeMessages(), { ...userMsg, id: 1 }]);
        }

        reader = res.body?.getReader();
        if (!reader || !res.headers.get('Content-Type')?.includes('text/event-stream')) {
          throw new ChatClientError('chat_unavailable');
        }

        const decoder = new TextDecoder();
        const parser = createChatSSEParser();
        let fullText = '';
        let resultAction: ChatActionResult | undefined;
        let resultMeetingGuide = false;

        while (true) {
          const { done, value } = await reader.read();
          if (!mountedRef.current || generation !== generationRef.current) throw new ChatClientError('chat_interrupted');
          const chunk = done ? decoder.decode() : decoder.decode(value, { stream: true });
          for (const event of parser.push(chunk)) {
            if ('content' in event) {
              fullText = event.replace ? event.content : fullText + event.content;
              setStreamingText(cleanAgentText(fullText));
            } else if ('action' in event) {
              if (resultAction) throw new ChatClientError('chat_interrupted');
              resultAction = event.action;
            } else if ('meeting_guide' in event) {
              resultMeetingGuide = true;
            }
          }
          if (done || parser.complete) break;
        }
        parser.finish();
        if (!fullText.trim()) throw new ChatClientError('chat_interrupted');
        if (resultAction) {
          if (resultAction.status === 'confirmed' && !measuredBookingsRef.current.has(resultAction.booking.id)) {
            measuredBookingsRef.current.add(resultAction.booking.id);
            trackPublicEvent('booking_confirmed', { language: sendLanguage });
          }
          proposalRef.current = resultAction.status === 'confirmation_required' ? resultAction.proposal : null;
          setBookingAction(resultAction);
          setMeetingGuideRequested(resultAction.status === 'unavailable');
        } else if (!confirmation) {
          proposalRef.current = null;
          setBookingAction(null);
        }
        if (!resultAction && resultMeetingGuide) setMeetingGuideRequested(true);

        const agentMsg: Message = {
          id: nextId.current++,
          role: 'agent',
          text: cleanAgentText(fullText),
          operationId,operationComplete:true,
        };
        setMessages((prev) => [...prev.filter(message=>!(message.role==='agent'&&message.operationId===operationId)).map(message=>message.operationId===operationId?{...message,operationComplete:true}:message), agentMsg].slice(-MAX_HISTORY));
      } catch (err) {
        if (generation !== generationRef.current) return;
        const error = err instanceof ChatClientError ? err
          : new ChatClientError(timedOut ? 'chat_timeout' : 'chat_interrupted');
        if (error.code === 'invalid_chat_session') {
          discardSession();
          // Keep this recovery owned by the rejected send until it settles.
          // Erasure/another invalidation can still cancel its operation token.
          sendingOperationRef.current = operation;
          isTypingRef.current = true;
          setIsTyping(true);
          await ensureSession(true).catch(() => {});
          // The POST is not replayed: the user decides whether to send again.
          if (sendingOperationRef.current === operation) appendError(error);
        } else if (error.code === 'chat_context_changed') {
          // Database retention or another process may invalidate this version
          // without a browser broadcast. Verify again and never replay input.
          await ensureSession(true).catch(() => {});
        } else if (generation === generationRef.current && error.retryAfter) {
          cooldownRef.current = { until: Date.now() + error.retryAfter * 1000, error };
          appendError(error);
        } else if (generation === generationRef.current) {
          appendError(error);
        }
      } finally {
        clearTimeout(timeout);
        if (reader) {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        if (activeRequestRef.current === controller) activeRequestRef.current = null;
        if (sendingOperationRef.current === operation) {
          if (mountedRef.current) setStreamingText('');
          stopSending();
        }
      }
    },
    [discardSession, ensureSession, replaceMessages, stopSending]
  );

  const confirmBooking = useCallback(async () => {
    const proposal = proposalRef.current;
    if (proposal) await sendMessage(getLang() === 'en' ? 'Confirm booking' : 'Confirmar reserva', proposal);
  }, [sendMessage]);
  const requestBooking = useCallback(async (request: GuidedBookingRequest) => {
    const scope = session ? `${session.sessionId}:${session.sessionExpiresAt}:${session.contextVersion}` : undefined;
    await sendMessage(guidedBookingMessage(request, getLang()), undefined, request, scope);
  }, [sendMessage, session]);
  const dismissBooking = useCallback(() => {
    proposalRef.current = null;
    setBookingAction(null);
  }, []);
  const dismissMeetingGuide = useCallback(() => setMeetingGuideRequested(false), []);
  const openMeetingGuide = useCallback(() => {
    if (isTypingRef.current || deletingRef.current) return;
    proposalRef.current = null;
    setBookingAction(null);
    setMeetingGuideRequested(true);
  }, []);

  useEffect(() => {
    const handler = ((e: CustomEvent) => {
      if (e.detail?.message) {
        sendMessage(e.detail.message);
      }
    }) as EventListener;
    document.addEventListener('chat-trigger', handler);
    const frame = requestAnimationFrame(() => {
      if (initialIntentHandledRef.current) return;
      initialIntentHandledRef.current = true;
      const linked = parseChatIntentUrl(window.location.href, window.location.origin, getLang());
      if (linked) {
        // Consume the entry action so reloads never resend a predefined turn.
        const url = new URL(window.location.href);
        url.searchParams.delete('chat');
        window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}`);
        document.dispatchEvent(new CustomEvent('chat-trigger', { detail: { message: linked.message } }));
      }
    });
    return () => { cancelAnimationFrame(frame); document.removeEventListener('chat-trigger', handler); };
  }, [sendMessage]);

  const clearHistory = useCallback(async () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setIsDeleting(true);
    setDeletionStatus('');
    generationRef.current++;
    activeRequestRef.current?.abort();
    activeRequestRef.current = null;
    setStreamingText('');
    proposalRef.current = null;
    setBookingAction(null);
    setMeetingGuideRequested(false);
    stopSending();
    let deleteGeneration: number | null = null;
    try {
      // A pending history read may predate this operation. Let it settle before
      // obtaining a new owner/version and the ephemeral CSRF token.
      await sessionRequestRef.current?.catch(() => {});
      const before = await ensureSession(true);
      const csrf = csrfRef.current;
      if (!csrf) throw new ChatClientError('chat_unavailable');
      deleteGeneration = generationRef.current;
      const response = await fetch('/api/visitor-history', { method: 'DELETE', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-Chat-CSRF': csrf },
        body: JSON.stringify({ contextVersion: before.contextVersion }), signal: AbortSignal.timeout(15000) });
      const result = await response.json().catch(() => null);
      if (deleteGeneration !== generationRef.current) return;
      if (!response.ok) throw getChatError(result, response.status, response.headers.get('Retry-After'));
      const verified = parseChatSession(result?.sessionId, result?.sessionExpiresAt, result?.contextVersion);
      if (!verified || result?.deleted !== true || result?.scope !== 'chat_and_derived_profile' ||
        verified.sessionId !== before.sessionId || verified.sessionExpiresAt !== before.sessionExpiresAt ||
        verified.contextVersion <= before.contextVersion || isErasedSession(verified) ||
        sessionRef.current?.sessionId !== before.sessionId || sessionRef.current.sessionExpiresAt !== before.sessionExpiresAt ||
        sessionRef.current.contextVersion > verified.contextVersion || typeof result?.csrfToken !== 'string') throw new ChatClientError('chat_unavailable');
      generationRef.current++;
      sessionRef.current = verified;
      csrfRef.current = result.csrfToken;
      recordErasure(verified);
      clearSessionHistory();
      replaceMessages(welcomeMessages());
      setSession(verified);
      erasureChannelRef.current?.postMessage({ type: 'erased', ...verified });
      setDeletionStatus(getLang() === 'en' ? 'Conversation and derived profile deleted. Bookings and security controls are retained.' : 'Conversación y perfil derivado borrados. Las reservas y los controles de seguridad se conservan.');
    } catch (error) {
      if (deleteGeneration !== null && deleteGeneration !== generationRef.current) return;
      if (error instanceof ChatClientError && error.code === 'invalid_chat_session') discardSession();
      const english = getLang() === 'en';
      setDeletionStatus(error instanceof ChatClientError && error.code === 'chat_busy'
        ? english ? `A chat request is finishing. Server deletion has not been confirmed; wait ${error.retryAfter || 60} seconds and confirm deletion again.` : `Hay una petición del chat terminando. No se ha borrado el servidor; espera ${error.retryAfter || 60} segundos y vuelve a confirmar el borrado.`
        : english ? 'Deletion has not been confirmed. You can try again; bookings have not been cancelled.' : 'No se ha confirmado el borrado. Puedes volver a intentarlo; las reservas no se han cancelado.');
    } finally {
      deletingRef.current = false;
      setIsDeleting(false);
    }
  }, [discardSession, ensureSession, replaceMessages, stopSending]);

  return (
    <ChatContext.Provider
      value={{ messages, isTyping, streamingText, sendMessage, requestBooking, bookingContextKey: session ? `${session.sessionId}:${session.sessionExpiresAt}:${session.contextVersion}` : null, meetingGuideRequested, openMeetingGuide, dismissMeetingGuide, clearHistory, isDeleting, deletionStatus, bookingAction, confirmBooking, dismissBooking }}
    >
      {children}
    </ChatContext.Provider>
  );
}

export function useChat() {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used within ChatProvider');
  return ctx;
}
