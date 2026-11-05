import { createHash } from 'node:crypto';
import { integrationRpc } from './integration-store';
import { sendEmail, generateEmailHtml, emailDeliveryPayload, type EmailPayload } from './email';
import { sendTelegramText } from './notify';
import { formatCivilDateES, isCivilDate, isCivilTime } from './civil-time';
import { isVisitorUuid } from './visitor-data';
import { ChatFailure } from './chat-security';
import { buildBookingEmail, type EmailTemplateType } from './email-templates';
import { bookingCalendar, safeMeetingUrl } from './booking-calendar';
import { buildBookingAdminEmail, BookingAdminEmailConfigurationError } from './booking-admin-email';
export interface IntegrationInput { idempotencyKey: string; channel: 'email' | 'telegram'; payload: EmailPayload | { text: string }; visitorId?: string | null; contextVersion?: number | null }
export interface QueuedIntegration { id: string; status: 'queued' | 'sending' | 'accepted' | 'failed' | 'uncertain' | 'disabled' }
const statuses = ['queued', 'sending', 'accepted', 'failed', 'uncertain', 'disabled'];
export function validEmail(value: unknown): value is string { return typeof value === 'string' && value.length <= 254 && /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value); }
function checkedPayload(channel: 'email' | 'telegram', value: unknown): EmailPayload | { text: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ChatFailure('invalid_request', 400);
  const p = value as Record<string, unknown>;
  if (channel === 'telegram') { if (Object.keys(p).length !== 1 || typeof p.text !== 'string' || !p.text || p.text.length > 3500) throw new ChatFailure('invalid_request', 400); return { text: p.text }; }
  if (!validEmail(p.to) || typeof p.subject !== 'string' || !p.subject.trim() || p.subject.length > 200 || /[\r\n\u0000]/.test(p.subject) ||
    typeof p.bodyText !== 'string' || !p.bodyText.trim() || p.bodyText.length > 10000 || (p.toName !== undefined && (typeof p.toName !== 'string' || p.toName.length > 150))) throw new ChatFailure('invalid_request', 400);
  // HTML always derives from escaped text, never from a client-supplied rich body.
  const ordinaryTypes = ['evaluation','quote','follow_up','kickoff','progress','delivery','final_delivery','closure','custom'];
  if (p.templateType !== undefined && !ordinaryTypes.includes(String(p.templateType))) throw new ChatFailure('invalid_request', 400);
  const templateType = (p.templateType || 'custom') as EmailTemplateType;
  return { to: p.to, ...(p.toName ? { toName: p.toName as string } : {}), subject: p.subject, bodyText: p.bodyText, templateType,
    bodyHtml: generateEmailHtml(p.bodyText, { subject: p.subject, templateType }) };
}
export async function enqueueIntegration(input: IntegrationInput, signal?: AbortSignal): Promise<QueuedIntegration> {
  if (!input || !['email', 'telegram'].includes(input.channel) || !/^[A-Za-z0-9:._-]{1,200}$/.test(input.idempotencyKey) ||
    (input.visitorId != null && !isVisitorUuid(input.visitorId)) || (input.contextVersion != null && (!Number.isSafeInteger(input.contextVersion) || input.contextVersion < 0))) throw new ChatFailure('invalid_request', 400);
  const payload = checkedPayload(input.channel, input.payload);
  if(Buffer.byteLength(JSON.stringify(payload),'utf8')>24576)throw new ChatFailure('request_too_large',413);
  const result = await integrationRpc('integration_enqueue', { p_key: input.idempotencyKey, p_channel: input.channel, p_payload: payload,
    p_visitor_id: input.visitorId ?? null, p_context_version: input.contextVersion ?? null }, signal) as QueuedIntegration;
  if (!result || !isVisitorUuid(result.id) || !statuses.includes(result.status)) throw new ChatFailure('integration_unavailable', 503); return result;
}
export function integrationOperationKey(prefix: string, value: string): string { return `${prefix}:${createHash('sha256').update(value).digest('hex')}`; }
interface Work { id: string; key: string; channel: 'email' | 'telegram' | 'booking_email' | 'booking_telegram' | 'booking_admin_email'; payload: Record<string, unknown>; leaseToken: string; attempt: number }
export async function processIntegrationBatch(limit = 5, signal?: AbortSignal): Promise<Record<string, number>> {
  const jobs = await integrationRpc('integration_claim', { p_limit: limit }, signal);
  if (!Array.isArray(jobs) || jobs.length > limit) throw new ChatFailure('integration_unavailable', 503);
  const counts: Record<string, number> = { processed: 0, accepted: 0, retry: 0, failed: 0, uncertain: 0, disabled: 0 };
  for (const raw of jobs) {
    const job = raw as Work;
    if (!job || !isVisitorUuid(job.id) || !isVisitorUuid(job.leaseToken) || typeof job.key !== 'string' || job.key.length > 200 || !Number.isSafeInteger(job.attempt) || job.attempt < 1 || job.attempt > 5 ||
      !['email','telegram','booking_email','booking_telegram','booking_admin_email'].includes(job.channel) || !job.payload || typeof job.payload !== 'object') throw new ChatFailure('integration_unavailable', 503);
    let status = 'failed'; let error = 'invalid_payload'; let providerId: string | null = null;
    try {
      let payload: EmailPayload | { text: string };
      if (job.channel.startsWith('booking_')) {
        const p = job.payload;
        if (!isCivilDate(p.date) || !isCivilTime(p.time) || !isVisitorUuid(p.id) || typeof p.meetUrl !== 'string' ||
          (p.name != null && (typeof p.name !== 'string' || p.name.length > 150)) ||
          (p.reminderHours !== undefined && ![24,1].includes(p.reminderHours as number))) throw new Error();
        const meetUrl = safeMeetingUrl(p.meetUrl);
        if (job.channel === 'booking_email' || job.channel === 'booking_admin_email') {
          if (job.channel === 'booking_email' ? !validEmail(p.email) : p.email != null && !validEmail(p.email) || p.reminderHours !== undefined) throw new Error();
          const calendar = bookingCalendar({ id: p.id, date: p.date, time: p.time, duration: 30, meetUrl,
            ...(typeof p.createdAt === 'string' ? { createdAt: p.createdAt } : {}) });
          const message = job.channel === 'booking_admin_email' ? buildBookingAdminEmail({
            id: p.id, date: p.date, time: p.time, email: p.email as string | null | undefined, name: p.name as string | undefined, meetUrl,
          }) : buildBookingEmail(p.reminderHours ? 'booking_reminder' : 'booking_confirmation', {
            id: p.id, date: p.date, time: p.time, email: p.email as string, name: p.name as string | undefined,
            duration: 30, meetUrl, reminderHours: p.reminderHours as 24 | 1 | undefined,
          });
          payload = { ...message, attachments: [{ filename: 'akrasia-videollamada.ics', content: Buffer.from(calendar,'utf8').toString('base64'), content_type: 'text/calendar' }] };
        } else payload = { text: `Nueva videollamada confirmada: ${formatCivilDateES(p.date, p.time)} (Europe/Madrid). Duración: 30 minutos.\n${meetUrl ? `Enlace: ${meetUrl}` : 'El equipo debe facilitar el enlace de videollamada.'}\nReferencia: ${p.id}` };
      } else payload = checkedPayload(job.channel as 'email' | 'telegram', job.payload);
      if (job.channel.endsWith('email')) {
        const frozen = await integrationRpc('integration_email_payload', { p_id: job.id, p_token: job.leaseToken, p_payload: emailDeliveryPayload(payload as EmailPayload) }, signal);
        if (!frozen || typeof frozen !== 'object' || Array.isArray(frozen)) throw new Error();
        const delivery = frozen as { disabled?: boolean; payload?: EmailPayload };
        if (delivery.disabled === true) { status = 'disabled'; error = 'booking_or_context_inactive'; }
        else {
          // This HTML originated in the service worker and is stored behind private RPCs.
          // Use its exact bytes after renderer deployments, preserving provider idempotency.
          if (!delivery.payload || !validEmail(delivery.payload.to) || typeof delivery.payload.subject !== 'string' ||
            !delivery.payload.subject || delivery.payload.subject.length > 200 || /[\r\n\u0000]/.test(delivery.payload.subject) ||
            typeof delivery.payload.bodyText !== 'string' || typeof delivery.payload.bodyHtml !== 'string' ||
            Buffer.byteLength(JSON.stringify(delivery.payload),'utf8')>65536) throw new Error();
          const result = await sendEmail(delivery.payload, { idempotencyKey: job.key, signal });
          status = result.disposition === 'retry' ? 'queued' : result.disposition; error = result.error || ''; providerId = result.resendId || null;
        }
      } else { const result = await sendTelegramText((payload as { text: string }).text, signal); status = result.status === 'retry' ? 'queued' : result.status; error = result.error || ''; providerId = result.providerId || null; }
    } catch (failure) {
      status = failure instanceof BookingAdminEmailConfigurationError ? 'disabled' : failure instanceof ChatFailure && failure.code === 'integration_unavailable' ? 'queued' : 'failed';
      error = status === 'disabled' ? 'invalid_admin_email_configuration' : status === 'queued' ? 'payload_store_unavailable' : 'invalid_payload';
    }
    const saved = await integrationRpc('integration_finish', { p_id: job.id, p_token: job.leaseToken, p_status: status, p_provider_id: providerId, p_error: error || null,
      p_retry_seconds: status === 'queued' ? Math.min(7200, 60 * 2 ** (job.attempt - 1)) : 0 }, signal);
    if (!saved || typeof saved !== 'object' || (saved as Record<string, unknown>).saved !== true) throw new ChatFailure('integration_unavailable', 503);
    counts.processed++; counts[status === 'queued' ? 'retry' : status]++;
  }
  return counts;
}
