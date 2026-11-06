import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPreviewBookingsPersistence } from './preview-bookings-persistence.mjs';
import { createPreviewAgendaPersistence } from './preview-agenda-persistence.mjs';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { TEST_SERVICE_KEY } from './dashboard-auth-test-fixture.mjs';

// Private disposable files and synthetic loopback appointments; no .env,
// real customer data, signing-key preservation or external email deliveries.
const root = await mkdtemp(path.join(tmpdir(), 'akrasia-preview-bookings-test-'));
let checks = 0, groups = 0;
const equal = (actual, expected) => { checks++; assert.deepEqual(actual, expected); };
const ok = actual => { checks++; assert.ok(actual); };
const rejects = async work => { checks++; await assert.rejects(work, /Invalid private preview bookings snapshot/); };
const group = async (title, work) => { await work(); console.log(`ok ${++groups} - ${title}`); };
const appointment = () => ({ id: randomUUID(), visitor_id: randomUUID(), booked_date: '2026-10-05', booked_time: '10:00:00',
  duration_min: 30, buffer_min: 30, status: 'confirmed', meet_url: 'https://meet.jit.si/Synthetic-appointment', context_version: 0,
  starts_at: '2026-10-05T08:00:00.000Z', created_at: '2026-10-04T09:00:00.000Z', updated_at: '2026-10-04T09:00:00.000Z',
  visitor_email: 'appointment@example.invalid', visitor_phone: '000000000', visitor_name: 'Cita sintética', notes: null,
  conversation_id: randomUUID(), lead_id: randomUUID() });
const tables = () => ({ bookings: [], visitors: [{ secret: 'DO_NOT_PERSIST' }], chat_sessions: [{ secret: 'DO_NOT_PERSIST' }],
  messages: [{ content: 'DO_NOT_PERSIST' }], leads: [{ email: 'DO_NOT_PERSIST' }], integration_outbox: [{ payload: 'DO_NOT_PERSIST' }] });
