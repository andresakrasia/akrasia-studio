import { dashboardRoute, dashboardJson, dashResponse, dashboardList, requireDashboardId, DashboardInputError, sbRpc, sbQuery } from '../../../lib/dashboard';
import { EMAIL_DRAFT_TEMPLATES, journeyText, journeyRpcRow, requireDraftRevision } from '../../../lib/client-journey-contract';
import { validEmail } from '../../../lib/integration-outbox';

export const GET = dashboardRoute(async ({ request }) => {
  const params=new URL(request.url).searchParams;let query='select=*&order=updated_at.desc,id.desc';
  for (const field of ['id','journey_id','lead_id','client_id','project_id']) if (params.has(field)) query+=`&${field}=eq.${requireDashboardId(params.get(field))}`;
  const response=await dashboardList('email_drafts',query,request);const rows=await response.json();
  const ids:string[]=rows.filter((row:any)=>row.queue_id).map((row:any)=>requireDashboardId(row.queue_id));
  const sent=ids.length?await sbQuery('sent_emails',`select=operation_id,status&operation_id=in.(${ids.join(',')})&limit=100`):[];
  return dashResponse(rows.map((row:any)=>({...row,provider_status:row.queue_id?(sent.find(entry=>entry.operation_id===row.queue_id)?.status??null):null})),200,Object.fromEntries(response.headers));
});
export const POST = dashboardRoute(async ({ request }) => {
  const body=await dashboardJson(request,24000);const id=requireDashboardId(body.id);
  if (Object.keys(body).some(key=>!['id','revision','operation_id','to_email','to_name','subject','body_text','template_type','journey_id','lead_id','client_id','project_id'].includes(key))) throw new DashboardInputError('Campos de borrador no admitidos.');
  const to=journeyText(body.to_email??'','Destinatario',254);
  if (to && !validEmail(to)) throw new DashboardInputError('Email inválido.');
  const subject=journeyText(body.subject??'','Asunto',200);if (/[\r\n]/.test(subject)) throw new DashboardInputError('Asunto inválido.');
  const toName=journeyText(body.to_name??'','Nombre',150);if (/[\r\n]/.test(toName)) throw new DashboardInputError('Nombre inválido.');
  if (!EMAIL_DRAFT_TEMPLATES.includes(body.template_type as any)) throw new DashboardInputError('Plantilla inválida.');
  const fields:Record<string,unknown>={to_email:to,to_name:toName,subject,body_text:journeyText(body.body_text??'','Cuerpo',10000),template_type:body.template_type};
  for (const field of ['journey_id','lead_id','client_id','project_id']) fields[field]=body[field]==null?null:requireDashboardId(body[field]);
  return dashResponse(journeyRpcRow(await sbRpc('dashboard_save_email_draft',{p_id:id,p_revision:requireDraftRevision(body.revision??0,true),p_operation:requireDashboardId(body.operation_id),p_fields:fields}),id));
});
