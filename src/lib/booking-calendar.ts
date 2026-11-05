import { isCivilDate, isCivilTime, madridInstant } from './civil-time';
import { isVisitorUuid } from './visitor-data';
import { ChatFailure } from './chat-security';

export interface CalendarBooking {
  id: string; date: string; time: string; duration?: number; meetUrl?: string;
  status?: string; createdAt?: string;
}

/** iCalendar TEXT escaping and octet folding prevent content/line injection. */
function icalText(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
}
function foldLine(value: string): string {
  const lines: string[] = []; let current = ''; let bytes = 0;
  for (const char of value) {
    const size = Buffer.byteLength(char, 'utf8');
    if (bytes + size > 75) { lines.push(current); current = ' '; bytes = 1; }
    current += char; bytes += size;
  }
  lines.push(current); return lines.join('\r\n');
}
const stamp = (instant: number) => new Date(instant).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
export function safeMeetingUrl(value: unknown): string {
  if (value == null || value === '') return '';
  if (typeof value !== 'string' || value.length > 1024 || /[\s\u0000-\u001f\u007f]/.test(value)) throw new ChatFailure('booking_unavailable', 503);
  try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw new Error(); return url.href; }
  catch { throw new ChatFailure('booking_unavailable', 503); }
}
export function bookingCalendar(input: CalendarBooking): string {
  if (!isVisitorUuid(input.id) || !isCivilDate(input.date) || !isCivilTime(input.time) ||
    (input.duration !== undefined && input.duration !== 30) || (input.status !== undefined && !['confirmed', 'completed', 'cancelled'].includes(input.status)))
    throw new ChatFailure('booking_unavailable', 503);
  const start = madridInstant(input.date, input.time); if (start === null) throw new ChatFailure('booking_unavailable', 503);
  const meetUrl = safeMeetingUrl(input.meetUrl);
  // Persisted creation time (or a deterministic fallback) keeps provider retries identical.
  const created = input.createdAt ? Date.parse(input.createdAt) : start;
  if (!Number.isFinite(created)) throw new ChatFailure('booking_unavailable', 503);
  const description = `Videollamada de 30 minutos con Akrasia Studio. Horario: Europe/Madrid.\n${meetUrl ? `Unirse: ${meetUrl}` : 'El estudio te facilitará el enlace de videollamada.'}\nReferencia: ${input.id}`;
  return ['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Akrasia Studio//Videollamadas//ES','CALSCALE:GREGORIAN',
    'METHOD:PUBLISH','X-WR-CALNAME:Akrasia Studio','X-WR-TIMEZONE:Europe/Madrid','BEGIN:VEVENT',
    `UID:booking-${input.id}@akrasia.studio`,`DTSTAMP:${stamp(created)}`,`DTSTART:${stamp(start)}`,`DTEND:${stamp(start + 30 * 60000)}`,
    'SUMMARY:Videollamada con Akrasia Studio',`DESCRIPTION:${icalText(description)}`,
    `STATUS:${input.status === 'cancelled' ? 'CANCELLED' : 'CONFIRMED'}`,
    ...(meetUrl ? [`URL:${meetUrl}`,`LOCATION:${icalText(meetUrl)}`] : []),
    'TRANSP:OPAQUE','BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:-PT15M','DESCRIPTION:Videollamada con Akrasia Studio',
    'END:VALARM','END:VEVENT','END:VCALENDAR'].map(foldLine).join('\r\n') + '\r\n';
}
export function calendarResponse(input: CalendarBooking): Response {
  return new Response(bookingCalendar(input), { headers: {
    'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="akrasia-videollamada-${input.id}.ics"`,
    'Cache-Control': 'no-store, private', 'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex, nofollow',
  } });
}
