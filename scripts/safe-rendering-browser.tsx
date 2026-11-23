import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import FormattedText from '../src/components/FormattedText';
import ChatWrapper from '../src/components/ChatWrapper';
import { createFeedEntry, createLogEntry } from '../src/lib/activity-dom';
import { CHAT_HISTORY_KEY } from '../src/lib/visitorId';
import { advisoryInput, rawHTMLCases, blockedLinkCases, safeLinks, markdown, historicalName, historicalTopic, storedUser, storedAgent, streamContent, permittedTags, permittedAttributes } from './safe-rendering-cases.mjs';

const byId = (id: string) => document.getElementById(id)!;
const output = byId('results');
const status = byId('status');
const counter = byId('execution-count');
const rerun = byId('rerun') as HTMLButtonElement;
const streamButton = byId('send-stream') as HTMLButtonElement;
const scratch = byId('render-scratch');
const scratchRoot = createRoot(scratch);
const previewRoot = createRoot(byId('markdown-preview'));
const chatRoot = createRoot(byId('chat-harness-root'));
const STORAGE_KEY = CHAT_HISTORY_KEY;
const session = { sessionId: '00000000-0000-4000-8000-000000000003', sessionExpiresAt: Math.floor(Date.now() / 1000) + 3600 };
const memory = new Map<string, string>();
// Neither reads nor writes the person's real browser storage, even on this
// separate localhost origin. Actual ChatContext accesses this synthetic store.
Object.defineProperty(window, 'localStorage', { configurable: true, value: {
  get length() { return memory.size; },
  clear() { memory.clear(); },
  getItem(key: string) { return memory.get(String(key)) ?? null; },
  key(index: number) { return [...memory.keys()][index] ?? null; },
  removeItem(key: string) { memory.delete(String(key)); },
  setItem(key: string, value: string) { memory.set(String(key), String(value)); },
} });
localStorage.setItem('akrasia_lang', 'es');

let executions = 0;
let canaryExecutions = 0;
const blockedNetwork: string[] = [];
const requests: Array<{ path: string; body?: unknown }> = [];
const timers = new Set<number>();
let chatRevision = 0;
let assertions = 0;
let streamingPrefixes = 0;
let streamFrames = 0;
let observedLiveStream = false;
let groups: Array<{ name: string; passed: boolean }> = [];
let streamDOMFailures: string[] = [];
let running = false;

(window as any).__a03Execute = () => {
  executions++;
  counter.textContent = String(executions);
  counter.dataset.testExecutions = String(executions);
};
(window as any).__a03Canary = () => { canaryExecutions++; };
const blocked = (kind: string) => {
  blockedNetwork.push(kind);
  throw new Error(`Synthetic test blocked ${kind}`);
};
Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => { blockedNetwork.push('sendBeacon'); return false; } });
(window as any).WebSocket = class { constructor() { blocked('WebSocket'); } };
(window as any).EventSource = class { constructor() { blocked('EventSource'); } };
XMLHttpRequest.prototype.open = function () { blocked('XMLHttpRequest'); } as typeof XMLHttpRequest.prototype.open;
window.open = (() => { blockedNetwork.push('window.open'); return null; }) as typeof window.open;
document.addEventListener('click', event => {
  const anchor = (event.target as Element).closest?.('a');
  if (!anchor) return;
  const target = new URL(anchor.getAttribute('href') || '', location.href);
  if (target.origin !== location.origin) {
    event.preventDefault();
    blockedNetwork.push(`external navigation ${target.protocol}`);
  }
}, true);

