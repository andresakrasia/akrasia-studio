import type { LeadConversationContext } from './lead-conversation-context';

export const EMAIL_TEMPLATES = [
  { value: 'evaluation', label: 'Recepción y evaluación' },
  { value: 'quote', label: 'Presentación del presupuesto' },
  { value: 'follow_up', label: 'Seguimiento de la propuesta' },
  { value: 'kickoff', label: 'Preparación del proyecto' },
  { value: 'progress', label: 'Avances de producción' },
  { value: 'delivery', label: 'Entrega para revisión' },
  { value: 'final_delivery', label: 'Entrega final' },
  { value: 'closure', label: 'Cierre del proyecto' },
  { value: 'custom', label: 'Mensaje libre' },
] as const;

export type EmailTemplateType = typeof EMAIL_TEMPLATES[number]['value'];
export interface EmailDraftContext {
  leadId?: string;
  visitorId?: string;
  clientId?: string;
  projectId?: string;
  journeyId?: string;
  to?: string;
  toName?: string;
  projectTitle?: string;
  brief?: string;
  budgetAmount?: number | null;
  budgetCurrency?: string;
  budgetScope?: string;
  budgetTiming?: string;
  conversationContext?: LeadConversationContext;
  requestedTiming?: string;
  templateType?: EmailTemplateType;
}
export interface EmailDraftRecord {
  id: string;
  revision: number;
  to_email: string;
  to_name: string | null;
  subject: string;
  body_text: string;
  template_type: EmailTemplateType;
  status: 'draft' | 'queued';
  journey_id?: string | null;
  lead_id?: string | null;
  client_id?: string | null;
  project_id?: string | null;
  queue_id?: string | null;
  provider_status?: string | null;
  created_at?: string;
  updated_at?: string;
}
export interface EmailWritingFields { to_email: string; to_name: string; subject: string; body_text: string; template_type: EmailTemplateType; }
export interface EmailWritingResult { subject: string; body: string; }

const line = (value: string | undefined, max = 150) => (value || '').replace(/[\r\n\u0000]/g, ' ').trim().slice(0, max);
const normalizedPlaceholder = (value: string | null | undefined) => (value || '').trim().replace(/\s+/g, ' ').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export function isPlaceholderClientName(value: string | null | undefined, email?: string | null): boolean {
  const name = normalizedPlaceholder(value);
  return !name || name.includes('@') || (!!email && name === normalizedPlaceholder(email)) ||
    /^(?:cliente(?: nuevo| interesado)?|sin nombre|unknown|anonimo|anonymous|lead)$/.test(name);
}

export function isPlaceholderProjectTitle(value: string | null | undefined): boolean {
  const title = normalizedPlaceholder(value);
  return !title || title === 'proyecto' || title === 'propuesta de proyecto' ||
    (/^(?:proyecto|propuesta)(?:\s|[·:–—-]|$)/.test(title) && title.includes('@'));
}

function isPlaceholderProjectBrief(value: string | undefined): boolean {
  const brief = normalizedPlaceholder(value);
  return !brief || /^(?:\{\{(?:brief|resumen)\}\}|pendiente|por definir|sin definir|sin (?:brief|resumen)|(?:brief|resumen) pendiente|unknown)$/.test(brief) ||
    /(?:synthetic administrator password|\b(?:password|contrasena|api[_ -]?key|secret[_ -]?key)\s*[:=]|\bbearer\s+[a-z0-9._-]{12,}|\[dato sensible omitido\])/i.test(brief);
}

