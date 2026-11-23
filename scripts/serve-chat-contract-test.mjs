import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--port');
const port = index === -1 ? 4327 : Number(process.argv[index + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid synthetic preview port');
const html = await readFile(path.join(root, 'scripts/chat-contract-test.html'), 'utf8');
const network = installFetchGuard([]);
const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const vite = await createServer({
  root, configFile: false, envFile: false, appType: 'custom', logLevel: 'warn',
  cacheDir: path.join(root, 'node_modules/.vite-a07-contract'),
  server: {
    host: 'localhost', port, strictPort: true, hmr: false, watch: null,
    fs: { strict: true, allow: [root], deny: ['.env', '.env.*', '**/.git/**', '**/.aws/**', '**/.codex/**', '**/.agents/**'] },
    headers: { 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  optimizeDeps: { force: true, noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'marked', 'entities'] },
  plugins: [{ name: 'synthetic-chat-contract-only', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url || '/', `http://localhost:${port}`);
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        response.statusCode = 405; response.end('Synthetic browser test: no API writes.'); return;
      }
      if (url.pathname === '/' || url.pathname === '/a07-test') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        try { response.end(await server.transformIndexHtml(url.pathname, html)); } catch (error) { next(error); }
        return;
      }
      if (!/^(?:\/scripts\/chat-contract-browser\.tsx|\/src\/(?:hooks|lib|components)\/[^?]+\.(?:tsx?|mjs)|\/src\/styles\/(?:meeting-guide|chat-project-cards|studio-core)\.css$|\/node_modules\/|\/@(?:id|fs|vite)\/)/u.test(url.pathname)) {
        response.statusCode = 404; response.end('Synthetic fixture only.'); return;
      }
      next();
    });
  } }],
});
await vite.listen();
console.log(`Synthetic A07 chat contract: http://localhost:${port}/`);
console.log('Real ChatProvider, BookingResult and FormattedText. Synthetic SSE/history only; no .env or remote API.');
let closing = false;
async function close() { if (closing) return; closing = true; await vite.close(); network.restore(); }
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
