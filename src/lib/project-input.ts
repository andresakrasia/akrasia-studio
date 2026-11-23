// Administrative input only. Public output is defined by the separate portfolio contract.
import { isProjectId, isProjectSlug } from './public-projects';
import { projectImagePath } from './public-media';
import { parseCaseStudy } from './dashboard-contract';

export class ProjectInputError extends Error {}

const STATUSES = new Set(['planning', 'in_production', 'post_production', 'completed', 'delivered']);
const TEXT_LIMITS: Record<string, number> = {
  title: 200, type: 120, client_name: 200, description: 10000,
  public_description: 6000, resolution: 80, aspect: 80, duration: 80, category: 120,
};
const EDIT_FIELDS = new Set([...Object.keys(TEXT_LIMITS), 'slug', 'client_id', 'status', 'thumbnail', 'thumbnail_url', 'video_url', 'sort_order', 'case_study', 'case_study_en']);

function objectBody(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProjectInputError('El cuerpo debe ser un objeto JSON.');
  return input as Record<string, unknown>;
}

export function validProjectId(input: unknown): input is string {
  return isProjectId(input);
}

function text(input: unknown, field: string, maximum: number, required = false) {
  if (input === null && !required) return null;
  if (typeof input !== 'string' || input.length > maximum || input.includes('\u0000')) {
    throw new ProjectInputError(`El campo ${field} debe ser texto de hasta ${maximum} caracteres.`);
  }
  if (required && !input.trim()) throw new ProjectInputError(`El campo ${field} es obligatorio.`);
  return input;
}

function mediaUrl(input: unknown, field: string) {
  const value = text(input, field, 2048);
  if (value === null || value === '') return value;
  if (/[\s\u0000-\u001f\u007f\\]/u.test(value)) throw new ProjectInputError(`El campo ${field} contiene caracteres no permitidos.`);
  if (field !== 'video_url' && value.startsWith('/api/project-media/') && !projectImagePath(value, undefined)) {
    throw new ProjectInputError('La ruta de miniatura no es válida.');
  }
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new ProjectInputError(`El campo ${field} debe ser una URL HTTPS o una ruta del sitio.`); }
}

function editFields(body: Record<string, unknown>) {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (!EDIT_FIELDS.has(key)) throw new ProjectInputError(`Campo no permitido: ${key}.`);
    if (Object.hasOwn(TEXT_LIMITS, key)) {
      if (key === 'public_description' && value === null) throw new ProjectInputError('public_description debe ser texto; usa una cadena vacía para quitarlo.');
      clean[key] = text(value, key, TEXT_LIMITS[key], key === 'title');
    }
    else if (key === 'case_study' || key === 'case_study_en') {
      try { clean[key] = parseCaseStudy(value); } catch { throw new ProjectInputError('El caso de estudio necesita brief, process, result y una lista de servicios, sin campos adicionales.'); }
    }
    else if (key === 'slug') {
      if (!isProjectSlug(value)) throw new ProjectInputError('El slug debe contener letras minúsculas, números y guiones, hasta 120 caracteres.');
      clean.slug = value;
    } else if (key === 'status') {
      if (typeof value !== 'string' || !STATUSES.has(value)) throw new ProjectInputError('Estado de producción inválido.');
      clean.status = value;
    } else if (key === 'client_id') {
      if (value !== '' && value !== null && !validProjectId(value)) throw new ProjectInputError('client_id debe ser un UUID o estar vacío.');
      clean.client_id = value === '' ? null : value;
    } else if (key === 'sort_order') {
      if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > 1000000) throw new ProjectInputError('sort_order debe ser un entero entre -1000000 y 1000000.');
      clean.sort_order = value;
    } else {
      const target = key === 'thumbnail_url' ? 'thumbnail' : key;
      const url = mediaUrl(value, key);
      if (Object.hasOwn(clean, target) && clean[target] !== url) throw new ProjectInputError('Las URLs de miniatura no coinciden.');
      clean[target] = url;
    }
  }
  return clean;
}

export function parseProjectCreate(input: unknown): Record<string, unknown> {
  const body = { ...objectBody(input) };
  if (Object.hasOwn(body, 'is_published')) {
    if (body.is_published !== false) throw new ProjectInputError('Un proyecto nuevo debe crearse sin publicar.');
    delete body.is_published;
  }
  const clean = editFields(body);
  const title = text(clean.title, 'title', TEXT_LIMITS.title, true) as string;
  if (!clean.slug) {
    clean.slug = title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 120).replace(/-$/, '');
    if (!clean.slug) throw new ProjectInputError('El título necesita letras o números para generar su slug.');
  }
  // Never infer publication from production state, or copy internal descriptions.
  clean.is_published = false;
  return clean;
}

export function parseProjectPatch(input: unknown): { id: string; fields: Record<string, unknown>; publication?: boolean } {
  const body = { ...objectBody(input) };
  if (!validProjectId(body.id)) throw new ProjectInputError('id debe ser un UUID.');
  const id = body.id.toLowerCase();
  delete body.id;
  if (Object.hasOwn(body, 'is_published')) {
    if (typeof body.is_published !== 'boolean') throw new ProjectInputError('is_published debe ser un booleano.');
    if (Object.keys(body).length !== 1) throw new ProjectInputError('La aprobación de publicación debe guardarse por separado de la edición.');
    return { id, fields: { is_published: body.is_published }, publication: body.is_published };
  }
  if (!Object.keys(body).length) throw new ProjectInputError('Indica al menos un campo que editar.');
  return { id, fields: editFields(body) };
}
