import { useCallback, useEffect, useRef, useState } from 'react';
import type { ClientJourney as StoredJourney, ClientJourneyEvent, JourneyStage } from '../../lib/client-journey-contract';
import type { EmailDraftContext } from '../../lib/client-email-writing';
import { checkedLeadConversationContext, conversationWritingContext, emailDraftStateLabel, EMAIL_TEMPLATES } from '../../lib/client-email-writing';
import type { LeadConversationContext } from '../../lib/lead-conversation-context';
import { LeadConversationOverview } from './EmailComposer';
import { journeyProgressFrom, mergeJourneyProgress, type JourneyProgressDraft } from '../../lib/client-journey-ui';

export interface LeadContact {
  id: string;
  visitor_id?: string;
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  project_type?: string | null;
  summary?: string | null;
}

export type ClientJourney = StoredJourney;

export type ClientJourneyEmailContext = EmailDraftContext;

export interface ClientJourneyPanelProps {
  lead?: LeadContact;
  journeyId?: string;
  projectId?: string;
  request: (endpoint: string, options?: RequestInit) => Promise<Response>;
  onClose?: () => void;
  onEmailDraft: (context: ClientJourneyEmailContext) => void;
  onCreated?: () => void;
  onOpenProject?: (projectId: string) => void;
}

const STAGES: { value: JourneyStage; label: string; next: string }[] = [
  { value: 'received', label: 'Propuesta recibida', next: 'Confirma al cliente que hemos recibido la propuesta. Después pasa a evaluación para revisar el encargo con el equipo.' },
  { value: 'evaluating', label: 'En evaluación', next: 'Revisa objetivos, formato y necesidades con el equipo. Resuelve las dudas y pasa a preparar el presupuesto cuando el alcance esté claro.' },
  { value: 'quote_preparation', label: 'Preparando presupuesto', next: 'Define importe, moneda, alcance y condiciones. Redacta el presupuesto; marca el envío sólo después de confirmarlo y registra cómo se envió.' },
  { value: 'quote_sent', label: 'Presupuesto enviado', next: 'Espera la respuesta del cliente. Si acepta, registra su confirmación y pasa a presupuesto aceptado. Puedes preparar un seguimiento mientras tanto.' },
  { value: 'accepted', label: 'Presupuesto aceptado', next: 'Acuerda los materiales y próximos pasos con el cliente. Abre el proyecto y crea al menos una tarea antes de iniciar producción.' },
  { value: 'in_production', label: 'En producción', next: 'Gestiona las tareas y comunica avances confirmados. Cuando haya una versión lista, pasa a revisión del cliente.' },
  { value: 'review', label: 'Revisión del cliente', next: 'Envía el material para revisión y registra sus comentarios. Completa las tareas pendientes y anota su aprobación antes de marcar la entrega final.' },
  { value: 'delivered', label: 'Entregado', next: 'Comparte los archivos finales y confirma su recepción. Cierra cuando no haya tareas pendientes y hayas anotado la confirmación y los acuerdos de cierre.' },
  { value: 'closed', label: 'Cerrado', next: 'El proyecto está cerrado. Puedes enviar un agradecimiento y conservar esta ficha para futuras colaboraciones.' },
  { value: 'lost', label: 'No continúa', next: 'Anota el motivo y deja el historial disponible por si se retoma la propuesta.' },
];
const STAGE_LABELS = Object.fromEntries(STAGES.map(stage => [stage.value, stage.label])) as Record<JourneyStage, string>;
const INPUT = 'w-full bg-[#050505] border border-cyan-500/25 rounded px-3 py-2 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-primary/60 disabled:opacity-50';
const BUTTON = 'rounded border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed';
const CARD = 'rounded-lg border border-cyan-500/25 bg-[#0a0a0a] p-4';

type ProgressDraft = JourneyProgressDraft;
const EMPTY_PROGRESS: ProgressDraft = { stage: 'received', note: '', amount: '', currency: 'EUR', scope: '', timing: '' };
function progressFrom(journey: ClientJourney): ProgressDraft {
  return journeyProgressFrom(journey);
}
function defaultCreation(lead?: LeadContact) {
  const name = lead?.name || lead?.company || lead?.email || '';
  return { client_name: name.slice(0, 150), project_title: (lead?.project_type ? `${lead.project_type} · ${name}` : name ? `Proyecto de ${name}` : '').slice(0, 200), brief: (lead?.summary || '').slice(0, 8000) };
}
function creationFromConversation(seed: ReturnType<typeof defaultCreation>, conversation: LeadConversationContext) {
  const context = conversationWritingContext({ toName: seed.client_name, projectTitle: seed.project_title, brief: seed.brief, to: conversation.email }, conversation);
  return { client_name: (context.toName || seed.client_name).slice(0, 150), project_title: (conversation.source !== 'none' && conversation.projectTitle ? conversation.projectTitle : context.projectTitle || seed.project_title).slice(0, 200), brief: (context.brief || '').slice(0, 8000) };
}
function getError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
async function responseData(response: Response): Promise<unknown> {
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : 'No se pudo guardar o cargar la ficha. Inténtalo de nuevo.';
    throw new Error(message);
  }
  return data;
}
function requireJourney(data: unknown): ClientJourney {
  if (!data || typeof data !== 'object' || !('id' in data) || typeof data.id !== 'string' || !('stage' in data) || !STAGES.some(stage => stage.value === data.stage)) throw new Error('El servidor no confirmó la ficha guardada.');
  return data as ClientJourney;
}
function nextOffset(response: Response): number | null {
  const value = response.headers.get('x-next-offset');
  return value === null || value === '' ? null : Number(value);
}
function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' }).format(date) : '';
}
function formatBudget(journey: ClientJourney) {
  if (journey.budget_amount === null) return 'Pendiente de definir';
  try { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: journey.budget_currency }).format(journey.budget_amount); }
  catch { return `${journey.budget_amount} ${journey.budget_currency}`; }
}

