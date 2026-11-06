import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { loadPreviewChatProvider } from './chat-first-live-provider.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 4323 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid audit port');
// A distinct hostname keeps both localStorage and cookies separate from the
// user's localhost preview; cookie scopes do not distinguish TCP ports.
const origin = `http://127.0.0.1:${port}`;
const provider = await loadPreviewChatProvider({ enabled: process.argv.includes('--live-chat') });
const directory = path.join(root, '.codex-tmp');
await mkdir(directory, { recursive: true });
const statePath = path.join(directory, `client-journey-audit-${port}-state.json`);
const secretPath = path.join(directory, `client-journey-audit-${port}-session-key.txt`);
// Private local signing key, kept alongside the ignored synthetic snapshot.
// Restore keeps visitor cookies useful without ever sharing a real session.
let chatSessionSecret;
try { chatSessionSecret = (await readFile(secretPath, 'utf8')).trim(); }
catch (error) { if (error.code !== 'ENOENT') throw error; chatSessionSecret = randomBytes(32).toString('hex'); await writeFile(secretPath, chatSessionSecret); }
const fixture = await createChatFirstPreviewFixture({ chatSessionSecret, syntheticBookingSlots: [{ date: '2026-10-05', time: '10:00' }] });
if (process.argv.includes('--restore')) {
  const data = JSON.parse(await readFile(statePath, 'utf8'));
  for (const [table, rows] of Object.entries(data)) {
    if (!(table in fixture.tables) || !Array.isArray(rows)) throw new Error('Invalid audit snapshot');
    // Keep dashboard authorization ephemeral; visitor ownership rows restore
    // with the separately preserved chat signing key.
    if (!['dashboard_sessions','chat_sessions'].includes(table)) fixture.tables[table] = rows;
  }
}
await writeFile(path.join(directory, `client-journey-audit-${port}-fixture.json`), JSON.stringify({
  origin: fixture.origin, dashboardOrigin: fixture.dashboard.origin, chatOrigin: fixture.chat.origin,
  tables: Object.keys(fixture.tables), port,
}, null, 2));
await writeFile(statePath, JSON.stringify(fixture.tables, null, 2));
const environmentDirectory = await mkdtemp(path.join(tmpdir(), 'akrasia-client-journey-audit-'));
const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'scripts/dashboard-test-network-guard.mjs')).href,
  path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', '127.0.0.1', '--port', String(port), '--ignore-lock',
  '--config', 'scripts/astro-projects-test.config.mjs'], { cwd: root, windowsHide: true, stdio: 'inherit', env: {
    ...process.env, ...fixture.environment(origin), OPENROUTER_API_KEY: provider.apiKey,
    RESEND_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
    ASTRO_TELEMETRY_DISABLED: '1', AKRASIA_TEST_ENV_DIR: environmentDirectory,
    AKRASIA_TEST_ALLOWED_ORIGINS: JSON.stringify([origin, ...fixture.allowedOrigins]),
    AKRASIA_PREVIEW_LIVE_CHAT: provider.apiKey ? '1' : '0',
  } });
await writeFile(path.join(directory, `client-journey-audit-${port}-processes.json`), JSON.stringify({ launcherPid:process.pid, serverPid:child.pid, port }));
console.log(`Client lifecycle audit: ${origin}. Private synthetic customer data; real email and Telegram disabled.`);
let closing = false;
async function close() {
  if (closing) return; closing = true;
  await writeFile(statePath, JSON.stringify(fixture.tables, null, 2));
  child.kill(); await fixture.close();
  const target = path.resolve(environmentDirectory);
  if (!target.startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unexpected temporary directory');
  await rm(target, { recursive: true, force: true });
}
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
child.once('exit', async code => { await close(); process.exitCode = code ?? 0; });
child.once('error', async () => { await close(); process.exitCode = 1; });
