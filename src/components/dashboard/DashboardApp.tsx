import { useState, useEffect, useCallback } from 'react';

type Tab = 'overview' | 'visitors' | 'conversations' | 'leads' | 'projects' | 'feed' | 'studio' | 'content';

interface Props {
  secret: string;
}

interface Visitor {
  id: string;
  visitor_id: string;
  first_seen: string;
  last_seen: string;
  source: string;
  page_views: number;
}

interface Conversation {
  id: string;
  visitor_id: string;
  created_at: string;
  updated_at: string;
  message_count: number;
  messages: Message[];
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
  status: 'new' | 'contacted' | 'qualified' | 'lost';
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
}

interface Project {
  id: string;
  title: string;
  type: string;
  client_name: string;
  client_id: string;
  status: string;
  description: string;
  video_url: string;
  resolution: string;
  aspect: string;
  duration: string;
  category: string;
  sort_order: number;
  thumbnail_url: string;
  slug: string;
  tasks?: ProjectTask[];
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
  planning: 'Planificacion',
  in_production: 'Produccion',
  post_production: 'Post-produccion',
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

function useDashFetch<T>(secret: string, endpoint: string, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetcher = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(endpoint, { headers: { 'x-dashboard-secret': secret } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fetch error');
    } finally {
      setLoading(false);
    }
  }, [secret, endpoint, ...deps]);

  useEffect(() => { fetcher(); }, [fetcher]);

  return { data, loading, error, refetch: fetcher };
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

const headers = (secret: string) => ({
  'Content-Type': 'application/json',
  'x-dashboard-secret': secret,
});

function OverviewTab({ secret }: { secret: string }) {
  const { data, loading } = useDashFetch<Metrics>(secret, '/api/dashboard/metrics');

  if (loading) return <LoadingSpinner />;
  if (!data) return <p className="text-red-400 p-4">Error cargando metricas</p>;

  return (
    <div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MetricCard label="Visitantes hoy" value={data.visitorsToday} />
        <MetricCard label="Leads esta semana" value={data.leadsThisWeek} />
        <MetricCard label="Conversaciones (mes)" value={data.totalConversations} />
        <MetricCard label="Leads totales (mes)" value={data.leadsThisMonth} />
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
            <p className="text-slate-500 text-sm">Sin leads todavia</p>
          )}
        </div>
      </div>
    </div>
  );
}

