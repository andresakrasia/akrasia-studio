import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError, sbQuery } from '../../../lib/dashboard';

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  const url = new URL(request.url);
  const visitorId = url.searchParams.get('visitor_id');

  let convQuery = 'order=created_at.desc&limit=200';
  if (visitorId) convQuery += `&visitor_id=eq.${visitorId}`;

  const conversations = await sbQuery('conversations', convQuery);

  if (!conversations || conversations.length === 0) return dashResponse([]);

  const convIds = conversations.map((c: { id: string }) => c.id).join(',');
  const allMessages = await sbQuery(
    'messages',
    `order=created_at.asc&conversation_id=in.(${convIds})`
  ).catch(() => []);

  const messagesByConv: Record<string, unknown[]> = {};
  if (Array.isArray(allMessages)) {
    for (const msg of allMessages) {
      const cid = msg.conversation_id;
      if (!messagesByConv[cid]) messagesByConv[cid] = [];
      messagesByConv[cid].push(msg);
    }
  }

  const result = conversations.map((c: { id: string; [k: string]: unknown }) => ({
    ...c,
    messages: messagesByConv[c.id] || [],
  }));

  return dashResponse(result);
};
