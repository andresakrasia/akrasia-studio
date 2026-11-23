import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Pure presentation and intercepted public HTTP payloads. No .env or network.
const network = installFetchGuard([]);
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' } });
let groups = 0, assertions = 0;
const equal = (actual, expected) => { assertions++; assert.deepEqual(actual, expected); };
const ok = value => { assertions++; assert.ok(value); };
const throws = action => { assertions++; assert.throws(action); };
const rejects = async action => { assertions++; await assert.rejects(action, /Published project cards unavailable/u); };
const group = async (title, action) => { await action(); console.log(`ok ${++groups} - ${title}`); };
const project = { id: '00000000-0000-4000-8000-000000000001', slug: 'demo-audiovisual', title: 'DEMO · ORIGEN',
  category: 'Producción audiovisual', type: 'Concepto', duration: '20 s', thumbnail: '/img/demo-origen.webp', video_url: '',
  public_description: 'Concepto audiovisual ficticio.', case_study_en: { brief: 'Fictional audiovisual concept.' } };
const next = index => ({ ...project, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, slug: `project-${index}`, title: `Published project ${index}` });
const portfolio = { intent: 'portfolio' };
const selected = { intent: 'project:demo-audiovisual' };
const jsonResponse = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

try {
  const cards = await vite.ssrLoadModule('/src/lib/chat-project-cards.ts');
  const { ChatProjectCardList, ChatProjectVideoPanel } = await vite.ssrLoadModule('/src/components/ChatProjectCards.tsx');
  const navigation = await vite.ssrLoadModule('/src/lib/chat-navigation.ts');
  await group('Only public portfolio and project user selectors request cards', () => {
    for (const language of ['es', 'en']) {
      equal(cards.parseChatProjectRequest(navigation.chatIntentMessage('portfolio', language)), portfolio);
      equal(cards.parseChatProjectRequest(navigation.chatIntentMessage('project:demo-audiovisual', language)), selected);
    }
    equal(cards.parseChatProjectRequest('portfolio'), portfolio);
    equal(cards.parseChatProjectRequest('project:demo-audiovisual'), selected);
    for (const text of ['services', 'service:ai-generation', 'contact', 'project:../secret', 'project:demo-audiovisual\nextra',
      '[project](https://example.invalid)', '<div data-project-id="demo-audiovisual">', 'The AI mentioned project:demo-audiovisual']) {
      equal(cards.parseChatProjectRequest(text), null);
    }
  });
  await group('Bounded public projection drops private fields and labels only actual DEMO titles', () => {
    const list = cards.parseChatProjectPayload([{ ...project, internal_notes: 'PRIVATE_CANARY', client_name: 'PRIVATE_CLIENT' }, next(2), next(3), next(4), next(5), next(6)], portfolio);
    equal(list.length, 6);
    equal(list[0].image, '/img/demo-origen.webp');
    equal(list[0].demo, true); equal(list[1].demo, false);
    ok(!JSON.stringify(list).includes('PRIVATE'));
    equal(cards.parseChatProjectPayload([project], selected, 'en')[0].description, 'Fictional audiovisual concept.');
    for (const payload of [null, {}, Array(1001).fill(project), [project, project], [{ ...project, id: 'private-id' }],
      [{ ...project, slug: '../../private' }], [{ ...project, title: 'x'.repeat(201) }], [{ ...project, duration: 12 }],
      [{ ...project, is_published: false }], [{ ...project, is_published: 'true' }]]) throws(() => cards.parseChatProjectPayload(payload, portfolio));
    throws(() => cards.parseChatProjectPayload([next(2)], selected));
    throws(() => cards.parseChatProjectPayload([project, next(2)], selected));
  });
  await group('Media cannot load remote images or unsafe video destinations', () => {
    for (const thumbnail of ['https://example.invalid/image.webp', '//example.invalid/image.webp', 'javascript:alert(1)',
      '/api/project-media/not-a-managed-image.webp', '/api/project-media/legacy/../../secret', '/img/image.webp\n']) {
      equal(cards.parseChatProjectPayload([{ ...project, thumbnail }], portfolio)[0].image, '');
    }
    for (const video_url of ['javascript:alert(1)', 'data:text/html,evil', 'http://example.invalid/video', 'https://user:password@example.invalid/video', '/local-video',
      '//example.invalid/media/demo-origen.mp4', '/media/../private.mp4', '/media/%2e%2e/private.mp4', '/media/demo-origen.mp4?external=1',
      '/media/demo-origen.mp4#part', '/media/demo-origen.mp4\n', '/media/demo-origen.exe', '/media/demo\\evil.mp4']) {
      equal(cards.parseChatProjectPayload([{ ...project, video_url }], portfolio)[0].videoUrl, '');
    }
    equal(cards.parseChatProjectPayload([{ ...project, thumbnail: '/api/project-media/00000000-0000-4000-8000-000000000001.webp',
      video_url: 'https://player.vimeo.com/video/12345' }], portfolio)[0].videoUrl, 'https://player.vimeo.com/video/12345');
    for (const video_url of ['/media/demo-origen.mp4', '/media/demo-pulse.webm']) {
      equal(cards.parseChatProjectPayload([{ ...project, video_url }], portfolio)[0].videoUrl, video_url);
      equal(cards.chatProjectVideoSource(video_url), { kind: 'local', src: video_url });
    }
    equal(cards.chatProjectVideoSource('https://player.vimeo.com/video/12345?tracking=1'), { kind: 'external', provider: 'Vimeo', src: 'https://player.vimeo.com/video/12345?dnt=1' });
    equal(cards.chatProjectVideoSource('https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1'), { kind: 'external', provider: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?playsinline=1&rel=0' });
    equal(cards.chatProjectVideoSource('https://www.youtube.com/watch?v=OHOpb2fS-cM&feature=shared'), { kind: 'external', provider: 'YouTube', src: 'https://www.youtube-nocookie.com/embed/OHOpb2fS-cM?playsinline=1&rel=0' });
    equal(cards.chatProjectVideoSource('javascript:alert(1)'), null);
  });
  await group('Public refresh events remove withdrawn projects and never add their own data', () => {
    const projects = cards.parseChatProjectPayload([project, next(2)], portfolio);
    equal(cards.projectCardsAfterRefresh(projects, { ids: [projects[1].id], count: 1 }), [projects[1]]);
    equal(cards.projectCardsAfterRefresh(projects, { ids: [], unavailable: true }), []);
    equal(cards.projectCardsAfterRefresh(projects, { ids: ['private-id'] }), []);
    equal(cards.projectCardsAfterRefresh(projects, null), []);
    equal(cards.projectCardsAfterRefresh([], { ids: [project.id], projects: [project] }), []);
    const videoProjects = cards.parseChatProjectPayload([{ ...project, video_url: '/media/demo-origen.mp4' }, next(2)], portfolio);
    const selection = { id: project.id, videoUrl: '/media/demo-origen.mp4' };
    equal(cards.activeChatProjectVideo(videoProjects, selection), videoProjects[0]);
    equal(cards.activeChatProjectVideo(cards.projectCardsAfterRefresh(videoProjects, { ids: [videoProjects[1].id] }), selection), null);
    equal(cards.activeChatProjectVideo(cards.projectCardsAfterRefresh(videoProjects, { unavailable: true }), selection), null);
    equal(cards.activeChatProjectVideo([{ ...videoProjects[0], videoUrl: '/media/demo-other.mp4' }], selection), null);
    equal(cards.activeChatProjectVideo(videoProjects, null), null);
  });
  await group('Catalogue pages preserve publication order and clamp after filtering or withdrawal', () => {
    const projects = cards.parseChatProjectPayload(Array.from({ length: 15 }, (_, index) => next(index + 1)), portfolio);
    const frozen = Object.freeze(projects.map(item => Object.freeze(item)));
    const original = JSON.stringify(frozen);
    equal(cards.CHAT_PROJECT_PAGE_SIZE, 6);
    const first = cards.browseChatProjects(frozen);
    equal(first.items, projects.slice(0, 6));
    equal(first.total, 15); equal(first.pageCount, 3); equal(first.page, 0);
    equal(first.categories, ['Producción audiovisual']);
    equal(cards.browseChatProjects(frozen, { page: 1 }).items, projects.slice(6, 12));
    equal(cards.browseChatProjects(frozen, { page: 99 }).items, projects.slice(12));
    equal(cards.browseChatProjects(frozen, { page: 99 }).page, 2);
    equal(cards.browseChatProjects(frozen, { page: -3 }).page, 0);
    equal(cards.browseChatProjects(frozen, { page: Number.NaN }).page, 0);
    equal(cards.browseChatProjects(frozen, { page: 1.9 }).page, 1);
    equal(cards.browseChatProjects(frozen, {}, 4).items, projects.slice(0, 4));
    equal(cards.browseChatProjects(frozen, {}, 0).items, projects.slice(0, 6));
    const withdrawn = cards.projectCardsAfterRefresh(projects, { ids: projects.slice(0, 7).map(item => item.id) });
    const reduced = cards.browseChatProjects(withdrawn, { page: 2 });
    equal(reduced.page, 1); equal(reduced.pageCount, 2); equal(reduced.items, projects.slice(6, 7));
    const empty = cards.browseChatProjects([], { page: 9 });
    equal(empty, { items: [], total: 0, pageCount: 1, page: 0, categories: [] });
    equal(JSON.stringify(frozen), original);
  });
  await group('Catalogue search ignores accents and case while category choices cover the whole catalogue', () => {
    const projects = cards.parseChatProjectPayload([
      { ...next(1), title: 'CAFÉ · ÓRBITA', category: 'Dirección creativa', public_description: 'Una estética de luz ámbar.' },
      { ...next(2), title: 'Luz nocturna', category: 'Sonido', public_description: 'Café bajo la lluvia.' },
      { ...next(3), category: ' dirección CREATIVA ' },
      { ...next(4), category: '  ', type: '' },
      { ...next(5), category: 'VFX' }
    ], portfolio);
    const accented = cards.browseChatProjects(projects, { search: ' cafe AMBAR ', page: 99 });
    equal(accented.items, [projects[0]]); equal(accented.total, 1); equal(accented.page, 0);
    equal(accented.categories, ['Dirección creativa', 'Sonido', 'VFX']);
    equal(cards.browseChatProjects(projects, { search: 'cafe' }).items, projects.slice(0, 2));
    equal(cards.browseChatProjects(projects, { search: 'direccion' }).items, [projects[0], projects[2]]);
    equal(cards.browseChatProjects(projects, { category: 'DIRECCION CREATIVA' }).items, [projects[0], projects[2]]);
    equal(cards.browseChatProjects(projects, { category: 'Sonido', search: 'CAFE' }).items, [projects[1]]);
    const missing = cards.browseChatProjects(projects, { category: 'Sonido', search: 'Ámbar', page: 5 });
    equal(missing.items, []); equal(missing.total, 0); equal(missing.page, 0); equal(missing.pageCount, 1);
    equal(missing.categories, ['Dirección creativa', 'Sonido', 'VFX']);
  });
  await group('Loader reads only current local public API and fails without fallback', async () => {
    const requests = [];
    const intercepted = async (url, init) => { requests.push({ url, init }); return jsonResponse([project]); };
    equal((await cards.loadChatProjectCards(selected, 'es', { fetch: intercepted })).length, 1);
    equal(requests[0].url, '/api/projects?slug=demo-audiovisual');
    equal(requests[0].init.cache, 'no-store'); equal(requests[0].init.credentials, 'same-origin');
    equal(requests[0].init.redirect, 'error'); ok(requests[0].init.signal instanceof AbortSignal);
    equal(await cards.loadChatProjectCards(portfolio, 'es', { fetch: async () => jsonResponse([]) }), []);
    for (const status of [404, 503]) await rejects(() => cards.loadChatProjectCards(selected, 'es', { fetch: async () => jsonResponse({ error: 'PRIVATE_PROVIDER_DIAGNOSTIC' }, status) }));
    await rejects(() => cards.loadChatProjectCards(portfolio, 'es', { fetch: async () => new Response('<script>PRIVATE()</script>', { headers: { 'content-type': 'text/html' } }) }));
    let cancelled = false;
    const oversized = () => new Response(new ReadableStream({ cancel() { cancelled = true; } }), {
      headers: { 'content-type': 'application/json', 'content-length': String(cards.CHAT_PROJECT_PAYLOAD_BYTES + 1) } });
    await rejects(() => cards.loadChatProjectCards(portfolio, 'es', { fetch: async () => oversized() }));
    equal(cancelled, true);
    cancelled = false;
    await rejects(() => cards.loadChatProjectCards(portfolio, 'es', { fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(cards.CHAT_PROJECT_PAYLOAD_BYTES + 1)); }, cancel() { cancelled = true; }
    }), { headers: { 'content-type': 'application/json' } }) }));
    equal(cancelled, true);
    const controller = new AbortController();
    let abortedBody = false;
    await rejects(() => cards.loadChatProjectCards(portfolio, 'es', { signal: controller.signal, fetch: async () => {
      setTimeout(() => controller.abort(), 5);
      return new Response(new ReadableStream({ cancel() { abortedBody = true; } }), { headers: { 'content-type': 'application/json' } });
    } }));
    equal(abortedBody, true);
  });
  await group('React cards escape editorial text and keep playback inside React without delegated modal triggers', () => {
    const attack = '<img src=x onerror="window.injected=1"><script>PRIVATE()</script>';
    const projects = cards.parseChatProjectPayload([{ ...project, title: attack, public_description: attack,
      video_url: 'https://player.vimeo.com/video/12345', internal_notes: 'PRIVATE_CANARY' }], portfolio);
    const html = renderToStaticMarkup(createElement(ChatProjectCardList, { projects, language: 'es', onSendMessage: () => { throw new Error('No action during rendering'); }, disabled: true }));
    ok(html.includes('&lt;img'));
    ok(!/<script\b|<iframe\b|<video\b|\son[a-z]+=["']/iu.test(html));
    ok(!html.includes('PRIVATE_CANARY'));
    ok(!html.includes('data-video-open'));
    ok(!html.includes('data-project-video'));
    ok(html.includes(`data-chat-project-id="${project.id}"`));
    ok(html.includes('src="/img/demo-origen.webp"'));
    ok(!html.includes('href='));
    ok(html.includes('disabled=""'));
    equal(cards.projectInspirationMessage(projects[0], 'es'), `Quiero algo inspirado en el proyecto «${attack}» (demo-audiovisual). Ayúdame a definir el encargo.`);
    ok(cards.projectInspirationMessage(projects[0], 'en').includes('Help me define the brief.'));
    const six = cards.parseChatProjectPayload([project, next(2), next(3), next(4), next(5), next(6)], portfolio);
    const gallery = renderToStaticMarkup(createElement(ChatProjectCardList, { projects: six, language: 'en', onSendMessage: () => {} }));
    equal((gallery.match(/<li\b/gu) || []).length, 6);
    equal(network.blocked.length, 0);
  });
  await group('Large catalogues expose labelled search, type selection and six-card page navigation', () => {
    const projects = cards.parseChatProjectPayload(Array.from({ length: 15 }, (_, index) => ({ ...next(index + 1),
      category: index === 13 ? 'Sonido' : index === 14 ? 'VFX' : project.category,
      video_url: '/media/demo-pulse.mp4' })), portfolio);
    for (const language of ['es', 'en']) {
      const english = language === 'en';
      const html = renderToStaticMarkup(createElement(ChatProjectCardList, { projects, language,
        onSendMessage: () => { throw new Error('No action during rendering'); } }));
      equal((html.match(/<li\b/gu) || []).length, 6);
      ok(html.includes(english ? '1–6 of 15 projects' : '1–6 de 15 proyectos'));
      const labels = [...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"[^>]*>([^<]+)<\/label>/gu)];
      const searchLabel = labels.find(([, , text]) => text === (english ? 'Search projects' : 'Buscar proyectos'));
      const typeLabel = labels.find(([, , text]) => text === (english ? 'Project type' : 'Tipo de proyecto'));
      ok(searchLabel); ok(typeLabel);
      const searchInput = (html.match(/<input\b[^>]*>/gu) || []).find(tag => tag.includes('type="search"'));
      ok(searchInput?.includes(`id="${searchLabel[1]}"`));
      const select = html.match(/<select\b[^>]*>/u)?.[0];
      ok(select?.includes(`id="${typeLabel[1]}"`));
      ok(html.includes(`<option value="" selected="">${english ? 'All types' : 'Todos los tipos'}</option>`));
      ok(html.includes('<option value="Sonido">Sonido</option>') && html.includes('<option value="VFX">VFX</option>'));
      const buttons = html.match(/<button\b[^>]*>/gu) || [];
      const previous = buttons.find(tag => tag.includes(`aria-label="${english ? 'Previous projects' : 'Proyectos anteriores'}"`));
      const following = buttons.find(tag => tag.includes(`aria-label="${english ? 'Next projects' : 'Siguientes proyectos'}"`));
      ok(previous?.includes('disabled=""'));
      ok(following && !following.includes('disabled=""'));
      equal(buttons.filter(tag => tag.includes(`aria-label="${english ? 'Play' : 'Reproducir'} Published project `)).length, 6);
      equal((html.match(new RegExp(english ? 'I want something like this' : 'Quiero algo así', 'gu')) || []).length, 6);
      ok(html.includes(english ? '>Watch</button>' : '>Ver vídeo</button>'));
      ok(!/<video\b|<iframe\b/iu.test(html));
    }
    equal(network.blocked.length, 0);
  });
  await group('Inline HUD player uses native local controls and external providers load only after consent', () => {
    const local = cards.parseChatProjectPayload([{ ...project, video_url: '/media/demo-origen.mp4' }], portfolio)[0];
    const render = (video, externalMediaAllowed = false, language = 'es') => renderToStaticMarkup(createElement(ChatProjectVideoPanel,
      { project: video, language, externalMediaAllowed, onClose: () => { throw new Error('No action during rendering'); } }));
    const html = render(local);
    ok(html.includes('chat-project-video-panel'));
    ok(html.includes('<video'));
    ok(html.includes('src="/media/demo-origen.mp4"'));
    ok(html.includes('poster="/img/demo-origen.webp"'));
    ok(html.includes('controls=""') && /playsinline=""/iu.test(html) && html.includes('preload="metadata"'));
    ok(!/autoplay|<iframe|<dialog|data-video-open/iu.test(html));
    ok(html.includes('Previsualización ficticia'));
    ok(html.includes('Volver a proyectos'));
    const external = { ...local, videoUrl: 'https://player.vimeo.com/video/12345' };
    const denied = render(external);
    ok(!denied.includes('<iframe') && !denied.includes('src="https://'));
    ok(denied.includes('Configurar vídeos externos'));
    const allowed = render(external, true, 'en');
    ok(allowed.includes('<iframe') && allowed.includes('src="https://player.vimeo.com/video/12345?dnt=1"'));
    ok(!allowed.includes('autoplay'));
    ok(allowed.includes('Back to projects') && allowed.includes('Fictional preview'));
    const youtube = { ...local, videoUrl: 'https://www.youtube.com/watch?v=OHOpb2fS-cM' };
    ok(!render(youtube).includes('<iframe'), 'YouTube stays unloaded before consent');
    const youtubeAllowed = render(youtube, true);
    ok(youtubeAllowed.includes('src="https://www.youtube-nocookie.com/embed/OHOpb2fS-cM?playsinline=1&amp;rel=0"'));
    ok(youtubeAllowed.includes('referrerPolicy="strict-origin-when-cross-origin"'), 'YouTube receives origin identification');
    ok(youtubeAllowed.includes('data-video-provider="YouTube"'));
    ok(youtubeAllowed.includes('Ver en YouTube') && youtubeAllowed.includes('href="https://www.youtube.com/watch?v=OHOpb2fS-cM"'));
    ok(!youtubeAllowed.includes('autoplay'), 'Inline playback remains initiated by the viewer');
    ok(render({ ...youtube, videoUrl: 'https://www.youtube-nocookie.com/embed/OHOpb2fS-cM' }, true)
      .includes('href="https://www.youtube.com/watch?v=OHOpb2fS-cM"'), 'Fallback opens the watch page even for embed links');
    const unsafe = render({ ...local, videoUrl: 'javascript:alert(1)' }, true);
    ok(!/<video|<iframe|href="javascript/iu.test(unsafe));
    const unsupported = render({ ...local, videoUrl: 'https://unsupported.invalid/video' }, true);
    ok(!unsupported.includes('<iframe'));
    ok(unsupported.includes('rel="noopener noreferrer"'));
    equal(network.blocked.length, 0);
  });
  console.log(`PASS: ${groups} groups, ${assertions} assertions; current public payloads and escaped React presentation only.`);
} finally { network.restore(); await vite.close(); }