export function checkedLeadConversationContext(data: unknown, leadId: string): LeadConversationContext {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('No se pudo cargar el contexto de la conversación.');
  const value = data as Record<string, unknown>;
  const stringFields = ['visitorId', 'clientName', 'company', 'email', 'phone', 'projectTitle', 'brief', 'requestedTiming'] as const;
  if (!leadId || value.leadId !== leadId || stringFields.some(key => typeof value[key] !== 'string') || !value.visitorId ||
    (value.conversationId !== null && (typeof value.conversationId !== 'string' || !value.conversationId)) ||
    typeof value.source !== 'string' || !['linked', 'visitor_latest', 'none'].includes(value.source) ||
    typeof value.totalMessages !== 'number' || !Number.isSafeInteger(value.totalMessages) || value.totalMessages < 0 ||
    typeof value.truncated !== 'boolean' || !Array.isArray(value.messages) || value.messages.length > value.totalMessages ||
    value.messages.some(message => !message || typeof message !== 'object' || Array.isArray(message) ||
      !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string' || typeof message.created_at !== 'string')) {
    throw new Error('No se pudo cargar el contexto de la conversación.');
  }
  return value as unknown as LeadConversationContext;
}

export function conversationWritingContext(incoming: EmailDraftContext, canonical: LeadConversationContext): EmailDraftContext {
  const title = normalizedPlaceholder(incoming.projectTitle);
  const automaticRecipientTitle = [incoming.toName, incoming.to].some(value => {
    const recipient = normalizedPlaceholder(value);
    return !!recipient && (title === `proyecto de ${recipient}` || title === `proyecto · ${recipient}`);
  });
  return {
    ...incoming,
    leadId: canonical.leadId,
    visitorId: canonical.visitorId,
    to: incoming.to?.trim() || canonical.email,
    toName: isPlaceholderClientName(incoming.toName, incoming.to) ? canonical.clientName : incoming.toName,
    projectTitle: isPlaceholderProjectTitle(incoming.projectTitle) || automaticRecipientTitle ? canonical.projectTitle : incoming.projectTitle,
    brief: isPlaceholderProjectBrief(incoming.brief) ? canonical.brief : incoming.brief,
    conversationContext: canonical,
    requestedTiming: canonical.requestedTiming,
  };
}

export function isEmailTemplateType(value: unknown): value is EmailTemplateType {
  return EMAIL_TEMPLATES.some(template => template.value === value);
}
export function createClientEmailDraft(type: EmailTemplateType, context: EmailDraftContext = {}): EmailWritingResult {
  const recipient = isPlaceholderClientName(context.toName, context.to) ? '' : line(context.toName);
  const greeting = recipient ? `Hola, ${recipient}:` : 'Hola:';
  const title = line(context.projectTitle, 120);
  const project = title ? `«${title}»` : 'tu proyecto';
  const signature = 'Un saludo,\nEl equipo de Akrasia Studio';
  let subject: string;
  let paragraphs: string[];
  switch (type) {
    case 'evaluation':
      subject = title ? `Estamos revisando tu propuesta: ${title}` : 'Estamos revisando tu propuesta';
      paragraphs = [
        `Gracias por compartir ${project} con nosotros. Hemos recibido tu propuesta y el equipo está revisando el alcance y las necesidades del proyecto.`,
        'Con esa información prepararemos el presupuesto. Si necesitamos aclarar algún detalle, te escribiremos por aquí. Mientras tanto, puedes responder a este correo si quieres añadir algo a la propuesta.',
      ];
      break;
    case 'quote': {
      subject = title ? `Presupuesto para ${title}` : 'Presupuesto para tu proyecto';
      const amount = typeof context.budgetAmount === 'number' && Number.isFinite(context.budgetAmount) && context.budgetAmount >= 0 && /^[A-Z]{3}$/.test(context.budgetCurrency || '')
        ? `${new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(context.budgetAmount)} ${context.budgetCurrency}` : '{{importe_y_moneda}}';
      paragraphs = [
        `Te compartimos nuestra propuesta para ${project}. Estos son los detalles del presupuesto:`,
        `Alcance: ${context.budgetScope?.trim() || '{{alcance}}'}\nImporte: ${amount}\nPlazos y condiciones: ${context.budgetTiming?.trim() || '{{plazos_y_condiciones}}'}`,
        'Si quieres ajustar algún punto o tienes dudas, responde a este correo y lo revisamos contigo. Para seguir adelante, necesitamos que nos confirmes tu aceptación de la propuesta.',
      ];
      break;
    }
    case 'follow_up':
      subject = title ? `Seguimiento de ${title}` : 'Seguimiento de tu propuesta';
      paragraphs = [`Te escribo para retomar la propuesta de ${project}.`, 'Si necesitas aclarar el alcance o ajustar alguna parte, cuéntanos y lo revisamos contigo. También nos viene bien saber si el proyecto sigue adelante o si prefieres dejarlo para más adelante.'];
      break;
    case 'kickoff':
      subject = title ? `Preparación de ${title}` : 'Preparación de tu proyecto';
      paragraphs = [`Para organizar el trabajo de ${project}, necesitamos concretar los próximos pasos:`, '{{proximos_pasos_y_materiales}}', 'Puedes responder a este correo con la información disponible y las dudas que quieras comentar. Con ello coordinaremos el arranque del proyecto.'];
      break;
    case 'delivery':
      subject = title ? `${title}: material para revisión` : 'Material de tu proyecto para revisión';
      paragraphs = [`Aquí tienes el material de ${project} para que puedas revisarlo:`, '{{enlace_y_material_entregado}}', 'Cuando lo hayas revisado, envíanos tus comentarios por este mismo correo. Si hay algún punto que quieras comentar con más detalle, lo vemos juntos.'];
      break;
    case 'progress':
      subject = title ? `Avances de ${title}` : 'Avances de tu proyecto';
      paragraphs = [`Te compartimos cómo avanza el trabajo de ${project}:`, '{{avances_confirmados_y_proximos_pasos}}', 'Si tienes alguna pregunta o necesitas aclarar algo, puedes responder a este correo y lo vemos contigo.'];
      break;
    case 'final_delivery':
      subject = title ? `Entrega final de ${title}` : 'Entrega final de tu proyecto';
      paragraphs = [`Te compartimos los materiales finales de ${project}:`, '{{enlace_y_material_final}}', 'Confírmanos cuando hayas podido acceder a los archivos. Si surge alguna duda con la entrega, escríbenos por aquí y te ayudamos.'];
      break;
    case 'closure':
      subject = title ? `Cierre de ${title}` : 'Cierre de tu proyecto';
      paragraphs = [`Gracias por confiar en nosotros para ${project}. Dejamos el proyecto cerrado con los acuerdos y materiales de la entrega guardados en su ficha.`, 'Ha sido un placer trabajar contigo. Si más adelante necesitas adaptar la pieza o preparar algo nuevo, puedes escribirnos por aquí.'];
      break;
    default:
      subject = title ? `Sobre ${title}` : '';
      paragraphs = ['{{mensaje}}'];
  }
  return { subject: subject.slice(0, 200), body: [greeting, ...paragraphs, signature].join('\n\n') };
}

export function unresolvedEmailFields(subject: string, body: string): string[] {
  const matches = `${subject}\n${body}`.match(/\{\{[^{}]*\}\}|\[[^\]\r\n]{1,100}\]/g) || [];
  return [...new Set(matches)];
}
export function emailDraftSendIssue(fields: EmailWritingFields): string | null {
  if (fields.to_email.length > 254 || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(fields.to_email)) return 'Indica un email válido para el destinatario.';
  if (!fields.subject.trim() || fields.subject.length > 200 || /[\r\n\u0000]/.test(fields.subject)) return 'Completa un asunto válido.';
  if (!fields.body_text.trim() || fields.body_text.length > 10000) return 'Completa el mensaje del correo.';
  if (unresolvedEmailFields(fields.subject, fields.body_text).length) return 'Completa los campos pendientes del texto antes de enviar.';
  return null;
}
export function emailDraftStateLabel(row: Pick<EmailDraftRecord, 'status' | 'provider_status'>): string {
  if (row.status === 'draft') return 'Borrador';
  switch (row.provider_status) {
    case 'accepted': return 'Aceptado por el proveedor';
    case 'sending': return 'En proceso de envío';
    case 'failed': return 'Envío fallido';
    case 'uncertain': return 'Estado de envío por confirmar';
    case 'disabled': return 'Envío sin configurar';
    default: return 'En cola de envío';
  }
}
