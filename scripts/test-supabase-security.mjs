import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { installFetchGuard } from './dashboard-test-network-guard.mjs';

// Source checks and actual application HTTP requests against a synthetic store.
// This is NOT a PostgreSQL interpreter or evidence of executed RLS/ACL tests.
// No .env, external provider, email or Telegram connection is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const key = 'A05_SYNTHETIC_SERVICE_KEY_DO_NOT_USE';
const scope = {
  visitors: 'SELECT, INSERT, UPDATE', conversations: 'SELECT, INSERT, UPDATE',
  messages: 'SELECT, INSERT', leads: 'SELECT, INSERT, UPDATE', content: 'SELECT, INSERT, UPDATE',
  projects: 'SELECT, INSERT, UPDATE, DELETE', project_tasks: 'SELECT, INSERT, UPDATE, DELETE',
  feed_entries: 'SELECT, INSERT, UPDATE', studio_logs: 'SELECT, INSERT, UPDATE',
  studio_stats: 'SELECT, UPDATE', services: 'SELECT, INSERT, UPDATE, DELETE',
  clients: 'SELECT, INSERT, UPDATE, DELETE', bookings: 'SELECT, INSERT, UPDATE',
  availability: 'SELECT, INSERT, DELETE', availability_overrides: 'SELECT',
  sent_emails: 'SELECT, INSERT', dashboard_sessions: 'SELECT, INSERT, DELETE',
  dashboard_login_limits: null, chat_quota_buckets: null, chat_concurrency_leases: null,
};
const laterTables={integration_outbox:15,dashboard_ai_operations:16,chat_turn_operations:17};
// CRM tables contain private contact, proposal, draft and operation text. Their
// access review is separate from public portfolio/editorial projection.
const journeyTables=['client_journeys','client_journey_events','email_drafts','client_journey_operations'];
let assertions = 0;
let groups = 0;
const ok = (value, message) => { assertions++; assert.ok(value, message); };
const equal = (a, b, message) => { assertions++; assert.deepEqual(a, b, message); };
async function group(name, run) { await run(); console.log(`ok ${++groups} - ${name}`); }
const read = file => readFile(path.join(root, file), 'utf8');
async function filesIn(folder) {
  const entries = await readdir(path.join(root, folder), { withFileTypes: true });
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? filesIn(`${folder}/${entry.name}`) : [`${folder}/${entry.name}`]));
  return nested.flat();
}

