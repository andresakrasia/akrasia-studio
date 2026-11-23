import type { APIRoute } from 'astro';
import { getPublicProjects, isProjectId, isProjectSlug, publicProjectResponse } from '../../lib/public-projects';

export const GET: APIRoute = async ({ request }) => {
  const query = new URL(request.url).searchParams;
  if ([...query.keys()].some(key => !['id', 'slug'].includes(key)) ||
      ['id', 'slug'].some(key => query.getAll(key).length > 1) ||
      (query.has('id') && !isProjectId(query.get('id'))) ||
      (query.has('slug') && !isProjectSlug(query.get('slug')))) {
    return publicProjectResponse({ error: 'invalid_project_query' }, 400);
  }
  try {
    const projects = await getPublicProjects({ id: query.get('id') ?? undefined, slug: query.get('slug') ?? undefined, signal: request.signal });
    if ((query.has('id') || query.has('slug')) && !projects.length) return publicProjectResponse({ error: 'project_not_found' }, 404);
    return publicProjectResponse(projects);
  } catch { return publicProjectResponse({ error: 'portfolio_unavailable' }, 503); }
};
