import { dashboardRoute, dashResponse, DashboardInputError, requireDashboardId } from '../../../lib/dashboard';
import { loadLeadConversationContext } from '../../../lib/lead-conversation-context';

export const GET = dashboardRoute(async ({ request }) => {
  const parameters = new URL(request.url).searchParams;
  if ([...parameters.keys()].some(key => key !== 'lead_id') || parameters.getAll('lead_id').length !== 1) throw new DashboardInputError('Indica un único lead para recuperar su conversación.');
  const id = requireDashboardId(parameters.get('lead_id'));
  return dashResponse(await loadLeadConversationContext(id, request.signal));
});