function VisitorsTab({ secret }: { secret: string }) {
  const { data, loading, refetch } = useDashFetch<Visitor[]>(secret, '/api/dashboard/visitors');
  const [search, setSearch] = useState('');
  const [selectedVisitor, setSelectedVisitor] = useState<string | null>(null);
  const [convData, setConvData] = useState<Conversation[] | null>(null);
  const [convLoading, setConvLoading] = useState(false);

  const filtered = data?.filter((v) =>
    v.visitor_id.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const loadConversations = async (visitorId: string) => {
    setSelectedVisitor(visitorId);
    setConvLoading(true);
    try {
      const res = await fetch(`/api/dashboard/conversations?visitor_id=${visitorId}`, {
        headers: { 'x-dashboard-secret': secret },
      });
      const json = await res.json();
      setConvData(json);
    } catch {
      setConvData(null);
    } finally {
      setConvLoading(false);
    }
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div className="flex gap-4 h-full flex-col md:flex-row">
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-4 gap-2">
          <input
            type="text"
            placeholder="Buscar visitante..."
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
                <th className="text-left p-3">Vistas</th>
                <th className="text-left p-3">Primera visita</th>
                <th className="text-left p-3">Ultima actividad</th>
                <th className="text-left p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="p-6 text-center text-slate-500">Sin visitantes</td></tr>
              )}
              {filtered.map((v) => (
                <tr
                  key={v.id}
                  className={`border-b border-cyan-500/25/50 hover:bg-[#0f0f0f] cursor-pointer transition-colors ${selectedVisitor === v.visitor_id ? 'bg-primary/5' : ''}`}
                  onClick={() => loadConversations(v.visitor_id)}
                >
                  <td className="p-3 font-mono text-[11px] text-slate-400 max-w-[200px] truncate">{v.visitor_id.slice(0, 16)}...</td>
                  <td className="p-3 text-slate-400">{v.page_views}</td>
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
            <button onClick={() => setSelectedVisitor(null)} className="text-slate-500 hover:text-slate-300 text-xs">Cerrar</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-3">
            {convLoading && <LoadingSpinner />}
            {convData && convData.length === 0 && <p className="text-slate-500 text-sm text-center py-8">Sin conversaciones</p>}
            {convData?.map((conv) => (
              <div key={conv.id} className="border border-cyan-500/25 rounded-lg overflow-hidden">
                <div className="px-3 py-2 bg-[#0f0f0f] text-[10px] text-slate-500 flex justify-between">
                  <span>{formatDate(conv.created_at)}</span>
                  <span>{conv.messages?.length || 0} mensajes</span>
                </div>
                <div className="p-3 space-y-2 max-h-80 overflow-y-auto">
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

function ConversationsTab({ secret }: { secret: string }) {
  const { data, loading } = useDashFetch<Conversation[]>(secret, '/api/dashboard/conversations');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = data?.filter((c) =>
    c.visitor_id.toLowerCase().includes(search.toLowerCase()) ||
    c.messages?.some((m) => m.content.toLowerCase().includes(search.toLowerCase()))
  ) || [];

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <input
          type="text"
          placeholder="Buscar por visitante o contenido..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className={INPUT_CLS + ' w-full md:w-80'}
        />
        <p className="text-[11px] text-slate-500">{filtered.length} conversaciones</p>
      </div>

      <div className="space-y-2">
        {filtered.length === 0 && (
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
                <span className="text-[10px] text-slate-600">{conv.messages?.length || 0} msgs</span>
              </div>
              <svg className={`w-4 h-4 text-slate-600 transition-transform ${expanded === conv.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {expanded === conv.id && (
              <div className="border-t border-cyan-500/25 p-3 space-y-2 max-h-96 overflow-y-auto">
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

function LeadsTab({ secret }: { secret: string }) {
  const { data, loading, refetch } = useDashFetch<Lead[]>(secret, '/api/dashboard/leads');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);

  const filtered = data?.filter((l) => {
    const matchSearch = !search ||
      (l.email || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.phone || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (l.company || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || l.status === statusFilter;
    return matchSearch && matchStatus;
  }) || [];

  const updateStatus = async (id: string, status: string) => {
    setUpdating(id);
    try {
      await fetch('/api/dashboard/leads', {
        method: 'PATCH',
        headers: headers(secret),
        body: JSON.stringify({ id, status }),
      });
      await refetch();
    } finally {
      setUpdating(null);
    }
  };

  const exportCsv = () => {
    window.open(`/api/dashboard/export?secret=${secret}`, '_blank');
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <input
          type="text"
          placeholder="Buscar por nombre, email, telefono..."
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
                <th className="text-left p-3">Telefono</th>
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
                    </div>
                  </td>
                  <td className="p-3 text-xs text-slate-400">{l.email || '—'}</td>
                  <td className="p-3 text-xs text-slate-400">{l.phone || '—'}</td>
                  <td className="p-3 text-xs text-slate-400">{l.project_type || '—'}</td>
                  <td className="p-3"><Badge status={l.status} /></td>
                  <td className="p-3 text-[11px] text-slate-500">{formatDate(l.created_at)}</td>
                  <td className="p-3">
                    {updating === l.id ? (
                      <span className="text-[10px] text-slate-500">...</span>
                    ) : (
                      <select
                        value={l.status}
                        onChange={(e) => updateStatus(l.id, e.target.value)}
                        className="bg-transparent text-[10px] text-slate-500 border border-cyan-500/25 rounded px-1 py-0.5 focus:outline-none focus:border-primary/40"
                      >
                        <option value="new">Nuevo</option>
                        <option value="contacted">Contactado</option>
                        <option value="qualified">Cualificado</option>
                        <option value="lost">Perdido</option>
                      </select>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[10px] text-slate-600 mt-3">{filtered.length} leads mostrados de {data?.length || 0} totales</p>
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

function ProjectsTab({ secret }: { secret: string }) {
  const { data: projects, loading, refetch: refetchProjects } = useDashFetch<Project[]>(secret, '/api/dashboard/projects?tasks=true');
  const { data: clients, refetch: refetchClients } = useDashFetch<Client[]>(secret, '/api/dashboard/clients');

  const refetchAll = async () => { await Promise.all([refetchProjects(), refetchClients()]); };

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isNewProject, setIsNewProject] = useState(false);
  const [isNewClient, setIsNewClient] = useState(false);
  const [form, setForm] = useState<Record<string, string | number>>({});
  const [clientForm, setClientForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [generatingTasks, setGeneratingTasks] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [taskView, setTaskView] = useState<'kanban' | 'list'>('kanban');

  const selectedClient = clients?.find(c => c.id === selectedClientId) || null;
  const selectedProject = projects?.find(p => p.id === selectedProjectId) || null;
  const filteredProjects = selectedClientId ? projects?.filter(p => p.client_id === selectedClientId) : projects;

  const selectClient = (c: Client) => {
    setSelectedClientId(c.id);
    setSelectedProjectId(null);
    setIsNewProject(false);
    setIsNewClient(false);
  };

  const selectProject = (p: Project) => {
    setSelectedProjectId(p.id);
    setIsNewProject(false);
    setForm({
      title: p.title || '', type: p.type || '', client_name: p.client_name || '',
      client_id: p.client_id || '', status: p.status || 'planning',
      description: p.description || '', video_url: p.video_url || '',
      resolution: p.resolution || '', aspect: p.aspect || '',
      duration: p.duration || '', category: p.category || '',
      sort_order: p.sort_order || 0, thumbnail_url: p.thumbnail_url || '',
    });
  };

  const startNewProject = () => {
    setSelectedProjectId(null);
    setIsNewProject(true);
    setForm({
      title: '', type: '', client_name: selectedClient?.name || '',
      client_id: selectedClientId || '', status: 'planning',
      description: '', video_url: '', resolution: '', aspect: '',
      duration: '', category: '', sort_order: 0, thumbnail_url: '',
    });
  };

  const startNewClient = () => {
    setIsNewClient(true);
    setClientForm({ name: '', company: '', email: '', phone: '', notes: '' });
  };

  const saveClient = async () => {
    setSaving(true);
    try {
      await fetch('/api/dashboard/clients', {
        method: 'POST', headers: headers(secret), body: JSON.stringify(clientForm),
      });
      setIsNewClient(false);
      setClientForm({});
      await refetchAll();
    } finally { setSaving(false); }
  };

  const deleteClient = async (id: string) => {
    if (!confirm('Eliminar cliente? Sus proyectos quedaran sin cliente asignado.')) return;
    await fetch(`/api/dashboard/clients?id=${id}`, {
      method: 'DELETE', headers: { 'x-dashboard-secret': secret },
    });
    if (selectedClientId === id) { setSelectedClientId(null); setSelectedProjectId(null); }
    await refetchAll();
  };

  const saveProject = async () => {
    setSaving(true);
    try {
      if (selectedProjectId) {
        await fetch('/api/dashboard/projects', {
          method: 'PATCH', headers: headers(secret),
          body: JSON.stringify({ id: selectedProjectId, ...form }),
        });
      } else {
        const res = await fetch('/api/dashboard/projects', {
          method: 'POST', headers: headers(secret), body: JSON.stringify({ ...form }),
        });
        const created = await res.json();
        if (created?.id) { setSelectedProjectId(created.id); setIsNewProject(false); }
      }
      await refetchProjects();
    } finally { setSaving(false); }
  };

  const deleteProject = async () => {
    if (!selectedProjectId || !confirm('Eliminar proyecto?')) return;
    await fetch(`/api/dashboard/projects?id=${selectedProjectId}`, {
      method: 'DELETE', headers: { 'x-dashboard-secret': secret },
    });
    setSelectedProjectId(null); setIsNewProject(false); setForm({});
    await refetchProjects();
  };

  const uploadThumbnail = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/dashboard/upload', {
        method: 'POST', headers: { 'x-dashboard-secret': secret }, body: fd,
      });
      const { url } = await res.json();
      setForm(f => ({ ...f, thumbnail_url: url }));
    } finally { setUploading(false); }
  };

  const addTask = async () => {
    if (!newTaskTitle.trim() || !selectedProjectId) return;
    await fetch('/api/dashboard/tasks', {
      method: 'POST', headers: headers(secret),
      body: JSON.stringify({ project_id: selectedProjectId, title: newTaskTitle.trim(), status: 'pending', priority: newTaskPriority }),
    });
    setNewTaskTitle(''); setNewTaskPriority('medium');
    await refetchProjects();
  };

  const changeTaskStatus = async (task: ProjectTask, newStatus: string) => {
    await fetch('/api/dashboard/tasks', {
      method: 'PATCH', headers: headers(secret),
      body: JSON.stringify({ id: task.id, status: newStatus }),
    });
    if (newStatus === 'completed' && selectedProject) {
      fetch('/api/dashboard/ai-generate', {
        method: 'POST', headers: headers(secret),
        body: JSON.stringify({
          action: 'task_completed', project_title: selectedProject.title,
          project_id: selectedProject.id, task_title: task.title, task_status: 'completed',
        }),
      }).catch(() => {});
    }
    await refetchProjects();
  };

  const deleteTask = async (taskId: string) => {
    await fetch(`/api/dashboard/tasks?id=${taskId}`, {
      method: 'DELETE', headers: { 'x-dashboard-secret': secret },
    });
    await refetchProjects();
  };

  const generateTasksAi = async () => {
    if (!selectedProjectId) return;
    setGeneratingTasks(true);
    try {
      await fetch('/api/dashboard/ai-generate', {
        method: 'POST', headers: headers(secret),
        body: JSON.stringify({
          action: 'generate_tasks', project_title: form.title || 'Proyecto',
          project_id: selectedProjectId, description: form.description || '',
          has_thumbnail: !!form.thumbnail_url,
        }),
      });
      await refetchProjects();
    } catch {} finally { setGeneratingTasks(false); }
  };

  const generateAi = async () => {
    if (!selectedProject) return;
    setGenerating(true);
    try {
      await fetch('/api/dashboard/ai-generate', {
        method: 'POST', headers: headers(secret),
        body: JSON.stringify({ action: 'generate', project_title: selectedProject.title, project_id: selectedProject.id }),
      });
      await refetchProjects();
    } catch {} finally { setGenerating(false); }
  };

  const setField = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [key]: e.target.value }));
  };

  if (loading) return <LoadingSpinner />;

  const showForm = isNewProject || selectedProjectId;
  const tasks = selectedProject?.tasks || [];
  const todo = tasks.filter(t => t.status === 'pending');
  const doing = tasks.filter(t => t.status === 'in_progress');
  const done = tasks.filter(t => t.status === 'completed');

  return (
    <div className="flex gap-3 h-[calc(100vh-140px)] md:h-[calc(100vh-140px)] flex-col md:flex-row">
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
            onClick={() => { setSelectedClientId(null); setSelectedProjectId(null); setIsNewProject(false); }}
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
        {isNewClient && (
          <div className="p-3 border-t border-cyan-500/25 space-y-2">
            <input value={clientForm.name || ''} onChange={e => setClientForm(f => ({ ...f, name: e.target.value }))} placeholder="Nombre" className={INPUT_CLS} />
            <input value={clientForm.company || ''} onChange={e => setClientForm(f => ({ ...f, company: e.target.value }))} placeholder="Empresa" className={INPUT_CLS} />
            <input value={clientForm.email || ''} onChange={e => setClientForm(f => ({ ...f, email: e.target.value }))} placeholder="Email" className={INPUT_CLS} />
            <div className="flex gap-2">
              <button onClick={saveClient} disabled={saving} className="flex-1 text-[11px] px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50">Guardar</button>
              <button onClick={() => setIsNewClient(false)} className="text-[11px] px-3 py-1.5 rounded border border-cyan-500/25 text-slate-500">X</button>
            </div>
          </div>
        )}
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
                <p className="text-xs text-slate-300 truncate">{p.title || 'Sin titulo'}</p>
                <div className="flex items-center gap-2 mt-1">
                  <ProjBadge status={p.status} />
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
            onClick={() => { setSelectedProjectId(null); setIsNewProject(false); setForm({}); }}
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

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Titulo</label>
                <input value={form.title || ''} onChange={setField('title')} className={INPUT_CLS} placeholder="GIFTMEFYY" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Cliente</label>
                <select value={form.client_id || ''} onChange={e => {
                  const cid = e.target.value;
                  const cl = clients?.find(c => c.id === cid);
                  setForm(f => ({ ...f, client_id: cid, client_name: cl?.name || '' }));
                }} className={INPUT_CLS}>
                  <option value="">Sin cliente</option>
                  {clients?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div className="col-span-1 md:col-span-2">
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Descripcion del proyecto</label>
                <textarea value={form.description || ''} onChange={setField('description')} rows={2} className={INPUT_CLS + ' resize-none'} placeholder="Videoclip para redes sociales, spot publicitario..." />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Estado</label>
                <select value={form.status || 'planning'} onChange={setField('status')} className={INPUT_CLS}>
                  <option value="planning">Planificacion</option>
                  <option value="in_production">Produccion</option>
                  <option value="post_production">Post-produccion</option>
                  <option value="completed">Completado</option>
                  <option value="delivered">Entregado</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Tipo / Categoria</label>
                <input value={form.category || ''} onChange={setField('category')} className={INPUT_CLS} placeholder="commercial, music-video..." />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Video URL</label>
                <input value={form.video_url || ''} onChange={setField('video_url')} className={INPUT_CLS} />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Duracion</label>
                <input value={form.duration || ''} onChange={setField('duration')} className={INPUT_CLS} placeholder="30s, 3:42..." />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Thumbnail</label>
                <div className="flex items-center gap-2">
                  {form.thumbnail_url && <img src={form.thumbnail_url as string} alt="" className="w-16 h-10 object-cover rounded border border-cyan-500/25" />}
                  <label className={`text-[11px] px-2 py-1 rounded border cursor-pointer ${uploading ? 'opacity-50' : 'border-cyan-500/25 text-slate-400 hover:text-primary'}`}>
                    {uploading ? '...' : 'Subir'}
                    <input type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) uploadThumbnail(f); }} disabled={uploading} />
                  </label>
                </div>
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Resolucion</label>
                <input value={form.resolution || ''} onChange={setField('resolution')} className={INPUT_CLS} placeholder="3840x2160" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button onClick={saveProject} disabled={saving} className="text-[11px] px-4 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 disabled:opacity-50">
                {saving ? 'Guardando...' : 'Guardar'}
              </button>
              {selectedProjectId && (
                <button onClick={deleteProject} className="text-[11px] px-3 py-1.5 rounded bg-red-500/10 border border-red-500/30 text-red-400 hover:bg-red-500/20">
                  Eliminar
                </button>
              )}
            </div>

            {/* TASKS */}
            {selectedProjectId && (
              <div className="border-t border-cyan-500/25 pt-4">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] uppercase tracking-widest text-slate-500">Tareas ({tasks.length})</p>
                  <div className="flex items-center gap-2">
                    <div className="flex border border-cyan-500/25 rounded overflow-hidden">
                      <button onClick={() => setTaskView('kanban')} className={`text-[10px] px-2 py-1 ${taskView === 'kanban' ? 'bg-primary/10 text-primary' : 'text-slate-500'}`}>Kanban</button>
                      <button onClick={() => setTaskView('list')} className={`text-[10px] px-2 py-1 ${taskView === 'list' ? 'bg-primary/10 text-primary' : 'text-slate-500'}`}>Lista</button>
                    </div>
                    <button onClick={generateTasksAi} disabled={generatingTasks} className="text-[11px] px-3 py-1 rounded bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 disabled:opacity-50">
                      {generatingTasks ? 'Generando...' : 'Generar tareas IA'}
                    </button>
                  </div>
                </div>

                {/* Add task */}
                <div className="flex gap-2 mb-4">
                  <input value={newTaskTitle} onChange={e => setNewTaskTitle(e.target.value)} placeholder="Nueva tarea..." onKeyDown={e => { if (e.key === 'Enter') addTask(); }} className={INPUT_CLS} />
                  <select value={newTaskPriority} onChange={e => setNewTaskPriority(e.target.value as any)} className="bg-[#0a0a0a] border border-cyan-500/25 rounded px-2 py-1.5 text-xs text-slate-400">
                    <option value="low">Baja</option>
                    <option value="medium">Media</option>
                    <option value="high">Alta</option>
                  </select>
                  <button onClick={addTask} className="text-[11px] px-3 py-1.5 rounded border border-cyan-500/25 text-slate-400 hover:text-primary flex-shrink-0">+</button>
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
                                <button onClick={() => deleteTask(t.id)} className="text-[9px] text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 flex-shrink-0">X</button>
                              </div>
                              {t.description && <p className="text-[9px] text-slate-600 mt-1 line-clamp-2">{t.description}</p>}
                              <div className="flex items-center justify-between mt-1.5">
                                <PriorityBadge priority={t.priority || 'medium'} />
                                <div className="flex gap-1">
                                  {status !== 'pending' && <button onClick={() => changeTaskStatus(t, 'pending')} className="text-[8px] text-slate-600 hover:text-slate-400 px-1">←</button>}
                                  {status !== 'in_progress' && <button onClick={() => changeTaskStatus(t, 'in_progress')} className="text-[8px] text-slate-600 hover:text-cyan-400 px-1">▶</button>}
                                  {status !== 'completed' && <button onClick={() => changeTaskStatus(t, 'completed')} className="text-[8px] text-slate-600 hover:text-green-400 px-1">✓</button>}
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
                        <button onClick={() => {
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
                        <button onClick={() => deleteTask(t.id)} className="text-[10px] text-slate-700 hover:text-red-400 opacity-0 group-hover:opacity-100 flex-shrink-0">
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
  );
}

function FeedTab({ secret }: { secret: string }) {
  const { data: feeds, loading: feedsLoading, refetch: refetchFeeds } = useDashFetch<FeedEntry[]>(secret, '/api/dashboard/feed-entries');
  const { data: logs, loading: logsLoading, refetch: refetchLogs } = useDashFetch<StudioLog[]>(secret, '/api/dashboard/studio-logs');
  const [newFeedText, setNewFeedText] = useState('');
  const [newFeedLevel, setNewFeedLevel] = useState<'high' | 'mid' | 'low'>('mid');
  const [newLogText, setNewLogText] = useState('');
  const [newLogType, setNewLogType] = useState<'success' | 'info' | 'warning'>('info');
  const [generating, setGenerating] = useState(false);

  const addFeed = async () => {
    if (!newFeedText.trim()) return;
    await fetch('/api/dashboard/feed-entries', {
      method: 'POST',
      headers: headers(secret),
      body: JSON.stringify({ text: newFeedText.trim(), level: newFeedLevel, is_active: true }),
    });
    setNewFeedText('');
    refetchFeeds();
  };

  const toggleFeed = async (entry: FeedEntry) => {
    await fetch('/api/dashboard/feed-entries', {
      method: 'PATCH',
      headers: headers(secret),
      body: JSON.stringify({ id: entry.id, is_active: !entry.is_active }),
    });
    refetchFeeds();
  };

  const addLog = async () => {
    if (!newLogText.trim()) return;
    await fetch('/api/dashboard/studio-logs', {
      method: 'POST',
      headers: headers(secret),
      body: JSON.stringify({ text: newLogText.trim(), log_type: newLogType, is_active: true }),
    });
    setNewLogText('');
    refetchLogs();
  };

  const toggleLog = async (log: StudioLog) => {
    await fetch('/api/dashboard/studio-logs', {
      method: 'PATCH',
      headers: headers(secret),
      body: JSON.stringify({ id: log.id, is_active: !log.is_active }),
    });
    refetchLogs();
  };

  const generateAi = async () => {
    setGenerating(true);
    try {
      await fetch('/api/dashboard/ai-generate', {
        method: 'POST',
        headers: headers(secret),
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
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm text-slate-200">Feed & Logs</h2>
        <button onClick={generateAi} disabled={generating} className="text-[11px] px-3 py-1.5 rounded bg-purple-500/10 border border-purple-500/30 text-purple-400 hover:bg-purple-500/20 transition-colors disabled:opacity-50">
          {generating ? 'Generando...' : 'Generar IA'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg">
          <div className="p-3 border-b border-cyan-500/25">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">AI Generation Live</p>
          </div>
          <div className="p-3 border-b border-cyan-500/25 space-y-2">
            <input value={newFeedText} onChange={e => setNewFeedText(e.target.value)} placeholder="Texto de la entrada..." className={INPUT_CLS} />
            <div className="flex gap-2">
              <select value={newFeedLevel} onChange={e => setNewFeedLevel(e.target.value as 'high' | 'mid' | 'low')} className="bg-[#0a0a0a] border border-cyan-500/25 rounded px-3 py-1.5 text-sm text-slate-400 focus:outline-none focus:border-primary/40 flex-1">
                <option value="high">High</option>
                <option value="mid">Mid</option>
                <option value="low">Low</option>
              </select>
              <button onClick={addFeed} className="text-[11px] px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors flex-shrink-0">
                Agregar
              </button>
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {feeds?.map(entry => (
              <div key={entry.id} className="flex items-start gap-2 p-3 border-b border-cyan-500/25/50 hover:bg-[#0f0f0f] transition-colors">
                <span className={`text-[10px] font-medium mt-0.5 ${LEVEL_COLORS[entry.level] || 'text-slate-500'}`}>{entry.level.toUpperCase()}</span>
                <p className="text-xs text-slate-300 flex-1">{entry.text}</p>
                <button onClick={() => toggleFeed(entry)} className={`text-[10px] px-2 py-0.5 rounded flex-shrink-0 ${entry.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                  {entry.is_active ? 'ON' : 'OFF'}
                </button>
              </div>
            ))}
            {!feeds?.length && <p className="text-slate-500 text-xs text-center py-6">Sin entradas</p>}
          </div>
        </div>

        <div className="bg-[#0a0a0a] border border-cyan-500/25 rounded-lg">
          <div className="p-3 border-b border-cyan-500/25">
            <p className="text-[10px] uppercase tracking-widest text-slate-500">Studio Logs</p>
          </div>
          <div className="p-3 border-b border-cyan-500/25 space-y-2">
            <input value={newLogText} onChange={e => setNewLogText(e.target.value)} placeholder="Texto del log..." className={INPUT_CLS} />
            <div className="flex gap-2">
              <select value={newLogType} onChange={e => setNewLogType(e.target.value as 'success' | 'info' | 'warning')} className="bg-[#0a0a0a] border border-cyan-500/25 rounded px-3 py-1.5 text-sm text-slate-400 focus:outline-none focus:border-primary/40 flex-1">
                <option value="success">Success</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
              </select>
              <button onClick={addLog} className="text-[11px] px-3 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors flex-shrink-0">
                Agregar
              </button>
            </div>
          </div>
          <div className="max-h-[50vh] overflow-y-auto">
            {logs?.map(log => (
              <div key={log.id} className="flex items-start gap-2 p-3 border-b border-cyan-500/25/50 hover:bg-[#0f0f0f] transition-colors">
                <span className={`text-[10px] font-medium mt-0.5 ${LOG_COLORS[log.log_type] || 'text-slate-500'}`}>{log.log_type.toUpperCase()}</span>
                <p className="text-xs text-slate-300 flex-1">{log.text}</p>
                <button onClick={() => toggleLog(log)} className={`text-[10px] px-2 py-0.5 rounded flex-shrink-0 ${log.is_active ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-500'}`}>
                  {log.is_active ? 'ON' : 'OFF'}
                </button>
              </div>
            ))}
            {!logs?.length && <p className="text-slate-500 text-xs text-center py-6">Sin logs</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

function StudioTab({ secret }: { secret: string }) {
  const { data: stats, loading: statsLoading, refetch: refetchStats } = useDashFetch<StudioStat[]>(secret, '/api/dashboard/stats');
  const { data: services, loading: servicesLoading, refetch: refetchServices } = useDashFetch<Service[]>(secret, '/api/dashboard/services');
  const [statValues, setStatValues] = useState<Record<string, number>>({});
  const [savingStat, setSavingStat] = useState<string | null>(null);
  const [svcForm, setSvcForm] = useState({ id: '', title: '', description: '', icon: '', sort_order: 0 });
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
      await fetch('/api/dashboard/stats', {
        method: 'PATCH',
        headers: headers(secret),
        body: JSON.stringify({ key, value: statValues[key] }),
      });
      refetchStats();
    } finally {
      setSavingStat(null);
    }
  };

  const editService = (svc: Service) => {
    setSvcForm({ id: svc.id, title: svc.title, description: svc.description || '', icon: svc.icon || '', sort_order: svc.sort_order || 0 });
    setShowSvcForm(true);
  };

  const newService = () => {
    setSvcForm({ id: '', title: '', description: '', icon: '', sort_order: 0 });
    setShowSvcForm(true);
  };

  const saveService = async () => {
    setSavingSvc(true);
    try {
      if (svcForm.id) {
        await fetch('/api/dashboard/services', {
          method: 'PATCH',
          headers: headers(secret),
          body: JSON.stringify({ id: svcForm.id, title: svcForm.title, description: svcForm.description, icon: svcForm.icon, sort_order: svcForm.sort_order }),
        });
      } else {
        await fetch('/api/dashboard/services', {
          method: 'POST',
          headers: headers(secret),
          body: JSON.stringify({ title: svcForm.title, description: svcForm.description, icon: svcForm.icon, sort_order: svcForm.sort_order }),
        });
      }
      setShowSvcForm(false);
      setSvcForm({ id: '', title: '', description: '', icon: '', sort_order: 0 });
      refetchServices();
    } finally {
      setSavingSvc(false);
    }
  };

  const deleteService = async (id: string) => {
    if (!confirm('Eliminar servicio?')) return;
    await fetch(`/api/dashboard/services?id=${id}`, {
      method: 'DELETE',
      headers: { 'x-dashboard-secret': secret },
    });
    refetchServices();
  };

  if (statsLoading || servicesLoading) return <LoadingSpinner />;

  return (
    <div className="space-y-6">
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
                onClick={() => saveStat(stat.key)}
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
                <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Titulo</label>
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
              <label className="text-[10px] uppercase tracking-widest text-slate-500 mb-1 block">Descripcion</label>
              <textarea value={svcForm.description} onChange={e => setSvcForm(f => ({ ...f, description: e.target.value }))} rows={2} className={INPUT_CLS + ' resize-none'} />
            </div>
            <div className="flex gap-2">
              <button onClick={saveService} disabled={savingSvc} className="text-[11px] px-4 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50">
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
              <button onClick={() => editService(svc)} className="text-[10px] text-primary/70 hover:text-primary">Editar</button>
              <button onClick={() => deleteService(svc.id)} className="text-[10px] text-red-500/70 hover:text-red-400">Eliminar</button>
            </div>
          ))}
          {!services?.length && <p className="text-slate-500 text-xs text-center py-6">Sin servicios</p>}
        </div>
      </div>
    </div>
  );
}

function ContentTab({ secret }: { secret: string }) {
  const [contentType, setContentType] = useState<'projects' | 'services'>('projects');
  const { data, loading, refetch } = useDashFetch<unknown>(secret, `/api/dashboard/content?type=${contentType}`, [contentType]);
  const [editData, setEditData] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) setEditData(JSON.stringify(data, null, 2));
  }, [data]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const parsed = JSON.parse(editData);
      await fetch('/api/dashboard/content', {
        method: 'PUT',
        headers: headers(secret),
        body: JSON.stringify({ key: contentType, data: parsed }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      refetch();
    } catch {
      alert('JSON invalido');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !editData) return <LoadingSpinner />;

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button
          onClick={() => { setContentType('projects'); setEditData(''); }}
          className={`text-[11px] px-3 py-1.5 rounded border transition-colors ${contentType === 'projects' ? 'border-primary/40 text-primary bg-primary/5' : 'border-cyan-500/25 text-slate-500 hover:text-slate-300'}`}
        >
          Proyectos
        </button>
        <button
          onClick={() => { setContentType('services'); setEditData(''); }}
          className={`text-[11px] px-3 py-1.5 rounded border transition-colors ${contentType === 'services' ? 'border-primary/40 text-primary bg-primary/5' : 'border-cyan-500/25 text-slate-500 hover:text-slate-300'}`}
        >
          Servicios
        </button>
        <div className="flex-1" />
        <button
          onClick={save}
          disabled={saving}
          className="text-[11px] px-4 py-1.5 rounded bg-primary/10 border border-primary/30 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
        >
          {saving ? 'Guardando...' : saved ? 'Guardado' : 'Guardar cambios'}
        </button>
      </div>

      <textarea
        value={editData}
        onChange={(e) => setEditData(e.target.value)}
        spellCheck={false}
        className="w-full h-[70vh] bg-[#0a0a0a] border border-cyan-500/25 rounded-lg p-4 text-xs text-slate-300 font-mono focus:outline-none focus:border-primary/40 resize-none leading-relaxed"
      />

      <p className="text-[10px] text-slate-600 mt-2">
        Edita el JSON y guarda para actualizar. Los cambios se reflejan en la web la proxima vez que se cargue.
      </p>
    </div>
  );
}

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'visitors', label: 'Visitantes' },
  { key: 'conversations', label: 'Conversaciones' },
  { key: 'leads', label: 'Leads' },
  { key: 'projects', label: 'Clientes' },
  { key: 'feed', label: 'Feed & Logs' },
  { key: 'studio', label: 'Studio' },
  { key: 'content', label: 'Contenido' },
];

export default function DashboardApp({ secret }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  return (
    <div className="min-h-screen bg-[#050505] text-slate-300 font-mono flex flex-col">
      <header className="border-b border-cyan-500/25 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold text-slate-200 tracking-wide">AKRASIA STUDIO</h1>
          <span className="text-[10px] text-slate-600 uppercase tracking-widest">Admin Dashboard</span>
        </div>
        <a href="/" className="text-[10px] text-slate-600 hover:text-primary transition-colors">
          Volver al sitio
        </a>
      </header>

      <nav className="border-b border-cyan-500/25 px-6 flex gap-1 overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
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

      <main className="flex-1 p-3 md:p-6 overflow-y-auto">
        {activeTab === 'overview' && <OverviewTab secret={secret} />}
        {activeTab === 'visitors' && <VisitorsTab secret={secret} />}
        {activeTab === 'conversations' && <ConversationsTab secret={secret} />}
        {activeTab === 'leads' && <LeadsTab secret={secret} />}
        {activeTab === 'projects' && <ProjectsTab secret={secret} />}
        {activeTab === 'feed' && <FeedTab secret={secret} />}
        {activeTab === 'studio' && <StudioTab secret={secret} />}
        {activeTab === 'content' && <ContentTab secret={secret} />}
      </main>
    </div>
  );
}
