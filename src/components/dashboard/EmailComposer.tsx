import { useEffect, useId, useRef, useState } from 'react';
import { EMAIL_TEMPLATES, checkedLeadConversationContext, conversationWritingContext, createClientEmailDraft, emailDraftSendIssue, emailDraftStateLabel, isEmailTemplateType, isPlaceholderClientName, unresolvedEmailFields } from '../../lib/client-email-writing';
import type { EmailDraftContext, EmailDraftRecord, EmailTemplateType, EmailWritingFields } from '../../lib/client-email-writing';
import type { LeadConversationContext } from '../../lib/lead-conversation-context';
import { EMAIL_BRAND_LOGO_URL, EMAIL_VISUALS, renderEmailTemplate } from '../../lib/email-templates';
export type { EmailDraftContext, EmailDraftRecord } from '../../lib/client-email-writing';

interface Props {
  request: (endpoint: string, options?: RequestInit) => Promise<Response>;
  context?: EmailDraftContext;
  draft?: EmailDraftRecord;
  onClose?: () => void;
  onSaved?: (draft: EmailDraftRecord) => void;
  onQueued?: () => void;
}
const INPUT = 'w-full bg-[#0a0a0a] border border-cyan-500/25 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-400';
const BUTTON = 'px-4 py-2 text-xs border rounded disabled:opacity-40 disabled:cursor-not-allowed';
// A transparent local placeholder avoids a broken remote image during loading.
const EMPTY_PREVIEW_LOGO = 'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
const snapshot = (fields: EmailWritingFields) => JSON.stringify(fields);
function checkedDraft(value: unknown, id: string): EmailDraftRecord {
  const record = value as EmailDraftRecord;
  if (!record || record.id !== id || !Number.isSafeInteger(record.revision) || record.revision < 1 || !['draft','queued'].includes(record.status) || typeof record.to_email !== 'string' || typeof record.subject !== 'string' || typeof record.body_text !== 'string' || !isEmailTemplateType(record.template_type)) throw new Error('El servidor no confirmó el borrador. Conservamos el texto para que puedas reintentar.');
  return record;
}
async function responseData(response: Response): Promise<unknown> {
  const value = await response.json();
  if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : 'No se pudo completar la operación del correo.');
  return value;
}

export function LeadConversationOverview({ conversation, loading, error = '', onRetry, savedTiming = '' }: { conversation: LeadConversationContext | null; loading: boolean; error?: string; onRetry?: () => void; savedTiming?: string }) {
  return <aside aria-label="Contexto de la conversación" className="rounded border border-cyan-500/20 bg-cyan-500/5 p-3 space-y-2">
    {loading && <p role="status" className="text-xs text-cyan-200">Recuperando los datos y la conversación del cliente…</p>}
    {error && <p role="alert" className="text-xs text-amber-300">{error} {onRetry && <button type="button" disabled={loading} onClick={onRetry} className="underline disabled:opacity-40">Reintentar</button>}</p>}
    {conversation && <>
      <p className="text-xs text-cyan-200">{conversation.source === 'none' ? 'No hay una conversación vinculada a este lead.' : `Contexto recuperado de ${conversation.source === 'linked' ? 'la conversación del lead' : 'la última conversación del visitante'} · ${conversation.totalMessages} mensajes.`}</p>
      {conversation.source !== 'none' && <p className="text-[11px] leading-relaxed text-slate-400">La redacción con IA consulta esta conversación desde el servidor. Las necesidades del cliente sirven como contexto; los acuerdos se confirman en la ficha.</p>}
      {conversation.requestedTiming && (savedTiming.trim() ? <div className="space-y-1 text-xs leading-relaxed text-slate-300"><p>Petición inicial de plazo: <span className="text-slate-100">{conversation.requestedTiming}</span>.</p><p>El plazo previsto guardado en la ficha es la referencia actual: <span className="text-slate-100">{savedTiming}</span></p></div> : <p className="text-xs leading-relaxed text-slate-300">Plazo solicitado por el cliente: <span className="text-slate-100">{conversation.requestedTiming}</span>. Pendiente de confirmar con el equipo.</p>)}
      {!!conversation.messages.length && <details className="pt-1"><summary className="cursor-pointer text-xs text-slate-300">Ver conversación original{conversation.truncated ? ' (extracto)' : ''}</summary><ol className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-2">{conversation.messages.map((message, index) => <li key={`${message.created_at}-${index}`} className="border-l border-cyan-500/20 pl-3"><p className="text-[10px] text-slate-500">{message.role === 'user' ? 'Cliente' : 'Asistente del estudio'}</p><p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-300">{message.content}</p></li>)}</ol>{conversation.truncated && <p className="mt-2 text-[11px] text-slate-500">Se muestran los mensajes conservados dentro del límite de contexto.</p>}</details>}
    </>}
  </aside>;
}

