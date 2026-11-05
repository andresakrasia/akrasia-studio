import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: { 'import.meta.env.SUPABASE_URL': JSON.stringify('http://synthetic.invalid'),
    'import.meta.env.SUPABASE_SERVICE_ROLE_KEY': JSON.stringify('synthetic-test-key') } });
let assertions = 0;
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const equal = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
try {
  const lib = await vite.ssrLoadModule('/src/lib/privacy-consent.ts');
  const now = Date.now();
  const preference = { version: 1, updatedAt: now, analytics: true, externalMedia: false };
  for (const raw of [null, '', '{broken', '[]', 'null', 'true', JSON.stringify({ ...preference, version: 0 }),
    JSON.stringify({ ...preference, version: 2 }), JSON.stringify({ ...preference, analytics: 'true' }),
    JSON.stringify({ ...preference, externalMedia: 1 }), JSON.stringify({ ...preference, updatedAt: now + 1 }),
    JSON.stringify({ ...preference, updatedAt: now - lib.PRIVACY_TTL_MS }), JSON.stringify({ ...preference, updatedAt: 0 }),
    JSON.stringify({ ...preference, updatedAt: 1.2 }), JSON.stringify({ analytics: true }),
    JSON.stringify({ ...preference, extra: 'unnecessary data' }), 'a'.repeat(513)]) {
    equal(lib.parsePrivacyPreference(raw, now), null, 'Invalid/old preferences fail closed');
  }
  equal(lib.parsePrivacyPreference(JSON.stringify(preference), now), preference, 'Explicit valid choice');
  equal(lib.parsePrivacyPreference(JSON.stringify({ ...preference, analytics: false, externalMedia: false }), now)?.analytics, false);
  equal(lib.parsePrivacyPreference(JSON.stringify({ ...preference, updatedAt: now - lib.PRIVACY_TTL_MS + 1 }), now)?.analytics, true);
  equal(lib.externalVideoEmbed('https://www.youtube.com/embed/dQw4w9WgXcQ?malicious=1'), {
    src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&playsinline=1&rel=0', provider: 'YouTube' });
  for (const value of ['https://www.youtube.com/watch?v=OHOpb2fS-cM&feature=shared',
    'https://m.youtube.com/watch?v=OHOpb2fS-cM', 'https://youtu.be/OHOpb2fS-cM?si=tracking&t=10',
    'https://youtube.com/shorts/OHOpb2fS-cM', 'https://youtube.com/live/OHOpb2fS-cM',
    'https://www.youtube-nocookie.com/embed/OHOpb2fS-cM']) {
    equal(lib.externalVideoEmbed(value), {
      src: 'https://www.youtube-nocookie.com/embed/OHOpb2fS-cM?autoplay=1&playsinline=1&rel=0', provider: 'YouTube' }, 'Shared links normalize without forwarding tracking');
  }
  equal(lib.externalVideoEmbed('https://player.vimeo.com/video/12345?tracking=1'), {
    src: 'https://player.vimeo.com/video/12345?autoplay=1&dnt=1', provider: 'Vimeo' });
  for (const value of ['javascript:alert(1)', 'https://evil.invalid/embed/dQw4w9WgXcQ', 'https://www.youtube.com.evil.invalid/embed/dQw4w9WgXcQ',
    'https://user:password@www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com:8443/embed/dQw4w9WgXcQ',
    'http://www.youtube.com/embed/dQw4w9WgXcQ', 'https://www.youtube.com/embed/dQw4w9WgXcQ/else', '//www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/watch?v=short', 'https://www.youtube.com/watch?v=OHOpb2fS-cM&v=dQw4w9WgXcQ',
    'https://www.youtube.com/redirect?v=OHOpb2fS-cM', 'https://youtu.be/OHOpb2fS-cM/extra',
    'https://youtu.be.evil.invalid/OHOpb2fS-cM', 'https://user:password@youtu.be/OHOpb2fS-cM',
    'https://www.youtube.com/watch?v=OHOpb2fS-cM\n', 'https://www.youtube.com/watch?v=OHOpb2fS-cM\\']) {
    equal(lib.externalVideoEmbed(value), null, 'Unapproved frame URL blocked');
  }
  const NativeCustomEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = class extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } };
  const runtime = (stored, options = {}) => {
    const win = new EventTarget();
    let raw = stored;
    let currentScript = null;
    const requests = [], cookieWrites = [];
    let reloads = 0;
    win.localStorage = { getItem() { return raw; } };
    win.location = { pathname: options.pathname || '/', hostname: 'www.synthetic.example.invalid' };
    win.setInterval = () => 1; win.clearInterval = () => {};
    const doc = { get cookie() { return '_ga=synthetic; _ga_TEST=synthetic; akrasia_chat_session=keep; _gid=synthetic'; },
      set cookie(value) { cookieWrites.push(value); },
      createElement() { return {}; },
      getElementById() { return currentScript ? { remove() { currentScript = null; } } : null; },
      head: { append(script) { currentScript = script; requests.push(script.src); } } };
    const stop = lib.initializePrivacyRuntime({ analyticsEnabled: options.enabled !== false, containerId: options.id || 'GTM-SYNTHETIC' },
      { win, doc, reload() { reloads++; } });
    return { win, requests, cookieWrites, stop, get reloads() { return reloads; }, update(value) { raw = value; win.dispatchEvent(new Event(lib.PRIVACY_CHANGE_EVENT)); },
      storage(value, key = lib.PRIVACY_STORAGE_KEY) { raw = value; const event = new Event('storage'); event.key = key; win.dispatchEvent(event); } };
  };
  try {
    for (const value of [null, '{broken', JSON.stringify({ ...preference, version: 0 }), JSON.stringify({ ...preference, analytics: false })]) {
      const app = runtime(value); equal(app.requests.length, 0, 'No analytics request before consent/after rejection'); app.stop();
    }
    for (const options of [{ enabled: false }, { pathname: '/dashboard' }, { pathname: '/dashboard/login' }, { id: 'invalid&id=GTM-OTHER' }]) {
      const app = runtime(JSON.stringify(preference), options); equal(app.requests.length, 0, 'Unreviewed GTM/dashboard always blocked'); app.stop();
    }
    const app = runtime(null);
    app.update(JSON.stringify(preference)); equal(app.requests.length, 1, 'Accept loads once');
    app.update(JSON.stringify(preference)); equal(app.requests.length, 1, 'Repeated choice never duplicates script');
    app.storage(JSON.stringify({ ...preference, analytics: false })); equal(app.reloads, 1, 'Withdrawal from another tab forces restart');
    ok(app.cookieWrites.some(value => value.startsWith('_ga=')), 'Known first-party analytics cookies expired');
    ok(app.cookieWrites.every(value => !value.startsWith('akrasia_chat_session=')), 'Chat session/quota identity untouched');
    app.update(null); equal(app.reloads, 1, 'One reload per withdrawal'); app.stop();
    const old = runtime(JSON.stringify(preference)); old.storage('{broken'); equal(old.reloads, 1, 'Corrupted storage stops already loaded tags'); old.stop();
    const cleared = runtime(JSON.stringify(preference)); cleared.storage(null, null); equal(cleared.reloads, 1, 'Storage clear in other tab stops tags'); cleared.stop();
    const reload = runtime(JSON.stringify({ ...preference, analytics: false })); equal(reload.requests.length, 0, 'Denied choice remains blocked after reload'); reload.stop();
    const persisted = runtime(JSON.stringify(preference)); equal(persisted.requests.length, 1, 'Valid persisted consent enables reviewed container'); persisted.stop();
  } finally { globalThis.CustomEvent = NativeCustomEvent; }
  const layout = await readFile('src/layouts/Layout.astro', 'utf8');
  const dashboard = await readFile('src/layouts/DashboardLayout.astro', 'utf8');
  const footer = await readFile('src/components/Footer.astro', 'utf8');
  const component = await readFile('src/components/PrivacyConsent.astro', 'utf8');
  ok(!/googletagmanager|fonts\.googleapis|fonts\.gstatic|<iframe|preconnect|dns-prefetch/.test(layout), 'Layout has no unconditional third-party load');
  ok(!/PrivacyConsent|googletagmanager|gtag|dataLayer|fonts\.google/.test(dashboard), 'Dashboard excludes public analytics runtime entirely');
  for (const page of ['privacidad', 'aviso-legal', 'cookies']) ok(footer.includes(`href="/${page}"`), `Visible ${page} link`);
  ok(component.includes('data-privacy-accept') && component.includes('data-privacy-reject') && component.includes('data-privacy-settings'), 'Three choices accessible');
  ok(!/checked(?:=|\s|>)/.test(component), 'Optional choices are not preselected');
  const publicProjects = await vite.ssrLoadModule('/src/lib/public-projects.ts');
  for (const image of ['https://third-party.invalid/x.png', '//third-party.invalid/x.png', '/\\third-party.invalid/x.png', 'data:image/svg+xml,test', '/x image.png']) {
    equal(publicProjects.localProjectImage(image), '', 'Alternate client image paths fail closed');
  }
  equal(publicProjects.localProjectImage('/img/out.jpg'), '/img/out.jpg', 'Local public image accepted');
  // The real projection reads a fake store; it must suppress remote thumbnails while preserving publication fields.
  const nativeFetch = globalThis.fetch;
  const rows = [{ id: '00000000-0000-4000-8000-000000000001', slug: 'synthetic', title: 'Ficticio', is_published: true,
    thumbnail: 'https://third-party.invalid/tracking.png', video_url: 'https://www.youtube.com/embed/dQw4w9WgXcQ' }];
  globalThis.fetch = async input => { equal(new URL(input).hostname, 'synthetic.invalid', 'Only synthetic store requested');
    return new Response(JSON.stringify(rows), { headers: { 'content-type': 'application/json' } }); };
  try {
    equal((await publicProjects.getPublicProjects())[0].thumbnail, '', 'Real public projection suppresses remote tracking image');
    rows[0].thumbnail = '/favicon.svg';
    equal((await publicProjects.getPublicProjects())[0].thumbnail, '/favicon.svg', 'Local approved thumbnail retained');
    rows[0].is_published = false;
    equal((await publicProjects.getPublicProjects()).length, 0, 'Privacy filtering preserves publication boundary');
  }
  finally { globalThis.fetch = nativeFetch; }
  console.log(`A09 consent: ${assertions} assertions passed; provider/runtime simulated, no external requests.`);
} finally { await vite.close(); }
