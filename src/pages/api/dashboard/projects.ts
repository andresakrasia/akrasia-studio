import type { APIRoute } from 'astro';
import { validateDashboardSession, dashResponse, dashError, sbRequest, dashboardRows, dashboardPage, requireDashboardId, DashboardInputError, DashboardStorageError, dashboardFailure, dashboardJson } from '../../../lib/dashboard';
import { parseProjectCreate, parseProjectPatch, ProjectInputError, validProjectId } from '../../../lib/project-input';
import { projectImagePath } from '../../../lib/public-media';
import { mapWithConcurrency } from '../../../lib/client-journey-data';

function adminProject(row: Record<string, unknown>) {
  const thumbnail = projectImagePath(row.thumbnail, import.meta.env.SUPABASE_URL);
  return { ...row, thumbnail: thumbnail || row.thumbnail };
}

// Middleware authorizes the persistent session and validates origin + CSRF.
// Administrative data stays available here; public routes use a separate contract.
const ADMIN_FIELDS = 'id,title,slug,type,client_name,client_id,description,public_description,status,thumbnail,video_url,resolution,aspect,duration,category,sort_order,is_published,case_study,case_study_en,created_at,updated_at';
const TASK_FIELDS = 'id,project_id,title,description,status,priority,created_by,created_at';

class ProjectStorageError extends Error {
  constructor(public status = 503) { super('No se pudieron guardar o cargar los proyectos.'); }
}

async function projectStore(table: string, query: string, method = 'GET', body?: unknown): Promise<Record<string, unknown>[]> {
  try {
    return dashboardRows((await sbRequest(`${table}${query ? `?${query}` : ''}`,method,body)).data);
  } catch (error) { throw error instanceof DashboardStorageError ? new ProjectStorageError(error.status) : new ProjectStorageError(); }
}

async function withJourney(projects:Record<string,unknown>[]) {
  if(!projects.length)return projects;
  const rows=await projectStore('client_journeys',`project_id=in.(${projects.map(project=>project.id).join(',')})&select=id,project_id,stage&limit=100`);
  const clientIds=[...new Set(projects.filter(project=>rows.some(row=>row.project_id===project.id)&&project.client_id).map(project=>requireDashboardId(project.client_id)))];
  const clients=clientIds.length?await projectStore('clients',`id=in.(${clientIds.join(',')})&select=id,name&limit=100`):[];
  return projects.map(project=>{const journey=rows.find(row=>row.project_id===project.id);const client=clients.find(row=>row.id===project.client_id);return {...adminProject(project),...(journey&&client?{client_name:client.name}:{}),journey_id:journey?.id??null,journey_stage:journey?.stage??null};});
}

function failure(error: unknown) {
  if (error instanceof DashboardInputError || error instanceof DashboardStorageError) return dashboardFailure(error);
  if (error instanceof ProjectInputError) return dashError(error.message, 400);
  if (error instanceof ProjectStorageError) return dashError(error.status === 409 ? 'Ya existe un proyecto con ese slug.' : error.message, error.status);
  return dashError('No se pudieron guardar o cargar los proyectos.', 503);
}

async function input(request: Request): Promise<unknown> {
  try { return await request.json(); } catch { throw new ProjectInputError('JSON inválido.'); }
}

