import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ChatProvider, useChat } from '../src/hooks/ChatContext';
import { ChatDesktop, ChatPrivacyControl } from '../src/components/ChatWrapper';
import { CHAT_ERASURE_KEY, CHAT_HISTORY_KEY, recordErasure, type VerifiedChatSession } from '../src/lib/visitorId';
import { addCivilDays, madridDateKey } from '../src/lib/civil-time';
import { guidedBookingMessage } from '../src/lib/booking-guide';

const root = createRoot(document.getElementById('conversation')!);
const status = document.getElementById('status')!;
const output = document.getElementById('results')!;
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const expiry = () => Math.floor(Date.now() / 1000) + 3600;
let session: VerifiedChatSession = { sessionId: A, sessionExpiresAt: expiry(), contextVersion: 0 };
const SERVER_KEY = 'akrasia_a09_synthetic_server';
function shareSession() { try { localStorage.setItem(SERVER_KEY, JSON.stringify(session)); } catch {} }
function readServer() { try { const saved = JSON.parse(localStorage.getItem(SERVER_KEY) || 'null'); if (saved?.sessionId === A && Number.isSafeInteger(saved.contextVersion)) session = saved; } catch {} }
let eraseError = false;
let eraseBusy = false;
let malformed = false;
let held = false;
let holdHistory = false;
let releaseHistory: (() => void) | null = null;
let holdEraseResponse = false;
let releaseEraseResponse: (() => void) | null = null;
let finishStream: (() => void) | null = null;
let aborts = 0;
let assertions = 0;
let revision = 0;
let requests: Array<{ method: string; body: any; csrf: string | null; credentials?: RequestCredentials; cache?: RequestCache }> = [];
const retained = { bookings: ['fictitious-booking-A'], quotas: 7, externalNotifications: ['fictitious-notification-A'] };
const beforeRetained = JSON.stringify(retained);
const blockedNetwork: string[] = [];
let groups: Array<{ name: string; passed: boolean }> = [];
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const csrf = () => `synthetic-csrf-${session.sessionId}-${session.contextVersion}`;
const blocked = (name: string): never => { blockedNetwork.push(name); throw new Error(`External network blocked: ${name}`); };
Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: () => { blockedNetwork.push('beacon'); return false; } });
(window as any).WebSocket = class { constructor() { blocked('WebSocket'); } };
(window as any).EventSource = class { constructor() { blocked('EventSource'); } };
XMLHttpRequest.prototype.open = function () { blocked('XHR'); } as typeof XMLHttpRequest.prototype.open;
window.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.origin !== location.origin) return blocked('fetch');
  const method = init?.method || 'GET';
  readServer();
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
  const headers = new Headers(init?.headers);
  requests.push({ method, body, csrf: headers.get('X-Chat-CSRF'), credentials: init?.credentials, cache: init?.cache });
  if (url.pathname === '/api/bookings' && method === 'GET') {
    const dateFrom = url.searchParams.get('date_from')!;
    const dateTo = url.searchParams.get('date_to')!;
    const date = addCivilDays(madridDateKey(), 1);
    return new Response(JSON.stringify({ date_from: dateFrom, date_to: dateTo, time_zone: 'Europe/Madrid', duration_min: 30, available_slots: date >= dateFrom && date <= dateTo ? [{ date, time: '12:00', formatted: 'Horario ficticio de videollamada' }] : [] }), { headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname === '/api/visitor-history' && method === 'GET') {
    if (holdHistory) await new Promise<void>(resolve => { releaseHistory = () => { holdHistory = false; resolve(); }; });
    return new Response(JSON.stringify({ ...session, csrfToken: csrf(), conversations: [], summary: null, visitorName: null, visitorCompany: null }), { headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname === '/api/visitor-history' && method === 'DELETE') {
    await delay(25);
    if (eraseError) return new Response(JSON.stringify({ error: 'chat_unavailable' }), { status: 503 });
    if (eraseBusy) return new Response(JSON.stringify({ error: 'chat_busy', retry_after: 2 }), { status: 409, headers: { 'Retry-After': '2' } });
    if (headers.get('X-Chat-CSRF') !== csrf() || body.contextVersion !== session.contextVersion) return new Response(JSON.stringify({ error: 'invalid_request' }), { status: 403 });
    if (malformed) return new Response(JSON.stringify({ deleted: true, sessionId: B, sessionExpiresAt: expiry(), contextVersion: session.contextVersion + 1, csrfToken: 'bad', scope: 'chat_and_derived_profile' }));
    session = { ...session, contextVersion: session.contextVersion + 1 };
    shareSession();
    const result = JSON.stringify({ ...session, deleted: true, csrfToken: csrf(), scope: 'chat_and_derived_profile', retained: ['bookings', 'external_notifications', 'quota_security'] });
    if (holdEraseResponse) await new Promise<void>(resolve => { releaseEraseResponse = () => { holdEraseResponse = false; resolve(); }; });
    return new Response(result, { headers: { 'content-type': 'application/json' } });
  }
  if (url.pathname === '/api/chat' && method === 'POST') {
    const responseSession = { ...session };
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      let closed = false;
      controller.enqueue(encoder.encode('data: {"content":"PRIVATE_STREAM_A09"}\n\n'));
      const finish = () => { if (closed) return; closed = true; controller.enqueue(encoder.encode('data: {"content":"_LATE_A09"}\n\ndata: [DONE]\n\n')); controller.close(); finishStream = null; };
      init?.signal?.addEventListener('abort', () => { if (!closed) { aborts++; closed = true; controller.error(new DOMException('Aborted', 'AbortError')); } }, { once: true });
      if (held) finishStream = finish; else finish();
    } });
    return new Response(stream, { headers: { 'content-type': 'text/event-stream', 'x-chat-session-id': responseSession.sessionId, 'x-chat-session-expires': String(responseSession.sessionExpiresAt), 'x-chat-context-version': String(responseSession.contextVersion) } });
  }
  return blocked(`unexpected ${method} ${url.pathname}`);
};

