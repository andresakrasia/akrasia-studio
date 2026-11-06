import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--port');
const port = index === -1 ? 4323 : Number(process.argv[index + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid synthetic preview port');
const html = await readFile(path.join(root, 'scripts/safe-rendering-test.html'), 'utf8');
const network = installFetchGuard([]);
// No Astro adapter, project Vite configuration, .env or API handler is loaded.
// Inline events are deliberately allowed so the canary proves the browser tests
// are testing the renderer rather than relying on CSP to suppress XSS.
const csp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
const vite = await createServer({
  root, configFile: false, envFile: false, appType: 'custom', logLevel: 'warn',
  cacheDir: path.join(root, 'node_modules/.vite-a03-rendering'),
  server: {
    host: 'localhost', port, strictPort: true, hmr: false, watch: null,
    fs: { strict: true, allow: [root], deny: ['.env', '.env.*', '**/.git/**', '**/.aws/**', '**/.codex/**', '**/.agents/**'] },
    headers: { 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  },
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  optimizeDeps: { force: true, noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'] },
  plugins: [{
    name: 'synthetic-rendering-only',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const url = new URL(request.url || '/', `http://localhost:${port}`);
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405; response.end('Synthetic presentation test: no writes.'); return;
        }
        if (url.pathname === '/' || url.pathname === '/a03-test') {
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.setHeader('Content-Security-Policy', csp);
          response.setHeader('Cache-Control', 'no-store');
          try { response.end(await server.transformIndexHtml(url.pathname, html)); }
          catch (error) { next(error); }
          return;
        }
        // Vite only receives fixture/source/dependency modules. Production pages,
        // APIs, environment files and public assets are never exposed here.
        if (!/^(?:\/scripts\/(?:safe-rendering-browser\.tsx|safe-rendering-cases\.mjs)|\/src\/(?:components|hooks|lib)\/[^?]+\.(?:tsx?|mjs)|\/node_modules\/|\/@(?:id|fs|vite)\/)/u.test(url.pathname)) {
          response.statusCode = 404; response.end('Synthetic fixture only.'); return;
        }
        next();
      });
    },
  }],
});
await vite.listen();
console.log(`Synthetic A03 rendering tests: http://localhost:${port}/`);
console.log('Real chat UI and DOM helpers; synthetic SSE/history only. No .env or remote API is loaded.');
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await vite.close();
  network.restore();
}
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
