import type { APIRoute } from 'astro';
import { getPublicProjects, publicProjectResponse } from '../../lib/public-projects';

export const GET: APIRoute = async ({ request }) => {
  try {
    const projects = await getPublicProjects({ signal: request.signal });
    return publicProjectResponse([{ key: 'published_projects', value: projects.length, label: 'Proyectos publicados' }]);
  } catch { return publicProjectResponse({ error: 'portfolio_unavailable' }, 503); }
};
