import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const emptyEnvDir = await mkdtemp(path.join(tmpdir(), 'akrasia-isolated-build-'));
const outputRoot = path.join(root, '.codex-tmp');
await mkdir(outputRoot, { recursive: true });
const isolatedOutput = await mkdtemp(path.join(outputRoot, 'isolated-output-'));
const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'scripts/dashboard-test-network-guard.mjs')).href,
  path.join(root, 'node_modules/astro/bin/astro.mjs'), 'build', '--config', 'scripts/astro-isolated-build.config.mjs'], { cwd: root, windowsHide: true, stdio: 'inherit', env: {
  ...process.env, ASTRO_TELEMETRY_DISABLED: '1', AKRASIA_TEST_ENV_DIR: emptyEnvDir, AKRASIA_TEST_ALLOWED_ORIGINS: '[]',
  AKRASIA_ISOLATED_OUTPUT_DIR: path.join(isolatedOutput, 'dist'),
  SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '', CHAT_SESSION_SECRET: '', CHAT_ORIGIN: '',
  OPENROUTER_API_KEY: '', RESEND_API_KEY: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '',
  DASHBOARD_PASSWORD_HASH: '', DASHBOARD_AUTH_SECRET: '', RETENTION_CRON_SECRET: '',
  INTEGRATION_WORKER_SECRET: '', BOOKING_MEETING_URL: '', EMAIL_FROM: '',
  PUBLIC_GTM_CONTAINER_REVIEWED: 'false', PUBLIC_GTM_CONTAINER_ID: 'GTM-SYNTHETIC09',
  CHAT_RETENTION_DAYS: '30', CHAT_PROFILE_RETENTION_DAYS: '90', NOTIFICATION_RETENTION_DAYS: '90',
} });
const code = await new Promise(resolve => child.once('exit', value => resolve(value ?? 1)));
if (!path.resolve(emptyEnvDir).startsWith(`${path.resolve(tmpdir())}${path.sep}`)) throw new Error('Unexpected temporary environment directory');
await rm(emptyEnvDir, { recursive: true, force: true });
if (!path.resolve(isolatedOutput).startsWith(path.resolve(outputRoot) + path.sep)) throw new Error('Unexpected isolated output directory');
await rm(isolatedOutput, { recursive: true, force: true });
if (code === 0) {
  const runtime = JSON.parse(await readFile(path.join(root, '.vercel/output/functions/_render.func/.vc-config.json'), 'utf8'));
  if (runtime.runtime !== 'nodejs24.x' || runtime.maxDuration !== 60 || runtime.supportsResponseStreaming !== true) {
    throw new Error('Built Vercel runtime/duration/streaming contract differs from production configuration');
  }
  await mkdir(path.join(root, 'docs/evidence'), { recursive: true });
  await writeFile(path.join(root, 'docs/evidence/runtime-local.json'), JSON.stringify({
    node: process.versions.node, scope: 'Isolated local build; no deployment or configured production credentials.', ...runtime,
  }, null, 2));
  console.log('PASS built Vercel contract: Node 24, 60 seconds, streaming enabled.');
}
process.exitCode = code;
