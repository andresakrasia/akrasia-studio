/** Calendar dates stay strings; UTC conversion is only for actual Madrid instants. */
export const STUDIO_TIME_ZONE = 'Europe/Madrid';
export function isCivilDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2199-12-31') return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function isCivilTime(value: unknown): value is string { return typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
const pad = (number: number) => String(number).padStart(2, '0');
export function civilDateKey(date: Date): string { return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`; }
const madrid = new Intl.DateTimeFormat('en-GB', { timeZone: STUDIO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function madridParts(now: number): Record<string, string> { return Object.fromEntries(madrid.formatToParts(new Date(now)).filter(p => p.type !== 'literal').map(p => [p.type, p.value])); }
export function madridDateKey(now: number | Date = Date.now()): string { const p = madridParts(Number(now)); return `${p.year}-${p.month}-${p.day}`; }
export const civilDate = madridDateKey;
export function addCivilDays(date: string, days: number): string {
  if (!isCivilDate(date) || !Number.isSafeInteger(days) || Math.abs(days) > 36600) throw new RangeError('Invalid civil date');
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + days);
  const key = value.toISOString().slice(0, 10); if (!isCivilDate(key)) throw new RangeError('Civil date out of range'); return key;
}
export function civilWeekday(date: string): number { if (!isCivilDate(date)) throw new RangeError('Invalid civil date'); return new Date(`${date}T00:00:00Z`).getUTCDay(); }
export function mondayOfCivilWeek(date: string): string { return addCivilDays(date, -((civilWeekday(date) + 6) % 7)); }
/** Reject both DST gaps and repeated times: the visitor must choose one unambiguous instant. */
export function madridInstant(date: string, time: string): number | null {
  if (!isCivilDate(date) || !isCivilTime(time)) return null;
  const base = Date.parse(`${date}T${time}:00Z`); const matches: number[] = [];
  for (const offset of [60, 120]) { const instant = base - offset * 60000; const p = madridParts(instant);
    if (`${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time) matches.push(instant); }
  return matches.length === 1 ? matches[0] : null;
}
export function formatCivilDateES(date: string, time?: string): string {
  if (!isCivilDate(date) || (time !== undefined && !isCivilTime(time))) throw new RangeError('Invalid civil date/time');
  const value = new Date(`${date}T12:00:00Z`);
  const text = new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(value);
  return time ? `${text} a las ${time} (Europe/Madrid)` : text;
}
