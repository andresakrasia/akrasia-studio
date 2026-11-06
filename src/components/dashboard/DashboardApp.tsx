import { useState, useEffect, useCallback, useRef, useId } from 'react';
import DashboardContent from './DashboardContent';
import DashboardActivity from './DashboardActivity';
import DashboardThemeControl from './DashboardThemeControl';
import ClientJourneyPanel from './ClientJourneyPanel';
import DashboardEmails, { type EmailLaunch } from './DashboardEmails';
import BookingAgenda from './BookingAgenda';
import type { EmailDraftContext } from '../../lib/client-email-writing';
import { mergeDashboardProjectForm } from '../../lib/dashboard-project-refresh';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

type Tab = 'overview' | 'visitors' | 'conversations' | 'leads' | 'journeys' | 'emails' | 'projects' | 'feed' | 'studio' | 'content' | 'bookings';
type DashboardRequester = (endpoint: string, options?: RequestInit) => Promise<Response>;

interface Props {
  csrfToken: string;
  expiresAt: string;
}

interface Visitor {
  id: string;
  visitor_id: string;
  first_seen: string;
  last_seen: string;
  source: string;
}

interface Conversation {
  id: string;
  visitor_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  messages: Message[];
  messages_next_offset?: number | null;
}

interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

interface Lead {
  id: string;
  visitor_id: string;
  conversation_id: string;
  email: string | null;
  phone: string | null;
  name: string | null;
  company: string | null;
  project_type: string | null;
  summary?: string | null;
  status: 'new' | 'hot' | 'contacted' | 'qualified' | 'lost';
  interest_score?: number;
  interest_level?: 'cold' | 'warm' | 'hot';
  contact_captured_at?: string | null;
  tags: string[];
  created_at: string;
  updated_at: string;
}

interface Metrics {
  visitorsToday: number;
  leadsThisWeek: number;
  leadsThisMonth: number;
  totalConversations: number;
  leadsByStatus: Record<string, number>;
  leadsPerWeek: { week: string; leads: number }[];
  avgMessages: number;
  avgDurationSec: number;
  avgDurationMin: number;
  conversionRatio: number;
  visitsPerDay: { date: string; visits: number }[];
}

interface Project {
  id: string;
  title: string;
  type: string;
  client_name: string;
  client_id: string;
  status: string;
  description: string;
  public_description: string;
  is_published: boolean;
  video_url: string;
  resolution: string;
  aspect: string;
  duration: string;
  category: string;
  sort_order: number;
  thumbnail: string;
  thumbnail_url: string;
  slug: string;
  tasks?: ProjectTask[];
  tasks_next_offset?: number | null;
  tasks_total?: number;
  journey_id?: string | null;
  journey_stage?: string | null;
  created_at: string;
  updated_at: string;
}

interface ProjectTask {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed';
  priority: 'low' | 'medium' | 'high';
  created_at: string;
}

interface Client {
  id: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  notes: string;
}

interface FeedEntry {
  id: string;
  text: string;
  level: 'high' | 'mid' | 'low';
  is_active: boolean;
  created_at: string;
}

interface StudioLog {
  id: string;
  text: string;
  log_type: 'success' | 'info' | 'warning';
  is_active: boolean;
  created_at: string;
}

interface StudioStat {
  key: string;
  value: number;
  label: string;
  updated_at: string;
}

interface Service {
  id: string;
  is_published: boolean;
  title: string;
  description: string;
  icon: string;
  sort_order: number;
}

const STATUS_COLORS: Record<string, string> = {
  new: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  contacted: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  qualified: 'bg-green-500/20 text-green-400 border-green-500/30',
  lost: 'bg-red-500/20 text-red-400 border-red-500/30',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Nuevo',
  contacted: 'Contactado',
  qualified: 'Cualificado',
  lost: 'Perdido',
};

const PROJ_STATUS_COLORS: Record<string, string> = {
  planning: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  in_production: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  post_production: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
  completed: 'bg-green-500/20 text-green-400 border-green-500/30',
  delivered: 'bg-green-500/20 text-green-400 border-green-500/30',
};

const PROJ_STATUS_LABELS: Record<string, string> = {
  planning: 'Planificación',
  in_production: 'Producción',
  post_production: 'Post-producción',
  completed: 'Completado',
  delivered: 'Entregado',
};

const LEVEL_COLORS: Record<string, string> = {
  high: 'text-green-400',
  mid: 'text-yellow-400',
  low: 'text-slate-500',
};

const LOG_COLORS: Record<string, string> = {
  success: 'text-green-400',
  info: 'text-cyan-400',
  warning: 'text-yellow-400',
};

const INPUT_CLS = 'w-full bg-[#0a0a0a] border border-cyan-500/25 rounded px-3 py-1.5 text-sm text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-primary/40';

function dashboardReturnTo() {
  const current = new URL(window.location.href);
  const params = new URLSearchParams();
  const tab = current.searchParams.get('tab');
  const visitor = current.searchParams.get('visitor_id');
  if (TABS.some((item) => item.key === tab)) params.set('tab', tab!);
  if (visitor && /^[a-zA-Z0-9_-]{1,128}$/.test(visitor)) params.set('visitor_id', visitor);
  return `/dashboard${params.size ? `?${params}` : ''}`;
}

function goToLogin(expired = false) {
  const params = new URLSearchParams({ returnTo: dashboardReturnTo() });
  if (expired) params.set('expired', '1');
  window.location.replace(`/dashboard/login?${params}`);
}

class DashboardRequestError extends Error {}
const mutationLocks=new Set<string>();
const operationIds=new Map<string,string>();
function runDashboardAction(action:()=>unknown) {
  Promise.resolve().then(action).catch(error => {
    if (!(error instanceof DashboardRequestError)) window.dispatchEvent(new CustomEvent('dashboard-request-error',{detail:error instanceof Error ? error.message : 'No se pudo completar la operación.'}));
  });
}

function initialVisitorFilter() {
  const visitor = new URLSearchParams(window.location.search).get('visitor_id');
  return visitor && /^[a-zA-Z0-9_-]{1,128}$/.test(visitor) ? visitor : '';
}

async function dashboardFetch(csrfToken: string, endpoint: string, options: RequestInit = {}) {
  const methodName=(options.method || 'GET').toUpperCase();
  const lockKey=csrfToken+endpoint+methodName+String(options.body || '');
  let locked=false;
  let expectedOperation:string|undefined;
  try {
    if (!['GET','HEAD','OPTIONS'].includes(methodName)) { if(mutationLocks.has(lockKey)) throw new Error('Esta operación ya está en curso.'); mutationLocks.add(lockKey); locked=true; }
    if (methodName==='POST' && typeof options.body==='string' && /\/api\/dashboard\/(?:projects|clients|tasks|services|feed-entries|studio-logs|ai-generate)$/.test(endpoint)) {
      const payload=JSON.parse(options.body);
      const key=lockKey; let id=operationIds.get(key); if(!id) { id=crypto.randomUUID(); operationIds.set(key,id); }
      expectedOperation=payload.operation_id || id;
      options={...options,body:JSON.stringify({...payload,operation_id:expectedOperation})};
    }
    const url = new URL(endpoint, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/dashboard/')) {
      throw new Error('La petición debe permanecer dentro del panel.');
    }
    const requestHeaders = new Headers(options.headers);
    const method = (options.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) requestHeaders.set('x-dashboard-csrf', csrfToken);
    else requestHeaders.delete('x-dashboard-csrf');

    const response = await fetch(url, {
      ...options,
      headers: requestHeaders,
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (response.status === 401) {
      goToLogin(true);
      throw new Error('La sesión ha terminado. Vuelve a acceder al panel.');
    }
    if (response.status === 403) throw new Error('La operación no se pudo autorizar. Recarga el panel e inténtalo de nuevo.');
    if (!response.ok) {
      // The upload route exposes only bounded, deliberate validation messages.
      if (url.pathname.startsWith('/api/dashboard/')) {
        const problem = await response.json().catch(() => null);
        if (typeof problem?.error === 'string' && problem.error.length <= 300 && !/[\u0000-\u001f\u007f]/u.test(problem.error)) {
          throw new Error(problem.error);
        }
      }
      throw new Error(`No se pudo completar la petición (HTTP ${response.status}).`);
    }
    if(expectedOperation){
      // Confirm the complete wire body before releasing the retry ID; a lost
      // successful response cannot put a new logical creation into the store.
      const wire=await response.clone().json();
      if(url.pathname!=='/api/dashboard/ai-generate' && (!wire||wire.id!==expectedOperation))throw new Error('El servidor no confirmó el registro creado. Conservamos el formulario para reintentar.');
      if(url.pathname==='/api/dashboard/ai-generate' && (!wire||typeof wire!=='object'||!Object.values(wire).every(value=>Array.isArray(value))))throw new Error('El servidor no confirmó la generación.');
      operationIds.delete(lockKey);
    }
    return response;
  } catch (error) {
    const message = error instanceof TypeError ? 'No se pudo conectar con el panel. Comprueba la conexión.' : error instanceof Error ? error.message : 'No se pudo conectar con el panel.';
    window.dispatchEvent(new CustomEvent('dashboard-request-error', { detail: message }));
    throw new DashboardRequestError(message);
  } finally { if(locked) mutationLocks.delete(lockKey); }
}

function Pagination({ offset, total, next, pending, onPage }: { offset:number; total:number|null; next:number|null; pending:boolean; onPage:(offset:number)=>void }) {
  if (total === null) return null;
  return <div className="flex items-center gap-3 text-xs text-slate-400 my-3" aria-label="Paginación">
    <button disabled={pending || offset===0} onClick={() => onPage(Math.max(0,offset-50))} className="border border-slate-600 rounded px-3 py-1 disabled:opacity-40">Anterior</button>
    <span>{total ? `${offset+1}–${Math.min(offset+50,total)} de ${total}` : '0 registros'}</span>
    <button disabled={pending || next===null} onClick={() => next!==null && onPage(next)} className="border border-slate-600 rounded px-3 py-1 disabled:opacity-40">Siguiente</button>
  </div>;
}
function useDashFetch<T>(csrfToken: string, endpoint: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [offset,setOffset] = useState(0);
  const [total,setTotal] = useState<number|null>(null);
  const [next,setNext] = useState<number|null>(null);
  const sequence = useRef(0);
  useEffect(() => { setOffset(0); },[endpoint]);
  const fetcher = useCallback(async () => {
    const serial=++sequence.current;
    setLoading(true); setError(null);
    try {
      const url=new URL(endpoint,window.location.origin); url.searchParams.set('offset',String(offset)); url.searchParams.set('limit','50');
      const res = await dashboardFetch(csrfToken,url.pathname+url.search);
      const json=await res.json();
      if(serial!==sequence.current) return;
      setData(json);
      const count=res.headers.get('x-total-count'); setTotal(count===null ? null : Number(count));
      const after=res.headers.get('x-next-offset'); setNext(after ? Number(after) : null);
    } catch(e) { if(serial===sequence.current) setError(e instanceof Error ? e.message : 'No se pudo cargar.'); }
    finally { if(serial===sequence.current) setLoading(false); }
  },[csrfToken,endpoint,offset,...deps]);
  useEffect(() => { void fetcher(); return () => { sequence.current++; }; },[fetcher]);
  return { data,loading,error,refetch:fetcher,setData,pagination:<><p role="alert" className="text-red-300 text-xs">{error}</p><Pagination offset={offset} total={total} next={next} pending={loading} onPage={setOffset}/></> };
}

function formatDate(iso: string) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function timeAgo(iso: string) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'ahora';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function Badge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${STATUS_COLORS[status] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
      {STATUS_LABELS[status] || status}
    </span>
  );
}

function ProjBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium border ${PROJ_STATUS_COLORS[status] || 'bg-slate-500/20 text-slate-400 border-slate-500/30'}`}>
      {PROJ_STATUS_LABELS[status] || status}
    </span>
  );
}

function PublicationBadge({ published }: { published: boolean }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] border ${published ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-slate-400 border-slate-500/30 bg-slate-500/10'}`}>{published ? 'Publicado' : 'Sin publicar'}</span>;
}

function projectFormValues(p: Project): Record<string, string | number> {
  return {
    title: p.title || '', type: p.type || '', client_name: p.client_name || '',
    client_id: p.client_id || '', status: p.status || 'planning',
    description: p.description || '', public_description: p.public_description || '', video_url: p.video_url || '',
    resolution: p.resolution || '', aspect: p.aspect || '',
    duration: p.duration || '', category: p.category || '',
    sort_order: p.sort_order || 0, thumbnail_url: p.thumbnail || p.thumbnail_url || '',
  };
}

