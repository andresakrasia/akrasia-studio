import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPreviewAgendaPersistence } from './preview-agenda-persistence.mjs';
import { createChatFirstPreviewFixture } from './chat-first-preview-fixture.mjs';
import { TEST_SERVICE_KEY } from './dashboard-auth-test-fixture.mjs';

// Disposable files, loopback fixtures and synthetic rules only; no .env.
const root = await mkdtemp(path.join(tmpdir(), 'akrasia-preview-agenda-test-'));
let checks = 0, groups = 0;
const equal = (actual, expected) => { checks++; assert.deepEqual(actual, expected); };
const ok = actual => { checks++; assert.ok(actual); };
const rejects = async action => { checks++; await assert.rejects(action, /Invalid private preview agenda snapshot/); };
const group = async (title, work) => { await work(); console.log(`ok ${++groups} - ${title}`); };
const weekly = () => ({ id: randomUUID(), day_of_week: 1, start_time: '09:00:00', end_time: '13:00:00', is_active: true, created_at: '2026-10-04T10:00:00.000Z' });
const dated = () => ({ id: randomUUID(), override_date: '2026-10-06', start_time: '11:10', end_time: '11:20', is_available: false, note: 'Bloqueo sintético' });
const tables = () => ({ availability: [], availability_overrides: [], chat_sessions: [{ secret: 'DO_NOT_PERSIST' }], bookings: [{ visitor_email: 'DO_NOT_PERSIST' }], messages: [{ content: 'DO_NOT_PERSIST' }] });
const read = async file => JSON.parse(await readFile(file, 'utf8'));
const pause = () => new Promise(resolve => setTimeout(resolve, 90));
const sessions = [];
async function store(port, values, options = {}) {
  const value = await createPreviewAgendaPersistence({ root, port, tables: values, ...options }); sessions.push(value); return value;
}
try {
  await group('Only editable agenda fields are saved; unrelated fixture data stays in memory', async () => {
    const values = tables(); values.availability.push(weekly()); values.availability_overrides.push(dated());
    const saved = await store(4338, values);
    const text = await readFile(saved.file, 'utf8'), data = JSON.parse(text);
    equal(Object.keys(data).sort(), ['availability', 'availability_overrides', 'port', 'time_zone', 'version']);
    equal(data.port, 4338); equal(data.time_zone, 'Europe/Madrid'); equal(data.version, 1);
    equal(data.availability[0].start_time, '09:00'); equal(data.availability[0].end_time, '13:00');
    equal(data.availability_overrides[0].note, 'Bloqueo sintético');
    ok(!text.includes('DO_NOT_PERSIST')); ok(!text.includes('created_at')); await saved.close();
    const fresh = tables(), restored = await store(4338, fresh);
    equal(fresh.availability, data.availability); equal(fresh.availability_overrides, data.availability_overrides);
    equal(fresh.messages, [{ content: 'DO_NOT_PERSIST' }]); await restored.close();
  });
  await group('Port isolation, short polling and final flush preserve edits and removals', async () => {
    const values = tables(), saved = await store(4340, values, { intervalMs: 25 });
    const other = await store(4341, tables()); equal((await read(other.file)).availability.length, 0);
    values.availability.push(weekly()); await pause(); equal((await read(saved.file)).availability.length, 1);
    values.availability[0].is_active = false;
    values.availability_overrides.push({ ...dated(), start_time: null, end_time: null });
    await Promise.all([saved.flush(), saved.flush(), saved.close()]);
    const final = await read(saved.file); equal(final.availability[0].is_active, false); equal(final.availability_overrides[0].start_time, null);
    values.availability = []; await pause(); equal((await read(saved.file)).availability.length, 1);
    const restoredTables = tables(), restored = await store(4340, restoredTables);
    restoredTables.availability = []; restoredTables.availability_overrides = []; await restored.close();
    const empty = await read(restored.file); equal(empty.availability, []); equal(empty.availability_overrides, []);
    equal((await readdir(path.dirname(saved.file))).filter(name => name.endsWith('.tmp')), []); await other.close();
  });
  await group('Invalid runtime rows cannot overwrite the last valid snapshot', async () => {
    const values = tables(); values.availability.push(weekly()); const saved = await store(4342, values);
    const before = await readFile(saved.file, 'utf8'), valid = structuredClone(values.availability[0]);
    const malformed = [
      { ...valid, id: 'not-a-uuid' }, { ...valid, day_of_week: 7 }, { ...valid, day_of_week: 1.5 },
      { ...valid, start_time: '24:00' }, { ...valid, end_time: '08:00' }, { ...valid, start_time: '09:10', end_time: '09:40' },
      { ...valid, is_active: 'true' }, { ...valid, visitor_email: 'private@example.invalid' }, { ...valid, created_at: 'invalid' },
    ];
    for (const row of malformed) { values.availability = [row]; await rejects(() => saved.flush()); equal(await readFile(saved.file, 'utf8'), before); }
    values.availability = [valid, { ...valid }]; await rejects(() => saved.flush()); values.availability = [valid]; await saved.close();
  });
  await group('Date, boolean, whole-day pair and note validation matches agenda rules', async () => {
    const values = tables(), saved = await store(4343, values), valid = dated();
    const malformed = [
      { ...valid, override_date: '2026-02-30' }, { ...valid, override_date: '1999-12-31' }, { ...valid, override_date: '2200-01-01' },
      { ...valid, start_time: null }, { ...valid, end_time: null }, { ...valid, is_available: 0 },
      { ...valid, is_available: true }, { ...valid, note: 'x'.repeat(501) }, { ...valid, note: 'invalid\u0000note' },
      { ...valid, note: { email: 'private@example.invalid' } }, { ...valid, csrfToken: 'do-not-persist' },
    ];
    for (const row of malformed) { values.availability_overrides = [row]; await rejects(() => saved.flush()); }
    values.availability_overrides = [{ ...valid, is_available: true, start_time: '09:00', end_time: '09:30', note: null }];
    await saved.flush(); equal((await read(saved.file)).availability_overrides[0].end_time, '09:30'); await saved.close();
  });
  await group('Malformed saved data fails before changing fixture rows or replacing files', async () => {
    const directory = path.join(root, '.codex-tmp'); await mkdir(directory, { recursive: true });
    const file = path.join(directory, 'preview-agenda-4344.json');
    const base = { version: 1, port: 4344, time_zone: 'Europe/Madrid', availability: [], availability_overrides: [] };
    const malformed = ['{broken', JSON.stringify({ ...base, port: 4338 }), JSON.stringify({ ...base, version: 2 }), JSON.stringify({ ...base, time_zone: 'UTC' }), JSON.stringify({ ...base, messages: [] }), JSON.stringify({ ...base, availability: [weekly()] }), JSON.stringify({ ...base, availability_overrides: [{ ...dated(), override_date: '2026-04-31' }] })];
    for (const text of malformed) {
      await writeFile(file, text); const values = tables(); const original = weekly(); values.availability.push(original);
      await rejects(() => store(4344, values)); equal(values.availability, [original]); equal(await readFile(file, 'utf8'), text);
    }
    await writeFile(file, JSON.stringify(base)); const saved = await store(4344, tables()); await saved.close();
    for (const port of [433.8, 80, 65536, '../../other']) await rejects(() => store(port, tables()));
  });
  await group('Admin fixture writes persist across restart and feed the customer calendar', async () => {
    const clock = () => Date.UTC(2026, 9, 4, 9);
    const headers = { apikey: TEST_SERVICE_KEY, authorization: `Bearer ${TEST_SERVICE_KEY}`, 'content-type': 'application/json' };
    const request = async (fixture, route, body) => {
      const response = await fetch(`${fixture.origin}/rest/v1/${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
      ok(response.ok); return response.json();
    };
    let fixture = await createChatFirstPreviewFixture({ clock });
    let saved;
    try {
      saved = await store(4345, fixture.tables);
      for (const [day, start, end] of [[1, '10:00', '14:00'], [2, '10:00', '12:00'], [2, '16:00', '20:00'], [3, '10:00', '14:00'], [4, '16:00', '20:00'], [5, '10:00', '14:00']]) {
        await request(fixture, 'availability', { day_of_week: day, start_time: start, end_time: end, is_active: true });
      }
      const range = { p_start_date: '2026-10-04', p_end_date: '2026-10-31' };
      const before = await request(fixture, 'rpc/booking_slots_range', range);
      equal(before.length, 176); equal(before[0], { date: '2026-10-05', time: '10:00' });
      await fixture.close(); fixture = null; await saved.close();
      equal((await read(saved.file)).availability.length, 6);
      fixture = await createChatFirstPreviewFixture({ clock });
      saved = await store(4345, fixture.tables);
      equal(fixture.tables.availability.length, 6);
      equal(await request(fixture, 'rpc/booking_slots_range', range), before);
      await request(fixture, 'availability_overrides', { override_date: '2026-10-05', start_time: null, end_time: null, is_available: false, note: null });
      equal((await request(fixture, 'rpc/booking_slots_range', range)).filter(slot => slot.date === '2026-10-05'), []);
      await saved.flush(); equal((await read(saved.file)).availability_overrides.length, 1);
    } finally { await fixture?.close(); await saved?.close(); }
  });
  console.log(`Preview agenda persistence: ${groups} groups, ${checks} checks passed.`);
} finally {
  await Promise.allSettled(sessions.map(session => session.close()));
  const target = path.resolve(root), parent = path.resolve(tmpdir()) + path.sep;
  assert.ok(target.startsWith(parent), 'Cleanup stays inside the disposable temporary directory');
  await rm(target, { recursive: true, force: true });
}
