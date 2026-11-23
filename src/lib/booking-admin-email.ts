import { formatCivilDateES, isCivilDate, isCivilTime, madridInstant } from './civil-time';
import { renderEmailTemplate } from './email-templates';
import { safeMeetingUrl } from './booking-calendar';
import { isVisitorUuid } from './visitor-data';
import type { EmailPayload } from './email';

const MAILBOX = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
export const DEFAULT_BOOKING_ADMIN_EMAIL = 'info@akrasia.studio';
export class BookingAdminEmailConfigurationError extends Error {
  constructor() { super('invalid_admin_email_configuration'); }
}
interface BookingAdminEmailInput {
  id: string; date: string; time: string; email?: string | null; name?: string | null; meetUrl: string;
}
interface BookingAdminEmailConfiguration { recipient?: string; siteUrl?: string; }

/** The destination and admin URL derive only from private server configuration.
 * A visitor's email remains contact information, never the notification recipient. */
export function buildBookingAdminEmail(input: BookingAdminEmailInput, configuration: BookingAdminEmailConfiguration = {}): EmailPayload {
  const recipient = (configuration.recipient ?? import.meta.env.BOOKING_ADMIN_EMAIL) || DEFAULT_BOOKING_ADMIN_EMAIL;
  const site = (configuration.siteUrl ?? import.meta.env.SITE_URL) || 'https://akrasia.studio';
  if (recipient.length > 254 || !MAILBOX.test(recipient)) throw new BookingAdminEmailConfigurationError();
  let dashboard: URL;
  try {
    const origin = new URL(site);
    if (site.length > 800 || origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || /[\s\u0000-\u001f\u007f]/.test(site)) throw new Error();
    dashboard = new URL('/dashboard', origin);
  } catch { throw new BookingAdminEmailConfigurationError(); }
  if (!isVisitorUuid(input.id) || !isCivilDate(input.date) || !isCivilTime(input.time) || madridInstant(input.date, input.time) === null ||
    (input.email != null && (input.email.length > 254 || !MAILBOX.test(input.email))) ||
    (input.name != null && (typeof input.name !== 'string' || input.name.length > 150))) throw new Error('Invalid admin booking email');
  const meetUrl = safeMeetingUrl(input.meetUrl);
  const name = (input.name || '').replace(/[\r\n\u0000-\u001f\u007f]/g, ' ').trim();
  dashboard.searchParams.set('tab', 'bookings');
  dashboard.searchParams.set('date', input.date);
  const subject = `Nueva reserva · ${input.date} · ${input.time} (Madrid)`;
  const bodyText = [
    'Se ha confirmado una nueva videollamada en la agenda del estudio.',
    `Fecha: ${formatCivilDateES(input.date, input.time)}\nDuración: 30 minutos\nZona horaria: Europe/Madrid`,
    `Cliente: ${name || 'Sin nombre'}\nEmail del cliente: ${input.email || 'No facilitado'}`,
    meetUrl ? `Enlace de reunión: ${meetUrl}` : 'El equipo debe facilitar el enlace de reunión.',
    `Ver la reserva en el panel: ${dashboard.href}`,
    `Referencia: ${input.id}\nAdjuntamos el evento para tu calendario.`,
  ].join('\n\n');
  return { to: recipient, subject, bodyText,
    bodyHtml: renderEmailTemplate({ subject, bodyText, templateType: 'booking_admin_notification' }), templateType: 'booking_admin_notification' };
}
