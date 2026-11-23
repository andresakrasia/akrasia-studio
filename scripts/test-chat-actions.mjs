import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { TEST_CHAT_SECRET, TEST_CHAT_PROVIDER_KEY, TEST_CHAT_SERVICE_KEY } from './chat-test-fixture.mjs';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// No real provider, database, email or Telegram. All I/O is locally simulated.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const guard = installFetchGuard([]);
const env = { BOOKING_MEETING_URL:'https://example.invalid/meeting', CHAT_SESSION_SECRET: TEST_CHAT_SECRET, CHAT_ORIGIN: 'http://localhost:4322',
  SUPABASE_URL: 'http://127.0.0.1:1', SUPABASE_SERVICE_ROLE_KEY: TEST_CHAT_SERVICE_KEY, OPENROUTER_API_KEY: TEST_CHAT_PROVIDER_KEY };
const vite = await createServer({ root, configFile: false, envFile: false, appType: 'custom', logLevel: 'silent',
  server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
  define: Object.fromEntries(Object.entries({ ...env, PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' })
    .map(([key, value]) => [`import.meta.env.${key}`, JSON.stringify(value)])) });
let assertions = 0;
let groups = 0;
const eq = (value, expected, message) => { assertions++; assert.deepEqual(value, expected, message); };
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const reject = async (run, code = 'invalid_request') => { assertions++; await assert.rejects(run, error => error.code === code); };
const throws = (run, code = 'invalid_request') => { assertions++; assert.throws(run, error => error.code === code); };
async function group(name, run) { await run(); console.log(`ok ${++groups} - ${name}`); }
const visitor = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const now = Date.parse('2026-10-02T12:00:00Z');
const args = { date: '2026-10-05', time: '12:00', email: 'synthetic@example.invalid', name: 'Synthetic visitor' };
let fetchCalls = [];
const previousFetch = globalThis.fetch;
try {
  const actions = await vite.ssrLoadModule('/src/lib/chat-actions.ts');
  const bookings = await vite.ssrLoadModule('/src/lib/bookings.ts');
  const security = await vite.ssrLoadModule('/src/lib/chat-security.ts');
  const config = security.readChatConfig(env);
  const signal = new AbortController().signal;
  const ctx = { visitorId: visitor, sessionExpiresAt: Math.floor(now / 1000) + 3600, config, signal };
  const issue = (value = args, owner = visitor) => actions.issueBookingProposal(value,
    { id: owner, expiresAt: ctx.sessionExpiresAt }, config, now);
  const validRow = (data) => ({ id: data.bookingId, visitor_id: data.visitorId, booked_date: data.bookedDate,
    booked_time: `${data.bookedTime}:00`, duration_min: 30, buffer_min: 30, status: 'confirmed',
    meet_url: env.BOOKING_MEETING_URL, visitor_email: data.visitorEmail,
    visitor_name: data.visitorName, visitor_phone: null, conversation_id: null, lead_id: null });

  await group('Strict tool schema accepts only exact calendar/contact arguments', async () => {
    eq(actions.CHAT_BOOKING_TOOL.function.name, 'prepare_booking');
    eq(actions.CHAT_BOOKING_TOOL.function.parameters.additionalProperties, false);
    eq(actions.parseBookingArguments(JSON.stringify(args), now), args);
    eq(actions.parseBookingArguments(JSON.stringify({ ...args, name: '' }), now).name, '');
    for (const value of [null, true, [], {}, { ...args, email: null }, { ...args, name: [] },
      { ...args, date: '2026-02-30' }, { ...args, date: '2026-10-01' }, { ...args, date: '05/10/2026' },
      { ...args, time: '24:00' }, { ...args, time: '12:70' }, { ...args, email: 'a@b' },
      { ...args, email: 'a@example.invalid\nBcc:secret@example.invalid' }, { ...args, name: '\u0000control' },
      { ...args, name: 'x'.repeat(151) }, { ...args, email: `${'x'.repeat(254)}@example.invalid` }]) {
      throws(() => actions.parseBookingArguments(JSON.stringify(value), now));
    }
    for (const key of ['visitorId', 'visitor_id', 'bookingId', 'conversation_id', 'lead_id', 'contact_id',
      'booking_id', 'instructions', 'url', 'destination', 'status', 'notes', 'durationMin', 'role', 'tool_calls', '__proto__']) {
      throws(() => actions.parseBookingArguments(JSON.stringify({ ...args, [key]: 'forged' }), now));
    }
    for (const raw of ['{', '[BOOKING_CONFIRM: día=2026-10-05 hora=12:00 email=a@example.invalid]',
      JSON.stringify({ ...args, name: 'é'.repeat(2000) }), ' '.repeat(2049)]) throws(() => actions.parseBookingArguments(raw, now));
    // Madrid has crossed midnight while UTC remains on the previous date.
    throws(() => actions.parseBookingArguments(JSON.stringify({ ...args, date: '2026-10-02' }), Date.parse('2026-10-02T23:00:00Z')));
  });

  await group('Invalid tools cause no availability, creation or notifications; proposals do not reserve', async () => {
    const calls = [];
    const deps = { now: () => now, availability: async (...input) => { calls.push(['availability', ...input]); return true; },
      create: async () => { calls.push(['create']); }, notify: async () => { calls.push(['notify']); } };
    for (const name of ['create_booking', 'send_email', 'prepare_booking;system', '']) {
      await reject(() => actions.prepareBookingAction({ name, arguments: JSON.stringify(args) }, ctx, deps));
    }
    await reject(() => actions.prepareBookingAction({ name: 'prepare_booking', arguments: JSON.stringify({ ...args, visitor_id: other }) }, ctx, deps));
    eq(calls.length, 0);
    const result = await actions.prepareBookingAction({ name: 'prepare_booking', arguments: JSON.stringify(args) }, ctx, deps);
    eq(result.status, 'confirmation_required'); eq(calls.map(call => call[0]), ['availability']);
    eq(result.proposal.date, args.date); eq(result.proposal.email, args.email);
    const verified = actions.verifyBookingProposal(result.proposal.token, visitor, config, now);
    eq(verified.visitorId, visitor); ok(security.chatSession(new Request(env.CHAT_ORIGIN), config, now).id !== verified.bookingId);
    eq(await actions.prepareBookingAction({ name: 'prepare_booking', arguments: JSON.stringify(args) }, ctx,
      { now: () => now, availability: async () => false }), { status: 'unavailable' });
    await reject(() => actions.prepareBookingAction({ name: 'prepare_booking', arguments: JSON.stringify(args) }, ctx,
      { now: () => now, availability: async () => null }), 'booking_unavailable');
  });

  await group('Signed proposals bind owner, details, action UUID and five-minute/session expiry', async () => {
    const proposal = issue();
    const verified = actions.verifyBookingProposal(proposal.token, visitor, config, now);
    eq(verified.date, args.date); eq(verified.email, args.email); eq(proposal.expiresAt, Math.floor(now / 1000) + 300);
    throws(() => actions.verifyBookingProposal(proposal.token, other, config, now), 'invalid_reference');
    throws(() => actions.verifyBookingProposal(proposal.token, visitor, { ...config, secret: 'b'.repeat(64) }, now));
    throws(() => actions.verifyBookingProposal(proposal.token, visitor, config, now + 300000));
    throws(() => actions.verifyBookingProposal('x'.repeat(2049), visitor, config, now));
    throws(() => actions.verifyBookingProposal(proposal.token.split('.')[0], visitor, config, now));
    const [encoded, signature] = proposal.token.split('.');
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    for (const [key, value] of Object.entries({ visitorId: other, bookingId: other, email: 'other@example.invalid',
      date: '2026-10-06', time: '13:00', name: 'Forged', expiresAt: payload.expiresAt + 1000, v: 3, contextVersion: 1 })) {
      const changed = Buffer.from(JSON.stringify({ ...payload, [key]: value })).toString('base64url');
      throws(() => actions.verifyBookingProposal(`${changed}.${signature}`, visitor, config, now));
    }
    const short = actions.issueBookingProposal(args, { id: visitor, expiresAt: Math.floor(now / 1000) + 10 }, config, now);
    eq(short.expiresAt, Math.floor(now / 1000) + 10);
    throws(() => actions.issueBookingProposal(args, { id: visitor, expiresAt: Math.floor(now / 1000) }, config, now), 'invalid_chat_session');
  });

  await group('Only explicit confirmation creates and validates the server booking before reporting success', async () => {
    const proposal = issue();
    const calls = [];
    const deps = { now: () => now, create: async (data) => { calls.push(['create', data]); return { booking: validRow(data), created: true }; },
      notify: async (data) => { calls.push(['notify', data]); } };
    const result = await actions.confirmBookingAction(proposal.token, ctx, deps);
    eq(result.status, 'confirmed'); eq(result.notification, 'queued'); eq(calls.map(call => call[0]), ['create']);
    eq(calls[0][1].visitorId, visitor); eq(calls[0][1].visitorEmail, args.email);
    eq(Object.keys(calls[0][1]).sort(), ['visitorId', 'bookingId', 'bookedDate', 'bookedTime', 'visitorEmail', 'visitorName', 'contextVersion','sessionExpiresAt','chatConfig'].sort());
    eq(Object.keys(result.booking).sort(), ['id', 'date', 'time', 'duration_min', 'meet_url'].sort());
    eq(result.booking.meet_url, env.BOOKING_MEETING_URL);
    await reject(() => actions.confirmBookingAction(proposal.token, { ...ctx, visitorId: other }, deps), 'invalid_reference');
    eq(calls.length, 1);
    const unavailable = await actions.confirmBookingAction(proposal.token, ctx,
      { now: () => now, create: async () => ({ booking: null, created: false }), notify: async () => assert.fail('must not notify') });
    eq(unavailable, { status: 'unavailable' });
    const notificationFailed = await actions.confirmBookingAction(proposal.token, ctx,
      { now: () => now, create: deps.create, notify: async () => { throw new Error('Synthetic failure'); } });
    eq(notificationFailed.status, 'confirmed'); eq(notificationFailed.notification, 'queued');
    const repeated = await actions.confirmBookingAction(proposal.token, ctx,
      { now: () => now, create: async data => ({ booking: validRow(data), created: false }), notify: async () => assert.fail('replay must not notify') });
    eq(repeated.notification, 'already_processed');
  });

  await group('Partial/foreign/malformed write results cannot claim success or notify', async () => {
    const proposal = issue();
    const broken = [null, {}, { booking: null }, { booking: {}, created: true }];
    for (const value of broken) await reject(() => actions.confirmBookingAction(proposal.token, ctx,
      { now: () => now, create: async () => value, notify: async () => assert.fail('no notifications') }), 'booking_unavailable');
    for (const [key, value] of Object.entries({ id: other, visitor_id: other, conversation_id: other, lead_id: other,
      booked_date: '2026-10-06', booked_time: '13:00:00', duration_min: 90, status: 'pending',
      meet_url: 'https://attacker.invalid/meeting', visitor_email: 'foreign@example.invalid', visitor_name: 'Other', visitor_phone: '666' })) {
      await reject(() => actions.confirmBookingAction(proposal.token, ctx, { now: () => now,
        create: async data => ({ booking: { ...validRow(data), [key]: value }, created: true }),
        notify: async () => assert.fail('no notifications') }), 'booking_unavailable');
    }
    await reject(() => actions.confirmBookingAction(proposal.token, ctx, { now: () => now,
      create: async () => { throw new security.ChatFailure('booking_unavailable', 503); },
      notify: async () => assert.fail('no notifications') }), 'booking_unavailable');
  });

  function store(options = {}) {
    const rows=new Map(); const calls=[];
    globalThis.fetch=async(input,init)=>{
      const url=new URL(input instanceof Request?input.url:String(input)); if(url.origin!==env.SUPABASE_URL) return previousFetch(input,init);
      const table=url.pathname.split('/').pop(); calls.push({table,method:init.method,body:JSON.parse(init.body)}); fetchCalls.push(url.origin);
      const respond=value=>new Response(JSON.stringify(value),{status:200});
      if(options.error) return new Response('',{status:503});
      if(table==='booking_available') return respond(options.malformed===undefined?true:options.malformed);
      if(table!=='booking_create_once') assert.fail(`Unexpected RPC ${table}`);
      if(options.malformed!==undefined) return respond(options.malformed);
      const {p_booking:data,p_visitor_id:owner}=JSON.parse(init.body); const existing=rows.get(data.id);
      if(existing) return respond({booking:{...existing,...options.corrupt},created:false});
      if([...rows.values()].some(row=>row.booked_date===data.booked_date&&row.booked_time===`${data.booked_time}:00`&&row.status==='confirmed')) return respond({booking:null,created:false});
      const row={...data,booked_time:`${data.booked_time}:00`,status:'confirmed'}; rows.set(data.id,row);
      if(options.ambiguousWrite) { options.ambiguousWrite=false; return new Response('',{status:503}); }
      return respond({booking:row,created:true});
    };
    return {rows,calls};
  }
  await group('Transactional RPC keeps replay/concurrent proposals and ambiguous retries idempotent',async()=>{
    let db=store(); const token=issue().token; const deps={now:()=>now};
    const first=await actions.confirmBookingAction(token,ctx,deps); const retry=await actions.confirmBookingAction(token,ctx,deps);
    eq(first.status,'confirmed');eq(first.notification,'queued');eq(retry.notification,'already_processed');eq(db.rows.size,1);
    db=store();const results=await Promise.all([actions.confirmBookingAction(token,ctx,deps),actions.confirmBookingAction(token,ctx,deps)]);
    eq(results.map(r=>r.status),['confirmed','confirmed']);eq(db.rows.size,1);
    const different=await actions.confirmBookingAction(issue().token,ctx,deps);eq(different.status,'unavailable');eq(db.rows.size,1);
    db=store({ambiguousWrite:true});await reject(()=>actions.confirmBookingAction(token,ctx,deps),'integration_unavailable');
    const recovered=await actions.confirmBookingAction(token,ctx,deps);eq(recovered.status,'confirmed');eq(recovered.notification,'already_processed');eq(db.rows.size,1);
    ok(db.calls.every(c=>c.table==='booking_create_once'&&c.body.p_visitor_id===visitor&&c.body.p_context_version===0));
  });
  await group('RPC failures/corruption/cancellation never claim success or repeat side effects',async()=>{
    const token=issue().token;let db=store({error:true});await reject(()=>actions.confirmBookingAction(token,ctx,{now:()=>now}),'integration_unavailable');eq(db.rows.size,0);
    const proposal=actions.verifyBookingProposal(token,visitor,config,now);const data={visitorId:visitor,bookingId:proposal.bookingId,bookedDate:args.date,bookedTime:args.time,visitorEmail:args.email,visitorName:args.name};
    db=store();db.rows.set(data.bookingId,{...validRow(data),status:'cancelled'});eq(await actions.confirmBookingAction(token,ctx,{now:()=>now}),{status:'unavailable'});eq(db.rows.size,1);
    db=store({corrupt:{visitor_email:'foreign@example.invalid'}});db.rows.set(data.bookingId,validRow(data));await reject(()=>actions.confirmBookingAction(token,ctx,{now:()=>now}),'booking_unavailable');eq(db.rows.size,1);
  });
  await group('Malformed transactional availability and creation responses close safely',async()=>{
    for(const value of [null,{},[],[true],'true',1,{available:true}]){
      const db=store({malformed:value});await reject(()=>actions.prepareBookingAction({name:'prepare_booking',arguments:JSON.stringify(args)},ctx,{now:()=>now}),'booking_unavailable');eq(db.rows.size,0);
      await reject(()=>actions.confirmBookingAction(issue().token,ctx,{now:()=>now}),'booking_unavailable');eq(db.rows.size,0);
    }
    store({malformed:false});eq((await actions.prepareBookingAction({name:'prepare_booking',arguments:JSON.stringify(args)},ctx,{now:()=>now})).status,'unavailable');
    store();eq((await actions.prepareBookingAction({name:'prepare_booking',arguments:JSON.stringify(args)},ctx,{now:()=>now})).status,'confirmation_required');
  });
  await group('Cancellation prevents new work and no external request escaped', async () => {
    const stopped = new AbortController(); stopped.abort(new security.ChatFailure('chat_unavailable', 503));
    await reject(() => actions.prepareBookingAction({ name: 'prepare_booking', arguments: JSON.stringify(args) },
      { ...ctx, signal: stopped.signal }, { now: () => now, availability: async () => assert.fail('no availability') }), 'chat_unavailable');
    await reject(() => actions.confirmBookingAction(issue().token, { ...ctx, signal: stopped.signal },
      { now: () => now, create: async () => assert.fail('no writes') }), 'chat_unavailable');
    eq(guard.blocked, []); ok(fetchCalls.length > 0); eq([...new Set(fetchCalls)], [env.SUPABASE_URL]);
  });
  console.log(`A07 booking actions: ${groups} groups / ${assertions} assertions passed. Synthetic only.`);
} finally {
  globalThis.fetch = previousFetch;
  await vite.close();
  guard.restore();
}
