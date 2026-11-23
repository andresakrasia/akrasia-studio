import type { ClientJourney, JourneyStage } from './client-journey-contract';

export interface JourneyProgressDraft { stage: JourneyStage; note: string; amount: string; currency: string; scope: string; timing: string }

export function journeyProgressFrom(journey: ClientJourney): JourneyProgressDraft {
  return { stage: journey.stage, note: '', amount: journey.budget_amount === null ? '' : String(journey.budget_amount), currency: journey.budget_currency || 'EUR', scope: journey.budget_scope || '', timing: journey.budget_timing || '' };
}

/** Synchronize a confirmed remote revision while retaining each local edit. */
export function mergeJourneyProgress(before: ClientJourney, local: JourneyProgressDraft, fresh: ClientJourney) {
  if (before.id !== fresh.id) throw new Error('La actualización no corresponde a esta ficha.');
  const baseline = journeyProgressFrom(before), incoming = journeyProgressFrom(fresh);
  const fields = ['stage', 'amount', 'currency', 'scope', 'timing'] as const;
  const progress = { ...local };
  const conflicts: (typeof fields[number])[] = [];
  let edited = !!local.note.trim();
  for (const field of fields) {
    const touched = local[field] !== baseline[field];
    edited ||= touched;
    if (touched && incoming[field] !== baseline[field]) conflicts.push(field);
    if (!touched) Object.assign(progress, { [field]: incoming[field] });
  }
  return { journey: { ...before, ...fresh }, progress, conflicts, stageChangedWithLocalEdits: edited && fresh.stage !== before.stage };
}

export const JOURNEY_STAGE_LABELS: Record<JourneyStage, string> = {
  received: 'Propuesta recibida', evaluating: 'En evaluación', quote_preparation: 'Preparando presupuesto', quote_sent: 'Presupuesto enviado',
  accepted: 'Presupuesto aceptado', in_production: 'En producción', review: 'Revisión del cliente', delivered: 'Entregado', closed: 'Cerrado', lost: 'No continúa',
};

/** "20 nov 2026" for a Madrid civil day, independent of the browser's time zone. */
export function shortCivilDate(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const value = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(value.getTime()) ? new Intl.DateTimeFormat('es-ES', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' }).format(value) : '';
}

/** A dated next step compared with today's Madrid civil day. */
export function nextActionState(date: string | null | undefined, today: string): 'none' | 'overdue' | 'today' | 'upcoming' {
  if (!date) return 'none';
  return date < today ? 'overdue' : date === today ? 'today' : 'upcoming';
}

/** Whole days until a chat contact leaves with the profile retention. */
export function daysUntil(iso: string | null | undefined, now = Date.now()): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isFinite(time) ? Math.ceil((time - now) / 86400000) : null;
}
