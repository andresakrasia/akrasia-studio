const TELEGRAM_BOT_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = import.meta.env.TELEGRAM_CHAT_ID;
const SITE_URL = import.meta.env.SITE_URL || 'https://akrasia.studio';
import { createHash } from 'node:crypto';
import { integrationRpc } from './integration-store';
export async function sendTelegramText(text: string, signal?: AbortSignal): Promise<{ status: 'accepted' | 'retry' | 'failed' | 'uncertain' | 'disabled'; providerId?: string; error?: string }> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return { status: 'disabled', error: 'telegram_not_configured' };
  if (typeof text !== 'string' || !text || text.length > 3500) return { status: 'failed', error: 'telegram_invalid_payload' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { method: 'POST', redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text }) });
    if (!res.ok) { await res.body?.cancel(); return { status: res.status === 429 ? 'retry' : res.status >= 500 ? 'uncertain' : 'failed', error: `telegram_http_${res.status}` }; }
    const result = await res.json();
    if (result?.ok !== true || !Number.isSafeInteger(result.result?.message_id)) return { status: 'uncertain', error: 'telegram_invalid_response' };
    return { status: 'accepted', providerId: String(result.result.message_id) };
  } catch { return { status: 'uncertain', error: 'telegram_transport_unknown' }; }
}

interface LeadNotification {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  name?: string | null;
  projectType?: string | null;
  visitorId: string;
  lastMessage: string;
}

export interface HotLeadNotification extends LeadNotification {
  matchedKeywords: string[];
  budgetMentioned: string | null;
  lastMessages: Array<{ role: string; content: string }>;
}

async function telegramAPI(_method: string, payload: Record<string, unknown>, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const text = typeof payload.text === 'string' ? payload.text.slice(0, 3500) : '';
  if (!text) throw new Error('Invalid notification');
  // Legacy callers now persist text only; no parse_mode or user-built keyboards.
  const key = `telegram:${createHash('sha256').update(text).digest('hex')}`;
  return integrationRpc('integration_enqueue', { p_key: key, p_channel: 'telegram', p_payload: { text }, p_visitor_id: null, p_context_version: null }, signal);
}

export async function sendLeadNotification(lead: LeadNotification, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const parts = [
    '🎯 *Nuevo Lead capturado en Akrasia Studio*',
    '',
  ];

  if (lead.name) parts.push(`👤 Nombre: ${lead.name}`);
  if (lead.email) parts.push(`📧 Email: ${lead.email}`);
  if (lead.phone) parts.push(`📱 Teléfono: ${lead.phone}`);
  if (lead.company) parts.push(`🏢 Empresa: ${lead.company}`);
  if (lead.projectType) parts.push(`🎬 Tipo de proyecto: ${lead.projectType}`);

  parts.push('');
  parts.push(`💬 Último mensaje:\n> ${lead.lastMessage.slice(0, 300)}`);
  parts.push('');
  parts.push(`🔗 Visitor ID: \`${lead.visitorId}\``);

  await telegramAPI('sendMessage', {
    text: parts.join('\n'),
    parse_mode: 'Markdown',
  }, signal);
}

export async function sendHotLeadNotification(lead: HotLeadNotification, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const parts = [
    '🔥 *LEAD CALIENTE detectado*',
    '',
    '━━━━━━━━━━━━━━━━━━━━',
  ];

  if (lead.projectType) parts.push(`🎬 Proyecto: *${lead.projectType}*`);
  if (lead.budgetMentioned) parts.push(`💰 Presupuesto: ${lead.budgetMentioned}`);
  if (lead.email) parts.push(`📧 Email: ${lead.email}`);
  if (lead.phone) parts.push(`📱 Teléfono: ${lead.phone}`);
  if (lead.name) parts.push(`👤 Nombre: ${lead.name}`);
  if (lead.company) parts.push(`🏢 Empresa: ${lead.company}`);

  parts.push('');
  parts.push(`🏷️ Keywords: _${lead.matchedKeywords.slice(0, 6).join(', ')}_`);
  parts.push(`⭐ Score: ${lead.matchedKeywords.length + (lead.budgetMentioned ? 2 : 0)}`);

  parts.push('');
  parts.push('━━━━━━━━━━━━━━━━━━━━');
  parts.push('💬 *Últimos mensajes:*');

  const recentMessages = lead.lastMessages.slice(-4);
  for (const msg of recentMessages) {
    const prefix = msg.role === 'user' ? '👤' : '🤖';
    const content = msg.content.length > 150 ? msg.content.slice(0, 147) + '...' : msg.content;
    parts.push(`${prefix} ${content}`);
    parts.push('');
  }

  parts.push(`🔗 Visitor: \`${lead.visitorId}\``);

  const dashboardUrl = `${SITE_URL.replace(/\/$/, '')}/dashboard?tab=conversations&visitor_id=${encodeURIComponent(lead.visitorId)}`;

  await telegramAPI('sendMessage', {
    text: parts.join('\n'),
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          {
            text: '👁 Ver conversación',
            url: dashboardUrl,
          },
        ],
      ],
    },
  }, signal);
}

interface BookingNotification {
  visitorName: string | null;
  visitorEmail: string | null;
  visitorPhone: string | null;
  date: string;
  meetUrl: string;
  visitorId: string;
}

export async function sendBookingNotification(booking: BookingNotification, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const parts = [
    '📅 *Nueva reserva de videollamada*',
    '',
  ];

  if (booking.visitorName) parts.push(`👤 ${booking.visitorName}`);
  if (booking.visitorEmail) parts.push(`📧 ${booking.visitorEmail}`);
  if (booking.visitorPhone) parts.push(`📱 ${booking.visitorPhone}`);
  parts.push(`📆 ${booking.date}`);
  parts.push(`🔗 Enlace: ${booking.meetUrl}`);
  parts.push('');
  parts.push(`🔗 Visitor: \`${booking.visitorId}\``);

  await telegramAPI('sendMessage', {
    text: parts.join('\n'),
    parse_mode: 'Markdown',
  }, signal);
}
