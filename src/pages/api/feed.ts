import type { APIRoute } from 'astro';

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

export const GET: APIRoute = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
  }
  const url = `${SUPABASE_URL}/rest/v1/feed_entries?is_active=eq.true&order=created_at.desc&limit=20&select=id,text,level,created_at,project_id`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  const entries = res.ok ? await res.json() : [];

  const projectIds = [...new Set(entries.map((e: any) => e.project_id).filter(Boolean))];
  const projectMap: Record<string, string> = {};
  if (projectIds.length > 0) {
    const projectsRes = await fetch(
      `${SUPABASE_URL}/rest/v1/projects?id=in.(${projectIds.join(',')})&select=id,title`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (projectsRes.ok) {
      const projects = await projectsRes.json();
      for (const p of projects) projectMap[p.id] = p.title;
    }
  }

  const result = entries.map((e: any) => ({
    ...e,
    project_title: e.project_id ? projectMap[e.project_id] || null : null,
  }));

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
  });
};
