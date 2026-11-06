import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { decodeHTML } from 'entities';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';
import { advisoryInput, rawHTMLCases, blockedLinkCases, safeLinks, markdown, historicalName, historicalTopic, storedAgent, streamContent, permittedTags, permittedAttributes } from './safe-rendering-cases.mjs';

// This loader intentionally ignores project configuration and every .env file.
// It loads presentation modules only; all fetches are blocked, including localhost.
const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const network = installFetchGuard([]);
const vite = await createServer({
  root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
  esbuild: { jsx: 'automatic', jsxImportSource: 'react' },
});
let assertions = 0;
let groups = 0;
const ok = (condition, message) => { assertions++; assert.ok(condition, message); };
const equal = (actual, expected, message) => { assertions++; assert.equal(actual, expected, message); };
const group = async (name, action) => { await action(); console.log(`ok ${++groups} - ${name}`); };

function attributes(source) {
  return [...source.matchAll(/([^\s=/>]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g)]
    .map(([, name, value = '']) => [name.toLowerCase(), decodeHTML(value.replace(/^['"]|['"]$/g, ''))]);
}
function inspect(html) {
  const anchors = [];
  for (const [, closing, tag, source] of html.matchAll(/<(\/)?([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>/g)) {
    ok(permittedTags.has(tag.toLowerCase()), `Only permitted element ${tag}`);
    if (closing) continue;
    const attrs = new Map(attributes(source));
    for (const [name] of attrs) ok(permittedAttributes.has(name), `Only permitted attribute ${name}`);
    if (tag.toLowerCase() === 'a') {
      const href = attrs.get('href');
      ok(href && !/[\u0000-\u0020\u007f\\]/u.test(href), 'Links contain no controls, whitespace or backslashes');
      const local = /^(?:\/(?!\/)|\.\.?\/|#|\?)/u.test(href);
      if (!local) {
        const parsed = new URL(href);
        ok(['http:', 'https:', 'mailto:'].includes(parsed.protocol), 'Only explicit safe protocols are navigable');
        equal(attrs.get('target'), '_blank');
        ok((attrs.get('rel') || '').split(/\s+/).includes('noopener'));
        ok((attrs.get('rel') || '').split(/\s+/).includes('noreferrer'));
        equal(attrs.get('referrerpolicy'), 'no-referrer');
      }
      anchors.push(attrs);
    }
  }
  return anchors;
}

// A document double makes any attempt to parse HTML fail immediately. Browser
// tests below use actual DOM nodes as the independent end-to-end check.
function syntheticDocument() {
  class Text {
    constructor(content) { this.nodeType = 3; this.textContent = content; }
  }
  class Element {
    constructor(tag) { this.nodeType = 1; this.tagName = tag.toUpperCase(); this.children = []; this.className = ''; }
    set innerHTML(_) { throw new Error('Untrusted activity entered the HTML parser'); }
    append(...nodes) { this.children.push(...nodes.map(node => typeof node === 'string' ? new Text(node) : node)); }
    set textContent(content) { this.children = [new Text(content)]; }
    get textContent() { return this.children.map(node => node.textContent).join(''); }
  }
  return { createElement: tag => new Element(tag), createTextNode: value => new Text(value) };
}

try {
  const { default: FormattedText } = await vite.ssrLoadModule('/src/components/FormattedText.tsx');
  const render = text => renderToStaticMarkup(createElement(FormattedText, { text }));
  if (process.argv.includes('--advisory-only')) {
    const html = render(advisoryInput);
    assert.ok(html.length < 200, 'Three-byte whitespace input terminates with bounded output');
    console.log('advisory-regression-ok');
  } else {
    await group('Legitimate Markdown keeps semantic formatting, tables, line breaks and safe links', () => {
      const html = render(markdown);
      inspect(html);
      for (const tag of ['h1', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'br', 'table', 'thead', 'tbody', 'th', 'td', 'hr']) {
        ok(new RegExp(`<${tag}(?:\\s|/|>)`).test(html), `Markdown renders ${tag}`);
      }
      ok(html.includes('Negrita'));
      ok(html.includes('&lt;script&gt;texto&lt;/script&gt;'), 'Code content remains escaped');
      ok(html.includes('&amp;'), 'Entity text remains text');
    });
    await group('Raw, malformed, SVG, mathML and embedded HTML is never executable DOM', () => {
      for (const [name, payload] of rawHTMLCases) {
        const html = render(payload);
        inspect(html);
        ok(!/<(?:script|img|svg|math|iframe|object|embed|form|input|details)(?:\s|\/|>)/i.test(html), name);
        ok(html.includes(name === 'Markdown image' ? 'untrusted image' : '__a03Execute'), `${name} stays visible as text`);
      }
    });
    await group('Executable and obfuscated schemes cannot become links', () => {
      for (const [name, payload] of blockedLinkCases) equal(inspect(render(payload)).length, 0, name);
    });
    await group('Allowed links have exact destinations and safe external attributes', () => {
      for (const [name, href] of safeLinks) {
        const anchors = inspect(render(`[${name}](${href})`));
        equal(anchors.length, 1, name);
        equal(anchors[0].get('href'), href, `${name} destination preserved`);
      }
      const title = render('[safe](https://example.test "onmouseover=window.__a03Execute()")');
      inspect(title);
      ok(!/\sonmouseover=/i.test(title), 'Link titles never turn into attributes');
      const references = inspect(render('[Referencia][ref]\n\n[ref]: https://example.test/reference "Título con espacios"\n\nhttps://example.test/autolink y synthetic@example.test'));
      equal(references.length, 3, 'Reference links and GFM HTTP/email autolinks work');
      equal(references[0].get('title'), 'Título con espacios');
      inspect(render('[safe](https://example.test "&quot; onmouseover=&quot;window.__a03Execute()")'));
    });
    await group('Every streaming prefix remains safe, including unfinished tags and encoded links', () => {
      const payloads = [...rawHTMLCases, ...blockedLinkCases, ['SSE content', streamContent]];
      let prefixes = 0;
      for (const [name, payload] of payloads) for (let end = 0; end <= payload.length; end++) {
        inspect(render(payload.slice(0, end)));
        prefixes++;
      }
      ok(prefixes > 1000, 'Substantial incremental payload coverage');
      console.log(`  ${prefixes} rendered streaming prefixes`);
    });
    await group('Historical welcome and stored agent payloads use the same safe renderer', () => {
      for (const text of [`Hola de nuevo, ${historicalName}. La última vez hablamos sobre "${historicalTopic}".`, storedAgent]) {
        const html = render(text);
        inspect(html);
        ok(html.includes('__a03Execute') && !/<(?:img|svg)(?:\s|\/|>)/i.test(html));
      }
    });
    await group('Task-list markers appear once and oversized or deeply nested text stays safe', () => {
      const tasks = render('- [x] Done\n- [ ] Next');
      inspect(tasks);
      equal((tasks.match(/☑/g) || []).length, 1);
      equal((tasks.match(/☐/g) || []).length, 1);
      const large = '<img src=x onerror=window.__a03Execute()>'.repeat(1000);
      const html = render(large);
      inspect(html);
      ok(!/<img(?:\s|\/|>)/i.test(html));
      const nested = `${'> '.repeat(100)}<svg onload=window.__a03Execute()>`;
      inspect(render(nested));
    });
    await group('Feeds and logs build text nodes, preserve levels and reject markup in titles and timestamps', async () => {
      const { createFeedEntry, createLogEntry } = await vite.ssrLoadModule('/src/lib/activity-dom.ts');
      const doc = syntheticDocument();
      for (const [name, payload] of rawHTMLCases) {
        const feed = createFeedEntry({ text: payload, project_title: payload, level: 'high' }, '<img src=x>', doc);
        equal(feed.tagName, 'DIV');
        equal(feed.textContent, `<img src=x>[${payload}] ${payload}`, `${name} feed is literal`);
        ok(feed.className.includes('border-primary/30'));
        equal(feed.children.filter(node => node.nodeType === 1).every(node => node.tagName === 'SPAN'), true);
        const log = createLogEntry({ text: payload, log_type: 'warning' }, '12:00:00', doc);
        equal(log.tagName, 'P');
        equal(log.textContent, `[12:00:00] AVISO: ${payload}`, `${name} log is literal`);
      }
      equal(createLogEntry({ text: 'ready', log_type: 'success' }, '01:02:03', doc).textContent, '[01:02:03] LISTO: ready');
      equal(createLogEntry({ text: 'default', log_type: '<img onerror=bad>' }, '01:02:03', doc).textContent, '[01:02:03] CORE: default');
      equal(createLogEntry({ text: 'default', log_type: '__proto__' }, '01:02:03', doc).textContent, '[01:02:03] CORE: default');
      equal(createFeedEntry({ text: {}, project_title: {}, level: '<svg onload=bad>' }, '01:02', doc).textContent, '01:02 ');
      equal(createLogEntry({ text: null }, '01:02:03', doc).textContent, '[01:02:03] CORE: ');
    });
    await group('Marked three-byte advisory payload terminates within an enforced process deadline', async () => {
      const result = await promisify(execFile)(process.execPath, [script, '--advisory-only'], { cwd: root, timeout: 10000, windowsHide: true });
      ok(result.stdout.includes('advisory-regression-ok'));
    });
    equal(network.blocked.length, 0, 'Presentation tests attempted no network requests');
    console.log(`PASS: ${groups} groups, ${assertions} assertions. No remote calls or business effects.`);
  }
} finally {
  await vite.close();
  network.restore();
}
