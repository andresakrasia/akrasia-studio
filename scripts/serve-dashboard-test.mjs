import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDashboardTestFixture } from './dashboard-auth-test-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portIndex = process.argv.indexOf('--port');
const port = portIndex === -1 ? 4322 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid synthetic preview port');
const origin = `http://localhost:${port}`;
const fixture = await createDashboardTestFixture();
const lifetimeIndex = process.argv.indexOf('--session-seconds');
if (lifetimeIndex !== -1) {
  const seconds = Number(process.argv[lifetimeIndex + 1]);
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 28800) {
    await fixture.close();
    throw new Error('Invalid synthetic session lifetime');
  }
  fixture.state.sessionLifetimeSeconds = seconds;
}
const emptyEnvDir = await mkdtemp(path.join(tmpdir(), 'akrasia-synthetic-env-'));
const child = spawn(process.execPath, [
  '--import', pathToFileURL(path.join(root, 'scripts/dashboard-test-network-guard.mjs')).href,
  path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', 'localhost', '--port', String(port),
  '--config', 'scripts/astro-dashboard-test.config.mjs',
], {
  cwd: root, windowsHide: true, stdio: 'inherit',
  env: {
    ...process.env, ...fixture.environment(origin), ASTRO_TELEMETRY_DISABLED: '1',
    AKRASIA_TEST_ENV_DIR: emptyEnvDir,
    AKRASIA_TEST_ALLOWED_ORIGINS: JSON.stringify([fixture.origin, origin]),
  },
});
console.log(`Synthetic dashboard preview: ${origin}/dashboard/login`);
console.log('Password: exported TEST_PASSWORD in scripts/dashboard-auth-test-fixture.mjs (synthetic only).');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  child.kill();
  await fixture.close();
  const temporaryRoot = path.resolve(tmpdir());
  const resolvedTarget = path.resolve(emptyEnvDir);
  if (!resolvedTarget.startsWith(`${temporaryRoot}${path.sep}`)) throw new Error('Synthetic environment directory escaped temporary root');
  await rm(emptyEnvDir, { recursive: true, force: true });
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
child.on('exit', async code => { await close(); process.exitCode = code ?? 0; });
child.on('error', async () => {
  console.error('The synthetic preview could not start.');
  await close();
  process.exitCode = 1;
});
