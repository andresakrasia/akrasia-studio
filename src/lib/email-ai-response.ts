import type { EmailWritingResult } from './client-email-writing';

// Accept one complete JSON object, optionally wrapped in a Markdown code fence.
// Do not try to recover partial output or extract JSON from unrelated prose.
export function parseEmailAiResponse(content: unknown): EmailWritingResult | null {
  if (typeof content !== 'string' || content.length > 65536) return null;
  let text = content.trim();
  const fence = /^```(?:json)?\s*\r?\n([\s\S]*?)\r?\n```$/i.exec(text);
  if (fence) text = fence[1].trim();
  let value: unknown;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || typeof record.subject !== 'string' || typeof record.body !== 'string' ||
      !record.subject.trim() || record.subject.length > 200 || /[\r\n\u0000-\u001f\u007f]/.test(record.subject) ||
      !record.body.trim() || record.body.length > 10000 || /[\u0000\u0008\u000b\u000c]/.test(record.body)) return null;
  return { subject: record.subject, body: record.body };
}
