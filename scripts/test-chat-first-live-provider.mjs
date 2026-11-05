import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPreviewChatProvider } from './chat-first-live-provider.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Fictitious keys, temporary files and no provider or other network access.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = path.join(root, '.codex-tmp');
await mkdir(temporaryRoot, { recursive: true });
const temporary = await mkdtemp(path.join(temporaryRoot, 'live-provider-tests-'));
const envFile = path.join(temporary, '.env');
const missingFile = path.join(temporary, 'missing-sensitive-canary.env');
const canary = 'PRIVATE_ENV_CONTENT_CANARY';
const envCanary = 'AKRASIA_PREVIEW_OTHER_VARIABLE_CANARY';
const originalOtherVariable = process.env[envCanary];
const originalFetch = globalThis.fetch;
let groups = 0;
let assertions = 0;
const equal = (actual, expected) => { assertions++; assert.deepEqual(actual, expected); };
const ok = actual => { assertions++; assert.ok(actual); };
async function group(title, test) { await test(); groups++; console.log(`ok ${groups} - ${title}`); }
async function unavailable(options) {
  let failure;
  try { await loadPreviewChatProvider(options); } catch (error) { failure = error; }
  ok(failure instanceof Error);
  equal(failure.message, 'La IA de la vista previa no está configurada. Comprueba OPENROUTER_API_KEY.');
  ok(!failure.stack.includes(canary));
  ok(!failure.stack.includes(missingFile));
}
globalThis.fetch = () => { throw new Error('Network forbidden in preview credential tests'); };

