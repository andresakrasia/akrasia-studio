import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = await mkdtemp(path.join(tmpdir(), 'akrasia-check-'));
try {
  const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root,'scripts/dashboard-test-network-guard.mjs')).href,
    path.join(root,'node_modules/astro/bin/astro.mjs'), 'check', '--config','scripts/astro-isolated-build.config.mjs', '--tsconfig','tsconfig.json'], {
    cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env,
      ASTRO_TELEMETRY_DISABLED: '1', AKRASIA_TEST_ENV_DIR: environment, AKRASIA_TEST_ALLOWED_ORIGINS: '[]',
      SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '', OPENROUTER_API_KEY: '', RESEND_API_KEY: '',
      TELEGRAM_BOT_TOKEN: '', TELEGRAM_CHAT_ID: '', CHAT_SESSION_SECRET: '', DASHBOARD_PASSWORD_HASH: '',
    },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error',reject); child.once('exit', code => resolve(code ?? 1)); });
} finally {
  if (!path.resolve(environment).startsWith(path.resolve(tmpdir()) + path.sep + 'akrasia-check-')) throw new Error('Unsafe temporary path');
  await rm(environment,{recursive:true,force:true});
}
