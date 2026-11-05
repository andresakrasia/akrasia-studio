import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4330;
const origin = `http://localhost:${port}`;
const emptyEnvDir = await mkdtemp(path.join(tmpdir(), 'akrasia-a09-legal-env-'));
const child = spawn(process.execPath, [
  '--import', pathToFileURL(path.join(root, 'scripts/dashboard-test-network-guard.mjs')).href,
  path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', 'localhost', '--port', String(port),
  '--config', 'scripts/astro-legal-test.config.mjs',
], { cwd: root, windowsHide: true, stdio: 'inherit', env: {
  ...process.env, ASTRO_TELEMETRY_DISABLED: '1', AKRASIA_TEST_ENV_DIR: emptyEnvDir,
  AKRASIA_TEST_ALLOWED_ORIGINS: JSON.stringify([origin]),
  // Explicitly override service credentials possibly inherited from a shell.
  SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
  CHAT_SESSION_SECRET: '', CHAT_ORIGIN: origin, OPENROUTER_API_KEY: '',
  RESEND_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
  DASHBOARD_PASSWORD_HASH: '', DASHBOARD_AUTH_SECRET: '', RETENTION_CRON_SECRET: '',
  PUBLIC_GTM_CONTAINER_REVIEWED: 'false', PUBLIC_GTM_CONTAINER_ID: 'GTM-SYNTHETIC09',
  CHAT_RETENTION_DAYS: '30', CHAT_PROFILE_RETENTION_DAYS: '90', NOTIFICATION_RETENTION_DAYS: '90',
  CHAT_SESSION_SECONDS: '86400',
} });
console.log(`A09 read-only legal preview: ${origin}/privacidad`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  child.kill();
  const resolved = path.resolve(emptyEnvDir);
  if (!resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}`)) throw new Error('Unexpected temporary directory');
  await rm(resolved, { recursive: true, force: true });
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
child.on('exit', async code => { await close(); process.exitCode = code ?? 0; });