await group('Static migration scope matches every repository table, without global privilege changes', async () => {
  const migrations = (await readdir(path.join(root, 'supabase'))).filter(name => /^migration(?:-v\d+)?\.sql$/.test(name));
  const names = new Set();
  for (const name of migrations) {
    const text = await read(`supabase/${name}`);
    for (const match of text.matchAll(/CREATE TABLE IF NOT EXISTS (?:public\.)?(\w+)/gi)) names.add(match[1]);
  }
  equal([...names].sort(), [...Object.keys(scope),'chat_context_states',...Object.keys(laterTables),...journeyTables].sort(), 'New tables require an explicit access review in their introducing migration');
  const text = await read('supabase/migration-v11.sql');
  const sql = text.replace(/--[^\n]*/g, '');
  for (const [table, grants] of Object.entries(scope)) {
    ok(text.includes(`('${table}', ${grants === null ? 'NULL' : `'${grants}'`})`), `Explicit server ACL for ${table}`);
  }
  ok(/BEGIN;\s*SET LOCAL search_path = pg_catalog;/.test(sql));
  ok(/COMMIT;\s*$/.test(sql));
  ok(!/ALL (?:TABLES|FUNCTIONS|SEQUENCES) IN SCHEMA|ALTER DEFAULT PRIVILEGES|REVOKE .*ON SCHEMA|\bCASCADE\b|\bauth\.uid\(/i.test(sql));
  ok(/ENABLE ROW LEVEL SECURITY/.test(sql));
  ok(/FOR ALL TO service_role USING \(true\) WITH CHECK \(true\)/.test(sql));
  ok(!/DELETE FROM|TRUNCATE TABLE|DROP TABLE|INSERT INTO/i.test(sql), 'Hardening must preserve rows');
  ok(/has_any_column_privilege/.test(sql) && /has_sequence_privilege/.test(sql));
  ok(/WITH RECURSIVE related/.test(sql) && /pg_inherits/.test(sql));
});

await group('V20 private CRM tables and V21 workflow gates have reviewed server-only ACL and RPC boundaries',async()=>{
  const sql=(await read('supabase/migration-v20.sql')).replace(/--[^\n]*/g,'');
  const workflow=(await read('supabase/migration-v21.sql')).replace(/--[^\n]*/g,'');
  equal([...sql.matchAll(/CREATE TABLE IF NOT EXISTS public\.(\w+)/g)].map(match=>match[1]).sort(),[...journeyTables].sort(),'The reviewed migration introduces exactly the four private CRM tables');
  ok(sql.includes("FOREACH t IN ARRAY ARRAY['client_journeys','client_journey_events','email_drafts','client_journey_operations'] LOOP"),'RLS/ACL loop is restricted to the explicit reviewed tables');
  for(const command of ['ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY','REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated','GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role','CREATE POLICY service_only ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)'])ok(sql.includes(command),command);
  ok(!/CREATE POLICY[^;]*(?:TO anon|TO authenticated|TO PUBLIC)/i.test(sql),'No browser or public CRM policy');
  ok(!/ALTER DEFAULT PRIVILEGES|GRANT[^;]*ALL (?:TABLES|FUNCTIONS|SEQUENCES) IN SCHEMA/i.test(sql+workflow),'No global/default privilege grants');
  const signatures=['dashboard_create_client_journey(UUID,UUID,TEXT,TEXT,TEXT)','dashboard_update_client_journey(UUID,UUID,JSONB)','dashboard_save_email_draft(UUID,INTEGER,UUID,JSONB)','dashboard_queue_email_draft(UUID,INTEGER,UUID)'];
  for(const signature of signatures){
    ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated;`),`${signature} denies public/browser execution`);
    ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`),`${signature} grants exactly server execution`);
  }
  for(const name of ['dashboard_create_client_journey','dashboard_update_client_journey','dashboard_save_email_draft'])ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^]*?RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path=''`).test(sql),`${name} cannot bypass service table ACL/RLS`);
  ok(/CREATE OR REPLACE FUNCTION public\.dashboard_queue_email_draft\([^]*?RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=''/.test(sql),'Only queueing crosses the private outbox definer boundary');
  ok(sql.includes("SELECT * INTO v_row FROM public.email_drafts WHERE id=p_id FOR UPDATE;") && sql.includes("IF v_row.revision<>p_revision"),'Queue reads the locked saved revision rather than browser-supplied mail text');
  ok(sql.includes("public.integration_enqueue('email-draft:'||v_row.id::TEXT||':'||v_row.revision::TEXT"),'Queue idempotency is bound to one saved draft revision');
  ok(sql.includes("id UUID PRIMARY KEY") && sql.includes("UNIQUE(operation_id,event_type)"),'Operation/history keys prevent duplicate writes');
  ok(sql.includes("INTERVAL '30 days'") && sql.includes('public.client_journey_operations_retention(p_batch_size)'),'Private receipt retention is part of the bounded maintenance path');
  ok(sql.includes("REFERENCES public.leads(id) ON DELETE SET NULL") && sql.includes("REFERENCES public.projects(id) ON DELETE RESTRICT"),'Web lead erasure unlinks CRM while linked project history remains protected');
  for(const signature of ['client_journey_project_status(TEXT)','client_journey_project_guard()','client_journey_task_guard()']){
    ok(workflow.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC,anon,authenticated;`),`${signature} stays private`);
    ok(workflow.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`),`${signature} executes only for the server`);
  }
  ok(/RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=''/i.test(workflow),'Workflow trigger reads retain caller RLS/ACL');
  ok(workflow.includes("'client-journey-project:'||v_before.project_id::TEXT") && workflow.includes("'client-journey-project:'||v_project::TEXT"),'Task and milestone writes share the bounded project lock');
  const executedReview=await read('supabase/tests/client-journey-security-verify.sql');
  for(const phrase of ['ALTER ROLE service_role NOBYPASSRLS','has_any_column_privilege','pg_catalog.pg_policy','SET LOCAL ROLE anon','SET LOCAL ROLE authenticated','insufficient_privilege','ROLLBACK;'])ok(executedReview.includes(phrase),`Prepared actual PostgreSQL proof includes ${phrase}`);
});

await group('A15/A16/A17 new tables have explicit private RLS/ACL and bounded service-only operation contracts',async()=>{
 const sources={};
 for(const [table,version] of Object.entries(laterTables)){
  const sql=(await read(`supabase/migration-v${version}.sql`)).replace(/--[^\n]*/g,'');sources[version]=sql;
  ok(new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\s*\\(`,'i').test(sql),`${table} introduced only in its reviewed migration`);
  ok(sql.includes(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`),`${table} enables RLS`);
  ok(!new RegExp(`CREATE POLICY[^;]*ON public\\.${table}[^;]*TO[^;]*(?:anon|authenticated|PUBLIC)`,'i').test(sql),`${table} has no browser policy`);
  ok(!/ALTER DEFAULT PRIVILEGES|GRANT[^;]*ALL (?:TABLES|FUNCTIONS|SEQUENCES) IN SCHEMA/i.test(sql),'No broad ambient access grants');
 }
 for(const [table,version] of [['integration_outbox',15],['chat_turn_operations',17]]){
  const sql=sources[version];
  ok(sql.includes(`REVOKE ALL ON public.${table} FROM PUBLIC,anon,authenticated,service_role;`),`${table} has no direct API role access`);
  ok(!new RegExp(`GRANT[^;]*ON (?:TABLE )?public\\.${table}`,'i').test(sql),`${table} has no direct table grants`);
  ok(sql.includes(`REVOKE SELECT (%I),INSERT (%I),UPDATE (%I),REFERENCES (%I) ON public.${table} FROM PUBLIC,anon,authenticated,service_role`),`${table} clears inherited column grants`);
  ok(sql.includes('pg_catalog.has_any_column_privilege')&&sql.includes('pg_catalog.has_table_privilege'),`${table} verifies effective denials`);
  ok(sql.includes("pg_catalog.pg_has_role('anon',v_function.proowner,'MEMBER')")&&sql.includes("pg_catalog.pg_has_role('authenticated',v_function.proowner,'MEMBER')"),`${table} RPC owner cannot be inherited by browser roles`);
  ok(sql.includes('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role'),`${table} function and overload execution revoked before allowlist grants`);
 }
 const outbox=sources[15];
 for(const [name,signature] of [['integration_enqueue','text,text,jsonb,text,integer'],['integration_claim','integer'],['integration_finish','uuid,uuid,text,text,text,integer'],['integration_retention','integer,integer']]){
  ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^]*?SECURITY DEFINER SET search_path=''`).test(outbox),`${name} uses explicit privileged boundary`);
  ok(outbox.includes(`'public.${name}(${signature})'`),`${name} exact overload is reviewed`);
 }
 ok(outbox.includes("v_function.proname NOT IN('booking_guard','booking_schedule_lock')"),'Trigger helper execution stays private');
 ok(outbox.includes("idempotency_key TEXT NOT NULL UNIQUE"),'Queue key is persistent and unique');
 ok(outbox.includes('attempts BETWEEN 0 AND 5')&&outbox.includes('FOR UPDATE SKIP LOCKED'),'Queue retry and concurrent claiming are bounded');
 const operations=sources[17];
 for(const name of ['chat_claim_turn','chat_save_turn','chat_operations_retention'])ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^]*?SECURITY DEFINER SET search_path=''`).test(operations),`${name} is a controlled definer RPC`);
 ok(operations.includes('GRANT EXECUTE ON FUNCTION public.chat_claim_turn(TEXT,BIGINT,INTEGER,UUID,TEXT),public.chat_save_turn(TEXT,BIGINT,INTEGER,UUID,TEXT,TEXT,TEXT,JSONB,JSONB),public.chat_operations_retention(INTEGER) TO service_role;'),'Only reviewed new overloads are service-executable');
 ok(operations.includes('REVOKE ALL ON FUNCTION public.chat_save_turn(TEXT,BIGINT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;'),'Legacy write overload is disabled');
 ok(operations.includes('REFERENCES public.messages(id) ON DELETE CASCADE'),'Operation references do not retain deleted message content');
 const ai=sources[16];
 ok(ai.includes('REVOKE ALL ON public.dashboard_ai_operations FROM PUBLIC,anon,authenticated;'),'Admin AI receipts deny browser roles');
 ok(ai.includes('GRANT SELECT,INSERT,UPDATE,DELETE ON public.dashboard_ai_operations TO service_role;'),'Admin AI receipt CRUD remains server-only');
 for(const signature of ['dashboard_ai_result(uuid)','dashboard_claim_ai(uuid,text)','dashboard_commit_ai(uuid,text,uuid,jsonb)']){
  const name=signature.split('(')[0];
  ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^]*?SECURITY INVOKER SET search_path=pg_catalog,public`).test(ai),`${name} never bypasses server table ACL`);
  ok(new RegExp(`REVOKE ALL ON FUNCTION[^;]*public\\.${signature.replace(/[()]/g,'\\$&')}[^;]*FROM PUBLIC,anon,authenticated;`).test(ai),`${name} denies public execution`);
  ok(new RegExp(`GRANT EXECUTE ON FUNCTION[^;]*public\\.${signature.replace(/[()]/g,'\\$&')}[^;]*TO service_role;`).test(ai),`${name} is explicitly service executable`);
 }
 ok(ai.includes('jsonb_agg(value->>\'id\')')&&ai.includes('JOIN public.project_tasks t ON t.id=ids.id::uuid'),'Admin AI receipts persist references and replay only current rows');
 const retention=await read('supabase/migration-v18.sql');
 ok(retention.includes('public.dashboard_ai_operations')&&retention.includes('public.chat_operations_retention(p_batch_size)')&&retention.includes("INTERVAL '30 days'"),'Admin receipt expiry and chat expiry RPC are included in reviewed maintenance');
});

