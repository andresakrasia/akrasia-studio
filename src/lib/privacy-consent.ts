import { analyticsDestination, createAnalyticsSession, type AnalyticsOptions } from './analytics';

/** A preference is a browser choice, never proof of a chat or account identity. */
export const PRIVACY_STORAGE_KEY = 'akrasia_privacy_preferences';
export const PRIVACY_VERSION = 1;
export const PRIVACY_TTL_MS = 180 * 24 * 60 * 60 * 1000;
export const PRIVACY_CHANGE_EVENT = 'akrasia-privacy-change';
export interface PrivacyPreference {
  version: 1;
  updatedAt: number;
  analytics: boolean;
  externalMedia: boolean;
}
export interface PrivacyRuntimeOptions extends AnalyticsOptions {}

export function parsePrivacyPreference(raw: string | null, now = Date.now()): PrivacyPreference | null {
  if (!raw || raw.length > 512) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const entry = value as Record<string, unknown>;
    if (Object.keys(entry).sort().join(',') !== 'analytics,externalMedia,updatedAt,version' ||
      entry.version !== PRIVACY_VERSION || typeof entry.analytics !== 'boolean' || typeof entry.externalMedia !== 'boolean' ||
      typeof entry.updatedAt !== 'number' || !Number.isSafeInteger(entry.updatedAt) || entry.updatedAt <= 0 ||
      entry.updatedAt > now || now - entry.updatedAt >= PRIVACY_TTL_MS) return null;
    return entry as unknown as PrivacyPreference;
  } catch { return null; }
}

let ephemeral: PrivacyPreference | null = null;
export function readPrivacyPreference(): PrivacyPreference | null {
  if (typeof window === 'undefined') return null;
  if (ephemeral) return parsePrivacyPreference(JSON.stringify(ephemeral));
  try { return parsePrivacyPreference(window.localStorage.getItem(PRIVACY_STORAGE_KEY)); }
  catch { return ephemeral && parsePrivacyPreference(JSON.stringify(ephemeral)); }
}
export function hasExternalMediaConsent(): boolean { return readPrivacyPreference()?.externalMedia === true; }
export function savePrivacyPreference(choices: { analytics: boolean; externalMedia: boolean }): PrivacyPreference {
  const value: PrivacyPreference = { version: PRIVACY_VERSION, updatedAt: Date.now(), ...choices };
  ephemeral = null;
  try { window.localStorage.setItem(PRIVACY_STORAGE_KEY, JSON.stringify(value)); }
  catch {
    ephemeral = value;
    // A full/disabled store must never leave a previously accepted record as
    // the durable authority after an unsuccessful withdrawal write.
    try { window.localStorage.removeItem(PRIVACY_STORAGE_KEY); } catch {}
  }
  window.dispatchEvent(new CustomEvent(PRIVACY_CHANGE_EVENT, { detail: value }));
  return value;
}
export function openPrivacySettings(): void {
  document.dispatchEvent(new CustomEvent('privacy-settings-open'));
}

