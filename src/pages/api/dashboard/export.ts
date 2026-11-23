import type { APIRoute } from 'astro';
import { validateDashboardSession, dashError, sbRequest, dashboardRows, DashboardStorageError } from '../../../lib/dashboard';
import { dashboardSecurityHeaders } from '../../../lib/dashboard-auth';
import { csvText, serializeCsv } from '../../../lib/csv';
const EXPORT_FIELDS = 'id,email,phone,name,company,project_type,status,tags,created_at';
const PAGE_SIZE = 500;
const EXPORT_MAX_ROWS = 10000;
const EXPORT_MAX_BYTES = 8 * 1024 * 1024;
const csvRow=(l:Record<string,unknown>)=>[csvText(l.id),csvText(l.email),csvText(l.phone),csvText(l.name),csvText(l.company),csvText(l.project_type),csvText(l.status),Array.isArray(l.tags) ? l.tags.map(csvText).join('; ') : '',csvText(l.created_at)];
export const GET: APIRoute = async ({ request }) => {
  if (!validateDashboardSession(request)) return dashboardSecurityHeaders(dashError('Unauthorized'));
  const leads: Record<string,unknown>[] = []; const seen = new Set<string>(); const cutoff = new Date().toISOString();let estimatedBytes=0;
  try {
    let cursor: { date:string; id:string } | undefined;
    while (true) {
      let query = `leads?select=${EXPORT_FIELDS}&order=created_at.desc,id.desc&limit=${PAGE_SIZE}&created_at=lte.${cutoff}`;
      if (cursor) query += `&or=(created_at.lt.${cursor.date},and(created_at.eq.${cursor.date},id.lt.${cursor.id}))`;
      const rows = dashboardRows((await sbRequest(query)).data);
      if (rows.length > PAGE_SIZE) throw new DashboardStorageError();
      estimatedBytes+=new TextEncoder().encode(serializeCsv(rows.map(csvRow))).byteLength;
      if(estimatedBytes>EXPORT_MAX_BYTES)return dashError('El archivo supera el límite de descarga. Acota el conjunto.',413);
      for (const row of rows) {
        if (typeof row.id !== 'string' || row.id.length > 200 || typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at)) || seen.has(row.id)) throw new DashboardStorageError();
        seen.add(row.id); leads.push(row);
      }
      if (leads.length > EXPORT_MAX_ROWS) return dashError('La exportación supera 10.000 registros. Acota el conjunto antes de descargar.',413);
      if (rows.length < PAGE_SIZE) break;
      const last = rows[rows.length - 1];
      if (!/^[a-f0-9-]{36}$/i.test(last.id)) throw new DashboardStorageError();
      cursor = { date:new Date(last.created_at).toISOString(),id:last.id };
    }
  } catch { return dashError('No se ha podido generar la exportación. Inténtalo de nuevo.',503); }
  const headers = ['ID','Email','Phone','Name','Company','Project Type','Status','Tags','Created At'];
  const rows = leads.map(csvRow);
  const csv = serializeCsv([headers,...rows],{bom:true});
  if (new TextEncoder().encode(csv).byteLength > EXPORT_MAX_BYTES) return dashError('El archivo supera el límite de descarga. Acota el conjunto.',413);
  return dashboardSecurityHeaders(new Response(csv,{headers:{'Content-Type':'text/csv; charset=utf-8; header=present','Content-Disposition':'attachment; filename="akrasia-leads.csv"'}}));
};
