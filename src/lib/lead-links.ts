import { DashboardStorageError, dashboardId, sbQuery } from './dashboard';
import { isCivilDate, madridDateKey } from './civil-time';
import { RETENTION_DEFAULTS } from './privacy-retention';

/** The video call a contact booked, shown beside its lead and its journey. */
export interface LinkedBooking { id: string; date: string; time: string; status: 'confirmed' | 'completed'; meet_url: string }
export interface LinkedJourney { id: string; stage: string; next_action_date: string | null }

const VISITOR = /^[A-Za-z0-9_-]{1,128}$/;
export const linkableVisitor = (value: unknown): value is string => typeof value === 'string' && VISITOR.test(value);

/** Next confirmed call of each visitor, or their most recent one. Bookings are
 * linked through the visitor: the chat does not record a lead on the booking. */
export async function bookingsByVisitor(visitorIds: unknown[], today = madridDateKey()): Promise<Map<string, LinkedBooking>> {
  const ids = [...new Set(visitorIds.filter(linkableVisitor))];
  const result = new Map<string, LinkedBooking>();
  if (!ids.length) return result;
  const rows = await sbQuery('bookings', `select=id,visitor_id,booked_date,booked_time,status,meet_url&visitor_id=in.(${ids.join(',')})&status=in.(confirmed,completed)&order=booked_date.desc,booked_time.desc,id.desc&limit=200`);
  for (const row of rows) {
    const time = typeof row.booked_time === 'string' ? row.booked_time.slice(0, 5) : '';
    if (!dashboardId(row.id) || !ids.includes(row.visitor_id) || !isCivilDate(row.booked_date) || !/^\d{2}:\d{2}$/.test(time) || !['confirmed', 'completed'].includes(row.status)) throw new DashboardStorageError();
    const booking: LinkedBooking = { id: row.id, date: row.booked_date, time, status: row.status, meet_url: typeof row.meet_url === 'string' ? row.meet_url : '' };
    const current = result.get(row.visitor_id);
    const upcoming = booking.status === 'confirmed' && booking.date >= today;
    // Rows arrive newest first: keep the newest, then prefer ever-earlier upcoming calls.
    if (!current || upcoming) result.set(row.visitor_id, booking);
  }
  return result;
}

export async function journeysByLead(leadIds: string[]): Promise<Map<string, LinkedJourney>> {
  const result = new Map<string, LinkedJourney>();
  if (!leadIds.length) return result;
  const rows = await sbQuery('client_journeys', `select=id,lead_id,stage,next_action_date&lead_id=in.(${leadIds.join(',')})&limit=100`);
  for (const row of rows) {
    if (!dashboardId(row.id) || !leadIds.includes(row.lead_id) || typeof row.stage !== 'string') throw new DashboardStorageError();
    result.set(row.lead_id, { id: row.id, stage: row.stage, next_action_date: isCivilDate(row.next_action_date) ? row.next_action_date : null });
  }
  return result;
}

/** Chat contacts leave with the profile retention; manual ones are business records. */
export function chatLeadExpiry(lead: Record<string, unknown>, profileDays: number = RETENTION_DEFAULTS.profileDays): string | null {
  if ((lead.source ?? 'web') !== 'web' || typeof lead.updated_at !== 'string') return null;
  const updated = Date.parse(lead.updated_at);
  return Number.isFinite(updated) ? new Date(updated + profileDays * 86400000).toISOString() : null;
}
