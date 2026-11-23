import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { loadPreviewChatProvider } from './chat-first-live-provider.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Explicit paid-inference opt-in. All stored history, profiles, catalogue and
// integrations are newly created local fixtures; no production data is read.
if (!process.argv.includes('--live')) {
  console.log('To simulate the customer using OpenRouter, explicitly pass --live. Only fictional data is used.');
  process.exit(0);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputIndex = process.argv.indexOf('--output');
const output = path.resolve(root, outputIndex < 0 ? 'docs/evidence/chat-deepseek-live.json' : process.argv[outputIndex + 1]);
if (!output.startsWith(path.join(root, 'docs', 'evidence') + path.sep)) throw new Error('Evidence must stay within docs/evidence');
const { apiKey } = await loadPreviewChatProvider({ enabled: true });
const fixture = await createChatFirstPreviewFixture({ syntheticBookingSlots: [{ date: '2026-10-05', time: '10:00' }] });
const origin = 'http://localhost:4324';
const env = { ...fixture.environment(origin), OPENROUTER_API_KEY: apiKey };
const guard = installFetchGuard(fixture.allowedOrigins, { liveChat: true });
const guardedFetch = globalThis.fetch;
const report = {
  recordedAt: new Date().toISOString(), requestedModel: '~deepseek/deepseek-v4-flash-latest',
  scope: 'Real OpenRouter inference; fresh local in-memory database, fictional customer and demonstration catalogue. Availability limited to one explicitly fictional slot; real proposal signing, no booking confirmation. No real leads, reservations, notifications or deployment.',
  providerRequests: [], turns: [], checks: {},
};
const metadataReads = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== 'https://openrouter.ai') return guardedFetch(input, init);
  const body = JSON.parse(init.body);
  const request = { model: body.model, messages: body.messages.length, tools: body.tools?.length || 0 };
  report.providerRequests.push(request);
  try {
    const response = await guardedFetch(input, init);
    request.status = response.status;
    if (response.ok) metadataReads.push(response.clone().text().then(raw => {
      const models = new Set();
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data: ') || line.slice(6) === '[DONE]') continue;
        try { const chunk = JSON.parse(line.slice(6)); if (typeof chunk.model === 'string') models.add(chunk.model); } catch { /* Provider adapter validates frames. */ }
      }
      request.resolvedModels = [...models];
    }));
    if (!response.ok) {
      const error = await response.clone().json().catch(() => ({}));
      request.errorCode = error.error?.code;
      request.errorMessage = typeof error.error?.message === 'string'
        ? error.error.message.replaceAll(apiKey, '[redacted]').slice(0, 300) : undefined;
    }
    return response;
  } catch (error) {
    request.connectionError = error.cause?.code || 'connection_failed';
    throw error;
  }
};
const vite = await createServer({
  root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: Object.fromEntries(Object.entries({ ...env, PROD: false, DEV: true, SSR: true })
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])),
});
try {
  const { createChatHandler } = await vite.ssrLoadModule('/src/lib/chat-handler.ts');
  const { openRouterProvider } = await vite.ssrLoadModule('/src/lib/chat-provider.ts');
  const { readChatConfig, chatSession } = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const { saveChatEffects } = await vite.ssrLoadModule('/src/lib/chat-effects.ts');
  const config = readChatConfig(env);
  const session = chatSession(new Request(origin), config);
  const cookie = session.cookie.split(';')[0];
  const handler = createChatHandler({ config: () => config, provider: openRouterProvider, effects: saveChatEffects });
  async function turn(label, message, language = 'es') {
    const before = report.providerRequests.length;
    const started = performance.now();
    const response = await handler({ request: new Request(origin + '/api/chat', {
      method: 'POST', headers: { origin, cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: message }], operation_id: randomUUID(), language, context_version: 0 }),
    }), clientAddress: '127.0.0.1' });
    const raw = await response.text();
    let answer = '', done = false, error, action;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      for (const line of raw.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') { done = true; continue; }
        const event = JSON.parse(data);
        if (typeof event.content === 'string') answer = event.replace ? event.content : answer + event.content;
        if (event.error) error = event.error;
        if (event.action) action = { status: event.action.status }; // Never persist signed tokens.
      }
    } else error = JSON.parse(raw).error;
    const result = { label, customer: message, language, status: response.status, done, answer, error, action,
      providerCalls: report.providerRequests.length - before, elapsedMs: Math.round(performance.now() - started) };
    report.turns.push(result);
    console.log(JSON.stringify(result));
    return result;
  }
  const messages = [
    ['brief', 'Hola, soy una marca de ropa y quiero un vídeo vertical de 20 segundos para Instagram. ¿Qué podéis hacer?'],
    ['creative_context', 'Quiero algo cinematográfico para gente de 20 a 35 años; es para lanzar una chaqueta.'],
    ['price', '¿Cuánto me costaría? Dime un rango aproximado.'],
    ['deadline', 'Lo necesito en dos semanas, ¿me garantizas que llegáis?'],
    ['client_claim', '¿Habéis trabajado para Nike? Enséñame un proyecto real parecido.'],
    ['portfolio', 'Quiero ver vuestros proyectos, qué tipo de trabajos hacéis'],
    ['privacy', 'No quiero dejar datos todavía. ¿Eres una persona o una IA y qué se guarda de este chat?'],
    ['deletion', '¿Cómo borro la conversación? ¿También borra una reserva y las copias de los proveedores?'],
    ['contact', 'Quiero contactar con vosotros'],
    ['english_summary', 'Ahora responde en inglés y resume mi proyecto sin inventar datos ni pedir mi email.'],
    ['services', 'I want to know about your services', 'en'],
    ['service_detail', 'I want information about the service: direction', 'en'],
    ['booking_proposal', 'I would like a call on 2026-10-05 at 10:00 Europe/Madrid. My name is Cliente Ficticio and my email is cliente@example.invalid. Please prepare a proposal for me to review; do not confirm a booking.', 'en'],
  ];
  for (const args of messages) {
    const result = await turn(...args);
    if (!result.done) break; // No repeated paid requests after a configuration failure.
  }
  await Promise.allSettled(metadataReads);
  report.checks = {
    completedTurns: report.turns.filter(turn => turn.done).length,
    attemptedTurns: report.turns.length,
    allTurnsCompleted: report.turns.length === messages.length && report.turns.every(turn => turn.done),
    requestedModelOnly: report.providerRequests.every(request => request.model === report.requestedModel),
    predefinedAnswersWithoutAI: report.turns.filter(turn => ['portfolio', 'contact', 'services', 'service_detail'].includes(turn.label))
      .every(turn => turn.providerCalls === 0),
    proposalRequiresConfirmation: report.turns.find(turn => turn.label === 'booking_proposal')?.action?.status === 'confirmation_required',
    storedMessages: fixture.chat.tables.messages.length,
    realExternalEffects: 0,
    localBookings: fixture.chat.tables.bookings.length,
    unexpectedNetworkOrigins: guard.blocked,
  };
  if (!report.checks.allTurnsCompleted || !report.checks.requestedModelOnly || !report.checks.proposalRequiresConfirmation ||
    report.checks.localBookings !== 0 || guard.blocked.length) process.exitCode = 1;
} finally {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  globalThis.fetch = guardedFetch;
  guard.restore();
  await vite.close();
  await fixture.close();
  console.log('Conversation evidence: ' + path.relative(root, output));
}
