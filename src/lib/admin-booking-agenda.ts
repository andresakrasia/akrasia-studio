import { addCivilDays, civilWeekday, isCivilDate, isCivilTime, madridDateKey, madridInstant } from './civil-time';

export interface AdminBooking {
  id: string;
  booked_date: string;
  booked_time: string;
  duration_min: number;
  status: string;
  meet_url: string | null;
  visitor_email: string | null;
  visitor_phone: string | null;
  visitor_name: string | null;
  notes: string | null;
  created_at: string;
}

export type AgendaRequester = (endpoint: string, options?: RequestInit) => Promise<Response>;
export const bookingOrder = (a: AdminBooking, b: AdminBooking) =>
  a.booked_date.localeCompare(b.booked_date) || a.booked_time.localeCompare(b.booked_time) || a.id.localeCompare(b.id);

/** The server returns bounded pages, even when the requested period contains more than 100 appointments. */
export async function loadAdminBookingRange(request: AgendaRequester, from: string, to: string): Promise<AdminBooking[]> {
  if (!isCivilDate(from) || !isCivilDate(to) || to < from || to > addCivilDays(from, 366)) throw new Error('Intervalo de agenda inválido.');
  const bookings = new Map<string, AdminBooking>();
  let offset = 0;
  let expectedTotal: number | null = null;
  for (;;) {
    const response = await request(`/api/dashboard/bookings?from=${from}&to=${to}&limit=100&offset=${offset}`);
    if (!response.ok) throw new Error('No se pudieron cargar las reservas.');
    const rows: unknown = await response.json();
    const totalText = response.headers.get('x-total-count');
    const nextText = response.headers.get('x-next-offset');
    if (!Array.isArray(rows) || !totalText || !/^\d+$/.test(totalText) || !Number.isSafeInteger(Number(totalText))) throw new Error('No se pudo comprobar la agenda completa.');
    const total = Number(totalText);
    if (total > 10000 || rows.length > 100 || total < offset + rows.length) throw new Error('No se pudo comprobar la agenda completa.');
    if (expectedTotal !== null && total !== expectedTotal) throw new Error('Las reservas han cambiado durante la consulta. Actualiza la agenda.');
    expectedTotal = total;
    for (const value of rows) {
      const row = value as AdminBooking;
      if (!row || typeof row !== 'object' || typeof row.id !== 'string' || !row.id || !isCivilDate(row.booked_date) ||
        typeof row.booked_time !== 'string' || !isCivilTime(row.booked_time.slice(0, 5)) || typeof row.status !== 'string' ||
        !Number.isSafeInteger(row.duration_min) || row.duration_min < 1 || row.duration_min > 180 ||
        row.booked_date < from || row.booked_date > to) throw new Error('No se pudo comprobar una reserva.');
      if (bookings.has(row.id)) throw new Error('Las reservas han cambiado durante la consulta. Actualiza la agenda.');
      bookings.set(row.id, row);
    }
    if (!nextText) {
      if (offset + rows.length < total || bookings.size !== total) throw new Error('No se pudo cargar la agenda completa.');
      break;
    }
    if (!/^\d+$/.test(nextText) || Number(nextText) !== offset + rows.length || Number(nextText) <= offset || Number(nextText) >= total) throw new Error('No se pudo cargar la siguiente página de reservas.');
    offset = Number(nextText);
  }
  return [...bookings.values()].sort(bookingOrder);
}

export function upcomingConfirmedBookings(bookings: AdminBooking[], now: number): AdminBooking[] {
  const today = madridDateKey(now);
  const horizon = addCivilDays(today, 180);
  return bookings.filter(booking => {
    if (booking.status !== 'confirmed' || booking.booked_date < today || booking.booked_date > horizon) return false;
    const start = madridInstant(booking.booked_date, booking.booked_time.slice(0, 5));
    // Keep a meeting that has started visible until its scheduled end.
    return start !== null && start + booking.duration_min * 60000 > now;
  }).sort(bookingOrder);
}

export function bookingMonthStart(date: string): string {
  if (!isCivilDate(date)) throw new Error('Fecha de agenda inválida.');
  return `${date.slice(0, 7)}-01`;
}
export function shiftBookingMonth(month: string, delta: number): string {
  if (!isCivilDate(month) || !Number.isSafeInteger(delta) || Math.abs(delta) > 12) throw new Error('Mes de agenda inválido.');
  const date = new Date(`${bookingMonthStart(month)}T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + delta);
  const result = date.toISOString().slice(0, 10);
  if (!isCivilDate(result)) throw new Error('Mes de agenda fuera de rango.');
  return result;
}
export function bookingMonthEnd(month: string): string { return addCivilDays(shiftBookingMonth(month, 1), -1); }
export function bookingMonthCells(month: string): (string | null)[] {
  const first = bookingMonthStart(month);
  const startPadding = (civilWeekday(first) + 6) % 7;
  const days = Number(bookingMonthEnd(first).slice(-2));
  const cells: (string | null)[] = Array.from({ length: startPadding }, () => null);
  for (let day = 0; day < days; day++) cells.push(addCivilDays(first, day));
  while (cells.length % 7) cells.push(null);
  return cells;
}
export function safeBookingJoinUrl(value: string | null): string | null {
  if (!value || value.length > 2000 || /[\s\u0000-\u001f\u007f]/.test(value)) return null;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
