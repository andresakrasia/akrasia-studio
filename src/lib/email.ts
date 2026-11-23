import { renderEmailTemplate, type BrandedEmailType, type EmailMeeting, type EmailTemplateOptions } from './email-templates';

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const FROM_EMAIL = import.meta.env.EMAIL_FROM || '';
const REPLY_TO = import.meta.env.EMAIL_REPLY_TO || 'info@akrasia.studio';

export interface EmailPayload {
  to: string;
  toName?: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  templateType?: BrandedEmailType;
  meeting?: EmailMeeting;
  /** Only generated on the server. Never accepted from a dashboard request. */
  attachments?: { filename: string; content: string; content_type?: string }[];
  /** Private worker snapshot envelope. Browser fields never populate these. */
  from?: string;
  replyTo?: string;
}

const MAILBOX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
function validMailbox(value: unknown): boolean { return typeof value === 'string' && value.length <= 254 && MAILBOX.test(value); }
function validSender(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 357 || /[\r\n\u0000]/.test(value)) return false;
  if (validMailbox(value)) return true;
  const named = value.match(/^[^<>\r\n]{1,100} <([^<>\r\n]+)>$/);
  return Boolean(named && validMailbox(named[1]));
}
/** Freeze the public sender and reply mailbox before the worker's first send.
 * Always derives the envelope from server configuration; never forwards an
 * incoming object's envelope fields. API credentials are never persisted. */
export function emailDeliveryPayload(payload: EmailPayload): EmailPayload {
  const { from: _incomingFrom, replyTo: _incomingReply, ...content } = payload;
  if (!validSender(FROM_EMAIL) || !validMailbox(REPLY_TO)) return content;
  return { ...content, from: FROM_EMAIL, replyTo: REPLY_TO };
}

export interface SendResult {
  success: boolean;
  resendId?: string;
  error?: string;
}

export async function sendEmail(payload: EmailPayload, options: { idempotencyKey: string; signal?: AbortSignal }): Promise<SendResult & { disposition: 'accepted' | 'retry' | 'failed' | 'disabled' }> {
  const from = payload.from ?? FROM_EMAIL;
  const replyTo = payload.replyTo ?? REPLY_TO;
  if (!RESEND_API_KEY || !validSender(from)) {
    return { success: false, error: 'email_not_configured', disposition: 'disabled' };
  }
  if (!options?.idempotencyKey || options.idempotencyKey.length > 200 || !/^[A-Za-z0-9:._-]+$/.test(options.idempotencyKey))
    return { success: false, error: 'invalid_idempotency_key', disposition: 'failed' };
  if (!validMailbox(replyTo))
    return { success: false, error: 'email_reply_to_invalid', disposition: 'disabled' };
  if (payload.attachments && (!Array.isArray(payload.attachments) || payload.attachments.length > 2 || payload.attachments.some(file => !file || !/^[A-Za-z0-9._-]{1,100}$/.test(file.filename) || typeof file.content !== 'string' || file.content.length > 32768 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.content) || file.content_type !== undefined && !/^text\/calendar(?:;[A-Za-z0-9= -]+)*$/.test(file.content_type))))
    return { success: false, error: 'invalid_attachment', disposition: 'failed' };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      redirect: 'error',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': options.idempotencyKey,
      },
      body: JSON.stringify({
        from,
        reply_to: replyTo,
        to: payload.to,
        subject: payload.subject,
        text: payload.bodyText,
        html: payload.bodyHtml,
        ...(payload.attachments?.length ? { attachments: payload.attachments.map(file => ({ filename: file.filename, content: file.content, ...(file.content_type ? { content_type: file.content_type } : {}) })) } : {}),
      }),
    });

    if (!res.ok) {
      await res.body?.cancel();
      return { success: false, error: `email_http_${res.status}`, disposition: res.status === 429 || res.status >= 500 ? 'retry' : 'failed' };
    }

    const data = await res.json();
    if (typeof data.id !== 'string' || data.id.length > 200) return { success: false, error: 'email_invalid_response', disposition: 'retry' };
    return { success: true, resendId: data.id, disposition: 'accepted' };
  } catch (err) {
    // Resend retries keep the same key, payload and a <24h retry horizon.
    return { success: false, error: 'email_transport_unknown', disposition: 'retry' };
  }
}

export function generateEmailHtml(bodyText: string, options: EmailTemplateOptions = {}): string {
  return renderEmailTemplate({ bodyText, ...options });
}
