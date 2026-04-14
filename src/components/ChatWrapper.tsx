import { ChatProvider, useChat } from '../hooks/ChatContext';
import { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import FormattedText from './FormattedText';

function ChatDesktop() {
  const { messages, isTyping, streamingText, sendMessage } = useChat();
  const [input, setInput] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || isTyping) return;
    sendMessage(msg);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  }, [input, isTyping, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInput = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setInput(e.target.value);
      const ta = e.target;
      ta.style.height = 'auto';
      const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
      ta.style.height = Math.min(ta.scrollHeight, lh * 3) + 'px';
    },
    []
  );

  return (
    <>
      <div className="chat-layer" ref={chatRef} style={{ paddingBottom: '76px' }}>
        {messages.map((m) =>
          m.role === 'agent' ? (
            <div key={m.id} className="chat-bubble-agent">
              <div className="text-[8px] text-primary/60 mb-1 flex items-center gap-1">
                <span className="material-symbols-outlined text-[10px]">
                  smart_toy
                </span>
                AGENTE_AKRASIA
              </div>
              <div className="text-[11px] text-slate-200 leading-relaxed">
                <FormattedText text={m.text} />
              </div>
            </div>
          ) : (
            <div key={m.id} className="chat-bubble-user text-right">
              <div className="text-[8px] text-primary/50 mb-1">TU</div>
              <div className="text-[11px] text-primary/90 leading-relaxed">
                {m.text}
              </div>
            </div>
          )
        )}
        {isTyping && (
          <div className="chat-bubble-agent">
            <div className="text-[8px] text-primary/60 mb-1 flex items-center gap-1">
              <span className="material-symbols-outlined text-[10px]">
                smart_toy
              </span>
              AGENTE_AKRASIA
            </div>
            <div className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap">
              {streamingText ? (
                <FormattedText text={streamingText} />
              ) : (
                <span className="text-primary/40 italic animate-pulse">
                  Escribiendo...
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-0 left-0 right-0 z-20 bg-black/30 backdrop-blur-sm p-4 border-t border-white/5">
        <div className="flex gap-4 items-center">
          <div className="flex-none text-primary">
            <span className="material-symbols-outlined">forum</span>
          </div>
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              className="w-full bg-transparent border-none focus:ring-0 focus:outline-none text-sm text-primary placeholder:text-primary/30 font-mono resize-none leading-5"
              rows={1}
              placeholder="Escribe tu mensaje al agente AKRASIA..."
              value={input}
              onInput={handleInput}
              onKeyDown={handleKeyDown}
              suppressHydrationWarning
            />
          </div>
          <button
            onClick={handleSend}
            disabled={isTyping}
            className="bg-primary/10 border border-primary/40 text-primary px-6 py-2 text-[10px] font-black hover:bg-primary hover:text-black transition-all angular-cut uppercase tracking-wider disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Enviar
          </button>
        </div>
      </div>
    </>
  );
}

function MobileChatBtn({ slot }: { slot: HTMLElement | null }) {
  const { messages } = useChat();
  const handleClick = useCallback(() => {
    document.dispatchEvent(new CustomEvent('chat-trigger', { detail: { message: messages.length > 0 ? '' : 'Hola, quiero saber mas sobre Akrasia Studio' } }));
  }, [messages]);

  if (!slot) return null;

  return createPortal(
    <button
      className="w-12 h-12 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/30 hover:scale-110 transition-transform"
      onClick={handleClick}
      aria-label="Abrir chat"
    >
      <span className="material-symbols-outlined text-black text-xl">forum</span>
    </button>,
    slot
  );
}

function MobileChat() {
  const { messages, isTyping, streamingText, sendMessage } = useChat();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  useEffect(() => {
    if (open) {
      setTimeout(scrollToBottom, 50);
    }
  }, [open, scrollToBottom]);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  useEffect(() => {
    const closeHandler = () => setOpen(false);
    const openHandler = (e: Event) => {
      if (window.innerWidth < 1024) setOpen(true);
    };
    document.addEventListener('mobile-chat-close', closeHandler);
    document.addEventListener('chat-trigger', openHandler);
    return () => {
      document.removeEventListener('mobile-chat-close', closeHandler);
      document.removeEventListener('chat-trigger', openHandler);
    };
  }, []);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || isTyping) return;
    sendMessage(msg);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  }, [input, isTyping, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  return (
    <>
      {open && (
        <div className="lg:hidden fixed inset-0 z-[85] flex flex-col">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={toggle} />
          <div className="absolute inset-x-0 bottom-0 top-12 flex flex-col z-10">
            <div className="glass-panel m-2 flex-1 flex flex-col overflow-hidden">
              <div className="p-3 flex items-center justify-between border-b border-white/5">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-primary text-sm">
                    smart_toy
                  </span>
                  <span className="text-primary text-[10px] font-bold uppercase tracking-widest">
                    Agente_Akrasia
                  </span>
                </div>
                <button
                  onClick={toggle}
                  className="w-7 h-7 border border-primary/30 hover:border-primary hover:bg-primary/10 flex items-center justify-center transition-all angular-cut"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className="stroke-primary/60 hover:stroke-primary transition-colors">
                    <line x1="1" y1="1" x2="11" y2="11" strokeWidth="1.5" />
                    <line x1="11" y1="1" x2="1" y2="11" strokeWidth="1.5" />
                  </svg>
                </button>
              </div>

              <div
                ref={chatRef}
                className="flex-1 overflow-y-auto p-3 space-y-3 scroll-hide"
              >
                {messages.map((m) =>
                  m.role === 'agent' ? (
                    <div key={m.id} className="chat-bubble-agent">
                      <div className="text-[8px] text-primary/60 mb-1 flex items-center gap-1">
                        <span className="material-symbols-outlined text-[10px]">
                          smart_toy
                        </span>
                        AGENTE_AKRASIA
                      </div>
                      <div className="text-[11px] text-slate-200 leading-relaxed">
                        <FormattedText text={m.text} />
                      </div>
                    </div>
                  ) : (
                    <div key={m.id} className="chat-bubble-user text-right">
                      <div className="text-[8px] text-primary/50 mb-1">TU</div>
                      <div className="text-[11px] text-primary/90 leading-relaxed">
                        {m.text}
                      </div>
                    </div>
                  )
                )}
                {isTyping && (
                  <div className="chat-bubble-agent">
                    <div className="text-[8px] text-primary/60 mb-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[10px]">
                        smart_toy
                      </span>
                      AGENTE_AKRASIA
                    </div>
                    <div className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap">
                      {streamingText ? (
                        <FormattedText text={streamingText} />
                      ) : (
                        <span className="text-primary/40 italic animate-pulse">
                          Escribiendo...
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="p-3 border-t border-white/5">
                <div className="flex gap-3 items-center">
                  <textarea
                    ref={textareaRef}
                    className="flex-1 bg-transparent border border-white/10 focus:ring-0 focus:outline-none text-sm text-primary placeholder:text-primary/30 font-mono px-3 py-2 rounded resize-none leading-5"
                    rows={1}
                    placeholder="Escribe tu mensaje..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    suppressHydrationWarning
                  />
                  <button
                    onClick={handleSend}
                    disabled={isTyping}
                    className="bg-primary text-black px-4 py-2 text-[10px] font-black hover:bg-white transition-all angular-cut uppercase disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Enviar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function ChatHint() {
  const [visible, setVisible] = useState(true);
  const { messages, sendMessage } = useChat();

  useEffect(() => {
    if (messages.length > 1) {
      setVisible(false);
    }
  }, [messages]);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 12000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div
      className="hidden lg:flex absolute bottom-4 left-1/2 -translate-x-1/2 z-[15] items-center gap-2 px-4 py-2 bg-black/40 backdrop-blur-sm border border-primary/20 rounded cursor-pointer hover:border-primary/40 transition-all chat-hint"
      onClick={() => {
        setVisible(false);
        sendMessage('Hola, quiero saber mas sobre Akrasia Studio');
      }}
    >
      <span className="w-2 h-2 bg-primary rounded-full animate-pulse"></span>
      <span className="text-[10px] text-primary/70 uppercase tracking-widest">
        Agente disponible — Haz click para chatear
      </span>
    </div>
  );
}

export default function ChatWrapper() {
  const [desktopRoot, setDesktopRoot] = useState<HTMLElement | null>(null);
  const [mobileChatSlot, setMobileChatSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setDesktopRoot(document.getElementById('chat-desktop-root'));
    setMobileChatSlot(document.getElementById('mobileChatSlot'));
  }, []);

  return (
    <ChatProvider>
      {desktopRoot && createPortal(<ChatDesktop />, desktopRoot)}
      {desktopRoot && createPortal(<ChatHint />, desktopRoot)}
      <MobileChatBtn slot={mobileChatSlot} />
      <MobileChat />
    </ChatProvider>
  );
}