const sessions = [];
const read = async file => JSON.parse(await readFile(file, 'utf8'));
async function store(port, values, options = {}) {
  const session = await createPreviewBookingsPersistence({ root, port, tables: values, ...options }); sessions.push(session); return session;
}
const pause = () => new Promise(resolve => setTimeout(resolve, 90));
try {
  await group('Only appointment fields persist and unrelated fixture state stays in memory', async () => {
    const values = tables(), row = appointment(); values.bookings.push(row);
    const saved = await store(4350, values), bytes = await readFile(saved.file, 'utf8'), data = JSON.parse(bytes);
    equal(Object.keys(data).sort(), ['bookings', 'port', 'time_zone', 'version']); equal(data.version, 1); equal(data.port, 4350); equal(data.time_zone, 'Europe/Madrid');
    equal(data.bookings.length, 1); equal(data.bookings[0].id, row.id); equal(data.bookings[0].visitor_id, row.visitor_id);
    equal(data.bookings[0].booked_time, '10:00'); equal(data.bookings[0].meet_url, row.meet_url);
    equal(data.bookings[0].visitor_email, row.visitor_email); equal(data.bookings[0].visitor_phone, row.visitor_phone); equal(data.bookings[0].visitor_name, row.visitor_name);
    ok(!bytes.includes('DO_NOT_PERSIST')); ok(!bytes.includes('conversation_id')); ok(!bytes.includes('lead_id')); await saved.close();
    const fresh = tables(), restored = await store(4350, fresh);
    equal(fresh.bookings, data.bookings); equal(fresh.messages, [{ content: 'DO_NOT_PERSIST' }]); equal(fresh.integration_outbox, [{ payload: 'DO_NOT_PERSIST' }]); await restored.close();
  });
  await group('Polling, concurrent final flush and independent ports preserve state changes and removals', async () => {
    const values = tables(), saved = await store(4351, values, { intervalMs: 25 }), other = await store(4352, tables());
    values.bookings.push(appointment()); await pause(); equal((await read(saved.file)).bookings.length, 1); equal((await read(other.file)).bookings, []);
    values.bookings[0].status = 'cancelled'; values.bookings[0].updated_at = '2026-10-04T10:00:00.000Z';
    await Promise.all([saved.flush(), saved.flush(), saved.close()]); equal((await read(saved.file)).bookings[0].status, 'cancelled');
    values.bookings = []; await pause(); equal((await read(saved.file)).bookings.length, 1);
    const fresh = tables(), restored = await store(4351, fresh); fresh.bookings = []; await restored.close(); equal((await read(saved.file)).bookings, []);
    equal((await readdir(path.dirname(saved.file))).filter(name => name.endsWith('.tmp')), []); await other.close();
  });
  await group('Malformed runtime appointment fields never overwrite the last valid snapshot', async () => {
    const values = tables(), valid = appointment(); values.bookings = [valid]; const saved = await store(4353, values), before = await readFile(saved.file, 'utf8');
    const malformed = [
      { ...valid, id: 'bad' }, { ...valid, visitor_id: 'bad' }, { ...valid, conversation_id: 'bad' }, { ...valid, lead_id: {} },
      { ...valid, booked_date: '2026-02-30' }, { ...valid, booked_date: '1999-12-31' }, { ...valid, booked_date: '2200-01-01' },
      { ...valid, booked_time: '24:00' }, { ...valid, booked_time: '10:15' }, { ...valid, booked_time: '10:00:30' },
      { ...valid, duration_min: 60 }, { ...valid, buffer_min: 0 }, { ...valid, status: 'unknown' }, { ...valid, context_version: -1 }, { ...valid, context_version: 0.5 },
      { ...valid, starts_at: '2026-10-05T10:00:00Z' }, { ...valid, starts_at: 'invalid' }, { ...valid, created_at: '2026-02-30T10:00:00Z' },
      { ...valid, updated_at: '2026-10-03T10:00:00Z' }, { ...valid, meet_url: 'http://example.invalid' }, { ...valid, meet_url: 'https://user:pass@example.invalid/' },
      { ...valid, meet_url: 'https://example.invalid/#fragment' }, { ...valid, meet_url: 'https://example.invalid/\nprivate' },
      { ...valid, visitor_email: 'not-an-email' }, { ...valid, visitor_email: 'x'.repeat(255) }, { ...valid, visitor_phone: 'x'.repeat(65) },
      { ...valid, visitor_name: 'x'.repeat(151) }, { ...valid, visitor_name: 'bad\nname' }, { ...valid, notes: 'x'.repeat(1001) },
      { ...valid, notes: {} }, { ...valid, csrfToken: 'DO_NOT_PERSIST' }, { ...valid, chatSessionSecret: 'DO_NOT_PERSIST' },
      { ...valid, booked_date: '2026-10-25', booked_time: '02:30', starts_at: '2026-10-25T00:30:00Z' },
      { ...valid, booked_date: '2026-03-29', booked_time: '02:30', starts_at: '2026-03-29T01:30:00Z' },
    ];
    for (const row of malformed) { values.bookings = [row]; await rejects(() => saved.flush()); equal(await readFile(saved.file, 'utf8'), before); }
    values.bookings = [valid, { ...valid, id: valid.id.toUpperCase() }]; await rejects(() => saved.flush()); equal(await readFile(saved.file, 'utf8'), before);
    for (const status of ['pending', 'confirmed', 'completed', 'cancelled']) {
      values.bookings = [{ ...valid, status, meet_url: '', visitor_email: null, visitor_phone: null, visitor_name: null, notes: null }];
      await saved.flush(); equal((await read(saved.file)).bookings[0].status, status);
    }
    values.bookings = [valid]; await saved.close();
  });
  await group('Invalid saved schema fails before replacing existing rows or files', async () => {
    const file = path.join(root, '.codex-tmp', 'preview-bookings-4354.json'), base = { version: 1, port: 4354, time_zone: 'Europe/Madrid', bookings: [] };
    const malformed = ['{broken', JSON.stringify({ ...base, version: 2 }), JSON.stringify({ ...base, port: 4338 }), JSON.stringify({ ...base, time_zone: 'UTC' }),
      JSON.stringify({ ...base, messages: [] }), JSON.stringify({ ...base, bookings: [appointment()] }), JSON.stringify({ ...base, bookings: {} })];
    for (const bytes of malformed) {
      await writeFile(file, bytes); const values = tables(), row = appointment(); values.bookings.push(row);
      await rejects(() => store(4354, values)); equal(values.bookings, [row]); equal(await readFile(file, 'utf8'), bytes);
    }
    await writeFile(file, JSON.stringify(base)); const saved = await store(4354, tables()); await saved.close();
    for (const port of [433.8, 80, 65536, '../../other']) await rejects(() => store(port, tables()));
    await rejects(() => createPreviewBookingsPersistence({ root: '.', port: 4354, tables: tables() }));
    for (const intervalMs of [0, 24, 10001, 25.5]) await rejects(() => store(4354, tables(), { intervalMs }));
    await rejects(() => store(4357, { bookings: Array.from({ length: 4097 }, appointment) }));
  });
  await group('Snapshot directories and files cannot redirect writes through links', async () => {
    const redirectedRoot = path.join(root, 'redirected'), destination = path.join(root, 'destination');
    await mkdir(redirectedRoot); await mkdir(destination); const marker = path.join(destination, 'preview-bookings-4355.json');
    await writeFile(marker, 'untouched'); await symlink(destination, path.join(redirectedRoot, '.codex-tmp'), process.platform === 'win32' ? 'junction' : 'dir');
    await rejects(() => createPreviewBookingsPersistence({ root: redirectedRoot, port: 4355, tables: tables() })); equal(await readFile(marker, 'utf8'), 'untouched');
    const file = path.join(root, '.codex-tmp', 'preview-bookings-4355.json'); await mkdir(file);
    await rejects(() => store(4355, tables()));
  });
  await group('Confirmed booking survives fixture restart, appears in admin and still blocks the public slot', async () => {
    const now = Date.UTC(2026, 9, 4, 9), clock = () => now, port = 4356;
    const headers = { apikey: TEST_SERVICE_KEY, authorization: `Bearer ${TEST_SERVICE_KEY}`, 'content-type': 'application/json' };
    const rpc = async (fixture, name, body) => {
      const response = await fetch(`${fixture.origin}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
      equal(response.status, 200); return response.json();
    };
    let fixture = await createChatFirstPreviewFixture({ clock }), saved, agenda;
    try {
      fixture.tables.availability.push({ id: randomUUID(), day_of_week: 1, start_time: '09:00', end_time: '14:00', is_active: true });
      agenda = await createPreviewAgendaPersistence({ root, port, tables: fixture.tables });
      saved = await store(port, fixture.tables);
      const row = appointment(); row.booked_time = '10:00'; row.meet_url = `https://meet.jit.si/Akrasia-${row.id}`; row.conversation_id = null; row.lead_id = null;
      for (const field of ['status', 'context_version', 'starts_at', 'created_at', 'updated_at']) delete row[field];
      const result = await rpc(fixture, 'booking_create_once', { p_visitor_id: row.visitor_id, p_expires_at: Math.floor(now / 1000) + 86400, p_context_version: 0, p_booking: row });
      equal(result.created, true); equal(result.booking.status, 'confirmed'); equal(fixture.tables.bookings.length, 1); ok(fixture.tables.integration_outbox.length > 0);
      const originalKey = fixture.environment('http://localhost:4356').CHAT_SESSION_SECRET;
      await fixture.close(); fixture = null; await Promise.all([saved.close(), agenda.close()]);
      equal((await read(saved.file)).bookings[0].id, row.id);
      fixture = await createChatFirstPreviewFixture({ clock });
      saved = await store(port, fixture.tables); agenda = await createPreviewAgendaPersistence({ root, port, tables: fixture.tables });
      equal(fixture.tables.bookings.length, 1); equal(fixture.tables.visitors.length, 0); equal(fixture.tables.messages.length, 0);
      equal(fixture.tables.leads.length, 0); equal(fixture.tables.integration_outbox.length, 0); ok(!fixture.chat.contextStates.has(row.visitor_id));
      ok(fixture.environment('http://localhost:4356').CHAT_SESSION_SECRET !== originalKey);
      const admin = await fetch(`${fixture.origin}/rest/v1/bookings?booked_date=gte.2026-10-04&booked_date=lte.2026-10-11&order=booked_date,booked_time,id`, { headers });
      equal(admin.status, 200); const rows = await admin.json(); equal(rows.length, 1);
      equal(rows[0].id, row.id); equal(rows[0].booked_date, row.booked_date); equal(rows[0].booked_time, row.booked_time); equal(rows[0].meet_url, row.meet_url);
      equal(rows[0].visitor_name, row.visitor_name); equal(rows[0].visitor_email, row.visitor_email);
      equal(await rpc(fixture, 'booking_available', { p_date: row.booked_date, p_time: '10:00' }), false);
      equal(await rpc(fixture, 'booking_available', { p_date: row.booked_date, p_time: '10:30' }), false);
      equal(await rpc(fixture, 'booking_available', { p_date: row.booked_date, p_time: '11:00' }), true);
      equal(await rpc(fixture, 'booking_owned_action', { p_visitor_id: randomUUID(), p_booking_id: row.id, p_action: 'get' }), { error: 'invalid_reference' });
      const cancelled = await rpc(fixture, 'booking_admin_status', { p_id: row.id, p_status: 'cancelled' }); equal(cancelled[0].status, 'cancelled');
      equal(await rpc(fixture, 'booking_available', { p_date: row.booked_date, p_time: '10:00' }), true);
      await saved.flush(); equal((await read(saved.file)).bookings[0].status, 'cancelled');
    } finally { await fixture?.close(); await Promise.allSettled([saved?.close(), agenda?.close()]); }
  });
  console.log(`Preview bookings persistence: ${groups} groups, ${checks} checks passed.`);
} finally {
  await Promise.allSettled(sessions.map(session => session.close()));
  const target = path.resolve(root), parent = path.resolve(tmpdir()) + path.sep;
  assert.ok(target.startsWith(parent), 'Cleanup stays inside the disposable temporary directory');
  await rm(target, { recursive: true, force: true });
}
