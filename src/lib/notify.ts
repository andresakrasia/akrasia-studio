const TELEGRAM_BOT_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = import.meta.env.TELEGRAM_CHAT_ID;

interface LeadNotification {
  email?: string | null;
  phone?: string | null;
  company?: string | null;
  name?: string | null;
  projectType?: string | null;
  visitorId: string;
  lastMessage: string;
}

export async function sendLeadNotification(lead: LeadNotification) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[Notify] Telegram not configured — skipping notification');
    return;
  }

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

  const text = parts.join('\n');

  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });
  } catch {
    console.warn('[Notify] Telegram delivery failed — will retry on next lead');
  }
}
