import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createProjectPublicationFixture } from './project-publication-test-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4325;
const origin = `http://localhost:${port}`;
const fixture = await createProjectPublicationFixture();
const emptyEnvDir = await mkdtemp(path.join(tmpdir(), 'akrasia-a06-env-'));
const child = spawn(process.execPath, [
  '--import', pathToFileURL(path.join(root, 'scripts/dashboard-test-network-guard.mjs')).href,
  path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', 'localhost', '--port', String(port),
  '--config', 'scripts/astro-projects-test.config.mjs',
], { cwd: root, windowsHide: true, stdio: 'inherit', env: {
  ...process.env, ...fixture.environment(origin), ASTRO_TELEMETRY_DISABLED: '1',
  AKRASIA_TEST_ENV_DIR: emptyEnvDir, AKRASIA_TEST_ALLOWED_ORIGINS: JSON.stringify([fixture.origin, origin]),
} });
console.log(`A06 synthetic preview: ${origin}/dashboard/login (synthetic password from dashboard fixture).`);
let closing = false;
async function close() {
  if (closing) return;
  closing = true; child.kill(); await fixture.close();
  if (!path.resolve(emptyEnvDir).startsWith(`${path.resolve(tmpdir())}${path.sep}`)) throw new Error('Unexpected temporary directory');
  await rm(emptyEnvDir, { recursive: true, force: true });
}
process.on('SIGINT', () => void close()); process.on('SIGTERM', () => void close());
child.on('exit', async code => { await close(); process.exitCode = code ?? 0; });