function syntheticSSE(signal?: AbortSignal | null) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const bytes: Uint8Array[] = [];
  // Every Unicode character is a separate SSE event, then network bytes split
  // independently to cover UTF-8 and SSE delimiter boundaries in ChatContext.
  for (const character of streamContent) {
    const event = encoder.encode(`data: ${JSON.stringify({ content: character })}\n\n`);
    const unicode = event.findIndex(byte => byte > 0x7f);
    const boundary = unicode === -1 ? Math.max(1, Math.floor(event.length / 2)) : unicode + 1;
    bytes.push(event.slice(0, boundary), event.slice(boundary));
  }
  bytes.push(encoder.encode('data: [DONE]\n\n'));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = () => {
        if (cancelled) return;
        if (signal?.aborted) { cancelled = true; controller.error(new DOMException('Aborted', 'AbortError')); return; }
        if (offset === bytes.length) { controller.close(); return; }
        controller.enqueue(bytes[offset++]);
        const timer = window.setTimeout(() => { timers.delete(timer); push(); }, 5);
        timers.add(timer);
      };
      push();
    },
    cancel() { cancelled = true; },
  });
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
  if (url.pathname === '/api/visitor-history' && method === 'GET') {
    requests.push({ path: url.pathname });
    return new Response(JSON.stringify({
      ...session,
      conversations: [{ id: 'synthetic-history', created_at: '2026-10-02T00:00:00Z', messages: [{ role: 'user', content: historicalTopic }] }],
      summary: 'Historial sintético para verificar el saludo.', visitorName: historicalName, visitorCompany: null,
    }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }
  if (url.pathname === '/api/chat' && method === 'POST') {
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : request ? await request.json() : null;
    requests.push({ path: url.pathname, body });
    return syntheticSSE(init?.signal || request?.signal);
  }
  return blocked(`unexpected fetch ${url.pathname}`);
};

function ok(condition: unknown, message: string) {
  assertions++;
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, message: string) { ok(actual === expected, `${message} (actual ${String(actual)})`); }
const delay = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));
async function waitFor(condition: () => boolean, message: string, timeout = 10000) {
  const until = Date.now() + timeout;
  while (!condition()) { if (Date.now() > until) throw new Error(message); await delay(20); }
  ok(true, message);
}

function inspect(scope: Element) {
  const anchors: HTMLAnchorElement[] = [];
  for (const element of scope.querySelectorAll('*')) {
    ok(permittedTags.has(element.tagName.toLowerCase()), `Unexpected element ${element.tagName}`);
    for (const attribute of element.attributes) ok(permittedAttributes.has(attribute.name.toLowerCase()), `Unexpected attribute ${attribute.name}`);
    if (element.tagName === 'A') {
      const anchor = element as HTMLAnchorElement;
      const href = anchor.getAttribute('href') || '';
      ok(href && !/[\u0000-\u0020\u007f\\]/u.test(href), 'Navigable URL is explicit and contains no browser-normalized controls');
      const local = /^(?:\/(?!\/)|\.\.?\/|#|\?)/u.test(href);
      if (!local) {
        ok(['http:', 'https:', 'mailto:'].includes(new URL(href).protocol), 'Only allowed protocols become links');
        equal(anchor.target, '_blank', 'External link opens safely');
        ok(anchor.relList.contains('noopener') && anchor.relList.contains('noreferrer'), 'External link denies opener and referrer');
        equal(anchor.referrerPolicy, 'no-referrer', 'External link policy is safe');
      }
      anchors.push(anchor);
    }
  }
  equal(executions, 0, 'No malicious execution marker activated');
  return anchors;
}
function render(text: string) { flushSync(() => scratchRoot.render(<FormattedText text={text} />)); return scratch; }
function inspectChat() {
  for (const content of document.querySelectorAll('.chat-bubble-agent .formatted-text')) inspect(content);
  for (const content of document.querySelectorAll('.chat-bubble-user')) {
    ok(!content.querySelector('img,svg,script,iframe,object,embed,a'), 'User content remains escaped React text');
  }
  equal(executions, 0, 'Chat execution marker is zero');
}
function remountChat(stored: unknown) {
  flushSync(() => chatRoot.render(null));
  if (stored === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...session, messages: stored }));
  flushSync(() => chatRoot.render(<ChatWrapper key={++chatRevision} />));
}
function streamMessage() {
  document.dispatchEvent(new CustomEvent('chat-trigger', { detail: { message: `Prueba SSE sintética ${storedUser}` } }));
}
async function group(name: string, test: () => void | Promise<void>) {
  try { await test(); groups.push({ name, passed: true }); }
  catch (error) { groups.push({ name, passed: false }); throw error; }
  output.textContent = groups.map((entry, index) => `${entry.passed ? 'PASS' : 'FAIL'} ${index + 1} · ${entry.name}`).join('\n');
}

const observer = new MutationObserver(() => {
  try {
    inspectChat();
    const content = [...document.querySelectorAll('.chat-bubble-agent .formatted-text')].map(element => element.textContent || '').join('\n');
    if (content.includes('Flujo SSE sintético') && !content.includes('Final á€🙂.')) { observedLiveStream = true; streamFrames++; }
  } catch (error) { streamDOMFailures.push(String(error)); }
});
observer.observe(byId('chat-desktop-root'), { subtree: true, childList: true, characterData: true, attributes: true });
observer.observe(byId('chat-harness-root'), { subtree: true, childList: true, characterData: true, attributes: true });

