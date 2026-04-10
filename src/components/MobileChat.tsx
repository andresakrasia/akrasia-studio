import { useState, useRef, useCallback } from 'react';

const AGENT_WELCOME =
  'Hola. Soy el agente de Akrasia Studio. En que puedo ayudarte?';

const AGENT_RESPONSES = [
  'Entendido. En Akrasia Studio trabajamos con marcas que buscan un impacto visual real.',
  'Nuestra ventaja es que combinamos oficio profesional con tecnologia IA.',
  'Podemos adaptarnos a cualquier formato: spots, videoclips, fashion films...',
  'Para un presupuesto exacto cuentame sobre tu proyecto: formato, duracion, estilo visual.',
  'Nuestro proceso: brief creativo, pre-produccion con IA, produccion, post y entrega.',
];

interface Message {
  id: number;
  role: 'user' | 'agent';
  text: string;
}

export default function MobileChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, role: 'agent', text: AGENT_WELCOME },
  ]);
  const [input, setInput] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  let nextId = useRef(1);

  const toggle = useCallback(() => setOpen((prev) => !prev), []);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg) return;

    const userMsg: Message = { id: nextId.current++, role: 'user', text: msg };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    setTimeout(() => {
      const response =
        AGENT_RESPONSES[Math.floor(Math.random() * AGENT_RESPONSES.length)];
      setMessages((prev) => [
        ...prev,
        { id: nextId.current++, role: 'agent', text: response },
      ]);
      if (chatRef.current)
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }, 800);

    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [input]);

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
      {/* FAB */}
      <button
        className={`lg:hidden fixed bottom-6 right-6 z-[100] w-14 h-14 bg-primary rounded-full flex items-center justify-center shadow-lg shadow-primary/30 hover:scale-110 transition-transform ${open ? 'hidden' : ''}`}
        onClick={toggle}
      >
        <span className="material-symbols-outlined text-black text-2xl">
          forum
        </span>
      </button>

      {/* Overlay */}
      {open && (
        <div className="lg:hidden fixed inset-0 z-[90] flex flex-col">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={toggle} />
          <div className="absolute inset-x-0 bottom-0 top-14 flex flex-col z-10">
            <div className="glass-panel m-2 flex-1 flex flex-col overflow-hidden">
              {/* Header */}
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

              {/* Messages */}
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
              </div>

              {/* Input */}
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
                    className="bg-primary text-black px-4 py-2 text-[10px] font-black hover:bg-white transition-all angular-cut uppercase"
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
