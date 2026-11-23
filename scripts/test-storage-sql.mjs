import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Source assertions ONLY. Does not interpret PostgreSQL or execute RLS, ACL,
// bucket configuration, SQL rollback/reapplication, CDN or Storage service.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');
let checks = 0;
const ok = (value, message) => { checks++; assert.ok(value, message); };
const migration = await read('supabase/migration-v14.sql');
const sql = migration.replace(/--[^\n]*/g, '');
ok(/^\s*BEGIN;\s*SET LOCAL search_path = pg_catalog;/.test(sql), 'Atomic owner migration');
ok(/COMMIT;\s*$/.test(sql), 'Completes atomic migration');
ok(sql.includes("SET LOCAL lock_timeout = '5s';"), 'Bounded migration lock wait');
ok(sql.includes('LOCK TABLE storage.buckets, storage.objects IN SHARE ROW EXCLUSIVE MODE;'), 'Config/policy migration race fenced');
ok(/UPDATE storage\.buckets SET public=false, file_size_limit=2097152,[^;]*WHERE id='project-thumbnails';/.test(sql), 'Legacy closure is bucket-scoped');
ok(/VALUES \('project-media-private','project-media-private',false,2097152,ARRAY\['image\/webp'\]::TEXT\[\]\)/.test(sql), 'Private WebP-only 2 MiB new bucket');
ok(/ON CONFLICT\(id\) DO NOTHING;/.test(sql), 'Compatible reapplication without row rewrite');
ok(/name IS DISTINCT FROM 'project-media-private' OR public IS DISTINCT FROM false/.test(sql), 'Preexisting new bucket cannot be silently taken over');
ok(sql.includes("allowed_mime_types IS DISTINCT FROM ARRAY['image/webp']::TEXT[]"), 'Existing MIME contract validated');
ok(sql.includes("file_size_limit IS DISTINCT FROM 2097152::BIGINT"), 'Existing byte-limit contract validated');
ok(sql.includes("name !~ '^thumbs/"), 'Existing new-bucket keys reviewed');
ok(!/(?:DELETE FROM|TRUNCATE(?: TABLE)?|INSERT INTO|UPDATE)\s+storage\.objects/i.test(sql), 'No object metadata mutations');
ok(!/(?:INSERT INTO|UPDATE|DELETE FROM|TRUNCATE(?: TABLE)?)\s+public\./i.test(sql), 'No application data/reference mutations');
ok(!/ALTER TABLE|ALTER ROLE|ALTER DEFAULT PRIVILEGES|\bGRANT\b|\bREVOKE\b|\bCASCADE\b|CREATE (?:OR REPLACE )?FUNCTION/.test(sql), 'No shared ACL/schema/role/RPC rewrites');
const policies = [...sql.matchAll(/CREATE POLICY (\w+) ON (storage\.\w+)([^;]*);/g)];
assert.equal(policies.length, 4); checks++;
for (const [name, table, column] of [['a10_private_project_objects','storage.objects','bucket_id'], ['a10_private_project_buckets','storage.buckets','id']]) {
  const found = policies.find(p => p[1] === name && p[2] === table);
  ok(found, `Explicit restrictive policy for ${table}`);
  ok(found[3].includes('AS RESTRICTIVE FOR ALL TO PUBLIC'), 'Broad permissive policies cannot OR past guard');
  ok(found[3].includes(`USING (${column} NOT IN ('project-thumbnails','project-media-private') OR current_user='service_role')`), 'Managed existing-row denial, unrelated rows unchanged');
  ok(found[3].includes(`WITH CHECK (${column} NOT IN ('project-thumbnails','project-media-private') OR current_user='service_role')`), 'Managed new-row/cross-bucket denial');
}
for (const sourceGuard of ['relrowsecurity', 'pg_inherits', 'rolbypassrls', 'rolsuper', "pg_has_role('anon'", "pg_has_role('authenticated'", 'has_schema_privilege', 'TRUNCATE,REFERENCES,TRIGGER', 'has_any_column_privilege', 'WITH RECURSIVE related', 'exposed dependent Storage view', 'missing or unexpected overload', 'has_function_privilege', 'routine.proowner', 'routine.proconfig']) {
  ok(sql.includes(sourceGuard), `Preflight source guard: ${sourceGuard}`);
}
const v11 = (await read('supabase/migration-v11.sql')).replace(/--[^\n]*/g,'');
ok(sql.includes("WHERE config IN ('search_path=','search_path=\"\"')"), 'Exact empty search_path representations, not a quotes-stripping approximation');
ok(/public\.increment_message_count\(conv_id UUID\)[^]*?SECURITY INVOKER SET search_path = ''/.test(v11), 'Original SECURITY DEFINER repaired by A05');
ok(v11.includes('REVOKE ALL ON FUNCTION public.increment_message_count(UUID) FROM PUBLIC, anon, authenticated, service_role;'), 'Original helper execution revoked by A05');
ok(!/GRANT EXECUTE ON FUNCTION public\.increment_message_count/.test(v11), 'Unused helper has no server RPC grant');
const v13 = (await read('supabase/migration-v13.sql')).replace(/--[^\n]*/g,'');
for (const name of ['chat_context_state','chat_erase_context','chat_save_turn','chat_insert_booking','chat_retention_batch']) {
  ok(sql.includes(`public.${name}(`), `V14 checks existing A09 ${name}`);
  ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^]*?SECURITY DEFINER SET search_path = ''`).test(v13), `A09 empty search_path: ${name}`);
  ok(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^;]*FROM PUBLIC, anon, authenticated, service_role;`).test(v13), `A09 private execution: ${name}`);
}
for (const name of ['a10-prepare.sql','a10-verify.sql']) {
  const text = await read(`supabase/tests/${name}`);
  ok(text.includes('\\set ON_ERROR_STOP on'), `${name}: SQL errors cannot be false successes`);
  ok(text.includes("current_database() !~ '^akrasia_a05_"), `${name}: disposable DB guard`);
  ok(text.includes("current_setting('akrasia.a05_disposable',true)"), `${name}: bootstrap marker`);
  ok(text.includes('SELECT rolsuper'), `${name}: superuser restricted to disposable fixture`);
}
const verify = await read('supabase/tests/a10-verify.sql');
for (const phrase of ['before_objects','before_projects','before_unrelated_bucket','before_acl','before_policies','a10_expected_snapshot','\\ir ../migration-v14.sql','ALTER ROLE service_role NOBYPASSRLS','API upload unexpectedly succeeded','Cross-bucket move unexpectedly succeeded','Legitimate unrelated read changed','insufficient_privilege',"a10_api_probe('anon')","a10_api_probe('authenticated')",'ROLLBACK;']) {
  ok(verify.includes(phrase), `Prepared PostgreSQL probe: ${phrase}`);
}
console.log(`PASS: ${checks} static Storage/SQL source assertions; PostgreSQL, RLS, ACL, Storage and reapplication NOT executed.`);
