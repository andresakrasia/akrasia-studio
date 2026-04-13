import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashError } from '../../../lib/dashboard';

export const POST: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  const SUPABASE_URL = import.meta.env.SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SUPABASE_KEY) return dashError('Supabase not configured', 500);

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) return dashError('No file provided', 400);

  const fileName = `thumb-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.-]/g, '')}`;
  const arrayBuffer = await file.arrayBuffer();

  const uploadRes = await fetch(`${SUPABASE_URL}/storage/v1/object/project-thumbnails/${fileName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': file.type || 'image/jpeg',
    },
    body: arrayBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    return dashError(`Upload failed: ${err}`, 500);
  }

  const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/project-thumbnails/${fileName}`;
  return new Response(JSON.stringify({ url: publicUrl }), {
    headers: { 'Content-Type': 'application/json' },
  });
};
