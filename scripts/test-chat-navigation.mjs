import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const network = installFetchGuard([]);
const vite = await createServer({ root: process.cwd(), configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
});
let assertions = 0;
const equal = (actual, expected, message) => { assertions++; assert.deepEqual(actual, expected, message); };
try {
  const navigation = await vite.ssrLoadModule('/src/lib/chat-navigation.ts');
  const publicUi = await vite.ssrLoadModule('/src/lib/public-ui.ts');
  const origin = 'http://localhost:4322';
  const intents = ['about', 'start', 'services', 'manifesto', 'portfolio', 'contact', 'service:creative-direction', 'project:published-film'];
  for (const intent of intents) for (const lang of ['es', 'en']) {
    const href = navigation.chatIntentPath(intent, lang);
    const url = new URL(href, origin);
    equal(url.origin, origin, 'Intent stays local'); equal(url.pathname, '/', 'Chat intent opens the home conversation');
    equal(url.searchParams.get('chat'), intent, 'Public intent round-trips');
    equal(url.searchParams.get('lang'), lang === 'en' ? 'en' : null, 'Language preserved');
    equal(navigation.parseChatIntentUrl(href, origin, lang), { intent, message: navigation.chatIntentMessage(intent, lang) }, 'Root link resolves to one predefined message');
  }
  equal(navigation.chatIntentMessage('services', 'en'), 'I want to know about your services', 'Services command matches server contract');
  equal(navigation.chatIntentMessage('service:creative-direction'), 'Quiero información sobre el servicio: creative-direction', 'Service command matches server contract');
  equal(navigation.chatIntentMessage('project:published-film', 'en'), 'I want information about the project: published-film', 'Project command matches server contract');
  for (const href of ['https://foreign.invalid/?chat=contact', '//foreign.invalid/?chat=contact', '/servicios?chat=services',
    '/?chat=contact&visitor_id=private', '/?chat=contact&chat=portfolio', '/?chat=contact&lang=en&lang=es',
    '/?chat=contact&lang=xx', '/?chat=contact#script', '/?chat=unknown', '/?chat=service%3Abad_slug',
    '/?chat=project%3A%3Cscript%3E', '/?chat=project%3A' + 'a'.repeat(121), 'javascript:alert(1)', '/?chat=contact&secret=private']) {
    equal(navigation.parseChatIntentUrl(href, origin), null, 'Reject unsafe or ambiguous chat URL: ' + href);
  }
  // Editorial links stay ordinary navigation; only root conversation URLs are intercepted.
  for (const route of ['/servicios', '/servicios/public-service', '/proyectos', '/proyectos/public-film', '/contacto']) {
    for (const lang of ['es', 'en']) {
      const href = publicUi.languagePath(route + '?visitor_id=private&secret=discard-me', lang);
      const url = new URL(href, origin);
      equal(url.pathname, route, 'Editorial route remains a readable page');
      equal([...url.searchParams.keys()], lang === 'en' ? ['lang'] : [], 'Editorial links discard identity and arbitrary queries');
      equal(publicUi.publicCanonical(route + '?visitor_id=private&secret=discard-me', lang),
        'https://akrasia.studio' + route + (lang === 'en' ? '?lang=en' : ''), 'Canonical uses the public origin and language only');
      equal(navigation.parseChatIntentUrl(href, origin, lang), null, 'Editorial link never becomes a chat command');
      equal(navigation.parseChatIntentUrl(href + (lang === 'en' ? '&' : '?') + 'chat=contact', origin, lang), null,
        'Chat parameter cannot turn an editorial page into a command');
    }
  }
  for (const kind of ['service', 'project']) for (const slug of ['', 'UPPER', 'a_b', 'a/b', 'https://foreign.invalid', '<script>', 'a'.repeat(121), 'a\n', 'a\r\n']) {
    equal(navigation.parseChatIntent(kind + ':' + slug), null, 'Invalid public catalogue selector rejected');
  }
  // The dynamic sitemap is exercised with the real SSR server in test-public-web.
  equal(network.blocked, [], 'Navigation helpers perform no network requests');
  console.log('PASS chat navigation: ' + assertions + ' assertions; no .env, services or remote data.');
} finally { await vite.close(); network.restore(); }
