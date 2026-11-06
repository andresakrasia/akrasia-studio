import { dashboardRoute, dashboardJson, dashResponse, DashboardInputError, requireDashboardId, sbQuery, sbInsert, sbPatch, sbDelete, oneDashboardRow } from '../../../lib/dashboard';
import { isCivilDate, isCivilTime } from '../../../lib/civil-time';

type ScheduleKind = 'recurring' | 'override';
function scheduleKind(body: Record<string, unknown>): ScheduleKind {
  if (body.kind === undefined || body.kind === 'recurring') return 'recurring';
  if (body.kind === 'override') return 'override';
  throw new DashboardInputError('El tipo de horario debe ser recurrente o para una fecha concreta.');
}
const tableFor = (kind: ScheduleKind) => kind === 'recurring' ? 'availability' : 'availability_overrides';
const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const containsCall = (start: string, end: string) => Math.ceil(minute(start) / 30) * 30 + 30 <= minute(end);
function scheduleFields(body: Record<string, unknown>, kind: ScheduleKind, patch = false): Record<string, unknown> {
  const allowed = kind === 'recurring' ? ['day_of_week', 'start_time', 'end_time', 'is_active'] : ['override_date', 'start_time', 'end_time', 'is_available', 'note'];
  if (Object.keys(body).some(key => !['kind', ...(patch ? ['id'] : []), ...allowed].includes(key))) throw new DashboardInputError('El horario contiene campos no permitidos.');
  if (kind === 'recurring') {
    if (!Number.isInteger(body.day_of_week) || Number(body.day_of_week) < 0 || Number(body.day_of_week) > 6 || !isCivilTime(body.start_time) || !isCivilTime(body.end_time) || body.end_time <= body.start_time) throw new DashboardInputError('Horario inválido: día 0–6 y horas HH:MM crecientes.');
    if (minute(body.end_time) - minute(body.start_time) < 30) throw new DashboardInputError('Abre al menos 30 minutos para que quepa una videollamada.');
    if (!containsCall(body.start_time, body.end_time)) throw new DashboardInputError('El horario debe incluir una videollamada de 30 minutos con inicio a en punto o a y media.');
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') throw new DashboardInputError('La disponibilidad del horario debe ser verdadera o falsa.');
    return { day_of_week: body.day_of_week, start_time: body.start_time, end_time: body.end_time, ...(body.is_active === undefined ? patch ? {} : { is_active: true } : { is_active: body.is_active }) };
  }
  if (!isCivilDate(body.override_date) || typeof body.is_available !== 'boolean') throw new DashboardInputError('Indica una fecha válida y si quieres abrir o bloquear el horario.');
  const allDay = body.start_time === null && body.end_time === null;
  if (!allDay && (!isCivilTime(body.start_time) || !isCivilTime(body.end_time) || body.end_time <= body.start_time)) throw new DashboardInputError('Indica horas HH:MM crecientes o ambas horas vacías para el día completo.');
  if (!allDay && body.is_available && minute(body.end_time as string) - minute(body.start_time as string) < 30) throw new DashboardInputError('Abre al menos 30 minutos para que quepa una videollamada.');
  if (!allDay && body.is_available && !containsCall(body.start_time as string, body.end_time as string)) throw new DashboardInputError('El horario debe incluir una videollamada de 30 minutos con inicio a en punto o a y media.');
  if (body.note !== undefined && body.note !== null && (typeof body.note !== 'string' || body.note.length > 500 || body.note.includes('\u0000'))) throw new DashboardInputError('La nota debe ser un texto de hasta 500 caracteres.');
  return { override_date: body.override_date, start_time: body.start_time, end_time: body.end_time, is_available: body.is_available,
    ...(body.note === undefined ? patch ? {} : { note: null } : { note: typeof body.note === 'string' ? body.note.trim() || null : null }) };
}
const clock = (value: unknown) => typeof value === 'string' ? value.slice(0, 5) : value;
async function rejectDuplicate(kind: ScheduleKind, fields: Record<string, unknown>, id?: string) {
  // Overlapping windows form a union; blocks intentionally override openings.
  // This preflight only catches accidental identical entries, not those rules.
  if (kind === 'recurring' && fields.is_active === false) return;
  const query = kind === 'recurring' ? `day_of_week=eq.${fields.day_of_week}` : `override_date=eq.${fields.override_date}`;
  const rows = await sbQuery(tableFor(kind), query);
  if (rows.some(row => row.id !== id && clock(row.start_time) === fields.start_time && clock(row.end_time) === fields.end_time &&
    (kind === 'recurring' ? row.is_active !== false : row.is_available === fields.is_available))) throw new DashboardInputError('Ese horario ya está configurado. Edita el existente.');
}

export const GET = dashboardRoute(async ({ request }) => {
  const params = new URL(request.url).searchParams;
  let query = 'order=override_date.desc&limit=100';
  if (params.has('from') || params.has('to')) {
    const from = params.get('from'), to = params.get('to');
    if (params.getAll('from').length !== 1 || params.getAll('to').length !== 1 || !isCivilDate(from) || !isCivilDate(to) || to < from || Date.parse(to) - Date.parse(from) > 366 * 86400000) throw new DashboardInputError('Indica un intervalo válido de fechas de hasta un año.');
    query = `override_date=gte.${from}&override_date=lte.${to}&order=override_date,start_time,id`;
  }
  const [availability, overrides] = await Promise.all([
    sbQuery('availability', 'order=day_of_week,start_time,id'),
    sbQuery('availability_overrides', query),
  ]);
  return dashResponse({ availability, overrides });
});
export const POST = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request, 4096), kind = scheduleKind(body), fields = scheduleFields(body, kind);
  await rejectDuplicate(kind, fields);
  const rows = await sbInsert(tableFor(kind), fields);
  return dashResponse([oneDashboardRow(rows)]);
});
export const PATCH = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request, 4096), kind = scheduleKind(body), id = requireDashboardId(body.id), fields = scheduleFields(body, kind, true);
  const current = oneDashboardRow(await sbQuery(tableFor(kind), `id=eq.${id}`), id);
  await rejectDuplicate(kind, { ...current, ...fields }, id);
  const rows = await sbPatch(tableFor(kind), `id=eq.${id}`, fields);
  return dashResponse([oneDashboardRow(rows, id)]);
});
export const DELETE = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request, 1024), kind = scheduleKind(body), id = requireDashboardId(body.id);
  if (Object.keys(body).some(key => !['id', 'kind'].includes(key))) throw new DashboardInputError('La solicitud contiene campos no permitidos.');
  await sbDelete(tableFor(kind), `id=eq.${id}`);
  return dashResponse({ deleted: true });
});
