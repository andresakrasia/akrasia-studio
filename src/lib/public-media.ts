/** Public images cannot contact an unreviewed third party on mere navigation. */
export function localProjectImage(value: unknown): string {
  if (typeof value !== 'string' || !/^\/(?!\/)/.test(value) || /[\s\u0000-\u001f\u007f\\]/u.test(value)) return '';
  return value;
}

export const MANAGED_MEDIA_UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.webp$(?![\s\S])/;
export const LEGACY_MEDIA_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$(?![\s\S])/;

/** Convert only this deployment's old Storage URLs; no network requests or secrets. */
export function projectImagePath(value: unknown, storageBase: string | undefined): string {
  if (typeof value !== 'string') return '';
  const local = localProjectImage(value);
  if (local) {
    if (local.startsWith('/api/project-media/')) {
      const name = local.slice('/api/project-media/'.length);
      if (name.startsWith('legacy/')) return LEGACY_MEDIA_NAME.test(name.slice(7)) ? local : '';
      return MANAGED_MEDIA_UUID.test(name) ? local : '';
    }
    return local;
  }
  if (!storageBase) return '';
  try {
    const base = new URL(storageBase);
    const url = new URL(value);
    const prefix = '/storage/v1/object/public/project-thumbnails/';
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)) return '';
    const name = url.pathname.slice(prefix.length);
    return LEGACY_MEDIA_NAME.test(name) ? `/api/project-media/legacy/${name}` : '';
  } catch { return ''; }
}
