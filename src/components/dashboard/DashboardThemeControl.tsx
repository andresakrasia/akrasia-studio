import { useEffect, useState } from 'react';
import { applyDashboardTheme, DASHBOARD_THEME_STORAGE_KEY, parseDashboardTheme, saveDashboardTheme, type DashboardTheme } from '../../lib/dashboard-theme';

export default function DashboardThemeControl() {
  const [theme, setTheme] = useState<DashboardTheme>(() => parseDashboardTheme(document.documentElement.dataset.dashboardTheme));

  useEffect(() => {
    applyDashboardTheme(document.documentElement, theme);
    try { saveDashboardTheme(window.localStorage, theme); } catch { /* Storage access itself may throw. */ }
  }, [theme]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === DASHBOARD_THEME_STORAGE_KEY || event.key === null) setTheme(parseDashboardTheme(event.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return <div role="group" aria-label="Apariencia del panel" className="dashboard-theme-control">
    {(['night', 'day'] as const).map(value => <button key={value} type="button" aria-pressed={theme === value} onClick={() => setTheme(value)}>
      {value === 'night' ? <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20.6 13.3A8.7 8.7 0 0 1 10.7 3.4 8.7 8.7 0 1 0 20.6 13.3Z" /></svg> : <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.4 1.4m11.2 11.2L19 19M5 19l1.4-1.4M17.6 6.4 19 5" /></svg>}
      {value === 'night' ? 'Noche' : 'Día'}
    </button>)}
  </div>;
}
