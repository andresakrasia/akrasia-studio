import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Configuration and private API boundary only. No provider or .env access.
const network = installFetchGuard([]);
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'silent',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: { 'import.meta.env.PROD': 'false' } });
let checks = 0;
const eq = (actual, expected) => { checks++; assert.deepEqual(actual, expected); };
try {
  const { bookingNotificationStatus } = await vite.ssrLoadModule('/src/lib/booking-notification-status.ts');
  const route = await vite.ssrLoadModule('/src/pages/api/dashboard/bookings/notifications.ts');
  const base = { SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-database-key',
    RESEND_API_KEY: 'synthetic-email-key', EMAIL_FROM: 'Synthetic <sender@example.invalid>',
    INTEGRATION_WORKER_SECRET: 'ef'.repeat(32), BOOKING_ADMIN_EMAIL: 'info@akrasia.studio' };
  eq(bookingNotificationStatus({}), { recipient: 'info@akrasia.studio', state: 'disabled', scope: 'configuration_only', externalChecks: 'not_run' });
  eq(bookingNotificationStatus(base).state, 'configured');
  eq(bookingNotificationStatus({ ...base, RESEND_API_KEY: '' }).state, 'disabled');
  eq(bookingNotificationStatus({ ...base, EMAIL_FROM: '' }).state, 'invalid');
  eq(bookingNotificationStatus({ ...base, INTEGRATION_WORKER_SECRET: '' }).state, 'invalid');
  eq(bookingNotificationStatus({ ...base, INTEGRATION_WORKER_SECRET: 'invalid' }).state, 'invalid');
  eq(bookingNotificationStatus({ ...base, INTEGRATION_WORKER_SECRET: base.SUPABASE_SERVICE_ROLE_KEY }).state, 'invalid');
  for (const address of ['malformed', 'Admin <info@akrasia.studio>', 'info@akrasia.studio\nsecret', 'x'.repeat(255) + '@example.invalid']) {
    const value = bookingNotificationStatus({ ...base, BOOKING_ADMIN_EMAIL: address });
    eq(value.state, 'invalid'); eq(value.recipient, null);
  }
  const result = bookingNotificationStatus({ ...base, BOOKING_ADMIN_EMAIL: 'admin@example.invalid' });
  eq(result.recipient, 'admin@example.invalid');
  eq(Object.keys(result).sort(), ['externalChecks', 'recipient', 'scope', 'state']);
  const response = await route.GET({ request: new Request('http://localhost:4338/api/dashboard/bookings/notifications') });
  eq(response.status, 401); eq(await response.json(), { error: 'Unauthorized' });
  eq(network.blocked.length, 0);
  console.log(`PASS: ${checks} booking notification status checks; private configuration, no credentials or delivery claims.`);
} finally { await vite.close(); network.restore(); }