export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSession(request)) return dashError('Unauthorized');
  try {
    const page = dashboardPage(request);
    const projectId=new URL(request.url).searchParams.get('id');const filter=projectId?`&id=eq.${requireDashboardId(projectId)}`:'';
    const result = await sbRequest(`projects?order=sort_order.asc,id.asc&select=${ADMIN_FIELDS}${filter}&limit=${page.limit}&offset=${page.offset}`,'GET',undefined,'count=exact');
    const projects = dashboardRows(result.data);
    const total = Number(result.headers.get('content-range')?.split('/')[1]);
    if (!Number.isSafeInteger(total) || total < projects.length) throw new ProjectStorageError();
    const paging = { 'X-Total-Count':String(total),'X-Page-Offset':String(page.offset),'X-Page-Limit':String(page.limit),'X-Next-Offset':page.offset + projects.length < total ? String(page.offset + projects.length) : '' };
    if (projects.some(p => !validProjectId(p.id) || typeof p.is_published !== 'boolean')) throw new ProjectStorageError();
    const linked=await withJourney(projects);
    if (new URL(request.url).searchParams.get('tasks') !== 'true' || !projects.length) return dashResponse(linked,200,paging);
    // Each project's page is independent; one prolific project cannot hide other tasks.
    const enriched = await mapWithConcurrency(linked,6,async project => {
      const result = await sbRequest(`project_tasks?project_id=eq.${project.id}&order=created_at.asc,id.asc&select=${TASK_FIELDS}&limit=100`,'GET',undefined,'count=exact');
      const tasks = dashboardRows(result.data); const count = Number(result.headers.get('content-range')?.split('/')[1]);
      if (!Number.isSafeInteger(count)) throw new ProjectStorageError();
      return { ...project,tasks, tasks_total:count,tasks_next_offset:tasks.length < count ? tasks.length : null };
    });
    return dashResponse(enriched,200,paging);
  } catch (error) { return failure(error); }
};

export const POST: APIRoute = async ({ request }) => {
  if (!validateDashboardSession(request)) return dashError('Unauthorized');
  try {
    const body = await dashboardJson(request);
    const operation = body.operation_id === undefined ? undefined : requireDashboardId(body.operation_id); delete body.operation_id;
    const clean = parseProjectCreate(body);
    let rows: Record<string,unknown>[];
    try { rows = await projectStore('projects', `select=${ADMIN_FIELDS}`, 'POST', { ...clean, ...(operation ? { id:operation } : {}), updated_at: new Date().toISOString() }); }
    catch(error) {
      if (!operation || !(error instanceof ProjectStorageError) || error.status !== 409) throw error;
      rows = await projectStore('projects',`id=eq.${operation}&select=${ADMIN_FIELDS}`);
      if (rows.length !== 1 || Object.keys(clean).some(key => JSON.stringify(rows[0][key]) !== JSON.stringify(clean[key]))) throw error;
    }
    if (rows.length !== 1 || !validProjectId(rows[0].id) || rows[0].is_published !== false) throw new ProjectStorageError();
    return dashResponse(adminProject(rows[0]), 201);
  } catch (error) { return failure(error); }
};

export const PATCH: APIRoute = async ({ request }) => {
  if (!validateDashboardSession(request)) return dashError('Unauthorized');
  try {
    const { id, fields, publication } = parseProjectPatch(await input(request));
    if(Object.hasOwn(fields,'status') || Object.hasOwn(fields,'client_id')){
      const [journeys,existing]=await Promise.all([projectStore('client_journeys',`project_id=eq.${id}&select=id&limit=1`),projectStore('projects',`id=eq.${id}&select=id,status,client_id&limit=1`)]);
      if(journeys.length && existing.length && ['status','client_id'].some(key=>Object.hasOwn(fields,key) && fields[key]!==existing[0][key]))return dashError('Actualiza la etapa desde Seguimiento. El proyecto conserva el cliente y el estado de su ficha vinculada.',409);
    }
    const rows = await projectStore('projects', `id=eq.${id}&select=${ADMIN_FIELDS}`, 'PATCH', { ...fields, updated_at: new Date().toISOString() });
    if (!rows.length) return dashError('Proyecto no encontrado.', 404);
    if (rows.length !== 1 || rows[0].id !== id || typeof rows[0].is_published !== 'boolean'
      || (publication !== undefined && rows[0].is_published !== publication)) throw new ProjectStorageError();
    return dashResponse((await withJourney(rows))[0]);
  } catch (error) { return failure(error); }
};

export const DELETE: APIRoute = async ({ request }) => {
  if (!validateDashboardSession(request)) return dashError('Unauthorized');
  const id = new URL(request.url).searchParams.get('id');
  if (!validProjectId(id)) return dashError('id debe ser un UUID.', 400);
  try {
    const rows = await projectStore('projects', `id=eq.${id}`, 'DELETE');
    if (!rows.length) return dashError('Proyecto no encontrado.', 404);
    return dashResponse({ deleted: true });
  } catch (error) { return failure(error); }
};
