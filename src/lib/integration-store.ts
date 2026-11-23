import { ChatFailure } from './chat-security';
/** Service-only RPCs; failures never look like an empty agenda. */
export async function integrationRpc(name: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  const url = import.meta.env.SUPABASE_URL; const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !/^[a-z_]+$/.test(name)) throw new ChatFailure('integration_unavailable', 503);
  try {
    const deadline = AbortSignal.timeout(8000);
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/rpc/${name}`, { method: 'POST', cache: 'no-store', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline, headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) { await response.body?.cancel(); throw new Error('rpc_failed'); }
    const result = await response.json();
    if (result?.error === 'chat_context_changed') throw new ChatFailure('chat_context_changed', 409);
    if (result?.error === 'invalid_reference') throw new ChatFailure('invalid_reference', 403);
    return result;
  } catch (error) { if (error instanceof ChatFailure) throw error; throw new ChatFailure('integration_unavailable', 503); }
}
