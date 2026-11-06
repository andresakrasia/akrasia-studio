import { DashboardInputError, DashboardStorageError, dashboardId } from './dashboard';

export const JOURNEY_STAGES = ['received','evaluating','quote_preparation','quote_sent','accepted','in_production','review','delivered','closed','lost'] as const;
export type JourneyStage = typeof JOURNEY_STAGES[number];
export const EMAIL_DRAFT_TEMPLATES = ['evaluation','quote','follow_up','kickoff','progress','delivery','final_delivery','closure','custom'] as const;
export type EmailDraftTemplate = typeof EMAIL_DRAFT_TEMPLATES[number];
export interface ClientJourney { id:string; lead_id:string|null; client_id:string; project_id:string; client_name:string; project_title:string; brief:string; stage:JourneyStage; budget_amount:number|null; budget_currency:string; budget_scope:string; budget_timing:string; created_at:string; updated_at:string; lead_email?:string; lead_name?:string; lead_visitor_id?:string; client_email?:string; client_phone?:string; client_company?:string; tasks_total?:number; tasks_pending?:number; tasks_completed?:number }
export interface ClientJourneyEvent { id:string; journey_id:string; event_type:'created'|'stage_changed'|'note'|'quote_updated'|'email_queued'; stage:JourneyStage; note:string; metadata:Record<string,unknown>; operation_id:string; created_at:string; provider_status?:string|null }

export interface JourneyTaskCounts { tasks_total:number; tasks_pending:number; tasks_completed:number }
/** Mirrors the transactional SQL guard; gives the team a useful explanation before writing. */
export function journeyTransitionIssue(before:ClientJourney, changes:Record<string,unknown>, tasks:JourneyTaskCounts):string|null {
  const next=(changes.stage ?? before.stage) as JourneyStage;
  if (next===before.stage) return null;
  const fromIndex=JOURNEY_STAGES.indexOf(before.stage),toIndex=JOURNEY_STAGES.indexOf(next);
  const note=typeof changes.note==='string'?changes.note.trim():'';
  if (next==='lost' || before.stage==='lost' || toIndex<fromIndex) {
    if (!note) return 'Anota el motivo para retroceder, retomar o cerrar una propuesta que no continúa.';
  } else if (toIndex!==fromIndex+1) return 'Avanza a la siguiente etapa del seguimiento; completa cada fase antes de continuar.';
  if (next==='quote_sent') {
    const merged={...before,...changes};
    if (merged.budget_amount===null || typeof merged.budget_amount!=='number' || !/^[A-Z]{3}$/.test(merged.budget_currency) || !merged.budget_scope?.trim() || !merged.budget_timing?.trim()) return 'Completa importe, moneda, alcance y plazo antes de marcar el presupuesto como enviado.';
    if (!note) return 'Deja una nota confirmando cómo y cuándo se envió el presupuesto; un correo en cola todavía no confirma el envío.';
  }
  if (next==='accepted' && !note) return 'Anota la confirmación del cliente y las condiciones aceptadas.';
  if (next==='in_production' && tasks.tasks_total<1) return 'Añade al menos una tarea al proyecto antes de iniciar la producción.';
  if (next==='delivered' || next==='closed') {
    if (tasks.tasks_pending>0) return 'Completa las tareas pendientes antes de entregar o cerrar el proyecto.';
    if (!note) return next==='delivered'?'Anota el material entregado y la confirmación de entrega.':'Anota la confirmación del cliente y el cierre de los asuntos pendientes.';
  }
  return null;
}
export interface EmailDraft { id:string; revision:number; to_email:string; to_name:string; subject:string; body_text:string; template_type:EmailDraftTemplate; journey_id:string|null; lead_id:string|null; client_id:string|null; project_id:string|null; status:'draft'|'queued'; queue_id:string|null; provider_status?:string|null; created_at:string; updated_at:string }

export function journeyText(value:unknown,label:string,maximum:number,required=false):string {
  if (typeof value!=='string' || value.length>maximum || /[\u0000]/.test(value) || (required && !value.trim())) throw new DashboardInputError(`${label} inválido.`);
  return value.trim();
}
export function requireJourneyStage(value:unknown):JourneyStage {
  if (!JOURNEY_STAGES.includes(value as JourneyStage)) throw new DashboardInputError('Etapa inválida.');
  return value as JourneyStage;
}
export function requireDraftRevision(value:unknown,allowNew=false):number {
  if (!Number.isSafeInteger(value) || Number(value)<(allowNew?0:1) || Number(value)>2147483646) throw new DashboardInputError('Revisión inválida.');
  return Number(value);
}
export function journeyRpcRow(value:unknown,id?:string):Record<string,any> {
  if (!value || typeof value!=='object' || Array.isArray(value) || !dashboardId((value as Record<string,unknown>).id) || (id && (value as Record<string,unknown>).id!==id)) throw new DashboardStorageError();
  return value as Record<string,any>;
}