/** Strict providers and video IDs; never forward supplied query parameters or redirects. */
export function externalVideoEmbed(value: string): { src: string; provider: 'YouTube' | 'Vimeo' } | null {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    let youtubeId: string | undefined;
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(url.hostname)) {
      youtubeId = /^\/(?:embed|shorts|live)\/([a-zA-Z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
      if (url.pathname === '/watch' && url.searchParams.getAll('v').length === 1) youtubeId = url.searchParams.get('v') || undefined;
    } else if (['www.youtube-nocookie.com', 'youtube-nocookie.com'].includes(url.hostname)) {
      youtubeId = /^\/embed\/([a-zA-Z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    } else if (url.hostname === 'youtu.be') {
      youtubeId = /^\/([a-zA-Z0-9_-]{11})\/?$/.exec(url.pathname)?.[1];
    }
    if (youtubeId && /^[a-zA-Z0-9_-]{11}$/.test(youtubeId)) {
      return { src: `https://www.youtube-nocookie.com/embed/${youtubeId}?autoplay=1&playsinline=1&rel=0`, provider: 'YouTube' };
    }
    if (url.hostname === 'player.vimeo.com' && /^\/video\/[1-9][0-9]{0,11}$/.test(url.pathname)) {
      return { src: `https://player.vimeo.com${url.pathname}?autoplay=1&dnt=1`, provider: 'Vimeo' };
    }
  } catch { /* Untrusted project URLs stay inert. */ }
  return null;
}

export function clearKnownAnalyticsCookies(doc: Document, hostname: string): void {
  // This cannot erase a provider's cookies or copies. The owner must inventory every approved tag.
  const names = doc.cookie.split(';').map(value => value.trim().split('=')[0]).filter(name => /^_(?:ga(?:_|$)|gid$|gat(?:_|$)|gcl_)/.test(name));
  const domains = ['', ...hostname.split('.').map((_, index, parts) => parts.slice(index).join('.')).filter(value => value.includes('.'))];
  for (const name of names) for (const domain of domains) {
    doc.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ''}`;
  }
}

/** Call once on PUBLIC pages. No Consent Mode ping or GTM noscript request exists before consent. */
export function initializePrivacyRuntime(options: PrivacyRuntimeOptions, environment: {
  win: Window; doc: Document; reload: () => void;
} = { win: window, doc: document, reload: () => window.location.reload() }): () => void {
  const { win, doc, reload } = environment;
  let loaded = false;
  let stopping = false;
  let expiryTimer: number | undefined;
  const destination = analyticsDestination(options);
  const analyticsAvailable = Boolean(destination) &&
    !/^\/dashboard(?:\/|$)/.test(win.location.pathname);
  const read = () => {
    if (ephemeral) return parsePrivacyPreference(JSON.stringify(ephemeral));
    try { return parsePrivacyPreference(win.localStorage.getItem(PRIVACY_STORAGE_KEY)); }
    catch { return ephemeral && parsePrivacyPreference(JSON.stringify(ephemeral)); }
  };
  const analytics = destination ? createAnalyticsSession(destination, { win, doc }, () => read()?.analytics === true) : null;
  const synchronize = () => {
    const value = read();
    if (expiryTimer !== undefined) win.clearTimeout(expiryTimer);
    expiryTimer = undefined;
    // Stop executed tags at the actual deadline, also while a page stays open.
    // Long preferences need capped, rescheduled timers on browser platforms.
    if (value && !stopping && typeof win.setTimeout === 'function') {
      expiryTimer = win.setTimeout(expire, Math.min(value.updatedAt + PRIVACY_TTL_MS - Date.now(), 2_147_483_647));
    }
    if (loaded && (!value?.analytics || !analyticsAvailable)) {
      if (stopping) return;
      stopping = true;
      analytics?.stop();
      clearKnownAnalyticsCookies(doc, win.location.hostname);
      // Already executed third-party code cannot be safely unloaded in place.
      // Saving the denied preference FIRST ensures reload cannot re-enable it.
      reload();
      return;
    }
    if (!loaded && analyticsAvailable && value?.analytics) {
      loaded = true;
      analytics?.start();
    }
  };
  const storage = (event: StorageEvent) => {
    if (event.key !== PRIVACY_STORAGE_KEY && event.key !== null) return;
    ephemeral = null;
    win.dispatchEvent(new CustomEvent(PRIVACY_CHANGE_EVENT, { detail: read() }));
  };
  const expire = () => {
    const value = read();
    if (!value) win.dispatchEvent(new CustomEvent(PRIVACY_CHANGE_EVENT, { detail: null }));
    synchronize();
  };
  win.addEventListener(PRIVACY_CHANGE_EVENT, synchronize);
  win.addEventListener('storage', storage);
  win.addEventListener('pageshow', expire);
  win.addEventListener('focus', expire);
  const interval = win.setInterval(expire, 60_000);
  synchronize();
  return () => {
    win.removeEventListener(PRIVACY_CHANGE_EVENT, synchronize);
    win.removeEventListener('storage', storage);
    win.removeEventListener('pageshow', expire);
    win.removeEventListener('focus', expire);
    win.clearInterval(interval);
    if (expiryTimer !== undefined) win.clearTimeout(expiryTimer);
    analytics?.stop();
  };
}
