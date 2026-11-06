import type { APIRoute } from 'astro';
import { isDashboardRequestAuthorized, dashboardSecurityHeaders } from './dashboard-auth';
export function validateDashboardSession(request: Request): boolean { return isDashboardRequestAuthorized(request); }
export function dashResponse(data: unknown, status = 200, extraHeaders: HeadersInit = {}) {
  return dashboardSecurityHeaders(new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders } }));
}
export function dashError(message: string, status = 401) { return dashResponse({ error: message }, status); }
export class DashboardInputError extends Error {}
export class DashboardStorageError extends Error {
  readonly requestId=crypto.randomUUID();
  constructor(public status = 503, public code = 'storage_unavailable') { super('No se pudo completar la operación de datos.'); }
}
export function dashboardFailure(error: unknown): Response {
  if (error instanceof DashboardInputError) return dashError(error.message, 400);
  if (error instanceof DashboardStorageError) {
    if(error.status>=500) console.warn('[dashboard-data]',{requestId:error.requestId,code:error.code,status:error.status});
    return dashResponse({error:error.status === 404 ? 'Registro no encontrado.' : error.status === 409 ? 'La operación entra en conflicto con otro registro. Recarga y revisa los datos.' : 'No se pudieron cargar o guardar los datos. Inténtalo de nuevo.'},error.status,{'X-Request-Id':error.requestId});
  }
  return dashError('No se pudo completar la operación. Inténtalo de nuevo.', 503);
}
export function dashboardRoute(handler: APIRoute): APIRoute {
  return async context => {
    if (!validateDashboardSession(context.request)) return dashError('Unauthorized');
    try { return await handler(context); } catch (error) { return dashboardFailure(error); }
  };
}
export async function dashboardJson(request: Request, maximum = 128 * 1024): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new DashboardInputError('Se requiere JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new DashboardInputError('JSON inválido.');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > maximum) { await reader.cancel(); throw new DashboardInputError('La solicitud supera el tamaño permitido.'); } chunks.push(value); }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch (error) { if (error instanceof DashboardInputError) throw error; throw new DashboardInputError('El cuerpo debe ser un objeto JSON válido.'); }
  finally { reader.releaseLock(); }
}
export const dashboardId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
export function requireDashboardId(value: unknown): string { if (!dashboardId(value)) throw new DashboardInputError('id debe ser un UUID.'); return value.toLowerCase(); }
export async function sbRequest(path: string, method = 'GET', body?: unknown, prefer = 'return=representation', signal?: AbortSignal): Promise<{ data: unknown; headers: Headers }> {
  const endpoint = import.meta.env.SUPABASE_URL, key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!endpoint || !key || !/^(?:rpc\/)?[a-z0-9_]+(?:\?[^#\r\n]*)?$/i.test(path)) throw new DashboardStorageError();
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${endpoint.replace(/\/$/, '')}/rest/v1/${path}`, {
      method, cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([controller.signal,signal]) : controller.signal,
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`, Prefer: prefer },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) { await response.body?.cancel(); throw new DashboardStorageError(response.status === 409 ? 409 : response.status === 404 ? 404 : 503); }
    const reader=response.body?.getReader();const chunks:Uint8Array[]=[];let bytes=0;
    if(reader) {try {while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>16*1024*1024){await reader.cancel();throw new DashboardStorageError();}chunks.push(value);}}finally{reader.releaseLock();}}
    const joined=new Uint8Array(bytes);let cursor=0;for(const chunk of chunks){joined.set(chunk,cursor);cursor+=chunk.byteLength;}
    const text = new TextDecoder('utf-8',{fatal:true}).decode(joined);
    return { data: text ? JSON.parse(text) : null, headers: response.headers };
  } catch (error) { throw error instanceof DashboardStorageError ? error : new DashboardStorageError(); }
  finally { clearTimeout(timeout); }
}
export function dashboardRows(data: unknown): Record<string, any>[] {
  if (!Array.isArray(data) || data.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new DashboardStorageError();
  return data;
}
export async function sbQuery(table: string, query: string, signal?: AbortSignal) { return dashboardRows((await sbRequest(`${table}?${query}`,'GET',undefined,undefined,signal)).data); }
export async function sbPatch(table: string, query: string, body: unknown) { return dashboardRows((await sbRequest(`${table}?${query}`, 'PATCH', body)).data); }
export async function sbInsert(table: string, body: unknown) { return dashboardRows((await sbRequest(table, 'POST', body)).data); }
export async function sbUpsert(table: string, body: unknown) { return dashboardRows((await sbRequest(table, 'POST', body, 'return=representation,resolution=merge-duplicates')).data); }
export async function sbDelete(table: string, query: string) { const rows = dashboardRows((await sbRequest(`${table}?${query}`, 'DELETE')).data); if (!rows.length) throw new DashboardStorageError(404); return true; }
export async function sbRpc(name: string, body: unknown): Promise<unknown> { return (await sbRequest(`rpc/${name}`, 'POST', body)).data; }
export function oneDashboardRow(rows: Record<string, any>[], id?: string) { if (!rows.length) throw new DashboardStorageError(404); if (rows.length !== 1 || (id && rows[0].id !== id)) throw new DashboardStorageError(); return rows[0]; }
export interface DashboardPage { offset: number; limit: number; }
export function dashboardPage(request: Request): DashboardPage {
  const params = new URL(request.url).searchParams;
  const parse = (key: string, fallback: number, max: number) => { const value = params.get(key); if (value === null) return fallback; if (!/^\d{1,8}$/.test(value) || Number(value) > max) throw new DashboardInputError(`Paginación ${key} inválida.`); return Number(value); };
  const limit = parse('limit', 50, 100); if (!limit) throw new DashboardInputError('limit debe ser positivo.');
  return { offset: parse('offset', 0, 10000000), limit };
}
export async function dashboardList(table: string, query: string, request: Request): Promise<Response> {
  const page = dashboardPage(request);
  const result = await sbRequest(`${table}?${query}&limit=${page.limit}&offset=${page.offset}`, 'GET', undefined, 'count=exact');
  const rows = dashboardRows(result.data); const count = result.headers.get('content-range')?.split('/')[1]; const total = count === undefined ? NaN : Number(count);
  if (!Number.isSafeInteger(total) || total < rows.length || (rows.length === 0 && page.offset < total)) throw new DashboardStorageError();
  return dashResponse(rows, 200, { 'X-Total-Count': String(total), 'X-Page-Offset': String(page.offset), 'X-Page-Limit': String(page.limit), 'X-Next-Offset': page.offset + rows.length < total ? String(page.offset + rows.length) : '' });
}