try {
  await group('Disabled preview neither reads a file nor selects a provider', async () => {
    equal(await loadPreviewChatProvider({ envFile: missingFile, environment: {} }), { apiKey: '', allowedOrigins: [] });
    for (const enabled of [false, undefined, 'true', 1, null]) {
      equal(await loadPreviewChatProvider({ enabled, envFile: missingFile, environment: { OPENROUTER_API_KEY: canary } }),
        { apiKey: '', allowedOrigins: [] });
    }
    const unreadableEnvironment = { get OPENROUTER_API_KEY() { throw new Error(canary); } };
    equal(await loadPreviewChatProvider({ enabled: false, envFile: missingFile, environment: unreadableEnvironment }),
      { apiKey: '', allowedOrigins: [] });
  });
  await group('Explicit enablement requires a key and hides configuration diagnostics', async () => {
    await unavailable({ enabled: true, envFile: missingFile, environment: {} });
    await writeFile(envFile, `OTHER_VARIABLE=${canary}\n`, 'utf8');
    await unavailable({ enabled: true, envFile, environment: {} });
    await writeFile(envFile, `OPENROUTER_API_KEY="   "\nOTHER_VARIABLE=${canary}\n`, 'utf8');
    await unavailable({ enabled: true, envFile, environment: {} });
    await unavailable({ enabled: true, envFile, environment: { OPENROUTER_API_KEY: `${canary}\ninvalid` } });
  });
  await group('Environment takes precedence without reading the file', async () => {
    equal(await loadPreviewChatProvider({ enabled: true, envFile: missingFile, environment: { OPENROUTER_API_KEY: ' fake-environment-key ' } }),
      { apiKey: 'fake-environment-key', allowedOrigins: ['https://openrouter.ai'] });
    await writeFile(envFile, 'OPENROUTER_API_KEY=fake-file-key\n', 'utf8');
    equal((await loadPreviewChatProvider({ enabled: true, envFile, environment: { OPENROUTER_API_KEY: 'fake-preferred-key' } })).apiKey,
      'fake-preferred-key');
  });
  await group('Node dotenv parsing supports quotes and comments without propagating variables', async () => {
    for (const line of [
      'OPENROUTER_API_KEY="fake-quoted-key" # comment',
      "OPENROUTER_API_KEY='fake-quoted-key' # comment",
      'OPENROUTER_API_KEY=fake-quoted-key # comment',
    ]) {
      await writeFile(envFile, `${line}\n${envCanary}=${canary}\nRESEND_API_KEY=${canary}\n`, 'utf8');
      const environment = { OPENROUTER_API_KEY: '' };
      equal(await loadPreviewChatProvider({ enabled: true, envFile, environment }),
        { apiKey: 'fake-quoted-key', allowedOrigins: ['https://openrouter.ai'] });
      equal(environment, { OPENROUTER_API_KEY: '' });
      equal(process.env[envCanary], originalOtherVariable);
    }
  });
  await group('Network guard isolates default previews and limits live AI to one POST endpoint', async () => {
    const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    const localOrigin = 'http://127.0.0.1:54321';
    const requests = [];
    // This stub is captured by the guard instead of the native network fetch.
    const syntheticFetch = async (input, init) => {
      requests.push({ url: input instanceof Request ? input.url : String(input), init });
      return new Response('{"synthetic":true}', { headers: { 'Content-Type': 'application/json' } });
    };
    const rejectRequest = async (input, init) => {
      const before = requests.length;
      assertions++;
      await assert.rejects(() => globalThis.fetch(input, init), /External network access blocked/u);
      equal(requests.length, before);
    };
    globalThis.fetch = syntheticFetch;
    const isolated = installFetchGuard([localOrigin]);
    try {
      await rejectRequest(endpoint, { method: 'POST' });
      equal(isolated.blocked, ['https://openrouter.ai']);
      equal((await globalThis.fetch(`${localOrigin}/rest/v1/services`)).status, 200);
      equal(requests.length, 1);
    } finally { isolated.restore(); }
    equal(globalThis.fetch, syntheticFetch);
    const live = installFetchGuard([localOrigin], { liveChat: true });
    try {
      const response = await globalThis.fetch(endpoint, { method: 'POST', redirect: 'follow', body: '{"synthetic":true}' });
      equal(await response.json(), { synthetic: true });
      equal(requests.at(-1).init.redirect, 'error');
      equal(requests.at(-1).init.body, '{"synthetic":true}');
      const request = new Request(endpoint, { method: 'POST', body: '{"synthetic":true}' });
      equal((await globalThis.fetch(request)).status, 200);
      equal(requests.at(-1).init.redirect, 'error');
      for (const [input, init] of [
        [endpoint, undefined],
        [endpoint, { method: 'GET' }],
        [endpoint, { method: 'DELETE' }],
        [request, { method: 'GET' }],
        ['https://example.invalid/api/v1/chat/completions', { method: 'POST' }],
        ['https://openrouter.ai/api/v1/models', { method: 'POST' }],
        [endpoint + '/extra', { method: 'POST' }],
        [endpoint + '?api_key=fake-query-key', { method: 'POST' }],
        [endpoint + '#fragment', { method: 'POST' }],
        ['https://fake-user:fake-password@openrouter.ai/api/v1/chat/completions', { method: 'POST' }],
        ['http://openrouter.ai/api/v1/chat/completions', { method: 'POST' }],
      ]) await rejectRequest(input, init);
      equal(live.blocked.length, 11);
      equal(requests.length, 3);
      equal((await globalThis.fetch(`${localOrigin}/rest/v1/rpc/chat_admit`, { method: 'POST' })).status, 200);
      equal(requests.at(-1).url, `${localOrigin}/rest/v1/rpc/chat_admit`);
    } finally { live.restore(); }
    equal(globalThis.fetch, syntheticFetch);
    globalThis.fetch = () => { throw new Error('Network forbidden in preview credential tests'); };
  });
  console.log(`Passed ${groups} groups and ${assertions} assertions. No real credentials or network used.`);
} finally {
  globalThis.fetch = originalFetch;
  const resolvedTemporary = path.resolve(temporary);
  if (!resolvedTemporary.startsWith(path.resolve(temporaryRoot) + path.sep)) throw new Error('Unexpected temporary test directory');
  await rm(resolvedTemporary, { recursive: true, force: true });
}
