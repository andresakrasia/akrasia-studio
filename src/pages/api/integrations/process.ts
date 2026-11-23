import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { processIntegrationBatch } from '../../../lib/integration-outbox';
import { integrationRpc } from '../../../lib/integration-store';
export const POST: APIRoute = async ({ request }) => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const respond = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers });
  const secret = import.meta.env.INTEGRATION_WORKER_SECRET || ''; const supplied = request.headers.get('authorization') || '';
  if (!/^[a-fA-F0-9]{64}$/.test(secret)) return respond({ error: 'worker_not_configured' }, 503);
  if ([import.meta.env.CHAT_SESSION_SECRET,import.meta.env.DASHBOARD_SESSION_SECRET,import.meta.env.RETENTION_CRON_SECRET,import.meta.env.SUPABASE_SERVICE_ROLE_KEY].includes(secret)) return respond({error:'worker_not_configured'},503);
  const expected = `Bearer ${secret}`;
  if (!/^Bearer [a-fA-F0-9]{64}$/.test(supplied) || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) return respond({ error: 'unauthorized' }, 401);
  if (new URL(request.url).search || request.body || request.headers.has('cookie') || request.headers.has('origin')) return respond({ error: 'invalid_request' }, 400);
  const limit = Number(import.meta.env.INTEGRATION_WORKER_BATCH || 5);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10) return respond({ error: 'worker_not_configured' }, 503);
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(55000)]);
    const result = await processIntegrationBatch(limit, signal);
    const cleaned = await integrationRpc('integration_retention', { p_days: 90, p_limit: 100 }, signal);
    if (!Number.isSafeInteger(cleaned) || (cleaned as number)<0 || (cleaned as number)>100) throw new Error();
    return respond({ ...result, cleaned });
  } catch { return respond({ error: 'integration_unavailable' }, 503); }
};