function HistoryEventDetails({ event }: { event: ClientJourneyEvent }) {
  const metadata = event.metadata && typeof event.metadata === 'object' ? event.metadata : {};
  const text = (key: string) => typeof metadata[key] === 'string' ? metadata[key] as string : '';
  if (event.event_type === 'quote_updated') {
    const amount = typeof metadata.amount === 'number' ? metadata.amount : null;
    const currency = text('currency');
    let formatted = amount === null ? 'Pendiente de definir' : `${amount} ${currency}`;
    if (amount !== null && /^[A-Z]{3}$/.test(currency)) {
      try { formatted = new Intl.NumberFormat('es-ES', { style: 'currency', currency }).format(amount); } catch { /* Keep the explicit amount when a currency is not supported. */ }
    }
    return <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-slate-400"><p>Presupuesto registrado: <span className="text-slate-200">{formatted}</span></p><details><summary className="cursor-pointer">Ver alcance y condiciones de esta versión</summary><p className="mt-2 whitespace-pre-wrap break-words">Alcance: {text('scope') || 'Pendiente de definir'}</p><p className="mt-2 whitespace-pre-wrap break-words">Plazos y condiciones: {text('timing') || 'Pendiente de definir'}</p></details></div>;
  }
  if (event.event_type === 'email_queued') {
    const template = EMAIL_TEMPLATES.find(item => item.value === text('template_type'));
    return <div className="mt-2 space-y-2 text-[11px] leading-relaxed text-slate-400">{text('subject') && <p className="break-words">Asunto: <span className="text-slate-200">{text('subject')}</span></p>}{template && <p>Tipo de correo: {template.label}</p>}<p>{event.provider_status ? emailDraftStateLabel({ status: 'queued', provider_status: event.provider_status }) : 'Registrado en la cola de envío; estado del proveedor pendiente de consulta.'}</p><p className="text-slate-500">Consulta Emails para revisar el correo y su estado actual. La aceptación del proveedor no confirma la entrega.</p><details><summary className="cursor-pointer">Referencias del correo</summary><div className="mt-2 space-y-1 break-all">{text('draft_id') && <p>Correo: {text('draft_id')}</p>}{text('queue_id') && <p>Operación de envío: {text('queue_id')}</p>}</div></details></div>;
  }
  return null;
}

