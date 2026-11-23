import { sbQuery, DashboardStorageError } from './dashboard';
import { SERVICE_ICONS, parseContentBlocks } from './dashboard-contract';
import { isProjectSlug, PUBLIC_PROJECT_CACHE_HEADERS } from './public-projects';
export interface PublicService {
  id: string; slug: string; title: string; description: string; title_en: string; description_en: string;
  icon: string; highlighted: boolean; cta_message: string; cta_message_en: string;
  tagline: string; tagline_en: string; hero_description: string; hero_description_en: string;
  features: Record<string,string>[]; features_en: Record<string,string>[];
  process: Record<string,string>[]; process_en: Record<string,string>[];
}
export const PUBLIC_SERVICE_FIELDS = ['id','slug','title','description','title_en','description_en','icon','highlighted','cta_message','cta_message_en','tagline','tagline_en','hero_description','hero_description_en','features','features_en','process','process_en'] as const;
export const PUBLIC_SERVICE_SELECT = [...PUBLIC_SERVICE_FIELDS,'is_published'].join(',');
export async function loadPublicServices(options: { slug?: string; signal?: AbortSignal } = {}): Promise<PublicService[]> {
  if (options.slug !== undefined && !isProjectSlug(options.slug)) return [];
  const signal=options.signal ? AbortSignal.any([options.signal,AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000);
  if (signal.aborted) throw new DashboardStorageError();
  const rows: Record<string,any>[] = [];
  for (let offset=0;offset<=1000;offset+=100) {
    if(signal.aborted)throw new DashboardStorageError();
    const page=await sbQuery('services',`select=${PUBLIC_SERVICE_SELECT}&is_published=eq.true&order=sort_order.asc,id.asc&limit=${options.slug ? 1 : 100}&offset=${offset}${options.slug ? `&slug=eq.${options.slug}` : ''}`,signal);
    rows.push(...page);
    if (rows.length>1000) throw new DashboardStorageError();
    if (options.slug || page.length<100) break;
  }
  return rows.filter(row => row.is_published === true && (!options.slug || row.slug === options.slug)).map(row => {
    if (!isProjectSlug(row.slug) || typeof row.id !== 'string' || typeof row.title !== 'string' || !row.title.trim()) throw new DashboardStorageError();
    const output: Record<string,unknown> = {};
    for (const key of PUBLIC_SERVICE_FIELDS) {
      if (key === 'features' || key === 'features_en' || key === 'process' || key === 'process_en') output[key] = parseContentBlocks(row[key] ?? [],key,key.startsWith('process'));
      else if (key === 'highlighted') output[key] = row[key] === true;
      else if (key === 'icon') output[key] = SERVICE_ICONS.includes(row.icon) ? row.icon : 'movie';
      else { if (row[key] != null && typeof row[key] !== 'string') throw new DashboardStorageError(); output[key] = row[key] ?? ''; }
    }
    return output as unknown as PublicService;
  });
}
export function publicContentResponse(data: unknown,status = 200) { return new Response(JSON.stringify(data),{ status, headers: { ...PUBLIC_PROJECT_CACHE_HEADERS, 'Content-Type':'application/json; charset=utf-8' } }); }
