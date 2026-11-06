import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const network = installFetchGuard([]);
const html = await readFile(path.join(root, 'scripts/privacy-chat-test.html'), 'utf8');
// These side-effect styles are the complete non-module dependencies of the
// real ChatDesktop/MeetingGuide used by this isolated browser regression.
const fixtureStyles = new Set(['/src/styles/meeting-guide.css', '/src/styles/studio-core.css', '/src/styles/chat-project-cards.css']);
const vite = await createServer({ root, configFile: false, envFile: false, appType: 'custom', logLevel: 'warn', cacheDir: path.join(root, 'node_modules/.vite-a09-chat'),
  server: { host: 'localhost', port: 4329, strictPort: true, hmr: false, watch: null, fs: { strict: true, allow: [root], deny: ['.env', '.env.*', '**/.git/**', '**/.aws/**'] },
    headers: { 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'none'; frame-src 'none'; font-src 'none'; base-uri 'none'; form-action 'none'", 'Cache-Control': 'no-store' } },
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' }, optimizeDeps: { force: true, noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'marked', 'entities'] },
  plugins: [{ name: 'a09-synthetic-chat-only', configureServer(server) { server.middlewares.use(async (req, res, next) => { const pathname = new URL(req.url || '/', 'http://localhost:4329').pathname;
    if (!['GET', 'HEAD'].includes(req.method || '')) { res.statusCode = 405; res.end('No real API writes'); return; }
    if (pathname === '/') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(await server.transformIndexHtml('/', html)); return; }
    if (!fixtureStyles.has(pathname) && !/^(?:\/scripts\/privacy-chat-browser\.tsx|\/src\/(?:hooks|lib|components)\/[^?]+\.tsx?|\/node_modules\/|\/@(?:id|fs|vite)\/)/u.test(pathname)) { res.statusCode = 404; res.end('Synthetic fixture only'); return; } next();
  }); } }] });
await vite.listen(); console.log('A09 synthetic chat lifecycle: http://localhost:4329/');
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void vite.close().then(() => network.restore()); });
