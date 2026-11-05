import { dashboardRoute, dashboardJson, dashResponse, dashboardList, requireDashboardId, DashboardInputError, sbRpc, sbQuery } from '../../../lib/dashboard';
import { journeyText, requireJourneyStage, journeyRpcRow, journeyTransitionIssue, type ClientJourney } from '../../../lib/client-journey-contract';
import { journeyTaskCounts, mapWithConcurrency } from '../../../lib/client-journey-data';

export const GET = dashboardRoute(async ({ request }) => {
  const params=new URL(request.url).searchParams;
  const id=params.get('id');
  if (params.has('events')) {
    if (params.get('events')!=='true' || !id) throw new DashboardInputError('Selecciona el seguimiento para ver su historial.');
    const response=await dashboardList('client_journey_events',`select=*&journey_id=eq.${requireDashboardId(id)}&order=created_at.desc,id.desc`,request);const rows=await response.json();
    const ids=rows.filter((row:any)=>row.event_type==='email_queued' && row.metadata?.queue_id).map((row:any)=>requireDashboardId(row.metadata.queue_id));
    const sent=ids.length?await sbQuery('sent_emails',`select=operation_id,status&operation_id=in.(${ids.join(',')})&limit=100`):[];
    return dashResponse(rows.map((row:any)=>({...row,provider_status:sent.find(item=>item.operation_id===row.metadata?.queue_id)?.status??null})),200,Object.fromEntries(response.headers));
  }
  let query='select=*&order=updated_at.desc,id.desc';
  for (const field of ['id','lead_id','client_id','project_id']) if (params.has(field)) query+=`&${field}=eq.${requireDashboardId(params.get(field))}`;
  if (params.has('stage')) query+=`&stage=eq.${requireJourneyStage(params.get('stage'))}`;
  const response=await dashboardList('client_journeys',query,request);const rows=await response.json();
  const clients=rows.map((row:any)=>requireDashboardId(row.client_id));const leads=rows.filter((row:any)=>row.lead_id).map((row:any)=>requireDashboardId(row.lead_id));const projects=rows.map((row:any)=>requireDashboardId(row.project_id));
  const [clientRows,leadRows,projectRows]=await Promise.all([
    clients.length?sbQuery('clients',`select=id,name,email,phone,company&id=in.(${clients.join(',')})&limit=100`):[],
    leads.length?sbQuery('leads',`select=id,email,name,visitor_id&id=in.(${leads.join(',')})&limit=100`):[],
    projects.length?sbQuery('projects',`select=id,title&id=in.(${projects.join(',')})&limit=100`):[],
  ]);
  const enriched=await mapWithConcurrency(rows,6,async(row:any)=>{const client=clientRows.find(item=>item.id===row.client_id);const lead=leadRows.find(item=>item.id===row.lead_id);const project=projectRows.find(item=>item.id===row.project_id);return {...row,...await journeyTaskCounts(row.project_id),client_name:client?.name??row.client_name,project_title:project?.title??row.project_title,client_email:client?.email??'',client_phone:client?.phone??'',client_company:client?.company??'',lead_email:lead?.email??'',lead_name:lead?.name??'',lead_visitor_id:lead?.visitor_id??''};});
  return dashResponse(enriched,200,Object.fromEntries(response.headers));
});
export const POST = dashboardRoute(async ({ request }) => {
  const body=await dashboardJson(request,16000);
  if (Object.keys(body).some(key=>!['lead_id','operation_id','client_name','project_title','brief'].includes(key))) throw new DashboardInputError('Campos de seguimiento no admitidos.');
  const result=await sbRpc('dashboard_create_client_journey',{
    p_lead_id:requireDashboardId(body.lead_id),p_operation:requireDashboardId(body.operation_id),
    p_client_name:journeyText(body.client_name,'Nombre',150,true),p_project_title:journeyText(body.project_title,'Proyecto',200,true),
    p_brief:journeyText(body.brief??'','Brief',8000),
  });
  return dashResponse(journeyRpcRow(result),201);
});
export const PATCH = dashboardRoute(async ({ request }) => {
  const body=await dashboardJson(request,16000);const id=requireDashboardId(body.id);
  if (Object.keys(body).some(key=>!['id','stage','note','budget_amount','budget_currency','budget_scope','budget_timing','operation_id'].includes(key))) throw new DashboardInputError('Campos de seguimiento no admitidos.');
  const changes:Record<string,unknown>={};
  if (body.stage!==undefined) changes.stage=requireJourneyStage(body.stage);
  if (body.note!==undefined) changes.note=journeyText(body.note,'Nota',4000);
  if (body.budget_amount!==undefined) {
    if (body.budget_amount!==null && (typeof body.budget_amount!=='number' || !Number.isFinite(body.budget_amount) || body.budget_amount<0 || body.budget_amount>999999999 || Math.abs(Math.round(body.budget_amount*100)-body.budget_amount*100)>1e-7)) throw new DashboardInputError('Importe inválido.');
    changes.budget_amount=body.budget_amount;
  }
  if (body.budget_currency!==undefined) {
    if (typeof body.budget_currency!=='string' || !/^[A-Z]{3}$/.test(body.budget_currency)) throw new DashboardInputError('Moneda inválida.');
    changes.budget_currency=body.budget_currency;
  }
  if (body.budget_scope!==undefined) changes.budget_scope=journeyText(body.budget_scope,'Alcance',8000);
  if (body.budget_timing!==undefined) changes.budget_timing=journeyText(body.budget_timing,'Plazo',1000);
  if (!Object.keys(changes).length) throw new DashboardInputError('No hay cambios que guardar.');
  if(changes.stage!==undefined) {
    // Receipts must still replay after the stage has advanced; the SQL RPC owns
    // idempotency and repeats the guard while holding its transaction locks.
    const prior=await sbQuery('client_journey_operations',`id=eq.${requireDashboardId(body.operation_id)}&select=id&limit=1`);
    if(!prior.length){
      const rows=await sbQuery('client_journeys',`id=eq.${id}&select=*&limit=1`);
      if(rows.length){const before=journeyRpcRow(rows[0],id) as ClientJourney;const issue=journeyTransitionIssue(before,changes,await journeyTaskCounts(before.project_id));if(issue)throw new DashboardInputError(issue);}
    }
  }
  return dashResponse(journeyRpcRow(await sbRpc('dashboard_update_client_journey',{p_id:id,p_operation:requireDashboardId(body.operation_id),p_changes:changes}),id));
});
