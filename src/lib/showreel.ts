// PUBLIC_SHOWREEL: comma-separated list of video URLs. Only same-site paths
// (starting with a single "/") and HTTPS URLs are accepted; anything else is
// ignored so a typo cannot inject another scheme into the page.
export function showreelSources(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(item => item.trim()).filter(item => {
    if (!item || item.length > 500 || /[\s"'<>\\]/.test(item)) return false;
    if (item.startsWith('/') && !item.startsWith('//')) return true;
    try { return new URL(item).protocol === 'https:'; } catch { return false; }
  }).slice(0, 12);
}