async function run() {
  if (running) return;
  running = true;
  rerun.disabled = true;
  streamButton.disabled = true;
  assertions = 0; streamingPrefixes = 0; streamFrames = 0; observedLiveStream = false; groups = []; streamDOMFailures = [];
  requests.length = 0; blockedNetwork.length = 0;
  status.textContent = 'Ejecutando pruebas…';
  output.textContent = '';
  let failure: string | null = null;
  try {
    await group('El canario de eventos confirma que CSP no oculta XSS', () => {
      const before = canaryExecutions;
      const canary = document.createElement('button');
      canary.setAttribute('onclick', 'window.__a03Canary()');
      scratch.append(canary); canary.click(); canary.remove();
      equal(canaryExecutions, before + 1, 'Inline event positive control executes');
      equal(executions, 0, 'Malicious marker remains zero');
    });
    await group('Markdown legítimo, tablas, saltos y listas de tareas', () => {
      const scope = render(markdown);
      inspect(scope);
      for (const selector of ['h1', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'br', 'table', 'thead', 'tbody', 'th', 'td', 'hr']) ok(scope.querySelector(selector), `Markdown keeps ${selector}`);
      const tasks = render('- [x] Done\n- [ ] Next').textContent || '';
      equal((tasks.match(/☑/g) || []).length, 1, 'Checked marker appears once');
      equal((tasks.match(/☐/g) || []).length, 1, 'Unchecked marker appears once');
      flushSync(() => previewRoot.render(<FormattedText text={markdown} />));
    });
    await group('HTML, eventos, SVG, mathML, embeds y entidades quedan como texto', async () => {
      for (const [name, payload] of rawHTMLCases) {
        const scope = render(payload); inspect(scope);
        ok((scope.textContent || '').includes(name === 'Markdown image' ? 'untrusted image' : '__a03Execute'), `${name} remains visible as text`);
      }
      await delay(30);
      equal(executions, 0, 'Events did not execute asynchronously');
    });
    await group('Protocolos ejecutables y ofuscados no generan enlaces', () => {
      for (const [name, payload] of blockedLinkCases) equal(inspect(render(payload)).length, 0, `${name} is not navigable`);
    });
    await group('Destinos permitidos y atributos seguros de enlaces externos', () => {
      for (const [name, href] of safeLinks) {
        const anchors = inspect(render(`[${name}](${href})`));
        equal(anchors.length, 1, `${name} link preserved`);
        equal(anchors[0].getAttribute('href'), href, `${name} destination preserved`);
      }
      const scope = render('[safe](https://example.test "onmouseover=window.__a03Execute()")');
      inspect(scope);
      ok(!scope.querySelector('[onmouseover]'), 'Title is never an event attribute');
      const references = inspect(render('[Referencia][ref]\n\n[ref]: https://example.test/reference "Título con espacios"\n\nhttps://example.test/autolink y synthetic@example.test'));
      equal(references.length, 3, 'Reference and HTTP/email autolinks remain usable');
      equal(references[0].title, 'Título con espacios', 'Reference title preserved');
      const quoted = render('[safe](https://example.test "&quot; onmouseover=&quot;window.__a03Execute()")');
      inspect(quoted);
      ok(!quoted.querySelector('[onmouseover]'), 'Entity quotes stay inside title');
    });
    await group('Cada prefijo de streaming mantiene DOM seguro', () => {
      for (const [, payload] of [...rawHTMLCases, ...blockedLinkCases, ['SSE', streamContent]]) for (let end = 0; end <= payload.length; end++) {
        inspect(render(payload.slice(0, end))); streamingPrefixes++;
      }
      ok(streamingPrefixes > 1000, 'Every short partial prefix is covered');
      inspect(render(advisoryInput));
    });
    await group('Feed y logs reales crean nodos de texto con apariencia y niveles', () => {
      const container = byId('activity-preview'); container.replaceChildren();
      for (const [name, payload] of rawHTMLCases) {
        const feed = createFeedEntry({ text: payload, project_title: payload, level: 'high' }, '<time>');
        equal(feed.textContent, `<time>[${payload}] ${payload}`, `${name} feed literal`);
        const log = createLogEntry({ text: payload, log_type: 'warning' }, '12:34:56');
        equal(log.textContent, `[12:34:56] AVISO: ${payload}`, `${name} log literal`);
        container.append(feed, log); inspect(container);
      }
      // Keep a readable preview after verifying all synthetic hostile rows.
      container.replaceChildren(
        createFeedEntry({ text: historicalTopic, project_title: '<Proyecto sintético>', level: 'high' }, '12:34'),
        createLogEntry({ text: historicalName, log_type: 'success' }, '12:34:56'),
      );
      inspect(container);
      equal(createLogEntry({ text: 'default', log_type: '__proto__' }, '12:34:56').textContent, '[12:34:56] CORE: default', 'Unknown log type keeps default label');
    });
    await group('ChatContext incorpora historial malicioso sin ejecutar HTML', async () => {
      remountChat(null);
      await waitFor(() => (byId('chat-desktop-root').textContent || '').includes(historicalTopic), 'Returning visitor greeting incorporates synthetic topic');
      const greeting = byId('chat-desktop-root').textContent || '';
      ok(greeting.includes(historicalName), 'Returning greeting incorporates synthetic visitor name');
      inspectChat();
      equal(requests.filter(request => request.path === '/api/visitor-history').length, 1, 'Actual ChatContext requested only synthetic history');
    });
    await group('ChatWrapper protege agente guardado y conserva usuario literal', async () => {
      const historyRequests = requests.length;
      remountChat([{ id: 1, role: 'user', text: storedUser }, { id: 2, role: 'agent', text: storedAgent }]);
      await waitFor(() => Boolean(document.querySelector('.chat-bubble-user')), 'Stored user appears in real desktop chat');
      const user = document.querySelector('.chat-bubble-user')!;
      ok((user.textContent || '').includes(storedUser), 'User Markdown and HTML are literal React text');
      ok(!user.querySelector('strong,img,svg'), 'User input is not interpreted as Markdown or HTML');
      inspectChat();
      await delay(40);
      equal(requests.length, historyRequests + 1, 'Stored multi-message history first verifies its signed server session');
    });
    await group('SSE real y UTF-8 fragmentado son seguros durante y después del flujo', async () => {
      streamMessage();
      await waitFor(() => (byId('chat-desktop-root').textContent || '').includes('Final á€🙂.'), 'Actual ChatContext completes synthetic SSE');
      await waitFor(() => !document.querySelector('#chat-desktop-root textarea')?.closest('div')?.parentElement?.querySelector('button:disabled'), 'Chat input becomes usable again');
      ok(observedLiveStream && streamFrames > 1, 'Browser observed safe incremental rendering before the final message');
      equal(streamDOMFailures.length, 0, 'Mutation observer found no unsafe partial DOM');
      inspectChat();
      equal(requests.filter(request => request.path === '/api/chat').length, 1, 'Exactly one synthetic chat POST');
    });
    await group('Enlace local y contador de ejecución funcionan', () => {
      const link = byId('markdown-preview').querySelector('a[href="#a03-local-target"]') as HTMLAnchorElement;
      ok(link, 'Local Markdown link exists');
      link.click();
      equal(location.hash, '#a03-local-target', 'Local link reaches its target in the same page');
      equal(executions, 0, 'All malicious markers remain zero');
      equal(blockedNetwork.length, 0, 'No component attempted an external or unexpected network call');
    });
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  const result = { passed: !failure, assertions, groups, streamingPrefixes, streamFrames, executions, canaryExecutions, syntheticHistoryRequests: requests.filter(request => request.path === '/api/visitor-history').length, syntheticChatRequests: requests.filter(request => request.path === '/api/chat').length, blockedNetwork: blockedNetwork.length, streamDOMFailures, failure };
  (window as any).__a03Result = result;
  output.textContent = `${groups.map((entry, index) => `${entry.passed ? 'PASS' : 'FAIL'} ${index + 1} · ${entry.name}`).join('\n')}\n\n${JSON.stringify(result, null, 2)}`;
  output.dataset.testPassed = String(!failure);
  output.dataset.testAssertions = String(assertions);
  output.dataset.testPrefixes = String(streamingPrefixes);
  output.dataset.testStreamFrames = String(streamFrames);
  status.textContent = failure ? `FALLO: ${failure}` : `PASS · ${groups.length} grupos · ${streamingPrefixes} prefijos · ${streamFrames} actualizaciones SSE.`;
  rerun.disabled = false;
  streamButton.disabled = false;
  running = false;
}

rerun.addEventListener('click', () => void run());
streamButton.addEventListener('click', streamMessage);
byId('open-mobile').addEventListener('click', () => document.dispatchEvent(new CustomEvent('chat-trigger', { detail: { message: '' } })));
window.addEventListener('beforeunload', () => { for (const timer of timers) clearTimeout(timer); observer.disconnect(); });
void run();