export default function EmailComposer({ request, context = {}, draft, onClose, onSaved, onQueued }: Props) {
  const labelId = useId();
  const [writingContext, setWritingContext] = useState(context);
  const [draftId] = useState(() => draft?.id || crypto.randomUUID());
  const [fields, setFields] = useState<EmailWritingFields>(() => {
    if (draft) return { to_email: draft.to_email, to_name: draft.to_name || '', subject: draft.subject, body_text: draft.body_text, template_type: draft.template_type };
    const template = context.templateType || 'evaluation';
    const text = createClientEmailDraft(template, context);
    return { to_email: context.to || '', to_name: context.toName || '', subject: text.subject, body_text: text.body, template_type: template };
  });
  const [saved, setSaved] = useState<EmailDraftRecord | undefined>(draft);
  const [savedSnapshot, setSavedSnapshot] = useState(() => draft ? snapshot({ to_email: draft.to_email, to_name: draft.to_name || '', subject: draft.subject, body_text: draft.body_text, template_type: draft.template_type }) : '');
  const helperSnapshot = (value: EmailDraftContext) => JSON.stringify({ projectTitle: value.projectTitle || '', brief: value.brief || '', budgetAmount: value.budgetAmount ?? null, budgetCurrency: value.budgetCurrency || '', budgetScope: value.budgetScope || '', budgetTiming: value.budgetTiming || '' });
  const [reviewedHelpers, setReviewedHelpers] = useState(() => helperSnapshot(context));
  const [pending, setPending] = useState<'save' | 'ai' | 'queue' | null>(null);
  const lock = useRef(false);
  const saveOperation = useRef<{ snapshot: string; id: string } | null>(null);
  const queueOperation = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [closeRequested, setCloseRequested] = useState(false);
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [previewLogo, setPreviewLogo] = useState(EMPTY_PREVIEW_LOGO);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/img/email-studio-core.png', { signal: controller.signal, credentials: 'same-origin', cache: 'no-cache', redirect: 'error' }).then(async response => {
      if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== 'image/png') throw new Error('Preview logo unavailable');
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > 256 * 1024 || ![137, 80, 78, 71, 13, 10, 26, 10].every((byte,index) => bytes[index] === byte)) throw new Error('Invalid preview logo');
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      if (!controller.signal.aborted) setPreviewLogo(`data:image/png;base64,${btoa(binary)}`);
    }).catch(() => { /* The wordmark and message remain readable if the local asset fails. */ });
    return () => controller.abort();
  }, []);
  const leadId = context.leadId || draft?.lead_id || '';
  const [conversation, setConversation] = useState<LeadConversationContext | null>(context.conversationContext || null);
  const [contextLoading, setContextLoading] = useState(!!leadId);
  const [contextError, setContextError] = useState('');
  const [contextReload, setContextReload] = useState(0);
  const contextEdits = useRef(new Set<keyof EmailDraftContext>());
  const fieldEdits = useRef(new Set<keyof EmailWritingFields>());
  const writingRef = useRef(writingContext);
  const fieldsRef = useRef(fields);
  const savedRef = useRef(saved);
  writingRef.current = writingContext;
  fieldsRef.current = fields;
  savedRef.current = saved;
  const setComposerFields = (next: EmailWritingFields) => { fieldsRef.current = next; setFields(next); };
  const updateWriting = <K extends keyof EmailDraftContext>(key: K, value: EmailDraftContext[K]) => {
    contextEdits.current.add(key);
    const next = { ...writingRef.current, [key]: value };
    writingRef.current = next;
    setWritingContext(next);
  };
  useEffect(() => {
    if (!leadId) { setContextLoading(false); return; }
    let active = true;
    setContextLoading(true);
    setContextError('');
    void request(`/api/dashboard/lead-context?lead_id=${encodeURIComponent(leadId)}`).then(async response => {
      const facts = checkedLeadConversationContext(await responseData(response), leadId);
      if (!active) return;
      setConversation(facts);
      const edits = Object.fromEntries([...contextEdits.current].map(key => [key, writingRef.current[key]]));
      const nextContext: EmailDraftContext = { ...conversationWritingContext(writingRef.current, facts), ...edits, conversationContext: facts, requestedTiming: facts.requestedTiming };
      setReviewedHelpers(previous => {
        const baseline = JSON.parse(previous) as Record<string, unknown>;
        const incoming = JSON.parse(helperSnapshot(nextContext)) as Record<string, unknown>;
        for (const key of Object.keys(incoming)) if (!contextEdits.current.has(key as keyof EmailDraftContext)) baseline[key] = incoming[key];
        return JSON.stringify(baseline);
      });
      writingRef.current = nextContext;
      setWritingContext(nextContext);
      const nextFields = { ...fieldsRef.current };
      if (savedRef.current?.status !== 'queued') {
        if (!fieldEdits.current.has('to_name') && isPlaceholderClientName(nextFields.to_name, nextFields.to_email) && facts.clientName) nextFields.to_name = facts.clientName;
        if (!fieldEdits.current.has('to_email') && !nextFields.to_email.trim() && facts.email) nextFields.to_email = facts.email;
        if (!savedRef.current) {
          const text = createClientEmailDraft(nextFields.template_type, { ...nextContext, toName: nextFields.to_name });
          if (!fieldEdits.current.has('subject')) nextFields.subject = text.subject;
          if (!fieldEdits.current.has('body_text')) nextFields.body_text = text.body;
        }
      }
      fieldsRef.current = nextFields;
      setFields(nextFields);
    }).catch(failure => { if (active) setContextError(failure instanceof Error ? failure.message : 'No se pudo recuperar la conversación del cliente.'); }).finally(() => { if (active) setContextLoading(false); });
    return () => { active = false; };
  }, [request, leadId, contextReload]);
  const textDirty = snapshot(fields) !== savedSnapshot;
  const helpersDirty = helperSnapshot(writingContext) !== reviewedHelpers;
  const dirty = textDirty || helpersDirty;
  const queued = saved?.status === 'queued';
  const previewHtml = renderEmailTemplate({ bodyText: fields.body_text, subject: fields.subject, templateType: fields.template_type })
    .replace(EMAIL_BRAND_LOGO_URL, previewLogo)
    .replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; img-src data:; style-src &apos;unsafe-inline&apos;; base-uri &apos;none&apos;; form-action &apos;none&apos;">');
  const placeholders = unresolvedEmailFields(fields.subject, fields.body_text);
  const sendIssue = emailDraftSendIssue(fields);
  const update = <K extends keyof EmailWritingFields>(key: K, value: EmailWritingFields[K]) => { fieldEdits.current.add(key); setComposerFields({ ...fieldsRef.current, [key]: value }); setNotice(''); setError(''); };
  const prepare = () => {
    if (contextLoading) return;
    const text = createClientEmailDraft(fields.template_type, { ...writingContext, toName: fields.to_name });
    fieldEdits.current.add('subject'); fieldEdits.current.add('body_text');
    setComposerFields({ ...fieldsRef.current, subject: text.subject, body_text: text.body }); setNotice('Borrador preparado. Puedes editar cada frase antes de guardarlo.'); setError('');
  };
  const requestClose = () => {
    if (lock.current) return;
    if (dirty && !queued) setCloseRequested(true);
    else onClose?.();
  };
  const save = async (closeAfterSave = false) => {
    if (lock.current || queued || contextLoading) return; lock.current = true; setPending('save'); setError(''); setNotice('');
    try {
      const currentSnapshot = snapshot(fields);
      if (saveOperation.current?.snapshot !== currentSnapshot) saveOperation.current = { snapshot: currentSnapshot, id: crypto.randomUUID() };
      const body = { ...fields, id: draftId, revision: saved?.revision || 0, operation_id: saveOperation.current.id,
        journey_id: context.journeyId || draft?.journey_id || null, lead_id: context.leadId || draft?.lead_id || null,
        client_id: context.clientId || draft?.client_id || null, project_id: context.projectId || draft?.project_id || null };
      const record = checkedDraft(await responseData(await request('/api/dashboard/email-drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })), draftId);
      const confirmedFields: EmailWritingFields = { to_email: record.to_email, to_name: record.to_name || '', subject: record.subject, body_text: record.body_text, template_type: record.template_type };
      setComposerFields(confirmedFields); savedRef.current = record; setSaved(record); setSavedSnapshot(snapshot(confirmedFields)); saveOperation.current = null; queueOperation.current = null;
      setReviewedHelpers(helperSnapshot(writingContext));
      setCloseRequested(false);
      setNotice('Asunto y mensaje guardados. Los datos auxiliares de redacción no actualizan la ficha. El envío se realiza con «Enviar correo».'); onSaved?.(record);
      if (closeAfterSave) onClose?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo guardar. Tu texto sigue disponible.'); }
    finally { lock.current = false; setPending(null); }
  };
  const improve = async () => {
    if (lock.current || queued || contextLoading) return; lock.current = true; setPending('ai'); setError(''); setNotice('');
    try {
      const response = await request('/api/dashboard/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'generate', templateType: fields.template_type, ...(leadId ? { leadId } : {}),
        context: { toName: fields.to_name, projectTitle: writingContext.projectTitle || '', brief: writingContext.brief || '', budgetAmount: writingContext.budgetAmount ?? null,
          budgetCurrency: writingContext.budgetCurrency || '', budgetScope: writingContext.budgetScope || '', budgetTiming: writingContext.budgetTiming || '', originalSubject: fields.subject, originalBody: fields.body_text } }) });
      const result = await responseData(response) as { subject?: unknown; body?: unknown };
      if (typeof result.subject !== 'string' || typeof result.body !== 'string') throw new Error('La IA no devolvió un borrador válido. Tu texto sigue disponible.');
      fieldEdits.current.add('subject'); fieldEdits.current.add('body_text');
      setComposerFields({ ...fieldsRef.current, subject: result.subject as string, body_text: result.body as string });
      setNotice('Versión de IA preparada. Revisa los datos y el tono antes de guardar.');
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'La IA no está disponible. Puedes continuar con el borrador editable.'); }
    finally { lock.current = false; setPending(null); }
  };
  const queue = async () => {
    if (lock.current || !saved || dirty || queued || contextLoading) return;
    if (sendIssue) { setError(sendIssue); return; }
    lock.current = true; setPending('queue'); setError(''); setNotice('');
    try {
      queueOperation.current ||= crypto.randomUUID();
      const response = await request('/api/dashboard/send-email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send-draft', draftId, revision: saved.revision, operationId: queueOperation.current }) });
      const result = await responseData(response) as Partial<EmailDraftRecord>;
      if (!result || result.id !== draftId || result.revision !== saved.revision || result.status !== 'queued' || !result.queue_id) throw new Error('No se pudo confirmar la cola de envío. Puedes reintentar esta misma operación.');
      const record = checkedDraft({ ...saved, ...result }, draftId);
      setSaved(record); setNotice('Correo en cola de envío. El estado del proveedor se muestra en el historial.');
      if (record.journey_id && typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('dashboard-journey-email-queued', { detail: { journeyId: record.journey_id } }));
      onSaved?.(record); onQueued?.();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudo confirmar el envío. Tu borrador sigue guardado.'); }
    finally { lock.current = false; setPending(null); }
  };
  return <section aria-labelledby={labelId} className="border border-cyan-500/30 rounded-lg bg-[#070b0c] p-4 md:p-6 space-y-5">
    <div className="flex justify-between items-start gap-4"><div><h2 id={labelId} className="text-lg text-cyan-300">Redacción de emails</h2><p className="text-xs text-slate-400 mt-1">Tu mensaje, con la identidad visual de AKRASIA. Edita el texto y revisa el correo completo antes de enviarlo.</p></div>{onClose && <button type="button" disabled={!!pending} onClick={requestClose} className="text-xs text-slate-400 hover:text-white">Cerrar</button>}</div>
    {error && <p role="alert" className="text-sm text-red-300 bg-red-500/10 rounded p-3">{error}</p>}
    {notice && <p role="status" className="text-sm text-cyan-200 bg-cyan-500/10 rounded p-3">{notice}</p>}
    {!!leadId && <LeadConversationOverview conversation={conversation} loading={contextLoading} error={contextError} onRetry={() => setContextReload(value => value + 1)} savedTiming={context.budgetTiming} />}
    {closeRequested && <div role="group" aria-label="Cambios del correo sin guardar" className="space-y-3 rounded border border-amber-500/30 bg-amber-500/10 p-3"><p className="text-sm text-amber-200">Este correo tiene cambios sin guardar. Guarda el borrador antes de cerrar o sigue editándolo.</p>{helpersDirty && <p className="text-xs leading-relaxed text-amber-200">Has cambiado datos para la redacción. Usa «Preparar borrador» o «Mejorar con IA» si quieres incorporarlos al texto. Guardar conserva sólo el asunto y el mensaje; estos datos auxiliares no cambian la ficha ni se conservan al recargar.</p>}<div className="flex flex-wrap gap-3"><button type="button" disabled={!!pending || contextLoading} onClick={() => void save(true)} className={`${BUTTON} border-cyan-500/40 text-cyan-300`}>{pending === 'save' ? 'Guardando...' : 'Guardar y cerrar'}</button><button type="button" disabled={!!pending} onClick={() => setCloseRequested(false)} className={`${BUTTON} border-slate-600 text-slate-300`}>Seguir editando</button><button type="button" disabled={!!pending} onClick={() => { setCloseRequested(false); onClose?.(); }} className={`${BUTTON} border-amber-500/40 text-amber-300`}>Descartar cambios</button></div></div>}
    {saved && <p className="text-xs text-slate-400">{emailDraftStateLabel(saved)} · Revisión {saved.revision}{dirty ? ' · Cambios sin guardar' : ''}</p>}
    <fieldset disabled={!!pending || queued} className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4"><label className="block text-xs text-slate-300">Email del destinatario<input type="email" className={`${INPUT} mt-1`} maxLength={254} value={fields.to_email} onChange={event => update('to_email', event.target.value)} placeholder="nombre@empresa.com" /></label><label className="block text-xs text-slate-300">Nombre del destinatario<input className={`${INPUT} mt-1`} maxLength={150} value={fields.to_name} onChange={event => update('to_name', event.target.value)} placeholder="Nombre" /></label></div>
      <div className="flex flex-wrap items-end gap-3"><label className="block text-xs text-slate-300 flex-1 min-w-[230px]">Tipo de correo<select className={`${INPUT} mt-1`} value={fields.template_type} onChange={event => update('template_type', event.target.value as EmailTemplateType)}>{EMAIL_TEMPLATES.map(template => <option key={template.value} value={template.value}>{template.label}</option>)}</select></label><button type="button" disabled={contextLoading} className={`${BUTTON} border-cyan-500/40 text-cyan-300`} onClick={prepare}>Preparar borrador</button><button type="button" disabled={contextLoading} className={`${BUTTON} border-violet-500/40 text-violet-300`} onClick={() => void improve()}>{pending === 'ai' ? 'Redactando...' : 'Mejorar con IA'}</button></div>
      <div className="flex flex-wrap items-center gap-3 border-l-2 border-cyan-400 pl-3"><span className="text-[10px] uppercase tracking-widest text-cyan-300">Diseño de marca · {EMAIL_VISUALS[fields.template_type].label}</span><p className="text-[11px] text-slate-400">Preparar borrador reemplaza el asunto y el texto. La IA es opcional.</p></div>
      <details open={!!leadId} className="border border-slate-800 rounded p-3"><summary className="text-xs text-slate-300 cursor-pointer">Datos para la redacción{writingContext.projectTitle ? ` · ${writingContext.projectTitle}` : ''}</summary><div className="space-y-3 mt-3">
        <p className="text-[11px] leading-relaxed text-slate-400">Estos datos ayudan a redactar este correo. No actualizan la ficha ni se guardan al recargar. Tras cambiarlos, prepara o mejora el borrador y revisa el texto; guarda los acuerdos permanentes en Seguimiento.</p>
        <label className="block text-xs text-slate-300">Proyecto<input className={`${INPUT} mt-1`} value={writingContext.projectTitle || ''} maxLength={200} onChange={event => updateWriting('projectTitle', event.target.value)} /></label>
        <label className="block text-xs text-slate-300">Resumen y necesidades<textarea className={`${INPUT} mt-1`} rows={5} value={writingContext.brief || ''} maxLength={8000} onChange={event => updateWriting('brief', event.target.value)} /></label>
        {fields.template_type === 'quote' && <><div className="grid md:grid-cols-2 gap-3"><label className="block text-xs text-slate-300">Importe acordado<input type="number" min="0" step="0.01" className={`${INPUT} mt-1`} value={writingContext.budgetAmount ?? ''} onChange={event => updateWriting('budgetAmount', event.target.value === '' ? null : Number(event.target.value))} /></label><label className="block text-xs text-slate-300">Moneda<input className={`${INPUT} mt-1`} maxLength={3} placeholder="EUR" value={writingContext.budgetCurrency || ''} onChange={event => updateWriting('budgetCurrency', event.target.value.toUpperCase())} /></label></div><label className="block text-xs text-slate-300">Alcance incluido<textarea className={`${INPUT} mt-1`} rows={3} maxLength={8000} value={writingContext.budgetScope || ''} onChange={event => updateWriting('budgetScope', event.target.value)} /></label><label className="block text-xs text-slate-300">Plazos, impuestos y condiciones<textarea className={`${INPUT} mt-1`} rows={3} maxLength={2000} value={writingContext.budgetTiming || ''} onChange={event => updateWriting('budgetTiming', event.target.value)} /></label><p className="text-[11px] text-slate-500">Indica las condiciones reales. Preparar borrador incorpora estos datos al mensaje; no calcula precios ni impuestos. Guarda también los datos económicos en la ficha del proyecto.</p></>}
      </div></details>
      <label className="block text-xs text-slate-300">Asunto<input className={`${INPUT} mt-1`} maxLength={200} value={fields.subject} onChange={event => update('subject', event.target.value)} /></label>
      <label className="block text-xs text-slate-300">Mensaje<textarea className={`${INPUT} mt-1 leading-6 font-sans`} rows={13} maxLength={10000} value={fields.body_text} onChange={event => update('body_text', event.target.value)} /></label>
      {placeholders.length > 0 && <p className="text-xs text-amber-300">Por completar: {placeholders.join(', ')}. Puedes guardar el borrador y terminarlo después.</p>}
    </fieldset>
    <details open className="border border-slate-800 rounded"><summary className="text-xs text-slate-300 p-3 cursor-pointer">Vista previa del correo · diseño final</summary><div className="border-t border-slate-800 px-3 py-3 space-y-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="text-xs text-slate-400"><p>Para: {fields.to_email || '(Destinatario pendiente)'}</p><p className="mt-1">Asunto: {fields.subject || '(Asunto pendiente)'}</p></div><div role="group" aria-label="Tamaño de vista previa" className="flex gap-2"><button type="button" className={`${BUTTON} ${previewWidth === 'desktop' ? 'border-cyan-500/50 text-cyan-300' : 'border-slate-700 text-slate-400'}`} aria-pressed={previewWidth === 'desktop'} onClick={() => setPreviewWidth('desktop')}>Escritorio</button><button type="button" className={`${BUTTON} ${previewWidth === 'mobile' ? 'border-cyan-500/50 text-cyan-300' : 'border-slate-700 text-slate-400'}`} aria-pressed={previewWidth === 'mobile'} onClick={() => setPreviewWidth('mobile')}>Móvil</button></div></div><iframe title="Vista previa del email de AKRASIA" sandbox="" referrerPolicy="no-referrer" srcDoc={previewHtml} className={`mx-auto block w-full border-0 bg-[#050505] ${previewWidth === 'mobile' ? 'max-w-[375px]' : 'max-w-[640px]'}`} style={{ height: 860 }} /><p className="text-[11px] text-slate-500">La reserva y los recordatorios de videollamada usan su propia plantilla, con fecha, hora y acceso a la reunión. El aspecto puede variar ligeramente según la aplicación de correo.</p></div></details>
    {!queued && <><div className="flex flex-wrap items-center gap-3"><button type="button" disabled={!!pending || contextLoading || !!saved && !dirty} onClick={() => void save()} className={`${BUTTON} border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10`}>{pending === 'save' ? 'Guardando...' : 'Guardar borrador'}</button><button type="button" disabled={!!pending || contextLoading || !saved || dirty || !!sendIssue} onClick={() => void queue()} className={`${BUTTON} border-green-500/50 text-green-300 hover:bg-green-500/10`}>{pending === 'queue' ? 'Poniendo en cola...' : 'Enviar correo'}</button></div><p className="text-xs text-slate-500">{contextLoading ? 'La conversación se recupera antes de preparar o guardar el correo.' : !saved || dirty ? 'Guarda los cambios antes de enviar.' : sendIssue || 'Enviar correo pone esta revisión guardada en la cola de envío.'}</p></>}
    {queued && <p className="text-xs text-slate-400">Esta revisión está registrada en la cola de envío. «Aceptado por el proveedor» confirma su aceptación, no la entrega al destinatario.</p>}
  </section>;
}
