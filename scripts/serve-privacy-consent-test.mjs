import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 4328;
const source = await readFile(path.join(root, 'src/components/PrivacyConsent.astro'), 'utf8');
// Exercise the actual production markup/styles and production bindings without
// loading Astro routes, .env, services or an external consent/tag manager.
const markup = source.slice(source.indexOf('<div id="privacyConsent"'), source.indexOf('<script>'))
  .replace('data-analytics-enabled={String(analyticsEnabled)}', 'data-analytics-enabled="true"')
  .replace('data-gtm-reviewed={String(analyticsOptions.analyticsEnabled)}', 'data-gtm-reviewed="true"')
  .replace('data-container-id={analyticsOptions.containerId}', 'data-container-id="GTM-SYNTHETIC"')
  .replace('data-measurement-id={analyticsOptions.measurementId}', 'data-measurement-id=""')
  .replace('data-ga4-reviewed={String(analyticsOptions.ga4Reviewed)}', 'data-ga4-reviewed="false"')
  .replace('disabled={!analyticsEnabled}', '')
  .replace('{!analyticsEnabled && <p>La analítica no está habilitada en este sitio.</p>}', '');
const styles = source.match(/<style is:global>([\s\S]+)<\/style>/)?.[1] || '';
const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>A09 privacidad ficticia</title>
<style>body{background:#050505;color:#e2e8f0;font:16px system-ui;padding:1rem}a{color:#7dd3fc}button{font:inherit}#results{white-space:pre-wrap;padding-bottom:6rem}dialog{color:#e2e8f0;background:#101820} ${styles}</style></head>
<body><h1>A09 · Preferencias ficticias</h1><p>Etiquetas y reproductores simulados en este equipo. El contenido usa el control de consentimiento real.</p><pre id="results" role="status">Comprobando…</pre><div id="videoFixture"></div>${markup}<script type="module" src="/scripts/privacy-consent-browser.tsx"></script></body></html>`;
const network = installFetchGuard([]);
const csp = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; font-src 'none'; frame-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const vite = await createServer({ root, configFile: false, envFile: false, appType: 'custom', logLevel: 'warn',
  cacheDir: path.join(root, 'node_modules/.vite-a09-privacy'),
  server: { host: 'localhost', port, strictPort: true, hmr: false, watch: null,
    fs: { strict: true, allow: [root], deny: ['.env', '.env.*', '**/.git/**', '**/.aws/**', '**/.codex/**', '**/.agents/**'] },
    headers: { 'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
  optimizeDeps: { force: true, noDiscovery: true, include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'] },
  plugins: [{ name: 'privacy-synthetic-only', configureServer(server) {
    server.middlewares.use(async (request, response, next) => {
      const url = new URL(request.url || '/', `http://localhost:${port}`);
      if (request.method !== 'GET' && request.method !== 'HEAD') { response.statusCode = 405; response.end('Synthetic fixture only.'); return; }
      if (url.pathname === '/mock-gtm.js') { response.setHeader('Content-Type', 'text/javascript'); response.end('window.__syntheticTagExecutions=(window.__syntheticTagExecutions||0)+1;'); return; }
      if (url.pathname === '/mock-video') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>Vídeo ficticio</title><p>Proveedor simulado, sin red externa.</p>'); return; }
      if (url.pathname === '/' || url.pathname === '/dashboard') {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        try { response.end(await server.transformIndexHtml(url.pathname, html)); } catch (error) { next(error); }
        return;
      }
      if (!/^(?:\/scripts\/privacy-consent-browser\.tsx|\/src\/(?:components|lib)\/[^?]+\.(?:tsx?|mjs)|\/node_modules\/|\/@(?:id|fs|vite)\/)/u.test(url.pathname)) {
        response.statusCode = 404; response.end('Synthetic fixture only.'); return;
      }
      next();
    });
  } }],
});
await vite.listen();
console.log(`A09 synthetic consent browser: http://localhost:${port}/ (no .env, external requests denied by CSP + mock tags/frames)`);
let closing = false;
async function close() { if (closing) return; closing = true; await vite.close(); network.restore(); }
process.once('SIGINT', () => void close()); process.once('SIGTERM', () => void close());
