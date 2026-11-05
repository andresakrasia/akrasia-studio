import { decodeHTML } from 'entities';

/** Only these URL forms can become navigable Markdown links. */
export function safeMarkdownLink(value: string): { href: string; external: boolean } | null {
  const href = decodeHTML(value).trim();
  // Browsers normalize controls and backslashes in URLs. Reject them before
  // deciding which protocol/path to allow, including percent-encoded controls.
  if (!href || /[\s\u0000-\u001f\u007f-\u009f\\]/u.test(href)) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(href); } catch { return null; }
  if (/[\u0000-\u001f\u007f-\u009f\\]/u.test(decoded)) return null;

  if (/^https?:\/\//i.test(href)) {
    try {
      const url = new URL(href);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
      return { href: url.href, external: true };
    } catch { return null; }
  }
  if (/^mailto:[^/?#]+(?:\?[^#]*)?$/i.test(href)) {
    return { href, external: true };
  }
  if (/^(?:\/(?!\/)|\.\.?\/|#|\?)/.test(href) && !decoded.startsWith('//')) {
    return { href, external: false };
  }
  return null;
}
