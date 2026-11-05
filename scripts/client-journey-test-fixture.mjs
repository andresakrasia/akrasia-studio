import { randomUUID } from 'node:crypto';

// Synthetic service RPCs share the dashboard tables, including preview chat leads.
// This module is never imported by a production route.
export function attachClientJourneyFixture(tables,state) {
  for (const name of ['client_journeys','client_journey_events','email_drafts','client_journey_operations','integration_outbox']) tables[name]??=[];
  const clone=value=>structuredClone(value);
  const event=(journey,type,note,operation,metadata={})=>tables.client_journey_events.push({id:randomUUID(),journey_id:journey.id,event_type:type,stage:journey.stage,note,metadata,operation_id:operation,created_at:new Date().toISOString()});
  const resolveOperation=(type,operation,payload,json,work)=>{
    const prior=tables.client_journey_operations.find(row=>row.id===operation);
    if (prior) return prior.operation_type===type && JSON.stringify(prior.payload)===JSON.stringify(payload)?json(clone(prior.result)):json({error:'Synthetic operation conflict'},409);
    const result=work();if (!result) return;
    tables.client_journey_operations.push({id:operation,operation_type:type,payload:clone(payload),result:clone(result),created_at:new Date().toISOString()});json(result);
  };
  return ({url,body,json})=>{
    const rpc=url.pathname.replace('/rest/v1/rpc/','');
    if (!['dashboard_create_client_journey','dashboard_update_client_journey','dashboard_save_email_draft','dashboard_queue_email_draft'].includes(rpc)) return false;
    if (state.journeyUnavailable) { json({error:'Synthetic journey outage'},503);return true; }
    const now=new Date().toISOString();
    if (rpc==='dashboard_create_client_journey') {
      resolveOperation('create',body.p_operation,{lead_id:body.p_lead_id,client_name:body.p_client_name,project_title:body.p_project_title,brief:body.p_brief},json,()=>{
        const lead=tables.leads.find(row=>row.id===body.p_lead_id);if (!lead) {json({error:'Synthetic lead missing'},404);return;}
        const existing=tables.client_journeys.find(row=>row.lead_id===lead.id);if (existing) return existing;
        const client={id:randomUUID(),name:body.p_client_name,company:lead.company??'',email:lead.email??'',phone:lead.phone??'',notes:body.p_brief,created_at:now,updated_at:now};
        const project={id:randomUUID(),title:body.p_project_title,type:lead.project_type??'',status:'planning',client_id:client.id,client_name:client.name,description:body.p_brief,is_active:true,is_published:false,sort_order:0,created_at:now,updated_at:now};project.slug=`proyecto-${project.id}`;
        const journey={id:randomUUID(),lead_id:lead.id,client_id:client.id,project_id:project.id,client_name:client.name,project_title:project.title,brief:body.p_brief,stage:'received',budget_amount:null,budget_currency:'EUR',budget_scope:'',budget_timing:'',created_at:now,updated_at:now};
        tables.clients.push(client);tables.projects.push(project);tables.client_journeys.push(journey);event(journey,'created','Cliente y proyecto creados desde el lead.',body.p_operation);return journey;
      });
    }
    if (rpc==='dashboard_update_client_journey') {
      resolveOperation('update',body.p_operation,{id:body.p_id,changes:body.p_changes},json,()=>{
        const journey=tables.client_journeys.find(row=>row.id===body.p_id);if (!journey) {json({error:'Synthetic follow-up missing'},404);return;}
        const before=clone(journey);const {note='',...changes}=body.p_changes;const merged={...journey,...changes};
        if(before.stage!==merged.stage){
          const stages=['received','evaluating','quote_preparation','quote_sent','accepted','in_production','review','delivered','closed','lost'];const from=stages.indexOf(before.stage),to=stages.indexOf(merged.stage);
          if((merged.stage==='lost'||before.stage==='lost'||to<from)?!note.trim():to!==from+1){json({error:'Synthetic stage requires next phase or return reason'},400);return;}
          if(merged.stage==='quote_sent'&&(merged.budget_amount===null||!/^[A-Z]{3}$/.test(merged.budget_currency)||!merged.budget_scope.trim()||!merged.budget_timing.trim())){json({error:'Synthetic quote incomplete'},400);return;}
          if(['quote_sent','accepted','delivered','closed'].includes(merged.stage)&&!note.trim()){json({error:'Synthetic confirmation note missing'},400);return;}
          const tasks=tables.project_tasks.filter(row=>row.project_id===journey.project_id);
          if(merged.stage==='in_production'&&!tasks.length){json({error:'Synthetic production task missing'},400);return;}
          if(['delivered','closed'].includes(merged.stage)&&tasks.some(row=>row.status!=='completed')){json({error:'Synthetic pending production work'},400);return;}
        }
        Object.assign(journey,changes,{updated_at:now});
        if (before.stage!==journey.stage) {
          event(journey,'stage_changed',note,body.p_operation,{from:before.stage,to:journey.stage});
          const project=tables.projects.find(row=>row.id===journey.project_id);const status={in_production:'in_production',review:'post_production',delivered:'delivered',closed:'completed'}[journey.stage]??'planning';if(project)project.status=status;
        } else if (note.trim()) event(journey,'note',note,body.p_operation);
        if (['budget_amount','budget_currency','budget_scope','budget_timing'].some(key=>JSON.stringify(before[key])!==JSON.stringify(journey[key]))) event(journey,'quote_updated','Presupuesto actualizado.',body.p_operation,{amount:journey.budget_amount,currency:journey.budget_currency,scope:journey.budget_scope,timing:journey.budget_timing});
        return journey;
      });
    }
    if (rpc==='dashboard_save_email_draft') {
      resolveOperation('save_draft',body.p_operation,{id:body.p_id,revision:body.p_revision,fields:body.p_fields},json,()=>{
        const existing=tables.email_drafts.find(row=>row.id===body.p_id);
        if (existing && (existing.revision!==body.p_revision || existing.status!=='draft')) {json({error:'Synthetic draft revision conflict'},409);return;}
        if (!existing && body.p_revision!==0) {json({error:'Synthetic draft missing'},404);return;}
        const fields=clone(body.p_fields);
        if (fields.journey_id) {
          const journey=tables.client_journeys.find(row=>row.id===fields.journey_id);if (!journey) {json({error:'Synthetic follow-up missing'},404);return;}
          if (['lead_id','client_id','project_id'].some(key=>fields[key]!=null&&fields[key]!==journey[key])) {json({error:'Synthetic draft association conflict'},409);return;}
          for (const key of ['lead_id','client_id','project_id']) fields[key]=journey[key];
        }
        const draft={id:body.p_id,revision:(existing?.revision??0)+1,...fields,status:'draft',queue_id:null,created_at:existing?.created_at??now,updated_at:now};
        if (existing) Object.assign(existing,draft);else tables.email_drafts.push(draft);return draft;
      });
    }
    if (rpc==='dashboard_queue_email_draft') {
      resolveOperation('queue_draft',body.p_operation,{id:body.p_id,revision:body.p_revision},json,()=>{
        const draft=tables.email_drafts.find(row=>row.id===body.p_id);if (!draft) {json({error:'Synthetic draft missing'},404);return;}
        if (draft.revision!==body.p_revision) {json({error:'Synthetic draft revision conflict'},409);return;}
        if (draft.status==='draft') {
          if (!draft.to_email || !draft.subject.trim() || !draft.body_text.trim() || /\{\{[^}]+\}\}|\[[^\]\n]{1,120}\]/.test(draft.subject+draft.body_text)) {json({error:'Synthetic incomplete draft'},400);return;}
          const queue={id:randomUUID(),idempotency_key:`email-draft:${draft.id}:${draft.revision}`,channel:'email',payload:{to:draft.to_email,toName:draft.to_name,subject:draft.subject,bodyText:draft.body_text},status:'queued',created_at:now};
          tables.integration_outbox.push(queue);tables.sent_emails.push({id:randomUUID(),operation_id:queue.id,lead_id:draft.lead_id,to_email:draft.to_email,to_name:draft.to_name,subject:draft.subject,body_text:draft.body_text,template_type:draft.template_type,status:'queued',created_at:now});Object.assign(draft,{status:'queued',queue_id:queue.id,updated_at:now});
          const journey=tables.client_journeys.find(row=>row.id===draft.journey_id);if (journey) event(journey,'email_queued','Email preparado para envío.',body.p_operation,{draft_id:draft.id,queue_id:queue.id,subject:draft.subject,template_type:draft.template_type});
        }
        return {...draft,provider_status:tables.sent_emails.find(row=>row.operation_id===draft.queue_id)?.status??null};
      });
    }
    return true;
  };
}
