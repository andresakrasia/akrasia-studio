import { mkdir, lstat, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// Explicitly enabled local appointment preservation. Only booking rows are
// copied; chat identities, signing keys and integration jobs remain in memory.
const MAX_BYTES = 4 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const invalid = () => { throw new Error('Invalid private preview bookings snapshot'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.hasOwn(value, key);
const required = ['id', 'visitor_id', 'booked_date', 'booked_time', 'duration_min', 'buffer_min', 'status', 'meet_url', 'context_version', 'starts_at', 'created_at', 'updated_at'];
const contact = ['visitor_email', 'visitor_phone', 'visitor_name', 'notes'];
function fields(row, keys, optional = []) {
  if (!object(row) || keys.some(key => !has(row, key)) || Object.keys(row).some(key => !keys.includes(key) && !optional.includes(key))) invalid();
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2199-12-31') invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function time(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):(?:00|30)(?::00)?$/.test(value)) invalid();
  return value.slice(0, 5);
}
function timestamp(value) {
  const match = typeof value === 'string' && /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  const instant = Date.parse(value);
  if (!match || !Number.isFinite(instant) || new Date(instant).toISOString() !== `${match[1]}.${(match[2] || '').padEnd(3, '0')}Z`) invalid();
  return instant;
}
const madrid = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function madridInstant(day, hour) {
  const base = Date.parse(`${day}T${hour}:00Z`);
  const matches = [60, 120].map(offset => base - offset * 60000).filter(instant => {
    const parts = Object.fromEntries(madrid.formatToParts(new Date(instant)).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}` === day && `${parts.hour}:${parts.minute}` === hour;
  });
  if (matches.length !== 1) invalid();
  return matches[0];
}
function meeting(value) {
  if (value === '') return value;
  if (typeof value !== 'string' || value.length > 1024 || /[\s\u0000-\u001f\u007f]/.test(value)) invalid();
  let parsed; try { parsed = new URL(value); } catch { invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) invalid();
  return value;
}
function text(value, maximum, email = false) {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > maximum || /[\u0000-\u001f\u007f]/.test(value) || email && !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/.test(value)) invalid();
  return value;
}
function rows(values, source) {
  if (!Array.isArray(values) || values.length > 4096) invalid();
  const seen = new Set();
  return values.map(row => {
    fields(row, [...required, ...(source ? [] : contact)], source ? [...contact, 'conversation_id', 'lead_id'] : []);
    if (typeof row.id !== 'string' || !UUID.test(row.id) || seen.has(row.id.toLowerCase()) || typeof row.visitor_id !== 'string' || !UUID.test(row.visitor_id)) invalid();
    seen.add(row.id.toLowerCase());
    // Conversation/contact records are never restored. These source references
    // are validated and then omitted so the restored agenda has no dangling IDs.
    if (source) for (const key of ['conversation_id', 'lead_id']) if (row[key] != null && (typeof row[key] !== 'string' || !UUID.test(row[key]))) invalid();
    const booked_date = date(row.booked_date), booked_time = time(row.booked_time);
    if (row.duration_min !== 30 || row.buffer_min !== 30 || !['pending', 'confirmed', 'completed', 'cancelled'].includes(row.status) || !Number.isSafeInteger(row.context_version) || row.context_version < 0 || timestamp(row.starts_at) !== madridInstant(booked_date, booked_time)) invalid();
    if (timestamp(row.updated_at) < timestamp(row.created_at)) invalid();
    return { id: row.id, visitor_id: row.visitor_id, booked_date, booked_time, duration_min: 30, buffer_min: 30,
      status: row.status, meet_url: meeting(row.meet_url), context_version: row.context_version, starts_at: row.starts_at,
      created_at: row.created_at, updated_at: row.updated_at,
      visitor_email: text(row.visitor_email, 254, true), visitor_phone: text(row.visitor_phone, 64), visitor_name: text(row.visitor_name, 150), notes: text(row.notes, 1000) };
  });
}
function snapshot(tables, port, source) {
  return { version: 1, port, time_zone: 'Europe/Madrid', bookings: rows(tables.bookings, source) };
}
async function existingFile(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) invalid();
    return info;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function createPreviewBookingsPersistence({ root, port, tables, intervalMs = 400, onError = () => {} }) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || !Number.isInteger(port) || port < 1024 || port > 65535 || !object(tables) || !Number.isInteger(intervalMs) || intervalMs < 25 || intervalMs > 10000 || typeof onError !== 'function') invalid();
  const directory = path.join(root, '.codex-tmp');
  const file = path.join(directory, `preview-bookings-${port}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryInfo = await lstat(directory);
  const actualDirectory = await realpath(directory), expectedDirectory = path.join(await realpath(root), '.codex-tmp');
  const normalized = value => process.platform === 'win32' ? value.toLowerCase() : value;
  if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || normalized(actualDirectory) !== normalized(expectedDirectory)) invalid();
  let lastSaved;
  if (await existingFile(file)) {
    const bytes = await readFile(file);
    if (bytes.length > MAX_BYTES) invalid();
    let saved; try { saved = JSON.parse(bytes.toString('utf8')); } catch { invalid(); }
    fields(saved, ['version', 'port', 'time_zone', 'bookings']);
    if (saved.version !== 1 || saved.port !== port || saved.time_zone !== 'Europe/Madrid') invalid();
    const restored = snapshot(saved, port, false);
    tables.bookings = restored.bookings;
    lastSaved = JSON.stringify(restored);
  }
  let pending = Promise.resolve(), closing;
  const flush = () => {
    const task = pending.catch(() => {}).then(async () => {
      const encoded = JSON.stringify(snapshot(tables, port, true));
      if (encoded === lastSaved) return;
      if (Buffer.byteLength(encoded) > MAX_BYTES) invalid();
      await existingFile(file);
      const temporary = `${file}.${randomUUID()}.tmp`;
      let handle;
      try {
        handle = await open(temporary, 'wx', 0o600);
        await handle.writeFile(`${encoded}\n`, 'utf8'); await handle.sync(); await handle.close(); handle = undefined;
        await rename(temporary, file); lastSaved = encoded;
      } finally { await handle?.close(); await rm(temporary, { force: true }); }
    });
    pending = task; return task;
  };
  await flush();
  const timer = setInterval(() => { void flush().catch(() => { try { onError(); } catch {} }); }, intervalMs);
  timer.unref();
  return { file, flush, close() { if (!closing) { clearInterval(timer); closing = flush(); } return closing; } };
}
