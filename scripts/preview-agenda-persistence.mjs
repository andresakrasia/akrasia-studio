import { mkdir, lstat, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

// This opt-in local preview store contains schedule rules only. It never copies
// the rest of the fixture, visitor identities, signing keys or bookings.
const MAX_BYTES = 4 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const invalid = () => { throw new Error('Invalid private preview agenda snapshot'); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const has = (value, key) => Object.hasOwn(value, key);
function fields(row, required, optional = []) {
  if (!object(row) || required.some(key => !has(row, key)) || Object.keys(row).some(key => !required.includes(key) && !optional.includes(key))) invalid();
}
function time(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value)) invalid();
  return value.slice(0, 5);
}
const minute = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
function window(start, end, opening) {
  start = time(start); end = time(end);
  if (end <= start || opening && Math.ceil(minute(start) / 30) * 30 + 30 > minute(end)) invalid();
  return { start_time: start, end_time: end };
}
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2199-12-31') invalid();
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid();
  return value;
}
function metadata(row) {
  // The fixture adds creation timestamps. Validate them, then omit them from
  // disk so the saved schema stays limited to editable schedule fields.
  for (const key of ['created_at', 'updated_at']) if (has(row, key) && (typeof row[key] !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(row[key]) || !Number.isFinite(Date.parse(row[key])))) invalid();
}
function rows(values, kind, source) {
  if (!Array.isArray(values) || values.length > (kind === 'recurring' ? 512 : 4096)) invalid();
  const seen = new Set();
  return values.map(row => {
    const required = kind === 'recurring' ? ['id', 'day_of_week', 'start_time', 'end_time', 'is_active'] : ['id', 'override_date', 'start_time', 'end_time', 'is_available'];
    fields(row, required, [...(kind === 'override' ? ['note'] : []), ...(source ? ['created_at', 'updated_at'] : [])]);
    if (typeof row.id !== 'string' || !UUID.test(row.id) || seen.has(row.id.toLowerCase())) invalid();
    const id = row.id.toLowerCase(); seen.add(id); if (source) metadata(row);
    if (kind === 'recurring') {
      if (!Number.isInteger(row.day_of_week) || row.day_of_week < 0 || row.day_of_week > 6 || typeof row.is_active !== 'boolean') invalid();
      return { id, day_of_week: row.day_of_week, ...window(row.start_time, row.end_time, true), is_active: row.is_active };
    }
    if (typeof row.is_available !== 'boolean') invalid();
    const note = row.note ?? null;
    if (note !== null && (typeof note !== 'string' || note.length > 500 || note.includes('\u0000'))) invalid();
    const allDay = row.start_time === null && row.end_time === null;
    return { id, override_date: date(row.override_date), ...(allDay ? { start_time: null, end_time: null } : window(row.start_time, row.end_time, row.is_available)), is_available: row.is_available, note };
  });
}
function snapshot(tables, port, source) {
  return { version: 1, port, time_zone: 'Europe/Madrid', availability: rows(tables.availability, 'recurring', source), availability_overrides: rows(tables.availability_overrides, 'override', source) };
}
async function existingFile(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_BYTES) invalid();
    return info;
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function createPreviewAgendaPersistence({ root, port, tables, intervalMs = 400, onError = () => {} }) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || !Number.isInteger(port) || port < 1024 || port > 65535 || !object(tables) || !Number.isInteger(intervalMs) || intervalMs < 25 || intervalMs > 10000 || typeof onError !== 'function') invalid();
  const directory = path.join(root, '.codex-tmp');
  const file = path.join(directory, `preview-agenda-${port}.json`);
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
    fields(saved, ['version', 'port', 'time_zone', 'availability', 'availability_overrides']);
    if (saved.version !== 1 || saved.port !== port || saved.time_zone !== 'Europe/Madrid') invalid();
    const restored = snapshot(saved, port, false);
    tables.availability = restored.availability; tables.availability_overrides = restored.availability_overrides;
    lastSaved = JSON.stringify(restored);
  }
  // Each write is serialized and atomically replaces a complete validated file.
  // A failed write keeps the prior snapshot and is retried on the next poll.
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
