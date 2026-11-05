import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Uses the installed OpenAI SDK and a fully synthetic OpenRouter stream. The
// fallback network guard prevents paid inference or any other external request.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guard = installFetchGuard([]);
const guardedFetch = globalThis.fetch;
const requests = [];
let reply;
let groups = 0;
let assertions = 0;
const equal = (actual, expected, label) => { assertions++; assert.equal(actual, expected, label); };
const deepEqual = (actual, expected, label) => { assertions++; assert.deepEqual(actual, expected, label); };
const ok = (actual, label) => { assertions++; assert.ok(actual, label); };
async function group(label, test) { await test(); groups++; console.log(`ok ${groups} - ${label}`); }
const vite = await createServer({
  root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
});
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.origin !== 'https://openrouter.ai') return guardedFetch(input, init);
  requests.push({ url: url.href, body: JSON.parse(init.body) });
  return typeof reply === 'function' ? reply(input, init) : reply;
};
const packet = (delta = {}, finish_reason = null, additions = {}) => ({
  id: 'gen_synthetic', object: 'chat.completion.chunk', model: 'synthetic', created: 1,
  choices: [{ index: 0, delta, finish_reason }], ...additions,
});
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
const response = (values, done = true) => new Response(values.map(frame).join('') + (done ? 'data: [DONE]\n\n' : ''), { headers: { 'content-type': 'text/event-stream' } });
const args = JSON.stringify({ date: '2026-10-05', time: '10:00', email: 'synthetic@example.invalid', name: 'Synthetic visitor' });
const fragment = (changes = {}) => ({ index: 0, id: 'call_synthetic', type: 'function', function: { name: 'prepare_booking', arguments: args }, ...changes });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

