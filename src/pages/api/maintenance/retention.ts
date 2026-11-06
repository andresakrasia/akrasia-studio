import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { readChatStorageConfig } from '../../../lib/chat-security';
import { privateChatJson, runRetention } from '../../../lib/chat-lifecycle';
import { readRetentionConfig } from '../../../lib/privacy-retention';

// Invoke explicitly from a reviewed platform job/CLI with POST. This repository
// does not create a recurring account automation or execute cleanup remotely.
export const POST: APIRoute = async ({ request }) => {
  const secret = String(import.meta.env.RETENTION_CRON_SECRET || '');
  const supplied = request.headers.get('authorization') || '';
  if (!/^[a-f0-9]{64,128}$/i.test(secret)) return privateChatJson({ error: 'retention_unavailable' }, 503);
  if (!/^Bearer [a-f0-9]{64,128}$/i.test(supplied) || supplied.length !== secret.length + 7 || !timingSafeEqual(Buffer.from(supplied), Buffer.from(`Bearer ${secret}`))) return privateChatJson({ error: 'unauthorized' }, 401);
  if (new URL(request.url).search || request.headers.has('cookie') || request.headers.has('origin')) return privateChatJson({ error: 'invalid_request' }, 403);
  try {
    const config = readChatStorageConfig(import.meta.env, import.meta.env.PROD);
    if ([config.secret, config.serviceKey, config.apiKey, String(import.meta.env.DASHBOARD_SESSION_SECRET || '')].includes(secret)) return privateChatJson({ error: 'retention_unavailable' }, 503);
    const { deferred = false, ...counts } = await runRetention(config, readRetentionConfig(import.meta.env), request.signal);
    return privateChatJson({ completed: !deferred, deferred, counts, moreMayRemain: true });
  } catch { return privateChatJson({ error: 'retention_unavailable' }, 503); }
};