function Harness({ name }: { name: string }) {
  const { messages, isTyping, isDeleting, streamingText, sendMessage, requestBooking, bookingContextKey } = useChat();
  const [showGuideDemo, setShowGuideDemo] = useState(false);
  return <section data-tab={name}><h2>Pestaña ficticia {name}</h2><ChatPrivacyControl /><div data-messages>{messages.map(message => <p key={message.id}>{message.text}</p>)}</div><p data-stream>{streamingText}</p><output data-booking-context>{bookingContextKey || ''}</output><button data-send disabled={isTyping || isDeleting} onClick={() => void sendMessage('MESSAGE_A09_SYNTHETIC')}>Enviar consulta ficticia</button><button data-book disabled={isTyping || isDeleting || !bookingContextKey} onClick={() => void requestBooking(syntheticBooking())}>Revisar videollamada ficticia</button><button data-show-guide onClick={() => setShowGuideDemo(true)}>Mostrar guía real con agenda ficticia</button>{showGuideDemo && <div data-guide-demo><ChatDesktop /></div>}</section>;
}
function mount() { flushSync(() => root.render(null)); flushSync(() => root.render(<><ChatProvider key={`A-${++revision}`}><Harness name="A" /></ChatProvider><ChatProvider key={`B-${revision}`}><Harness name="B" /></ChatProvider></>)); }
const scope = (name = 'A') => document.querySelector<HTMLElement>(`[data-tab="${name}"]`)!;
const shown = (name = 'A') => scope(name)?.querySelector('[data-messages]')?.textContent || '';
const button = (text: string, name = 'A') => [...scope(name).querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent?.trim() === text)!;
const erases = () => requests.filter(request => request.method === 'DELETE');
function ok(value: unknown, message: string) { assertions++; if (!value) throw new Error(message); }
async function waitFor(condition: () => boolean, message: string) { const until = Date.now() + 6000; while (!condition()) { if (Date.now() > until) throw new Error(message); await delay(10); } ok(true, message); }
async function openDelete() {
  const disclosure = scope().querySelector<HTMLDetailsElement>('details')!;
  if (!disclosure.open) disclosure.querySelector<HTMLElement>('summary')!.click();
  await waitFor(() => disclosure.open, 'Privacy disclosure is expanded');
  button('Borrar conversación y perfil').click();
  await waitFor(() => !!button('Confirmar borrado'), 'Confirmation is visible');
}
async function erase() { await openDelete(); const before = erases().length; button('Confirmar borrado').click(); await waitFor(() => erases().length === before + 1, 'One deletion request starts'); await waitFor(() => !button('Confirmar borrado') && !button('Borrando…'), 'Deletion finishes'); }
async function group(name: string, run: () => Promise<void>) { try { await run(); groups.push({ name, passed: true }); } catch (error) { groups.push({ name, passed: false }); throw error; } }
function seedCache(version = session.contextVersion) { localStorage.setItem(CHAT_HISTORY_KEY, JSON.stringify({ version: 2, ...session, contextVersion: version, messages: [{ id: 1, role: 'user', text: 'PRIVATE_CACHE_A09' }, { id: 2, role: 'agent', text: 'PRIVATE_REPLY_A09' }] })); }
const syntheticBooking = () => ({ date: addCivilDays(madridDateKey(), 1), time: '12:00', email: 'PRIVATE_GUIDE_A09@example.invalid', name: 'PRIVATE_GUIDE_NAME_A09' });
const posts = () => requests.filter(request => request.method === 'POST');
const bookingContext = () => scope().querySelector('[data-booking-context]')?.textContent || '';
async function freshBookingView() {
  flushSync(() => root.render(null));
  localStorage.removeItem(CHAT_HISTORY_KEY); localStorage.removeItem(CHAT_ERASURE_KEY);
  session = { sessionId: A, sessionExpiresAt: expiry(), contextVersion: 0 }; shareSession(); mount();
  await waitFor(() => bookingContext() === `${A}:${session.sessionExpiresAt}:0` && !(scope().querySelector('[data-book]') as HTMLButtonElement).disabled, 'Booking form starts with a verified current owner');
}
function setInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}
async function openRealGuide() {
  const demo = scope().querySelector('[data-guide-demo]')!;
  [...demo.querySelectorAll<HTMLButtonElement>('button')].find(value => value.textContent === 'Reservar videollamada')!.click();
  await waitFor(() => !!demo.querySelector('.meeting-guide input[type="radio"]'), 'Real meeting guide loads synthetic availability');
  (demo.querySelector('.meeting-guide input[type="radio"]') as HTMLInputElement).click();
  await waitFor(() => !!demo.querySelector('.meeting-guide input[type="email"]'), 'Selecting a time opens real contact fields');
  return demo;
}

