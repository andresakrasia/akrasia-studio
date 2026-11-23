import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const guard = installFetchGuard([]);
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
let checks = 0;
const eq = (actual, expected) => { checks++; assert.deepEqual(actual, expected); };
const ok = value => { checks++; assert.ok(value); };
try {
  const intent = await vite.ssrLoadModule('/src/lib/meeting-intent.ts');
  const client = await vite.ssrLoadModule('/src/lib/chat-client.ts');
  const handler = await vite.ssrLoadModule('/src/lib/chat-handler.ts');
  const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const { AKRASIA_SYSTEM_PROMPT } = await vite.ssrLoadModule('/src/data/systemPrompt.ts');
  const history = [{ role: 'user', content: 'Quiero un videoclip de hip hop, 3 minutos, animado y postapocalíptico.' }, { role: 'assistant', content: 'Podemos valorar tu idea en una videollamada de 30 minutos con el equipo. ¿Te interesa ver los horarios disponibles?' }];
  for (const text of ['sí me interesa', 'Sí, por favor', 'claro', 'vale', 'Me gustaría', 'Quiero reservar una videollamada', 'mañana a las 12 visitor@example.invalid', 'el 15 a las 12']) eq(intent.wantsMeetingGuide(text, history), true);
  for (const text of ['no gracias', 'sí, pero prefiero seguir por aquí', 'Sí, prefiero hablar por email', 'Sí, pero no puedo hacer una videollamada', 'quiero hablar con alguien', 'no me interesa una llamada', 'Quiero cancelar la llamada']) eq(intent.wantsMeetingGuide(text, history), false);
  for (const text of ['no gracias', 'no quiero una videollamada', 'Sí, prefiero hablar por email', 'Sí, pero no puedo hacer una videollamada']) eq(intent.declinesMeetingGuide(text), true);
  for (const text of ['no quiero una estética oscura', 'sí me interesa', 'Quiero reservar una videollamada sin compromiso']) eq(intent.declinesMeetingGuide(text), false);
  eq(intent.wantsMeetingGuide('sí me interesa', [{ role: 'assistant', content: 'Una videollamada de 30 minutos nos permite valorar tu idea. ¿Te apetece que te muestre los horarios disponibles?' }]), true);
  for (const text of ['sí me interesa', 'mañana a las 12 visitor@example.invalid']) {
    eq(intent.wantsMeetingGuide(text, []), false);
    eq(intent.wantsMeetingGuide(text, [{ role: 'assistant', content: '¿Te gusta este estilo?' }]), false);
    eq(intent.wantsMeetingGuide(text, [...history, { role: 'user', content: 'Otra consulta' }]), false);
  }
  const english = [{ role: 'assistant', content: 'Would you like a 30-minute video call with the team?' }];
  for (const text of ['yes please', 'Sounds good', 'tomorrow at 12']) eq(intent.wantsMeetingGuide(text, english), true);
  for (const text of ['no thanks', 'I prefer email', 'yes but keep chatting']) eq(intent.wantsMeetingGuide(text, english), false);

  const now = Date.parse('2030-01-07T09:00:00Z');
  const origin = 'http://localhost:4325';
  const config = security.readChatConfig({ CHAT_SESSION_SECRET: 'ab'.repeat(32), CHAT_ORIGIN: origin, SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_ROLE_KEY: 'synthetic', OPENROUTER_API_KEY: '' }, false, false);
  const session = security.chatSession(new Request(origin), config, now);
  const cookie = session.cookie.split(';')[0];
  const complete = new Map();
  let context = history;
  let effects = 0;
  let provider = 0;
  let actions = 0;
  let denied = false;
  let stale = false;
  const dispatch = handler.createChatHandler({ config: () => config, now: () => now,
    loadContext: async () => ({ messages: context, visitorName: null, visitorCompany: null }),
    provider: async () => { provider++; assert.fail('Guide must not invoke AI'); },
    prepareAction: async () => { actions++; assert.fail('Opening a guide is not a proposal'); },
    confirmAction: async () => { actions++; assert.fail('Opening a guide is not a booking'); },
    store: { admit: async () => ({ allowed: !denied, reason: denied ? 'rate' : null, retryAfter: denied ? 60 : 0 }), release: async () => {} },
    lifecycle: { state: async () => ({ contextVersion: stale ? 1 : 0 }), erase: async () => assert.fail('Unexpected erasure') },
    operations: { claim: async input => complete.get(input.operationId) || { status: 'claimed' } },
    effects: async input => { effects++; complete.set(input.operationId, { status: 'complete', response: input.response }); },
  });
  const post = (text, language = 'es', operationId = randomUUID(), requestCookie = cookie) => dispatch({ request: new Request(origin + '/api/chat', { method: 'POST', headers: { origin, 'content-type': 'application/json', ...(requestCookie ? { cookie: requestCookie } : {}) }, body: JSON.stringify({ messages: [{ role: 'user', content: text }], operation_id: operationId, language, context_version: 0 }) }) });
  const events = async response => {
    eq(response.status, 200);
    const parser = client.createChatSSEParser();
    const result = parser.push(await response.text());
    parser.finish();
    ok(result.some(event => event.meeting_guide));
    eq(result.some(event => event.action), false);
    return result;
  };
  const operationId = randomUUID();
  const first = await events(await post('sí me interesa', 'es', operationId));
  eq(first.filter(event => event.content).map(event => event.content).join(''), intent.meetingGuideReply('es'));
  eq(effects, 1);
  context = [];
  eq(await events(await post('sí me interesa', 'es', operationId)), first);
  eq(effects, 1);
  await events(await post('Quiero reservar una videollamada', 'es', randomUUID(), ''));
  context = english;
  const englishEvents = await events(await post('yes please', 'en'));
  eq(englishEvents.filter(event => event.content).map(event => event.content).join(''), intent.meetingGuideReply('en'));
  context = history;
  await events(await post('mañana a las 12 visitor@example.invalid'));
  context = [];
  eq((await post('sí me interesa')).status, 503);
  denied = true;
  eq((await post('Quiero reservar una videollamada')).status, 429);
  denied = false; stale = true;
  eq((await post('Quiero reservar una videollamada')).status, 409);
  eq(provider, 0); eq(actions, 0);

  const wire = `data: ${JSON.stringify({ content: 'Calendario disponible' })}\n\ndata: {"meeting_guide":true}\n\ndata: [DONE]\n\n`;
  for (let split = 0; split <= wire.length; split++) {
    const parser = client.createChatSSEParser();
    eq([...parser.push(wire.slice(0, split)), ...parser.push(wire.slice(split))], [{ content: 'Calendario disponible' }, { meeting_guide: true }, { done: true }]);
    parser.finish();
  }
  for (const record of [{ meeting_guide: false }, { meeting_guide: 'true' }, { meeting_guide: true, action: {} }, { meeting_guide: true, content: 'forged' }]) {
    checks++; assert.throws(() => client.createChatSSEParser().push(`data: ${JSON.stringify(record)}\n\n`));
  }
  ok(AKRASIA_SYSTEM_PROMPT.includes('Nunca le pidas que proponga fecha y hora por texto'));
  ok(AKRASIA_SYSTEM_PROMPT.includes('No ofrezcas proyectos como referencias similares'));
  eq(guard.blocked, []);
  console.log(`PASS: ${checks} meeting intent assertions; contextual acceptance, refusals, calendar handoff, replay, fragmented SSE and no AI or booking side effects.`);
} finally { await vite.close(); guard.restore(); }
