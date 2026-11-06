import type { APIRoute } from 'astro';
import { loadPublicServices, publicContentResponse } from '../../lib/public-content';
import { isProjectSlug } from '../../lib/public-projects';
export const GET: APIRoute = async ({ request }) => {
  const params = new URL(request.url).searchParams;
  if (Array.from(params.keys()).some(k => k !== 'slug') || params.getAll('slug').length > 1 || (params.has('slug') && !isProjectSlug(params.get('slug')))) return publicContentResponse({ error:'Solicitud inválida.' },400);
  try { const services = await loadPublicServices({ slug:params.get('slug') ?? undefined, signal:request.signal }); return publicContentResponse({ services },params.has('slug') && !services.length ? 404 : 200); }
  catch { return publicContentResponse({ error:'Servicios temporalmente no disponibles.' },503); }
};
