// These client bounds mirror the conservative server defaults. The server
// remains authoritative if its configured limits are lower.
export const MAX_CHAT_MESSAGES = 20;
export const MAX_CHAT_MESSAGE_CHARS = 2000;
export const MAX_CHAT_INPUT_BYTES = 8192;

export interface ChatInputMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatErrorCode =
  | 'chat_rate_limited'
  | 'chat_busy'
  | 'chat_unavailable'
  | 'chat_timeout'
  | 'invalid_request'
  | 'request_too_large'
  | 'invalid_chat_session'
  | 'chat_context_changed'
  | 'chat_interrupted';

const ERROR_CODES = new Set<ChatErrorCode>([
  'chat_rate_limited', 'chat_busy', 'chat_unavailable', 'chat_timeout',
  'invalid_request', 'request_too_large', 'invalid_chat_session', 'chat_context_changed', 'chat_interrupted',
]);

function normalizeCode(value: unknown): ChatErrorCode {
  return typeof value === 'string' && ERROR_CODES.has(value as ChatErrorCode)
    ? value as ChatErrorCode
    : 'chat_unavailable';
}

function normalizeRetryAfter(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return Math.min(Math.ceil(value), 7 * 24 * 60 * 60);
}

export class ChatClientError extends Error {
  readonly code: ChatErrorCode;
  readonly retryAfter?: number;

  constructor(code: ChatErrorCode, retryAfter?: number) {
    super(code);
    this.name = 'ChatClientError';
    this.code = code;
    this.retryAfter = normalizeRetryAfter(retryAfter);
  }
}

export function formatChatError(error: ChatClientError, translate: (key: string) => string): string {
  const key = error.code === 'chat_rate_limited' ? 'chat.rateLimited'
    : error.code === 'chat_busy' ? 'chat.busy'
    : error.code === 'request_too_large' ? 'chat.tooLarge'
    : error.code === 'invalid_request' ? 'chat.invalidRequest'
    : error.code === 'invalid_chat_session' ? 'chat.invalidSession'
    : error.code === 'chat_timeout' ? 'chat.timeout'
    : error.code === 'chat_interrupted' || error.code === 'chat_context_changed' ? 'chat.interrupted'
    : 'chat.unavailable';
  let message = translate(key);
  if (error.retryAfter) {
    const seconds = error.retryAfter;
    const waitKey = seconds < 60 ? 'chat.waitSeconds' : seconds < 3600 ? 'chat.waitMinutes' : 'chat.waitHours';
    const value = seconds < 60 ? seconds : seconds < 3600 ? Math.ceil(seconds / 60) : Math.ceil(seconds / 3600);
    message += ` ${translate(waitKey).replace('{count}', String(value))}`;
  }
  return message;
}

/** Select recent context without changing or silently cutting the new message. */
export function buildChatMessages(messages: readonly ChatInputMessage[]): ChatInputMessage[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user' || !last.content.trim()) {
    throw new ChatClientError('invalid_request');
  }
  const encoder = new TextEncoder();
  if (last.content.length > MAX_CHAT_MESSAGE_CHARS || encoder.encode(last.content).length > MAX_CHAT_INPUT_BYTES) {
    throw new ChatClientError('request_too_large');
  }

  const selected: ChatInputMessage[] = [];
  let bytes = 0;
  for (let i = messages.length - 1; i >= 0 && selected.length < MAX_CHAT_MESSAGES; i--) {
    const message = messages[i];
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    if (!message.content.trim()) continue;
    // Old locally stored context may predate the limits. Keep a valid suffix;
    // do not truncate an earlier message in a way that changes its meaning.
    if (message.content.length > MAX_CHAT_MESSAGE_CHARS) break;
    const messageBytes = encoder.encode(message.content).length;
    if (bytes + messageBytes > MAX_CHAT_INPUT_BYTES) break;
    selected.push({ role: message.role, content: message.content });
    bytes += messageBytes;
  }
  return selected.reverse();
}

/** Decode only public error codes, never display provider or response text. */
export function getChatError(data: unknown, status: number, retryAfterHeader: string | null): ChatClientError {
  const fallback: ChatErrorCode = status === 429 ? 'chat_rate_limited'
    : status === 401 ? 'invalid_chat_session'
    : status === 413 ? 'request_too_large'
    : status === 400 ? 'invalid_request'
    : status === 504 ? 'chat_timeout'
    : 'chat_unavailable';
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : null;
  const code = record && typeof record.error === 'string' && ERROR_CODES.has(record.error as ChatErrorCode)
    ? record.error as ChatErrorCode : fallback;
  const bodyRetry = normalizeRetryAfter(record?.retry_after);
  const headerRetry = retryAfterHeader && /^\d+$/.test(retryAfterHeader.trim())
    ? normalizeRetryAfter(Number(retryAfterHeader)) : undefined;
  return new ChatClientError(code, bodyRetry ?? headerRetry);
}

