import { sbQuery, DashboardStorageError } from './dashboard';
import { getPublicProjects, isProjectId, PUBLIC_PROJECT_CACHE_HEADERS } from './public-projects';

export const PUBLIC_ACTIVITY_TYPES = ['milestone', 'process', 'studio'] as const;
export type PublicActivityChannel = 'feed' | 'logs';
export interface PublicActivityEntry {
  id: string;
  title: string;
  title_en: string;
  text: string;
  text_en: string;
  event_type: typeof PUBLIC_ACTIVITY_TYPES[number];
  occurred_at: string;
  project: { slug: string; title: string } | null;
}
export const PUBLIC_ACTIVITY_LIMITS = { feed: 20, logs: 15 } as const;
export const PUBLIC_ACTIVITY_SELECT = 'id,project_id,public_title,public_title_en,public_text,public_text_en,public_event_type,public_occurred_at,is_published';

function publicText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum || /[\u0000\u0008\u000b\u000c]/u.test(value)) throw new DashboardStorageError();
  return value;
}
function occurredAt(value: unknown): string {
  if (typeof value !== 'string') throw new DashboardStorageError();
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!parts) throw new DashboardStorageError();
  const [year,month,day,hour,minute,second,zoneHour,zoneMinute] = parts.slice(1).map(Number);
  const calendar = new Date(Date.UTC(year,month-1,day));
  if (month < 1 || month > 12 || day < 1 || calendar.getUTCMonth() !== month-1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59 || (Number.isFinite(zoneHour) && zoneHour > 23) || (Number.isFinite(zoneMinute) && zoneMinute > 59)) throw new DashboardStorageError();
  const time = Date.parse(value);
  if (!Number.isFinite(time) || time > Date.now() || time < Date.UTC(2000, 0, 1)) throw new DashboardStorageError();
  return new Date(time).toISOString();
}

/** Only separately approved editorial fields enter public SSR/JSON. */
export async function loadPublicActivity(channel: PublicActivityChannel, options: { signal?: AbortSignal } = {}): Promise<PublicActivityEntry[]> {
  if (channel !== 'feed' && channel !== 'logs') throw new DashboardStorageError();
  const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  const table = channel === 'feed' ? 'feed_entries' : 'studio_logs';
  let published: Map<string, { slug: string; title: string }> | undefined;
  const output: PublicActivityEntry[] = [];
  for (let offset = 0; offset <= 1000; offset += 100) {
    if (signal.aborted) throw new DashboardStorageError();
    const page = await sbQuery(table, `select=${PUBLIC_ACTIVITY_SELECT}&is_published=eq.true&order=public_occurred_at.desc,id.desc&limit=100&offset=${offset}`, signal);
    if (page.length > 100 || offset + page.length > 1000) throw new DashboardStorageError();
    const rows = page.filter(row => row.is_published === true);
    if (!published && rows.some(row => row.project_id != null)) {
      const projects = await getPublicProjects({ signal });
      published = new Map(projects.map(project => [project.id, { slug: project.slug, title: project.title }]));
    }
    for (const row of rows) {
    if (row.project_id != null && !isProjectId(row.project_id)) throw new DashboardStorageError();
    if (row.project_id != null && !published?.has(row.project_id as string)) continue;
    if (!isProjectId(row.id) || !PUBLIC_ACTIVITY_TYPES.includes(row.public_event_type as typeof PUBLIC_ACTIVITY_TYPES[number])) throw new DashboardStorageError();
    output.push({ id: row.id, title: publicText(row.public_title, 200), title_en: publicText(row.public_title_en, 200),
      text: publicText(row.public_text, 2000), text_en: publicText(row.public_text_en, 2000),
      event_type: row.public_event_type as PublicActivityEntry['event_type'], occurred_at: occurredAt(row.public_occurred_at),
      project: row.project_id == null ? null : published!.get(row.project_id as string)!, });
      if (output.length === PUBLIC_ACTIVITY_LIMITS[channel]) return output;
    }
    if (page.length < 100) break;
  }
  return output;
}
export function publicActivityResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...PUBLIC_PROJECT_CACHE_HEADERS, 'Content-Type': 'application/json; charset=utf-8' } });
}
