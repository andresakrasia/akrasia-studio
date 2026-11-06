import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { createPublicWebFixture, PRIVATE_MARKER } from './public-web-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://localhost:4331';
const verificationToken = 'synthetic_google_verification_2026';
const fixture = await createPublicWebFixture();
const guard = installFetchGuard([origin, fixture.origin]);
let child, temporary, groups = 0, assertions = 0;
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const equal = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
const group = async (name, action) => { await action(); console.log('ok ' + ++groups + ' - ' + name); };
const html = async (route, status = 200) => {
  const response = await fetch(origin + route); equal(response.status, status, route);
  const body = await response.text(); ok(!body.includes(PRIVATE_MARKER), 'No private data ' + route);
  return body;
};
try {
  temporary = await mkdtemp(path.join(tmpdir(), 'akrasia-public-web-'));
  let startup = '';
  child = spawn(process.execPath, ['--import', pathToFileURL(path.join(root, 'scripts/dashboard-test-network-guard.mjs')).href,
    path.join(root, 'node_modules/astro/bin/astro.mjs'), 'dev', '--host', 'localhost', '--port', '4331', '--config', 'scripts/astro-projects-test.config.mjs'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...fixture.environment(origin), ASTRO_TELEMETRY_DISABLED: '1', AKRASIA_TEST_ENV_DIR: temporary,
      AKRASIA_TEST_ALLOWED_ORIGINS: JSON.stringify([origin, fixture.origin]), PUBLIC_GOOGLE_SITE_VERIFICATION: verificationToken },
  });
  child.stdout.on('data', value => { startup = (startup + value).slice(-12000); });
  child.stderr.on('data', value => { startup = (startup + value).slice(-12000); });
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try { const response = await fetch(origin + '/api/projects'); if (response.ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) throw new Error('Synthetic Astro exited: ' + startup);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  ok(ready, 'Synthetic SSR ready: ' + startup);
  const publicProject = fixture.tables.projects.find(project => project.is_published);
  const publicService = fixture.tables.services.find(service => service.is_published);
  const routes = ['/servicios', '/servicios/' + publicService.slug, '/proyectos', '/proyectos/' + publicProject.slug, '/contacto'];
  const metadata = (body, route, lang) => {
    ok(new RegExp('<html[^>]+lang="' + lang + '"').test(body), 'HTML language ' + route);
    equal((body.match(/<h1(?:\s|>)/g) || []).length, 1, 'One h1 ' + route);
    ok(body.includes('href="https://akrasia.studio' + route + (lang === 'en' ? '?lang=en' : '') + '"'), 'Clean public canonical ' + route);
    ok(body.includes('name="google-site-verification" content="' + verificationToken + '"'), 'Search Console verification available in SSR');
    ok(body.includes('id="main-content"'), 'Skip destination ' + route);
  };
  await group('Home SSR preserves the HUD, language and conversation navigation', async () => {
    for (const lang of ['es','en']) {
      const target = '/' + (lang === 'en' ? '?lang=en' : '');
      const body = await html(target);
      ok(new RegExp('<html[^>]+lang="' + lang + '"').test(body), 'HTML language ' + target);
      equal((body.match(/<h1(?:\s|>)/g) || []).length, 1, 'One h1 ' + target);
      ok(body.includes('id="main-content"'), 'Skip destination');
      ok(body.includes('href="https://akrasia.studio' + target + '"'), 'Canonical ' + target);
      for (const alternate of ['es','en','x-default']) ok(body.includes('hreflang="' + alternate + '"'), 'Language alternative');
      for (const intent of ['services','portfolio','contact','manifesto','start']) {
        ok(body.includes('chat=' + intent), 'Conversation navigation: ' + intent);
      }
      ok(body.includes('data-chat-message='), 'Predefined messages available to chat island');
      for (const route of ['/servicios', '/proyectos', '/contacto']) {
        ok(new RegExp('<a\\b[^>]*href="' + route + (lang === 'en' ? '\\?lang=en' : '') + '"').test(body), 'Readable editorial navigation ' + route);
      }
      ok(body.includes('name="google-site-verification" content="' + verificationToken + '"'), 'Configured Search Console token renders before JavaScript');
      ok(!body.includes('id="akrasia-loader"'), 'No blocking loader');
      ok(!body.includes('dQw4w9WgXcQ') && !body.includes('NEON ODYSSEY'), 'No demo portfolio');
      ok(body.includes('https://akrasia.studio/img/og-akrasia.png'), 'Absolute existing social asset');
      ok(!body.includes('/favicon.ico'), 'No missing favicon');
    }
  });
  await group('Editorial routes render public text, clean metadata and chat entry points before JavaScript', async () => {
    for (const route of routes) for (const lang of ['es','en']) {
      const response = await fetch(origin + route + '?lang=' + lang + '&visitor_id=discard-me&secret=discard-me', { redirect: 'manual' });
      equal(response.status, 200, 'Public editorial page ' + route);
      equal(response.headers.get('Location'), null, 'Editorial route renders directly');
      const body = await response.text();
      metadata(body, route, lang);
      for (const alternate of ['es','en','x-default']) ok(body.includes('hreflang="' + alternate + '"'), 'Complete public language alternative');
      ok(!body.includes(PRIVATE_MARKER), 'Only public content rendered');
      ok(!body.includes('discard-me'), 'Identity and arbitrary query are not reflected');
      ok(body.includes('chat='), 'Editorial page offers a conversation entry point');
      ok(!body.includes('content="noindex'), 'Available public page can be indexed');
    }
    const service = await html('/servicios/' + publicService.slug);
    for (const text of ['Servicio audiovisual ficticio', 'Contenido editorial ficticio', 'Pieza ficticia', 'Brief ficticio']) ok(service.includes(text), 'Approved service editorial text: ' + text);
    const englishService = await html('/servicios/' + publicService.slug + '?lang=en');
    for (const text of ['Synthetic audiovisual service', 'Synthetic editorial content', 'Synthetic piece', 'Synthetic brief']) ok(englishService.includes(text), 'Real service translation: ' + text);
    const project = await html('/proyectos/' + publicProject.slug);
    for (const text of [publicProject.title, 'Encargo ficticio aprobado', 'Proceso ficticio aprobado', 'Resultado ficticio aprobado']) ok(project.includes(text), 'Approved project editorial text: ' + text);
    const englishProject = await html('/proyectos/' + publicProject.slug + '?lang=en');
    for (const text of ['Approved synthetic brief', 'Approved synthetic process', 'Approved synthetic result']) ok(englishProject.includes(text), 'Real case study translation: ' + text);
    ok((await html('/contacto')).includes('mailto:info@akrasia.studio'), 'Contact address available before JavaScript');
  });
  await group('Invalid and unpublished editorial routes cannot reveal private content', async () => {
    const before = fixture.requests.length;
    for (const kind of ['servicios','proyectos']) for (const slug of ['UPPER','bad_slug','a%3Ab','%3Cscript%3E','a'.repeat(121)]) {
      const response = await fetch(origin + '/' + kind + '/' + slug, { redirect: 'manual' });
      equal(response.status, 404, 'Invalid slug is rejected'); equal(response.headers.get('Location'), null, 'Invalid slug is never propagated');
      const body = await response.text();
      ok(/<h1[^>]*>[^<]*no encontrado<\/h1>/.test(body), 'Invalid input has a generic missing-page title');
      ok(!body.includes(PRIVATE_MARKER), 'Invalid route has no private data');
    }
    equal(fixture.requests.length, before, 'Invalid slugs never query catalogue or private storage');
    for (const route of ['/servicios/private-service', '/proyectos/a06-planning-private', '/servicios/not-published', '/proyectos/not-published']) {
      const response = await fetch(origin + route, { redirect: 'manual' });
      equal(response.status, 404, 'Unpublished or missing catalogue entry ' + route);
      equal(response.headers.get('Location'), null, 'Missing page does not redirect to an apparent public entry');
      ok(!(await response.text()).includes(PRIVATE_MARKER), 'Missing page contains no private text');
    }
    fixture.state.ignoreProjectFilters = true;
    try {
      const body = await html('/proyectos/' + publicProject.slug);
      ok(body.includes(publicProject.title), 'Target public project survives a store that ignores filters');
    } finally { fixture.state.ignoreProjectFilters = false; }
  });
  await group('Published catalogue stays in the home HUD; legal information remains accessible', async () => {
    const home = await html('/?lang=en');
    ok(home.includes('Synthetic audiovisual service'), 'Approved translated service server rendered');
    ok(home.includes('chat=service%3Apublic-service'), 'Approved service opens a predefined chat topic');
    ok(home.includes('chat=project%3A' + publicProject.slug), 'Approved project opens a predefined chat topic');
    const serviceResponse = await fetch(origin + '/api/services?slug=private-service');
    equal(serviceResponse.status, 404, 'Unpublished service stays outside public API');
    equal((await fetch(origin + '/api/projects?slug=a06-planning-private')).status, 404, 'Unpublished project stays outside public API');
    const approvedService = fixture.tables.services.find(item => item.is_published);
    const translated = Object.fromEntries(Object.entries(approvedService).filter(([key]) => key.endsWith('_en')));
    for (const key of Object.keys(translated)) approvedService[key] = Array.isArray(translated[key]) ? [] : '';
    const untranslatedService = await html('/?lang=en');
    ok(untranslatedService.includes('Servicio audiovisual ficticio'), 'Original public service title remains available');
    ok(/<strong[^>]*lang="es"[^>]*>Servicio audiovisual ficticio/.test(untranslatedService), 'Untranslated service title has its real language');
    Object.assign(approvedService,translated);
    for (const route of ['/privacidad','/aviso-legal','/cookies']) {
      const body = await html(route + '?lang=en');
      ok(/<html[^>]+lang="es"/.test(body), 'Legal language remains Spanish');
      ok(!body.includes('hreflang="en"'), 'No invented legal translation');
    }
  });
  const sitemapLocations = xml => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]).sort();
  const indexedRoutes = ['/', '/servicios', '/proyectos', '/contacto', '/servicios/' + publicService.slug,
    ...fixture.tables.projects.filter(project => project.is_published).map(project => '/proyectos/' + project.slug)];
  const expectedLocations = [...indexedRoutes.flatMap(route => ['es','en'].map(lang =>
    'https://akrasia.studio' + route + (lang === 'en' ? '?lang=en' : ''))),
    ...['/privacidad','/aviso-legal','/cookies'].map(route => 'https://akrasia.studio' + route)].sort();
  await group('Sitemap indexes static routes and complete approved editorial pages in their real languages', async () => {
    const before = fixture.requests.length;
    const xml = await html('/sitemap.xml');
    ok(xml.includes('xmlns:xhtml='), 'Alternates namespace');
    ok(fixture.requests.length > before, 'Sitemap reads publication state from the catalogue');
    equal(sitemapLocations(xml), expectedLocations, 'Only complete public pages and real translations indexed');
    ok(!xml.includes('chat='), 'Predefined chat topics do not produce duplicate pages');
    ok(!xml.includes('private-service') && !xml.includes('-private'), 'No private sitemap routes');
    const robotPolicy = await html('/robots.txt');
    ok(robotPolicy.includes('Disallow: /dashboard') && robotPolicy.includes('Disallow: /api/'), 'Private dashboard and APIs excluded from crawling');
    ok(robotPolicy.includes('Sitemap: https://akrasia.studio/sitemap.xml'), 'Public sitemap advertised');
  });
  await group('Incomplete translations are served honestly and never advertised as English editorial pages', async () => {
    const savedHero = publicService.hero_description_en;
    publicService.hero_description_en = '';
    try {
      const route = '/servicios/' + publicService.slug;
      const fallback = await fetch(origin + route + '?lang=en&visitor_id=discard-me&secret=discard-me', { redirect:'manual' });
      equal(fallback.status, 302, 'Incomplete English service redirects to its real language');
      equal(fallback.headers.get('Location'), route, 'Fallback service redirect discards all query parameters');
      const body = await html(route + '?lang=en');
      metadata(body, route, 'es');
      ok(body.includes('Contenido editorial ficticio'), 'Full original service editorial content remains readable');
      ok(!/<link\b[^>]*hreflang="en"/.test(body), 'Partial service translation has no English SEO alternative');
      equal(sitemapLocations(await html('/sitemap.xml')), expectedLocations.filter(url => url !== 'https://akrasia.studio' + route + '?lang=en'),
        'Partial service translation omitted from sitemap');
    } finally { publicService.hero_description_en = savedHero; }
    const savedCase = structuredClone(publicProject.case_study_en);
    for (const incomplete of [{ ...savedCase, result:'' }, { ...savedCase, services:[] }]) {
      publicProject.case_study_en = incomplete;
      try {
        const route = '/proyectos/' + publicProject.slug;
        const fallback = await fetch(origin + route + '?lang=en&visitor_id=discard-me&secret=discard-me', { redirect:'manual' });
        equal(fallback.status, 302, 'Incomplete English case study redirects to its real language');
        equal(fallback.headers.get('Location'), route, 'Fallback case study redirect discards all query parameters');
        const body = await html(route + '?lang=en');
        metadata(body, route, 'es');
        ok(body.includes('Resultado ficticio aprobado'), 'Full original case study remains readable');
        ok(!/<link\b[^>]*hreflang="en"/.test(body), 'Partial case study has no English SEO alternative');
        equal(sitemapLocations(await html('/sitemap.xml')), expectedLocations.filter(url => url !== 'https://akrasia.studio' + route + '?lang=en'),
          'Only complete case study translations indexed');
      } finally { publicProject.case_study_en = savedCase; }
    }
  });
  await group('Published catalogue entries without useful editorial content are readable but excluded from search', async () => {
    const savedService = structuredClone(publicService);
    Object.assign(publicService, { description:'', hero_description:'', features:[], process:[] });
    try {
      const route = '/servicios/' + publicService.slug;
      const body = await html(route);
      ok(body.includes(publicService.title), 'Sparse approved service is still readable');
      ok(/<meta[^>]*name="robots"[^>]*content="[^\"]*noindex/.test(body), 'Sparse service marked noindex');
      const xml = await html('/sitemap.xml');
      ok(!sitemapLocations(xml).some(url => url.startsWith('https://akrasia.studio' + route)), 'Sparse service omitted from sitemap');
    } finally { Object.assign(publicService, savedService); }
    const savedCase = structuredClone(publicProject.case_study);
    publicProject.case_study.result = '';
    try {
      const route = '/proyectos/' + publicProject.slug;
      const body = await html(route);
      ok(body.includes(publicProject.title), 'Sparse approved project is still readable');
      ok(/<meta[^>]*name="robots"[^>]*content="[^\"]*noindex/.test(body), 'Incomplete case study marked noindex');
      const xml = await html('/sitemap.xml');
      ok(!sitemapLocations(xml).some(url => url.startsWith('https://akrasia.studio' + route)), 'Incomplete case study omitted from sitemap');
    } finally { publicProject.case_study = savedCase; }
  });
  await group('Catalogue failures return 503 and noindex; sitemap never reports partial success', async () => {
    const unavailablePage = async route => {
      const body = await html(route, 503);
      ok(/<meta[^>]*name="robots"[^>]*content="[^\"]*noindex/.test(body), 'Unavailable page marked noindex ' + route);
      ok(body.includes('chat=contact'), 'Conversation contact remains available during outage');
    };
    const unavailableSitemap = async () => {
      const response = await fetch(origin + '/sitemap.xml');
      equal(response.status, 503, 'Sitemap signals a temporary failure');
      ok((response.headers.get('X-Robots-Tag') || '').includes('noindex'), 'Failed sitemap marked noindex');
      equal(response.headers.get('Retry-After'), '60', 'Crawler receives retry guidance');
      const body = await response.text();
      ok(!body.includes('<url>') && !body.includes(PRIVATE_MARKER), 'Failed sitemap does not expose a partial index or private data');
    };
    fixture.state.projectUnavailable = true;
    try {
      await unavailablePage('/proyectos'); await unavailablePage('/proyectos/' + publicProject.slug);
      await unavailableSitemap();
    } finally { fixture.state.projectUnavailable = false; }
    const savedTitle = publicService.title;
    publicService.title = null;
    try {
      await unavailablePage('/servicios'); await unavailablePage('/servicios/' + publicService.slug);
      await unavailableSitemap();
    } finally { publicService.title = savedTitle; }
    fixture.state.malformedProjects = true;
    try { await unavailableSitemap(); } finally { fixture.state.malformedProjects = false; }
    for (const table of ['services','projects']) {
      const saved = fixture.tables[table];
      const exemplar = table === 'services' ? publicService : publicProject;
      fixture.tables[table] = Array.from({ length:1001 }, (_, index) => ({ ...structuredClone(exemplar),
        id:'00000000-0000-4000-8000-' + String(index + 2000).padStart(12,'0'), slug:'published-entry-' + index }));
      try { await unavailableSitemap(); } finally { fixture.tables[table] = saved; }
    }
    equal(sitemapLocations(await html('/sitemap.xml')), expectedLocations, 'Complete sitemap recovers after catalogue becomes available');
  });
  await group('Contact fallback, unavailable states and withdrawal preserve the public boundary', async () => {
    const contact = await html('/');
    ok(contact.includes('mailto:info@akrasia.studio'), 'Confirmed contact remains available before JavaScript');
    fixture.tables.services[1].title = null;
    const failedService = await html('/');
    ok(failedService.includes('La información de servicios no está disponible'), 'Broken public catalogue has an honest unavailable state');
    ok(failedService.includes('chat=contact'), 'Unavailable services keep the chat contact topic');
    fixture.tables.services[1].title = 'Servicio audiovisual ficticio';
    const stored = fixture.tables.projects; fixture.tables.projects = [];
    const empty = await html('/');
    ok(empty.includes('Todavía no hay proyectos aprobados'), 'Honest empty portfolio');
    ok(empty.includes('chat=contact'), 'Empty portfolio keeps the chat contact topic');
    fixture.tables.projects = stored;
    const withdrawn = fixture.tables.projects.find(project => project.id === publicProject.id); withdrawn.is_published = false;
    equal((await fetch(origin + '/api/projects?slug=' + withdrawn.slug)).status, 404, 'Withdrawn project excluded by public API');
    ok(!(await html('/')).includes(withdrawn.title), 'Withdrawn project removed from HUD');
    try {
      const response = await fetch(origin + '/proyectos/' + withdrawn.slug, { redirect:'manual' });
      equal(response.status,404,'Withdrawn project is no longer a public page');
      ok(!(await response.text()).includes(withdrawn.title),'Withdrawn title never appears in the missing page');
      ok(!sitemapLocations(await html('/sitemap.xml')).some(url => url.includes('/proyectos/' + withdrawn.slug)), 'Withdrawn project removed from index immediately');
    } finally { withdrawn.is_published = true; }
    publicService.is_published = false;
    try {
      const response = await fetch(origin + '/servicios/' + publicService.slug, { redirect:'manual' });
      equal(response.status,404,'Withdrawn service is no longer a public page');
      ok(!(await response.text()).includes(publicService.title),'Withdrawn service title never appears in the missing page');
      ok(!sitemapLocations(await html('/sitemap.xml')).some(url => url.includes('/servicios/' + publicService.slug)), 'Withdrawn service removed from index immediately');
    } finally { publicService.is_published = true; }
  });
  await group('Image outputs are real, dimensioned and lighter; readable colors pass contrast checks', async () => {
    const image = await sharp(path.join(root,'public/img/og-akrasia.png')).metadata();
    equal([image.format,image.width,image.height], ['png',1200,630]);
    const old = await readFile(path.join(root,'public/img/out.jpg'));
    const optimized = await readFile(path.join(root,'public/img/out.webp'));
    ok(optimized.length < old.length / 3, 'Background weight reduced');
    const luminance = hex => {
      const values = hex.match(/.{2}/g).map(value => parseInt(value,16)/255).map(value => value <= .04045 ? value/12.92 : ((value+.055)/1.055)**2.4);
      return values[0]*.2126+values[1]*.7152+values[2]*.0722;
    };
    for (const color of ['cbd5e1','e2e8f0','b0becd','67e8f9']) ok((luminance(color)+.05)/(luminance('0e1d28')+.05) >= 4.5, 'Readable contrast ' + color);
    equal(guard.blocked, [], 'No external network requests');
  });
  console.log('PASS public web: ' + groups + ' groups, ' + assertions + ' assertions (real SSR, synthetic store; no browser or remote platform claimed).');
} catch (error) { throw error; }
finally {
  if (child) { child.kill(); await new Promise(resolve => { if (child.exitCode !== null) resolve(); else child.once('exit',resolve); }); }
  await fixture.close(); guard.restore();
  if (temporary) {
    const target = path.resolve(temporary);
    if (!target.startsWith(path.resolve(tmpdir()) + path.sep)) throw new Error('Temporary directory escaped root');
    await rm(target,{recursive:true,force:true});
  }
}