function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center py-20 text-slate-500">
      <svg className="animate-spin h-5 w-5 mr-2" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Cargando...
    </div>
  );
}

function MetricCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg p-5">
      <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-slate-200">{value}</p>
      {sub && <p className="text-[11px] text-slate-500 mt-1">{sub}</p>}
    </div>
  );
}

function TaskStatusIcon({ status }: { status: string }) {
  if (status === 'completed') {
    return (
      <svg className="w-4 h-4 text-green-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  if (status === 'in_progress') {
    return <span className="w-3 h-3 rounded-full bg-cyan-400 flex-shrink-0 animate-pulse" />;
  }
  return <span className="w-3 h-3 rounded-full bg-slate-600 flex-shrink-0" />;
}

const headers = (csrfToken: string) => ({
  'Content-Type': 'application/json',
  'x-dashboard-csrf': csrfToken,
});

function OverviewTab({ csrfToken }: { csrfToken: string }) {
  const { data, loading } = useDashFetch<Metrics>(csrfToken, '/api/dashboard/metrics');

  if (loading) return <LoadingSpinner />;
  if (!data) return <p className="text-red-400 p-4">Error cargando métricas</p>;

  return (
    <div className="space-y-6">
      <p className="text-xs text-slate-400">Datos de chat y contactos conservados, en Europe/Madrid. No representan tráfico web. El borrado y la retención limitan el histórico disponible.</p>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Personas con chat hoy" value={data.visitorsToday} />
        <MetricCard label="Leads esta semana" value={data.leadsThisWeek} />
        <MetricCard label="Conversaciones (mes)" value={data.totalConversations} />
        <MetricCard label="Leads totales (mes)" value={data.leadsThisMonth} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg p-5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Msgs media / conversacion</p>
          <p className="text-2xl font-semibold text-slate-200">{data.avgMessages}</p>
          <p className="text-[11px] text-slate-500 mt-1">mensajes</p>
        </div>
        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg p-5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Tiempo medio conversacion</p>
          <p className="text-2xl font-semibold text-slate-200">
            {data.avgDurationMin > 0 ? `${data.avgDurationMin} min` : `${data.avgDurationSec} seg`}
          </p>
          <p className="text-[11px] text-slate-500 mt-1">intervalo entre mensajes conservados (mes)</p>
        </div>
        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg p-5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Conversion conversacion → lead</p>
          <p className="text-2xl font-semibold text-slate-200">{data.conversionRatio}%</p>
          <p className="text-[11px] text-slate-500 mt-1">cohorte mensual, contacto en el mismo periodo</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg p-5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4">Leads por semana</p>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={data.leadsPerWeek}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-chart-grid)" />
                <XAxis dataKey="week" tick={{ fontSize: 10, fill: 'var(--admin-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--admin-muted)' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 8, fontSize: 12, color: 'var(--admin-text)' }}
                  labelStyle={{ color: 'var(--admin-muted)' }}
                />
                <Bar dataKey="leads" fill="var(--admin-chart-fill)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg p-5">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-4">Conversaciones iniciadas por día</p>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <LineChart data={data.visitsPerDay}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--admin-chart-grid)" />
                <XAxis dataKey="date" tick={{ fontSize: 10, fill: 'var(--admin-muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--admin-muted)' }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ background: 'var(--admin-panel)', border: '1px solid var(--admin-border)', borderRadius: 8, fontSize: 12, color: 'var(--admin-text)' }}
                  labelStyle={{ color: 'var(--admin-muted)' }}
                />
                <Line type="monotone" dataKey="visits" stroke="var(--admin-accent)" strokeWidth={2} dot={{ fill: 'var(--admin-accent)', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg p-5">
        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-3">Leads por estado</p>
        <div className="flex gap-6 flex-wrap">
          {Object.entries(data.leadsByStatus).map(([status, count]) => (
            <div key={status} className="flex items-center gap-2">
              <Badge status={status} />
              <span className="text-lg text-slate-300">{count}</span>
            </div>
          ))}
          {Object.keys(data.leadsByStatus).length === 0 && (
            <p className="text-slate-500 text-sm">Sin leads todavía</p>
          )}
        </div>
      </div>
    </div>
  );
}

function VisitorsTab({ csrfToken }: { csrfToken: string }) {
  const { data, loading, error, refetch, pagination } = useDashFetch<Visitor[]>(csrfToken, '/api/dashboard/visitors');
  const initialVisitor = initialVisitorFilter();
  const [search, setSearch] = useState(initialVisitor);
  const [selectedVisitor, setSelectedVisitor] = useState<string | null>(null);
  const [convData, setConvData] = useState<Conversation[] | null>(null);
  const [convLoading, setConvLoading] = useState(false);
  const [convNext,setConvNext]=useState<number|null>(null);
  const convGeneration=useRef(0);

  const filtered = data?.filter((v) =>
    v.visitor_id.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const loadConversations = async (visitorId: string, offset=0) => {
    const generation=++convGeneration.current;
    if(visitorId!==selectedVisitor){setConvData(null);setConvNext(null);}
    setSelectedVisitor(visitorId);
    setConvLoading(true);
    try {
      const res = await dashboardFetch(csrfToken, `/api/dashboard/conversations?visitor_id=${visitorId}&offset=${offset}`, {
        headers: { 'x-dashboard-csrf': csrfToken },
      });
      const json = await res.json();
      if(generation!==convGeneration.current)return;
      setConvData(json);
      setConvNext(res.headers.get('x-next-offset') ? Number(res.headers.get('x-next-offset')) : null);
    } catch {
      // A failed page leaves the previously confirmed conversation visible.
    } finally {
      if(generation===convGeneration.current)setConvLoading(false);
    }
  };

  useEffect(() => {
    if (initialVisitor) void loadConversations(initialVisitor);
  }, [csrfToken, initialVisitor]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="flex gap-4 h-full flex-col md:flex-row">
      <div className="flex-1 min-w-0">
        {pagination}
        <div className="flex items-center justify-between mb-4 gap-2">
          <input
            type="text"
            placeholder="Filtrar perfiles de esta página..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={INPUT_CLS + ' w-full md:w-64'}
          />
          <button onClick={refetch} className="text-[11px] text-slate-500 hover:text-primary transition-colors">
            Actualizar
          </button>
        </div>

        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-cyan-500/25">
                <th className="text-left p-3">ID</th>
                <th className="text-left p-3">Origen</th>
                <th className="text-left p-3">Primer chat</th>
                <th className="text-left p-3">Última actividad</th>
                <th className="text-left p-3"></th>
              </tr>
            </thead>
            <tbody>
              {!error && filtered.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-slate-500">Sin visitantes</td></tr>
              )}
              {filtered.map((v) => (
                <tr
                  key={v.id}
                  className={`border-b border-cyan-500/25/50 hover:bg-[#0f0f0f] cursor-pointer transition-colors ${selectedVisitor === v.visitor_id ? 'bg-primary/5' : ''}`}
                  onClick={() => loadConversations(v.visitor_id)}
                >
                  <td className="p-3 font-mono text-[11px] text-slate-400 max-w-[200px] truncate">{v.visitor_id.slice(0, 16)}...</td>
                  <td className="p-3 text-slate-400">{v.source}</td>
                  <td className="p-3 text-slate-500 text-xs">{formatDate(v.first_seen)}</td>
                  <td className="p-3 text-slate-500 text-xs">
                    <span className="inline-flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${timeAgo(v.last_seen) === 'ahora' ? 'bg-green-500' : timeAgo(v.last_seen).endsWith('h') ? 'bg-yellow-500' : 'bg-slate-600'}`}></span>
                      {timeAgo(v.last_seen)}
                    </span>
                  </td>
                  <td className="p-3">
                    <button className="text-[10px] text-primary/70 hover:text-primary">Ver chat</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedVisitor && (
        <div className="w-full md:w-[45%] bg-[#0a0a0a] border border-cyan-500/25 rounded-lg flex flex-col max-h-[50vh] md:max-h-none">
          <div className="p-3 border-b border-cyan-500/25 flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Conversaciones</p>
            <button onClick={() => {convGeneration.current++;setSelectedVisitor(null);setConvLoading(false);}} className="text-slate-500 hover:text-slate-300 text-xs">Cerrar</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {convLoading && <LoadingSpinner />}
            {convData && convData.length === 0 && <p className="text-slate-500 text-sm text-center py-8">Sin conversaciones</p>}
            {convNext!==null&&<button onClick={()=>runDashboardAction(()=>loadConversations(selectedVisitor,convNext))}>Más conversaciones</button>}
            {convData?.map((conv) => (
              <div key={conv.id} className="border border-cyan-500/25 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-[#0f0f0f] text-[10px] text-slate-500 flex justify-between">
                  <span>{formatDate(conv.created_at)}</span>
                  <span>{conv.message_count} mensajes</span>
                </div>
                <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
                  <OlderMessages conv={conv} csrfToken={csrfToken} onPage={older=>setConvData(current=>current?.map(row=>row.id===conv.id ? {...row,messages:[...older.messages,...row.messages].filter((m,i,all)=>all.findIndex(x=>x.id===m.id)===i),messages_next_offset:older.messages_next_offset} : row)||null)}/>
                  {conv.messages?.map((msg) => (
                    <div key={msg.id} className={`text-sm ${msg.role === 'user' ? 'text-slate-300' : 'text-primary/70'}`}>
                      <span className="text-[9px] uppercase tracking-wider text-slate-600 block mb-0.5">
                        {msg.role === 'user' ? 'VISITANTE' : 'AKRASIA'} — {formatDate(msg.created_at)}
                      </span>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed">{msg.content}</p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function OlderMessages({conv,csrfToken,onPage}:{conv:Conversation;csrfToken:string;onPage:(row:Conversation)=>void}) {
 const [pending,setPending]=useState(false);const lock=useRef(false);
 if(conv.messages_next_offset==null)return null;
 const load=async()=>{if(lock.current)return;lock.current=true;setPending(true);try{const response=await dashboardFetch(csrfToken,`/api/dashboard/conversations?conversation_id=${conv.id}&messages_offset=${conv.messages_next_offset}`);const rows=await response.json();if(!Array.isArray(rows)||rows.length!==1||rows[0].id!==conv.id)throw new Error('No se pudo confirmar el historial.');onPage(rows[0]);}finally{lock.current=false;setPending(false);}};
 return <button disabled={pending} onClick={()=>runDashboardAction(load)} className="text-primary text-xs">{pending?'Cargando…':'Cargar mensajes anteriores'}</button>;
}

function ConversationsTab({ csrfToken }: { csrfToken: string }) {
  const { data, loading, error, refetch, pagination, setData } = useDashFetch<Conversation[]>(csrfToken, '/api/dashboard/conversations');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState(initialVisitorFilter);

  const filtered = data?.filter((c) =>
    c.visitor_id.toLowerCase().includes(search.toLowerCase()) ||
    c.messages?.some((m) => m.content.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {pagination}
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Filtrar esta página y mensajes cargados..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={INPUT_CLS + ' w-full md:w-80'}
        />
        <p className="text-[11px] text-slate-500">{filtered.length} conversaciones</p>
        <button onClick={refetch} className="text-[11px] text-slate-500 hover:text-primary transition-colors">Actualizar</button>
      </div>

      <div className="space-y-2">
        {!error && filtered.length === 0 && (
          <p className="text-slate-500 text-sm text-center py-12">Sin conversaciones</p>
        )}
        {filtered.map((conv) => (
          <div key={conv.id} className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-3 hover:bg-[#0f0f0f] transition-colors text-left"
              onClick={() => setExpanded(expanded === conv.id ? null : conv.id)}
            >
              <div className="flex items-center gap-4 flex-wrap min-w-0">
                <span className="text-[10px] uppercase tracking-wider text-slate-500">{formatDate(conv.created_at)}</span>
                <span className="text-[11px] font-mono text-slate-400">{conv.visitor_id.slice(0, 16)}...</span>
                <span className="text-[10px] text-slate-600">{conv.message_count} msgs</span>
              </div>
              <svg className={`w-4 h-4 text-slate-600 transition-transform ${expanded === conv.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {expanded === conv.id && (
              <div className="border-t border-cyan-500/25 p-3 space-y-2 max-h-96 overflow-y-auto">
                <OlderMessages conv={conv} csrfToken={csrfToken} onPage={older=>setData(current=>current?.map(row=>row.id===conv.id ? {...row,messages:[...older.messages,...row.messages].filter((m,i,all)=>all.findIndex(x=>x.id===m.id)===i),messages_next_offset:older.messages_next_offset} : row)||null)}/>
                {conv.messages?.map((msg) => (
                  <div key={msg.id} className={`pl-3 border-l-2 ${msg.role === 'user' ? 'border-slate-600' : 'border-primary/40'}`}>
                    <span className="text-[9px] uppercase tracking-wider text-slate-600 block mb-0.5">
                      {msg.role === 'user' ? 'VISITANTE' : 'AKRASIA'} — {formatDate(msg.created_at)}
                    </span>
                    <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function LeadsTab({ csrfToken, request, onEmailDraft, onOpenProject }: { csrfToken: string; request: DashboardRequester; onEmailDraft: (context: EmailDraftContext) => void; onOpenProject: (projectId: string) => void }) {
  const [search, setSearch] = useState(initialVisitorFilter);
  const [statusFilter, setStatusFilter] = useState('');
  const [committedSearch,setCommittedSearch]=useState(search);
  useEffect(()=>{const timer=setTimeout(()=>setCommittedSearch(search.trim()),300);return()=>clearTimeout(timer);},[search]);
  const query=new URLSearchParams();if(committedSearch)query.set('search',committedSearch);if(statusFilter)query.set('status',statusFilter);
  const { data, loading, refetch, pagination } = useDashFetch<Lead[]>(csrfToken, '/api/dashboard/leads'+(query.size?'?'+query.toString():''));
  const [updating, setUpdating] = useState<string | null>(null);
  const [journeyLead, setJourneyLead] = useState<Lead | null>(null);

  const filtered = data || [];

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    try {
      await dashboardFetch(csrfToken, '/api/dashboard/leads', {
        method: 'PATCH',
        headers: headers(csrfToken),
        body: JSON.stringify({ id, status }),
      });
      await refetch();
    } finally {
      setUpdating(null);
    }
  };

  const exportCsv = async () => {
    try {
      const response = await dashboardFetch(csrfToken, '/api/dashboard/export');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'akrasia-leads.csv';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      // dashboardFetch displays the error and handles an expired session.
    }
  };

  if (journeyLead) return <ClientJourneyPanel lead={journeyLead} request={request} onClose={() => setJourneyLead(null)} onEmailDraft={onEmailDraft} onOpenProject={onOpenProject} onCreated={() => { void refetch(); }} />;
  if (loading) return <LoadingSpinner />;

  return (
    <div>
      {pagination}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Buscar por nombre, email, teléfono..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={INPUT_CLS + ' w-72'}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="bg-[#0a0a0a] border border-cyan-500/25 rounded px-3 py-1.5 text-sm text-slate-400 focus:outline-none focus:border-primary/40"
        >
          <option value="">Todos los estados</option>
          <option value="new">Nuevo</option>
          <option value="contacted">Contactado</option>
          <option value="qualified">Cualificado</option>
          <option value="lost">Perdido</option>
        </select>
        <div className="flex-1" />
        <button onClick={exportCsv} className="text-[11px] text-primary/70 hover:text-primary border border-primary/20 hover:border-primary/40 rounded px-3 py-1.5 transition-colors">
          Exportar CSV
        </button>
        <button onClick={refetch} className="text-[11px] text-slate-500 hover:text-primary transition-colors">
          Actualizar
        </button>
      </div>

      <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-cyan-500/25">
                <th className="text-left p-3">Contacto</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Teléfono</th>
                <th className="text-left p-3">Tipo proyecto</th>
                <th className="text-left p-3">Estado</th>
                <th className="text-left p-3">Fecha</th>
                <th className="text-left p-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="p-8 text-center text-slate-500">Sin leads</td></tr>
              )}
              {filtered.map((l) => (
                <tr key={l.id} className="border-b border-cyan-500/25/50 hover:bg-[#0f0f0f] transition-colors">
                  <td className="p-3">
                    <div>
                      <p className="text-slate-300 text-xs">{l.name || '—'}</p>
                      {l.company && <p className="text-[10px] text-slate-600">{l.company}</p>}
                      {l.interest_level&&<p className="text-[10px] text-slate-500">Interés {({cold:'bajo',warm:'medio',hot:'alto'} as const)[l.interest_level]}{typeof l.interest_score==='number'?` · ${l.interest_score}/100`:''}</p>}
                    </div>
                  </td>
                  <td className="p-3 text-xs text-slate-400">{l.email || '—'}</td>
                  <td className="p-3 text-xs text-slate-400">{l.phone || '—'}</td>
                  <td className="p-3 text-xs text-slate-400">{l.project_type || '—'}</td>
                  <td className="p-3"><Badge status={l.status} /></td>
                  <td className="p-3 text-[11px] text-slate-500" title={l.contact_captured_at?'Fecha de captación del contacto':'Fecha de creación del perfil; el contacto histórico no tiene fecha separada'}>{formatDate(l.contact_captured_at||l.created_at)}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => setJourneyLead(l)} className="text-[10px] px-2 py-1 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/10 rounded whitespace-nowrap">Ficha y seguimiento</button>
                      {l.email && (
                        <button
                          onClick={() => onEmailDraft({ leadId: l.id, visitorId: l.visitor_id, to: l.email || '', toName: l.name || l.company || '', projectTitle: l.project_type || '', brief: l.summary || '', templateType: 'evaluation' })}
                          className="text-[10px] px-2 py-0.5 border border-primary/30 text-primary/70 hover:text-primary hover:border-primary/50 rounded transition-colors"
                          title="Enviar email"
                        >
                          Email
                        </button>
                      )}
                      {updating === l.id ? (
                        <span className="text-[10px] text-slate-500">...</span>
                      ) : (
                        <select
                          value={l.status}
                          aria-label="Cambiar estado del lead"
                          onChange={(e) => {
                            const status = e.currentTarget.value;
                            runDashboardAction(() => updateStatus(l.id, status));
                          }}
                          className="bg-transparent text-[10px] text-slate-500 border border-cyan-500/25 rounded px-1 py-0.5 focus:outline-none focus:border-primary/40"
                        >
                          <option value="new">Nuevo</option>
                          {l.status==='hot'&&<option value="hot">Interés alto (histórico)</option>}
                          <option value="contacted">Contactado</option>
                          <option value="qualified">Cualificado</option>
                          <option value="lost">Perdido</option>
                        </select>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-slate-600 mt-3">{filtered.length} contactos y perfiles en esta página. La búsqueda y el estado se aplican a todas las páginas.</p>
    </div>
  );
}

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-red-500/20 text-red-400 border-red-500/30',
  medium: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  low: 'bg-slate-500/20 text-slate-400 border-slate-500/30',
};
const PRIORITY_LABELS: Record<string, string> = { high: 'Alta', medium: 'Media', low: 'Baja' };

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium border ${PRIORITY_COLORS[priority] || PRIORITY_COLORS.medium}`}>
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

interface ProjectLaunch { id: string; projectId: string; }
function ProjectsTab({ csrfToken, request, onEmailDraft, launch }: { csrfToken: string; request: DashboardRequester; onEmailDraft: (context: EmailDraftContext) => void; launch: ProjectLaunch | null }) {
  const projectFieldsId = useId();
  const [journeyProject, setJourneyProject] = useState<string | null>(null);
  const { data: projects, loading, error: projectsError, refetch: refetchProjects, setData: setProjects, pagination:projectPagination } = useDashFetch<Project[]>(csrfToken, '/api/dashboard/projects?tasks=true');
  const { data: clients, error: clientsError, refetch: refetchClients, setData: setClients, pagination:clientPagination } = useDashFetch<Client[]>(csrfToken, '/api/dashboard/clients');

  const refetchAll = async () => { await Promise.all([refreshCurrentProject(), refetchClients()]); };

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [selectedProjectRecord,setSelectedProjectRecord]=useState<Project|null>(null);
  const [isNewProject, setIsNewProject] = useState(false);
  const [isNewClient, setIsNewClient] = useState(false);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string | number>>({});
  const [clientForm, setClientForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [generatingTasks, setGeneratingTasks] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [taskView, setTaskView] = useState<'kanban' | 'list'>('kanban');
  const [viewMode, setViewMode] = useState<'detail' | 'quick'>('detail');
  const [quickEdits, setQuickEdits] = useState<Record<string, Record<string, string>>>({});
  const quickBaseline=useRef<Record<string,Record<string,string>>>({});
  const [quickSaving, setQuickSaving] = useState<string | null>(null);
  const [publicationSaving, setPublicationSaving] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);
  const [projectNotice, setProjectNotice] = useState<string | null>(null);
  const [pendingProjectLaunch, setPendingProjectLaunch] = useState<ProjectLaunch | null>(null);
  const openProjectSequence = useRef(0);
  const tasksSection = useRef<HTMLDivElement>(null);
  const projectBaseline = useRef<{ id: string; values: Record<string, string | number> } | null>(null);

  const selectedClient = clients?.find(c => c.id === selectedClientId) || null;
  const selectedProject = projects?.find(p => p.id === selectedProjectId) || (selectedProjectRecord?.id===selectedProjectId ? selectedProjectRecord : null);
  useEffect(()=>{
    if(selectedProjectId===null){setSelectedProjectRecord(null);return;}
    const current=projects?.find(row=>row.id===selectedProjectId);
    if(current){
      setSelectedProjectRecord(current);
      const next=projectFormValues(current), previous=projectBaseline.current;
      if(previous?.id===current.id)setForm(fields=>mergeDashboardProjectForm(fields,previous.values,next,!!current.journey_id));
      projectBaseline.current={id:current.id,values:next};
    }
  },[projects,selectedProjectId]);
  const filteredProjects = selectedClientId ? projects?.filter(p => p.client_id === selectedClientId) : projects;
  const hasUnsavedChanges = !!selectedProject && JSON.stringify(form) !== JSON.stringify(projectFormValues(selectedProject));

  const openProject = async (projectId: string) => {
    const sequence = ++openProjectSequence.current;
    setProjectError(null); setProjectNotice(null);
    try {
      const response = await request(`/api/dashboard/projects?id=${projectId}&tasks=true&limit=1`);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== projectId) throw new Error('No se pudo cargar el proyecto solicitado.');
      if (sequence !== openProjectSequence.current) return;
      const project = rows[0] as Project;
      setJourneyProject(null); setSelectedClientId(project.client_id || null); setSelectedProjectId(project.id);
      setSelectedProjectRecord(project); setIsNewProject(false); setViewMode('detail'); setForm(projectFormValues(project));
      projectBaseline.current = { id: project.id, values: projectFormValues(project) };
      setProjects(current => current?.some(row => row.id === project.id) ? current.map(row => row.id === project.id ? project : row) : current);
      window.requestAnimationFrame(() => tasksSection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
    } catch (error) { if (sequence === openProjectSequence.current) setProjectError(error instanceof Error ? error.message : 'No se pudo abrir el proyecto.'); }
  };
  const refreshCurrentProject = async (projectId = selectedProjectId) => {
    await refetchProjects();
    if (!projectId || projects?.some(row => row.id === projectId)) return;
    const response = await request(`/api/dashboard/projects?id=${projectId}&tasks=true&limit=1`);
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== projectId) throw new Error('No se pudo actualizar el proyecto abierto.');
    const fresh = rows[0] as Project, previous = projectBaseline.current;
    setSelectedProjectRecord(current => current?.id === projectId ? fresh : current);
    if (previous?.id === projectId) {
      const next = projectFormValues(fresh);
      setForm(current => mergeDashboardProjectForm(current, previous.values, next, !!fresh.journey_id));
      projectBaseline.current = { id: projectId, values: next };
    }
  };
  useEffect(() => {
    if (!launch) return;
    if (hasUnsavedChanges && selectedProjectId !== launch.projectId || isNewProject && Object.values(form).some(Boolean)) {
      setPendingProjectLaunch(launch); return;
    }
    void openProject(launch.projectId);
  }, [launch]);
  useEffect(() => {
    if (!loading && launch?.projectId === selectedProjectId) window.requestAnimationFrame(() => tasksSection.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }, [loading, selectedProjectId, launch]);
  useEffect(() => {
    const refresh = () => { runDashboardAction(() => refreshCurrentProject()); };
    window.addEventListener('dashboard-journey-updated', refresh);
    return () => window.removeEventListener('dashboard-journey-updated', refresh);
  }, [refetchProjects, selectedProjectId, projects, request]);

  const updateSavedProject = (saved: Project) => {
    if (!saved?.id || typeof saved.is_published !== 'boolean') throw new Error('El servidor no confirmó la decisión guardada.');
    setProjects(current => {
      const existing = current?.find(p => p.id === saved.id);
      const updated = { ...existing, ...saved, tasks: existing?.tasks || [] };
      return existing ? current!.map(p => p.id === saved.id ? updated : p) : current;
    });
    if(saved.id===selectedProjectId||selectedProjectId===null)setSelectedProjectRecord(previous=>({...previous,...saved,tasks:saved.tasks || previous?.tasks || [],tasks_total:saved.tasks_total ?? previous?.tasks_total,tasks_next_offset:saved.tasks_next_offset ?? previous?.tasks_next_offset}));
  };

  const selectClient = (c: Client) => {
    if (uploading || saving || publicationSaving) return;
    setSelectedClientId(c.id);
    setSelectedProjectId(null);
    setIsNewProject(false);
    setIsNewClient(false);
    setEditingClientId(null);
  };

  const selectProject = (p: Project) => {
    if (uploading || saving || publicationSaving) return;
    setSelectedProjectId(p.id);
    setSelectedProjectRecord(p);
    setIsNewProject(false);
    setForm(projectFormValues(p));
    projectBaseline.current = { id: p.id, values: projectFormValues(p) };
    setProjectError(null);
    setProjectNotice(null);
  };

  const startNewProject = () => {
    if (uploading || saving || publicationSaving) return;
    setSelectedProjectId(null);
    setIsNewProject(true);
    setForm({
      title: '', type: '', client_name: selectedClient?.name || '',
      client_id: selectedClientId || '', status: 'planning',
      description: '', public_description: '', video_url: '', resolution: '', aspect: '',
      duration: '', category: '', sort_order: 0, thumbnail_url: '',
    });
    setProjectError(null);
    setProjectNotice(null);
  };

  const startNewClient = () => {
    if (uploading || saving || publicationSaving) return;
    setIsNewClient(true);
    setEditingClientId(null);
    setClientForm({ name: '', company: '', email: '', phone: '', notes: '' });
    setProjectError(null); setProjectNotice(null);
  };
  const editClient = (client: Client) => {
    if (saving || uploading || publicationSaving) return;
    setIsNewClient(false); setEditingClientId(client.id); setSelectedClientId(client.id);
    setClientForm({ name: client.name || '', company: client.company || '', email: client.email || '', phone: client.phone || '', notes: client.notes || '' });
    setProjectError(null); setProjectNotice(null);
  };
  const openClientEditor = async (id: string) => {
    if (saving || uploading || publicationSaving) return;
    setProjectError(null);
    try {
      const response = await request(`/api/dashboard/clients?id=${id}&limit=1`);
      const rows = await response.json();
      if (!Array.isArray(rows) || rows.length !== 1 || rows[0].id !== id) throw new Error('No se pudo cargar el contacto del cliente.');
      editClient(rows[0]);
    } catch (error) { setProjectError(error instanceof Error ? error.message : 'No se pudo abrir el contacto del cliente.'); }
  };

  const saveClient = async () => {
    if(saving) return;
    setSaving(true); setProjectError(null); setProjectNotice(null);
    try {
      const response = await dashboardFetch(csrfToken, '/api/dashboard/clients', {
        method: editingClientId ? 'PATCH' : 'POST', headers: headers(csrfToken), body: JSON.stringify(editingClientId ? { id: editingClientId, ...clientForm } : clientForm),
      });
      const saved = await response.json() as Client;
      if (!saved || !saved.id || typeof saved.name !== 'string' || editingClientId && saved.id !== editingClientId) throw new Error('El servidor no confirmó el contacto guardado.');
      setClients(current => current?.map(client => client.id === saved.id ? saved : client) || null);
      window.dispatchEvent(new CustomEvent('dashboard-client-updated', { detail: { clientId: saved.id } }));
      setIsNewClient(false);
      setEditingClientId(null);
      setClientForm({});
      setProjectNotice('Contacto del cliente guardado.');
      await refetchAll();
    } catch(error) { setProjectError(error instanceof Error ? error.message : 'No se pudo guardar el cliente.'); } finally { setSaving(false); }
  };

  const deleteClient = async (id: string) => {
    if (uploading || saving || publicationSaving) return;
    if (!confirm('Eliminar cliente? Sus proyectos quedaran sin cliente asignado.')) return;
    await dashboardFetch(csrfToken, `/api/dashboard/clients?id=${id}`, {
      method: 'DELETE', headers: { 'x-dashboard-csrf': csrfToken },
    });
    if (selectedClientId === id) { setSelectedClientId(null); setSelectedProjectId(null); }
    await refetchAll();
  };

  const saveProject = async () => {
    if (uploading || saving || publicationSaving || !form.title) return;
    if(selectedProject && !hasUnsavedChanges) { setProjectNotice('Sin cambios pendientes.');return; }
    setSaving(true);
    setProjectError(null);
    setProjectNotice(null);
    try {
      const res = await dashboardFetch(csrfToken, '/api/dashboard/projects', {
        method: selectedProjectId ? 'PATCH' : 'POST', headers: headers(csrfToken),
        body: JSON.stringify(selectedProjectId ? { id:selectedProjectId,...Object.fromEntries(Object.entries(form).filter(([key,value]) => value!==projectFormValues(selectedProject!)[key] && !(selectedProject?.journey_id && ['status','client_id','client_name'].includes(key)))) } : { ...form,client_id:form.client_id || null }),
      });
      const saved: Project = await res.json();
      updateSavedProject(saved);
      setSelectedProjectId(saved.id);
      setIsNewProject(false);
      setForm(projectFormValues(saved));
      projectBaseline.current = { id: saved.id, values: projectFormValues(saved) };
      setProjectNotice(saved.is_published ? 'Proyecto guardado. Sigue publicado.' : 'Proyecto guardado sin publicar.');
      await refetchProjects();
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'No se pudo guardar el proyecto.');
    } finally { setSaving(false); }
  };

  const changePublication = async () => {
    if (!selectedProject || publicationSaving || saving || uploading) return;
    if (!selectedProject.is_published && hasUnsavedChanges) return;
    const publish = !selectedProject.is_published;
    setPublicationSaving(true);
    setProjectError(null);
    setProjectNotice(null);
    try {
      const res = await dashboardFetch(csrfToken, '/api/dashboard/projects', {
        method: 'PATCH', headers: headers(csrfToken),
        body: JSON.stringify({ id: selectedProject.id, is_published: publish }),
      });
      const saved: Project = await res.json();
      if (saved.is_published !== publish) throw new Error('El servidor no confirmó la decisión de publicación.');
      updateSavedProject(saved);
      setProjectNotice(publish ? 'Publicación aprobada y guardada.' : 'Proyecto retirado del portfolio.');
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'No se pudo cambiar la publicación.');
    } finally { setPublicationSaving(false); }
  };

  const deleteProject = async () => {
    if (uploading || saving || publicationSaving) return;
    if (!selectedProjectId || !confirm('Eliminar proyecto?')) return;
    await dashboardFetch(csrfToken, `/api/dashboard/projects?id=${selectedProjectId}`, {
      method: 'DELETE', headers: { 'x-dashboard-csrf': csrfToken },
    });
    setSelectedProjectId(null); setIsNewProject(false); setForm({});
    await refetchProjects();
  };

  const uploadThumbnail = async (file: File) => {
    setProjectError(null);
    setProjectNotice(null);
    if (file.size > 2 * 1024 * 1024 || !/\.(?:jpe?g|png|webp)$/i.test(file.name)) {
      setProjectError('Usa una imagen JPEG, PNG o WebP estática de hasta 2 MiB.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await dashboardFetch(csrfToken, '/api/dashboard/upload', {
        method: 'POST', headers: { 'x-dashboard-csrf': csrfToken }, body: fd,
      });
      const { url } = await res.json();
      if (typeof url !== 'string' || !/^\/api\/project-media\/[a-f0-9-]+\.webp$/.test(url)) throw new Error('El servidor no confirmó la miniatura.');
      setForm(f => ({ ...f, thumbnail_url: url }));
      setProjectNotice('Miniatura cargada de forma privada. Guarda el proyecto para vincularla.');
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'No se pudo cargar la miniatura.');
    } finally { setUploading(false); }
  };

  const addTask = async () => {
    if (saving || !newTaskTitle.trim() || !selectedProjectId) return;
    setSaving(true);
    try {
    await dashboardFetch(csrfToken, '/api/dashboard/tasks', {
      method: 'POST', headers: headers(csrfToken),
      body: JSON.stringify({ project_id: selectedProjectId, title: newTaskTitle.trim(), status: 'pending', priority: newTaskPriority }),
    });
    setNewTaskTitle(''); setNewTaskPriority('medium');
    await refreshCurrentProject();
    window.dispatchEvent(new CustomEvent('dashboard-project-tasks-updated', { detail: { projectId: selectedProjectId } }));
    } catch(error) { setProjectError(error instanceof Error ? error.message : 'No se pudo guardar la tarea.'); } finally { setSaving(false); }
  };

  const changeTaskStatus = async (task: ProjectTask, newStatus: string) => {
    await dashboardFetch(csrfToken, '/api/dashboard/tasks', {
      method: 'PATCH', headers: headers(csrfToken),
      body: JSON.stringify({ id: task.id, status: newStatus }),
    });
    await refreshCurrentProject(task.project_id);
    window.dispatchEvent(new CustomEvent('dashboard-project-tasks-updated', { detail: { projectId: task.project_id } }));
  };

  const deleteTask = async (taskId: string) => {
    await dashboardFetch(csrfToken, `/api/dashboard/tasks?id=${taskId}`, {
      method: 'DELETE', headers: { 'x-dashboard-csrf': csrfToken },
    });
    await refreshCurrentProject();
    window.dispatchEvent(new CustomEvent('dashboard-project-tasks-updated', { detail: { projectId: selectedProjectId } }));
  };

  const generateTasksAi = async () => {
    if (!selectedProjectId || generatingTasks) return;
    setGeneratingTasks(true); setProjectError(null); setProjectNotice(null);
    try {
      const response = await dashboardFetch(csrfToken, '/api/dashboard/ai-generate', {
        method: 'POST', headers: headers(csrfToken),
        body: JSON.stringify({
          action: 'generate_tasks', project_id: selectedProjectId,
        }),
      });
      const generated = await response.json();
      await refreshCurrentProject();
      window.dispatchEvent(new CustomEvent('dashboard-project-tasks-updated', { detail: { projectId: selectedProjectId } }));
      setProjectNotice(`${generated.tasks?.length || 0} tareas añadidas con los datos guardados del proyecto y su seguimiento.`);
    } catch (error) { setProjectError(error instanceof Error ? error.message : 'No se pudieron generar las tareas.'); } finally { setGeneratingTasks(false); }
  };

  const generateAi = async () => {
    if (!selectedProject || generating) return;
    setGenerating(true); setProjectError(null); setProjectNotice(null);
    try {
      await dashboardFetch(csrfToken, '/api/dashboard/ai-generate', {
        method: 'POST', headers: headers(csrfToken),
        body: JSON.stringify({ action: 'generate', project_id: selectedProject.id }),
      });
      await refetchProjects();
      setProjectNotice('Propuestas de actividad guardadas para revisión.');
    } catch (error) { setProjectError(error instanceof Error ? error.message : 'No se pudo generar la actividad.'); } finally { setGenerating(false); }
  };

  const setField = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [key]: e.target.value }));
  };

  const initQuickEdits = () => {
    if (!projects) return;
    const edits: Record<string, Record<string, string>> = {};
    projects.forEach(p => {
      edits[p.id] = {
        title: p.title || '', status: p.status || 'planning',
        category: p.category || '', description: p.description || '',
        duration: p.duration || '', video_url: p.video_url || '',
        resolution: p.resolution || '',
      };
    });
    const previous=quickBaseline.current;
    setQuickEdits(current=>{
      const merged={...current};
      for(const [id,fields] of Object.entries(edits)){
        merged[id]=Object.fromEntries(Object.entries(fields).map(([key,value])=>[key,current[id]?.[key]!==undefined && previous[id]?.[key]!==undefined && current[id][key]!==previous[id][key] && current[id][key]!==value ? current[id][key] : value]));
      }
      return merged;
    });
    quickBaseline.current={...previous,...edits};
  };

  useEffect(() => { if (projects && viewMode === 'quick') initQuickEdits(); }, [projects, viewMode]);

  const quickSetField = (id: string, key: string, value: string) => {
    setQuickEdits(prev => ({ ...prev, [id]: { ...prev[id], [key]: value } }));
  };

  const quickSave = async (id: string, override?: Record<string,string>) => {
    const fields = { ...quickEdits[id],...override };
    if (!Object.keys(fields).length || quickSaving===id) return;
    const project = projects?.find(p=>p.id===id);
    const changed=Object.fromEntries(Object.entries(fields).filter(([key,value])=>value!==(project?.[key as keyof Project] ?? '') && !(project?.journey_id && key === 'status')));
    if(!Object.keys(changed).length) return;
    setQuickSaving(id);
    try {
      const res = await dashboardFetch(csrfToken, '/api/dashboard/projects', {
        method: 'PATCH', headers: headers(csrfToken),
        body: JSON.stringify({ id,...changed }),
      });
      updateSavedProject(await res.json());
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : 'No se pudo guardar el proyecto.');
    } finally { setQuickSaving(null); }
  };

  const quickSaveOnBlur = (id: string) => {
    const proj = projects?.find(p => p.id === id);
    const fields = quickEdits[id];
    if (!proj || !fields) return;
    const changed = Object.keys(fields).some(k => {
      const current = proj[k as keyof Project] as string || '';
      return fields[k] !== current;
    });
    if (changed) quickSave(id);
  };

  if (journeyProject) return <ClientJourneyPanel projectId={journeyProject} request={request} onClose={() => { setJourneyProject(null); runDashboardAction(() => refreshCurrentProject()); }} onEmailDraft={onEmailDraft} onOpenProject={projectId => void openProject(projectId)} />;
  if (loading) return <LoadingSpinner />;

  const showForm = isNewProject || selectedProjectId;
  const tasks = selectedProject?.tasks || [];
  const tasksLocked = !!selectedProject?.journey_stage && ['delivered','closed'].includes(selectedProject.journey_stage);
  const moreTasks=async()=>{if(!selectedProject||selectedProject.tasks_next_offset==null)return;const response=await dashboardFetch(csrfToken,`/api/dashboard/tasks?project_id=${selectedProject.id}&offset=${selectedProject.tasks_next_offset}&limit=100`);const rows=await response.json();const after=response.headers.get('x-next-offset');const merge=(p:Project)=>({...p,tasks:[...(p.tasks||[]),...rows].filter((t,i,all)=>all.findIndex(x=>x.id===t.id)===i),tasks_next_offset:after?Number(after):null});setProjects(current=>current?.map(p=>p.id===selectedProject.id ? merge(p) : p)||null);setSelectedProjectRecord(current=>current?.id===selectedProject.id ? merge(current) : current);};
  const todo = tasks.filter(t => t.status === 'pending');
  const doing = tasks.filter(t => t.status === 'in_progress');
  const done = tasks.filter(t => t.status === 'completed');

  return (
    <div className="space-y-3">
      {projectPagination}
      {selectedProject?.tasks_next_offset!=null&&<button onClick={()=>runDashboardAction(moreTasks)} className="text-primary text-xs">Cargar más tareas ({selectedProject.tasks?.length} de {selectedProject.tasks_total})</button>}
      {clientPagination}
      {(projectsError || clientsError || projectError) && <p role="alert" className="text-xs text-red-300 border border-red-500/30 rounded p-3">{projectError || projectsError || clientsError}</p>}
      {pendingProjectLaunch && <div className="border border-amber-500/30 rounded p-3 space-y-2"><p className="text-xs text-amber-200">Hay cambios sin guardar en el proyecto actual. Guárdalos antes de abrir el proyecto solicitado o descártalos.</p><button type="button" disabled={saving || uploading} onClick={() => { void openProject(pendingProjectLaunch.projectId); setPendingProjectLaunch(null); }} className="text-xs text-amber-300">Descartar cambios y abrir proyecto</button><button type="button" onClick={() => setPendingProjectLaunch(null)} className="ml-4 text-xs text-slate-300">Seguir editando</button></div>}
      {projectNotice && <p role="status" className="text-xs text-green-300">{projectNotice}</p>}
      {(isNewClient || editingClientId) && <section aria-label="Contacto del cliente" className="border border-cyan-500/25 rounded-lg p-4 space-y-3"><h2 className="text-sm text-cyan-300">{editingClientId ? 'Editar contacto del cliente' : 'Nuevo cliente'}</h2><fieldset disabled={saving} className="grid md:grid-cols-2 gap-3">
        <label className="text-xs text-slate-300">Nombre del cliente<input maxLength={200} value={clientForm.name || ''} onChange={e => { const value=e.currentTarget.value; setClientForm(f => ({ ...f, name: value })); }} className={`${INPUT_CLS} mt-1`} /></label>
        <label className="text-xs text-slate-300">Empresa del cliente<input maxLength={200} value={clientForm.company || ''} onChange={e => { const value=e.currentTarget.value; setClientForm(f => ({ ...f, company: value })); }} className={`${INPUT_CLS} mt-1`} /></label>
        <label className="text-xs text-slate-300">Email del cliente<input type="email" maxLength={254} value={clientForm.email || ''} onChange={e => { const value=e.currentTarget.value; setClientForm(f => ({ ...f, email: value })); }} className={`${INPUT_CLS} mt-1`} /></label>
        <label className="text-xs text-slate-300">Teléfono del cliente<input type="tel" maxLength={80} value={clientForm.phone || ''} onChange={e => { const value=e.currentTarget.value; setClientForm(f => ({ ...f, phone: value })); }} className={`${INPUT_CLS} mt-1`} /></label>
        <label className="text-xs text-slate-300 md:col-span-2">Notas del cliente<textarea rows={3} maxLength={10000} value={clientForm.notes || ''} onChange={e => { const value=e.currentTarget.value; setClientForm(f => ({ ...f, notes: value })); }} className={`${INPUT_CLS} mt-1`} /></label>
      </fieldset><div className="flex gap-3"><button type="button" onClick={() => void saveClient()} disabled={saving || !clientForm.name?.trim()} className="text-xs text-cyan-300 border border-cyan-500/30 rounded px-3 py-2 disabled:opacity-40">{saving ? 'Guardando contacto...' : 'Guardar contacto'}</button><button type="button" disabled={saving} onClick={() => { setIsNewClient(false); setEditingClientId(null); }} className="text-xs text-slate-300">Cancelar</button></div></section>}
      {selectedProject && viewMode === 'detail' && <button type="button" onClick={() => setJourneyProject(selectedProject.id)} className="text-xs rounded border border-cyan-500/30 px-3 py-2 text-cyan-300">Ver seguimiento del cliente</button>}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={startNewProject} disabled={uploading} className="text-[11px] px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors">
            + Nuevo Proyecto
          </button>
          <p className="text-[10px] text-slate-500">{projects?.length || 0} proyectos</p>
        </div>
        <div className="flex border border-cyan-500/25 rounded overflow-hidden">
          <button onClick={() => setViewMode('quick')} disabled={uploading} className={`text-[10px] px-3 py-1.5 ${viewMode === 'quick' ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:text-slate-300'}`}>Edición Rápida</button>
          <button onClick={() => setViewMode('detail')} className={`text-[10px] px-3 py-1.5 ${viewMode === 'detail' ? 'bg-primary/10 text-primary' : 'text-slate-500 hover:text-slate-300'}`}>Vista Detalle</button>
        </div>
      </div>

      {viewMode === 'quick' ? (
        <div className="border border-cyan-500/25 rounded-lg overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="bg-[#080808] border-b border-cyan-500/25">
                  <th className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 font-medium">Título</th>
                  <th className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 font-medium">Cliente</th>
                  <th className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 font-medium">Producción</th>
                  <th className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 font-medium">Portfolio</th>
                  <th className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 font-medium">Categoría</th>
                  <th className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 font-medium hidden lg:table-cell">Descripción interna</th>
                  <th className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 font-medium">Duración</th>
                  <th className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 font-medium hidden xl:table-cell">Resolución</th>
                  <th className="text-[9px] uppercase tracking-widest text-slate-500 px-3 py-2 font-medium w-10"></th>
                </tr>
              </thead>
              <tbody>
                {projects?.map(p => {
                  const ed = quickEdits[p.id] || {};
                  const isSaving = quickSaving === p.id;
                  return (
                    <tr key={p.id} className="border-b border-cyan-500/25 hover:bg-[#0f0f0f] transition-colors">
                      <td className="px-2 py-1.5">
                        <input
                          value={ed.title ?? p.title ?? ''}
                          onChange={e => quickSetField(p.id, 'title', e.target.value)}
                          onBlur={() => quickSaveOnBlur(p.id)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                          className="w-full bg-transparent border border-transparent hover:border-cyan-500/25 focus:border-primary/40 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none min-w-[120px]"
                        />
                        <button type="button" onClick={() => setJourneyProject(p.id)} className="px-2 text-[10px] text-cyan-300 hover:underline">Seguimiento</button>
                      </td>
                      <td className="px-2 py-1.5">
                        <span className="text-xs text-slate-400">{p.client_name || '—'}</span>
                      </td>
                      <td className="px-2 py-1.5">
                        <select
                          value={ed.status ?? p.status ?? 'planning'}
                          aria-label={`Estado de producción de ${p.title}`} disabled={quickSaving===p.id || !!p.journey_id} onChange={e => { const status=e.target.value; quickSetField(p.id,'status',status); void quickSave(p.id,{status}); }}
                          className="bg-transparent border border-transparent hover:border-cyan-500/25 focus:border-primary/40 rounded px-1 py-1 text-[11px] focus:outline-none min-w-[100px]"
                        >
                          <option value="planning">Planificación</option>
                          <option value="in_production">Producción</option>
                          <option value="post_production">Post-producción</option>
                          <option value="completed">Completado</option>
                          <option value="delivered">Entregado</option>
                        </select>
                        {p.journey_id && <p className="text-[9px] text-slate-500 px-1">Se gestiona en Seguimiento</p>}
                      </td>
                      <td className="px-2 py-1.5">
                        <button onClick={() => { selectProject(p); setViewMode('detail'); }} title="Revisar la publicación del proyecto"><PublicationBadge published={p.is_published} /></button>
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={ed.category ?? p.category ?? ''}
                          onChange={e => quickSetField(p.id, 'category', e.target.value)}
                          onBlur={() => quickSaveOnBlur(p.id)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                          className="w-full bg-transparent border border-transparent hover:border-cyan-500/25 focus:border-primary/40 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none min-w-[90px]"
                        />
                      </td>
                      <td className="px-2 py-1.5 hidden lg:table-cell">
                        <input
                          value={ed.description ?? p.description ?? ''}
                          onChange={e => quickSetField(p.id, 'description', e.target.value)}
                          onBlur={() => quickSaveOnBlur(p.id)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                          className="w-full bg-transparent border border-transparent hover:border-cyan-500/25 focus:border-primary/40 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none min-w-[150px]"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={ed.duration ?? p.duration ?? ''}
                          onChange={e => quickSetField(p.id, 'duration', e.target.value)}
                          onBlur={() => quickSaveOnBlur(p.id)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                          className="w-full bg-transparent border border-transparent hover:border-cyan-500/25 focus:border-primary/40 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none w-[70px]"
                        />
                      </td>
                      <td className="px-2 py-1.5 hidden xl:table-cell">
                        <input
                          value={ed.resolution ?? p.resolution ?? ''}
                          onChange={e => quickSetField(p.id, 'resolution', e.target.value)}
                          onBlur={() => quickSaveOnBlur(p.id)}
                          onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur(); } }}
                          className="w-full bg-transparent border border-transparent hover:border-cyan-500/25 focus:border-primary/40 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none w-[90px]"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <button
                          onClick={() => quickSave(p.id)}
                          disabled={isSaving}
                          className="text-[10px] px-2 py-1 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50"
                        >
                          {isSaving ? '...' : '💾'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!projects?.length && <p className="text-slate-600 text-xs text-center py-8">Sin proyectos</p>}
        </div>
      ) : (
      <div className="flex gap-3 h-[calc(100vh-140px)] md:h-[calc(100vh-180px)] flex-col md:flex-row">
      {/* COL 1: Clients */}
      <div className={`md:w-[200px] flex-shrink-0 bg-[#0a0a0a] border border-cyan-500/25 rounded-lg flex flex-col ${selectedProjectId || isNewProject ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-3 border-b border-cyan-500/25">
          <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">Clientes</p>
          <button onClick={startNewClient} className="w-full text-[11px] px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors">
            + Nuevo
          </button>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[40vh] md:max-h-none">
          <button
            disabled={uploading} onClick={() => { if (uploading || saving || publicationSaving) return; setSelectedClientId(null); setSelectedProjectId(null); setIsNewProject(false); }}
            className={`w-full text-left p-3 border-b border-cyan-500/25 hover:bg-[#0f0f0f] transition-colors ${!selectedClientId ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
          >
            <p className="text-xs text-slate-300">Todos</p>
            <p className="text-[9px] text-slate-600">{projects?.length || 0} proyectos</p>
          </button>
          {clients?.map(c => {
            const cProjects = projects?.filter(p => p.client_id === c.id) || [];
            return (
              <div
                key={c.id}
                className={`flex items-center group border-b border-cyan-500/25 hover:bg-[#0f0f0f] transition-colors ${selectedClientId === c.id ? 'bg-primary/5' : ''}`}
              >
                <button
                  type="button" aria-label={`Editar contacto de ${c.name}`} onClick={() => void openClientEditor(c.id)} className="text-[10px] text-cyan-400 hover:text-cyan-200 px-2"
                >Editar</button>
                <button
                  onClick={() => selectClient(c)}
                  className={`flex-1 text-left p-3 ${selectedClientId === c.id ? 'border-l-2 border-l-primary' : ''}`}
                >
                  <p className="text-xs text-slate-300 truncate">{c.name}</p>
                  <p className="text-[9px] text-slate-600">{c.company || c.email || `${cProjects.length} proyectos`}</p>
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); deleteClient(c.id); }}
                  className="text-[10px] text-slate-700 hover:text-red-400 px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                >X</button>
              </div>
            );
          })}
        </div>
      </div>

      {/* COL 2: Projects */}
      <div className={`md:w-[240px] flex-shrink-0 bg-[#0a0a0a] border border-cyan-500/25 rounded-lg flex flex-col ${selectedProjectId || isNewProject ? 'hidden md:flex' : 'flex'}`}>
        <div className="p-3 border-b border-cyan-500/25 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">{selectedClient?.name || 'Proyectos'}</p>
          <button onClick={startNewProject} className="text-[11px] px-2 py-1 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors">
            + Nuevo
          </button>
        </div>
        <div className="flex-1 overflow-y-auto max-h-[40vh] md:max-h-none">
          {filteredProjects?.map(p => {
            const t = p.tasks || [];
            const total = t.length;
            const d = t.filter(x => x.status === 'completed').length;
            const pct = total > 0 ? Math.round((d / total) * 100) : 0;
            return (
              <button
                key={p.id}
                onClick={() => selectProject(p)}
                className={`w-full text-left p-3 border-b border-cyan-500/25 hover:bg-[#0f0f0f] transition-colors ${selectedProjectId === p.id ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
              >
                <p className="text-xs text-slate-300 truncate">{p.title || 'Sin título'}</p>
                <div className="flex items-center gap-2 mt-1">
                  <ProjBadge status={p.status} />
                  <PublicationBadge published={p.is_published} />
                </div>
                {total > 0 && (
                  <div className="mt-2">
                    <div className="flex justify-between text-[9px] text-slate-600 mb-0.5">
                      <span>{d}/{total}</span><span>{pct}%</span>
                    </div>
                    <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-primary/60 rounded-full" style={{width: `${pct}%`}}></div>
                    </div>
                  </div>
                )}
              </button>
            );
          })}
          {!filteredProjects?.length && <p className="text-slate-600 text-xs text-center py-8">Sin proyectos</p>}
        </div>
      </div>

      {/* COL 3: Detail */}
      <div className={`flex-1 min-w-0 bg-[#0a0a0a] border border-cyan-500/25 rounded-lg overflow-y-auto ${selectedProjectId || isNewProject ? 'flex flex-col' : 'hidden md:flex'}`}>
        {/* Mobile back button */}
        {(selectedProjectId || isNewProject) && (
          <button
            disabled={uploading} onClick={() => { if (uploading || saving || publicationSaving) return; setSelectedProjectId(null); setIsNewProject(false); setForm({}); }}
            className="md:hidden text-[11px] px-3 py-2 border-b border-cyan-500/25 text-slate-400 hover:text-primary flex items-center gap-1"
          >
            <span className="text-sm">←</span> Volver
          </button>
        )}
        {!showForm ? (
          <div className="flex items-center justify-center h-full text-slate-500 text-sm">
            Selecciona o crea un proyecto
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-sm text-slate-200 flex-1">{isNewProject ? 'Nuevo Proyecto' : form.title || 'Proyecto'}</h2>
              {!isNewProject && tasks.length > 0 && (() => {
                const total = tasks.length;
                const d = done.length;
                const pct = Math.round((d / total) * 100);
                return (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-500">{d}/{total}</span>
                    <div className="w-24 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{width: `${pct}%`}}></div>
                    </div>
                    <span className="text-[10px] text-primary">{pct}%</span>
                  </div>
                );
              })()}
              {selectedProjectId && (
                <button onClick={generateAi} disabled={generating} className="text-[11px] px-3 py-1.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 disabled:opacity-50">
                  {generating ? '...' : 'IA Feed'}
                </button>
              )}
            </div>

            {selectedProject?.journey_id && <div className="border border-cyan-500/25 bg-cyan-500/5 rounded p-3 space-y-2"><p className="text-xs text-slate-300">El cliente vinculado y la etapa de este proyecto se gestionan desde su seguimiento.</p><button type="button" onClick={() => setJourneyProject(selectedProject.id)} className="text-xs text-cyan-300">Abrir seguimiento del cliente</button></div>}
            {form.client_id && <button type="button" onClick={() => void openClientEditor(String(form.client_id))} className="text-xs text-cyan-300 border border-cyan-500/25 rounded px-3 py-2">Editar contacto del cliente</button>}

            <div className="border border-cyan-500/25 rounded p-3 space-y-2">
              <div className="flex flex-wrap gap-3 items-center justify-between">
                <p className="text-[11px] text-slate-300">Portfolio público: <PublicationBadge published={selectedProject?.is_published === true} /></p>
                {selectedProject && <button onClick={changePublication} disabled={uploading || publicationSaving || saving || (!selectedProject.is_published && hasUnsavedChanges)} className={`text-[11px] px-3 py-1.5 rounded border disabled:opacity-40 ${selectedProject.is_published ? 'border-yellow-500/30 text-yellow-300 hover:bg-yellow-500/10' : 'border-green-500/30 text-green-300 hover:bg-green-500/10'}`}>
                  {publicationSaving ? 'Guardando decisión...' : selectedProject.is_published ? 'Retirar del portfolio' : 'Aprobar publicación'}
                </button>}
              </div>
              <p className="text-[10px] text-slate-500">La publicación requiere aprobación explícita, independiente del estado de producción. Revisa el título, los medios y el texto público antes de aprobar.</p>
              {isNewProject && <p className="text-[10px] text-slate-400">Se creará sin publicar. Guarda el proyecto para revisar y aprobar su publicación.</p>}
              {selectedProject && !selectedProject.is_published && hasUnsavedChanges && <p className="text-[10px] text-yellow-300">Guarda los cambios antes de aprobar la publicación.</p>}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor={`${projectFieldsId}-title`} className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Título del proyecto</label>
                <input id={`${projectFieldsId}-title`} value={form.title || ''} onChange={setField('title')} className={INPUT_CLS} placeholder="Nombre del proyecto" />
              </div>
              <div>
                <label htmlFor={`${projectFieldsId}-client`} className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Cliente</label>
                <select id={`${projectFieldsId}-client`} aria-label="Cliente del proyecto" disabled={!!selectedProject?.journey_id} value={form.client_id || ''} onChange={e => {
                  const cid = e.target.value;
                  const cl = clients?.find(c => c.id === cid);
                  setForm(f => ({ ...f, client_id: cid, client_name: cl?.name || '' }));
                }} className={INPUT_CLS}>
                  <option value="">Sin cliente</option>
                  {!!form.client_id && !clients?.some(client => client.id === form.client_id) && <option value={form.client_id}>{selectedProject?.client_name || 'Cliente vinculado'}</option>}
                  {clients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-span-1 md:col-span-2">
                <label htmlFor={`${projectFieldsId}-description`} className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Descripción interna del proyecto</label>
                <textarea id={`${projectFieldsId}-description`} value={form.description || ''} onChange={setField('description')} rows={2} className={INPUT_CLS + ' resize-none'} placeholder="Videoclip para redes sociales, spot publicitario..." />
              </div>
              <div className="col-span-1 md:col-span-2">
                <label htmlFor={`${projectFieldsId}-public-description`} className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Texto público del portfolio</label>
                <textarea id={`${projectFieldsId}-public-description`} value={form.public_description || ''} onChange={setField('public_description')} maxLength={6000} rows={3} className={INPUT_CLS + ' resize-none'} placeholder="Texto editorial aprobado para visitantes. Evita datos de clientes, contactos y notas internas." />
                <p className="text-[10px] text-slate-500 mt-1">Solo este texto se muestra en público. La descripción interna permanece en el panel.</p>
              </div>
              <div>
                <label htmlFor={`${projectFieldsId}-status`} className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Estado de producción</label>
                <select id={`${projectFieldsId}-status`} aria-label="Estado de producción" disabled={!!selectedProject?.journey_id} value={form.status || 'planning'} onChange={setField('status')} className={INPUT_CLS}>
                  <option value="planning">Planificación</option>
                  <option value="in_production">Producción</option>
                  <option value="post_production">Post-producción</option>
                  <option value="completed">Completado</option>
                  <option value="delivered">Entregado</option>
                </select>
              </div>
              <div>
                <label htmlFor={`${projectFieldsId}-category`} className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Tipo / categoría</label>
                <input id={`${projectFieldsId}-category`} value={form.category || ''} onChange={setField('category')} className={INPUT_CLS} placeholder="Pieza de producto, videoclip..." />
              </div>
              <div>
                <label htmlFor={`${projectFieldsId}-video`} className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Enlace del vídeo</label>
                <input id={`${projectFieldsId}-video`} value={form.video_url || ''} onChange={setField('video_url')} className={INPUT_CLS} placeholder="Enlace del vídeo" />
              </div>
              <div>
                <label htmlFor={`${projectFieldsId}-duration`} className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Duración</label>
                <input id={`${projectFieldsId}-duration`} value={form.duration || ''} onChange={setField('duration')} className={INPUT_CLS} placeholder="30 s, 3:42..." />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Thumbnail</label>
                <div className="flex items-center gap-2">
                  {form.thumbnail_url && <img src={form.thumbnail_url as string} alt="" className="w-16 h-10 object-cover rounded border border-cyan-500/25" />}
                  <label className={`text-[11px] px-2 py-1 rounded border cursor-pointer ${uploading ? 'opacity-50' : 'border-cyan-500/25 text-slate-400 hover:text-primary'}`}>
                    {uploading ? '...' : 'Subir'}
                    <input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void uploadThumbnail(f); }} disabled={uploading || saving || publicationSaving} />
                  </label>
                </div>
                <p className="text-[10px] text-slate-500 mt-1">JPEG, PNG o WebP estático. Máx. 2 MiB, 8192 px por lado y 16 millones de píxeles. Se convierte a WebP de hasta 1920 px.</p>
              </div>
              <div>
                <label htmlFor={`${projectFieldsId}-resolution`} className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Resolución</label>
                <input id={`${projectFieldsId}-resolution`} value={form.resolution || ''} onChange={setField('resolution')} className={INPUT_CLS} placeholder="3840 × 2160" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={saveProject} disabled={saving || publicationSaving || uploading} className="text-[11px] px-4 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              {selectedProjectId && (
                <button onClick={()=>runDashboardAction(deleteProject)} className="text-[11px] px-3 py-1.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20">
                  Eliminar
                </button>
              )}
            </div>

            {/* TASKS */}
            {selectedProjectId && (
              <div ref={tasksSection} className="border-t border-cyan-500/25 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Tareas ({tasks.length}{selectedProject && (selectedProject.tasks_total || 0)>tasks.length ? ` de ${selectedProject.tasks_total}` : ''})</p>
                  <div className="flex items-center gap-2">
                    <div className="flex border border-cyan-500/25 rounded overflow-hidden">
                      <button onClick={() => setTaskView('kanban')} className={`text-[10px] px-2 py-1 ${taskView === 'kanban' ? 'bg-primary/10 text-primary' : 'text-slate-500'}`}>Kanban</button>
                      <button onClick={() => setTaskView('list')} className={`text-[10px] px-2 py-1 ${taskView === 'list' ? 'bg-primary/10 text-primary' : 'text-slate-500'}`}>Lista</button>
                    </div>
                    <button onClick={generateTasksAi} disabled={generatingTasks || saving || hasUnsavedChanges || tasksLocked} className="text-[11px] px-3 py-1 rounded bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 disabled:opacity-50">
                      {generatingTasks ? 'Generando...' : 'Generar tareas IA'}
                    </button>
                  </div>
                </div>
                {hasUnsavedChanges && <p className="text-xs text-amber-300 mb-3">Guarda los cambios del proyecto antes de generar tareas con IA.</p>}
                {tasksLocked && <p className="text-xs text-amber-300 mb-3">Retoma el proyecto desde Seguimiento antes de añadir o reabrir tareas.</p>}
                <p className="text-[10px] text-slate-500 mb-3">La IA utiliza el proyecto guardado, el alcance y plazo del seguimiento y las tareas existentes.</p>

                {/* Add task */}
                <div className="flex gap-2 mb-4">
                  <input disabled={tasksLocked} maxLength={300} value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Nueva tarea..." onKeyDown={e => { if (e.key === 'Enter') addTask(); }} className={INPUT_CLS} />
                  <select disabled={tasksLocked} value={newTaskPriority} onChange={e => setNewTaskPriority(e.target.value as any)} className="bg-[#0a0a0a] border border-cyan-500/25 rounded px-2 py-1.5 text-xs text-slate-400">
                    <option value="low">Baja</option>
                    <option value="medium">Media</option>
                    <option value="high">Alta</option>
                  </select>
                  <button disabled={tasksLocked} onClick={()=>runDashboardAction(addTask)} className="text-[11px] px-3 py-1.5 rounded border border-cyan-500/25 text-slate-400 hover:text-primary flex-shrink-0">+</button>
                </div>

                {taskView === 'kanban' ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {([['pending', 'Por hacer', todo], ['in_progress', 'Haciendo', doing], ['completed', 'Finalizado', done]] as const).map(([status, label, items]) => (
                      <div key={status} className="bg-[#080808] border border-cyan-500/25 rounded-lg p-3">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-2">{label} ({items.length})</p>
                        <div className="space-y-2 min-h-[60px]">
                          {items.map(t => (
                            <div key={t.id} className="bg-[#0a0a0a] border border-cyan-500/25 rounded p-2 group">
                              <div className="flex items-start justify-between gap-1">
                                <p className={`text-[11px] leading-tight ${t.status === 'completed' ? 'text-slate-600 line-through' : 'text-slate-300'}`}>{t.title}</p>
                                <button onClick={()=>runDashboardAction(()=>deleteTask(t.id))} className="text-[9px] text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 flex-shrink-0">X</button>
                              </div>
                              {t.description && <p className="text-[9px] text-slate-600 mt-1 line-clamp-2">{t.description}</p>}
                              <div className="flex items-center justify-between mt-1.5">
                                <PriorityBadge priority={t.priority || 'medium'} />
                                <div className="flex gap-1">
                                  {status !== 'pending' && <button disabled={tasksLocked} aria-label={`Marcar pendiente: ${t.title}`} onClick={()=>runDashboardAction(()=>changeTaskStatus(t, 'pending'))} className="text-[8px] text-slate-600 hover:text-slate-400 px-1">←</button>}
                                  {status !== 'in_progress' && <button disabled={tasksLocked} aria-label={`Iniciar tarea: ${t.title}`} onClick={()=>runDashboardAction(()=>changeTaskStatus(t, 'in_progress'))} className="text-[8px] text-slate-600 hover:text-cyan-400 px-1">▶</button>}
                                  {status !== 'completed' && <button aria-label={`Completar tarea: ${t.title}`} onClick={()=>runDashboardAction(()=>changeTaskStatus(t, 'completed'))} className="text-[8px] text-slate-600 hover:text-green-400 px-1">✓</button>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-1">
                    {[...todo, ...doing, ...done].map(t => (
                      <div key={t.id} className="flex items-center gap-2 group py-1.5">
                        <button disabled={tasksLocked} onClick={() => {
                          const next = t.status === 'pending' ? 'in_progress' : t.status === 'in_progress' ? 'completed' : 'pending';
                          changeTaskStatus(t, next);
                        }} className="flex-shrink-0">
                          <TaskStatusIcon status={t.status} />
                        </button>
                        <div className="flex-1 min-w-0">
                          <span className={`text-xs ${t.status === 'completed' ? 'text-slate-600 line-through' : 'text-slate-300'}`}>{t.title}</span>
                          {t.description && <p className="text-[10px] text-slate-600 truncate">{t.description}</p>}
                        </div>
                        <PriorityBadge priority={t.priority || 'medium'} />
                        <button onClick={()=>runDashboardAction(()=>deleteTask(t.id))} className="text-[10px] text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 flex-shrink-0">
                          Eliminar
                        </button>
                      </div>
                    ))}
                    {tasks.length === 0 && <p className="text-slate-600 text-xs py-4 text-center">Sin tareas — usa "Generar tareas IA"</p>}
                  </div>
                )}
              </div>
            )}
           </div>
         )}
       </div>
     </div>
      )}
    </div>
  );
}

function FeedTab({ csrfToken }: { csrfToken: string }) {
  const activityRequest = useCallback((endpoint: string,options?: RequestInit) => dashboardFetch(csrfToken,endpoint,options),[csrfToken]);
  const { data: feeds, loading: feedsLoading, refetch: refetchFeeds, pagination:feedPagination } = useDashFetch<FeedEntry[]>(csrfToken, '/api/dashboard/feed-entries');
  const { data: logs, loading: logsLoading, refetch: refetchLogs, pagination:logPagination } = useDashFetch<StudioLog[]>(csrfToken, '/api/dashboard/studio-logs');
  const [newFeedText, setNewFeedText] = useState('');
  const [newFeedLevel, setNewFeedLevel] = useState<'high' | 'mid' | 'low'>('mid');
  const [newLogText, setNewLogText] = useState('');
  const [newLogType, setNewLogType] = useState<'success' | 'info' | 'warning'>('info');
  const [generating, setGenerating] = useState(false);
  const [activityPending,setActivityPending]=useState(false);const activityLock=useRef(false);
  const runActivity=(action:()=>Promise<unknown>)=>{if(activityLock.current)return;activityLock.current=true;setActivityPending(true);runDashboardAction(async()=>{try{await action();}finally{activityLock.current=false;setActivityPending(false);}});};

  const addFeed = async () => {
    if (!newFeedText.trim()) return;
    await dashboardFetch(csrfToken, '/api/dashboard/feed-entries', {
      method: 'POST',
      headers: headers(csrfToken),
      body: JSON.stringify({ text: newFeedText.trim(), level: newFeedLevel, is_active: true }),
    });
    setNewFeedText('');
    refetchFeeds();
  };

  const toggleFeed = async (entry: FeedEntry) => {
    await dashboardFetch(csrfToken, '/api/dashboard/feed-entries', {
      method: 'PATCH',
      headers: headers(csrfToken),
      body: JSON.stringify({ id: entry.id, is_active: !entry.is_active }),
    });
    refetchFeeds();
  };

  const addLog = async () => {
    if (!newLogText.trim()) return;
    await dashboardFetch(csrfToken, '/api/dashboard/studio-logs', {
      method: 'POST',
      headers: headers(csrfToken),
      body: JSON.stringify({ text: newLogText.trim(), log_type: newLogType, is_active: true }),
    });
    setNewLogText('');
    refetchLogs();
  };

  const toggleLog = async (log: StudioLog) => {
    await dashboardFetch(csrfToken, '/api/dashboard/studio-logs', {
      method: 'PATCH',
      headers: headers(csrfToken),
      body: JSON.stringify({ id: log.id, is_active: !log.is_active }),
    });
    refetchLogs();
  };

  const generateAi = async () => {
    setGenerating(true);
    try {
      await dashboardFetch(csrfToken, '/api/dashboard/ai-generate', {
        method: 'POST',
        headers: headers(csrfToken),
        body: JSON.stringify({ action: 'generate_feed' }),
      });
      refetchFeeds();
      refetchLogs();
    } catch {
    } finally {
      setGenerating(false);
    }
  };

  if (feedsLoading || logsLoading) return <LoadingSpinner />;

  const feedsByProject: Record<string, FeedEntry[]> = {};
  for (const f of (feeds || [])) {
    const key = (f as any).project_id || '_general';
    if (!feedsByProject[key]) feedsByProject[key] = [];
    feedsByProject[key].push(f);
  }

  return (
    <fieldset disabled={activityPending||generating}>
      <DashboardActivity request={activityRequest} inputClass={INPUT_CLS}/>
      {feedPagination}
      {logPagination}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm text-slate-200">Registros internos (privados)</h2>
        <button onClick={generateAi} disabled={generating} className="text-[11px] px-3 py-1.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50">
          {generating ? 'Generando...' : 'Generar IA'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg">
          <div className="p-3 border-b border-cyan-500/25">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Actividad interna de producción</p>
          </div>
          <div className="p-3 border-b border-cyan-500/25 space-y-2">
            <input value={newFeedText} onChange={e => setNewFeedText(e.target.value)} placeholder="Texto de la entrada..." className={INPUT_CLS} />
            <div className="flex gap-2">
              <select value={newFeedLevel} onChange={e => setNewFeedLevel(e.target.value as 'high' | 'mid' | 'low')} className="bg-[#0a0a0a] border border-cyan-500/25 rounded px-3 py-1.5 text-sm text-slate-400 focus:outline-none focus:border-primary/40 flex-1">
                <option value="high">High</option>
                <option value="mid">Mid</option>
                <option value="low">Low</option>
              </select>
              <button onClick={()=>runActivity(addFeed)} className="text-[11px] px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors flex-shrink-0">
                Agregar
              </button>
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {feeds?.map(entry => (
              <div key={entry.id} className="flex items-start gap-2 p-3 border-b border-cyan-500/25/50 hover:bg-[#0f0f0f] transition-colors">
                <span className={`text-[10px] font-medium mt-0.5 ${LEVEL_COLORS[entry.level] || 'text-slate-500'}`}>{entry.level.toUpperCase()}</span>
                <p className="text-xs text-slate-300 flex-1">{entry.text}</p>
                <button onClick={()=>runActivity(()=>toggleFeed(entry))} className={`text-[10px] px-2 py-0.5 rounded flex-shrink-0 ${entry.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                  {entry.is_active ? 'ON' : 'OFF'}
                </button>
              </div>
            ))}
            {!feeds?.length && <p className="text-slate-500 text-xs text-center py-6">Sin entradas</p>}
          </div>
        </div>

        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg">
          <div className="p-3 border-b border-cyan-500/25">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Logs internos del estudio</p>
          </div>
          <div className="p-3 border-b border-cyan-500/25 space-y-2">
            <input value={newLogText} onChange={e => setNewLogText(e.target.value)} placeholder="Texto del log..." className={INPUT_CLS} />
            <div className="flex gap-2">
              <select value={newLogType} onChange={e => setNewLogType(e.target.value as 'success' | 'info' | 'warning')} className="bg-[#0a0a0a] border border-cyan-500/25 rounded px-3 py-1.5 text-sm text-slate-400 focus:outline-none focus:border-primary/40 flex-1">
                <option value="success">Success</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
              </select>
              <button onClick={()=>runActivity(addLog)} className="text-[11px] px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors flex-shrink-0">
                Agregar
              </button>
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {logs?.map(log => (
              <div key={log.id} className="flex items-start gap-2 p-3 border-b border-cyan-500/25/50 hover:bg-[#0f0f0f] transition-colors">
                <span className={`text-[10px] font-medium mt-0.5 ${LOG_COLORS[log.log_type] || 'text-slate-500'}`}>{log.log_type.toUpperCase()}</span>
                <p className="text-xs text-slate-300 flex-1">{log.text}</p>
                <button onClick={()=>runActivity(()=>toggleLog(log))} className={`text-[10px] px-2 py-0.5 rounded flex-shrink-0 ${log.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                  {log.is_active ? 'ON' : 'OFF'}
                </button>
              </div>
            ))}
            {!logs?.length && <p className="text-slate-500 text-xs text-center py-6">Sin logs</p>}
          </div>
        </div>
      </div>
    </fieldset>
  );
}

function StudioTab({ csrfToken }: { csrfToken: string }) {
  const { data: stats, loading: statsLoading, refetch: refetchStats } = useDashFetch<StudioStat[]>(csrfToken, '/api/dashboard/stats');
  const { data: services, loading: servicesLoading, refetch: refetchServices, pagination:servicePagination } = useDashFetch<Service[]>(csrfToken, '/api/dashboard/services');
  const [statValues, setStatValues] = useState<Record<string, number>>({});
  const [savingStat, setSavingStat] = useState<string | null>(null);
  const [svcForm, setSvcForm] = useState({ id: '', title: '', description: '', icon: 'movie', sort_order: 0 });
  const [showSvcForm, setShowSvcForm] = useState(false);
  const [savingSvc, setSavingSvc] = useState(false);

  useEffect(() => {
    if (stats) {
      const vals: Record<string, number> = {};
      stats.forEach(s => { vals[s.key] = s.value; });
      setStatValues(vals);
    }
  }, [stats]);

  const saveStat = async (key: string) => {
    setSavingStat(key);
    try {
      await dashboardFetch(csrfToken, '/api/dashboard/stats', {
        method: 'PATCH',
        headers: headers(csrfToken),
        body: JSON.stringify({ key, value: statValues[key] }),
      });
      refetchStats();
    } finally {
      setSavingStat(null);
    }
  };

  const editService = (svc: Service) => {
    setSvcForm({ id: svc.id, title: svc.title, description: svc.description || '', icon: ['movie','auto_fix_high','layers','graphic_eq','campaign','palette','smart_toy','videocam','edit','headphones'].includes(svc.icon) ? svc.icon : 'movie', sort_order: svc.sort_order || 0 });
    setShowSvcForm(true);
  };

  const newService = () => {
    setSvcForm({ id: '', title: '', description: '', icon: 'movie', sort_order: 0 });
    setShowSvcForm(true);
  };

  const saveService = async () => {
    if(savingSvc) return;
    setSavingSvc(true);
    try {
      if (svcForm.id) {
        await dashboardFetch(csrfToken, '/api/dashboard/services', {
          method: 'PATCH',
          headers: headers(csrfToken),
          body: JSON.stringify({ id: svcForm.id, title: svcForm.title, description: svcForm.description, icon: svcForm.icon, sort_order: svcForm.sort_order }),
        });
      } else {
        await dashboardFetch(csrfToken, '/api/dashboard/services', {
          method: 'POST',
          headers: headers(csrfToken),
          body: JSON.stringify({ title: svcForm.title, description: svcForm.description, icon: svcForm.icon, sort_order: svcForm.sort_order }),
        });
      }
      setShowSvcForm(false);
      setSvcForm({ id: '', title: '', description: '', icon: 'movie', sort_order: 0 });
      refetchServices();
    } finally {
      setSavingSvc(false);
    }
  };

  const deleteService = async (id: string) => {
    if (!confirm('¿Eliminar servicio?')) return;
    await dashboardFetch(csrfToken, `/api/dashboard/services?id=${id}`, {
      method: 'DELETE',
      headers: { 'x-dashboard-csrf': csrfToken },
    });
    refetchServices();
  };

  const publishService=async(svc:Service)=> {
    if(savingSvc) return;
    setSavingSvc(true);
    try { await dashboardFetch(csrfToken,'/api/dashboard/services',{method:'PATCH',headers:headers(csrfToken),body:JSON.stringify({id:svc.id,is_published:!svc.is_published})}); await refetchServices(); }
    finally { setSavingSvc(false); }
  };

  if (statsLoading || servicesLoading) return <LoadingSpinner />;

  return (
    <fieldset disabled={savingSvc||savingStat!==null} className="space-y-6">
      {servicePagination}
      <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg">
        <div className="p-3 border-b border-cyan-500/25">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Stats del Studio</p>
        </div>
        <div className="p-4 space-y-3">
          {stats?.map(stat => (
            <div key={stat.key} className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-slate-400 w-32 md:w-40">{stat.label || stat.key}</span>
              <input
                type="number"
                value={statValues[stat.key] ?? stat.value}
                onChange={e => setStatValues(v => ({ ...v, [stat.key]: Number(e.target.value) }))}
                className={INPUT_CLS + ' w-24 md:w-32'}
              />
              <button
                onClick={()=>runDashboardAction(()=>saveStat(stat.key))}
                disabled={savingStat === stat.key}
                className="text-[11px] px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {savingStat === stat.key ? '...' : 'Guardar'}
              </button>
            </div>
          ))}
          {!stats?.length && <p className="text-slate-500 text-xs text-center py-4">Sin stats</p>}
        </div>
      </div>

      <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg">
        <div className="p-3 border-b border-cyan-500/25 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-widest text-slate-500">Servicios</p>
          <button onClick={newService} className="text-[11px] px-3 py-1 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors">
            + Nuevo
          </button>
        </div>

        {showSvcForm && (
          <div className="p-4 border-b border-cyan-500/25 bg-[#080808] space-y-2">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Título</label>
                <input value={svcForm.title} onChange={e => setSvcForm(f => ({ ...f, title: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Icono</label>
                <input value={svcForm.icon} onChange={e => setSvcForm(f => ({ ...f, icon: e.target.value }))} className={INPUT_CLS} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Orden</label>
                <input type="number" value={svcForm.sort_order} onChange={e => setSvcForm(f => ({ ...f, sort_order: Number(e.target.value) }))} className={INPUT_CLS} />
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Descripción</label>
              <textarea value={svcForm.description} onChange={e => setSvcForm(f => ({ ...f, description: e.target.value }))} rows={2} className={INPUT_CLS + ' resize-none'} />
            </div>
            <div className="flex gap-2">
              <button onClick={()=>runDashboardAction(saveService)} disabled={savingSvc} className="text-[11px] px-4 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50">
                {savingSvc ? 'Guardando...' : 'Guardar'}
              </button>
              <button onClick={() => setShowSvcForm(false)} className="text-[11px] px-3 py-1.5 rounded border border-cyan-500/25 text-slate-500 hover:text-slate-300 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        )}

        <div className="divide-y divide-cyan-500/25/50">
          {services?.map(svc => (
            <div key={svc.id} className="flex items-center gap-3 p-3 hover:bg-[#0f0f0f] transition-colors">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-300">{svc.title}</p>
                {svc.description && <p className="text-[10px] text-slate-600 truncate">{svc.description}</p>}
              </div>
              <span className="text-[10px] text-slate-600">#{svc.sort_order}</span>
              <PublicationBadge published={svc.is_published}/>
              <button disabled={savingSvc} onClick={()=>runDashboardAction(()=>publishService(svc))} className="text-[11px] text-green-300">{svc.is_published?'Retirar':'Aprobar publicación'}</button>
              <button onClick={() => editService(svc)} className="text-[10px] text-primary/70 hover:text-primary">Editar</button>
              <button onClick={()=>runDashboardAction(()=>deleteService(svc.id))} className="text-[10px] text-red-500/70 hover:text-red-400">Eliminar</button>
            </div>
          ))}
          {!services?.length && <p className="text-slate-500 text-xs text-center py-6">Sin servicios</p>}
        </div>
      </div>
    </fieldset>
  );
}

function ContentTab({csrfToken}:{csrfToken:string}) {
 const request=useCallback((endpoint:string,options?:RequestInit)=>dashboardFetch(csrfToken,endpoint,options),[csrfToken]);
 return <DashboardContent request={request} inputClass={INPUT_CLS}/>;
}

function BookingsTab({ csrfToken }: { csrfToken: string }) {
  const request = useCallback((endpoint: string, options?: RequestInit) => dashboardFetch(csrfToken, endpoint, options), [csrfToken]);
  return <BookingAgenda request={request} />;
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'visitors', label: 'Visitantes' },
  { key: 'conversations', label: 'Conversaciones' },
  { key: 'leads', label: 'Leads' },
  { key: 'journeys', label: 'Seguimiento' },
  { key: 'emails', label: 'Emails' },
  { key: 'projects', label: 'Proyectos y clientes' },
  { key: 'feed', label: 'Feed & Logs' },
  { key: 'studio', label: 'Studio' },
  { key: 'content', label: 'Contenido' },
  { key: 'bookings', label: 'Reservas' },
];

export default function DashboardApp({ csrfToken, expiresAt }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    return TABS.find((tab) => tab.key === requested)?.key || 'overview';
  });
  const [requestError, setRequestError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [emailsOpened, setEmailsOpened] = useState(() => new URLSearchParams(window.location.search).get('tab') === 'emails');
  const [workflowTabs, setWorkflowTabs] = useState<Tab[]>(() => ['leads', 'journeys', 'projects'].includes(activeTab) ? [activeTab] : []);
  const [emailLaunch, setEmailLaunch] = useState<EmailLaunch | null>(null);
  const [projectLaunch, setProjectLaunch] = useState<ProjectLaunch | null>(null);
  const request = useCallback((endpoint: string, options?: RequestInit) => dashboardFetch(csrfToken, endpoint, options), [csrfToken]);

  useEffect(() => {
    const onError = (event: Event) => setRequestError((event as CustomEvent<string>).detail);
    const onHandledRejection = (event: PromiseRejectionEvent) => {
      if (event.reason instanceof DashboardRequestError) event.preventDefault();
    };
    window.addEventListener('dashboard-request-error', onError);
    window.addEventListener('unhandledrejection', onHandledRejection);
    const remaining = Date.parse(expiresAt) - Date.now();
    const expiryTimer = window.setTimeout(() => goToLogin(true), Math.max(0, remaining));
    return () => {
      window.removeEventListener('dashboard-request-error', onError);
      window.removeEventListener('unhandledrejection', onHandledRejection);
      window.clearTimeout(expiryTimer);
    };
  }, [expiresAt]);

  const selectTab = (tab: Tab) => {
    setActiveTab(tab);
    if (tab === 'emails') setEmailsOpened(true);
    if (['leads', 'journeys', 'projects'].includes(tab)) setWorkflowTabs(previous => previous.includes(tab) ? previous : [...previous, tab]);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  };
  const openEmailDraft = (context: EmailDraftContext) => {
    setEmailLaunch({ id: crypto.randomUUID(), context });
    selectTab('emails');
  };
  const openProject = (projectId: string) => {
    setProjectLaunch({ id: crypto.randomUUID(), projectId });
    selectTab('projects');
  };

  const logout = async () => {
    setLoggingOut(true);
    try {
      await dashboardFetch(csrfToken, '/api/dashboard/auth/logout', { method: 'POST' });
      window.location.replace('/dashboard/login');
    } catch {
      setLoggingOut(false);
    }
  };

  return (
    <div className="dashboard-app min-h-screen bg-[#050505] text-slate-300 font-mono flex flex-col">
      <header className="border-b border-cyan-500/25 px-4 md:px-6 py-3 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-slate-200 tracking-wide">AKRASIA STUDIO</h1>
          <span className="text-[10px] text-slate-600 uppercase tracking-widest">Admin Dashboard</span>
        </div>
        <div className="flex flex-wrap items-center gap-3 md:gap-4">
          <DashboardThemeControl />
          <a href="/" className="text-[10px] text-slate-500 hover:text-primary transition-colors">
            Volver al sitio
          </a>
          <button type="button" onClick={logout} disabled={loggingOut} className="text-[10px] text-primary/80 hover:text-primary disabled:opacity-50 transition-colors">
            {loggingOut ? 'Cerrando…' : 'Cerrar sesión'}
          </button>
        </div>
      </header>

      <nav className="border-b border-cyan-500/25 px-6 flex gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => selectTab(tab.key)}
            className={`px-4 py-2.5 text-[11px] uppercase tracking-wider transition-colors relative whitespace-nowrap ${
              activeTab === tab.key
                ? 'text-primary'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {tab.label}
            {activeTab === tab.key && (
              <span className="absolute bottom-0 left-0 right-0 h-px bg-primary" />
            )}
          </button>
        ))}
      </nav>

      {requestError && (
        <div role="alert" className="mx-3 md:mx-6 mt-4 border border-red-500/40 bg-red-500/10 p-3 rounded flex items-center justify-between gap-3 text-xs text-red-200">
          <span>{requestError}</span>
          <button type="button" onClick={() => setRequestError(null)} aria-label="Cerrar aviso" className="px-2">×</button>
        </div>
      )}

      <main className="flex-1 p-3 md:p-6 overflow-y-auto">
        {activeTab === 'overview' && <OverviewTab csrfToken={csrfToken} />}
        {activeTab === 'visitors' && <VisitorsTab csrfToken={csrfToken} />}
        {activeTab === 'conversations' && <ConversationsTab csrfToken={csrfToken} />}
        {workflowTabs.includes('leads') && <div hidden={activeTab !== 'leads'}><LeadsTab csrfToken={csrfToken} request={request} onEmailDraft={openEmailDraft} onOpenProject={openProject} /></div>}
        {workflowTabs.includes('journeys') && <div hidden={activeTab !== 'journeys'}><ClientJourneyPanel request={request} onEmailDraft={openEmailDraft} onOpenProject={openProject} /></div>}
        {emailsOpened && <div hidden={activeTab !== 'emails'}><DashboardEmails request={request} launch={emailLaunch} /></div>}
        {workflowTabs.includes('projects') && <div hidden={activeTab !== 'projects'}><ProjectsTab csrfToken={csrfToken} request={request} onEmailDraft={openEmailDraft} launch={projectLaunch} /></div>}
        {activeTab === 'feed' && <FeedTab csrfToken={csrfToken} />}
        {activeTab === 'studio' && <StudioTab csrfToken={csrfToken} />}
        {activeTab === 'content' && <ContentTab csrfToken={csrfToken} />}
        {activeTab === 'bookings' && <BookingsTab csrfToken={csrfToken} />}
      </main>
    </div>
  );
}
