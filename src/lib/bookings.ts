import { randomUUID } from 'node:crypto';
import { isVisitorUuid } from './visitor-data';
import { ChatFailure, type ChatConfig } from './chat-security';
import { integrationRpc } from './integration-store';
import { safeMeetingUrl } from './booking-calendar';
import { addCivilDays, civilWeekday, isCivilDate, isCivilTime, madridDateKey, madridInstant, formatCivilDateES } from './civil-time';
export interface BookingData {
  visitorId: string; conversationId?: string | null; leadId?: string | null; bookedDate: string; bookedTime: string;
  durationMin?: number; visitorEmail?: string | null; visitorPhone?: string | null; visitorName?: string | null; notes?: string | null;
  contextVersion?: number; sessionExpiresAt?: number; chatConfig?: ChatConfig;
}
export interface Booking { id: string; booked_date: string; booked_time: string; duration_min: number; buffer_min: number;
  status: string; meet_url: string; visitor_email: string; visitor_name: string; [key: string]: unknown }
export interface BookingCreation { booking: Booking | null; created: boolean }
/** Jitsi creates the conference when the authenticated host opens this URL. */
export function configuredMeetingUrl(bookingId?: string): string {
  const value = import.meta.env.BOOKING_MEETING_URL || '';
  if (value) return safeMeetingUrl(value);
  if (!isVisitorUuid(bookingId)) throw new ChatFailure('booking_unavailable', 503);
  const base = safeMeetingUrl(import.meta.env.JITSI_MEET_BASE_URL || 'https://meet.jit.si/');
  const url = new URL(base);
  if (base.length > 800 || url.pathname !== '/' || url.search) throw new ChatFailure('booking_unavailable', 503);
  // Random UUID per operation means no visitor data in the room, no shared room,
  // and the same link after an idempotent confirmation/retry.
  return new URL(`Akrasia-${bookingId.toLowerCase()}`, url).href;
}
export async function checkAvailability(date: string, time: string, signal?: AbortSignal): Promise<boolean> {
  if (!isCivilDate(date) || !isCivilTime(time) || madridInstant(date, time) === null) return false;
  const result = await integrationRpc('booking_available', { p_date: date, p_time: time }, signal);
  if (typeof result !== 'boolean') throw new ChatFailure('booking_unavailable', 503); return result;
}
export async function getNextAvailableSlots(startDate: string, count = 3, signal?: AbortSignal): Promise<Array<{ date: string; time: string }>> {
  if (!isCivilDate(startDate) || !Number.isSafeInteger(count) || count < 1 || count > 10) throw new ChatFailure('invalid_request', 400);
  const result = await integrationRpc('booking_slots', { p_date: startDate, p_count: count }, signal);
  if (!Array.isArray(result) || result.length > count || result.some(row => !row || !isCivilDate(row.date) || !isCivilTime(row.time) ||
    row.date < startDate || row.date > addCivilDays(startDate, 13) || madridInstant(row.date, row.time) === null) ||
    new Set(result.map(row => `${row.date} ${row.time}`)).size !== result.length) throw new ChatFailure('booking_unavailable', 503);
  return result;
}
export interface AvailableBookingSlot { date: string; time: string }
/** One bounded, service-only query for a visible calendar month or selected day. */
export async function getAvailableSlotsRange(startDate: string, endDate: string, signal?: AbortSignal, now = Date.now()): Promise<AvailableBookingSlot[]> {
  if (!isCivilDate(startDate) || !isCivilDate(endDate) || endDate < startDate || Date.parse(endDate) - Date.parse(startDate) > 30 * 86400000) {
    throw new ChatFailure('invalid_request', 400);
  }
  const result = await integrationRpc('booking_slots_range', { p_start_date: startDate, p_end_date: endDate }, signal);
  const lastBookableDate = addCivilDays(madridDateKey(now), 180);
  if (!Array.isArray(result) || result.length > 31 * 48 || result.some(row => {
    if (!row || !isCivilDate(row.date) || !isCivilTime(row.time) || row.date < startDate || row.date > endDate || row.date > lastBookableDate) return true;
    const instant = madridInstant(row.date, row.time);
    return instant === null || instant <= now;
  }) || new Set(result.map(row => `${row.date} ${row.time}`)).size !== result.length) throw new ChatFailure('booking_unavailable', 503);
  return result.map(row => ({ date: row.date, time: row.time }))
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}
export function checkedBooking(value: unknown, data: BookingData, id: string): Booking {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatFailure('booking_unavailable', 503);
  const row = value as Booking;
  if (row.id !== id || row.visitor_id !== data.visitorId || row.booked_date !== data.bookedDate ||
    ![data.bookedTime, `${data.bookedTime}:00`].includes(row.booked_time) || row.duration_min !== 30 || row.buffer_min !== 30 ||
    !['confirmed', 'cancelled', 'completed'].includes(row.status) || row.meet_url !== configuredMeetingUrl(id) ||
    (row.visitor_email ?? null) !== (data.visitorEmail ?? null) || (row.visitor_name ?? null) !== (data.visitorName ?? null) ||
    (row.visitor_phone ?? null) !== (data.visitorPhone ?? null) || (row.conversation_id ?? null) !== (data.conversationId ?? null) ||
    (row.lead_id ?? null) !== (data.leadId ?? null)) throw new ChatFailure('booking_unavailable', 503);
  return row;
}
export async function createBookingOnce(data: BookingData & { bookingId: string }, signal?: AbortSignal): Promise<BookingCreation> {
  signal?.throwIfAborted();
  if (!isVisitorUuid(data.visitorId) || !isVisitorUuid(data.bookingId)) throw new ChatFailure('invalid_reference', 403);
  if (!isCivilDate(data.bookedDate) || !isCivilTime(data.bookedTime) || madridInstant(data.bookedDate, data.bookedTime) === null ||
    (data.durationMin !== undefined && data.durationMin !== 30) || !Number.isSafeInteger(data.contextVersion) ||
    !Number.isSafeInteger(data.sessionExpiresAt)) throw new ChatFailure('invalid_request', 400);
  const result = await integrationRpc('booking_create_once', { p_visitor_id: data.visitorId, p_expires_at: data.sessionExpiresAt,
    p_context_version: data.contextVersion, p_booking: { id: data.bookingId, visitor_id: data.visitorId, conversation_id: data.conversationId ?? null,
      lead_id: data.leadId ?? null, booked_date: data.bookedDate, booked_time: data.bookedTime, duration_min: 30, buffer_min: 30,
      meet_url: configuredMeetingUrl(data.bookingId), visitor_email: data.visitorEmail ?? null, visitor_phone: data.visitorPhone ?? null,
      visitor_name: data.visitorName ?? null, notes: data.notes ?? null } }, signal) as BookingCreation;
  if (!result || typeof result.created !== 'boolean') throw new ChatFailure('booking_unavailable', 503);
  if (result.booking === null) return { booking: null, created: false };
  const row = checkedBooking(result.booking, data, data.bookingId);
  return { booking: row.status === 'confirmed' ? row : null, created: result.created };
}
export async function createBooking(data: BookingData & { bookingId?: string }, signal?: AbortSignal): Promise<Booking | null> {
  return (await createBookingOnce({ ...data, bookingId: data.bookingId || randomUUID() }, signal)).booking;
}
export async function ownedBooking(visitorId: string, bookingId: string, action: 'get' | 'cancel', signal?: AbortSignal): Promise<Record<string, unknown>> {
  if (!isVisitorUuid(visitorId) || !isVisitorUuid(bookingId)) throw new ChatFailure('invalid_reference', 403);
  const result = await integrationRpc('booking_owned_action', { p_visitor_id: visitorId, p_booking_id: bookingId, p_action: action }, signal);
  if (!result || typeof result !== 'object' || Array.isArray(result) || (result as Record<string, unknown>).id !== bookingId) throw new ChatFailure('invalid_reference', 403);
  return result as Record<string, unknown>;
}
/** Natural-language compatibility is read-only and requires an explicit time. */
export function parseBookingRequest(text: string, now = Date.now()): { date: string; time: string } | null {
  if (typeof text !== 'string' || text.length > 8000) return null;
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const today = madridDateKey(now); let date: string | null = null;
  const iso = lower.match(/\b(20\d{2}-\d{2}-\d{2})\b/); const es = lower.match(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/);
  if (iso) date = iso[1]; else if (es) date = `${es[3]}-${es[2].padStart(2, '0')}-${es[1].padStart(2, '0')}`;
  else if (/\bpasado manana\b/.test(lower)) date = addCivilDays(today, 2);
  else if (/\bmanana\b/.test(lower)) date = addCivilDays(today, 1);
  else if (/\bhoy\b/.test(lower)) date = today;
  else { const days = ['domingo', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'];
    const index = days.findIndex(day => new RegExp(`\\b${day}\\b`).test(lower)); if (index >= 0) date = addCivilDays(today, (index - civilWeekday(today) + 7) % 7 || 7); }
  const match = lower.match(/\ba las?\s+(\d{1,2})(?::(\d{2})|h(\d{2})?)?(?:\s*(am|pm|de la manana|de la tarde|de la noche))?\b/)
    || lower.match(/\b(\d{1,2}):(\d{2})\b/);
  if (!date || !isCivilDate(date) || !match) return null;
  let hour = Number(match[1]); const minute = Number(match[2] || match[3] || 0); const period = match[4] || '';
  if (/pm|tarde|noche/.test(period) && hour < 12) hour += 12; else if (/am|manana/.test(period) && hour === 12) hour = 0;
  const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  const instant = madridInstant(date, time); return instant !== null && instant > now ? { date, time } : null;
}
export function formatDateES(date: string, time: string): string { return formatCivilDateES(date, time.slice(0, 5)); }
