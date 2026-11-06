import type { EmailTemplateType } from './client-email-writing';
export type { EmailTemplateType } from './client-email-writing';
import { formatCivilDateES, isCivilDate, isCivilTime, madridInstant } from './civil-time';

export type BrandedEmailType = EmailTemplateType | 'booking_confirmation' | 'booking_reminder' | 'booking_admin_notification';
export interface EmailMeeting {
  id: string;
  name?: string;
  date: string;
  time: string;
  duration: number;
  meetUrl: string;
}
export interface EmailTemplateOptions {
  subject?: string;
  templateType?: BrandedEmailType;
  meeting?: EmailMeeting;
}
export interface BookingEmailInput extends Omit<EmailMeeting, 'duration'> {
  email: string;
  duration?: number;
  reminderHours?: 24 | 1;
}

export const EMAIL_BRAND_LOGO_URL = 'https://akrasia.studio/img/email-studio-core.png';
export const EMAIL_VISUALS: Record<BrandedEmailType, { label: string; title: string; step: string }> = {
  evaluation: { label: '01 / Tu idea', title: 'Todo empieza\ncon una idea.', step: 'Recepción y evaluación' },
  quote: { label: '02 / La propuesta', title: 'Una visión.\nUn plan.', step: 'Presupuesto y alcance' },
  follow_up: { label: '03 / El siguiente paso', title: 'Sigamos\nla conversación.', step: 'Seguimiento de propuesta' },
  kickoff: { label: '04 / Preparación', title: 'Demos forma\na tu proyecto.', step: 'Arranque del proyecto' },
  progress: { label: '05 / En producción', title: 'Tu visión,\nen movimiento.', step: 'Avances de producción' },
  delivery: { label: '06 / Primera mirada', title: 'Es momento\nde verlo.', step: 'Material para revisión' },
  final_delivery: { label: '07 / Entrega final', title: 'Listo para\nsalir a escena.', step: 'Materiales finales' },
  closure: { label: '08 / Hasta la próxima', title: 'El final de una pieza.\nEl inicio de otra.', step: 'Cierre del proyecto' },
  custom: { label: 'Desde el estudio', title: 'Hablemos de\nlo que viene.', step: 'Una conversación con AKRASIA' },
  booking_confirmation: { label: 'En agenda / Videollamada', title: 'Tenemos\nuna cita.', step: 'Reserva de reunión confirmada' },
  booking_reminder: { label: 'Nos vemos pronto / Videollamada', title: 'Tu próxima\nconversación.', step: 'Recordatorio de reunión' },
  booking_admin_notification: { label: 'Agenda del estudio / Nueva reserva', title: 'Una nueva\nconversación.', step: 'Videollamada confirmada para el equipo' },
};

