import type { APIRoute } from 'astro';
import { readChatConfig, chatSession, ChatFailure } from '../../../lib/chat-security';
import { ownedBooking } from '../../../lib/bookings';
import { calendarResponse } from '../../../lib/booking-calendar';
import { isVisitorUuid } from '../../../lib/visitor-data';
export const GET: APIRoute = async ({ request }) => {
  try {
    const url = new URL(request.url); const ids = url.searchParams.getAll('id');
    if (ids.length !== 1 || !isVisitorUuid(ids[0]) || [...url.searchParams].some(([key]) => key !== 'id') || request.headers.get('sec-fetch-site') === 'cross-site')
      throw new ChatFailure('invalid_request', 400);
    const config = readChatConfig(import.meta.env, import.meta.env.PROD, false); const session = chatSession(request, config);
    if (session.cookie) throw new ChatFailure('invalid_chat_session', 401);
    const row = await ownedBooking(session.id, ids[0], 'get', AbortSignal.any([request.signal, AbortSignal.timeout(10000)]));
    return calendarResponse({ id: row.id as string, date: row.booked_date as string, time: (row.booked_time as string).slice(0,5),
      duration: row.duration_min as number, meetUrl: row.meet_url as string, status: row.status as string });
  } catch (error) {
    const failure = error instanceof ChatFailure ? error : new ChatFailure('booking_unavailable', 503);
    return new Response(JSON.stringify({ error: failure.code }), { status: failure.status, headers: { 'Content-Type':'application/json', 'Cache-Control':'no-store, private', 'X-Content-Type-Options':'nosniff' } });
  }
};
