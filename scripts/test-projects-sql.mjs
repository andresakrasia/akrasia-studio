import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Source review only. This script does NOT parse/execute PostgreSQL or prove
// defaults, permissions, RLS, rollback, stored rows or migration reapplication.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');
let assertions = 0;
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const migration = await read('supabase/migration-v12.sql');
const sql = migration.replace(/--[^\n]*/g, '');
const statements = sql.replace(/'(?:''|[^'])*'/g, "''");
ok(/^\s*BEGIN;\s*SET LOCAL search_path = pg_catalog;/.test(sql), 'Atomic owner migration');
ok(/COMMIT;\s*$/.test(sql), 'Atomic owner migration completes');
ok(/NOTIFY pgrst, 'reload schema';\s*COMMIT;\s*$/.test(sql), 'PostgREST schema reload notified only on successful commit');
ok(/ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false/.test(sql), 'False first-addition/default creation');
ok(/ADD COLUMN IF NOT EXISTS public_description TEXT NOT NULL DEFAULT ''/.test(sql), 'Separate empty editorial text');
ok(!/\b(?:INSERT INTO|UPDATE\s+public\.projects|DELETE FROM|TRUNCATE|DROP TABLE)\b/i.test(statements), 'No project/data rewrites');
ok(!/CREATE (?:OR REPLACE )?FUNCTION|SECURITY DEFINER|\bGRANT\b|\bREVOKE\b|ALTER DEFAULT PRIVILEGES|CREATE POLICY|DROP POLICY/i.test(sql), 'No new RPC or ACL/RLS rewrite');
ok(!/\bWHERE\s+status\b|SET\s+is_published|public_description\s*=\s*description/i.test(sql), 'No status-based approval or internal-to-public copy');
for (const guard of ['a05_server_only', 'relrowsecurity', 'pg_inherits', 'has_table_privilege', 'has_any_column_privilege', "pg_has_role('anon'", "pg_has_role('authenticated'", 'rolbypassrls', 'attnotnull', 'attidentity', 'attgenerated', 'pg_get_expr']) {
  ok(sql.includes(guard), `Source guard: ${guard}`);
}
ok(sql.includes("('is_published', 'boolean'::regtype, 'false')"), 'Detect incompatible existing Boolean/default');
ok(sql.includes("('public_description', 'text'::regtype, '''''::text')"), 'Detect incompatible existing editorial/default');
ok(/no UPDATE\/backfill\/seed/i.test(migration), 'Reapplication intent documented');
const prepare = await read('supabase/tests/a06-prepare.sql');
const verify = await read('supabase/tests/a06-verify.sql');
for (const [name, text] of [['prepare', prepare], ['verify', verify]]) {
  ok(text.includes("current_database() !~ '^akrasia_a05_"), `${name}: disposable DB name guard`);
  ok(text.includes("current_setting('akrasia.a05_disposable', true)"), `${name}: disposable bootstrap marker`);
  ok(text.includes('SELECT rolsuper'), `${name}: disposable superuser guard`);
  ok(text.includes('\\set ON_ERROR_STOP on'), `${name}: fail instead of false success`);
}
ok(verify.includes('\\ir ../migration-v12.sql'), 'Actual second file application prepared');
ok(verify.includes('expected_rows') && verify.includes('expected_catalog'), 'Compare rows and catalog after second application');
ok(verify.includes("to_jsonb(p) - 'is_published' - 'public_description'"), 'Compare every preexisting internal field');
ok(verify.includes('WHERE is_published IS TRUE AND id=') && verify.includes('WHERE is_published IS TRUE AND slug='), 'Known withdrawn identity/slug prepared');
ok(verify.includes("ARRAY['anon','authenticated']") && verify.includes("'42501'"), 'Public-role denial probes prepared');
ok(verify.includes("'23502'"), 'NOT NULL probes prepared');
ok(verify.includes('SET LOCAL ROLE service_role'), 'Legitimate privileged SQL operation probes prepared');
ok(verify.includes("SET status='delivered'") && verify.includes('status-independent explicit publication/withdrawal'), 'Status independence prepared');
ok(verify.includes('ROLLBACK;'), 'Final mutations rolled back');
console.log(`PASS: ${assertions} static source assertions; PostgreSQL SQL/ACL/RLS/reapplication NOT executed by this script.`);