await group('A09 separately scopes its private state table, service-only RPCs and non-destructive migration', async () => {
  const text = await read('supabase/migration-v13.sql');
  const sql = text.replace(/--[^\n]*/g, '');
  equal([...sql.matchAll(/CREATE TABLE IF NOT EXISTS (?:public\.)?(\w+)/gi)].map(match => match[1]), ['chat_context_states']);
  ok(sql.includes('ALTER TABLE public.chat_context_states ENABLE ROW LEVEL SECURITY;'));
  ok(sql.includes('REVOKE ALL ON public.chat_context_states FROM PUBLIC, anon, authenticated, service_role;'));
  ok(!/GRANT[^;]*ON (?:TABLE )?public\.chat_context_states/.test(sql));
  for (const signature of ['chat_context_state(TEXT,BIGINT)', 'chat_erase_context(TEXT,BIGINT,INTEGER,TEXT)',
    'chat_save_turn(TEXT,BIGINT,INTEGER,TEXT,TEXT,JSONB)', 'chat_insert_booking(TEXT,BIGINT,INTEGER,JSONB)',
    'chat_retention_batch(INTEGER,INTEGER,INTEGER,INTEGER)']) {
    ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role;`));
    ok(sql.includes(`public.${signature}`));
  }
  equal([...sql.matchAll(/SECURITY DEFINER SET search_path = ''/g)].length, 5);
  ok(/GRANT EXECUTE ON FUNCTION[^;]*TO service_role;/.test(sql));
  ok(!/ALL (?:TABLES|FUNCTIONS|SEQUENCES) IN SCHEMA|ALTER DEFAULT PRIVILEGES|TRUNCATE TABLE|DROP TABLE/i.test(sql));
  const migrationOperations = sql.replace(/\$\$[^]*?\$\$/g, "''");
  ok(!/DELETE FROM|INSERT INTO|UPDATE public\./.test(migrationOperations), 'Applying v13 performs no historical cleanup');
  ok(sql.includes('privacy_retention_until TIMESTAMPTZ;'));
  ok(sql.includes('last_erased_version'));
  ok(/chat_erase_context[^]*?pg_advisory_xact_lock\(724612083942::BIGINT\)[^]*?chat_concurrency_leases WHERE session_key = p_session_key AND expires_at > v_now/.test(sql));
  ok(/DELETE FROM public\.bookings WHERE status IN \('completed','cancelled'\) AND privacy_retention_until <= v_now/.test(sql));
  ok(/FOR UPDATE\) locked_profiles/.test(sql));
});

await group('Static helper and RPC restrictions retain current server authorization model', async () => {
  const sql = (await read('supabase/migration-v11.sql')).replace(/--[^\n]*/g, '');
  for (const name of ['increment_message_count', 'update_updated_at']) {
    ok(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([^]*?SECURITY INVOKER SET search_path = ''`).test(sql));
    ok(!new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}`).test(sql));
  }
  for (const signature of ['dashboard_consume_login_attempt(TEXT)', 'chat_admit(TEXT, TEXT, UUID, JSONB, BIGINT)', 'chat_release(UUID)']) {
    ok(sql.includes(`REVOKE ALL ON FUNCTION public.${signature} FROM PUBLIC, anon, authenticated, service_role;`));
    ok(sql.includes(`GRANT EXECUTE ON FUNCTION public.${signature} TO service_role;`));
    ok(sql.includes(`ALTER FUNCTION public.${signature} SECURITY DEFINER SET search_path = '';`));
  }
  const src = await filesIn('src');
  for (const file of src.filter(file => /\.(?:ts|tsx|astro)$/.test(file))) {
    const text = await read(file);
    ok(!/rpc\/increment_message_count|rpc\/update_updated_at/.test(text), 'Legacy helpers have no application callers');
    if (file.startsWith('src/components/') || file.startsWith('src/hooks/') || file === 'src/lib/chat-client.ts') {
      ok(!/SUPABASE_SERVICE_ROLE_KEY|serviceKey|from ['"][^'"]*(?:supabase|dashboard-auth|chat-security|chat-effects|email|notify)['"]/.test(text), `No privileged dependency in ${file}`);
    }
  }
  for (const file of ['src/lib/supabase.ts', 'src/lib/dashboard-auth.ts', 'src/lib/chat-security.ts']) {
    const text = await read(file);
    ok(text.includes('SUPABASE_SERVICE_ROLE_KEY'));
    ok(!text.includes('PUBLIC_SUPABASE'));
  }
});

const requests = [];
const publicRows = {
  projects: [{ id: '00000000-0000-4000-8000-000000000001', title: 'Synthetic public project', slug: 'synthetic', status: 'completed', is_published: true, public_description: '' }],
  project_tasks: [{ id: '00000000-0000-4000-8000-000000000002', project_id: '00000000-0000-4000-8000-000000000001', status: 'completed' }],
  services: [{ id: '00000000-0000-4000-8000-000000000003', title: 'Synthetic service',slug:'synthetic-service',description:'Reviewed synthetic public content',is_published:true,icon:'movie' }],
  studio_stats: [{ key: 'pieces_delivered', value: 2, label: 'Synthetic public statistic' }],
  feed_entries: [{ id: '00000000-0000-4000-8000-000000000004', text: 'PRIVATE_ACTIVITY_CANARY', level: 'mid', project_id: null,is_published:true,public_title:'Reviewed activity',public_title_en:'Reviewed activity',public_text:'Reviewed editorial feed',public_text_en:'Reviewed editorial feed',public_event_type:'studio',public_occurred_at:'2026-01-01T00:00:00Z' }],
  studio_logs: [{ id: '00000000-0000-4000-8000-000000000005', text: 'Synthetic public log', log_type: 'info', created_at: '2026-10-02T12:00:00Z' }],
};
const server = createHttpServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const table = url.pathname.replace('/rest/v1/', '');
  requests.push({ table, method: req.method, headers: req.headers, query: url.searchParams });
  res.setHeader('content-type', 'application/json');
  if (req.method !== 'GET' || !publicRows[table] || req.headers.apikey !== key || req.headers.authorization !== `Bearer ${key}`) {
    res.statusCode = 403; res.end('[]'); return;
  }
  res.end(JSON.stringify(publicRows[table]));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const guard = installFetchGuard([origin]);
let vite;
try {
  const env = { SUPABASE_URL: origin, SUPABASE_SERVICE_ROLE_KEY: key,
    OPENROUTER_API_KEY: '', RESEND_API_KEY: '', TELEGRAM_BOT_TOKEN: '', PROD: false, DEV: true, SSR: true, MODE: 'test', BASE_URL: '/' };
  vite = await createServer({ root, configFile: false, envFile: false, logLevel: 'silent', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null }, optimizeDeps: { noDiscovery: true },
    define: Object.fromEntries(Object.entries(env).map(([name, value]) => [`import.meta.env.${name}`, JSON.stringify(value)])),
  });
  await group('Public content remains readable through server APIs with the service role (synthetic HTTP)', async () => {
    for (const [route, expected] of [['projects', 'Synthetic public project'], ['services', 'Synthetic service'],
      ['stats', 'Proyectos publicados'], ['feed', 'Reviewed editorial feed'], ['logs', '[]']]) {
      const api = await vite.ssrLoadModule(`/src/pages/api/${route}.ts`);
      const response = await api.GET({ request: new Request('http://localhost/api/' + route) });
      equal(response.status, 200);
      const body = await response.text();
      ok(body.includes(expected), route);
      ok(!body.includes(key) && !body.includes('SUPABASE_SERVICE_ROLE_KEY'), 'Privileged key never returned');
      ok(!body.includes('PRIVATE_ACTIVITY_CANARY'),'Internal activity text is not public editorial content');
    }
    equal(requests.length, 5);
    for (const request of requests) {
      equal(request.method, 'GET');
      ok(scope[request.table]?.includes('SELECT'));
      equal(request.headers.apikey, key);
      equal(request.headers.authorization, `Bearer ${key}`);
    }
    ok(!requests.some(row => ['studio_stats', 'project_tasks'].includes(row.table)));
    for(const request of requests.filter(row=>['feed_entries','studio_logs'].includes(row.table))){
      equal(request.query.get('is_published'),'eq.true');
      ok(!request.query.get('select').split(',').some(field=>['text','level','source','is_active','log_type'].includes(field)));
    }
    equal(requests.find(row => row.table === 'projects').query.get('is_published'), 'eq.true');
    equal(guard.blocked.length, 0, 'No external network attempted');
  });
} finally {
  await vite?.close();
  guard.restore();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
console.log(`PASS: ${groups} groups, ${assertions} assertions (source/synthetic HTTP only; SQL not executed)`);
