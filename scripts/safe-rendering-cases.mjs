// Only synthetic content. No URL below is ever contacted by these tests.
export const execution = 'window.__a03Execute()';
export const rawHTMLCases = [
  ['script', `<script>${execution}</script>`],
  ['image event', `<img src="/__missing" onerror="${execution}">`],
  ['malformed image', `<img/src=/__missing onerror=${execution}>`],
  ['SVG event', `<svg/onload=${execution}>`],
  ['SVG link', `<svg><a xlink:href="javascript:${execution}">click</a></svg>`],
  ['mathML mutation', `<math><mtext><table><mglyph><style><!--</style><img title="--><img src=/__missing onerror=${execution}>">`],
  ['iframe srcdoc', `<iframe srcdoc="<img src=x onerror='${execution}'>"></iframe>`],
  ['object and embed', `<object data="data:text/html,<script>${execution}</script>"></object><embed src="javascript:${execution}">`],
  ['form events', `<form action="javascript:${execution}"><input autofocus onfocus="${execution}"></form>`],
  ['details event', `<details open ontoggle="${execution}"><summary>Open</summary></details>`],
  ['unclosed HTML', `<div title="unfinished"><img src=/__missing onerror=${execution}`],
  ['closing tags', `</span></p><img src=/__missing onerror=${execution}>`],
  ['escaped HTML', `&lt;img src=/__missing onerror="${execution}"&gt;`],
  ['double encoded HTML', `&amp;lt;svg onload=${execution}&amp;gt;`],
  ['Markdown image', `![untrusted image](/__missing "onerror=${execution}")`],
  ['HTML attributes in code', `\`<img src=x onerror=${execution}>\``],
];

export const blockedLinkCases = [
  ['javascript', '[click](javascript:window.__a03Execute%28%29)'],
  ['mixed case javascript', '[click](jAvAsCrIpT:window.__a03Execute%28%29)'],
  ['entity letter', '[click](jav&#x61;script:window.__a03Execute%28%29)'],
  ['entity colon', '[click](javascript&#58;window.__a03Execute%28%29)'],
  ['entity tab', '[click](java&#x09;script:window.__a03Execute%28%29)'],
  ['entity newline', '[click](java&#10;script:window.__a03Execute%28%29)'],
  ['percent encoded scheme', '[click](java%73cript%3Awindow.__a03Execute%28%29)'],
  ['fully percent encoded scheme', '[click](%6a%61%76%61%73%63%72%69%70%74%3awindow.__a03Execute%28%29)'],
  ['double percent encoded scheme', '[click](javascript%253Awindow.__a03Execute%28%29)'],
  ['literal tab', '[click](java\tscript:window.__a03Execute%28%29)'],
  ['literal newline', '[click](java\nscript:window.__a03Execute%28%29)'],
  ['NUL', '[click](java\u0000script:window.__a03Execute%28%29)'],
  ['vertical tab', '[click](java\u000bscript:window.__a03Execute%28%29)'],
  ['data HTML', '[click](data:text/html;base64,PHNjcmlwdD53aW5kb3cuX19hMDNFeGVjdXRlKCk8L3NjcmlwdD4=)'],
  ['vbscript', '[click](vbscript:msgbox%281%29)'],
  ['file', '[click](file:///C:/synthetic.txt)'],
  ['blob', '[click](blob:https://example.test/synthetic)'],
  ['protocol relative', '[click](//example.test/synthetic)'],
  ['backslash scheme', '[click](https:\\\\example.test)'],
  ['bare relative disguised scheme', '[click](javascript%3aanything)'],
  ['invalid absolute URL', '[click](https://)'],
  ['encoded newline in HTTPS', '[click](https://example.test/%0aattack)'],
  ['encoded CRLF in mailto', '[click](mailto:synthetic@example.test?subject=hello%0d%0aBcc:other@example.test)'],
  ['encoded backslash in local URL', '[click](/%5cexample.test/synthetic)'],
  ['encoded protocol relative URL', '[click](/%2fexample.test/synthetic)'],
];

export const safeLinks = [
  ['HTTPS', 'https://example.test/path?q=one&two=three', true],
  ['HTTP', 'http://example.test/synthetic', true],
  ['mailto', 'mailto:synthetic@example.test', true],
  ['root path', '/synthetic/path', false],
  ['relative path', './synthetic/path', false],
  ['parent path', '../synthetic/path', false],
  ['fragment', '#a03-local-target', false],
  ['query', '?synthetic=1', false],
];

export const markdown = '# Markdown válido\n\n**Negrita** y *cursiva*, ~~tachado~~, `código <img>` y &amp;.\nSalto de línea.\n\n> Cita\n\n- Uno\n- Dos\n\n3. Tres\n4. Cuatro\n\n```js\nconst text = "<script>texto</script>";\n```\n\n| A | B |\n| :--- | ---: |\n| uno | dos |\n\n---\n\n[Destino local](#a03-local-target) y [externo seguro](https://example.test/synthetic "Título seguro").';
export const historicalName = '<svg onload=window.__a03Execute()>';
export const historicalTopic = '<img src=x onerror=window.__a03Execute()>';
export const storedUser = '<img src=x onerror=window.__a03Execute()> **Usuario literal**';
export const storedAgent = '**Agente sintético**\n\n<svg onload=window.__a03Execute()>\n\n[Destino local](#a03-local-target)';
export const streamContent = '**Flujo SSE sintético**\n\n<svg onload=window.__a03Execute()>\n\n[click](jav&#x61;script:window.__a03Execute%28%29)\n\nFinal á€🙂. [Destino local](#a03-local-target)';
// Official Marked 18.0.0 advisory regression: an otherwise valid three-byte input.
export const advisoryInput = '\x09\x0b\n';

export const permittedTags = new Set(['div', 'span', 'p', 'br', 'strong', 'em', 'del', 'code', 'pre', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a']);
export const permittedAttributes = new Set(['class', 'title', 'href', 'start', 'target', 'rel', 'referrerpolicy']);
