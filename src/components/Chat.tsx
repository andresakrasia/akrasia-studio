import { useState, useRef, useEffect, useCallback } from 'react';

const AGENT_RESPONSES = [
  'Entendido. En Akrasia Studio trabajamos con marcas que buscan un impacto visual real. Puedo prepararte una propuesta personalizada si me das mas detalles.',
  'Buena pregunta. Nuestra ventaja es que combinamos oficio profesional con tecnologia IA, lo que nos permite entregar resultados de alto nivel en tiempos y presupuestos ajustados.',
  'Podemos adaptarnos a cualquier formato: spots, videoclips, fashion films, cortos experimentales... Todo con la estética cinematográfica que nos define.',
  'Si quieres, puedo mostrarte ejemplos de nuestro portfolio reciente. Tenemos piezas en NEON ODYSSEY, CITY PULSE y VOID FRAGMENTS que te pueden dar una idea clara.',
  'Para un presupuesto exacto necesito saber: formato, duracion estimada, estilo visual y fecha limite. Con esos datos te lo preparo en minutos.',
  'Nuestro proceso es sencillo: brief creativo, pre-produccion con IA, produccion, post y entrega. Todo supervisado por profesionales del sector.',
];

const AGENT_WELCOME =
  'Hola. Soy el agente de Akrasia Studio. Estoy aqui para ayudarte con informacion sobre nuestros servicios, presupuestos o cualquier consulta. Que necesitas?';

interface Message {
  id: number;
  role: 'user' | 'agent';
  text: string;
}

export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([
    { id: 0, role: 'agent', text: AGENT_WELCOME },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  let nextId = useRef(1);

  const scrollToBottom = useCallback(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg) return;

    const userMsg: Message = { id: nextId.current++, role: 'user', text: msg };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
    setIsTyping(true);

    setTimeout(() => {
      const response =
        AGENT_RESPONSES[Math.floor(Math.random() * AGENT_RESPONSES.length)];
      const agentMsg: Message = {
        id: nextId.current++,
        role: 'agent',
        text: response,
      };
      setMessages((prev) => [...prev, agentMsg]);
      setIsTyping(false);
    }, 800);
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
            <div className="text-[11px] text-primary/40 italic animate-pulse">
              Escribiendo...
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
            className="bg-primary/10 border border-primary/40 text-primary px-6 py-2 text-[10px] font-black hover:bg-primary hover:text-black transition-all angular-cut uppercase tracking-wider"
          >
            Enviar
          </button>
        </div>
      </div>
    </>
  );
}
