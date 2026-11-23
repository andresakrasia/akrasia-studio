import assert from 'node:assert/strict';
import { createServer } from 'vite';
const vite = await createServer({ configFile: false, envFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true } });
let checks = 0, groups = 0;
const equal = (actual, expected) => { checks++; assert.deepEqual(actual, expected); };
const ok = value => { checks++; assert.ok(value); };
async function group(name, run) { await run(); console.log(`ok ${++groups} - ${name}`); }
const row = (id, booked_date = '2026-10-05', booked_time = '10:00:00', status = 'confirmed') => ({ id, booked_date, booked_time, status, duration_min: 30, meet_url: '', visitor_name: 'Synthetic', visitor_email: 'synthetic@example.invalid', visitor_phone: null, notes: null, created_at: '2026-10-04T09:00:00Z' });
const response = (rows, total = rows.length, next = '') => new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json', 'X-Total-Count': String(total), 'X-Next-Offset': next } });
try {
  const agenda = await vite.ssrLoadModule('/src/lib/admin-booking-agenda.ts');
  await group('Every server page is consumed and the date range stays independent of the visible week', async () => {
    const calls = [];
    const rows = Array.from({ length: 205 }, (_, index) => row(`synthetic-${String(index).padStart(3, '0')}`));
    const result = await agenda.loadAdminBookingRange(async endpoint => {
      const url = new URL(endpoint, 'http://localhost:1'); calls.push(url);
      const offset = Number(url.searchParams.get('offset'));
      equal(url.searchParams.get('from'), '2026-10-04'); equal(url.searchParams.get('to'), '2027-04-02'); equal(url.searchParams.get('limit'), '100');
      const chunk = rows.slice(offset, offset + 100);
      return response(chunk, rows.length, offset + chunk.length < rows.length ? String(offset + chunk.length) : '');
    }, '2026-10-04', '2027-04-02');
    equal(calls.map(url => url.searchParams.get('offset')), ['0', '100', '200']); equal(result, rows);
    const empty = await agenda.loadAdminBookingRange(async () => response([]), '2026-10-04', '2027-04-02'); equal(empty, []);
  });
  await group('A failed or malformed page never becomes a silently truncated agenda', async () => {
    const bad = [new Response('{}', { status: 401 }), new Response('{}', { status: 503 }), new Response('[]'), response([row('outside', '2027-06-01')]), response([row('bad-time', '2026-10-05', '25:00:00')]), response([row('missing')], 101), response([row('loop')], 2, '0'), response([row('skipped')], 4, '3')];
    for (const value of bad) { checks++; await assert.rejects(() => agenda.loadAdminBookingRange(async () => value, '2026-10-04', '2027-04-02')); }
    let count = 0;
    checks++; await assert.rejects(() => agenda.loadAdminBookingRange(async () => ++count === 1 ? response(Array.from({ length: 100 }, (_, index) => row(`test-${index}`)), 101, '100') : new Response('{}', { status: 503 }), '2026-10-04', '2027-04-02'));
    equal(count, 2);
    checks++; await assert.rejects(() => agenda.loadAdminBookingRange(async () => assert.fail('invalid range should not fetch'), '2026-10-04', '2028-04-02'));
    const malformedPages = [response([row('same'), row('same')], 2), response([row('bounded')], 10001, '1'), response([{ ...row('duration'), duration_min: undefined }])];
    for (const value of malformedPages) { checks++; await assert.rejects(() => agenda.loadAdminBookingRange(async () => value, '2026-10-04', '2027-04-02')); }
    let changedCount = 0;
    checks++; await assert.rejects(() => agenda.loadAdminBookingRange(async () => ++changedCount === 1 ? response([row('one')], 2, '1') : response([row('two'), row('three')], 3), '2026-10-04', '2027-04-02'));
    equal(changedCount, 2);
    let duplicatePage = 0;
    checks++; await assert.rejects(() => agenda.loadAdminBookingRange(async () => ++duplicatePage === 1 ? response([row('same')], 2, '1') : response([row('same')], 2), '2026-10-04', '2027-04-02'));
    equal(duplicatePage, 2);
  });
  await group('Tomorrow remains upcoming across a Sunday/Monday week boundary and stale or cancelled appointments are excluded', () => {
    const now = Date.parse('2026-10-04T09:00:00Z'); // 11:00 in Madrid
    const rows = [row('past', '2026-10-03'), row('ended', '2026-10-04', '10:00:00'), row('ongoing', '2026-10-04', '10:45:00'), row('today', '2026-10-04', '12:00:00'), row('tomorrow', '2026-10-05'), row('later', '2026-10-20'), row('limit', '2027-04-02'), row('outside', '2027-04-03'), row('cancelled', '2026-10-05', '12:00:00', 'cancelled'), row('completed', '2026-10-05', '13:00:00', 'completed'), row('pending', '2026-10-05', '14:00:00', 'pending')];
    equal(agenda.upcomingConfirmedBookings([...rows].reverse(), now).map(booking => booking.id), ['ongoing', 'today', 'tomorrow', 'later', 'limit']);
    equal(agenda.upcomingConfirmedBookings([row('finished', '2026-10-04', '10:30:00')], now), []);
    equal(agenda.upcomingConfirmedBookings(rows, now).length, 5);
  });
  await group('Madrid instants respect timezone and DST and month cells begin on Monday', () => {
    const now = Date.parse('2026-10-24T22:30:00Z');
    equal(agenda.upcomingConfirmedBookings([row('repeated', '2026-10-25', '02:30:00'), row('later', '2026-10-25', '10:00:00')], now).map(booking => booking.id), ['later']);
    equal(agenda.upcomingConfirmedBookings([row('winter-ended', '2026-10-26', '10:00:00')], Date.parse('2026-10-26T09:30:00Z')), []);
    equal(agenda.bookingMonthCells('2026-10-04').slice(0, 7), [null, null, null, '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    equal(agenda.bookingMonthCells('2026-10-04').length, 35);
    equal(agenda.bookingMonthCells('2026-02-01').filter(Boolean).length, 28);
    equal(agenda.bookingMonthCells('2028-02-01').filter(Boolean).length, 29);
    equal(agenda.bookingMonthEnd('2026-10-04'), '2026-10-31'); equal(agenda.shiftBookingMonth('2026-12-31', 1), '2027-01-01'); equal(agenda.shiftBookingMonth('2026-01-31', -1), '2025-12-01');
    checks++; assert.throws(() => agenda.bookingMonthCells('2026-02-30'));
  });
  await group('Calendar links only use HTTPS without credentials or control characters', () => {
    equal(agenda.safeBookingJoinUrl('https://meet.jit.si/room'), 'https://meet.jit.si/room');
    for (const value of [null, '', 'http://meet.jit.si/room', 'javascript:alert(1)', 'https://user:secret@meet.jit.si/room', 'https://meet.jit.si/room\n']) equal(agenda.safeBookingJoinUrl(value), null);
    ok(agenda.safeBookingJoinUrl('https://meet.jit.si/Akrasia-synthetic')?.includes('Akrasia-synthetic'));
  });
  console.log(`Admin booking agenda: ${groups} groups / ${checks} checks passed; no real bookings or external connections.`);
} finally { await vite.close(); }
