import type { APIRoute } from 'astro';

const SUPABASE_URL = import.meta.env.SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

async function publicQuery(table: string, query: string) {
  const url = `${SUPABASE_URL}/rest/v1/${table}?${query}`;
  const res = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY!,
      Authorization: `Bearer ${SUPABASE_KEY}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
}

export const GET: APIRoute = async () => {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });
  }

  const projects = await publicQuery('projects', 'order=sort_order.asc&select=*');
  if (!projects) return new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } });

  const projectIds = projects.map((p: { id: string }) => p.id);
  let tasks: any[] = [];
  if (projectIds.length > 0) {
    tasks = await publicQuery('project_tasks', `project_id=in.(${projectIds.join(',')})&select=id,project_id,status`) || [];
  }

  const tasksByProject: Record<string, { total: number; completed: number }> = {};
  for (const t of tasks) {
    if (!tasksByProject[t.project_id]) tasksByProject[t.project_id] = { total: 0, completed: 0 };
    tasksByProject[t.project_id].total++;
    if (t.status === 'completed') tasksByProject[t.project_id].completed++;
  }

  const result = projects.map((p: { id: string }) => ({
    ...p,
    task_progress: tasksByProject[p.id] || { total: 0, completed: 0 },
  }));

  return new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=30' },
  });
};
