import { useCallback, useEffect, useRef, useState } from 'react';
import EmailComposer from './EmailComposer';
import type { EmailDraftContext, EmailDraftRecord } from '../../lib/client-email-writing';
import { EMAIL_TEMPLATES } from '../../lib/client-email-writing';
import { EMAIL_VISUALS } from '../../lib/email-templates';

export interface EmailLaunch {
  id: string;
  context?: EmailDraftContext;
  draft?: EmailDraftRecord;
}
type Requester = (endpoint: string, options?: RequestInit) => Promise<Response>;

const buttonClass = 'rounded border border-cyan-500/30 px-3 py-2 text-xs text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-40';
const dateLabel = (date?: string) => date ? new Date(date).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', dateStyle: 'medium', timeStyle: 'short' }) : 'Sin fecha registrada';
const statusLabels: Record<string, string> = {
  draft: 'Borrador', queued: 'En cola', sending: 'Procesando', accepted: 'Aceptado por el proveedor',
  sent: 'Enviado (histórico)', failed: 'Error de envío', uncertain: 'Resultado pendiente de revisión', disabled: 'Envío sin configurar',
};

export default function DashboardEmails({ request, launch }: { request: Requester; launch?: EmailLaunch | null }) {
  const [editor, setEditor] = useState<EmailLaunch | null>(null);
  const [pendingLaunch, setPendingLaunch] = useState<EmailLaunch | null>(null);
  const [drafts, setDrafts] = useState<EmailDraftRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [offset, setOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const generation = useRef(0);
  const openingLock = useRef(false);
  const openingGeneration = useRef(0);
  useEffect(() => {
    if (!launch) return;
    if (openingLock.current || editor && editor.id !== launch.id) setPendingLaunch(launch);
    else setEditor(launch);
  }, [launch]);
  useEffect(() => () => { openingGeneration.current++; openingLock.current = false; }, []);

  const load = useCallback(async () => {
    const serial = ++generation.current;
    setLoading(true); setError('');
    try {
      const response = await request(`/api/dashboard/email-drafts?offset=${offset}&limit=50`);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw new Error('No se pudieron confirmar los borradores.');
      if (serial !== generation.current) return;
      setDrafts(rows);
      setTotal(Number(response.headers.get('x-total-count') || rows.length));
      const after = response.headers.get('x-next-offset');
      setNext(after ? Number(after) : null);
    } catch (problem) {
      if (serial === generation.current) setError(problem instanceof Error ? problem.message : 'No se pudieron cargar los correos.');
    } finally { if (serial === generation.current) setLoading(false); }
  }, [request, offset]);
  useEffect(() => { void load(); return () => { generation.current++; }; }, [load]);

  const saved = (draft: EmailDraftRecord) => {
    setEditor(current => current ? { ...current, draft } : null);
    void load();
  };
  const openDraft = async (draft: EmailDraftRecord) => {
    if (openingLock.current || editor) return;
    openingLock.current = true;
    const serial = ++openingGeneration.current;
    setOpening(draft.id);
    setError('');
    const context: EmailDraftContext = { leadId: draft.lead_id || undefined, clientId: draft.client_id || undefined,
      projectId: draft.project_id || undefined, journeyId: draft.journey_id || undefined,
      to: draft.to_email, toName: draft.to_name || undefined, templateType: draft.template_type };
    try {
      if (draft.journey_id) {
        const response = await request(`/api/dashboard/client-journeys?id=${draft.journey_id}`);
        const data = await response.json();
        if (!response.ok || !Array.isArray(data)) throw new Error('No se pudo recuperar el contexto del cliente.');
        const [journey] = data;
        if (!journey || journey.id !== draft.journey_id) throw new Error('No se pudo recuperar el contexto del cliente.');
        Object.assign(context, { projectTitle: journey.project_title, brief: journey.brief,
          budgetAmount: journey.budget_amount, budgetCurrency: journey.budget_currency,
          budgetScope: journey.budget_scope, budgetTiming: journey.budget_timing });
      }
    } catch (problem) {
      if (serial === openingGeneration.current) setError(problem instanceof Error ? problem.message : 'No se pudo recuperar el contexto del cliente.');
    } finally {
      if (serial === openingGeneration.current) {
        setEditor({ id: crypto.randomUUID(), draft, context });
        setOpening(null);
        openingLock.current = false;
      }
    }
  };

  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold text-slate-100">Redacción de emails</h2>
        <p className="mt-1 max-w-2xl text-sm leading-relaxed text-slate-400">Una identidad visual para cada momento del proyecto: logo del estudio, titulares y acentos cyan. Desde la ficha del cliente, redacta con su contexto y revisa el diseño antes de enviar.</p>
      </div>
      {!editor && <button type="button" disabled={!!opening} className={buttonClass} onClick={() => { if (!openingLock.current) setEditor({ id: crypto.randomUUID(), context: { templateType: 'custom' } }); }}>Nuevo email</button>}
    </div>

    {!editor && <section aria-labelledby="email-designs-title" className="rounded-lg border border-cyan-500/20 bg-[#0a0a0a] p-4"><div className="mb-4"><p className="text-[10px] uppercase tracking-widest text-cyan-300">AKRASIA / Correspondencia</p><h3 id="email-designs-title" className="mt-2 text-sm font-semibold text-slate-200">Elige el momento. El diseño viene preparado.</h3></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{EMAIL_TEMPLATES.map(template => <button type="button" key={template.value} disabled={!!opening} onClick={() => { if (!openingLock.current) setEditor({ id: crypto.randomUUID(), context: { templateType: template.value } }); }} className="group min-h-[120px] rounded border border-slate-800 bg-[#101517] p-4 text-left hover:border-cyan-400/50 disabled:opacity-40"><span className="text-[10px] uppercase tracking-widest text-cyan-300">{EMAIL_VISUALS[template.value].label}</span><span className="mt-3 block whitespace-pre-line font-sans text-xl font-bold leading-tight text-slate-100">{EMAIL_VISUALS[template.value].title}</span><span className="mt-3 block text-[11px] text-slate-400">{template.label} <span className="text-cyan-300">&rarr;</span></span></button>)}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="border-l-2 border-cyan-400 pl-3"><p className="text-xs text-slate-200">Reserva de videollamada</p><p className="mt-1 text-[11px] leading-relaxed text-slate-400">Confirmación automática con fecha, hora, duración y enlace de acceso.</p></div><div className="border-l-2 border-cyan-400 pl-3"><p className="text-xs text-slate-200">Recordatorio de reunión</p><p className="mt-1 text-[11px] leading-relaxed text-slate-400">El mismo diseño de marca, con los datos para conectarse a tiempo.</p></div></div></section>}

    {opening && <p role="status" className="text-sm text-slate-400">Recuperando el borrador y los datos del proyecto…</p>}
    {pendingLaunch && <p role="status" className="rounded border border-cyan-500/30 p-3 text-sm text-cyan-200">El siguiente correo está preparado. Guarda o cierra el correo abierto para continuar con él.</p>}
    {editor && <EmailComposer key={editor.id} request={request} context={editor.context} draft={editor.draft}
      onClose={() => { setEditor(pendingLaunch); setPendingLaunch(null); }} onSaved={saved} onQueued={() => { void load(); }} />}

    <section aria-labelledby="saved-email-title" className="rounded-lg border border-cyan-500/20 bg-[#0a0a0a] p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 id="saved-email-title" className="text-sm font-semibold text-slate-200">Borradores y correos guardados</h3>
        <button type="button" disabled={loading} className={buttonClass} onClick={() => { void load(); }}>Actualizar correos</button>
      </div>
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
      {loading && <p role="status" className="text-sm text-slate-500">Cargando correos…</p>}
      {!loading && !error && !drafts.length && <p className="py-5 text-sm text-slate-500">Todavía no hay borradores. Puedes empezar desde un lead o una ficha de seguimiento.</p>}
      <div className="space-y-2">
        {drafts.map(draft => <article key={draft.id} className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 p-3">
          <div className="min-w-0 flex-1">
            <p className="break-words text-sm text-slate-200">{draft.subject || 'Sin asunto'}</p>
            <p className="mt-1 break-words text-xs text-slate-500">{draft.to_name || draft.to_email || 'Destinatario pendiente'}{draft.to_name && draft.to_email ? ` · ${draft.to_email}` : ''}</p>
            <p className="mt-1 text-xs text-slate-400">{statusLabels[draft.provider_status || draft.status] || draft.status} · {dateLabel(draft.updated_at || draft.created_at)}</p>
          </div>
          <button type="button" disabled={!!editor || !!opening} className={buttonClass} onClick={() => { void openDraft(draft); }}>{opening === draft.id ? 'Abriendo…' : draft.status === 'draft' ? 'Abrir borrador' : 'Ver correo'}</button>
        </article>)}
      </div>
      {!error && total > 0 && <div aria-label="Paginación de correos" className="mt-4 flex flex-wrap items-center gap-3 text-xs text-slate-500">
        <button type="button" className={buttonClass} disabled={loading || offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>Anteriores</button>
        <span>{offset + 1}–{Math.min(offset + drafts.length, total)} de {total}</span>
        <button type="button" className={buttonClass} disabled={loading || next === null} onClick={() => { if (next !== null) setOffset(next); }}>Siguientes</button>
      </div>}
    </section>
  </div>;
}
