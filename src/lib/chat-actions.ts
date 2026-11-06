import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { checkAvailability, createBookingOnce, configuredMeetingUrl, type Booking } from './bookings';
import { ChatFailure, type ChatConfig } from './chat-security';
import { isVisitorUuid } from './visitor-data';
import type { ChatToolDefinition } from './chat-provider-contract';
import { isContextVersion } from './chat-lifecycle';
import { isCivilDate, isCivilTime, madridInstant } from './civil-time';

export const CHAT_BOOKING_TOOL: ChatToolDefinition = {
  type: 'function',
  function: {
    name: 'prepare_booking',
    description: 'Check a requested 30-minute call and present its exact details for the visitor to confirm. This does not reserve a call. Use only after the visitor requests a call and supplies an exact date, time and email. Times use Europe/Madrid. Never claim a booking or email was confirmed.',
    strict: true,
    parameters: {
      type: 'object', additionalProperties: false, required: ['date', 'time', 'email', 'name'],
      properties: {
        date: { type: 'string', description: 'Exact calendar date YYYY-MM-DD; never in the past.' },
        time: { type: 'string', description: 'Exact local time HH:MM in Europe/Madrid.' },
        email: { type: 'string', description: 'Email supplied by this visitor, at most 254 characters.' },
        name: { type: 'string', description: 'Visitor name, at most 150 characters; empty if not supplied.' },
      },
    },
  },
};
export const BOOKING_TOOL = CHAT_BOOKING_TOOL;

export interface BookingArguments { date: string; time: string; email: string; name: string }
export interface BookingProposal extends BookingArguments { token: string; expiresAt: number }
export interface VerifiedBookingProposal extends BookingArguments { visitorId: string; bookingId: string; expiresAt: number; contextVersion: number }
export type BookingActionResult =
  | { status: 'confirmation_required'; proposal: BookingProposal }
  | { status: 'unavailable' }
  | { status: 'confirmed'; booking: { id: string; date: string; time: string; duration_min: number; meet_url: string };
    notification: 'queued' | 'already_processed' };
export interface BookingActionContext { visitorId: string; config: ChatConfig; signal: AbortSignal; contextVersion?: number; sessionExpiresAt?: number; deadlineAt?: number }
export interface BookingPreparationContext extends BookingActionContext { sessionExpiresAt: number }
export interface BookingActionDependencies {
  availability?: typeof checkAvailability;
  create?: typeof createBookingOnce;
  now?: () => number;
}

const MAX_ARGUMENT_BYTES = 2048;
const MAX_TOKEN_CHARS = 2048;
const PROPOSAL_SECONDS = 300;
const argumentKeys = ['date', 'time', 'email', 'name'];
const tokenKeys = ['v', 'visitorId', 'bookingId', ...argumentKeys, 'expiresAt', 'contextVersion'];

function objectWithKeys(value: unknown, keys: string[]): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key)));
}

function madridToday(now: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function checkedArguments(value: unknown, now: number): BookingArguments {
  if (!objectWithKeys(value, argumentKeys)) throw new ChatFailure('invalid_request', 400);
  const { date, time, email, name } = value;
  if (!isCivilDate(date)) throw new ChatFailure('invalid_request', 400);
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== date || date < madridToday(now)) {
    throw new ChatFailure('invalid_request', 400);
  }
  if (!isCivilTime(time) || madridInstant(date, time) === null || madridInstant(date, time)! <= now ||
    typeof email !== 'string' || email.length > 254 ||
    !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(email) ||
    typeof name !== 'string' || name.length > 150 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new ChatFailure('invalid_request', 400);
  }
  return { date, time, email, name };
}

export function parseBookingArguments(raw: string, now = Date.now()): BookingArguments {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > MAX_ARGUMENT_BYTES) throw new ChatFailure('invalid_request', 400);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new ChatFailure('invalid_request', 400); }
  return checkedArguments(parsed, now);
}

function signature(payload: string, config: ChatConfig): Buffer {
  return createHmac('sha256', Buffer.from(config.secret, 'hex')).update(`akrasia-booking-proposal-v1:${payload}`).digest();
}

export function issueBookingProposal(args: BookingArguments, session: { id: string; expiresAt: number; contextVersion?: number }, config: ChatConfig,
  now = Date.now()): BookingProposal {
  const checked = checkedArguments(args, now);
  if (!isVisitorUuid(session.id) || !Number.isSafeInteger(session.expiresAt) || session.expiresAt <= Math.floor(now / 1000)) {
    throw new ChatFailure('invalid_chat_session', 401);
  }
  const expiresAt = Math.min(session.expiresAt, Math.floor(now / 1000) + PROPOSAL_SECONDS);
  const contextVersion = session.contextVersion ?? 0;
  if (!isContextVersion(contextVersion)) throw new ChatFailure('invalid_request', 400);
  const data = { v: 2, visitorId: session.id, bookingId: randomUUID(), ...checked, expiresAt, contextVersion };
  const payload = Buffer.from(JSON.stringify(data), 'utf8').toString('base64url');
  const token = `${payload}.${signature(payload, config).toString('base64url')}`;
  if (token.length > MAX_TOKEN_CHARS) throw new ChatFailure('invalid_request', 400);
  return { ...checked, token, expiresAt };
}

