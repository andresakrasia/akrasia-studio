import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';

// This runner owns a NEW disposable cluster. It accepts no connection URL,
// loads no .env, uses loopback only, and never connects to an existing server.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'akrasia-pg-'));
const databaseDir = path.join(temporaryRoot, 'data');
const reservation = createServer();
await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '127.0.0.1', resolve); });
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const password = randomUUID();
const nativePlatform = process.platform === 'win32' ? 'windows' : process.platform;
const binaries = await import(`@embedded-postgres/${nativePlatform}-${process.arch}`);
// Windows' restricted-token relaunch cannot represent the workspace's Unicode
// path. Copy only the test runtime into an owned ASCII temporary directory.
const runtime = path.join(temporaryRoot, 'runtime');
await cp(path.dirname(path.dirname(binaries.postgres)), runtime, { recursive: true });
const executable = name => path.join(runtime, 'bin', `${name}${process.platform === 'win32' ? '.exe' : ''}`);
const safeEnv = { ...process.env, PGPASSWORD: password, PGCLIENTENCODING: 'UTF8' };
async function command(exe, args, input) {
  let output = '';
  const child = spawn(exe, args, { windowsHide: true, cwd: temporaryRoot, env: safeEnv, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  child.stdin.end(input);
  const background = path.basename(exe).startsWith('pg_ctl') && args.includes('start');
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once(background ? 'exit' : 'close', resolve); });
  if (background) { child.stdout.destroy(); child.stderr.destroy(); }
  if (code !== 0) throw new Error(output.slice(-12000));
  return output;
}
const results = [];
let client;
async function loadSql(file, ancestors = []) {
  const absolute = path.resolve(root, file);
  const allowed = path.join(root, 'supabase') + path.sep;
  if (!absolute.startsWith(allowed) || ancestors.includes(absolute)) throw new Error(`Unsafe SQL include: ${file}`);
  let sql = await readFile(absolute, 'utf8');
  const includes = [...sql.matchAll(/^\\ir\s+([^\r\n]+)\s*$/gm)];
  for (const match of includes) {
    const included = path.resolve(path.dirname(absolute), match[1].trim().replace(/^['"]|['"]$/g, ''));
    const content = await loadSql(path.relative(root, included), [...ancestors, absolute]);
    sql = sql.replace(match[0], () => content);
  }
  return sql;
}
async function runFile(file, variables = []) {
  let sql = await loadSql(file);
  if (file.endsWith('a05-bootstrap.sql')) {
    if (!variables.includes('a05_disposable=YES_DISPOSABLE_DATABASE_AND_CLUSTER')) throw new Error('Missing disposable bootstrap assertion');
    sql = sql.slice(sql.indexOf('BEGIN;'));
  }
  // Fixture-only psql display commands have no SQL semantics. Conditional
  // commands are handled only by the explicit bootstrap assertion above.
  if (/^\\(?:if|elif|else|endif|include|i)\b/m.test(sql)) throw new Error(`Unsupported psql control command: ${file}`);
  sql = sql.replace(/^\\(?:set|echo|pset|a|t)\b[^\r\n]*$/gm, '');
  try { await client.query(sql); }
  catch (error) {
    console.error({ message: error.message, position: error.position, where: error.where,
      internalPosition: error.internalPosition, internalQuery: error.internalQuery });
    if (error.position) console.error(sql.slice(Math.max(0, Number(error.position) - 300), Number(error.position) + 150));
    throw new Error(`SQL failed: ${file}`);
  }
  results.push({ file, passed: true }); console.log(`SQL OK: ${file}`);
}
try {
  const passwordFile = path.join(temporaryRoot, 'password');
  await writeFile(passwordFile, password, { mode: 0o600 });
  await command(executable('initdb'), ['-D', databaseDir, '-U', 'postgres', '--auth=scram-sha-256', '--pwfile', passwordFile, '--locale=C', '--encoding=UTF8']);
  await command(executable('pg_ctl'), ['-D', databaseDir, '-l', path.join(temporaryRoot, 'postgres.log'), '-w', '-t', '30', '-o', `-h 127.0.0.1 -p ${port}`, 'start']);
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' }); await client.connect();
  const version = (await client.query('SELECT version()')).rows[0].version;
  console.log(`Disposable loopback PostgreSQL: ${version}`);
  await client.query('CREATE DATABASE akrasia_a05_integrated');
  await client.end();
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'akrasia_a05_integrated' });
  await client.connect();
  await runFile('supabase/tests/a05-bootstrap.sql', ['a05_disposable=YES_DISPOSABLE_DATABASE_AND_CLUSTER']);
  // Preserve the empty bootstrap in a second database owned by this NEW
  // cluster. It exercises the complete production journal, without fixtures.
  await client.end();
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres' });
  await client.connect();
  await client.query('CREATE DATABASE akrasia_a05_manifest TEMPLATE akrasia_a05_integrated');
  await client.end();
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'akrasia_a05_integrated' });
  await client.connect();
  for (let version = 1; version <= 11; version++) await runFile(`supabase/${version === 1 ? 'migration.sql' : `migration-v${version}.sql`}`);
  await runFile('supabase/migration-v11.sql');
  await runFile('supabase/tests/a05-verify.sql');
  await runFile('supabase/tests/a06-prepare.sql');
  await runFile('supabase/migration-v12.sql'); await runFile('supabase/migration-v12.sql');
  await runFile('supabase/tests/a06-verify.sql');
  await runFile('supabase/migration-v13.sql'); await runFile('supabase/migration-v13.sql');
  await runFile('supabase/tests/a09-verify.sql');
  await runFile('supabase/tests/a10-prepare.sql');
  await runFile('supabase/migration-v14.sql'); await runFile('supabase/migration-v14.sql');
  await runFile('supabase/tests/a10-verify.sql');
  await runFile('supabase/migration-v15.sql'); await runFile('supabase/migration-v15.sql');
  await runFile('supabase/tests/a11-a15-verify.sql');
  const { verifyAgendaConcurrency } = await import('./agenda-concurrency-check.mjs');
  results.push({ file: 'scripts/agenda-concurrency-check.mjs', passed: true,
    ...await verifyAgendaConcurrency({ host: '127.0.0.1', port, user: 'postgres', password, database: 'akrasia_a05_integrated' }) });
  await runFile('supabase/migration-v16.sql'); await runFile('supabase/migration-v16.sql');
  await runFile('supabase/tests/a19-a27-verify.sql');
  await runFile('supabase/migration-v17.sql'); await runFile('supabase/migration-v17.sql');
  await runFile('supabase/tests/a17-a18-verify.sql');
  await runFile('supabase/migration-v18.sql'); await runFile('supabase/migration-v18.sql');
  await runFile('supabase/tests/a41-retention-verify.sql');
  await runFile('supabase/migration-v19.sql'); await runFile('supabase/migration-v19.sql');
  await runFile('supabase/tests/public-activity-verify.sql');
  await runFile('supabase/migration-v20.sql'); await runFile('supabase/migration-v20.sql');
  await runFile('supabase/tests/client-journey-verify.sql');
  await runFile('supabase/migration-v21.sql'); await runFile('supabase/migration-v21.sql');
  await runFile('supabase/tests/client-journey-workflow-verify.sql');
  await runFile('supabase/tests/client-journey-security-verify.sql');
  await runFile('supabase/migration-v22.sql'); await runFile('supabase/migration-v22.sql');
  await runFile('supabase/tests/booking-reminders-verify.sql');
  await runFile('supabase/migration-v23.sql'); await runFile('supabase/migration-v23.sql');
  await runFile('supabase/tests/booking-availability-verify.sql');
  await runFile('supabase/migration-v24.sql'); await runFile('supabase/migration-v24.sql');
  await runFile('supabase/tests/dashboard-availability-verify.sql');
  await runFile('supabase/migration-v25.sql'); await runFile('supabase/migration-v25.sql');
  await runFile('supabase/tests/booking-admin-notification-verify.sql');
  const { verifyClientJourneyConcurrency } = await import('./client-journey-concurrency-check.mjs');
  results.push({file:'scripts/client-journey-concurrency-check.mjs',passed:true,
    ...await verifyClientJourneyConcurrency({host:'127.0.0.1',port,user:'postgres',password,database:'akrasia_a05_integrated'})});
  const { verifyPublicActivityConcurrency } = await import('./public-activity-concurrency-check.mjs');
  results.push({file:'scripts/public-activity-concurrency-check.mjs',passed:true,
    ...await verifyPublicActivityConcurrency({host:'127.0.0.1',port,user:'postgres',password,database:'akrasia_a05_integrated'})});
  const { verifyMigrationJournal } = await import('./test-migration-manifest.mjs');
  results.push({file:'scripts/test-migration-manifest.mjs',passed:true,
    assertions:await verifyMigrationJournal({Client:pg.Client,connection:{host:'127.0.0.1',port,user:'postgres',password,database:'akrasia_a05_integrated'}})});
  await client.end();
  client = new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database: 'akrasia_a05_manifest' });
  await client.connect();
  // Match the Storage metadata prerequisites enforced by v14. These fields
  // belong to Supabase Storage in production, never to application migrations.
  // No bucket objects or demonstration rows are added to this clean database.
  await client.query('ALTER TABLE storage.buckets ADD COLUMN file_size_limit bigint, ADD COLUMN allowed_mime_types text[]; ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY');
  const { readMigrationPlan } = await import('./migration-manifest.mjs');
  const { applyMigrationPlan } = await import('./apply-migrations.mjs');
  const plan = await readMigrationPlan();
  const fresh = await applyMigrationPlan(client, plan);
  const replay = await applyMigrationPlan(client, plan);
  if (fresh.applied.length !== plan.length || replay.applied.length !== 0 || replay.skipped.length !== plan.length) throw new Error('Full migration journal/replay failed');
  const demoTables = ['services','projects','studio_stats','feed_entries','studio_logs','availability'];
  for (const table of demoTables) {
    const count = (await client.query(`SELECT count(*)::int AS total FROM public.${table}`)).rows[0].total;
    if (count !== 0) throw new Error(`Unexpected production demo seed: ${table}`);
  }
  results.push({file:'complete-production-manifest',passed:true,applied:fresh.applied,skipped:replay.skipped,demoTablesEmpty:demoTables});
  console.log(`PASS complete manifest: ${plan.length} journaled migrations, replay skipped, production demo tables empty.`);
  await mkdir(path.join(root, 'docs/evidence'), { recursive: true });
  await writeFile(path.join(root, 'docs/evidence/postgres-local.json'), JSON.stringify({ version,
    scope: 'Actual disposable PostgreSQL; Storage metadata stub only; no PostgREST/CDN/remote services.', results }, null, 2));
  console.log(`PASS: ${results.length} SQL files, including reapplication and real role/RLS checks.`);
} finally {
  await client?.end().catch(() => {});
  await command(executable('pg_ctl'), ['-D', databaseDir, '-m', 'immediate', '-w', '-t', '15', 'stop']).catch(() => {});
  const resolved = path.resolve(temporaryRoot);
  if (resolved.startsWith(`${path.resolve(tmpdir())}${path.sep}akrasia-pg-`)) await rm(resolved, { recursive: true, force: true });
}
