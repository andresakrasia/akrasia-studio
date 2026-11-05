import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const guard = installFetchGuard([]);
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
let checks = 0;
const equal = (actual, expected, message) => { checks++; assert.deepEqual(actual, expected, message); };
const ok = (value, message) => { checks++; assert.ok(value, message); };
const nativeCustomEvent = globalThis.CustomEvent;
globalThis.CustomEvent = class extends Event { constructor(type, options = {}) { super(type); this.detail = options.detail; } };
try {
  const analytics = await vite.ssrLoadModule('/src/lib/analytics.ts');
  const privacy = await vite.ssrLoadModule('/src/lib/privacy-consent.ts');
  const options = { analyticsEnabled: true, containerId: 'GTM-SYNTHETIC', ga4Reviewed: true, measurementId: 'G-SYNTHETIC' };
  const preference = { version: 1, updatedAt: Date.now(), analytics: true, externalMedia: false };
  const runtime = ({ stored = null, pathname = '/', config = options, canonical = 'https://akrasia.studio/?lang=en&email=private@example.invalid&chat=contact#private' } = {}) => {
    const win = new EventTarget();
    const requests = [], cookies = [];
    let raw = stored, script = null, reloads = 0, tick, deadline, deadlineDelay, timeoutClears = 0;
    win.location = { pathname, hostname: 'akrasia.studio', href: `https://akrasia.studio${pathname}?token=private-token` };
    win.localStorage = { getItem() { return raw; } };
    win.setInterval = callback => { tick = callback; return 1; }; win.clearInterval = () => {};
    win.setTimeout = (callback, delay) => { deadline = callback; deadlineDelay = delay; return 2; };
    win.clearTimeout = () => { timeoutClears++; deadline = undefined; };
    const doc = { documentElement: { lang: 'en' }, querySelector() { return { getAttribute() { return canonical; } }; },
      get cookie() { return '_ga=synthetic; _ga_SYNTHETIC=synthetic; _gid=synthetic; __Host-akrasia_chat=keep'; },
      set cookie(value) { cookies.push(value); }, createElement() { return {}; },
      getElementById(id) { return script?.id === id ? { remove() { script = null; } } : null; },
      head: { append(value) { script = value; requests.push({ ...value }); } } };
    const stop = privacy.initializePrivacyRuntime(config, { win, doc, reload() { reloads++; } });
    return { win, requests, cookies, stop, tick: () => tick(), deadline: () => deadline(),
      get deadlineDelay() { return deadlineDelay; }, get timeoutClears() { return timeoutClears; },
      get reloads() { return reloads; }, get script() { return script; },
      set(value, event = privacy.PRIVACY_CHANGE_EVENT) { raw = value; if (event) win.dispatchEvent(new Event(event)); },
      storage(value, key = privacy.PRIVACY_STORAGE_KEY) { raw = value; const event = new Event('storage'); event.key = key; win.dispatchEvent(event); },
      commands: () => (win.dataLayer || []).filter(value => !value.event).map(value => Array.from(value)),
      publicEvents: () => (win.dataLayer || []).filter(value => value.event || value[0] === 'event').map(value => value.event ? value : Array.from(value)) };
  };

  equal(analytics.analyticsDestination(options), { kind: 'ga4', id: 'G-SYNTHETIC' }, 'One GA4 destination takes priority over reviewed GTM');
  equal(analytics.analyticsDestination({ ...options, ga4Reviewed: false }), { kind: 'gtm', id: 'GTM-SYNTHETIC' }, 'Unreviewed prepared GA4 does not activate');
  equal(analytics.analyticsDestination({ ...options, measurementId: '' }), null, 'Reviewed GA4 without an ID blocks both modes');
  equal(analytics.analyticsDestination({ ...options, measurementId: 'G-OTHER&send_to=G-SECRET' }), null, 'Invalid GA4 ID never falls back to another account');
  equal(analytics.analyticsDestination(analytics.analyticsOptionsFromEnv({})), null, 'Empty installation has no invented analytics destination');
  equal(analytics.analyticsDestination({ analyticsEnabled: false, containerId: 'GTM-SYNTHETIC' }), null, 'An ID alone is insufficient');

  equal(analytics.analyticsPageLocation('https://akrasia.studio/servicios/vfx?email=private@example.invalid&lang=en&token=secret#private'),
    'https://akrasia.studio/servicios/vfx?lang=en', 'Free queries and fragments are excluded from measurement');
  equal(analytics.analyticsPageLocation('https://akrasia.studio/?lang=es&chat=contact'), 'https://akrasia.studio/', 'Spanish canonical has no query');
  for (const value of ['https://akrasia.studio/dashboard/private-secret', 'https://akrasia.studio/api/visitor-history',
    'javascript:private()', 'https://user:private@akrasia.studio/', 'https://akrasia.studio/proyectos/private%40email.invalid']) {
    equal(analytics.analyticsPageLocation(value), 'https://akrasia.studio/', 'Nonpublic paths and credential URLs are never measured');
  }
  for (const stored of [null, '{broken', JSON.stringify({ ...preference, analytics: false }),
    JSON.stringify({ ...preference, updatedAt: Date.now() - privacy.PRIVACY_TTL_MS })]) {
    const app = runtime({ stored });
    analytics.trackPublicEvent('chat_start', { language: 'en' });
    equal(app.requests.length, 0, 'No tag, consent ping or event request before current consent');
    equal(app.win.dataLayer, undefined, 'No analytics queue before current consent');
    app.stop();
  }
  for (const pathname of ['/dashboard', '/dashboard/login', '/dashboard/private-secret']) {
    const app = runtime({ stored: JSON.stringify(preference), pathname });
    analytics.trackPublicEvent('booking_confirmed', { language: 'es' });
    equal(app.requests.length, 0, 'Dashboard never loads public analytics');
    equal(app.win.dataLayer, undefined, 'Dashboard never queues visitor activity'); app.stop();
  }
  const app = runtime();
  analytics.trackPublicEvent('chat_start', { language: 'en' });
  app.set(JSON.stringify(preference));
  equal(app.deadlineDelay, 2_147_483_647, 'Long consent expiry timers are capped and rescheduled safely');
  equal(app.requests.length, 1, 'Acceptance loads one script');
  ok(app.requests[0].src.includes('/gtag/js?id=G-SYNTHETIC') && !app.requests[0].src.includes('/gtm.js'), 'GA4 does not also load GTM');
  equal(app.requests[0].referrerPolicy, 'no-referrer', 'Loader URL does not reveal referring page');
  const config = app.commands().find(command => command[0] === 'config')[2];
  equal(config.allow_google_signals, false, 'Google Signals disabled');
  equal(config.allow_ad_personalization_signals, false, 'Ad personalization disabled');
  equal(config.send_page_view, false, 'Automatic duplicate and raw-URL pageview disabled');
  equal(config.cookie_expires, privacy.PRIVACY_TTL_MS / 1000, 'Analytics cookies limited to 180 days');
  equal(config.cookie_update, false, 'Visits do not renew cookie duration');
  equal(config.page_location, 'https://akrasia.studio/?lang=en', 'GA4 configuration receives clean canonical');
  equal(config.page_referrer, '', 'Private previous URLs are excluded');
  equal(app.commands()[0], ['consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }], 'Advertising consent stays denied after analytical acceptance');
  equal(app.publicEvents().map(command => command[1]), ['page_view'], 'Only one explicit pageview, no preconsent chat replay');
  analytics.trackPublicEvent('chat_start', { language: 'en' });
  analytics.trackPublicEvent('booking_confirmed', { language: 'es' });
  equal(app.publicEvents().map(command => command[1]), ['page_view', 'chat_start', 'booking_confirmed'], 'Allowed public events use fixed names');
  const eventCount = app.publicEvents().length;
  for (const [event, parameters] of [['private_text', { language: 'en' }], ['chat_start', { language: 'fr' }],
    ['chat_start', { language: 'en', email: 'private@example.invalid' }], ['booking_confirmed', { language: 'es', booking_id: 'private-booking' }]]) {
    analytics.trackPublicEvent(event, parameters);
    equal(app.publicEvents().length, eventCount, 'Unknown events, arbitrary values and personal parameters rejected');
  }
  for (const command of app.publicEvents()) {
    equal(Object.keys(command[2]).sort(), ['language', 'page_location', 'page_referrer', 'page_title', 'send_to'], 'Only allowlisted event parameters exist');
    ok(!JSON.stringify(command).includes('private') && !JSON.stringify(command).includes('token'), 'No arbitrary URL data enters the queue');
  }
  app.set(JSON.stringify(preference)); equal(app.requests.length, 1, 'Repeated acceptance never duplicates collection');
  app.storage(JSON.stringify({ ...preference, analytics: false }));
  equal(app.reloads, 1, 'Withdrawal in another tab reloads active integration');
  equal(app.script, null, 'Withdrawn tag removed');
  equal(app.win['ga-disable-G-SYNTHETIC'], true, 'Already loaded GA4 explicitly disabled before reload');
  equal(app.win.dataLayer, [], 'Queued events cleared on withdrawal');
  analytics.trackPublicEvent('chat_start', { language: 'en' });
  equal(app.win.dataLayer, [], 'New events cannot be queued after withdrawal');
  ok(app.cookies.some(value => value.startsWith('_ga=')) && app.cookies.some(value => value.startsWith('_ga_SYNTHETIC=')), 'Known analytics cookies removed');
  ok(app.cookies.every(value => !value.startsWith('__Host-akrasia_chat=')), 'Chat storage remains independent of analytics');
  app.tick(); equal(app.reloads, 1, 'Withdrawal reload is requested once'); app.stop();

  for (const event of ['focus', 'pageshow', 'deadline', null]) {
    const expiring = runtime({ stored: JSON.stringify(preference) });
    expiring.set(JSON.stringify({ ...preference, updatedAt: Date.now() - privacy.PRIVACY_TTL_MS }), null);
    const count = expiring.publicEvents().length;
    analytics.trackPublicEvent('booking_confirmed', { language: 'es' });
    equal(expiring.publicEvents().length, count, 'Expired acceptance blocks an event even before a timer runs');
    if (event === 'deadline') expiring.deadline();
    else if (event) expiring.win.dispatchEvent(new Event(event)); else expiring.tick();
    equal(expiring.reloads, 1, 'Consent expiry stops active collection on focus/pageshow/deadline/interval');
    equal(expiring.win.dataLayer, [], 'Expiry erases queued events'); expiring.stop();
  }
  const corrupted = runtime({ stored: JSON.stringify(preference) });
  corrupted.storage('{broken'); equal(corrupted.reloads, 1, 'Malformed stored preference revokes active GA4'); corrupted.stop();
  const cleared = runtime({ stored: JSON.stringify(preference) });
  cleared.storage(null, null); equal(cleared.reloads, 1, 'Clearing storage in another tab revokes active GA4'); cleared.stop();
  const denied = runtime({ stored: JSON.stringify({ ...preference, analytics: false }) });
  equal(denied.requests.length, 0, 'Reload with denied preference cannot restart analytics'); denied.stop();
  const nearDeadline = runtime({ stored: JSON.stringify({ ...preference, updatedAt: Date.now() - privacy.PRIVACY_TTL_MS + 3000 }) });
  ok(nearDeadline.deadlineDelay > 0 && nearDeadline.deadlineDelay <= 3000, 'An almost-expired consent is scheduled for its real deadline');
  nearDeadline.stop(); ok(nearDeadline.timeoutClears > 0, 'Disposed runtime clears its deadline timer');
  const gtm = runtime({ stored: JSON.stringify(preference), config: { ...options, ga4Reviewed: false } });
  equal(gtm.requests.length, 1, 'Reviewed legacy GTM still works');
  ok(gtm.requests[0].src.includes('/gtm.js?id=GTM-SYNTHETIC'), 'Only reviewed GTM destination loaded');
  analytics.trackPublicEvent('booking_confirmed', { language: 'es' });
  const legacy = gtm.publicEvents().find(value => value.event === 'akrasia_booking_confirmed');
  equal(legacy, { event: 'akrasia_booking_confirmed', language: 'es', page_location: 'https://akrasia.studio/?lang=en', page_referrer: '', page_title: 'AKRASIA STUDIO' }, 'GTM receives the same sanitized public event contract');
  gtm.stop();
  console.log(`PASS: ${checks} analytics assertions; GA4/GTM, no preconsent requests, sanitized events, expiry and withdrawal. No real provider contacted.`);
} finally {
  globalThis.CustomEvent = nativeCustomEvent;
  await vite.close(); guard.restore();
}
