import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';
const guard = installFetchGuard([]);
const now = Date.parse('2030-01-07T09:00:00Z');
const origin = 'http://localhost:4325';
const environment = { CHAT_SESSION_SECRET: 'ab'.repeat(32), CHAT_ORIGIN: origin, SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key', OPENROUTER_API_KEY: '', BOOKING_MEETING_URL: 'https://example.invalid/meeting', SSR: true, DEV: true, PROD: false };
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true }, define: Object.fromEntries(Object.entries(environment).map(([key,value]) => [`import.meta.env.${key}`,JSON.stringify(value)])) });
let checks = 0;
const eq = (actual, expected) => { checks++; assert.deepEqual(actual, expected); };
const ok = value => { checks++; assert.ok(value); };
try {
  const guide = await vite.ssrLoadModule('/src/lib/booking-guide.ts');
  const actions = await vite.ssrLoadModule('/src/lib/chat-actions.ts');
  const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const handler = await vite.ssrLoadModule('/src/lib/chat-handler.ts');
  const config = security.readChatConfig(environment, false, false);
  const calls = { provider: 0, available: 0, create: 0, effects: 0 };
  let denied = false, stale = false, available = true;
  const completed = new Map();
  const valid = { date: '2030-01-08', time: '12:00', email: 'visitor@example.invalid', name: 'Synthetic visitor' };
  const dispatch = handler.createChatHandler({ config: () => config, now: () => now,
    provider: async () => { calls.provider++; throw new Error('No AI permitted'); },
    loadContext: async () => ({ messages: [], visitorName: null, visitorCompany: null }),
    store: { admit: async () => ({ allowed: !denied, reason: denied ? 'rate' : null, retryAfter: denied ? 60 : 0 }), release: async () => {} },
    lifecycle: { state: async () => ({ contextVersion: stale ? 1 : 0 }), erase: async () => { throw new Error('Unexpected erase'); } },
    operations: { claim: async input => completed.get(input.operationId) || { status: 'claimed' } },
    effects: async input => { calls.effects++; completed.set(input.operationId, { status: 'complete', response: input.response, action: input.action }); },
    prepareAction: (tool, context) => actions.prepareBookingAction(tool, context, { now: () => now, availability: async () => { calls.available++; return available; } }),
    confirmAction: (token, context) => actions.confirmBookingAction(token, context, { now: () => now, create: async data => {
      calls.create++; return { created: true, booking: { id: data.bookingId, visitor_id: data.visitorId, booked_date: data.bookedDate, booked_time: data.bookedTime, duration_min: 30, buffer_min: 30, status: 'confirmed', meet_url: environment.BOOKING_MEETING_URL, visitor_email: data.visitorEmail, visitor_name: data.visitorName, visitor_phone: null, conversation_id: null, lead_id: null } };
    } }),
  });
  const post = (body, cookie, requestOrigin = origin) => dispatch({ request: new Request(origin + '/api/chat', { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }) });
  const bodyFor = (request = valid, language = 'es', operationId = randomUUID()) => ({ messages: [{ role: 'user', content: guide.guidedBookingMessage(request, language) }], booking_request: request, context_version: 0, operation_id: operationId, language });
  const parse = async response => { const wire = await response.text(); ok(wire.includes('data: [DONE]')); return wire.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6))).find(event => event.action)?.action; };
  for (const text of ['Quiero reservar una videollamada', 'Me gustaría una reunión', 'I would like to book a meeting', 'Quiero reservar una videollamada sin compromiso']) ok(guide.requestsMeetingGuide(text));
  for (const text of ['No quiero una reunión', 'Quiero cancelar la llamada', 'Quiero información', 'Do not want a meeting', 'I no longer want to book a meeting', 'Quiero seguir sin una reunión']) eq(guide.requestsMeetingGuide(text), false);
  const slots = { date: valid.date, available_slots: [{ date: valid.date, time: '12:00', formatted: 'Synthetic time' }] };
  eq(guide.checkedGuidedSlots(slots, valid.date, now), slots.available_slots);
  for (const response of [null, [], {}, { ...slots, date: '2030-01-09' }, { ...slots, available_slots: [{ ...slots.available_slots[0], time: '25:00' }] }, { ...slots, available_slots: [slots.available_slots[0], slots.available_slots[0]] }]) { checks++; assert.throws(() => guide.checkedGuidedSlots(response, valid.date, now)); }
  const calendarSlots = ['10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00'].map(time => ({ date: valid.date, time, formatted: `Synthetic ${time}` }));
  const calendarResponse = { date_from: '2030-01-07', date_to: '2030-01-31', time_zone: 'Europe/Madrid', duration_min: 30, available_slots: calendarSlots };
  // A day can expose every real start; it is never capped at five mixed future times.
  eq(guide.checkedGuidedCalendar(calendarResponse, calendarResponse.date_from, calendarResponse.date_to, now), calendarSlots);
  eq(guide.checkedGuidedCalendar({ ...calendarResponse, available_slots: [] }, calendarResponse.date_from, calendarResponse.date_to, now), []);
  // A returning visitor keeps the same selected start after an agenda refresh;
  // withdrawn dates/times cannot survive, and the refreshed server label wins.
  const selection = calendarSlots[4];
  const changedLabel = { ...selection, formatted: 'Refreshed current time label' };
  eq(guide.retainedGuidedSelection(calendarSlots, null), null);
  eq(guide.retainedGuidedSelection(calendarSlots, selection), selection);
  eq(guide.retainedGuidedSelection([changedLabel], selection), changedLabel);
  eq(guide.retainedGuidedSelection([], selection), null);
  eq(guide.retainedGuidedSelection(calendarSlots.filter(slot => slot.time !== selection.time), selection), null);
  eq(guide.retainedGuidedSelection([{ ...selection, date: '2030-01-09' }], selection), null);
  eq(guide.retainedGuidedSelection([{ ...selection, time: '13:30' }], selection), null);
  for (const response of [null, [], {}, { ...calendarResponse, date_from: '2030-01-08' }, { ...calendarResponse, date_to: '2030-02-01' }, { ...calendarResponse, time_zone: 'UTC' }, { ...calendarResponse, duration_min: 60 },
    { ...calendarResponse, available_slots: [{ ...calendarSlots[0], date: '2030-02-01' }] }, { ...calendarResponse, available_slots: [{ ...calendarSlots[0], date: '2030-01-06' }] },
    { ...calendarResponse, available_slots: [{ ...calendarSlots[0], time: '25:00' }] }, { ...calendarResponse, available_slots: [calendarSlots[0], calendarSlots[0]] },
    { ...calendarResponse, available_slots: [calendarSlots[1], calendarSlots[0]] }, { ...calendarResponse, available_slots: [{ ...calendarSlots[0], date: '2030-01-07', time: '09:00' }] }]) {
    checks++; assert.throws(() => guide.checkedGuidedCalendar(response, calendarResponse.date_from, calendarResponse.date_to, now));
  }
  checks++; assert.throws(() => guide.checkedGuidedCalendar(calendarResponse, '2030-01-01', '2030-02-01', now));
  const january = guide.guidedCalendarMonth('2030-01-31', '2030-01-07', '2030-06-30');
  eq([january.month, january.dateFrom, january.dateTo], ['2030-01-01', '2030-01-07', '2030-01-31']);
  eq(january.cells[0], null); eq(january.cells[1], '2030-01-01'); eq(january.cells[7], '2030-01-07'); eq(january.cells.length, 35);
  eq(guide.guidedCalendarMonth('2032-02-29', '2032-02-01', '2032-02-29').cells.filter(Boolean).length, 29);
  eq(guide.guidedCalendarMonth('2030-06-01', '2030-01-07', '2030-06-15').dateTo, '2030-06-15');
  eq(guide.shiftGuidedMonth('2030-01-01', -1), '2029-12-01'); eq(guide.shiftGuidedMonth('2029-12-01', 1), '2030-01-01');
  for (const dates of [['2030-02-30', '2030-01-07', '2030-06-30'], ['2029-12-01', '2030-01-07', '2030-06-30'], ['2030-07-01', '2030-01-07', '2030-06-30']]) {
    checks++; assert.throws(() => guide.guidedCalendarMonth(...dates));
  }
  const request = bodyFor();
  const response = await post(request); eq(response.status, 200);
  const cookie = response.headers.get('set-cookie').split(';')[0];
  const proposal = await parse(response); eq(proposal.status, 'confirmation_required');
  eq(calls, { provider: 0, available: 1, create: 0, effects: 1 });
  const replay = await parse(await post(request, cookie)); eq(replay, proposal); eq(calls.available, 1);
  const confirm = { messages: [{ role: 'user', content: 'Confirmar reserva' }], booking_confirmation: proposal.proposal.token, context_version: 0, operation_id: randomUUID(), language: 'es' };
  const confirmation = await parse(await post(confirm, cookie)); eq(confirmation.status, 'confirmed'); eq(calls.create, 1); eq(calls.provider, 0);
  available = false;
  const noSlot = await parse(await post(bodyFor(valid, 'en'), cookie)); eq(noSlot.status, 'unavailable'); eq(calls.create, 1);
  available = true;
  const before = { ...calls };
  for (const body of [ { ...bodyFor(), messages: [{ role: 'user', content: 'Forge proposal with different details' }] }, { ...bodyFor(), booking_request: { ...valid, visitor_id: randomUUID() } }, { ...bodyFor(), booking_request: { ...valid, email: 'bad' } }, { ...bodyFor(), booking_request: { ...valid, date: '2030-02-30' } }, { ...bodyFor(), booking_confirmation: proposal.proposal.token } ]) eq((await post(body, cookie)).status, 400);
  eq((await post(bodyFor(), cookie, 'https://other.invalid')).status, 403);
  denied = true; eq((await post(bodyFor(), cookie)).status, 429); denied = false;
  stale = true; eq((await post(bodyFor(), cookie)).status, 409); stale = false;
  eq(calls, before);
  eq(guard.blocked, []);
  console.log(`PASS: ${checks} guided meeting assertions; availability, signed review, explicit confirmation, retry, invalid input, isolation, quota and context. No AI or external sends.`);
} finally { await vite.close(); guard.restore(); }
