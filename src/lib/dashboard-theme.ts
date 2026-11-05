export const DASHBOARD_THEME_STORAGE_KEY = 'akrasia.dashboard.theme';
export type DashboardTheme = 'night' | 'day';

export function parseDashboardTheme(value: unknown): DashboardTheme {
  return value === 'day' ? 'day' : 'night';
}

// Storage may be unavailable in private browsing. The night theme is always
// the default, independently of the public site's style or the OS theme.
export function readDashboardTheme(storage: Pick<Storage, 'getItem'> | null): DashboardTheme {
  try { return parseDashboardTheme(storage?.getItem(DASHBOARD_THEME_STORAGE_KEY)); }
  catch { return 'night'; }
}

export function applyDashboardTheme(root: Pick<HTMLElement, 'dataset' | 'classList'>, theme: DashboardTheme): void {
  root.dataset.dashboardTheme = theme;
  root.classList.toggle('dark', theme === 'night');
}

export function saveDashboardTheme(storage: Pick<Storage, 'setItem'> | null, theme: DashboardTheme): void {
  try { storage?.setItem(DASHBOARD_THEME_STORAGE_KEY, theme); }
  catch { /* Keep the current session usable when the browser blocks storage. */ }
}
