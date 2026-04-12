import { useState, useRef, useCallback } from 'react';
import { useChat } from '../hooks/ChatContext';

export default function Chat() {
  const { messages, isTyping, streamingText, chatRef, sendMessage } = useChat();
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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
              <div className="text-[11px] text-slate-200 leading-relaxed whitespace-pre-wrap">
                {m.text}
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
              {streamingText || (
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
