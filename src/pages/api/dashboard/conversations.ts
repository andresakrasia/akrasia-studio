import { dashboardRoute, dashboardList, dashResponse, sbRequest, dashboardRows, requireDashboardId, DashboardInputError, DashboardStorageError } from '../../../lib/dashboard';
export const GET = dashboardRoute(async ({ request }) => {
  const params = new URL(request.url).searchParams; const visitor = params.get('visitor_id');
  if (visitor && !/^[a-zA-Z0-9_-]{1,128}$/.test(visitor)) throw new DashboardInputError('Visitante inválido.');
  const conversationId = params.get('conversation_id');
  let query = 'select=id,visitor_id,created_at,updated_at,message_count&order=created_at.desc,id.desc';
  if (visitor) query += `&visitor_id=eq.${visitor}`;
  if (conversationId) query += `&id=eq.${requireDashboardId(conversationId)}`;
  const response = await dashboardList('conversations',query,request);
  const conversations = dashboardRows(await response.json());
  const offsetText = params.get('messages_offset') ?? '0';
  if (!/^\d{1,8}$/.test(offsetText)) throw new DashboardInputError('Paginación de mensajes inválida.');
  const offset = Number(offsetText); if (offset && !conversationId) throw new DashboardInputError('Indica una conversación para paginar mensajes.');
  const enriched = [];
  for (const conversation of conversations) {
    const result = await sbRequest(`messages?select=id,conversation_id,role,content,created_at&conversation_id=eq.${conversation.id}&order=created_at.desc,role.asc,id.desc&limit=100&offset=${offset}`,'GET',undefined,'count=exact');
    const messages = dashboardRows(result.data); const count = Number(result.headers.get('content-range')?.split('/')[1]);
    if (!Number.isSafeInteger(count) || count < messages.length) throw new DashboardStorageError();
    enriched.push({ ...conversation, message_count:count,messages:messages.reverse(),messages_next_offset:offset + messages.length < count ? offset + messages.length : null });
  }
  return dashResponse(enriched,200,Object.fromEntries(response.headers));
});
