import OpenAI from 'openai';
import { dashboardRoute, dashboardJson, dashResponse, dashError, DashboardInputError, requireDashboardId } from '../../../lib/dashboard';
import { loadLeadConversationContext } from '../../../lib/lead-conversation-context';
import { formatLeadBrief, LEAD_BRIEF_RESPONSE_FORMAT, LEAD_BRIEF_SYSTEM_PROMPT, missingLeadBriefFields, parseLeadBrief } from '../../../lib/lead-brief';

// Generates an editable draft only: nothing is stored here. The team reviews the
// text in the panel and saves it through the usual journey creation.
export const POST = dashboardRoute(async ({ request }) => {
  const body = await dashboardJson(request, 4096);
  if (Object.keys(body).some(key => key !== 'lead_id')) throw new DashboardInputError('Indica únicamente el lead.');
  const leadId = requireDashboardId(body.lead_id);
  // The transcript is selected and verified in storage from the lead ID alone.
  const conversation = await loadLeadConversationContext(leadId, request.signal);
  if (!conversation.messages.some(message => message.role === 'user' && message.content.trim() && !message.content.includes('[Dato sensible omitido]'))) {
    return dashError('Este lead no tiene mensajes del cliente con los que ordenar un brief.', 400);
  }
  const apiKey = import.meta.env.OPENROUTER_API_KEY;
  if (!apiKey) return dashError('IA no disponible.', 503);
  const openai = new OpenAI({ apiKey, baseURL: 'https://openrouter.ai/api/v1', maxRetries: 0, timeout: 20000 });
  const data = { truncated: conversation.truncated, messages: conversation.messages.map(({ role, content }) => ({ role, content })) };
  const completion = await openai.chat.completions.create({ model: 'google/gemini-2.5-flash', max_tokens: 2000, temperature: 0.2,
    response_format: LEAD_BRIEF_RESPONSE_FORMAT, ...{ provider: { require_parameters: true } },
    messages: [{ role: 'system', content: LEAD_BRIEF_SYSTEM_PROMPT }, { role: 'user', content: JSON.stringify(data) }] },
  { signal: AbortSignal.any([request.signal, AbortSignal.timeout(20000)]) });
  const choice = completion.choices[0];
  if (choice?.finish_reason !== 'stop') return dashError('La IA no completó el brief. El resumen actual sigue disponible.', 502);
  const brief = parseLeadBrief(choice.message?.content);
  if (!brief) return dashError('La IA no devolvió un brief válido. El resumen actual sigue disponible.', 502);
  return dashResponse({ fields: brief, missing: missingLeadBriefFields(brief), text: formatLeadBrief(brief, conversation.requestedTiming) });
});
