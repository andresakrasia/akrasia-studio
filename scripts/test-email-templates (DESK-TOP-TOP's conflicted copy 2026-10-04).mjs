import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const network = installFetchGuard([]);
const previousFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (input, init) => {
  assert.equal(String(input), 'https://api.resend.com/emails');
  calls.push({ body: JSON.parse(init.body), headers: init.headers });
  return new Response(JSON.stringify({ id: 'synthetic-resend-id' }), { status: 200 });
};
const vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: { 'import.meta.env.RESEND_API_KEY': JSON.stringify('synthetic-email-templates-key'), 'import.meta.env.EMAIL_FROM': JSON.stringify('Synthetic <sender@example.invalid>') } });
let checks = 0, groups = 0;
const ok = value => { checks++; assert.ok(value); };
const equal = (a,b) => { checks++; assert.deepEqual(a,b); };
const group = async (label, run) => { await run(); console.log(`ok ${++groups} - ${label}`); };
try {
  const templates = await vite.ssrLoadModule('/src/lib/email-templates.ts');
  const writing = await vite.ssrLoadModule('/src/lib/client-email-writing.ts');
  const mail = await vite.ssrLoadModule('/src/lib/email.ts');
  const { default: Composer } = await vite.ssrLoadModule('/src/components/dashboard/EmailComposer.tsx');
  const { default: Emails } = await vite.ssrLoadModule('/src/components/dashboard/DashboardEmails.tsx');
  const project = { toName: 'Lucía', projectTitle: 'Nueva luz / Film de marca', budgetAmount: 2400, budgetCurrency: 'EUR', budgetScope: 'Film de 30 segundos y tres adaptaciones verticales.', budgetTiming: 'Tres semanas desde la aceptación. IVA no incluido.' };
  const examples = writing.EMAIL_TEMPLATES.map(({ value, label }) => {
    const draft = writing.createClientEmailDraft(value,project);
    const bodyText = draft.body.replace('{{proximos_pasos_y_materiales}}','Comparte el manual de marca, las referencias y la persona que revisará la pieza.').replace('{{avances_confirmados_y_proximos_pasos}}','El montaje de la primera secuencia está preparado. El equipo sigue trabajando en la siguiente escena.').replace('{{enlace_y_material_entregado}}','Primera versión: https://example.invalid/revision').replace('{{enlace_y_material_final}}','Entrega final: https://example.invalid/entrega').replace('{{mensaje}}','Estamos preparando nuevas piezas. Cuando te venga bien, cuéntanos qué tienes en mente y lo comentamos.');
    return { type: value, label, subject: draft.subject || 'Hablemos de tu próxima pieza', bodyText };
  });
  const meetingInput = { id: '15151515-0000-4000-8000-000000000001', name: 'Lucía', email: 'lucia@example.invalid', date: '2026-10-07', time: '16:30', duration: 30, meetUrl: 'https://meet.jit.si/Akrasia-15151515-0000-4000-8000-000000000001' };
  const booking = templates.buildBookingEmail('booking_confirmation', meetingInput);
  const reminder = templates.buildBookingEmail('booking_reminder', { ...meetingInput, reminderHours: 1 });
  examples.push({ type: 'booking_confirmation', label: 'Reserva de videollamada', ...booking }, { type: 'booking_reminder', label: 'Recordatorio de videollamada', ...reminder });
  await group('Every lifecycle stage has its own brand headline and readable table-based layout', () => {
    equal(examples.length,11);
    equal(new Set(examples.map(row => templates.EMAIL_VISUALS[row.type].title)).size,11);
    for (const example of examples) {
      const html = templates.renderEmailTemplate({ ...example, templateType: example.type });
      ok(html.startsWith('<!DOCTYPE html>')); ok(html.includes('role="presentation"')); ok(html.includes('bgcolor="#050505"'));
      ok(html.includes('ΛKRΛSIΛ')); ok(html.includes('We don\'t prompt. We direct.')); ok(html.includes(templates.EMAIL_BRAND_LOGO_URL));
      ok(html.includes('@media(max-width:620px)')); ok(!/<(?:script|svg|form|input|video|canvas)\b/i.test(html));
      ok(html.includes('<!--[if mso]>')); ok(html.includes('font-size:15px;line-height:1.8;color:#cbd5e1;'));
      equal(html,templates.renderEmailTemplate({ ...example, templateType: example.type }));
    }
    equal(templates.isBrandedEmailType('toString'),false); equal(templates.isBrandedEmailType('__proto__'),false);
    ok(templates.renderEmailTemplate({bodyText:'Plain',templateType:'invalid'}).includes('Desde el estudio'));
  });
  await group('Hostile text, subjects, names and links cannot create HTML or executable attributes', () => {
    const text = `<script>alert('x')</script>\n<img src=x onerror="alert(1)"> & \"\nhttps://example.invalid/project?a=1&b=2.\njavascript:alert(1) https://user:pass@example.invalid/ https://example.invalid/\" onclick=\"evil`;
    const html = templates.renderEmailTemplate({bodyText:text,subject:'<img src=x onerror=evil>',templateType:'delivery'});
    ok(!html.includes('<script>')); ok(!html.includes('<img src=x')); ok(html.includes('&lt;script&gt;')); ok(html.includes('&amp;'));
    ok(html.includes('href="https://example.invalid/project?a=1&amp;b=2"')); ok(!html.includes('href="javascript:')); ok(!html.includes('href="https://user:pass'));
    ok(!html.includes('" onclick="')); equal(templates.safeEmailUrl('https://user:pass@example.invalid/'),null); equal(templates.safeEmailUrl('http://example.invalid/'),null);
    for (const url of ['javascript:alert(1)','data:text/html,bad','https://example.invalid/\nattack','https://example.invalid/\"x']) equal(templates.safeEmailUrl(url),null);
    const hostile = templates.buildBookingEmail('booking_confirmation',{...meetingInput,name:'<img src=x onerror=evil>'});
    ok(hostile.bodyHtml.includes('&lt;img src=x onerror=evil&gt;')); ok(!hostile.bodyHtml.includes('<img src=x'));
  });
  await group('Meeting confirmation/reminder contain Madrid civil time, real meeting CTA and safe fallback', () => {
    for (const payload of [booking,reminder]) {
      ok(payload.bodyText.includes('16:30')); ok(payload.bodyText.includes('Europe/Madrid')); ok(payload.bodyHtml.includes('TU VIDEOLLAMADA'));
      ok(payload.bodyHtml.includes(`href="${meetingInput.meetUrl}"`)); ok(payload.bodyHtml.includes('Entrar en la videollamada'));
      ok(payload.bodyText.includes('anfitrión')); ok(payload.bodyText.includes(meetingInput.id)); equal(payload.meeting.duration,30);
    }
    ok(booking.bodyText.includes('Reserva confirmada')); ok(!reminder.bodyText.includes('Reserva confirmada')); ok(reminder.subject.includes('empieza pronto'));
    const fallback = templates.buildBookingEmail('booking_confirmation',{...meetingInput,meetUrl:'',duration:undefined});
    ok(fallback.bodyHtml.includes('El equipo te facilitará el enlace')); ok(!fallback.bodyHtml.includes('Entrar en la videollamada')); equal(fallback.meeting.duration,30);
    for (const input of [{...meetingInput,date:'2026-02-30'},{...meetingInput,date:'2026-10-25',time:'02:30'},{...meetingInput,date:'2027-03-28',time:'02:30'},{...meetingInput,duration:NaN},{...meetingInput,duration:0},{...meetingInput,meetUrl:'javascript:evil'}]) { checks++; assert.throws(() => templates.buildBookingEmail('booking_confirmation',input)); }
  });
  await group('Normal long drafts remain inside the durable 24 KiB payload budget', () => {
    const bodyText = 'Producción audiovisual y dirección creativa. '.repeat(145);
    const bodyHtml = mail.generateEmailHtml(bodyText,{templateType:'progress',subject:'Avances del proyecto'});
    ok(Buffer.byteLength(JSON.stringify({to:'synthetic@example.invalid',subject:'Avances del proyecto',bodyText,bodyHtml,templateType:'progress'}),'utf8') < 24576);
    ok(bodyHtml.length < 14000); ok(!bodyHtml.includes('data:image')); ok(!bodyHtml.includes('base64,'));
  });
  await group('Resend sends deterministic HTML/plain alternatives and the exact server calendar attachment', async () => {
    const calendar = Buffer.from('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n').toString('base64');
    const payload = {...booking,attachments:[{filename:'akrasia-videollamada.ics',content:calendar,content_type:'text/calendar'}]};
    equal((await mail.sendEmail(payload,{idempotencyKey:'synthetic:booking'})).disposition,'accepted');
    equal((await mail.sendEmail(payload,{idempotencyKey:'synthetic:booking'})).disposition,'accepted');
    equal(calls[0],calls[1]); equal(calls[0].headers['Idempotency-Key'],'synthetic:booking'); equal(calls[0].body.html,booking.bodyHtml); equal(calls[0].body.text,booking.bodyText);
    equal(calls[0].body.attachments,payload.attachments); equal(calls[0].body.meeting,undefined); equal(calls[0].body.templateType,undefined);
    equal(calls[0].body.reply_to,'info@akrasia.studio');
    const count=calls.length;
    equal((await mail.sendEmail({...booking,attachments:[{filename:'../attack.ics',content:calendar}]},{idempotencyKey:'synthetic:bad'})).disposition,'failed');
    equal((await mail.sendEmail({...booking,attachments:[{filename:'fake.ics',content:'<not base64>'}]},{idempotencyKey:'synthetic:bad'})).disposition,'failed');
    equal(calls.length,count);
  });
  await group('A configured reply mailbox is honored; invalid reply headers stop before Resend', async () => {
    for (const [replyTo, expected] of [['equipo@example.invalid','accepted'],['team@example.invalid\r\nBcc: hidden@example.invalid','disabled'],['not-an-email','disabled']]) {
      const isolated = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
        define: { 'import.meta.env.RESEND_API_KEY': JSON.stringify('synthetic-email-templates-key'), 'import.meta.env.EMAIL_FROM': JSON.stringify('Synthetic <sender@example.invalid>'), 'import.meta.env.EMAIL_REPLY_TO':JSON.stringify(replyTo) } });
      try {
        const configured = await isolated.ssrLoadModule('/src/lib/email.ts');
        const count = calls.length;
        equal((await configured.sendEmail(booking,{idempotencyKey:'synthetic:reply-config'})).disposition,expected);
        if(expected === 'accepted') equal(calls.at(-1).body.reply_to,replyTo); else equal(calls.length,count);
      } finally { await isolated.close(); }
    }
  });
  await group('A frozen worker envelope survives sender/reply configuration changes without trusting browser metadata', async () => {
    const frozen = mail.emailDeliveryPayload({...booking,from:'injected@example.invalid',replyTo:'injected@example.invalid'});
    equal(frozen.from,'Synthetic <sender@example.invalid>'); equal(frozen.replyTo,'info@akrasia.studio');
    equal((await mail.sendEmail(frozen,{idempotencyKey:'synthetic:frozen-envelope'})).disposition,'accepted');
    const original = calls.at(-1);
    const isolated = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
      define: { 'import.meta.env.RESEND_API_KEY':JSON.stringify('synthetic-email-templates-key'), 'import.meta.env.EMAIL_FROM':JSON.stringify('Changed team <changed@example.invalid>'), 'import.meta.env.EMAIL_REPLY_TO':JSON.stringify('changed-reply@example.invalid') } });
    try {
      const configured=await isolated.ssrLoadModule('/src/lib/email.ts');
      equal((await configured.sendEmail(frozen,{idempotencyKey:'synthetic:frozen-envelope'})).disposition,'accepted');
      equal(calls.at(-1),original);
      const newPayload=configured.emailDeliveryPayload(booking); equal(newPayload.from,'Changed team <changed@example.invalid>'); equal(newPayload.replyTo,'changed-reply@example.invalid');
    } finally { await isolated.close(); }
    const count=calls.length;
    for(const sender of ['Synthetic <sender@example.invalid','sender@example.invalid>','sender@example.invalid\nBcc: hidden@example.invalid']) equal((await mail.sendEmail({...frozen,from:sender},{idempotencyKey:'synthetic:bad-envelope'})).disposition,'disabled');
    equal((await mail.sendEmail({...frozen,replyTo:'team@example.invalid\r\nBcc: hidden@example.invalid'},{idempotencyKey:'synthetic:bad-envelope'})).disposition,'disabled'); equal(calls.length,count);
  });
  await group('Admin preview uses the same isolated rendered design and selectable mobile/desktop sizes', () => {
    const html = renderToStaticMarkup(createElement(Composer,{ request: async () => { throw new Error('Unexpected SSR request'); },context:{...project,templateType:'quote'} }));
    ok(html.includes('sandbox=""')); ok(html.includes('referrerPolicy="no-referrer"') || html.includes('referrerpolicy="no-referrer"')); ok(html.includes('srcDoc=') || html.includes('srcdoc='));
    ok(html.includes('Vista previa del email de AKRASIA')); ok(html.includes('Escritorio')); ok(html.includes('Móvil')); ok(html.includes('Content-Security-Policy'));
    const gallery = renderToStaticMarkup(createElement(Emails,{request:async()=>{throw new Error('Unexpected SSR request');}}));
    ok(gallery.includes('Elige el momento')); ok(gallery.includes('Reserva de videollamada')); ok(gallery.includes('Recordatorio de reunión'));
    for(const template of writing.EMAIL_TEMPLATES) ok(gallery.includes(template.label));
  });
  await group('Email logo is a valid raster of the existing code logo; gallery artifact contains every design', async () => {
    const logo = await readFile(path.join(root,'public/img/email-studio-core.png'));
    const metadata=await sharp(logo).metadata(); equal(metadata.format,'png'); equal(metadata.width,600); equal(metadata.height,600);
    const logoUrl=`data:image/png;base64,${logo.toString('base64')}`;
    const escape=templates.escapeEmailHtml;
    const gallery=`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AKRASIA · Colección de emails</title><style>body{margin:0;background:#050505;color:#e2e8f0;font:14px Arial,sans-serif}header{padding:32px;max-width:1320px;margin:auto}h1{font-size:34px;margin:12px 0}header p{color:#94a3b8;line-height:1.6}nav{display:flex;gap:12px;flex-wrap:wrap}a{color:#00f0ff}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,620px),1fr));gap:24px;max-width:1320px;margin:auto;padding:0 24px 40px}section{border:1px solid #244044;min-width:0}h2{font-size:15px;padding:0 20px;color:#00f0ff}.full-preview{display:block;margin:0 20px 14px;font-size:12px}iframe{border:0;width:100%;height:950px;display:block;background:#050505}</style></head><body><header><span style="color:#00f0ff;letter-spacing:3px">ΛKRΛSIΛ / STUDIO</span><h1>Una marca. Cada conversación.</h1><p>Once diseños de correo para el ciclo del proyecto y las videollamadas. Datos de ejemplo, sin envíos reales. El logo se exporta desde el código del núcleo visual de la web.</p><nav>${examples.map(example=>`<a href="#${example.type}">${escape(example.label)}</a>`).join('')}</nav></header><main>${examples.map(example=>`<section id="${example.type}"><h2>${escape(example.label)}</h2><a class="full-preview" href="email-preview-${example.type}.html">Abrir diseño completo &rarr;</a><iframe title="${escape(example.label)}" sandbox="" srcdoc="${escape(templates.renderEmailTemplate({...example,templateType:example.type}).replace(templates.EMAIL_BRAND_LOGO_URL,logoUrl))}"></iframe></section>`).join('')}</main></body></html>`;
    const evidence=path.join(root,'docs/evidence'); await mkdir(evidence,{recursive:true}); await writeFile(path.join(evidence,'email-templates-preview.html'),gallery);
    for (const example of examples) await writeFile(path.join(evidence,`email-preview-${example.type}.html`),templates.renderEmailTemplate({...example,templateType:example.type}).replace(templates.EMAIL_BRAND_LOGO_URL,logoUrl));
    ok(gallery.includes('booking_reminder')); console.log('Preview: docs/evidence/email-templates-preview.html (synthetic data, no sends).');
  });
  equal(network.blocked,[]);
  console.log(`Branded email templates: ${groups} groups / ${checks} checks passed; synthetic providers only.`);
} finally { globalThis.fetch=previousFetch; network.restore(); await vite.close(); }
