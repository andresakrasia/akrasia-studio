import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { loadPreviewChatProvider } from './chat-first-live-provider.mjs';
import { createPreviewAgendaPersistence } from './preview-agenda-persistence.mjs';
import { createPreviewBookingsPersistence } from './preview-bookings-persistence.mjs';

// Real Astro/chat handlers and synthetic state. Live AI requires an explicit
// launch option; the default remains isolated from providers and local .env.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const portIndex = process.argv.indexOf('--port');
const port = portIndex < 0 ? 4322 : Number(process.argv[portIndex + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const origin = `http://localhost:${port}`;
const liveChat = process.argv.includes('--live-chat');
const provider = await loadPreviewChatProvider({ enabled: liveChat });
const bookingDemo = process.argv.includes('--booking-demo');
const youtubeDemo = process.argv.includes('--youtube-demo');
const slotDay = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
const fixture = await createChatFirstPreviewFixture({ youtubeDemo, syntheticBookingSlots: bookingDemo ? ['10:00','11:00','12:00'].map(time => ({ date: slotDay, time })) : [] });
let agendaPersistence, bookingsPersistence;
try {
  if (process.argv.includes('--preserve-agenda')) {
    agendaPersistence = await createPreviewAgendaPersistence({ root, port, tables: fixture.tables,
      onError: () => console.warn('Local preview agenda could not be saved. The previous snapshot is retained; saving will retry.') });
  }
  if (process.argv.includes('--preserve-bookings')) {
    bookingsPersistence = await createPreviewBookingsPersistence({ root, port, tables: fixture.tables,
      onError: () => console.warn('Local preview appointments could not be saved. The previous snapshot is retained; saving will retry.') });
  }
} catch (error) {
  await fixture.close();
  await Promise.allSettled([agendaPersistence?.close(), bookingsPersistence?.close()]);
  throw error;
}
const temporary = await mkdtemp(path.join(tmpdir(), 'akrasia-chat-first-preview-'));
const child = spawn(process.execPath, [
  '--import', pathToFileURL(path.join(root, 'scripts/dashboard-test-network-guard.mjs')).href,
  path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', 'localhost', '--port', String(port),
  // A disposable preview may run beside the main dev server on another port.
  '--ignore-lock',
  '--config', 'scripts/astro-projects-test.config.mjs',
], { cwd: root, windowsHide: true, stdio: 'inherit', env: {
  ...process.env, ...fixture.environment(origin), OPENROUTER_API_KEY: provider.apiKey,
  ASTRO_TELEMETRY_DISABLED: '1', AKRASIA_TEST_ENV_DIR: temporary,
  AKRASIA_TEST_ALLOWED_ORIGINS: JSON.stringify([origin, ...fixture.allowedOrigins]),
  AKRASIA_PREVIEW_LIVE_CHAT: liveChat ? '1' : '0',
  // Fictional DEMO clips stand in for the studio showreel in the local preview only.
  PUBLIC_SHOWREEL: process.env.PUBLIC_SHOWREEL || ['origen', 'pulse', 'nocturna', 'materia', 'horizonte'].map(name => `/media/demo-${name}.mp4`).join(','),
} });
console.log(youtubeDemo
  ? `Chat-first preview: ${origin}/. Six services, one labelled YouTube playback test, four local DEMO projects and local admin.`
  : `Chat-first preview: ${origin}/. Six services, five labelled DEMO projects with local synthetic clips and local admin.`);
if (youtubeDemo) console.log('YouTube demo enabled: Tears of Steel by Blender Foundation, not Akrasia work. External playback requires consent to external videos; the local cover is illustrative.');
console.log(liveChat
  ? 'Live AI enabled through the configured OpenRouter key. Database, admin data and integrations remain local demonstration fixtures.'
  : 'AI provider disabled. No .env, paid AI or real integrations. Predefined chat navigation remains available.');
console.log('Admin password: Synthetic administrator password 2026 (local fixture only).');
if (agendaPersistence) console.log('Local agenda preservation enabled for this port: weekly hours and date exceptions only.');
if (bookingsPersistence) console.log('Local appointment preservation enabled for this port: appointment records and their contact details only.');
let closing;
function close() {
  if (closing) return closing;
  closing = (async () => {
    child.kill();
    // Stop accepting requests and finish in-flight fixture writes before the
    // final opt-in snapshots. Session keys and other data are discarded.
    try { await fixture.close(); }
    finally {
      try {
        const results = await Promise.allSettled([agendaPersistence?.close(), bookingsPersistence?.close()]);
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
      }
      finally {
        const target = path.resolve(temporary);
        if (!target.startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Unexpected temporary directory');
        await rm(target, { recursive: true, force: true });
      }
    }
  })();
  return closing;
}
const cleanupFailure = () => { console.warn('Local preview cleanup failed. Check the private agenda snapshot before restarting.'); process.exitCode = 1; };
process.once('SIGINT', () => void close().catch(cleanupFailure));
process.once('SIGTERM', () => void close().catch(cleanupFailure));
child.once('exit', async code => { try { await close(); process.exitCode = code ?? 0; } catch { cleanupFailure(); } });
child.once('error', async () => { try { await close(); } catch { cleanupFailure(); } process.exitCode = 1; });
