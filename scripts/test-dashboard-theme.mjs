import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { applyDashboardTheme, DASHBOARD_THEME_STORAGE_KEY, readDashboardTheme, saveDashboardTheme } from '../src/lib/dashboard-theme.ts';

const values = new Map();
const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
const root = { dataset: {}, classList: { toggle(name, active) { root[name] = active; } } };

assert.equal(readDashboardTheme(storage), 'night', 'First visit keeps the current night theme');
saveDashboardTheme(storage, 'day');
assert.equal(readDashboardTheme(storage), 'day', 'Day preference survives a fresh read');
applyDashboardTheme(root, readDashboardTheme(storage));
assert.equal(root.dataset.dashboardTheme, 'day');
assert.equal(root.dark, false);
saveDashboardTheme(storage, 'night');
applyDashboardTheme(root, readDashboardTheme(storage));
assert.equal(root.dark, true);
assert.equal(root.dataset.dashboardTheme, 'night');
values.set(DASHBOARD_THEME_STORAGE_KEY, 'invalid');
assert.equal(readDashboardTheme(storage), 'night', 'A malformed stored preference fails to the default');
const unavailable = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); } };
assert.equal(readDashboardTheme(unavailable), 'night');
assert.doesNotThrow(() => saveDashboardTheme(unavailable, 'day'));

// Exercise the actual pre-paint initializer, which also runs on the login page.
const layout = await readFile(new URL('../src/layouts/DashboardLayout.astro', import.meta.url), 'utf8');
const initializer = layout.match(/<script is:inline define:vars=[^\n]+>([\s\S]*?)<\/script>/)?.[1];
assert.ok(initializer);
saveDashboardTheme(storage, 'day');
vm.runInNewContext(initializer, { themeStorageKey: DASHBOARD_THEME_STORAGE_KEY, localStorage: storage, document: { documentElement: root } });
assert.equal(root.dataset.dashboardTheme, 'day', 'Saved day preference applies before React mounts');
assert.equal(root.dark, false);
assert.doesNotThrow(() => vm.runInNewContext(initializer, { themeStorageKey: DASHBOARD_THEME_STORAGE_KEY, localStorage: unavailable, document: { documentElement: root } }));

// Validate real day tokens rather than visual snapshots of the implementation.
const css = await readFile(new URL('../src/styles/dashboard-theme.css', import.meta.url), 'utf8');
const day = css.match(/html\.dashboard-page\[data-dashboard-theme='day'\] \{([\s\S]*?)\n\}/)?.[1];
const tokens = Object.fromEntries([...day.matchAll(/(--admin-[\w-]+): (#[a-f0-9]{6});/g)].map(([, key, value]) => [key, value]));
function luminance(hex) {
  const values = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return values[0] * .2126 + values[1] * .7152 + values[2] * .0722;
}
function contrast(foreground, background) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
for (const color of ['--admin-text', '--admin-heading', '--admin-muted', '--admin-dim', '--admin-accent']) {
  for (const surface of ['--admin-bg', '--admin-panel', '--admin-raised']) {
    assert.ok(contrast(tokens[color], tokens[surface]) >= 4.5, `${color} on ${surface} meets WCAG AA for normal text`);
  }
}
for (const color of ['#17623c', '#805500', '#ae3037', '#6a3daf']) assert.ok(contrast(color, tokens['--admin-panel']) >= 4.5);
console.log('Dashboard themes: default, persistence, storage failures, pre-paint initialization and day text contrast verified.');