async function run() {
  (document.getElementById('rerun') as HTMLButtonElement).disabled = true;
  flushSync(() => root.render(null)); localStorage.removeItem(CHAT_HISTORY_KEY); localStorage.removeItem(CHAT_ERASURE_KEY); localStorage.setItem('akrasia_lang', 'es');
  session = { sessionId: A, sessionExpiresAt: expiry(), contextVersion: 0 }; eraseError = false; eraseBusy = false; malformed = false; held = false; assertions = 0; aborts = 0; requests = []; groups = []; blockedNetwork.length = 0;
  shareSession();
  seedCache(); mount(); let failure: string | null = null;
  try {
    await group('Información visible y confirmación accesible no borran al cancelar', async () => {
      await waitFor(() => shown().includes('PRIVATE_CACHE_A09') && shown('B').includes('PRIVATE_CACHE_A09'), 'Both verified views load synthetic own cache');
      ok(scope().textContent?.includes('OpenRouter') && scope().textContent?.includes('Supabase'), 'Confirmed providers are disclosed');
      const before = erases().length; await openDelete(); ok(document.activeElement === button('Confirmar borrado'), 'Focus moves to explicit confirmation');
      const disclosure = scope().querySelector<HTMLDetailsElement>('details')!;
      const summary = disclosure.querySelector<HTMLElement>('summary')!;
      summary.click();
      await waitFor(() => !disclosure.open && !button('Confirmar borrado'), 'Closing privacy disclosure cancels confirmation');
      ok(document.activeElement === summary, 'Closing disclosure restores focus to its summary');
      ok(erases().length === before, 'Closing disclosure sends no deletion');
      await openDelete();
      ok(document.activeElement === button('Confirmar borrado'), 'Reopening deletion focuses explicit confirmation');
      button('Conservar conversación').click(); ok(erases().length === before, 'Cancel sends no deletion'); ok(shown().includes('PRIVATE_CACHE_A09'), 'Cancel preserves visible history');
    });
    await group('Fallo del almacén y contrato incoherente conservan historial y no anuncian éxito', async () => {
      for (const kind of ['store', 'malformed']) { eraseError = kind === 'store'; malformed = kind === 'malformed'; await erase(); ok(shown().includes('PRIVATE_CACHE_A09'), 'Failure preserves own display'); ok(localStorage.getItem(CHAT_HISTORY_KEY)?.includes('PRIVATE_CACHE_A09'), 'Failure preserves local display cache'); ok(scope().textContent?.includes('No se ha confirmado el borrado'), 'Failure clearly reported'); }
      eraseError = false; malformed = false;
    });
    await group('Petición activa pide esperar, no confirma borrado ni reinicia cuotas', async () => {
      eraseBusy = true; const version = session.contextVersion; await erase();
      ok(shown().includes('PRIVATE_CACHE_A09'), 'Busy operation preserves current transcript'); ok(session.contextVersion === version, 'Busy deletion does not advance context');
      ok(scope().textContent?.includes('espera 2 segundos'), 'Server retry delay is clearly presented'); ok(JSON.stringify(retained) === beforeRetained, 'Busy deletion changes no retained data'); eraseBusy = false;
    });
    await group('Borrado owner/version/CSRF limpia ambas pestañas y conserva reservas/cuotas', async () => {
      await erase(); await waitFor(() => !shown().includes('PRIVATE_CACHE_A09') && !shown('B').includes('PRIVATE_CACHE_A09'), 'Broadcast clears both open views');
      const last = erases().at(-1)!; ok(last.csrf === `synthetic-csrf-${A}-0`, 'Ephemeral server CSRF sent'); ok(JSON.stringify(last.body) === '{"contextVersion":0}', 'No client owner or foreign UUID controls deletion');
      ok(session.sessionId === A && session.contextVersion === 1, 'Same identity retains quotas with advanced context'); ok(JSON.stringify(retained) === beforeRetained, 'Separate bookings, quotas and external copies unchanged');
      ok(!localStorage.getItem(CHAT_HISTORY_KEY)?.includes('PRIVATE_CACHE_A09'), 'Transcript removed from local cache'); ok(scope().textContent?.includes('perfil derivado borrados'), 'Success scope is visible');
    });
    await group('Recarga y caché antigua no recuperan el contexto eliminado', async () => {
      seedCache(0); mount(); await waitFor(() => requests.filter(request => request.method === 'GET').length > 3, 'Remount verifies fresh server version'); await delay(80);
      ok(!shown().includes('PRIVATE_CACHE_A09'), 'Prior-version display cache is rejected after reload'); ok(!shown('B').includes('PRIVATE_CACHE_A09'), 'Second view rejects stale cache too');
      const sends = requests.filter(request => request.method === 'POST'); ok(sends.length === 0, 'Reload does not send old history to AI');
    });
    await group('Streaming en curso aborta; una respuesta vieja no restaura lo borrado', async () => {
      held = true; (scope().querySelector('[data-send]') as HTMLButtonElement).click(); await waitFor(() => scope().querySelector('[data-stream]')?.textContent?.includes('PRIVATE_STREAM_A09') || false, 'Synthetic stream is in progress');
      eraseBusy = true; await erase(); ok(aborts > 0, 'In-flight stream was aborted'); ok(scope().textContent?.includes('espera 2 segundos'), 'Active server lease delays deletion');
      eraseBusy = false; await erase(); finishStream?.(); await delay(60); ok(!shown().includes('MESSAGE_A09_SYNTHETIC') && !shown().includes('LATE_A09'), 'Deleted input and late output absent'); ok(!scope().querySelector('[data-stream]')?.textContent, 'Stream display is cleared'); held = false;
    });
    await group('Evento storage sincroniza y la consulta nueva lleva solo nueva versión', async () => {
      session = { ...session, contextVersion: session.contextVersion + 1 }; shareSession(); recordErasure(session); window.dispatchEvent(new StorageEvent('storage', { key: CHAT_ERASURE_KEY, newValue: localStorage.getItem(CHAT_ERASURE_KEY) })); await delay(80);
      (scope().querySelector('[data-send]') as HTMLButtonElement).click(); await waitFor(() => shown().includes('_LATE_A09'), 'New conversation can complete'); const last = requests.filter(request => request.method === 'POST').at(-1)!;
      ok(last.body.context_version === session.contextVersion, 'New request uses refreshed erasure version'); ok(last.body.messages.length === 1 && last.body.messages[0].content === 'MESSAGE_A09_SYNTHETIC', 'Only current input is sent');
      const { operation_id, language, ...payload } = last.body;
      ok(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(operation_id), 'New conversation has an operation UUID for safe retries');
      ok(language === 'es', 'Request language matches this Spanish fixture');
      ok(JSON.stringify(payload) === JSON.stringify({ messages: [{ role: 'user', content: 'MESSAGE_A09_SYNTHETIC' }], context_version: session.contextVersion }), 'Only the current turn, generation and operation metadata are sent');
      for (const request of requests) ok(request.credentials === 'same-origin' && request.cache === 'no-store', 'Owner requests stay private'); ok(blockedNetwork.length === 0, 'No real external integrations attempted');
    });
    await group('Un envío pendiente de verificar sesión no continúa durante el borrado', async () => {
      const beforePosts = requests.filter(request => request.method === 'POST').length;
      const beforeGets = requests.filter(request => request.method === 'GET').length;
      holdHistory = true; (scope().querySelector('[data-send]') as HTMLButtonElement).click();
      await waitFor(() => requests.filter(request => request.method === 'GET').length > beforeGets, 'Session refresh of pending send starts');
      await openDelete(); const beforeDeletes = erases().length; button('Confirmar borrado').click(); await waitFor(() => !!button('Borrando…'), 'Deletion blocks input while history waits');
      releaseHistory?.(); releaseHistory = null;
      await waitFor(() => erases().length === beforeDeletes + 1 && !button('Borrando…'), 'Deletion settles after pending verification');
      ok(requests.filter(request => request.method === 'POST').length === beforePosts, 'Pending input is not sent after deletion begins');
    });
    await group('Un DELETE retrasado no retrocede un borrado posterior de otra pestaña', async () => {
      holdEraseResponse = true;
      await openDelete(); button('Confirmar borrado').click();
      await waitFor(() => !!releaseEraseResponse, 'First deletion committed but its response is delayed');
      const delayed = { ...session };
      session = { ...session, contextVersion: session.contextVersion + 1 }; shareSession(); recordErasure(session);
      window.dispatchEvent(new StorageEvent('storage', { key: CHAT_ERASURE_KEY, newValue: localStorage.getItem(CHAT_ERASURE_KEY) }));
      await waitFor(() => scope().textContent?.includes('borrado en otra pestaña') || false, 'Later erasure invalidates the waiting view');
      releaseEraseResponse?.(); releaseEraseResponse = null;
      await waitFor(() => !button('Borrando…'), 'Old deletion response settles');
      recordErasure(delayed);
      ok(JSON.parse(localStorage.getItem(CHAT_ERASURE_KEY)!).contextVersion === session.contextVersion, 'Tombstone cannot move backwards');
      ok(JSON.parse(localStorage.getItem(CHAT_HISTORY_KEY)!).contextVersion === session.contextVersion, 'Display cache retains the later version');
      (scope().querySelector('[data-send]') as HTMLButtonElement).click();
      await waitFor(() => shown().includes('_LATE_A09'), 'New request completes after both erasures');
      ok(requests.filter(request => request.method === 'POST').at(-1)?.body.context_version === session.contextVersion, 'Only later version can submit');
    });
    await group('BroadcastChannel invalida otras vistas cuando localStorage está bloqueado', async () => {
      seedCache(); mount(); await waitFor(() => shown().includes('PRIVATE_CACHE_A09') && shown('B').includes('PRIVATE_CACHE_A09'), 'Both views have verified synthetic history');
      const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
      Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new Error('Synthetic blocked storage'); } });
      try { await erase(); await waitFor(() => !shown('B').includes('PRIVATE_CACHE_A09'), 'Channel signal clears second view without storage'); ok(!shown().includes('PRIVATE_CACHE_A09'), 'Deleting view cleared after coherent response'); }
      finally { if (descriptor) Object.defineProperty(window, 'localStorage', descriptor); shareSession(); recordErasure(session); }
    });
    await group('Una propuesta pendiente no reenvía contacto bajo una identidad nueva', async () => {
      await freshBookingView();
      const before = posts().length; holdHistory = true;
      (scope().querySelector('[data-book]') as HTMLButtonElement).click();
      await waitFor(() => !!releaseHistory, 'Booking request pauses while verifying its current owner');
      session = { sessionId: B, sessionExpiresAt: expiry(), contextVersion: 0 }; shareSession();
      releaseHistory?.(); releaseHistory = null;
      await waitFor(() => bookingContext().startsWith(B) && !(scope().querySelector('[data-book]') as HTMLButtonElement).disabled, 'New owner is verified and pending request settles');
      ok(posts().length === before, 'Owner change aborts the old contact before any booking_request POST');
      ok(!shown().includes('PRIVATE_GUIDE_A09'), 'Old booking contact is not added to the new transcript');
    });
    await group('Una propuesta pendiente no vuelve a introducir contacto tras cambio de contexto', async () => {
      await freshBookingView();
      const before = posts().length; holdHistory = true;
      (scope().querySelector('[data-book]') as HTMLButtonElement).click();
      await waitFor(() => !!releaseHistory, 'Booking request pauses before erasure version refresh');
      session = { ...session, contextVersion: 1 }; shareSession();
      releaseHistory?.(); releaseHistory = null;
      await waitFor(() => bookingContext().endsWith(':1') && !(scope().querySelector('[data-book]') as HTMLButtonElement).disabled, 'New context version is verified and pending proposal settles');
      ok(posts().length === before, 'Context change aborts the old contact before any booking_request POST');
      ok(!shown().includes('PRIVATE_GUIDE_A09'), 'Erased contact is not reintroduced by the pending form');
    });
    await group('El idioma de una propuesta no cambia durante la verificación de sesión', async () => {
      await freshBookingView();
      const before = posts().length; holdHistory = true;
      (scope().querySelector('[data-book]') as HTMLButtonElement).click();
      await waitFor(() => !!releaseHistory, 'Proposal is waiting for the same owner');
      localStorage.setItem('akrasia_lang', 'en'); document.documentElement.lang = 'en';
      releaseHistory?.(); releaseHistory = null;
      await waitFor(() => posts().length === before + 1 && !(scope().querySelector('[data-book]') as HTMLButtonElement).disabled, 'Same-owner proposal completes after language switch');
      const last = posts().at(-1)!.body;
      ok(last.language === 'es', 'Request keeps the language captured when the visitor submitted');
      ok(last.messages[0].content === guidedBookingMessage(last.booking_request, 'es'), 'Canonical message and request language remain consistent');
      localStorage.setItem('akrasia_lang', 'es'); document.documentElement.lang = 'es';
    });
    await group('La guía real limpia datos al borrar desde otra pestaña y cambiar de identidad', async () => {
      await freshBookingView();
      (scope().querySelector('[data-show-guide]') as HTMLButtonElement).click();
      await waitFor(() => !!scope().querySelector('[data-guide-demo]'), 'Real ChatDesktop is mounted with the verified fixture');
      let demo = await openRealGuide();
      setInput(demo.querySelector('.meeting-guide input[type="email"]')!, 'PRIVATE_FORM_A09@example.invalid');
      setInput(demo.querySelector('.meeting-guide input[type="text"]')!, 'PRIVATE_FORM_NAME_A09');
      await delay(20);
      ok((demo.querySelector('.meeting-guide input[type="email"]') as HTMLInputElement).value === 'PRIVATE_FORM_A09@example.invalid', 'Synthetic contact is entered in the real guide');
      session = { ...session, contextVersion: 1 }; shareSession(); recordErasure(session);
      window.dispatchEvent(new StorageEvent('storage', { key: CHAT_ERASURE_KEY, newValue: localStorage.getItem(CHAT_ERASURE_KEY) }));
      await waitFor(() => !demo.querySelector('.meeting-guide'), 'Remote erasure closes the real guide');
      demo = await openRealGuide();
      ok((demo.querySelector('.meeting-guide input[type="email"]') as HTMLInputElement).value === '', 'Reopened guide has no erased email');
      ok((demo.querySelector('.meeting-guide input[type="text"]') as HTMLInputElement).value === '', 'Reopened guide has no erased name');
      setInput(demo.querySelector('.meeting-guide input[type="email"]')!, 'PRIVATE_FORM_SECOND_A09@example.invalid');
      session = { sessionId: B, sessionExpiresAt: expiry(), contextVersion: 0 }; shareSession();
      window.dispatchEvent(new Event('focus'));
      await waitFor(() => bookingContext().startsWith(B) && !demo.querySelector('.meeting-guide'), 'Owner refresh closes the real guide');
      demo = await openRealGuide();
      ok((demo.querySelector('.meeting-guide input[type="email"]') as HTMLInputElement).value === '', 'New owner receives no previous email');
      ok(posts().every(request => !request.body?.booking_request?.email?.startsWith('PRIVATE_FORM_')), 'Field resets never submit old contact data');
      ok(blockedNetwork.length === 0, 'Meeting guide and lifecycle tests use no external integration');
    });
  } catch (error) { failure = error instanceof Error ? error.message : String(error); }
  releaseHistory?.(); releaseHistory = null;
  releaseEraseResponse?.(); releaseEraseResponse = null;
  finishStream?.(); output.textContent = JSON.stringify({ passed: !failure, groups, assertions, deletes: erases().length, aborts, blockedNetwork: blockedNetwork.length, failure }, null, 2);
  output.dataset.passed = String(!failure); status.textContent = failure ? `FALLO: ${failure}` : `PASS · ${groups.length} grupos · ${assertions} comprobaciones ficticias.`;
  (document.getElementById('rerun') as HTMLButtonElement).disabled = false;
}
document.getElementById('rerun')!.addEventListener('click', () => void run());
if (new URL(location.href).searchParams.has('manual')) { readServer(); mount(); status.textContent = 'Vista manual con servidor ficticio compartido; ningún proveedor real.'; }
else void run();
