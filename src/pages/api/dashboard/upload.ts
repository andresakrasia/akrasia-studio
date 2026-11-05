import type { APIRoute } from 'astro';
import { validateDashboardSession } from '../../../lib/dashboard';
import { ProjectUploadError, saveProjectUpload } from '../../../lib/project-upload';

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store',
    'CDN-Cache-Control': 'no-store', 'Vercel-CDN-Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  } });
}

export const POST: APIRoute = async ({ request }) => {
  // Middleware marks only persistent sessions whose origin and CSRF passed.
  // Authorization precedes body reads and every image/storage operation.
  if (!validateDashboardSession(request)) return response({ error: 'Authentication required' }, 401);
  const supabaseUrl = import.meta.env.SUPABASE_URL;
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return response({ error: 'La carga de imágenes no está disponible.' }, 503);
  try {
    const url = await saveProjectUpload(request, { supabaseUrl, serviceKey });
    return response({ url });
  } catch (error) {
    if (error instanceof ProjectUploadError) return response({ error: error.message }, error.status);
    return response({ error: 'No se ha podido guardar la imagen. Inténtalo de nuevo.' }, 503);
  }
};
