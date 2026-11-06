import type { APIRoute } from 'astro';
import { createChatHandler } from '../../lib/chat-handler';
import { readChatConfig } from '../../lib/chat-security';
import { openRouterProvider } from '../../lib/chat-provider';
import { saveChatEffects } from '../../lib/chat-effects';

const handler = createChatHandler({
  config: () => readChatConfig(import.meta.env, import.meta.env.PROD, false),
  provider: openRouterProvider,
  effects: saveChatEffects,
});

export const POST: APIRoute = context => handler({
  request: context.request,
  // Access Astro's socket address only locally; the Vercel adapter uses XFF.
  clientAddress: import.meta.env.PROD ? undefined : context.clientAddress,
});
