import type { APIRoute } from 'astro';
import { ChatFailure, chatSession, clearChatCookie, readChatStorageConfig } from '../../lib/chat-security';
import { emptyVisitorHistory, loadVisitorData } from '../../lib/visitor-data';
import { chatLifecycleStore, chatCsrfToken, createChatEraseHandler, requireContextVersion } from '../../lib/chat-lifecycle';

function historyResponse(data: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private',
    'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

export const GET: APIRoute = async ({ request }) => {
  let config;
  try { config = readChatStorageConfig(import.meta.env, import.meta.env.PROD); }
  catch { return historyResponse({ error: 'chat_unavailable' }, 503); }
  let cookie: string | undefined;
  try {
    if (request.headers.get('sec-fetch-site') === 'cross-site') throw new ChatFailure('invalid_request', 403);
    const session = chatSession(request, config);
    const params = new URL(request.url).searchParams;
    if ([...params].some(([key, value]) => key !== 'visitor_id' || value !== session.id)) throw new ChatFailure('invalid_reference', 403);
    cookie = session.cookie;
    // A new identity has no proven connection to an old UUID. Never attach old data.
    const state = await chatLifecycleStore.state(config, session.id, session.expiresAt, request.signal);
    const data = cookie ? emptyVisitorHistory() : await loadVisitorData({ visitorId: session.id, config, signal: request.signal });
    await requireContextVersion(config, session.id, session.expiresAt, state.contextVersion, request.signal);
    return historyResponse({ ...data, ...state, csrfToken: chatCsrfToken(config, session, state.contextVersion), sessionId: session.id, sessionExpiresAt: session.expiresAt }, 200, cookie);
  } catch (error) {
    if (error instanceof ChatFailure && error.code === 'invalid_chat_session') cookie = clearChatCookie(config);
    const failure = error instanceof ChatFailure ? error : new ChatFailure('chat_unavailable', 503);
    return historyResponse({ error: failure.code }, failure.status, cookie);
  }
};

const eraseHandler = createChatEraseHandler({ config: () => readChatStorageConfig(import.meta.env, import.meta.env.PROD) });
export const DELETE: APIRoute = context => eraseHandler({ request: context.request });
