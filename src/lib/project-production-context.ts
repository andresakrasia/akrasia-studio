import { DashboardStorageError, oneDashboardRow, requireDashboardId, sbQuery } from './dashboard';
import { JOURNEY_STAGES } from './client-journey-contract';
import { redactConversationSecrets } from './lead-conversation-context';

export interface ProductionTask { id: string; title: string; description: string; status: string; priority: string; }
export interface ProjectProductionContext {
  project: { id: string; title: string; description: string; status: string; hasThumbnail: boolean };
  journey: { id: string; stage: string; brief: string; budgetAmount: number | null; budgetCurrency: string; budgetScope: string; budgetTiming: string } | null;
  tasks: ProductionTask[];
}
/** Commercial approval outranks the project's coarse production status. */
export function productionTaskStageGuidance(context: ProjectProductionContext): string {
  const stage = context.journey?.stage;
  const instructions: Record<string, string> = {
    received: 'La propuesta acaba de recibirse. Propón tareas para comprender el encargo y reunir información; no supongas un presupuesto aceptado ni un encargo de producción confirmado.',
    evaluating: 'El equipo evalúa la propuesta. Propón tareas para aclarar objetivos, viabilidad y requisitos antes del presupuesto; no des por contratada la producción.',
    quote_preparation: 'El presupuesto se está preparando. Propón tareas para concretar alcance, costes y condiciones del presupuesto y revisarlo internamente. No afirmes que está enviado ni aceptado.',
    quote_sent: 'El presupuesto ya se envió y aún no está aceptado. Propón tareas de seguimiento y aclaración de la propuesta; no vuelvas a preparar o enviar el mismo presupuesto ni inicies una producción contratada.',
    accepted: 'El cliente ya aceptó el presupuesto. Planifica la preproducción, producción, revisión y entregables finales del alcance aprobado. No propongas volver a evaluar el presupuesto, estimar el precio, negociar condiciones, preparar otra propuesta comercial ni esperar aceptación. El estado planning del proyecto sólo significa que se organiza la producción y no invalida la aceptación.',
    in_production: 'La producción acordada está en curso. Propón únicamente trabajo de producción pendiente, control de calidad y preparación de entregables del alcance aprobado. No reinicies presupuesto ni aceptación ni repitas tareas existentes o completadas.',
    review: 'Hay una versión en revisión del cliente. Propón tareas para recoger y aplicar los comentarios reales disponibles, comprobar calidad y preparar los archivos finales. No inventes comentarios recibidos, no rehagas la propuesta comercial y no afirmes una aprobación todavía no registrada.',
    delivered: 'Los materiales finales están entregados. No generes trabajo de producción nuevo sin retomar primero el seguimiento.',
    closed: 'El proyecto está cerrado. No generes trabajo de producción nuevo sin retomar primero el seguimiento.',
    lost: 'La propuesta no continúa. No presupongas aceptación ni producción activa; cualquier retorno necesita que el equipo retome el seguimiento.',
  };
  return stage ? `La etapa comercial canónica es ${stage}. ${instructions[stage]}`
    : 'El proyecto no tiene una etapa comercial vinculada. Organiza el trabajo indicado en su descripción y estado guardados; no inventes una negociación o una aceptación de presupuesto.';
}
const text = (value: unknown, limit: number) => {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > limit || /[\u0000\u0008\u000b\u000c]/.test(value)) throw new DashboardStorageError();
  return redactConversationSecrets(value).replaceAll('[Dato sensible omitido]', '').trim();
};
export const productionTaskKey = (title: string) => title.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase('es-ES').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function loadProductionTasks(projectId: string, signal?: AbortSignal): Promise<ProductionTask[]> {
  const rows = await sbQuery('project_tasks', `project_id=eq.${projectId}&select=id,project_id,title,description,status,priority&order=created_at.asc,id.asc&limit=501`, signal);
  // Refuse a partial context instead of silently duplicating tasks outside a page.
  if (rows.length > 500) throw new DashboardStorageError(409, 'production_tasks_context_limit');
  return rows.map(row => {
    if (row.project_id !== projectId || !['pending', 'in_progress', 'completed'].includes(row.status)) throw new DashboardStorageError();
    return { id: requireDashboardId(row.id), title: text(row.title, 300), description: text(row.description, 5000).slice(0, 500), status: row.status, priority: text(row.priority, 20) };
  });
}
export async function loadProjectProductionContext(projectId: string, signal?: AbortSignal): Promise<ProjectProductionContext> {
  const id = requireDashboardId(projectId);
  const project = oneDashboardRow(await sbQuery('projects', `id=eq.${id}&select=id,title,description,status,thumbnail,client_id&limit=2`, signal), id);
  const [journeys, tasks] = await Promise.all([
    sbQuery('client_journeys', `project_id=eq.${id}&select=id,project_id,client_id,stage,brief,budget_amount,budget_currency,budget_scope,budget_timing&limit=2`, signal),
    loadProductionTasks(id, signal),
  ]);
  if (journeys.length > 1) throw new DashboardStorageError();
  const row = journeys[0];
  if (row && (row.project_id !== id || row.client_id !== project.client_id || !JOURNEY_STAGES.includes(row.stage) ||
      row.budget_amount != null && (typeof row.budget_amount !== 'number' || !Number.isFinite(row.budget_amount) || row.budget_amount < 0))) throw new DashboardStorageError();
  return {
    project: { id, title: text(project.title, 200), description: text(project.description, 10000), status: text(project.status, 30), hasThumbnail: !!project.thumbnail },
    journey: row ? { id: requireDashboardId(row.id), stage: row.stage, brief: text(row.brief, 8000), budgetAmount: row.budget_amount ?? null,
      budgetCurrency: text(row.budget_currency, 3), budgetScope: text(row.budget_scope, 8000), budgetTiming: text(row.budget_timing, 2000) } : null,
    tasks,
  };
}