export interface BookingProposal {
  token: string; date: string; time: string; email: string; name: string; expiresAt: number;
}
export type ChatActionResult =
  | { status: 'confirmation_required'; proposal: BookingProposal }
  | { status: 'unavailable' }
  | { status: 'confirmed'; booking: { id: string; date: string; time: string; duration_min: number; meet_url: string }; notification: 'queued' | 'already_processed' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every(key => key in value);
}
function safeMeetingUrl(value: unknown): value is string {
  if (value === '') return true;
  if (typeof value !== 'string' || value.length > 2048) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; }
  catch { return false; }
}
export function parseChatAction(value: unknown): ChatActionResult {
  const fail = (): never => { throw new ChatClientError('chat_interrupted'); };
  if (!isRecord(value)) return fail();
  if (value.status === 'unavailable' && exactKeys(value, ['status'])) return { status: 'unavailable' };
  if (value.status === 'confirmation_required' && exactKeys(value, ['status', 'proposal'])) {
    const proposal = value.proposal;
    if (!isRecord(proposal) || !exactKeys(proposal, ['token', 'date', 'time', 'email', 'name', 'expiresAt']) ||
      typeof proposal.token !== 'string' || proposal.token.length > 2048 || !/^[A-Za-z0-9_.-]+$/.test(proposal.token) ||
      typeof proposal.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(proposal.date) ||
      typeof proposal.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(proposal.time) ||
      typeof proposal.email !== 'string' || proposal.email.length > 254 || !proposal.email ||
      typeof proposal.name !== 'string' || proposal.name.length > 150 ||
      !Number.isSafeInteger(proposal.expiresAt) || (proposal.expiresAt as number) <= 0) return fail();
    return value as unknown as ChatActionResult;
  }
  if (value.status === 'confirmed' && exactKeys(value, ['status', 'booking', 'notification'])) {
    const booking = value.booking;
    if (!isRecord(booking) || !exactKeys(booking, ['id', 'date', 'time', 'duration_min', 'meet_url']) ||
      typeof booking.id !== 'string' || !/^[a-f0-9-]{36}$/.test(booking.id) ||
      typeof booking.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(booking.date) ||
      typeof booking.time !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(booking.time) ||
      booking.duration_min !== 30 || !safeMeetingUrl(booking.meet_url) ||
      !['queued', 'already_processed'].includes(String(value.notification))) return fail();
    return value as unknown as ChatActionResult;
  }
  return fail();
}

export type ChatStreamEvent = { content: string; replace?: true } | { action: ChatActionResult } | { meeting_guide: true } | { done: true };

/** Buffer complete SSE events across arbitrary decoded network fragments. */
export function createChatSSEParser() {
  let buffer = '';
  let complete = false;
  let failed = false;
  const fail = (error = new ChatClientError('chat_interrupted')): never => {
    failed = true;
    throw error;
  };

  return {
    get complete() { return complete; },
    push(chunk: string): ChatStreamEvent[] {
      if (failed) return fail();
      buffer += chunk;
      if (buffer.length > 64 * 1024) return fail();
      const events: ChatStreamEvent[] = [];
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).replace(/^ /, ''))
          .join('\n');
        if (!data) continue; // SSE comments and keepalive events.
        if (complete) return fail();
        if (data === '[DONE]') {
          complete = true;
          events.push({ done: true });
          continue;
        }
        let parsed: unknown;
        try { parsed = JSON.parse(data); } catch { return fail(); }
        if (!isRecord(parsed)) return fail();
        const record = parsed as Record<string, unknown>;
        if ('error' in record) {
          return fail(new ChatClientError(normalizeCode(record.error), normalizeRetryAfter(record.retry_after)));
        }
        if ('meeting_guide' in record) {
          if (!exactKeys(record, ['meeting_guide']) || record.meeting_guide !== true) return fail();
          events.push({ meeting_guide: true });
        } else if ('action' in record) {
          if (!exactKeys(record, ['action'])) return fail();
          events.push({ action: parseChatAction(record.action) });
        } else {
          if (typeof record.content !== 'string' || Object.keys(record).some(key => !['content', 'replace'].includes(key)) ||
            ('replace' in record && record.replace !== true)) return fail();
          events.push({ content: record.content, ...(record.replace === true ? { replace: true as const } : {}) });
        }
      }
      return events;
    },
    finish(): void {
      if (failed || !complete || buffer.trim()) fail();
    },
  };
}
