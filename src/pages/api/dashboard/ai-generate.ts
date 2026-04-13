import type { APIRoute } from 'astro';
import { validateDashboardSecret, dashResponse, dashError } from '../../../lib/dashboard';

export const POST: APIRoute = async ({ request }) => {
  if (!validateDashboardSecret(request)) return dashError('Unauthorized');

  const apiKey = import.meta.env.OPENROUTER_API_KEY;
  if (!apiKey) return dashError('OpenRouter API key not configured', 500);

  let body: {
    action?: string;
    project_title?: string;
    project_id?: string;
    description?: string;
    task_title?: string;
    task_status?: string;
    has_thumbnail?: boolean;
  };
  try { body = await request.json(); } catch { return dashError('Invalid JSON', 400); }

  const action = body.action || 'update';
  const projectTitle = body.project_title || 'Proyecto';
  const projectId = body.project_id || null;
  const description = body.description || '';
  const taskTitle = body.task_title || '';
  const taskStatus = body.task_status || '';
  const hasThumbnail = body.has_thumbnail ?? true;

  const SUPABASE_URL = import.meta.env.SUPABASE_URL;
  const SUPABASE_KEY = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  const sbHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_KEY!,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    Prefer: 'return=representation',
  };

  let prompt = '';

  if (action === 'generate_tasks') {
    prompt = `Eres el director de produccion de Akrasia Studio, una productora audiovisual que usa IA.
El admin quiere crear un proyecto: "${projectTitle}"${description ? `. Descripcion: "${description}"` : ''}

Genera TODAS las tareas necesarias para completar este proyecto, desde la conceptualizacion hasta la entrega.
Incluye SIEMPRE una tarea de "Creacion de thumbnail/imagen de portada" si no se ha subido thumbnail todavia.

Responde SOLO con JSON valido, sin markdown:
{
  "tasks": [
    {"title": "...", "description": "..."},
    {"title": "...", "description": "..."}
  ]
}

Genera entre 6 y 12 tareas realistas y ordenadas cronologicamente. Ejemplos de fases:
- Pre-produccion (concepto, guion, storyboard, referencia visual)
- Produccion (grabacion, captura, generacion IA)
- Post-produccion (edicion, color grading, VFX, diseno sonoro)
- Entrega (thumbnail, exportacion final, revision cliente)

Cada titulo debe ser conciso (3-6 palabras). La descripcion de 1 linea explicando que implica.`;
  } else if (action === 'task_completed') {
    prompt = `Eres el sistema de actividad de Akrasia Studio, una productora audiovisual que usa IA.
En el proyecto "${projectTitle}" se acaba de completar la tarea "${taskTitle}".
Genera entradas para el feed de actividad y logs del estudio que reflejen este avance.

Responde SOLO con JSON valido, sin markdown:
{
  "feed": [
    {"text": "...", "level": "high|mid|low"}
  ],
  "logs": [
    {"text": "...", "log_type": "success|info|warning"}
  ]
}

Genera 1-2 entradas de feed y 1 entrada de log. Textos cortos y tecnicos.
Si es una tarea importante (edicion, render, color grade), usa nivel "high".
Usa el nombre del proyecto "${projectTitle}" en los textos.`;
  } else {
    prompt = `Eres el sistema de logs de Akrasia Studio.
Accion realizada: "${action}" en proyecto "${projectTitle}".

Responde SOLO con JSON valido, sin markdown:
{
  "feed": [{"text": "...", "level": "high|mid|low"}],
  "logs": [{"text": "...", "log_type": "success|info|warning"}]
}

Genera 2 entradas de feed y 1 de log. Textos cortos y tecnicos.`;
  }

  try {
    const openaiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': 'https://akrasia.studio',
        'X-Title': 'Akrasia Studio Dashboard',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.0-flash-001',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 800,
        temperature: 0.7,
      }),
    });

    const aiData = await openaiRes.json();
    const content = aiData.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return dashError('AI response invalid', 500);

    const parsed = JSON.parse(jsonMatch[0]);

    if (action === 'generate_tasks' && parsed.tasks) {
      const createdTasks: unknown[] = [];
      for (const task of parsed.tasks) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/project_tasks`, {
          method: 'POST',
          headers: sbHeaders,
          body: JSON.stringify({
            project_id: projectId,
            title: task.title,
            description: task.description || '',
            status: 'pending',
            created_by: 'ai',
          }),
        });
        const data = await res.json();
        if (Array.isArray(data)) createdTasks.push(...data);
        else if (data) createdTasks.push(data);
      }
      return dashResponse({ tasks: createdTasks });
    }

    const createdFeed: unknown[] = [];
    const createdLogs: unknown[] = [];

    for (const entry of (parsed.feed || [])) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/feed_entries`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          project_id: projectId,
          text: entry.text,
          level: entry.level || 'mid',
          source: 'ai',
          is_active: true,
        }),
      });
      const data = await res.json();
      if (Array.isArray(data)) createdFeed.push(...data);
      else if (data) createdFeed.push(data);
    }

    for (const entry of (parsed.logs || [])) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/studio_logs`, {
        method: 'POST',
        headers: sbHeaders,
        body: JSON.stringify({
          project_id: projectId,
          text: entry.text,
          log_type: entry.log_type || 'info',
          source: 'ai',
          is_active: true,
        }),
      });
      const data = await res.json();
      if (Array.isArray(data)) createdLogs.push(...data);
      else if (data) createdLogs.push(data);
    }

    return dashResponse({ feed: createdFeed, logs: createdLogs });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'AI generation failed';
    return dashError(message, 500);
  }
};
