import { dashboardRoute, dashboardJson, dashResponse, sbQuery, sbPatch, oneDashboardRow, DashboardInputError, DashboardStorageError } from '../../../lib/dashboard';
export const GET = dashboardRoute(async () => dashResponse(await sbQuery('studio_stats','order=key.asc')));
export const PATCH = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request);
  if (typeof body.key !== 'string' || !/^[a-z0-9_]{1,80}$/.test(body.key) || Object.keys(body).some(k => !['key','value','label'].includes(k))) throw new DashboardInputError('Clave inválida.');
  const clean: Record<string,unknown> = { updated_at: new Date().toISOString() };
  if (body.value !== undefined) { if (!Number.isInteger(body.value) || Number(body.value) < 0 || Number(body.value) > 1000000) throw new DashboardInputError('Valor inválido.'); clean.value = body.value; }
  if (body.label !== undefined) { if (typeof body.label !== 'string' || !body.label.trim() || body.label.length > 200) throw new DashboardInputError('Etiqueta inválida.'); clean.label = body.label; }
  if (Object.keys(clean).length === 1) throw new DashboardInputError('Indica al menos un valor.');
  const saved=oneDashboardRow(await sbPatch('studio_stats',`key=eq.${body.key}`,clean));
  if(saved.key!==body.key)throw new DashboardStorageError();
  return dashResponse(saved);
});
