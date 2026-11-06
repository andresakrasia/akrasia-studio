/** The only project fields permitted in public JSON, SSR and portfolio events. */
import { localProjectImage, projectImagePath } from './public-media';
import { isProjectSlug } from './public-catalogue-id';
export { localProjectImage } from './public-media';
export { isProjectSlug } from './public-catalogue-id';
export const PUBLIC_PROJECT_FIELDS = [
  'id', 'slug', 'title', 'type', 'category', 'thumbnail', 'video_url',
  'resolution', 'aspect', 'duration', 'public_description',
  'case_study', 'case_study_en',
] as const;

export interface PublicProject {
  id: string; slug: string; title: string; type: string; category: string;
  thumbnail: string; video_url: string; resolution: string; aspect: string;
  duration: string; public_description: string;
  case_study: PublicCaseStudy; case_study_en: PublicCaseStudy;
}
export interface PublicCaseStudy { brief: string; process: string; result: string; services: string[]; }
function publicCaseStudy(value: unknown): PublicCaseStudy {
  const empty = { brief:'', process:'', result:'', services:[] as string[] };
  if (value == null) return empty;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new PublicProjectsUnavailable();
  const row = value as Record<string,unknown>;
  if (Object.keys(row).some(key => !['brief','process','result','services'].includes(key)) || typeof row.brief !== 'string' || typeof row.process !== 'string' || typeof row.result !== 'string' || !Array.isArray(row.services) || row.services.some(item => typeof item !== 'string')) throw new PublicProjectsUnavailable();
  return { brief:row.brief,process:row.process,result:row.result,services:[...row.services] };
}

export const PUBLIC_PROJECT_SELECT = [...PUBLIC_PROJECT_FIELDS, 'is_published'].join(',');
export const PUBLIC_PROJECT_CACHE_HEADERS = {
  'Cache-Control': 'no-store', 'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
};
export class PublicProjectsUnavailable extends Error {
  constructor() { super('Public portfolio temporarily unavailable'); }
}
export const isProjectId = (value: unknown): value is string => typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);

function textField(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (value == null) return '';
  if (typeof value !== 'string') throw new PublicProjectsUnavailable();
  return value;
}
function media(value: string): string {
  if (!value || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return '';
  if (localProjectImage(value)) return value;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
/** Rebuild, never spread/serialize a database row. Approval is checked twice. */
function publicProject(row: Record<string, unknown>): PublicProject {
  if (!isProjectId(row.id) || !isProjectSlug(row.slug) || typeof row.title !== 'string') throw new PublicProjectsUnavailable();
  return {
    id: row.id, slug: row.slug, title: row.title,
    type: textField(row, 'type'), category: textField(row, 'category'),
    thumbnail: projectImagePath(textField(row, 'thumbnail'), import.meta.env.SUPABASE_URL), video_url: media(textField(row, 'video_url')),
    resolution: textField(row, 'resolution'), aspect: textField(row, 'aspect'),
    duration: textField(row, 'duration'), public_description: textField(row, 'public_description'),
    case_study: publicCaseStudy(row.case_study), case_study_en: publicCaseStudy(row.case_study_en),
  };
}

export async function getPublicProjects(options: { id?: string; slug?: string; signal?: AbortSignal } = {}): Promise<PublicProject[]> {
  if ((options.id !== undefined && !isProjectId(options.id)) || (options.slug !== undefined && !isProjectSlug(options.slug))) return [];
  const id = options.id?.toLowerCase();
  const base = import.meta.env.SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new PublicProjectsUnavailable();
  const query = new URLSearchParams({ select: PUBLIC_PROJECT_SELECT, is_published: 'eq.true', order: 'sort_order.asc,id.asc' });
  if (id) query.set('id', `eq.${id}`);
  if (options.slug) query.set('slug', `eq.${options.slug}`);
  if (options.id || options.slug) query.set('limit', '1');
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 5000);
  try {
    const rows:unknown[]=[];
    for(let offset=0;offset<=1000;offset+=100){
      query.set('offset',String(offset));if(!options.id&&!options.slug)query.set('limit','100');
      const response=await fetch(`${base}/rest/v1/projects?${query}`,{headers:{apikey:key,Authorization:`Bearer ${key}`},cache:'no-store',redirect:'error',signal:controller.signal});
      if(!response.ok){await response.body?.cancel();throw new PublicProjectsUnavailable();}
      const page:unknown=await response.json();if(!Array.isArray(page)||page.length>100)throw new PublicProjectsUnavailable();
      rows.push(...page);if(rows.length>1000)throw new PublicProjectsUnavailable();
      if(options.id||options.slug||page.length<100)break;
    }
    return rows.filter((row): row is Record<string, unknown> => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
      const record = row as Record<string, unknown>;
      return record.is_published === true && (!id || record.id === id) && (!options.slug || record.slug === options.slug);
    }).map(publicProject);
  } catch { throw new PublicProjectsUnavailable(); }
  finally { clearTimeout(timeout); options.signal?.removeEventListener('abort', abort); }
}
export function publicProjectResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: {
    ...PUBLIC_PROJECT_CACHE_HEADERS, 'Content-Type': 'application/json; charset=utf-8',
  } });
}
