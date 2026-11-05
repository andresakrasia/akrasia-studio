import { DashboardInputError, dashboardId } from './dashboard';
import { PUBLIC_ACTIVITY_TYPES } from './public-activity';
export const PUBLIC_ACTIVITY_EDIT_FIELDS = ['project_id','public_title','public_title_en','public_text','public_text_en','public_event_type','public_occurred_at'] as const;
const activityFields = { public_title: 200, public_title_en: 200, public_text: 2000, public_text_en: 2000, public_event_type: PUBLIC_ACTIVITY_TYPES, public_occurred_at: 'timestamp' };
export const SERVICE_ICONS = ['movie', 'auto_fix_high', 'layers', 'graphic_eq', 'campaign', 'palette', 'smart_toy', 'videocam', 'edit', 'headphones'] as const;
const schemas: Record<string, Record<string, unknown>> = {
  clients: { name: 200, company: 200, email: 254, phone: 80, notes: 10000 },
  tasks: { project_id: 'uuid', title: 300, description: 5000, status: ['pending','in_progress','completed'], priority: ['low','medium','high'] },
  'feed-entries': { project_id: 'uuid?', text: 2000, level: ['high','mid','low'], is_active: 'boolean', ...activityFields },
  'studio-logs': { project_id: 'uuid?', text: 2000, log_type: ['success','info','warning'], is_active: 'boolean', ...activityFields },
  services: { slug: 'slug', title: 200, description: 3000, title_en: 200, description_en: 3000, icon: SERVICE_ICONS, chat_message: 1000, cta_message: 1000, cta_message_en: 1000, highlighted: 'boolean', sort_order: 'integer', tagline: 1000, tagline_en: 1000, hero_description: 6000, hero_description_en: 6000, features: 'features', features_en: 'features', process: 'process', process_en: 'process' },
};
export const dashboardTables: Record<string, string> = { clients: 'clients', tasks: 'project_tasks', services: 'services', 'feed-entries': 'feed_entries', 'studio-logs': 'studio_logs' };
export function dashboardText(value: unknown, field: string, maximum: number, required = false): string {
  if (typeof value !== 'string' || value.length > maximum || /[\u0000\u0008\u000b\u000c]/u.test(value) || (required && !value.trim())) throw new DashboardInputError(`El campo ${field} debe contener texto válido de hasta ${maximum} caracteres.`);
  return value;
}
export function parseContentBlocks(value: unknown, field: string, process = false): Record<string,string>[] {
  if (!Array.isArray(value) || value.length > 20) throw new DashboardInputError(`${field} debe contener como máximo 20 elementos.`);
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some(k => !['title','description',...(process ? ['step'] : [])].includes(k))) throw new DashboardInputError(`Estructura de ${field} inválida.`);
    return { title: dashboardText(item.title, 'title', 200, true), description: dashboardText(item.description, 'description', 3000), ...(process ? { step: dashboardText(item.step, 'step', 50) } : {}) };
  });
}
export function parseDashboardFields(entity: string, body: Record<string, unknown>, create = false): Record<string, unknown> {
  const schema = schemas[entity]; if (!schema) throw new DashboardInputError('Entidad inválida.');
  const output: Record<string, unknown> = {};
  for (const [key,value] of Object.entries(body)) {
    const rule = schema[key]; if (rule === undefined) throw new DashboardInputError(`Campo no permitido: ${key}.`);
    if (typeof rule === 'number') output[key] = dashboardText(value, key, rule, key === 'name' || key === 'title' || key === 'text');
    else if (Array.isArray(rule)) { if (!rule.includes(value)) throw new DashboardInputError(`Valor de ${key} inválido.`); output[key] = value; }
    else if (rule === 'uuid' || rule === 'uuid?') { if (rule === 'uuid?' && value === null) output[key] = null; else { if (!dashboardId(value)) throw new DashboardInputError(`${key} debe ser UUID.`); output[key] = value; } }
    else if (rule === 'integer') { if (!Number.isInteger(value) || Math.abs(Number(value)) > 1000000) throw new DashboardInputError(`${key} debe ser entero.`); output[key] = value; }
    else if (rule === 'boolean') { if (typeof value !== 'boolean') throw new DashboardInputError(`${key} debe ser booleano.`); output[key] = value; }
    else if (rule === 'timestamp') {
      if (value === null) output[key] = null;
      else {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value || Date.parse(value) < Date.UTC(2000,0,1) || Date.parse(value) > Date.now()) throw new DashboardInputError('La fecha del evento debe ser una fecha real pasada, en formato ISO UTC.');
        output[key] = value;
      }
    }
    else if (rule === 'slug') { if (typeof value !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) || value.length > 120) throw new DashboardInputError('Slug inválido.'); output[key] = value; }
    else output[key] = parseContentBlocks(value,key,rule === 'process');
  }
  if (!Object.keys(output).length) throw new DashboardInputError('Indica al menos un campo que guardar.');
  if (create) {
    const required = entity === 'clients' ? ['name'] : entity === 'tasks' ? ['project_id','title'] : entity === 'services' ? ['title'] : ['text'];
    for (const key of required) if (!Object.hasOwn(output,key)) throw new DashboardInputError(`El campo ${key} es obligatorio.`);
    if (entity === 'services') {
      output.is_published = false;
      if (!output.slug) output.slug = String(output.title).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'').slice(0,120);
      if (!output.slug) throw new DashboardInputError('Indica un slug válido.');
    }
    if (entity === 'tasks' || entity === 'feed-entries' || entity === 'studio-logs') output.created_by = entity === 'tasks' ? 'admin' : undefined;
    if (entity === 'feed-entries' || entity === 'studio-logs') { delete output.created_by; output.source = 'admin'; output.is_published = false; output.public_revision = 0; }
  }
  return output;
}
export function parseCaseStudy(value: unknown): { brief: string; process: string; result: string; services: string[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['brief','process','result','services'].includes(k))) throw new DashboardInputError('Caso de estudio inválido.');
  const row = value as Record<string,unknown>; if (!Array.isArray(row.services) || row.services.length > 20) throw new DashboardInputError('services debe ser una lista de hasta 20 textos.');
  return { brief: dashboardText(row.brief,'brief',6000), process: dashboardText(row.process,'process',10000), result: dashboardText(row.result,'result',6000), services: row.services.map(item => dashboardText(item,'services',200)) };
}
