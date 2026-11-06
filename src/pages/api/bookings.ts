import type { APIRoute } from 'astro';
import { createBookingHandlers } from '../../lib/bookings-handler';
import { readChatConfig } from '../../lib/chat-security';

const handlers = createBookingHandlers({ config: () => readChatConfig(import.meta.env, import.meta.env.PROD, false) });

export const POST: APIRoute = context => handlers.POST({ request: context.request, clientAddress: context.clientAddress });
export const GET: APIRoute = context => handlers.GET({ request: context.request });
