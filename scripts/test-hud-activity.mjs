import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const guard = installFetchGuard([]);
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
let checks = 0, groups = 0;
const ok = (value, message) => { checks++; assert.ok(value, message); };
const eq = (value, expected, message) => { checks++; assert.deepEqual(value, expected, message); };
const throws = (action) => { checks++; assert.throws(action); };
const group = async (name, action) => { await action(); console.log(`ok ${++groups} - ${name}`); };
const entry = { id: '00000000-0000-4000-8000-000000000101', title: 'Avance aprobado', title_en: 'Approved update',
  text: 'Texto editorial', text_en: 'Editorial text', occurred_at: '2026-10-02T09:00:00.000Z', event_type: 'process',
  project: { slug: 'demo-project', title: 'Proyecto DEMO' } };

class Element {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.events = {}; this.attributes = {}; this.hidden = false; }
  set innerHTML(_) { throw new Error('Activity entered HTML parser'); }
  set textContent(value) { this.children = [String(value)]; }
  get textContent() { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, action) { this.events[name] = action; }
  contains() { return false; }
}
const doc = { createElement: tag => new Element(tag) };
const globals = ['document', 'window', 'sessionStorage', 'fetch', 'setInterval', 'requestAnimationFrame', 'cancelAnimationFrame'];
const saved = new Map(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
try {
  const hud = await vite.ssrLoadModule('/src/lib/hud-activity.ts');
  await group('Public payloads are bounded and select only editorial fields', () => {
    eq(hud.parseActivityPayload([{ ...entry, internal_notes: 'PRIVATE' }], 20), [entry]);
    eq(hud.parseActivityPayload([{ ...entry, project: null }], 20)[0].project, null);
    for (const invalid of [null, {}, Array(21).fill(entry), [entry,entry], [{...entry,project:{slug:'../../private',title:'bad'}}],
      [{...entry,project:{slug:'demo-project\n',title:'bad'}}], [{...entry,occurred_at:'not-a-date'}], [{...entry,title:12}],
      [{...entry,text:'x'.repeat(4097)}], [{...entry,event_type:'internal'}]]) throws(() => hud.parseActivityPayload(invalid,20));
  });
  await group('A manual pause holds new updates but removes withdrawals and changed content', () => {
    const next = { ...entry, id: '00000000-0000-4000-8000-000000000102', title: 'Novedad' };
    eq(hud.activityWhilePaused([entry],[entry,next],true),[entry]);
    eq(hud.activityWhilePaused([entry],[],true),[]);
    eq(hud.activityWhilePaused([entry],[{...entry,text:'Changed'}],true),[]);
    eq(hud.activityWhilePaused([entry],[entry,next],false),[entry,next]);
  });
  await group('Literal malicious text never becomes HTML or an external navigation action', () => {
    const payload = '<img src=x onerror=alert(1)><script>PRIVATE()</script>';
    const item = hud.renderActivityEntry({...entry,title:payload,text:payload,project:{slug:'demo-project',title:payload}},'es',doc);
    ok(item.textContent.includes(payload));
    const link = item.children.at(-1);
    eq(link.tagName,'A'); eq(link.href,'/?chat=project%3Ademo-project');
    eq(link.dataset.chatMessage,'Quiero información sobre el proyecto: demo-project');
    eq(item.children[0].children[0].dateTime,entry.occurred_at);
    ok(!item.textContent.includes('2026-10-03'),'No synthetic current timestamp');
    const english = hud.renderActivityEntry(entry,'en',doc);
    ok(english.textContent.includes('Approved update') && english.textContent.includes('Editorial text'));
    ok(!hud.renderActivityEntry({...entry,project:null},'es',doc).children.some(child=>child.tagName==='A'));
  });
  await group('Reduced motion shows activity, recovers after outage and supports manual pause', async () => {
    const list = new Element('ul'), empty = new Element('p'), scroll = new Element('div');
    scroll.scrollTop=0; scroll.scrollHeight=200; scroll.clientHeight=100;
    const section = new Element('section'); section.dataset.studioActivity='feed';
    section.querySelector=selector=>({'.hud-activity-list':list,'.hud-activity-scroll':scroll,'.hud-activity-empty':empty})[selector];
    const button = new Element('button'), ambient = new Element('span');
    const document = { ...doc, documentElement:{lang:'es',dataset:{}}, visibilityState:'visible', activeElement:null,
      querySelectorAll:()=>[section],getElementById:id=>id==='activityPause'?button:ambient,addEventListener(){} };
    const intervals = [];
    let current = [entry], unavailable = false, frames = 0;
    Object.assign(globalThis,{ document, window:{matchMedia:()=>({matches:true,addEventListener(){}}),addEventListener(){}},
      sessionStorage:{getItem:()=>null,setItem(){}}, setInterval:(action,ms)=>{intervals.push({action,ms});return intervals.length;},
      requestAnimationFrame:()=>{frames++;return 1;},cancelAnimationFrame(){},
      fetch:async()=>({ok:!unavailable,json:async()=>current}) });
    const settle = async()=>{ await new Promise(resolve=>setTimeout(resolve,0)); };
    hud.initializeStudioActivity(); await settle();
    eq(list.children.length,1); eq(frames,0); ok(!button.disabled); eq(button.attributes['aria-pressed'],'false');
    const refresh = intervals.find(item=>item.ms===30000).action;
    unavailable=true; refresh(); await settle(); eq(list.children.length,0); ok(empty.textContent.includes('no disponible'));
    unavailable=false; refresh(); await settle(); eq(list.children.length,1);
    button.events.click(); eq(button.attributes['aria-pressed'],'true');
    current=[entry,{...entry,id:'00000000-0000-4000-8000-000000000102'}]; refresh(); await settle(); eq(list.children.length,1);
    current=[]; refresh(); await settle(); eq(list.children.length,0,'Withdrawal clears even while paused');
    current=[entry]; button.events.click(); await settle(); eq(list.children.length,1);
  });
  console.log(`PASS: ${groups} HUD activity groups, ${checks} assertions; no real services or browser actions.`);
} finally {
  for(const [key,descriptor] of saved) { if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]; }
  await vite.close(); guard.restore();
}
