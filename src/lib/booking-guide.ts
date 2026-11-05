import { addCivilDays, civilWeekday, isCivilDate, isCivilTime, madridInstant } from './civil-time';

export interface GuidedBookingRequest { date: string; time: string; email: string; name: string }
export interface GuidedBookingSlot { date: string; time: string; formatted: string }

export interface GuidedCalendarMonth {
  month: string; dateFrom: string; dateTo: string; cells: (string | null)[];
}

/** All month arithmetic uses civil dates, so a visitor's timezone cannot shift a day. */
export function guidedCalendarMonth(date: string, firstDate: string, lastDate: string): GuidedCalendarMonth {
  if (!isCivilDate(date) || !isCivilDate(firstDate) || !isCivilDate(lastDate) || firstDate > lastDate) throw new Error('invalid_calendar');
  const month = `${date.slice(0, 7)}-01`;
  const next = new Date(`${month}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  const end = addCivilDays(next.toISOString().slice(0, 10), -1);
  const dateFrom = month < firstDate ? firstDate : month;
  const dateTo = end > lastDate ? lastDate : end;
  if (dateFrom > dateTo) throw new Error('invalid_calendar');
  const cells: (string | null)[] = Array.from({ length: (civilWeekday(month) + 6) % 7 }, () => null);
  for (let day = month; day <= end; day = addCivilDays(day, 1)) cells.push(day);
  while (cells.length % 7) cells.push(null);
  return { month, dateFrom, dateTo, cells };
}

export function shiftGuidedMonth(month: string, offset: -1 | 1): string {
  if (!isCivilDate(month) || month.slice(8) !== '01') throw new Error('invalid_calendar');
  const value = new Date(`${month}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + offset);
  const result = value.toISOString().slice(0, 10);
  if (!isCivilDate(result)) throw new Error('invalid_calendar');
  return result;
}

/** A calendar only displays real, future starts returned for its exact range. */
export function checkedGuidedCalendar(value: unknown, dateFrom: string, dateTo: string, now = Date.now()): GuidedBookingSlot[] {
  if (!isCivilDate(dateFrom) || !isCivilDate(dateTo) || dateFrom > dateTo || dateTo > addCivilDays(dateFrom, 30) ||
    !value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_availability');
  const response = value as Record<string, unknown>;
  if (response.date_from !== dateFrom || response.date_to !== dateTo || response.time_zone !== 'Europe/Madrid' || response.duration_min !== 30 ||
    !Array.isArray(response.available_slots) || response.available_slots.length > 31 * 48) throw new Error('invalid_availability');
  let previous = '';
  return response.available_slots.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_availability');
    const slot = value as Record<string, unknown>;
    if (!isCivilDate(slot.date) || slot.date < dateFrom || slot.date > dateTo || !isCivilTime(slot.time) ||
      typeof slot.formatted !== 'string' || slot.formatted.length > 250) throw new Error('invalid_availability');
    const instant = madridInstant(slot.date, slot.time);
    const key = `${slot.date} ${slot.time}`;
    if (instant === null || instant <= now || key <= previous) throw new Error('invalid_availability');
    previous = key;
    return { date: slot.date, time: slot.time, formatted: slot.formatted };
  });
}

/** Rechecking the agenda keeps a choice only while that exact start is offered. */
export function retainedGuidedSelection(choices: GuidedBookingSlot[], selected: GuidedBookingSlot | null): GuidedBookingSlot | null {
  if (!selected) return null;
  return choices.find(slot => slot.date === selected.date && slot.time === selected.time) || null;
}

/** This readable message binds operation retries to every requested detail. */
export function guidedBookingMessage(request: GuidedBookingRequest, language: 'es' | 'en'): string {
  return language === 'en'
    ? `I'd like a proposal for a 30-minute video call on ${request.date} at ${request.time} (Europe/Madrid). Email: ${request.email}. Name: ${request.name || '(not supplied)'}.`
    : `Quiero una propuesta de videollamada de 30 minutos el ${request.date} a las ${request.time} (Europe/Madrid). Email: ${request.email}. Nombre: ${request.name || '(sin facilitar)'}.`;
}

/** A hint only opens the guide; it never grants authority to create a booking. */
export function requestsMeetingGuide(message: string): boolean {
  const text = message.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  // "Sin compromiso" is a positive booking request. Negate the call itself,
  // rather than excluding every request that contains the word "sin".
  if (/\b(?:no quiero|no necesito|no me interesa|no me gustaria|sin (?:una? )?(?:reunion|videollamada|llamada|meeting|video call|call)|cancelar|cancel|don't want|do not want|no longer want|no thanks)\b/.test(text)) return false;
  return /\b(?:reservar|agendar|concertar|organizar|proponer|quiero|gustaria|book|schedule|arrange|like|want)\b/.test(text)
    && /\b(?:reunion|videollamada|llamada|meeting|video call|call)\b/.test(text);
}

export function checkedGuidedSlots(value: unknown, requestedDate: string, now = Date.now()): GuidedBookingSlot[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_availability');
  const response = value as Record<string, unknown>;
  if (response.date !== requestedDate || !Array.isArray(response.available_slots) || response.available_slots.length > 5) throw new Error('invalid_availability');
  const seen = new Set<string>();
  return response.available_slots.map((value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_availability');
    const slot = value as Record<string, unknown>;
    if (!isCivilDate(slot.date) || slot.date < requestedDate || !isCivilTime(slot.time) || typeof slot.formatted !== 'string' || slot.formatted.length > 250) throw new Error('invalid_availability');
    const instant = madridInstant(slot.date, slot.time);
    const key = `${slot.date} ${slot.time}`;
    if (instant === null || instant <= now || seen.has(key)) throw new Error('invalid_availability');
    seen.add(key);
    return { date: slot.date, time: slot.time, formatted: slot.formatted };
  });
}
