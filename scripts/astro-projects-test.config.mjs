import config from './astro-dashboard-test.config.mjs';

// The synthetic browser loads local assets only; external providers stay blocked.
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' ws://localhost:*; frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'";
export default { ...config, vite: { ...config.vite, server: { ...config.vite?.server, headers: {
  'Content-Security-Policy': csp, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
} } } };
