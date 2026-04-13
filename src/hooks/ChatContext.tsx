import {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';
import { getOrCreateVisitorId } from '../lib/visitorId';

const STORAGE_KEY = 'akrasia_chat_history';
const MAX_HISTORY = 50;

export interface Message {
  id: number;
  role: 'user' | 'agent';
  text: string;
}

const AGENT_WELCOME =
  'Hola. Soy el agente de Akrasia Studio. Estoy aqui para ayudarte con informacion sobre nuestros servicios, presupuestos o cualquier consulta. Que necesitas?';

function loadMessages(): Message[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  return [{ id: 0, role: 'agent', text: AGENT_WELCOME }];
}

function saveMessages(messages: Message[]) {
  if (typeof window === 'undefined') return;
  try {
    const toSave = messages.slice(-MAX_HISTORY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
  } catch {}
}

interface ChatContextType {
  messages: Message[];
  isTyping: boolean;
  streamingText: string;
  sendMessage: (text: string) => Promise<void>;
  clearHistory: () => void;
}

const ChatContext = createContext<ChatContextType | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [isTyping, setIsTyping] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  let nextId = useRef(Math.max(...loadMessages().map((m) => m.id), 0) + 1);
  const isTypingRef = useRef(false);

  useEffect(() => {
    saveMessages(messages);
  }, [messages]);

  const sendMessage = useCallback(
    async (text: string) => {
      const msg = text.trim();
      if (!msg || isTypingRef.current) return;

      const userMsg: Message = { id: nextId.current++, role: 'user', text: msg };
      setMessages((prev) => [...prev, userMsg]);
      setIsTyping(true);
      isTypingRef.current = true;
      setStreamingText('');

      const currentMessages = [...messagesRef.current, userMsg]
        .map((m) => ({
          role: m.role === 'agent' ? ('assistant' as const) : ('user' as const),
          content: m.text,
        }));

      try {
        const visitorId = getOrCreateVisitorId();
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: currentMessages, visitor_id: visitorId }),
        });

        if (!res.ok) {
          const errBody = await res.text();
          console.error('[Chat API error]', res.status, errBody);
          throw new Error('API error: ' + errBody);
        }

        const reader = res.body?.getReader();
        if (!reader) throw new Error('No reader');

        const decoder = new TextDecoder();
        let fullText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data === '[DONE]') continue;
              try {
                const parsed = JSON.parse(data);
                if (parsed.content) {
                  fullText += parsed.content;
                  setStreamingText(fullText);
                }
              } catch {}
            }
          }
        }

        const agentMsg: Message = {
          id: nextId.current++,
          role: 'agent',
          text: fullText,
        };
        setMessages((prev) => [...prev, agentMsg]);
      } catch (err) {
        console.error('[Chat error]', err);
        const agentMsg: Message = {
          id: nextId.current++,
          role: 'agent',
          text: 'Lo siento, ha ocurrido un error de conexion. Intenta de nuevo en unos momentos.',
        };
        setMessages((prev) => [...prev, agentMsg]);
      } finally {
        setIsTyping(false);
        isTypingRef.current = false;
        setStreamingText('');
      }
    },
    []
  );

  useEffect(() => {
    const handler = ((e: CustomEvent) => {
      if (e.detail?.message) {
        sendMessage(e.detail.message);
      }
    }) as EventListener;
    document.addEventListener('chat-trigger', handler);
    return () => document.removeEventListener('chat-trigger', handler);
  }, [sendMessage]);

  const clearHistory = useCallback(() => {
    const welcome: Message = { id: 0, role: 'agent', text: AGENT_WELCOME };
    setMessages([welcome]);
    nextId.current = 1;
    saveMessages([welcome]);
  }, []);

  return (
    <ChatContext.Provider
      value={{ messages, isTyping, streamingText, sendMessage, clearHistory }}
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
