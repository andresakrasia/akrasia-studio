import projectConfig from '../astro.config.mjs';

// Render real legal pages with no local .env, external browser connection or
// write API. This previews information only, without creating visitors.
export default {
  ...projectConfig,
  vite: {
    ...projectConfig.vite,
    envDir: process.env.AKRASIA_TEST_ENV_DIR,
    server: { ...projectConfig.vite?.server, strictPort: true, headers: {
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://localhost:*; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'",
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    } },
    plugins: [{ name: 'legal-read-only-preview', configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url || '/', 'http://localhost:4330').pathname;
        if (!['GET', 'HEAD'].includes(request.method || '') || /^\/(?:api|dashboard)(?:\/|$)/.test(pathname)) {
          response.statusCode = 405; response.end('Read-only legal preview'); return;
        }
        next();
      });
    } }],
  },
};
