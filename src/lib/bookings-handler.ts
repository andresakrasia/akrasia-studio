import {
  checkAvailability, createBooking, formatDateES, getNextAvailableSlots, getAvailableSlotsRange, parseBookingRequest,
  ownedBooking,
} from './bookings';
import { randomUUID } from 'node:crypto';
import { ChatFailure, chatSession, clearChatCookie, quotaKey, resolveChatIp, chatQuotaStore, type ChatConfig, type ChatQuotaStore } from './chat-security';
import { chatLifecycleStore, isContextVersion, type ChatLifecycleStore } from './chat-lifecycle';
import { isCivilDate, isCivilTime, STUDIO_TIME_ZONE } from './civil-time';
import { validEmail } from './integration-outbox';
import { isVisitorUuid, requireOwnedConversation } from './visitor-data';

interface BookingBody {
  visitor_id?: string;
  conversation_id?: string;
  text?: string;
  booked_date?: string;
  booked_time?: string;
  visitor_email?: string;
  visitor_phone?: string;
  visitor_name?: string;
  action?: 'availability' | 'create' | 'get' | 'cancel';
  booking_id?: string;
  contextVersion?: number;
}

export interface BookingDependencies {
  config: () => ChatConfig;
  now?: () => number;
  requireConversation?: typeof requireOwnedConversation;
  create?: typeof createBooking;
  availability?: typeof checkAvailability;
  slots?: typeof getNextAvailableSlots;
  rangeSlots?: typeof getAvailableSlotsRange;
  quotaStore?: ChatQuotaStore;
  lifecycle?: ChatLifecycleStore;
  owned?: typeof ownedBooking;
}

const referenceKeys = ['visitor_id', 'conversation_id', 'lead_id', 'contact_id', 'booking_id'];

function json(data: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json', 'Cache-Control': 'no-store, private',
    'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

function failure(error: unknown, cookie?: string): Response {
  const value = error instanceof ChatFailure ? error : new ChatFailure('booking_unavailable', 503);
  return json({ error: value.code }, value.status, cookie);
}

function validDate(value: unknown): value is string {
  return isCivilDate(value);
}

function validTime(value: unknown): value is string {
  return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const stop = () => reject(signal.reason);
    signal.addEventListener('abort', stop, { once: true });
    promise.then(value => { signal.removeEventListener('abort', stop); resolve(value); },
      error => { signal.removeEventListener('abort', stop); reject(error); });
  });
}