export function verifyBookingProposal(token: unknown, visitorId: string, config: ChatConfig, now = Date.now()): VerifiedBookingProposal {
  if (typeof token !== 'string' || token.length > MAX_TOKEN_CHARS || !isVisitorUuid(visitorId)) throw new ChatFailure('invalid_request', 400);
  const match = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) throw new ChatFailure('invalid_request', 400);
  const provided = Buffer.from(match[2], 'base64url');
  const expected = signature(match[1], config);
  if (provided.toString('base64url') !== match[2] || provided.length !== expected.length || !timingSafeEqual(provided, expected)) throw new ChatFailure('invalid_request', 400);
  let data: unknown;
  try { data = JSON.parse(Buffer.from(match[1], 'base64url').toString('utf8')); } catch { throw new ChatFailure('invalid_request', 400); }
  if (!objectWithKeys(data, tokenKeys) || data.v !== 2 || !isContextVersion(data.contextVersion) || !isVisitorUuid(data.visitorId) || !isVisitorUuid(data.bookingId) ||
    !Number.isSafeInteger(data.expiresAt) || (data.expiresAt as number) <= Math.floor(now / 1000) ||
    (data.expiresAt as number) > Math.floor(now / 1000) + PROPOSAL_SECONDS) throw new ChatFailure('invalid_request', 400);
  if (data.visitorId !== visitorId) throw new ChatFailure('invalid_reference', 403);
  const args = checkedArguments({ date: data.date, time: data.time, email: data.email, name: data.name }, now);
  return { ...args, visitorId, bookingId: data.bookingId, expiresAt: data.expiresAt as number, contextVersion: data.contextVersion };
}
export const validateBookingConfirmationToken = verifyBookingProposal;

function assertActionAlive(context: BookingActionContext): void {
  context.signal.throwIfAborted();
  if (context.deadlineAt !== undefined && performance.now() >= context.deadlineAt) throw new ChatFailure('chat_timeout', 504, 5);
}

export async function prepareBookingAction(call: { name: string; arguments: string }, context: BookingPreparationContext,
  dependencies: BookingActionDependencies = {}): Promise<BookingActionResult> {
  assertActionAlive(context);
  if (!call || call.name !== CHAT_BOOKING_TOOL.function.name) throw new ChatFailure('invalid_request', 400);
  const now = (dependencies.now || Date.now)();
  const args = parseBookingArguments(call.arguments, now);
  if (!isVisitorUuid(context.visitorId)) throw new ChatFailure('invalid_reference', 403);
  if (!Number.isSafeInteger(context.sessionExpiresAt) || context.sessionExpiresAt <= Math.floor(now / 1000)) {
    throw new ChatFailure('invalid_chat_session', 401);
  }
  const available = await (dependencies.availability || checkAvailability)(args.date, args.time, context.signal);
  assertActionAlive(context);
  if (available !== true && available !== false) throw new ChatFailure('booking_unavailable', 503);
  if (!available) return { status: 'unavailable' };
  return { status: 'confirmation_required', proposal: issueBookingProposal(args,
    { id: context.visitorId, expiresAt: context.sessionExpiresAt, contextVersion: context.contextVersion ?? 0 }, context.config, now) };
}

function safeConfirmedBooking(value: unknown, proposal: VerifiedBookingProposal): Booking {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatFailure('booking_unavailable', 503);
  const row = value as Booking;
  const safeMeet = typeof row.meet_url === 'string' && row.meet_url === configuredMeetingUrl(proposal.bookingId);
  if (row.id !== proposal.bookingId || row.visitor_id !== proposal.visitorId ||
    (row.conversation_id ?? null) !== null || (row.lead_id ?? null) !== null ||
    row.booked_date !== proposal.date || (row.booked_time !== proposal.time && row.booked_time !== `${proposal.time}:00`) ||
    row.duration_min !== 30 || row.buffer_min !== 30 || row.status !== 'confirmed' || !safeMeet ||
    row.visitor_email !== proposal.email || (row.visitor_name ?? '') !== proposal.name || (row.visitor_phone ?? null) !== null) {
    throw new ChatFailure('booking_unavailable', 503);
  }
  return row;
}

export async function confirmBookingAction(token: string, context: BookingActionContext,
  dependencies: BookingActionDependencies = {}): Promise<BookingActionResult> {
  assertActionAlive(context);
  const proposal = verifyBookingProposal(token, context.visitorId, context.config, (dependencies.now || Date.now)());
  if (proposal.contextVersion !== (context.contextVersion ?? 0)) throw new ChatFailure('chat_context_changed', 409);
  const created = await (dependencies.create || createBookingOnce)({ visitorId: proposal.visitorId, bookingId: proposal.bookingId,
    bookedDate: proposal.date, bookedTime: proposal.time, visitorEmail: proposal.email, visitorName: proposal.name || null,
    contextVersion: proposal.contextVersion, sessionExpiresAt: context.sessionExpiresAt, chatConfig: context.config }, context.signal);
  assertActionAlive(context);
  if (!created || typeof created.created !== 'boolean') throw new ChatFailure('booking_unavailable', 503);
  if (created.booking === null) return { status: 'unavailable' };
  const booking = safeConfirmedBooking(created.booking, proposal);
  // The booking RPC commits the notification jobs in the same transaction.
  const notification = created.created ? 'queued' : 'already_processed';
  context.signal.throwIfAborted();
  return { status: 'confirmed', booking: { id: booking.id, date: proposal.date, time: proposal.time,
    duration_min: booking.duration_min, meet_url: booking.meet_url }, notification };
}
