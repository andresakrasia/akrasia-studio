import { useEffect, useRef, useState } from 'react';
import type { PublicActivityChannel } from '../../lib/public-activity';
type Row = Record<string, any>;
type RequestData = (endpoint: string, options?: RequestInit) => Promise<Response>;
const fields = ['project_id','public_title','public_title_en','public_text','public_text_en','public_event_type','public_occurred_at'] as const;
const emptyDraft = () => ({ project_id:null,public_title:'',public_title_en:'',public_text:'',public_text_en:'',public_event_type:'studio',public_occurred_at:new Date().toISOString() });
export const activityEditorialDraft = (row: Row) => Object.fromEntries(fields.map(key => [key,key === 'public_occurred_at' && typeof row[key] === 'string' && Number.isFinite(Date.parse(row[key])) ? new Date(row[key]).toISOString() : row[key] ?? (key === 'project_id' || key === 'public_occurred_at' ? null : key === 'public_event_type' ? 'studio' : '')]));
const editorial = activityEditorialDraft;
function localDate(value: unknown): string {
  const date = new Date(typeof value === 'string' ? value : NaN);
  return Number.isFinite(date.getTime()) ? new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,19) : '';
}
export default function DashboardActivity({ request, inputClass }: { request: RequestData; inputClass: string }) {
  const [channel,setChannel] = useState<PublicActivityChannel>('feed');
  const [rows,setRows] = useState<Row[]>([]); const [projects,setProjects] = useState<Row[]>([]);
  const [selected,setSelected] = useState(''); const [draft,setDraft] = useState<Row | null>(null); const [original,setOriginal] = useState<Row | null>(null);
  const [offset,setOffset] = useState(0); const [next,setNext] = useState<number | null>(null); const [total,setTotal] = useState(0);
  const [pending,setPending] = useState(false); const lock = useRef(false); const operation = useRef<string | null>(null);
  const [error,setError] = useState(''); const [notice,setNotice] = useState('');
  const endpoint = `/api/dashboard/${channel === 'feed' ? 'feed-entries' : 'studio-logs'}`;
  const dirty = draft && original && JSON.stringify(draft) !== JSON.stringify(original);
  const choose = (row: Row) => { setSelected(row.id);setDraft(editorial(row));setOriginal(editorial(row));operation.current=null;setError('');setNotice(''); };
  useEffect(() => {
    let active = true;setPending(true);setError('');
    request(`${endpoint}?offset=${offset}&limit=50`).then(async response => {
      const data = await response.json();if (!Array.isArray(data)) throw new Error('No se confirmó la lista de actividad.');
      if (!active) return;setRows(data);setTotal(Number(response.headers.get('x-total-count')));setNext(response.headers.get('x-next-offset') ? Number(response.headers.get('x-next-offset')) : null);
      setSelected('');setDraft(null);setOriginal(null);
    }).catch(e => { if(active)setError(e instanceof Error ? e.message : 'No se pudo cargar la actividad.'); }).finally(() => {if(active)setPending(false);});
    return () => {active=false;};
  },[endpoint,offset,request]);
  useEffect(() => {
    let active = true;
    (async () => { const all:Row[]=[];let page:number | null=0;
      while (page !== null) {
        const response = await request(`/api/dashboard/projects?offset=${page}&limit=100`);
        const data = await response.json();if(!Array.isArray(data)||all.length+data.length>1000)throw new Error('No se pudo confirmar el catálogo de proyectos.');
        all.push(...data);page=response.headers.get('x-next-offset') ? Number(response.headers.get('x-next-offset')) : null;
      }
      if(active)setProjects(all.filter(row=>row.is_published === true));
    })().catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudieron cargar los proyectos publicados.');});
    return()=>{active=false;};
  },[request]);
  const newEntry = () => { if(dirty&&!confirm('¿Descartar los cambios de actividad sin guardar?'))return;const data=emptyDraft();setSelected('');setDraft(data);setOriginal(structuredClone(data));operation.current=crypto.randomUUID();setError('');setNotice(''); };
  const mutate = async (publish?: boolean) => {
    if (!draft || lock.current) return;lock.current=true;setPending(true);setError('');setNotice('');
    try {
      const body = publish === undefined ? selected ? {id:selected,...draft} : {operation_id:operation.current ??=crypto.randomUUID(),text:'Entrada editorial del estudio (gestión interna)',...draft} : {id:selected,is_published:publish,...(publish ? {public_revision:rows.find(row=>row.id===selected)?.public_revision} : {})};
      const response = await request(endpoint,{method:selected?'PATCH':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const saved:Row = await response.json();if (!saved || typeof saved.id !== 'string' || typeof saved.is_published !== 'boolean') throw new Error('El servidor no confirmó la actividad guardada.');
      setRows(current=>current.some(row=>row.id===saved.id)?current.map(row=>row.id===saved.id?saved:row):[saved,...current]);
      if (publish === undefined) {setSelected(saved.id);setDraft(editorial(saved));setOriginal(editorial(saved));operation.current=null;}
      setNotice(publish === true ? saved.is_published ? 'Publicación confirmada. La web solo utiliza los textos editoriales aprobados.' : 'El servidor conservó la entrada sin publicar. Revisa el contenido.' : publish === false ? 'Retirada confirmada.' : 'Borrador guardado. Revisa la vista previa y aprueba la publicación por separado.');
    } catch(e) {setError(e instanceof Error?e.message:'No se pudo confirmar el cambio.');}
    finally {lock.current=false;setPending(false);}
  };
  const current = rows.find(row=>row.id===selected);
  const setField = (key: string,value: unknown) => setDraft(prev=>prev?{...prev,[key]:value}:prev);
  return <section className="mb-6 p-4 border border-primary/30 rounded space-y-4" aria-label="Actividad editorial pública">
    <h2 className="text-sm text-primary">Actividad editorial pública</h2>
    <p className="text-xs text-slate-400">Publica novedades del estudio y avances autorizados. Los registros internos y sus botones ON/OFF continúan privados. Editar el texto, fecha o proyecto retira su aprobación; retirar un proyecto retira sus novedades.</p>
    {error&&<p role="alert" className="text-red-300">{error}</p>}{notice&&<p role="status" className="text-green-300">{notice}</p>}
    <div className="flex flex-wrap gap-3 text-xs">{(['feed','logs'] as const).map(value=><button key={value} type="button" aria-pressed={channel===value} disabled={pending} className="border border-primary/30 px-3 py-2" onClick={()=>{if(dirty&&!confirm('¿Descartar los cambios sin guardar?'))return;setChannel(value);setOffset(0);}}>{value==='feed'?'Avances de producción':'Novedades del estudio'}</button>)}<button type="button" disabled={pending} onClick={newEntry} className="border border-primary/30 px-3 py-2">Nueva entrada editorial</button></div>
    <div className="flex gap-3 text-xs"><button type="button" disabled={pending||offset===0||!!dirty} onClick={()=>setOffset(Math.max(0,offset-50))}>Anterior</button><span>{total} registros</span><button type="button" disabled={pending||next===null||!!dirty} onClick={()=>next!==null&&setOffset(next)}>Siguiente</button></div>
    <label className="block text-xs">Entrada<select className={inputClass} disabled={pending} value={selected} onChange={e=>{if(dirty&&!confirm('¿Descartar los cambios sin guardar?'))return;const row=rows.find(row=>row.id===e.target.value);if(row)choose(row);}}><option value="">Selecciona o crea una entrada</option>{rows.map(row=><option key={row.id} value={row.id}>{row.public_title || '(Sin título editorial)'} — {row.is_published?'publicada':'borrador'}</option>)}</select></label>
    {draft&&<fieldset disabled={pending} className="space-y-4">
      <div className="grid md:grid-cols-2 gap-3">{(['public_title','public_title_en','public_text','public_text_en'] as const).map(key=><label key={key} className="block text-xs">{key.includes('title')?'Título':'Texto'} público {key.endsWith('_en')?'EN':'ES'}<textarea className={inputClass} rows={key.includes('title')?2:4} maxLength={key.includes('title')?200:2000} value={draft[key]} onChange={e=>setField(key,e.target.value)}/></label>)}</div>
      <div className="grid md:grid-cols-3 gap-3"><label className="block text-xs">Tipo editorial<select className={inputClass} value={draft.public_event_type} onChange={e=>setField('public_event_type',e.target.value)}><option value="studio">Estudio</option><option value="process">Proceso</option><option value="milestone">Hito</option></select></label>
      <label className="block text-xs">Fecha real del evento (hora local)<input type="datetime-local" step="1" className={inputClass} value={localDate(draft.public_occurred_at)} onChange={e=>setField('public_occurred_at',e.target.value?new Date(e.target.value).toISOString():null)}/></label>
      <label className="block text-xs">Proyecto publicado (opcional)<select className={inputClass} value={draft.project_id || ''} onChange={e=>setField('project_id',e.target.value||null)}><option value="">Actividad del estudio</option>{draft.project_id&&!projects.some(row=>row.id===draft.project_id)&&<option value={draft.project_id}>Proyecto retirado: no puede publicarse</option>}{projects.map(row=><option key={row.id} value={row.id}>{row.title}</option>)}</select></label></div>
      <div className="grid md:grid-cols-2 gap-3 border border-slate-700 p-3" aria-label="Vista previa editorial">{(['es','en'] as const).map(language=><article lang={language} key={language}><p className="text-[10px] text-slate-400">Vista previa {language.toUpperCase()}</p><h3 className="text-sm text-primary">{draft[language==='es'?'public_title':'public_title_en'] || '(Sin título)'}</h3><p className="text-xs whitespace-pre-wrap text-slate-300">{draft[language==='es'?'public_text':'public_text_en'] || '(Sin texto)'}</p><p className="text-[10px] text-slate-400">{draft.public_occurred_at || '(Sin fecha)'}</p></article>)}</div>
      <div className="flex flex-wrap gap-3 text-xs"><button type="button" disabled={pending||!!selected&&!dirty} className="border border-primary/30 text-primary px-3 py-2" onClick={()=>void mutate()}>Guardar borrador editorial</button><button type="button" disabled={pending||!selected||!!dirty||current?.is_published===true} className="border border-green-500/40 text-green-300 px-3 py-2" onClick={()=>void mutate(true)}>Aprobar publicación editorial</button><button type="button" disabled={pending||!selected||current?.is_published!==true} className="border border-yellow-500/40 text-yellow-300 px-3 py-2" onClick={()=>void mutate(false)}>Retirar actividad pública</button></div>
    </fieldset>}
  </section>;
}
