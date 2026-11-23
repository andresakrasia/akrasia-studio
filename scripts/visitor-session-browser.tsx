import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChatProvider, useChat, type Message } from '../src/hooks/ChatContext';
import { CHAT_HISTORY_KEY, type VerifiedChatSession } from '../src/lib/visitorId';

const root = createRoot(document.getElementById('conversation')!);
const output = document.getElementById('results')!;
const status = document.getElementById('status')!;
const rerun = document.getElementById('rerun') as HTMLButtonElement;
const memory = new Map<string, string>();
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  get length() { return memory.size; }, clear() { memory.clear(); },
  getItem(key: string) { return memory.get(String(key)) ?? null; },
  key(index: number) { return [...memory.keys()][index] ?? null; },
  removeItem(key: string) { memory.delete(String(key)); },
  setItem(key: string, value: string) { memory.set(String(key), String(value)); },
} });
localStorage.setItem('akrasia_lang', 'es');

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const expiry = () => Math.floor(Date.now() / 1000) + 3600;
let serverSession: VerifiedChatSession = { sessionId: A, sessionExpiresAt: expiry(), contextVersion: 0 };
let responseSession: VerifiedChatSession | null = null;
let historyErrors = 0;
let chatError = false;
let historyGate: Promise<void> | null = null;
let releaseHistory: (() => void) | null = null;
let slowStream = false;
let expireToB = false;
let revision = 0;
let assertions = 0;
let groups: Array<{ name: string; passed: boolean }> = [];
let running = false;
const requests: Array<{ path: string; query: string; cache?: RequestCache; credentials?: RequestCredentials; body?: any }> = [];
const blockedNetwork: string[] = [];
const blocked = (name: string): never => { blockedNetwork.push(name); throw new Error(`Synthetic test blocked ${name}`); };
Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => { blockedNetwork.push('sendBeacon'); return false; } });
(window as any).WebSocket = class { constructor() { blocked('WebSocket'); } };
(window as any).EventSource = class { constructor() { blocked('EventSource'); } };
XMLHttpRequest.prototype.open = function () { blocked('XMLHttpRequest'); } as typeof XMLHttpRequest.prototype.open;
window.open = (() => { blockedNetwork.push('window.open'); return null; }) as typeof window.open;

function syntheticSSE(session: VerifiedChatSession, signal?: AbortSignal | null) {
  const encoder = new TextEncoder();
  const content = session.sessionId === A ? 'REPLY_A_SYNTHETIC' : 'REPLY_B_SYNTHETIC';
  const body = slowStream ? new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content: 'PARTIAL_A_SYNTHETIC' })}\n\n`));
    const timer = window.setTimeout(() => {
      if (signal?.aborted) return;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ content })}\n\ndata: [DONE]\n\n`)); controller.close();
    }, 2500);
    signal?.addEventListener('abort', () => { clearTimeout(timer); controller.error(new DOMException('Aborted', 'AbortError')); }, { once: true });
  } }) : encoder.encode(`data: ${JSON.stringify({ content })}\n\ndata: [DONE]\n\n`);
  return new Response(body, { headers: {
    'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store',
    'X-Chat-Session-Id': session.sessionId, 'X-Chat-Session-Expires': String(session.sessionExpiresAt),
  } });
}

