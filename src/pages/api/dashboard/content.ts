import { dashboardRoute, dashboardJson, dashboardRows, dashboardList, dashResponse, sbRpc, DashboardInputError, requireDashboardId } from '../../../lib/dashboard';
import { parseProjectPatch } from '../../../lib/project-input';
import { parseCaseStudy, parseDashboardFields } from '../../../lib/dashboard-contract';
// This editor reads and writes the same canonical tables as public SSR/API/sitemap.
// Neither saving content nor editing case studies grants publication.
export const GET = dashboardRoute(async ({ request }) => {
  const type = new URL(request.url).searchParams.get('type');
  if (type === 'services') return dashboardList('services','select=*&order=sort_order.asc,id.asc',request);
  if (type === 'projects' || type === 'case-studies') return dashboardList('projects',type === 'projects' ? 'select=*&order=sort_order.asc,id.asc' : 'select=id,slug,title,is_published,case_study,case_study_en&order=sort_order.asc,id.asc',request);
  throw new DashboardInputError('Tipo de contenido inválido.');
});
export const PUT = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request,256*1024);
  if (Object.keys(body).some(k => !['key','data'].includes(k)) || !Array.isArray(body.data) || !body.data.length || body.data.length > 100) throw new DashboardInputError('Envía entre 1 y 100 cambios identificados.');
  const key = body.key; if (!['projects','services','case-studies'].includes(String(key))) throw new DashboardInputError('Tipo de contenido inválido.');
  const ids = new Set<string>();
  const changes = body.data.map((row: unknown) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new DashboardInputError('Cambio inválido.');
    const item = { ...row } as Record<string,unknown>; const id = requireDashboardId(item.id); delete item.id;
    if (ids.has(id)) throw new DashboardInputError('Identificadores duplicados.'); ids.add(id);
    // Approval is intentionally a separate administrative action.
    if (Object.hasOwn(item,'is_published')) throw new DashboardInputError('La aprobación de publicación se guarda por separado.');
    if (key === 'services') return { id, fields:parseDashboardFields('services',item) };
    if (key === 'projects') return { id, fields:parseProjectPatch({ id,...item }).fields };
    if (!Object.keys(item).length || Object.keys(item).some(k => !['case_study','case_study_en'].includes(k))) throw new DashboardInputError('Edita únicamente case_study y case_study_en.');
    return { id, fields:Object.fromEntries(Object.entries(item).map(([field,value]) => [field,parseCaseStudy(value)])) };
  });
  const rows = dashboardRows(await sbRpc('dashboard_save_content',{ p_entity:key === 'services' ? 'services' : 'projects', p_changes:changes }));
  if (rows.length !== changes.length || rows.some(row => !ids.has(row.id))) throw new Error('Resultado incompleto.');
  return dashResponse({ saved:rows.length, rows });
});
