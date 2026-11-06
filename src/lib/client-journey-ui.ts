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