export default function ClientJourneyPanel({ lead, journeyId, projectId, request, onClose, onEmailDraft, onCreated, onOpenProject }: ClientJourneyPanelProps) {
  const [selectedId, setSelectedId] = useState('');
  const [journey, setJourney] = useState<ClientJourney | null>(null);
  const [rows, setRows] = useState<ClientJourney[]>([]);
  const [offset, setOffset] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [total, setTotal] = useState(0);
  const [creation, setCreation] = useState(() => defaultCreation(lead));
  const [creationBaseline, setCreationBaseline] = useState(() => defaultCreation(lead));
  const creationEdits = useRef(new Set<keyof ReturnType<typeof defaultCreation>>());
  const [conversation, setConversation] = useState<LeadConversationContext | null>(null);
  const [contextLoading, setContextLoading] = useState(!!lead?.id);
  const [contextError, setContextError] = useState('');
  const [contextReload, setContextReload] = useState(0);
  const [progress, setProgress] = useState<ProgressDraft>(EMPTY_PROGRESS);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [notice, setNotice] = useState('');
  const [syncWarning, setSyncWarning] = useState('');
  const [instanceId] = useState(() => crypto.randomUUID());
  const [closeIntent, setCloseIntent] = useState(false);
  const [reload, setReload] = useState(0);
  const [events, setEvents] = useState<ClientJourneyEvent[]>([]);
  const [eventsNext, setEventsNext] = useState<number | null>(null);
  const [eventsTotal, setEventsTotal] = useState(0);
  const [eventsPending, setEventsPending] = useState(false);
  const [eventsError, setEventsError] = useState('');
  const [eventsReload, setEventsReload] = useState(0);
  const generation = useRef(0);
  const eventsGeneration = useRef(0);
  const lock = useRef(false);
  const eventRequest = useRef<number | null>(null);
  const operation = useRef<{ fingerprint: string; id: string } | null>(null);
  const liveJourney = useRef(journey);
  const liveProgress = useRef(progress);
  const syncSerial = useRef(0);
  liveJourney.current = journey;
  liveProgress.current = progress;
  const focusId = journeyId || selectedId;
  const listMode = !focusId && !projectId && !lead?.id;
  const contextLeadId = lead?.id || journey?.lead_id || '';

  useEffect(() => {
    setSelectedId('');
    setCreation(defaultCreation(lead));
    setCreationBaseline(defaultCreation(lead));
    creationEdits.current.clear();
    setNotice('');
    setSyncWarning('');
    setCloseIntent(false);
    operation.current = null;
  }, [lead?.id, journeyId, projectId]);

  useEffect(() => {
    const current = ++generation.current;
    let active = true;
    setLoading(true);
    setError('');
    setLoadError('');
    setPending(false);
    setJourney(null);
    const params = new URLSearchParams({ limit: '25', offset: listMode ? String(offset) : '0' });
    if (focusId) params.set('id', focusId);
    else if (projectId) params.set('project_id', projectId);
    else if (lead?.id) params.set('lead_id', lead.id);
    void request(`/api/dashboard/client-journeys?${params}`).then(async response => {
      const data = await responseData(response);
      if (!Array.isArray(data)) throw new Error('La respuesta del seguimiento no es válida.');
      if (!active || current !== generation.current) return;
      if (listMode) {
        setRows(data.map(requireJourney));
        setNext(nextOffset(response));
        setTotal(Number(response.headers.get('x-total-count') || data.length));
      } else {
        const loaded = data.length ? requireJourney(data[0]) : null;
        setJourney(loaded);
        if (loaded) setProgress(progressFrom(loaded));
      }
    }).catch(cause => {
      if (active && current === generation.current) setLoadError(getError(cause, 'No se pudo cargar el seguimiento.'));
    }).finally(() => {
      if (active && current === generation.current) setLoading(false);
    });
    return () => { active = false; };
  }, [request, focusId, projectId, lead?.id, listMode, offset, reload]);

  useEffect(() => {
    let active = true;
    setConversation(null);
    setContextError('');
    setContextLoading(!!contextLeadId);
    if (!contextLeadId) return;
    void request(`/api/dashboard/lead-context?lead_id=${encodeURIComponent(contextLeadId)}`).then(async response => {
      const facts = checkedLeadConversationContext(await responseData(response), contextLeadId);
      if (!active) return;
      setConversation(facts);
      if (lead?.id === contextLeadId) {
        setCreationBaseline(previous => creationFromConversation(previous, facts));
        setCreation(previous => {
          const filled = creationFromConversation(previous, facts);
          return { client_name: creationEdits.current.has('client_name') ? previous.client_name : filled.client_name, project_title: creationEdits.current.has('project_title') ? previous.project_title : filled.project_title, brief: creationEdits.current.has('brief') ? previous.brief : filled.brief };
        });
      }
    }).catch(failure => { if (active) setContextError(getError(failure, 'No se pudo recuperar la conversación del cliente.')); }).finally(() => { if (active) setContextLoading(false); });
    return () => { active = false; };
  }, [request, contextLeadId, contextReload, lead?.id]);

  function editCreation<K extends keyof ReturnType<typeof defaultCreation>>(key: K, value: string) {
    creationEdits.current.add(key);
    setCreation(previous => ({ ...previous, [key]: value }));
  }

  const loadEvents = useCallback(async (id: string, eventOffset: number, current: number) => {
    if (eventRequest.current === current) return;
    eventRequest.current = current;
    setEventsPending(true);
    setEventsError('');
    try {
      const response = await request(`/api/dashboard/client-journeys?id=${encodeURIComponent(id)}&events=true&offset=${eventOffset}&limit=25`);
      const data = await responseData(response);
      if (!Array.isArray(data)) throw new Error('La respuesta del historial no es válida.');
      if (current !== eventsGeneration.current) return;
      const loaded = data as ClientJourneyEvent[];
      setEvents(previous => eventOffset ? [...previous, ...loaded.filter(event => !previous.some(item => item.id === event.id))] : loaded);
      setEventsNext(nextOffset(response));
      setEventsTotal(Number(response.headers.get('x-total-count') || loaded.length));
    } catch (cause) {
      if (current === eventsGeneration.current) setEventsError(getError(cause, 'No se pudo cargar el historial.'));
    } finally {
      if (eventRequest.current === current) eventRequest.current = null;
      if (current === eventsGeneration.current) setEventsPending(false);
    }
  }, [request]);

  useEffect(() => {
    const current = ++eventsGeneration.current;
    setEvents([]);
    setEventsNext(null);
    setEventsError('');
    setEventsPending(false);
    if (journey?.id) void loadEvents(journey.id, 0, current);
    return () => { eventsGeneration.current++; };
  }, [journey?.id, loadEvents, eventsReload]);

  useEffect(() => {
    if (!journey?.id) return;
    const onEmailQueued = (event: Event) => {
      if ((event as CustomEvent<{ journeyId?: string }>).detail?.journeyId === journey.id) setEventsReload(value => value + 1);
    };
    window.addEventListener('dashboard-journey-email-queued', onEmailQueued);
    return () => window.removeEventListener('dashboard-journey-email-queued', onEmailQueued);
  }, [journey?.id]);

  useEffect(() => {
    let active = true;
    const synchronizeJourney = (event: Event) => {
      const detail = (event as CustomEvent<{ journeyId?: string; projectId?: string; sourceId?: string }>).detail;
      if (!detail || detail.sourceId === instanceId) return;
      const current = liveJourney.current;
      if (!listMode && (!current || detail.journeyId !== current.id && detail.projectId !== current.project_id)) return;
      const serial = ++syncSerial.current;
      const query = listMode ? `limit=25&offset=${offset}` : `id=${encodeURIComponent(current!.id)}`;
      void request(`/api/dashboard/client-journeys?${query}`).then(async response => {
        const data = await responseData(response);
        if (!Array.isArray(data)) throw new Error('No se pudo actualizar el seguimiento.');
        if (!active || serial !== syncSerial.current) return;
        if (listMode) {
          setRows(data.map(requireJourney)); setNext(nextOffset(response)); setTotal(Number(response.headers.get('x-total-count') || data.length));
          return;
        }
        if (data.length !== 1) throw new Error('No se pudo recuperar la ficha actualizada.');
        const fresh = requireJourney(data[0]), before = liveJourney.current;
        if (!before || before.id !== fresh.id || Date.parse(fresh.updated_at) < Date.parse(before.updated_at)) return;
        const merged = mergeJourneyProgress(before, liveProgress.current, fresh);
        if (merged.stageChangedWithLocalEdits || merged.conflicts.length) setSyncWarning(`La ficha se actualizó en otra sección. Etapa actual: ${STAGE_LABELS[fresh.stage]}. Tus cambios locales se conservan; revisa la etapa, los datos y la nota antes de guardar.`);
        setProgress(local => mergeJourneyProgress(before, local, fresh).progress);
        liveJourney.current = { ...before, ...fresh };
        setJourney(liveJourney.current);
        setEventsReload(value => value + 1);
      }).catch(failure => { if (active && serial === syncSerial.current) setError(getError(failure, 'No se pudo sincronizar el seguimiento. Actualiza la ficha para reintentar.')); });
    };
    window.addEventListener('dashboard-journey-updated', synchronizeJourney);
    // Reconcile an already-open panel too, including an update that occurred
    // before its listener was attached or while the module was refreshed.
    const current = liveJourney.current;
    if (current && !listMode) synchronizeJourney(new CustomEvent('dashboard-journey-updated', { detail: { journeyId: current.id } }));
    return () => { active = false; syncSerial.current++; window.removeEventListener('dashboard-journey-updated', synchronizeJourney); };
  }, [request, instanceId, listMode, offset, journey?.id]);

  useEffect(() => {
    if (!journey) return;
    let active = true;
    const refreshContactAndTasks = (event: Event) => {
      const detail = (event as CustomEvent<{ clientId?: string; projectId?: string }>).detail;
      if (detail?.clientId !== journey.client_id && detail?.projectId !== journey.project_id) return;
      void request(`/api/dashboard/client-journeys?id=${encodeURIComponent(journey.id)}`).then(async response => {
        const rows = await responseData(response);
        if (!Array.isArray(rows) || rows.length !== 1) throw new Error('No se pudo actualizar la ficha vinculada.');
        const refreshed = requireJourney(rows[0]);
        if (active) setJourney(previous => previous?.id === refreshed.id ? { ...previous, client_name: refreshed.client_name, client_email: refreshed.client_email, client_phone: refreshed.client_phone, client_company: refreshed.client_company, project_title: refreshed.project_title, tasks_total: refreshed.tasks_total, tasks_pending: refreshed.tasks_pending, tasks_completed: refreshed.tasks_completed } : previous);
      }).catch(failure => { if (active) setError(getError(failure, 'No se pudo actualizar el contacto o las tareas. Actualiza la ficha para reintentar.')); });
    };
    window.addEventListener('dashboard-client-updated', refreshContactAndTasks);
    window.addEventListener('dashboard-project-tasks-updated', refreshContactAndTasks);
    return () => { active = false; window.removeEventListener('dashboard-client-updated', refreshContactAndTasks); window.removeEventListener('dashboard-project-tasks-updated', refreshContactAndTasks); };
  }, [journey?.id, journey?.client_id, journey?.project_id, request]);

  function operationFor(payload: object) {
    const fingerprint = JSON.stringify(payload);
    if (!operation.current || operation.current.fingerprint !== fingerprint) operation.current = { fingerprint, id: crypto.randomUUID() };
    return operation.current.id;
  }

  async function createJourney(): Promise<boolean> {
    if (!lead || lock.current || contextLoading) return false;
    if (!creation.client_name.trim() || !creation.project_title.trim()) { setError('Completa el nombre del cliente y el título del proyecto.'); return false; }
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    const current = generation.current;
    const payload = { lead_id: lead.id, client_name: creation.client_name.trim(), project_title: creation.project_title.trim(), brief: creation.brief.trim() };
    try {
      const response = await request('/api/dashboard/client-journeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, operation_id: operationFor(payload) }) });
      const saved = requireJourney(await responseData(response));
      if (current !== generation.current) return false;
      setJourney({ ...saved, lead_email: lead.email || undefined, lead_name: lead.name || undefined, lead_visitor_id: lead.visitor_id });
      setProgress(progressFrom(saved));
      operation.current = null;
      setNotice('Cliente, proyecto y seguimiento creados. Ya puedes preparar el primer email.');
      onCreated?.();
      window.dispatchEvent(new CustomEvent('dashboard-journey-updated', { detail: { projectId: saved.project_id, journeyId: saved.id, sourceId: instanceId } }));
      setReload(value => value + 1);
      return true;
    } catch (cause) {
      if (current === generation.current) setError(getError(cause, 'No se pudo crear la ficha. Tus datos siguen aquí para reintentar.'));
      return false;
    } finally { lock.current = false; if (current === generation.current) setPending(false); }
  }

  async function saveProgress(): Promise<boolean> {
    if (!journey || lock.current) return false;
    const amountText = progress.amount.trim();
    if (amountText && !/^\d+(?:[.,]\d{1,2})?$/.test(amountText)) { setError('Introduce un importe positivo con un máximo de dos decimales.'); return false; }
    const amount = amountText ? Number(amountText.replace(',', '.')) : null;
    if (amount !== null && (!Number.isFinite(amount) || amount > 999999999)) { setError('El importe es demasiado alto.'); return false; }
    if (!/^[A-Z]{3}$/.test(progress.currency)) { setError('Indica una moneda con tres letras, por ejemplo EUR.'); return false; }
    if (transitionIssue) { setError(transitionIssue); return false; }
    const payload = { id: journey.id, stage: progress.stage, note: progress.note.trim(), budget_amount: amount, budget_currency: progress.currency, budget_scope: progress.scope.trim(), budget_timing: progress.timing.trim() };
    lock.current = true;
    setPending(true);
    setError('');
    setNotice('');
    const current = generation.current;
    try {
      const response = await request('/api/dashboard/client-journeys', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...payload, operation_id: operationFor(payload) }) });
      const saved = requireJourney(await responseData(response));
      if (current !== generation.current) return false;
      setJourney({ ...journey, ...saved });
      setProgress(progressFrom(saved));
      operation.current = null;
      setNotice('Seguimiento guardado.');
      setSyncWarning('');
      setEventsReload(value => value + 1);
      window.dispatchEvent(new CustomEvent('dashboard-journey-updated', { detail: { projectId: saved.project_id, journeyId: saved.id, sourceId: instanceId } }));
      return true;
    } catch (cause) {
      if (current === generation.current) setError(getError(cause, 'No se pudieron guardar los cambios. Tus notas siguen aquí.'));
      return false;
    } finally { lock.current = false; if (current === generation.current) setPending(false); }
  }

  function compose(templateType: ClientJourneyEmailContext['templateType']) {
    if (!journey) return;
    const initial: EmailDraftContext = { leadId: journey.lead_id || undefined, visitorId: lead?.visitor_id || journey.lead_visitor_id, clientId: journey.client_id, projectId: journey.project_id, journeyId: journey.id, to: journey.client_email || journey.lead_email || lead?.email || '', toName: journey.client_name || journey.lead_name || lead?.name || '', projectTitle: journey.project_title, brief: journey.brief, budgetAmount: journey.budget_amount, budgetCurrency: journey.budget_currency, budgetScope: journey.budget_scope, budgetTiming: journey.budget_timing, templateType };
    onEmailDraft(conversation ? conversationWritingContext(initial, conversation) : initial);
  }

  const baseline = journey ? progressFrom(journey) : EMPTY_PROGRESS;
  const budgetDirty = progress.amount.trim().replace(',', '.') !== baseline.amount || progress.currency !== baseline.currency || progress.scope.trim() !== baseline.scope || progress.timing.trim() !== baseline.timing;
  const dirty = budgetDirty || progress.stage !== baseline.stage || !!progress.note.trim();
  const creationDirty = !journey && !!lead && JSON.stringify(creation) !== JSON.stringify(creationBaseline);
  const effectiveJourney = journey && conversation ? conversationWritingContext({ toName: journey.client_name, projectTitle: journey.project_title, brief: journey.brief, to: journey.client_email || journey.lead_email }, conversation) : { toName: journey?.client_name, projectTitle: journey?.project_title, brief: journey?.brief };
  const stageIndex = journey ? STAGES.findIndex(stage => stage.value === journey.stage) : -1;
  const stageTemplates: Record<JourneyStage, ClientJourneyEmailContext['templateType']> = { received: 'evaluation', evaluating: 'evaluation', quote_preparation: 'quote', quote_sent: 'follow_up', accepted: 'kickoff', in_production: 'progress', review: 'delivery', delivered: 'final_delivery', closed: 'closure', lost: 'follow_up' };
  const recommendedTemplate = journey ? stageTemplates[journey.stage] : 'evaluation';
  const recommendedLabel = `Redactar ${EMAIL_TEMPLATES.find(template => template.value === recommendedTemplate)?.label.toLowerCase() || 'email'}`;
  const registeredStages = new Set(events.filter(event => ['created', 'stage_changed'].includes(event.event_type)).map(event => event.stage));
  const nextStage = journey && stageIndex >= 0 && stageIndex < 8 ? STAGES[stageIndex + 1] : null;
  const selectableStages = journey ? STAGES.filter((stage, index) => stage.value === progress.stage || stage.value === 'lost' || journey.stage === 'lost' || index <= stageIndex + 1) : STAGES;
  let transitionIssue = '';
  if (journey && progress.stage !== journey.stage) {
    const destination = STAGES.findIndex(stage => stage.value === progress.stage);
    if (journey.stage !== 'lost' && progress.stage !== 'lost' && destination > stageIndex + 1) transitionIssue = 'Avanza una etapa cada vez para conservar el seguimiento de los acuerdos.';
    else if ((progress.stage === 'lost' || journey.stage === 'lost' || destination < stageIndex || ['quote_sent', 'accepted', 'delivered', 'closed'].includes(progress.stage)) && !progress.note.trim()) transitionIssue = progress.stage === 'quote_sent' ? 'Anota cómo confirmaste el envío del presupuesto.' : progress.stage === 'accepted' ? 'Anota la confirmación de aceptación del cliente.' : progress.stage === 'delivered' ? 'Anota la aprobación y los materiales finales entregados.' : progress.stage === 'closed' ? 'Anota la recepción de la entrega y los acuerdos de cierre.' : 'Añade una nota que explique este cambio de etapa.';
    else if (progress.stage === 'quote_sent' && (!progress.amount.trim() || !progress.scope.trim() || !progress.timing.trim())) transitionIssue = 'Completa importe, moneda, alcance y condiciones antes de confirmar el envío del presupuesto.';
    else if (progress.stage === 'in_production' && journey.tasks_total === 0) transitionIssue = 'Crea al menos una tarea en el proyecto antes de iniciar producción.';
    else if (['delivered', 'closed'].includes(progress.stage) && typeof journey.tasks_pending === 'number' && journey.tasks_pending > 0) transitionIssue = journey.tasks_pending === 1 ? 'Completa la tarea pendiente antes de entregar o cerrar.' : `Completa las ${journey.tasks_pending} tareas pendientes antes de entregar o cerrar.`;
  }
  const listBack = !lead && !journeyId && !projectId && !!selectedId;
  const closeNow = () => { setCloseIntent(false); if (listBack) { setSelectedId(''); setNotice(''); } else onClose?.(); };
  const close = () => { if (pending) return; if (journey ? dirty : creationDirty) setCloseIntent(true); else closeNow(); };
  const saveAndClose = async () => {
    if (journey && !dirty) { closeNow(); return; }
    const saved = journey ? await saveProgress() : await createJourney();
    if (saved) closeNow();
  };

  return <section className="space-y-4" aria-label="Seguimiento del cliente">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-base text-slate-100">{listMode ? 'Seguimiento de clientes' : journey ? effectiveJourney.projectTitle : 'Del lead al proyecto'}</h2><p className="mt-1 text-xs text-slate-400">{listMode ? 'Toda la relación, desde la propuesta inicial hasta la entrega.' : 'Ficha del cliente, proyecto y acuerdos en un mismo lugar.'}</p></div>
      {(onClose || listBack) && <button type="button" onClick={close} disabled={pending} className="rounded border border-cyan-500/25 px-3 py-2 text-xs text-slate-400 hover:text-slate-100 disabled:opacity-40">{listBack ? 'Volver a la lista' : 'Cerrar ficha'}</button>}
    </div>
    {(error || loadError) && <div role="alert" className="rounded border border-red-400/25 bg-red-500/10 p-3 text-sm text-red-300">{error || loadError}{loadError && <button type="button" onClick={() => setReload(value => value + 1)} disabled={loading} className="ml-3 underline">Reintentar carga</button>}</div>}
    {closeIntent && <div role="alert" className="rounded border border-amber-400/30 bg-amber-500/5 p-4"><p className="text-sm text-amber-200">Hay cambios sin guardar en esta ficha.</p><p className="mt-2 text-xs text-slate-400">Guárdalos antes de salir o continúa editando.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => void saveAndClose()} className={BUTTON}>{pending ? 'Guardando…' : 'Guardar y cerrar'}</button><button type="button" disabled={pending} onClick={() => setCloseIntent(false)} className={BUTTON}>Seguir editando</button><button type="button" disabled={pending} onClick={closeNow} className="rounded border border-slate-700 px-3 py-2 text-xs text-slate-400 hover:text-slate-200 disabled:opacity-40">Descartar cambios</button></div></div>}
    {notice && <p role="status" className="rounded bg-primary/5 p-3 text-sm text-primary">{notice}</p>}
    {syncWarning && <p role="alert" className="rounded border border-amber-400/30 bg-amber-500/5 p-3 text-xs leading-relaxed text-amber-200">{syncWarning}</p>}
    {!!contextLeadId && <LeadConversationOverview conversation={conversation} loading={contextLoading} error={contextError} onRetry={() => setContextReload(value => value + 1)} savedTiming={journey?.budget_timing} />}
    {loading && <p role="status" className="py-8 text-sm text-slate-400">Cargando seguimiento…</p>}
    {!loading && listMode && !loadError && <>
      {!rows.length ? <div className={CARD}><p className="text-sm">Todavía no hay fichas de seguimiento.</p><p className="mt-2 text-xs text-slate-400">Abre un lead y crea su cliente y proyecto para empezar.</p></div> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{rows.map(row => <button key={row.id} type="button" onClick={() => { setSelectedId(row.id); setNotice(''); }} className={`${CARD} text-left hover:border-primary/50`}><p className="text-sm text-slate-100">{row.project_title}</p><p className="mt-1 text-xs text-slate-400">{row.client_name}</p><span className="mt-3 inline-block rounded border border-primary/20 bg-primary/5 px-2 py-1 text-[11px] text-primary">{STAGE_LABELS[row.stage]}</span><p className="mt-3 text-[11px] text-slate-500">Actualizado {formatDate(row.updated_at)}</p></button>)}</div>}
      <div className="flex items-center justify-between gap-3 text-xs text-slate-400"><span>{total} {total === 1 ? 'ficha' : 'fichas'}</span><div className="flex gap-4"><button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 25))} className="disabled:opacity-30">Anterior</button><button type="button" disabled={next === null} onClick={() => next !== null && setOffset(next)} className="disabled:opacity-30">Siguiente</button></div></div>
    </>}
    {!loading && !listMode && !journey && !loadError && (lead ? <div className={CARD}>
      <h3 className="text-sm text-slate-100">Crear cliente y proyecto desde este lead</h3>
      <p className="mt-2 text-xs leading-relaxed text-slate-400">La ficha empieza con la propuesta recibida. El proyecto queda como ficha privada en planificación, vinculado al cliente y al lead.</p>
      <p className="mt-2 break-all text-xs text-slate-500">{[lead.name, lead.company, lead.email, lead.phone].filter(Boolean).join(' · ')}</p>
      <form className="mt-4 space-y-4" onSubmit={event => { event.preventDefault(); void createJourney(); }}>
        <fieldset disabled={pending} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2"><label className="block space-y-2 text-xs text-slate-400"><span>Nombre del cliente</span><input required maxLength={150} className={INPUT} value={creation.client_name} onChange={event => editCreation('client_name', event.target.value)} /></label><label className="block space-y-2 text-xs text-slate-400"><span>Título del proyecto</span><input required maxLength={200} className={INPUT} value={creation.project_title} onChange={event => editCreation('project_title', event.target.value)} /></label></div>
          <label className="block space-y-2 text-xs text-slate-400"><span>Resumen de la propuesta</span><textarea rows={5} maxLength={8000} className={INPUT} value={creation.brief} onChange={event => editCreation('brief', event.target.value)} placeholder="Qué necesita el cliente, objetivos y contexto conocido." /></label>
          <button type="submit" disabled={contextLoading} className={BUTTON}>{pending ? 'Creando ficha…' : contextLoading ? 'Recuperando propuesta…' : 'Crear cliente y proyecto'}</button>
        </fieldset>
      </form>
    </div> : <div className={CARD}><p className="text-sm text-slate-400">Este proyecto todavía no tiene un seguimiento iniciado desde un lead.</p><p className="mt-2 text-xs text-slate-500">Puedes crearlo desde la sección Leads.</p></div>)}
    {!loading && journey && <>
      <div className={`${CARD} flex flex-wrap items-start justify-between gap-4`}>
        <div><p className="text-sm text-slate-100">{effectiveJourney.toName}</p><p className="mt-1 break-all text-xs text-slate-400">{[journey.client_email || journey.lead_email || lead?.email || conversation?.email, journey.client_company || lead?.company || conversation?.company, journey.client_phone || lead?.phone || conversation?.phone].filter(Boolean).join(' · ') || 'Datos de contacto pendientes'}</p>{onOpenProject && <button type="button" disabled={pending} onClick={() => onOpenProject(journey.project_id)} className={`${BUTTON} mt-3`}>Abrir proyecto y tareas</button>}</div>
        <div className="space-y-1 text-xs text-slate-400"><p>Etapa actual: <span className={journey.stage === 'lost' ? 'text-red-300' : 'text-primary'}>{STAGE_LABELS[journey.stage]}</span></p><p>Presupuesto: {formatBudget(journey)}</p></div>
        <details className="w-full text-[11px] text-slate-500"><summary className="cursor-pointer">Referencias de las fichas vinculadas</summary><div className="mt-2 space-y-1 break-all"><p>Cliente: {journey.client_id}</p><p>Proyecto: {journey.project_id}</p><p>Lead: {journey.lead_id}</p></div></details>
      </div>
      <div className={CARD}>
        <h3 className="text-sm text-slate-100">Roadmap del cliente</h3>
        <p className="mt-2 text-[11px] leading-relaxed text-slate-400">La etapa actual indica dónde está el proyecto. Los hitos registrados corresponden a cambios confirmados en el historial.</p>
        <ol className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{STAGES.filter(stage => stage.value !== 'lost').map((stage, index) => {
          const current = journey.stage === stage.value;
          const registered = registeredStages.has(stage.value);
          return <li key={stage.value} className={`flex items-center gap-3 rounded border px-3 py-3 text-xs ${current ? 'border-primary/50 bg-primary/10 text-primary' : registered ? 'border-cyan-500/20 text-slate-300' : 'border-slate-800 text-slate-500'}`} aria-current={current ? 'step' : undefined}><span className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border ${current ? 'border-primary/50' : registered ? 'border-cyan-500/30' : 'border-slate-700'}`}>{registered && !current ? '✓' : index + 1}</span><div>{stage.label}<p className="mt-1 text-[10px]">{current ? 'Etapa actual' : registered ? 'Hito registrado' : eventsPending ? 'Consultando historial…' : eventsNext !== null ? 'Sin hito en el historial cargado' : 'Sin hito registrado'}</p></div></li>;
        })}</ol>
        {eventsNext !== null && <p className="mt-3 text-[11px] text-slate-500">El historial tiene entradas anteriores. Cárgalas para consultar todos los hitos.</p>}
        {journey.stage === 'lost' && <p className="mt-3 text-xs text-red-300">La propuesta no continúa. El historial se conserva.</p>}
        <div className="mt-4 rounded border border-cyan-500/15 bg-[#050505] p-3"><p className="text-xs text-slate-100">{journey.stage === 'closed' ? 'Proyecto cerrado' : 'Próximo paso'}</p><p className="mt-2 text-xs leading-relaxed text-slate-400">{STAGES[stageIndex]?.next}</p><div className="mt-3 flex flex-wrap gap-2">{journey.stage !== 'lost' && <button type="button" onClick={() => compose(recommendedTemplate)} disabled={pending || (recommendedTemplate === 'quote' && budgetDirty)} className={BUTTON}>{recommendedLabel}</button>}{nextStage && <button type="button" disabled={pending} onClick={() => { setProgress(previous => ({ ...previous, stage: nextStage.value })); setNotice(`Etapa ${nextStage.label.toLowerCase()} seleccionada. Revisa los requisitos y guarda el seguimiento para confirmarla.`); }} className={BUTTON}>Preparar paso a {nextStage.label.toLowerCase()}</button>}</div></div>
        {typeof journey.tasks_total === 'number' && <p className="mt-3 text-xs text-slate-400">Tareas del proyecto: {journey.tasks_completed} completadas de {journey.tasks_total} · {journey.tasks_pending} pendientes.</p>}
      </div>
      {effectiveJourney.brief && <div className={CARD}><h3 className="text-sm text-slate-100">Propuesta inicial</h3><p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-slate-400">{effectiveJourney.brief}</p></div>}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <form className={`${CARD} space-y-4`} onSubmit={event => { event.preventDefault(); void saveProgress(); }}>
          <h3 className="text-sm text-slate-100">Actualizar seguimiento</h3>
          <fieldset disabled={pending} className="space-y-4">
            <label className="block space-y-2 text-xs text-slate-400"><span>Etapa</span><select value={progress.stage} className={INPUT} onChange={event => setProgress(previous => ({ ...previous, stage: event.target.value as JourneyStage }))}>{selectableStages.map(stage => <option key={stage.value} value={stage.value}>{stage.label}</option>)}</select></label>
            <p className="text-[11px] leading-relaxed text-slate-400">Avanza una etapa cada vez. Retroceder, retomar una propuesta o marcar que no continúa requiere una nota. Un borrador o un correo en cola no confirma que se haya enviado.</p>
            {progress.stage !== journey.stage && <p className="text-[11px] leading-relaxed text-slate-400">{progress.stage === 'quote_sent' ? 'Para confirmar el envío: presupuesto completo y nota con la confirmación del envío.' : progress.stage === 'accepted' ? 'Para confirmar la aceptación: registra la respuesta del cliente en la nota.' : progress.stage === 'in_production' ? 'Para empezar producción: crea al menos una tarea en el proyecto.' : progress.stage === 'delivered' ? 'Para entregar: completa todas las tareas y anota la aprobación y los materiales finales.' : progress.stage === 'closed' ? 'Para cerrar: completa todas las tareas y anota la recepción y los acuerdos de cierre.' : 'Confirma este cambio guardando el seguimiento.'}</p>}
            <div className="grid grid-cols-[1fr_100px] gap-3"><label className="block space-y-2 text-xs text-slate-400"><span>Importe del presupuesto</span><input inputMode="decimal" className={INPUT} value={progress.amount} onChange={event => setProgress(previous => ({ ...previous, amount: event.target.value }))} placeholder="Pendiente" /></label><label className="block space-y-2 text-xs text-slate-400"><span>Moneda</span><input maxLength={3} className={INPUT} value={progress.currency} onChange={event => setProgress(previous => ({ ...previous, currency: event.target.value.toUpperCase() }))} placeholder="EUR" /></label></div>
            <label className="block space-y-2 text-xs text-slate-400"><span>Alcance y condiciones de la propuesta</span><textarea rows={4} maxLength={8000} className={INPUT} value={progress.scope} onChange={event => setProgress(previous => ({ ...previous, scope: event.target.value }))} placeholder="Entregables, revisiones y condiciones acordadas." /></label>
            <label className="block space-y-2 text-xs text-slate-400"><span>Plazo previsto</span><input maxLength={1000} className={INPUT} value={progress.timing} onChange={event => setProgress(previous => ({ ...previous, timing: event.target.value }))} placeholder="Por definir con el cliente" /></label>
            <label className="block space-y-2 text-xs text-slate-400"><span>Nota para el historial</span><textarea rows={3} maxLength={4000} className={INPUT} value={progress.note} onChange={event => setProgress(previous => ({ ...previous, note: event.target.value }))} placeholder="Acuerdos, decisiones del equipo o respuesta del cliente." /></label>
            {transitionIssue && <p className="text-xs text-amber-300">{transitionIssue}</p>}
            <button type="submit" disabled={!dirty || !!transitionIssue} className={BUTTON}>{pending ? 'Guardando…' : 'Guardar seguimiento'}</button>
          </fieldset>
        </form>
        <div className="space-y-4">
          <div className={CARD}><h3 className="text-sm text-slate-100">Redacción de emails</h3><p className="mt-2 text-xs leading-relaxed text-slate-400">Prepara un borrador con los datos de esta ficha. Revisa el tono, los acuerdos y los materiales antes de enviarlo.</p><div className="mt-4 flex flex-wrap gap-2">{EMAIL_TEMPLATES.filter(template => template.value !== 'custom').map(template => <button key={template.value} type="button" onClick={() => compose(template.value)} disabled={pending || (template.value === 'quote' && budgetDirty)} className={BUTTON}>{template.label}</button>)}</div>{budgetDirty && <p className="mt-3 text-xs text-amber-300">Guarda los cambios del presupuesto para usarlos en el email.</p>}</div>
          <div className={CARD}>
            <div className="flex items-center justify-between gap-3"><h3 className="text-sm text-slate-100">Historial del cliente</h3><span className="text-[11px] text-slate-500">{eventsTotal} entradas</span></div>
            {eventsError && <p role="alert" className="mt-3 text-xs text-red-300">{eventsError} <button type="button" disabled={eventsPending} onClick={() => setEventsReload(value => value + 1)} className="underline">Reintentar</button></p>}
            {eventsPending && !events.length && <p role="status" className="mt-4 text-xs text-slate-400">Cargando historial…</p>}
            {!eventsPending && !eventsError && !events.length && <p className="mt-4 text-xs text-slate-500">Todavía no hay entradas en el historial.</p>}
            <ol className="mt-4 space-y-4">{events.map(event => <li key={event.id} className="border-l border-cyan-500/25 pl-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-300">{{ created: 'Ficha creada', stage_changed: 'Etapa actualizada', note: 'Nota del equipo', quote_updated: 'Presupuesto actualizado', email_queued: 'Email registrado para envío' }[event.event_type] || 'Actualización'}</p><time dateTime={event.created_at} className="text-[10px] text-slate-500">{formatDate(event.created_at)}</time></div>{event.event_type === 'stage_changed' && <p className="mt-1 text-[11px] text-primary">{STAGE_LABELS[event.stage]}</p>}{event.note && <p className="mt-2 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-400">{event.note}</p>}<HistoryEventDetails event={event} /></li>)}</ol>
            {eventsNext !== null && <button type="button" disabled={eventsPending} className={`${BUTTON} mt-4`} onClick={() => void loadEvents(journey.id, eventsNext, eventsGeneration.current)}>{eventsPending ? 'Cargando…' : 'Cargar historial anterior'}</button>}
          </div>
        </div>
      </div>
    </>}
  </section>;
}