window.fetch = async (input, init) => {
  const request = input instanceof Request ? input : null;
  const url = new URL(request ? request.url : String(input), location.href);
  if (url.origin !== location.origin) return blocked('external fetch');
  const method = init?.method || request?.method || 'GET';
  const record = { path: url.pathname, query: url.search, cache: init?.cache, credentials: init?.credentials };
  if (url.pathname === '/api/visitor-history' && method === 'GET') {
    requests.push(record);
    if (historyGate) await historyGate;
    if (historyErrors > 0) {
      historyErrors--;
      return new Response(JSON.stringify({ error: 'invalid_chat_session' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    if (expireToB && serverSession.sessionExpiresAt * 1000 <= Date.now()) {
      serverSession = { sessionId: B, sessionExpiresAt: expiry(), contextVersion: 0 }; expireToB = false;
    }
    const tag = serverSession.sessionId === A ? 'A' : 'B';
    return new Response(JSON.stringify({
      ...serverSession, conversations: [{ id: `synthetic-${tag}`, created_at: '2026-10-02T00:00:00Z', messages: [{ role: 'user', content: `TOPIC_${tag}_SYNTHETIC` }] }],
      summary: null, visitorName: `NAME_${tag}_SYNTHETIC`, visitorCompany: null,
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/api/chat' && method === 'POST') {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : request ? await request.json() : null;
    requests.push({ ...record, body });
    if (chatError) {
      chatError = false;
      serverSession = { sessionId: B, sessionExpiresAt: expiry(), contextVersion: 0 };
      return new Response(JSON.stringify({ error: 'invalid_chat_session' }), { status: 401, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    }
    const responding = responseSession || serverSession;
    responseSession = null;
    serverSession = responding;
    return syntheticSSE(responding, init?.signal || request?.signal);
  }
  return blocked(`unexpected fetch ${url.pathname}`);
};

function ChatHarness() {
  const { messages, isTyping, streamingText, sendMessage, clearHistory } = useChat();
  return <>
    <div id="messages">{messages.map(message => <div key={message.id} data-role={message.role}>{message.text}</div>)}</div>
    <div id="stream">{streamingText}</div>
    <form onSubmit={event => { event.preventDefault(); const field = event.currentTarget.elements.namedItem('message') as HTMLTextAreaElement; void sendMessage(field.value); field.value = ''; }}>
      <textarea name="message" aria-label="Mensaje sintético" disabled={isTyping} />
      <button id="send" type="submit" disabled={isTyping}>Enviar mensaje sintético</button>
      <button id="clear" type="button" onClick={clearHistory}>Limpiar vista</button>
    </form>
  </>;
}
const shown = () => document.getElementById('messages')?.textContent || '';
const posts = () => requests.filter(request => request.path === '/api/chat');
const histories = () => requests.filter(request => request.path === '/api/visitor-history');
const cached = () => JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY) || 'null');
const delay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
function ok(condition: unknown, message: string) { assertions++; if (!condition) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message: string) { ok(actual === expected, `${message} (actual ${String(actual)})`); }
async function waitFor(condition: () => boolean, message: string, timeout = 7000) {
  const until = Date.now() + timeout;
  while (!condition()) { if (Date.now() > until) throw new Error(message); await delay(10); }
  ok(true, message);
}
function store(session: VerifiedChatSession, messages: Message[]) { localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify({ version: 2, ...session, messages })); }
function holdHistory() { historyGate = new Promise(resolve => { releaseHistory = resolve; }); }
function release() { const unblock = releaseHistory; historyGate = null; releaseHistory = null; unblock?.(); }
function remount() {
  flushSync(() => root.render(null));
  flushSync(() => root.render(<ChatProvider key={++revision}><ChatHarness /></ChatProvider>));
}
async function send(text: string) {
  await waitFor(() => !(document.getElementById('send') as HTMLButtonElement).disabled, 'Input is ready');
  const before = posts().length;
  (document.querySelector('textarea') as HTMLTextAreaElement).value = text;
  (document.getElementById('send') as HTMLButtonElement).click();
  await waitFor(() => posts().length === before + 1, 'Exactly one synthetic POST starts');
  await waitFor(() => !(document.getElementById('send') as HTMLButtonElement).disabled, 'Input is restored after response');
}
async function group(name: string, test: () => void | Promise<void>) {
  try { await test(); groups.push({ name, passed: true }); } catch (error) { groups.push({ name, passed: false }); throw error; }
  output.textContent = groups.map((entry, index) => `${entry.passed ? 'PASS' : 'FAIL'} ${index + 1} · ${entry.name}`).join('\n');
}

async function run() {
  if (running) return;
  running = true; rerun.disabled = true;
  flushSync(() => root.render(null));
  memory.clear(); localStorage.setItem('akrasia_lang', 'es');
  assertions = 0; groups = []; requests.length = 0; blockedNetwork.length = 0;
  historyErrors = 0; chatError = false; slowStream = false; expireToB = false; responseSession = null;
  serverSession = { sessionId: A, sessionExpiresAt: expiry(), contextVersion: 0 };
  status.textContent = 'Ejecutando comprobaciones…';
  let failure: string | null = null;
  try {
    await group('UUID, cookie e historial antiguos no recuperan datos', async () => {
      localStorage.setItem('akrasia_visitor_id', B); localStorage.setItem('akrasia_vid', B);
      localStorage.setItem('akrasia_chat_history', JSON.stringify([{ id: 2, role: 'agent', text: 'LEGACY_PRIVATE_B' }]));
      document.cookie = `akrasia_vid=${B}; Path=/; SameSite=Lax`;
      holdHistory(); remount();
      await waitFor(() => histories().length === 1, 'Server identity is requested');
      ok(!shown().includes('LEGACY_PRIVATE_B'), 'Legacy private text is never rendered');
      for (const key of ['akrasia_visitor_id', 'akrasia_vid', 'akrasia_chat_history']) equal(localStorage.getItem(key), null, `Legacy ${key} is removed`);
      ok(!document.cookie.includes('akrasia_vid='), 'Legacy public cookie is removed');
      release(); await waitFor(() => shown().includes('NAME_A_SYNTHETIC'), 'Own returning greeting appears');
      ok(shown().includes('TOPIC_A_SYNTHETIC'), 'Own returning topic appears even without summary');
      await waitFor(() => cached()?.sessionId === A, 'Verified display cache is saved after the React update');
      equal(cached().sessionId, A, 'Display cache is tied to verified A');
    });
    await group('La caché propia espera verificación antes de mostrarse', async () => {
      store(serverSession, [{ id: 1, role: 'user', text: 'LOCAL_A_SYNTHETIC' }, { id: 2, role: 'agent', text: 'LOCAL_REPLY_A_SYNTHETIC' }]);
      const before = histories().length; holdHistory(); remount();
      await waitFor(() => histories().length === before + 1, 'Stored conversation verifies cookie');
      ok(!shown().includes('LOCAL_A_SYNTHETIC'), 'Local personal history stays hidden while waiting');
      release(); await waitFor(() => shown().includes('LOCAL_A_SYNTHETIC'), 'Verified A recovers its own local conversation');
    });
    await group('Una caché B no aparece bajo sesión A', async () => {
      store({ sessionId: B, sessionExpiresAt: serverSession.sessionExpiresAt, contextVersion: 0 }, [{ id: 1, role: 'user', text: 'PRIVATE_B_SYNTHETIC' }, { id: 2, role: 'agent', text: 'SECRET_B_SYNTHETIC' }]);
      remount(); await waitFor(() => shown().includes('NAME_A_SYNTHETIC'), 'Server A restores A greeting');
      ok(!shown().includes('PRIVATE_B_SYNTHETIC') && !shown().includes('SECRET_B_SYNTHETIC'), 'Mismatched history is absent');
      equal(cached().sessionId, A, 'Mismatched cache is replaced under current A');
    });
    await group('Cada POST contiene solo la entrada actual, sin identidad ni contexto personal', async () => {
      await send('CURRENT_A_SYNTHETIC_1');
      await waitFor(() => shown().includes('REPLY_A_SYNTHETIC'), 'Own synthetic SSE response is displayed');
      const request = posts()[posts().length - 1];
      const { operation_id, language, ...payload } = request.body;
      ok(/^[a-f0-9-]{36}$/i.test(operation_id), 'Payload contains an operation UUID for safe retries');
      equal(language, 'es', 'Explicit page language is sent');
      equal(JSON.stringify(payload), JSON.stringify({ messages: [{ role: 'user', content: 'CURRENT_A_SYNTHETIC_1' }], context_version: 0 }), 'Payload has exactly current user text without client identity');
      equal(request.cache, 'no-store', 'POST cannot use browser cache');
      equal(request.credentials, 'same-origin', 'POST uses same-origin session cookie');
      equal(cached().sessionId, A, 'Message is persisted only under A');
    });
    await group('El retorno mantiene la conversación verificada de A', async () => {
      remount(); await waitFor(() => shown().includes('CURRENT_A_SYNTHETIC_1'), 'Current session recovers earlier exchange');
      ok(shown().includes('REPLY_A_SYNTHETIC'), 'Own completed response is preserved');
    });
    await group('Cambio de cookie al recuperar foco limpia A antes de usar B', async () => {
      serverSession = { sessionId: B, sessionExpiresAt: expiry(), contextVersion: 0 };
      window.dispatchEvent(new Event('focus'));
      await waitFor(() => shown().includes('NAME_B_SYNTHETIC'), 'Focus verifies changed B session');
      ok(!shown().includes('CURRENT_A_SYNTHETIC_1') && !shown().includes('NAME_A_SYNTHETIC'), 'A messages and greeting are gone');
      equal(cached().sessionId, B, 'Cache now belongs to B');
      await send('CURRENT_B_SYNTHETIC_1');
      const body = JSON.stringify(posts()[posts().length - 1].body);
      ok(!body.includes('NAME_') && !body.includes('TOPIC_') && !body.includes('CURRENT_A'), 'No previous identity or personal context is sent');
    });
    await group('Cookie manipulada o caducada: limpia y reobtiene una sola vez', async () => {
      const before = histories().length; historyErrors = 1;
      serverSession = { sessionId: A, sessionExpiresAt: expiry(), contextVersion: 0 };
      remount(); await waitFor(() => shown().includes('NAME_A_SYNTHETIC'), 'After rejected cookie a new verified A session appears');
      equal(histories().length, before + 2, 'Only one GET retry follows 401');
      ok(!shown().includes('CURRENT_B_SYNTHETIC_1'), 'Former B private history stays absent');
      historyErrors = 2; const beforeInvalid = histories().length;
      remount(); await waitFor(() => histories().length === beforeInvalid + 2, 'Persistent invalid session is retried once');
      await delay(50); equal(histories().length, beforeInvalid + 2, 'No infinite invalid-cookie retry');
      equal(localStorage.getItem(CHAT_HISTORY_KEY), null, 'Invalid session purges private cache');
      ok(!shown().includes('NAME_A_SYNTHETIC'), 'Invalid session has only public welcome');
    });
    await group('401 del POST no repite el mensaje y renueva sin mezclar datos', async () => {
      remount(); await waitFor(() => shown().includes('NAME_A_SYNTHETIC'), 'A is valid before rejected POST');
      const before = posts().length; chatError = true;
      await send('REJECTED_A_SYNTHETIC');
      equal(posts().length, before + 1, 'Rejected POST is not replayed');
      equal(cached().sessionId, B, 'Renewed identity B owns subsequent display cache');
      ok(!shown().includes('REJECTED_A_SYNTHETIC') && !shown().includes('NAME_A_SYNTHETIC'), 'Rejected A and previous A greeting are removed');
      ok(shown().includes('NAME_B_SYNTHETIC'), 'New own returning B greeting is kept');
    });
    await group('Headers de una respuesta rotada separan la conversación nueva', async () => {
      responseSession = { sessionId: A, sessionExpiresAt: expiry(), contextVersion: 0 };
      await send('ROTATED_CURRENT_SYNTHETIC');
      await waitFor(() => shown().includes('REPLY_A_SYNTHETIC'), 'Rotated A response completes');
      ok(!shown().includes('NAME_B_SYNTHETIC') && !shown().includes('CURRENT_B_SYNTHETIC_1'), 'B greeting and messages are removed');
      ok(shown().includes('ROTATED_CURRENT_SYNTHETIC'), 'Only the current submitted message survives rotation');
      equal(cached().sessionId, A, 'Rotated response is cached under A');
    });
    await group('Caducidad durante SSE aborta y no guarda contenido de la sesión anterior', async () => {
      serverSession = { sessionId: A, sessionExpiresAt: Math.floor(Date.now() / 1000) + 2, contextVersion: 0 };
      localStorage.removeItem(CHAT_HISTORY_KEY); remount();
      await waitFor(() => shown().includes('NAME_A_SYNTHETIC'), 'Short synthetic A session is verified');
      slowStream = true; expireToB = true;
      (document.querySelector('textarea') as HTMLTextAreaElement).value = 'EXPIRING_A_SYNTHETIC';
      (document.getElementById('send') as HTMLButtonElement).click();
      await waitFor(() => document.getElementById('stream')?.textContent?.includes('PARTIAL_A_SYNTHETIC') || false, 'Own partial response is shown while valid');
      await waitFor(() => shown().includes('NAME_B_SYNTHETIC'), 'Expiry timer renews to B');
      await waitFor(() => !(document.getElementById('send') as HTMLButtonElement).disabled, 'Aborted request releases input');
      equal(document.getElementById('stream')?.textContent, '', 'Expired partial stream is removed');
      ok(!shown().includes('EXPIRING_A_SYNTHETIC') && !shown().includes('REPLY_A_SYNTHETIC'), 'Expired A transcript is absent');
      equal(cached().sessionId, B, 'No old response is saved under renewed B');
      slowStream = false;
    });
    await group('Historial privado no usa query ni caché y no produce conexiones externas', () => {
      for (const request of histories()) {
        equal(request.query, '', 'History URL never selects a UUID');
        equal(request.cache, 'no-store', 'History fetch bypasses cache');
        equal(request.credentials, 'same-origin', 'History fetch carries only same-origin cookie');
      }
      equal(blockedNetwork.length, 0, 'No external integrations were attempted');
    });
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  release();
  const result = { passed: !failure, assertions, groups, syntheticHistoryRequests: histories().length, syntheticChatRequests: posts().length, blockedNetwork: blockedNetwork.length, failure };
  (window as any).__a04Result = result;
  output.textContent = `${groups.map((entry, index) => `${entry.passed ? 'PASS' : 'FAIL'} ${index + 1} · ${entry.name}`).join('\n')}\n\n${JSON.stringify(result, null, 2)}`;
  output.dataset.testPassed = String(!failure); output.dataset.testAssertions = String(assertions);
  status.textContent = failure ? `FALLO: ${failure}` : `PASS · ${groups.length} grupos · ${assertions} aserciones · sin conexiones externas.`;
  rerun.disabled = false; running = false;
}
rerun.addEventListener('click', () => void run());
void run();

