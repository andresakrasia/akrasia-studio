import type { APIRoute } from 'astro';
import { loadPublicActivity, publicActivityResponse } from '../../lib/public-activity';
export const GET: APIRoute = async ({ request }) => {
  if (new URL(request.url).search) return publicActivityResponse({ error: 'invalid_request' }, 400);
  try { return publicActivityResponse(await loadPublicActivity('logs', { signal: request.signal })); }
  catch { return publicActivityResponse({ error: 'activity_unavailable' }, 503); }
};