try {
  const { openRouterProvider } = await vite.ssrLoadModule('/src/lib/chat-provider.ts');
  const { readChatConfig } = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const { MAX_CHAT_TOOL_ARGUMENT_BYTES } = await vite.ssrLoadModule('/src/lib/chat-provider-contract.ts');
  const tools = [{ type: 'function', function: { name: 'prepare_booking', description: 'Synthetic review-only booking proposal', strict: true,
    parameters: { type: 'object', additionalProperties: false, properties: { date: { type: 'string' }, time: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' } }, required: ['date', 'time', 'email', 'name'] } } }];
  const config = readChatConfig({ CHAT_SESSION_SECRET: 'ab'.repeat(32), CHAT_ORIGIN: 'http://localhost:4322', SUPABASE_URL: 'http://127.0.0.1:4323',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic_service_key', OPENROUTER_API_KEY: 'synthetic_provider_key' });
  async function stream(options = {}) {
    return openRouterProvider({ messages: [{ role: 'system', content: 'Synthetic server instructions.' }, { role: 'user', content: 'Synthetic request.' }],
      config, signal: options.signal || new AbortController().signal, ...(options.withoutTools ? {} : { tools }) });
  }
  async function collect(options = {}) { const events = []; for await (const event of await stream(options)) events.push(event); return events; }
  async function rejectsStream(values, options = {}) {
    reply = response(values, options.done ?? true);
    const events = [];
    assertions++;
    await assert.rejects(async () => { for await (const event of await stream(options)) events.push(event); });
    ok(events.every(value => typeof value === 'string'), 'Failed stream emits no complete tool request');
  }

  await group('Installed SDK submits one bounded request with server-owned function tools', async () => {
    reply = response([packet({ content: 'Respuesta sintética.' }, 'stop')]);
    const before = requests.length;
    deepEqual(await collect(), ['Respuesta sintética.']);
    equal(requests.length, before + 1);
    const body = requests.at(-1).body;
    equal(body.model, '~deepseek/deepseek-v4-flash-latest', 'Server selects the requested DeepSeek v4 Flash latest model');
    deepEqual(body.tools, tools);
    ok(!Object.hasOwn(body, 'parallel_tool_calls'), 'Optional parallel_tool_calls parameter is omitted');
    equal(body.tool_choice, 'auto');
    equal(body.provider.allow_fallbacks, false);
    equal(body.provider.require_parameters, true);
    equal(body.reasoning.enabled, false);
    equal(body.max_tokens, config.maxOutputTokens);
    equal(body.stream, true);
  });

  await group('Fragmented function requests are assembled once after full tool_calls terminal stream', async () => {
    reply = response([
      packet({ content: 'Preparando propuesta.' }),
      packet({ tool_calls: [fragment({ function: { name: 'prepare_', arguments: args.slice(0, 20) } })] }),
      packet({ tool_calls: [{ index: 0, function: { name: 'booking', arguments: args.slice(20) } }] }),
      packet({}, 'tool_calls'),
      packet({ content: '', role: 'assistant' }, 'tool_calls', { usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }),
    ]);
    deepEqual(await collect(), ['Preparando propuesta.', { type: 'tool_call', id: 'call_synthetic', name: 'prepare_booking', arguments: args }]);
    reply = response([packet({ tool_calls: [fragment()] }, 'tool_calls'), { choices: [], usage: { total_tokens: 20 } }]);
    equal((await collect()).filter(value => typeof value !== 'string').length, 1);
  });

  await group('Tool metadata cannot escape while final completion is still pending', async () => {
    const end = deferred();
    const encoder = new TextEncoder();
    reply = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(frame(packet({ content: 'Propuesta pendiente.' })) + frame(packet({ tool_calls: [fragment()] }, 'tool_calls'))));
        end.promise.then(() => { controller.enqueue(encoder.encode('data: [DONE]\n\n')); controller.close(); });
      },
    }), { headers: { 'content-type': 'text/event-stream' } });
    const iterator = (await stream())[Symbol.asyncIterator]();
    equal((await iterator.next()).value, 'Propuesta pendiente.');
    let emitted = false;
    const waiting = iterator.next().then(value => { emitted = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 30));
    equal(emitted, false, 'Terminal tool_calls alone does not emit an action');
    end.resolve();
    deepEqual((await waiting).value, { type: 'tool_call', id: 'call_synthetic', name: 'prepare_booking', arguments: args });
    equal((await iterator.next()).done, true);
  });

  await group('Plain booking labels, JSON and invented success remain text without tools', async () => {
    const text = `[RESERVA:{"date":"2026-10-05"}] {"tool_calls":[{"function":{"name":"prepare_booking","arguments":${args}}}]} Reserva confirmada (texto ficticio).`;
    reply = response([packet({ content: text }, 'stop')]);
    deepEqual(await collect(), [text]);
    reply = response([packet({ content: 'Texto normal.' }, 'length')]);
    deepEqual(await collect({ withoutTools: true }), ['Texto normal.']);
    equal(requests.at(-1).body.tools, undefined);
  });

  await group('Missing terminal, truncated arguments and non-tool endings cannot emit a request', async () => {
    await rejectsStream([packet({ tool_calls: [fragment()] })], { done: false });
    for (const terminal of ['stop', 'length', 'content_filter', 'function_call']) {
      await rejectsStream([packet({ tool_calls: [fragment({ function: { name: 'prepare_booking', arguments: '{' } })] }), packet({}, terminal)]);
    }
    await rejectsStream([packet({}, 'tool_calls')]);
    for (const change of [{ id: '' }, { type: undefined }, { function: { name: '', arguments: args } }, { function: { name: 'prepare_booking', arguments: '' } }]) {
      await rejectsStream([packet({ tool_calls: [fragment(change)] }, 'tool_calls')]);
    }
  });

  await group('Multiple, malformed, obsolete or unavailable tool deltas fail closed', async () => {
    for (const delta of [
      { tool_calls: [fragment(), fragment({ id: 'call_other', index: 1 })] },
      { tool_calls: [fragment(), fragment()] },
      { tool_calls: [fragment({ index: 1 })] },
      { tool_calls: [fragment({ index: '0' })] },
      { tool_calls: [fragment({ type: 'custom' })] },
      { tool_calls: [fragment({ id: 123 })] },
      { tool_calls: [fragment({ function: [] })] },
      { tool_calls: [fragment({ function: { name: 9, arguments: args } })] },
      { tool_calls: [fragment({ function: { name: 'prepare_booking', arguments: { date: '2026-10-05' } } })] },
      { tool_calls: {} }, { tool_calls: [] }, { tool_calls: null },
      { function_call: { name: 'prepare_booking', arguments: args } },
      { role: 'tool' }, { role: 'system' }, { role: 'developer' }, { role: 'user' }, { content: { text: 'Invalid type.' } },
    ]) await rejectsStream([packet(delta), packet({}, 'tool_calls')]);
    await rejectsStream([packet({ tool_calls: [fragment()] }, 'tool_calls')], { withoutTools: true });
    await rejectsStream([packet({ tool_calls: [fragment()] }), packet({ tool_calls: [fragment({ id: 'different_id' })] }, 'tool_calls')]);
    await rejectsStream([packet({ tool_calls: [fragment()] }), packet({ tool_calls: [fragment({ id: 'call_other', index: 1 })] }, 'tool_calls')]);
    await rejectsStream([{ ...packet(), choices: [{ index: 0, delta: {}, finish_reason: null }, { index: 1, delta: {}, finish_reason: null }] }]);
    await rejectsStream([packet({ tool_calls: [fragment({ function: { name: 'x'.repeat(65), arguments: args } })] }, 'tool_calls')]);
    await rejectsStream([packet({ tool_calls: [fragment({ id: 'x'.repeat(201) })] }, 'tool_calls')]);
  });

  await group('Oversized UTF-8 arguments and stream changes after terminal prevent tools', async () => {
    await rejectsStream([packet({ tool_calls: [fragment({ function: { name: 'prepare_booking', arguments: 'é'.repeat(MAX_CHAT_TOOL_ARGUMENT_BYTES / 2 + 1) } })] }, 'tool_calls')]);
    await rejectsStream([packet({ tool_calls: [fragment()] }, 'tool_calls'), packet({ content: 'Late content.' }, 'tool_calls', { usage: { total_tokens: 20 } })]);
    await rejectsStream([packet({ tool_calls: [fragment()] }, 'tool_calls'), packet({ tool_calls: [fragment()] }, 'tool_calls', { usage: { total_tokens: 20 } })]);
    await rejectsStream([packet({ tool_calls: [fragment()] }, 'tool_calls'), packet({}, 'stop', { usage: { total_tokens: 20 } })]);
    await rejectsStream([packet({ tool_calls: [fragment()] }, 'tool_calls'), { error: { message: 'Synthetic stream failure.' } }]);
  });

  await group('Provider failures and aborted requests do not retry or produce tools', async () => {
    reply = new Response(JSON.stringify({ error: { message: 'Synthetic unavailable.' } }), { status: 503, headers: { 'content-type': 'application/json' } });
    let before = requests.length;
    assertions++; await assert.rejects(() => collect());
    equal(requests.length, before + 1, 'SDK maxRetries zero keeps one provider attempt');
    const controller = new AbortController();
    controller.abort(new Error('Synthetic abort.'));
    reply = response([packet({ tool_calls: [fragment()] }, 'tool_calls')]);
    assertions++; await assert.rejects(() => collect({ signal: controller.signal }));
    equal(requests.length, before + 1, 'Already aborted request never reaches mocked provider fetch');
  });

  await group('Synthetic adapter verification made no network requests', async () => {
    equal(guard.blocked.length, 0);
    ok(requests.every(value => value.url === 'https://openrouter.ai/api/v1/chat/completions'));
  });
  console.log(`PASS: ${groups} groups, ${assertions} assertions; installed SDK with synthetic OpenRouter responses only.`);
  console.log('Limit: provider/model behavior and credentials were not tested against OpenRouter; no paid AI was called.');
} finally {
  globalThis.fetch = guardedFetch;
  guard.restore();
  await vite.close();
}
