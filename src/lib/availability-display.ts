import { isCivilTime } from './civil-time';

interface WeeklyWindow { day_of_week: number; start_time: string; end_time: string; is_active: boolean }
interface DateWindow { override_date: string; start_time: string | null; end_time: string | null; is_available: boolean }
export interface AvailabilityWindow { start: number; end: number }

function interval(start: string | null, end: string | null): AvailabilityWindow | null {
  if (start === null && end === null) return { start: 0, end: 1440 };
  if (!start || !end || !isCivilTime(start.slice(0, 5)) || !isCivilTime(end.slice(0, 5))) return null;
  const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  const value = { start: minutes(start), end: minutes(end) };
  return value.start < value.end ? value : null;
}

/** Calendar windows show the weekly openings plus extras, with dated blocks removed. */
export function effectiveAvailabilityWindows(date: string, weekday: number, weekly: WeeklyWindow[], changes: DateWindow[]): AvailabilityWindow[] {
  const dated = changes.filter(row => row.override_date === date);
  const openings = [
    ...weekly.filter(row => row.day_of_week === weekday && row.is_active).map(row => interval(row.start_time, row.end_time)),
    ...dated.filter(row => row.is_available).map(row => interval(row.start_time, row.end_time)),
  ].filter((row): row is AvailabilityWindow => row !== null).sort((a, b) => a.start - b.start);
  const merged: AvailabilityWindow[] = [];
  for (const window of openings) {
    const previous = merged.at(-1);
    if (previous && window.start <= previous.end) previous.end = Math.max(previous.end, window.end);
    else merged.push({ ...window });
  }
  let result = merged;
  for (const row of dated.filter(row => !row.is_available)) {
    const block = interval(row.start_time, row.end_time);
    if (!block) continue;
    result = result.flatMap(window => {
      if (block.end <= window.start || block.start >= window.end) return [window];
      return [
        ...(block.start > window.start ? [{ start: window.start, end: block.start }] : []),
        ...(block.end < window.end ? [{ start: block.end, end: window.end }] : []),
      ];
    });
  }
  return result;
}

export function availabilityWindowLabel(window: AvailabilityWindow): string {
  if (window.start === 0 && window.end === 1440) return 'Todo el día';
  const clock = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
  return `${clock(window.start)}–${clock(window.end)}`;
}
