import type { APIRoute } from 'astro';
import { dashboardRoute, dashboardJson, dashboardList, dashResponse, sbInsert, sbPatch, sbDelete, sbQuery, oneDashboardRow, requireDashboardId, dashboardId, DashboardInputError, DashboardStorageError } from './dashboard';
import { dashboardTables, parseDashboardFields, PUBLIC_ACTIVITY_EDIT_FIELDS } from './dashboard-contract';
export const isActivityEntity = (entity: string) => entity === 'feed-entries' || entity === 'studio-logs';
async function validateTaskLifecycle(fields:Record<string,unknown>, existingId?:string) {
  const existing=existingId?oneDashboardRow(await sbQuery('project_tasks',`id=eq.${existingId}&select=id,project_id,status`),existingId):null;
  const project=requireDashboardId(fields.project_id??existing?.project_id);
  const status=fields.status??existing?.status??'pending';
  if(status==='completed')return;
  const journeys=await sbQuery('client_journeys',`project_id=eq.${project}&select=id,stage&limit=1`);
  if(journeys.some(row=>row.stage==='delivered'||row.stage==='closed'))throw new DashboardInputError('Retoma el seguimiento antes de añadir o reabrir trabajo pendiente en un proyecto entregado o cerrado.');
}
async function validateActivityApproval(table: string, id: string, revision: number) {
  const row = oneDashboardRow(await sbQuery(table,`id=eq.${id}&select=id,project_id,public_title,public_title_en,public_text,public_text_en,public_event_type,public_occurred_at,public_revision`),id);
  if (row.public_revision !== revision) throw new DashboardStorageError(409);
  for (const key of ['public_title','public_title_en','public_text','public_text_en']) if (typeof row[key] !== 'string' || !row[key].trim()) throw new DashboardInputError('Completa título y texto públicos en español e inglés antes de aprobar.');
  if (!['milestone','process','studio'].includes(row.public_event_type) || typeof row.public_occurred_at !== 'string' || !Number.isFinite(Date.parse(row.public_occurred_at)) || Date.parse(row.public_occurred_at) > Date.now() || Date.parse(row.public_occurred_at) < Date.UTC(2000,0,1)) throw new DashboardInputError('Revisa el tipo y la fecha real del evento antes de aprobar.');
  if (row.project_id != null) {
    const project = requireDashboardId(row.project_id);
    const rows = await sbQuery('projects',`id=eq.${project}&select=id,is_published&limit=1`);
    if (rows.length !== 1 || rows[0].is_published !== true) throw new DashboardInputError('El proyecto relacionado debe estar aprobado para publicación.');
  }
}
export function dashboardCrud(entity: string, order = 'created_at.desc,id.desc'): Record<'GET'|'POST'|'PATCH'|'DELETE',APIRoute> {
  const table = dashboardTables[entity];
  return {
    GET: dashboardRoute(async ({ request }) => {
      let query = `select=*&order=${order}`; const params = new URL(request.url).searchParams;
      if (entity === 'tasks' && params.has('project_id')) query += `&project_id=eq.${requireDashboardId(params.get('project_id'))}`;
      if (entity === 'clients' && params.has('id')) query += `&id=eq.${requireDashboardId(params.get('id'))}`;
      return dashboardList(table,query,request);
    }),
    POST: dashboardRoute(async ({ request }) => {
      const body = await dashboardJson(request); const operation = body.operation_id === undefined ? undefined : requireDashboardId(body.operation_id); delete body.operation_id;
      const clean = parseDashboardFields(entity, body, true);
      if(entity==='tasks')await validateTaskLifecycle(clean);
      // A stable primary key makes a retry safe after an uncertain HTTP outcome.
      try {
        const rows=await sbInsert(table,{...clean,...(operation ? {id:operation} : {})});
        if(rows.length!==1 || !dashboardId(rows[0].id)) throw new DashboardStorageError();
        return dashResponse(rows[0],201);
      }
      catch (error) {
        if (!operation || !(error instanceof DashboardStorageError) || error.status !== 409) throw error;
        const stored = oneDashboardRow(await sbQuery(table,`id=eq.${operation}&select=*`),operation);
        if (Object.keys(clean).some(key => JSON.stringify(stored[key]) !== JSON.stringify(clean[key]))) throw new DashboardStorageError(409);
        return dashResponse(stored,200);
      }
    }),
    PATCH: dashboardRoute(async ({ request }) => {
      const body = await dashboardJson(request); const id = requireDashboardId(body.id); delete body.id;
      let clean: Record<string,unknown>;
      let query = `id=eq.${id}`;
      if ((entity === 'services' || isActivityEntity(entity)) && Object.hasOwn(body,'is_published')) {
        const approvingActivity = isActivityEntity(entity) && body.is_published === true;
        if (typeof body.is_published !== 'boolean' || Object.keys(body).some(key => key !== 'is_published' && !(approvingActivity && key === 'public_revision')) || (approvingActivity && (!Number.isSafeInteger(body.public_revision) || Number(body.public_revision) < 0 || Number(body.public_revision) > 2147483647))) throw new DashboardInputError('La publicación se aprueba por separado, con la revisión editorial que se ha consultado.');
        clean = { is_published: body.is_published };
        if (approvingActivity) { await validateActivityApproval(table,id,Number(body.public_revision));query += `&public_revision=eq.${body.public_revision}`; }
      } else clean = parseDashboardFields(entity,body);
      if(entity==='tasks')await validateTaskLifecycle(clean,id);
      if (isActivityEntity(entity) && PUBLIC_ACTIVITY_EDIT_FIELDS.some(key => Object.hasOwn(clean,key))) clean.is_published = false;
      const rows = await sbPatch(table,query,clean);
      if (!rows.length && isActivityEntity(entity) && body.is_published === true) throw new DashboardStorageError(409);
      return dashResponse(oneDashboardRow(rows,id));
    }),
    DELETE: dashboardRoute(async ({ request }) => { const id = requireDashboardId(new URL(request.url).searchParams.get('id')); await sbDelete(table,`id=eq.${id}`); return dashResponse({ deleted: true }); }),
  };
}