export function isBrandedEmailType(value: unknown): value is BrandedEmailType {
  return typeof value === 'string' && Object.hasOwn(EMAIL_VISUALS, value);
}
export function escapeEmailHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
export function safeEmailUrl(value: string): string | null {
  if (!value || value.length > 2048 || /[\s\u0000-\u001f\u007f<>"']/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
// Link only explicit HTTPS URLs. User text always remains escaped, including
// HTML-looking input, URL attributes and quote characters.
function renderText(text: string): string {
  const pieces: string[] = [];
  let position = 0;
  for (const match of text.matchAll(/https:\/\/[^\s<>"']+/g)) {
    const index = match.index!;
    pieces.push(escapeEmailHtml(text.slice(position, index)));
    const candidate = match[0].replace(/[.,;:!?)]*$/, '');
    const url = safeEmailUrl(candidate);
    pieces.push(url ? `<a href="${escapeEmailHtml(url)}" style="color:#00f0ff;text-decoration:underline;word-break:break-all;">${escapeEmailHtml(candidate)}</a>${escapeEmailHtml(match[0].slice(candidate.length))}` : escapeEmailHtml(match[0]));
    position = index + match[0].length;
  }
  pieces.push(escapeEmailHtml(text.slice(position)));
  return pieces.join('').replace(/\r\n?|\n/g, '<br>');
}
function meetingCard(meeting: EmailMeeting): string {
  const date = isCivilDate(meeting.date) && isCivilTime(meeting.time) ? formatCivilDateES(meeting.date, meeting.time) : '';
  if (!date || madridInstant(meeting.date, meeting.time) === null || !Number.isSafeInteger(meeting.duration) || meeting.duration < 1 || meeting.duration > 240) return '';
  const url = safeEmailUrl(meeting.meetUrl);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#102024" style="margin:0 0 28px;border:1px solid #244044;"><tr><td style="padding:24px;"><p style="margin:0 0 10px;font:11px 'Courier New',monospace;letter-spacing:2px;color:#00f0ff;">TU VIDEOLLAMADA</p><p style="margin:0 0 8px;font-size:20px;line-height:1.4;font-weight:700;color:#ffffff;">${escapeEmailHtml(date)}</p><p style="margin:0 0 20px;font-size:13px;color:#cbd5e1;">${meeting.duration} minutos · Hora de Madrid (Europe/Madrid)</p>${url ? `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td bgcolor="#00f0ff" style="background:#00f0ff;"><a href="${escapeEmailHtml(url)}" style="display:inline-block;padding:15px 22px;color:#050505;font-size:13px;font-weight:700;text-decoration:none;">Entrar en la videollamada &rarr;</a></td></tr></table><p style="margin:14px 0 0;font-size:12px;line-height:1.6;color:#94a3b8;">Si el botón no funciona:<br><a href="${escapeEmailHtml(url)}" style="color:#00f0ff;word-break:break-all;">${escapeEmailHtml(url)}</a></p>` : '<p style="margin:0;font-size:14px;line-height:1.6;color:#cbd5e1;">El equipo te facilitará el enlace de reunión.</p>'}</td></tr></table>`;
}

/** One shared, deterministic template renderer for the admin preview and server.
 * Tables, explicit colors and inline styles form the baseline; mobile CSS only
 * improves it. No web-font, JavaScript, SVG or image is required to read it. */
export function renderEmailTemplate(input: EmailTemplateOptions & { bodyText: string }): string {
  const type = isBrandedEmailType(input.templateType) ? input.templateType : 'custom';
  const visual = EMAIL_VISUALS[type];
  const preheader = input.bodyText.replace(/\s+/g, ' ').trim().slice(0, 150);
  const message = renderText(input.bodyText.trim());
  const card = input.meeting && (type === 'booking_confirmation' || type === 'booking_reminder') ? meetingCard(input.meeting) : '';
  return `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeEmailHtml(input.subject || 'AKRASIA STUDIO')}</title><style>body,table,td{margin:0}table{border-collapse:collapse}a{color:#00f0ff}@media(max-width:620px){.email-shell{width:100%!important}.email-pad{padding-left:24px!important;padding-right:24px!important}.email-headline{font-size:32px!important}.email-orb{width:112px!important;height:112px!important}.email-hero-art{width:112px!important}}</style></head><body bgcolor="#050505" style="margin:0;padding:0;background:#050505;color:#cbd5e1;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%;"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#050505;font-size:1px;line-height:1px;mso-hide:all;">${escapeEmailHtml(preheader)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#050505"><tr><td align="center" style="padding:24px 8px 32px;"><!--[if mso]><table role="presentation" width="600"><tr><td><![endif]--><table role="presentation" class="email-shell" width="600" cellpadding="0" cellspacing="0" bgcolor="#0a0a0a" style="width:100%;max-width:600px;background:#0a0a0a;border:1px solid #1a1a1a;"><tr><td height="4" bgcolor="#00f0ff" style="height:4px;background:#00f0ff;font-size:0;">&nbsp;</td></tr><tr><td class="email-pad" style="padding:28px 36px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td><a href="https://akrasia.studio" style="font-size:25px;line-height:1.2;font-weight:800;letter-spacing:2px;color:#00f0ff;text-decoration:none;">ΛKRΛSIΛ</a><p style="margin:4px 0 0;font:10px 'Courier New',monospace;letter-spacing:5px;color:#cbd5e1;">STUDIO</p></td><td align="right" style="font:10px 'Courier New',monospace;line-height:1.7;letter-spacing:1px;color:#94a3b8;">CREATIVE DIRECTION<br>AUDIOVISUAL + AI</td></tr></table></td></tr><tr><td class="email-pad" style="padding:30px 36px 24px;"><p style="margin:0 0 16px;font:10px 'Courier New',monospace;letter-spacing:2px;text-transform:uppercase;color:#00f0ff;">${escapeEmailHtml(visual.label)}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td valign="middle"><h1 class="email-headline" style="margin:0;font-size:38px;font-weight:800;line-height:1.08;letter-spacing:-1.5px;color:#ffffff;">${escapeEmailHtml(visual.title).replace(/\n/g, '<br>')}</h1></td><td class="email-hero-art" width="156" valign="middle" align="right"><img class="email-orb" src="${EMAIL_BRAND_LOGO_URL}" width="156" height="156" alt="Logo AKRASIA: núcleo audiovisual" style="display:block;width:156px;height:156px;border:0;color:#00f0ff;font-size:12px;"></td></tr></table><p style="margin:18px 0 0;font:11px 'Courier New',monospace;line-height:1.6;color:#94a3b8;">${escapeEmailHtml(visual.step)}</p></td></tr><tr><td class="email-pad" style="padding:30px 36px 32px;border-top:1px solid #1a1a1a;">${card}<div style="font-size:15px;line-height:1.8;color:#cbd5e1;overflow-wrap:anywhere;word-break:break-word;">${message}</div></td></tr><tr><td class="email-pad" bgcolor="#101517" style="padding:25px 36px;background:#101517;border-top:1px solid #1a1a1a;"><p style="margin:0 0 8px;font-size:19px;line-height:1.4;font-weight:700;letter-spacing:-.4px;color:#ffffff;">We don't prompt. We direct.</p><p style="margin:0;font:11px 'Courier New',monospace;line-height:1.8;color:#94a3b8;">Oficio audiovisual. Visión humana. Tecnología.<br><a href="https://akrasia.studio" style="color:#00f0ff;text-decoration:none;">akrasia.studio &rarr;</a><span style="color:#94a3b8;"> &nbsp; / &nbsp; Barcelona</span></p></td></tr></table><!--[if mso]></td></tr></table><![endif]--><p style="margin:20px 0 0;font-size:11px;line-height:1.6;color:#94a3b8;">AKRASIA STUDIO · Producción audiovisual<br>Puedes responder a este correo para hablar con el equipo.</p></td></tr></table></body></html>`;
}

export function buildBookingEmail(type: 'booking_confirmation' | 'booking_reminder', input: BookingEmailInput) {
  const duration = input.duration ?? 30;
  if (!isCivilDate(input.date) || !isCivilTime(input.time) || madridInstant(input.date, input.time) === null || !Number.isSafeInteger(duration) || duration < 1 || duration > 240 || (input.meetUrl && !safeEmailUrl(input.meetUrl))) throw new Error('Invalid booking email');
  const meeting: EmailMeeting = { id: input.id, date: input.date, time: input.time, duration, meetUrl: input.meetUrl, ...(input.name ? { name: input.name } : {}) };
  const date = formatCivilDateES(input.date, input.time);
  const name = (input.name || '').replace(/[\r\n\u0000]/g, ' ').trim().slice(0, 150);
  const greeting = name && !name.includes('@') ? `Hola, ${name}:` : 'Hola:';
  const subject = type === 'booking_confirmation' ? 'Tu videollamada con AKRASIA está reservada' : `Recordatorio: tu videollamada con AKRASIA${input.reminderHours === 1 ? ' empieza pronto' : ''}`;
  const jitsi = input.meetUrl && new URL(input.meetUrl).hostname === 'meet.jit.si';
  const bodyText = [greeting, type === 'booking_confirmation' ? 'Reserva confirmada. Nos vemos por videollamada para conocer tu idea, resolver dudas y comentar cómo podemos darle forma.' : input.reminderHours === 1 ? 'Tenemos nuestra videollamada dentro de poco. Aquí tienes los datos para conectarte y hablar de tu proyecto.' : 'Te recordamos nuestra próxima videollamada. Aquí tienes los datos para conectarte y hablar de tu proyecto.', `Fecha: ${date}\nDuración: ${duration} minutos\nZona horaria: Europe/Madrid`, input.meetUrl ? `Enlace de reunión: ${input.meetUrl}${jitsi ? '\nSi llegas antes, espera a que el anfitrión abra la sala.' : ''}` : 'El equipo te facilitará el enlace de reunión.', `Para consultar o cancelar, vuelve al chat en el mismo navegador. Si tu sesión caduca, contacta con el estudio indicando la referencia ${input.id}.`, 'Nos vemos pronto,\nEl equipo de Akrasia Studio'].join('\n\n');
  return { to: input.email, ...(name ? { toName: name } : {}), subject, bodyText, bodyHtml: renderEmailTemplate({ subject, bodyText, templateType: type, meeting }), templateType: type, meeting };
}