async function readBody(request: Request, config: ChatConfig, signal: AbortSignal): Promise<BookingBody> {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json' ||
    (request.headers.get('content-encoding') || 'identity') !== 'identity') throw new ChatFailure('invalid_request', 400);
  const limit = Math.min(config.maxBodyBytes, 8192);
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new ChatFailure('request_too_large', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ChatFailure('invalid_request', 400);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let text = '';
  let size = 0;
  try {
    while (true) {
      const { value, done } = await abortable(reader.read(), signal);
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new ChatFailure('request_too_large', 413);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } catch (error) {
    void reader.cancel().catch(() => {});
    if (error instanceof ChatFailure || signal.aborted) throw error;
    throw new ChatFailure('invalid_request', 400);
  } finally { reader.releaseLock(); }

  let input: unknown;
  try { input = JSON.parse(text); } catch { throw new ChatFailure('invalid_request', 400); }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ChatFailure('invalid_request', 400);
  const body = input as Record<string, unknown>;
  // These references have no public booking contract. A supplied ID must never
  // select an existing contact/lead/booking, even if its UUID is known.
  if (['lead_id', 'contact_id'].some(key => key in body)) throw new ChatFailure('invalid_reference', 403);
  if (Object.keys(body).some(key => !['visitor_id','conversation_id','text','booked_date','booked_time','visitor_email','visitor_phone','visitor_name','action','booking_id','contextVersion'].includes(key))) throw new ChatFailure('invalid_request', 400);
  for (const key of ['visitor_id', 'conversation_id']) {
    if (key in body && !isVisitorUuid(body[key])) throw new ChatFailure('invalid_request', 400);
  }
  const strings: Record<string, number> = {
    text: config.maxMessageChars, visitor_email: 254, visitor_phone: 64, visitor_name: 150,
  };
  for (const [key, maximum] of Object.entries(strings)) {
    if (key in body && (typeof body[key] !== 'string' || (body[key] as string).length > maximum ||
      /[\u0000-\u001f\u007f]/.test(body[key] as string))) throw new ChatFailure('invalid_request', 400);
  }
  if ('action' in body && !['availability','create','get','cancel'].includes(String(body.action))) throw new ChatFailure('invalid_request', 400);
  if (body.action==='get' || body.action==='cancel') { if (!isVisitorUuid(body.booking_id)) throw new ChatFailure('invalid_request',400); return body as BookingBody; }
  if ('booking_id' in body) throw new ChatFailure('invalid_reference',403);
  if (body.action === 'availability') {
    if (!(isCivilDate(body.booked_date) && isCivilTime(body.booked_time)) && (typeof body.text !== 'string' || !body.text.trim())) throw new ChatFailure('invalid_request', 400);
  } else if (!validDate(body.booked_date) || !validTime(body.booked_time)) {
    throw new ChatFailure('invalid_request', 400);
  }
  if (body.action!=='availability' && (!isContextVersion(body.contextVersion) || !validEmail(body.visitor_email))) throw new ChatFailure('invalid_request',400);
  return body as BookingBody;
}

export function createBookingHandlers(dependencies: BookingDependencies) {
  const availability = dependencies.availability || checkAvailability;
  const slots = dependencies.slots || getNextAvailableSlots;
  const rangeSlots = dependencies.rangeSlots || getAvailableSlotsRange;
  const create = dependencies.create || createBooking;
  const requireConversation = dependencies.requireConversation || requireOwnedConversation;

  const POST = async ({ request, clientAddress }: { request: Request; clientAddress?: string }): Promise<Response> => {
    if (request.method !== 'POST') return failure(new ChatFailure('invalid_request', 405));
    let config: ChatConfig;
    try { config = dependencies.config(); } catch { return failure(new ChatFailure('booking_unavailable', 503)); }
    if (request.headers.get('origin') !== config.origin || request.headers.get('sec-fetch-site') === 'cross-site') {
      return failure(new ChatFailure('invalid_request', 403));
    }
    let visitorId: string;
    let expiresAt: number;
    try {
      const session = chatSession(request, config, (dependencies.now || Date.now)());
      // Booking never creates an anonymous session. History/chat issue a
      // new identity; legacy UUID cookies cannot prove ownership.
      if (session.cookie) return failure(new ChatFailure('invalid_chat_session', 401));
      visitorId = session.id;
      expiresAt = session.expiresAt;
    } catch (error) {
      return failure(error, error instanceof ChatFailure && error.code === 'invalid_chat_session' ? clearChatCookie(config) : undefined);
    }
    const url = new URL(request.url);
    if (referenceKeys.some(key => url.searchParams.has(key))) return failure(new ChatFailure('invalid_reference', 403));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(config.providerTimeoutMs)]);
    let leaseId: string | undefined;
    const quota = dependencies.quotaStore || chatQuotaStore;
    try {
      const body = await readBody(request, config, signal);
      if (body.visitor_id && body.visitor_id !== visitorId) throw new ChatFailure('invalid_reference', 403);
      const requestId = request.headers.get('x-booking-request-id');
      if (body.action !== 'availability' && body.action !== 'get' && body.action !== 'cancel' && !isVisitorUuid(requestId)) throw new ChatFailure('invalid_request', 400);
      if (body.conversation_id) await requireConversation(visitorId, body.conversation_id, signal);
      leaseId = randomUUID();
      const admission = await quota.admit(config,quotaKey('session',visitorId),quotaKey('ip',resolveChatIp(request,config,clientAddress)),leaseId,1,signal);
      if (!admission.allowed) throw new ChatFailure(admission.reason==='busy'?'chat_busy':'chat_rate_limited',429,admission.retryAfter);
      signal.throwIfAborted();

      if (body.action==='get' || body.action==='cancel') return json({booking:await (dependencies.owned||ownedBooking)(visitorId,body.booking_id!,body.action,signal)});

      if (body.action === 'availability') {
        const parsed = isCivilDate(body.booked_date) && isCivilTime(body.booked_time) ? {date:body.booked_date,time:body.booked_time} : parseBookingRequest(body.text!,(dependencies.now||Date.now)());
        if (!parsed || !validDate(parsed.date) || !validTime(parsed.time)) return json({ error: 'invalid_request', available: false }, 400);
        const available = await availability(parsed.date, parsed.time, signal);
        signal.throwIfAborted();
        if (!available) {
          const alternatives = await slots(parsed.date, 3, signal);
          signal.throwIfAborted();
          return json({ available: false, requested: formatDateES(parsed.date, parsed.time),
            alternatives: alternatives.map(slot => formatDateES(slot.date, slot.time)) });
        }
        return json({ available: true, ...parsed, formatted: formatDateES(parsed.date, parsed.time) });
      }

      const date = body.booked_date!;
      const time = body.booked_time!;
      const state = await (dependencies.lifecycle || chatLifecycleStore).state(config,visitorId,expiresAt!,signal);
      if (state.contextVersion!==body.contextVersion) throw new ChatFailure('chat_context_changed',409);
      const booking = await create({ visitorId, bookingId:requestId!, contextVersion:state.contextVersion,sessionExpiresAt:expiresAt!,chatConfig:config,conversationId: body.conversation_id, bookedDate: date, bookedTime: time,
        visitorEmail: body.visitor_email, visitorPhone: body.visitor_phone, visitorName: body.visitor_name }, signal);
      signal.throwIfAborted();
      if (!booking) return json({ error: 'Slot no longer available', available: false }, 409);
      signal.throwIfAborted();
      return json({ success: true, notification:'queued',booking: {
        id: booking.id, booked_date: booking.booked_date, booked_time: booking.booked_time,
        duration_min: booking.duration_min, status: booking.status, meet_url: booking.meet_url,
      } });
    } catch (error) { return failure(error); }
    finally { if (leaseId) await quota.release(config,leaseId).catch(()=>{}); }
  };

  const GET = async ({ request }: { request: Request }): Promise<Response> => {
    if (request.method !== 'GET') return failure(new ChatFailure('invalid_request', 405));
    const url = new URL(request.url);
    if (referenceKeys.some(key => url.searchParams.has(key))) return failure(new ChatFailure('invalid_reference', 403));
    if ([...url.searchParams.keys()].some(key => !['date', 'mode', 'date_from', 'date_to'].includes(key)) ||
      [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) return failure(new ChatFailure('invalid_request', 400));
    const date = url.searchParams.get('date');
    const mode = url.searchParams.get('mode');
    const hasRange = url.searchParams.has('date_from') || url.searchParams.has('date_to');
    const from = hasRange ? url.searchParams.get('date_from') : date;
    const to = hasRange ? url.searchParams.get('date_to') : date;
    if (hasRange ? date !== null || mode !== null || !validDate(from) || !validDate(to) || to < from || Date.parse(to) - Date.parse(from) > 30 * 86400000
      : !validDate(date) || (mode !== null && mode !== 'day')) return failure(new ChatFailure('invalid_request', 400));
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(10000)]);
    try {
      if (hasRange || mode === 'day') {
        const available = await rangeSlots(from!, to!, signal, (dependencies.now || Date.now)());
        signal.throwIfAborted();
        return json({ ...(hasRange ? { date_from: from, date_to: to } : { date }), time_zone: STUDIO_TIME_ZONE, duration_min: 30,
          available_slots: available.map(slot => ({ date: slot.date, time: slot.time, formatted: formatDateES(slot.date, slot.time) })) });
      }
      const available = await slots(date!, 5, signal);
      signal.throwIfAborted();
      return json({ date, available_slots: available.map(slot => ({ date: slot.date, time: slot.time, formatted: formatDateES(slot.date, slot.time) })) });
    } catch (error) { return failure(error); }
  };
  return { POST, GET };
}
