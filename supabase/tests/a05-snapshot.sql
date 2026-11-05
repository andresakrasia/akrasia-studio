-- Read-only deterministic snapshots BEFORE and AFTER the second v11 run.
-- ONLY the disposable database/cluster from a05-bootstrap.sql, before verify.
-- psql -X -qAt -v ON_ERROR_STOP=1 -f supabase/tests/a05-snapshot.sql
-- Compare both outputs byte-for-byte. No pg_dump random restrict tokens or
-- policy OIDs (recreated by v11) are included. Rows are hashed, not printed.
-- Concurrent writes invalidate comparison; do not use a shared/live database.
\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';
DO $guard$
BEGIN
  IF current_database() !~ '^akrasia_a05_[a-zA-Z0-9_]+$'
     OR current_setting('akrasia.a05_disposable', true) IS DISTINCT FROM 'true'
     OR NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Snapshots require the disposable bootstrap and its superuser';
  END IF;
END;
$guard$;

SELECT format(
  'SELECT jsonb_build_object(''kind'',''rows'',''table'',%L,''count'',count(*),''digest'',md5(COALESCE(string_agg(to_jsonb(t)::text, E''\n'' ORDER BY to_jsonb(t)::text COLLATE "C"),''''))) FROM %I.%I t;',
  n.nspname || '.' || c.relname, n.nspname, c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','storage') AND c.relkind = 'r'
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C"
\gexec

SELECT jsonb_build_object('kind','relation','schema',n.nspname,'name',c.relname,
  'type',c.relkind,'owner',pg_get_userbyid(c.relowner),'rls',c.relrowsecurity,
  'force_rls',c.relforcerowsecurity,'options',c.reloptions,'acl',c.relacl::text)
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','storage') AND c.relkind IN ('r','p','v','m','S','f')
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C";

SELECT jsonb_build_object('kind','column','schema',n.nspname,'table',c.relname,
  'column',a.attname,'acl',a.attacl::text)
FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','storage') AND c.relkind IN ('r','p','v','m','f')
  AND a.attnum > 0 AND NOT a.attisdropped
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C", a.attnum;

SELECT jsonb_build_object('kind','policy','schema',n.nspname,'table',c.relname,
  'name',p.polname,'command',p.polcmd,'roles',p.polroles,'permissive',p.polpermissive,
  'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))
FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('public','storage')
ORDER BY n.nspname COLLATE "C", c.relname COLLATE "C", p.polname COLLATE "C";

SELECT jsonb_build_object('kind','function','schema',n.nspname,'name',p.proname,
  'args',pg_get_function_identity_arguments(p.oid),'owner',pg_get_userbyid(p.proowner),
  'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,
  'body_digest',md5(pg_get_functiondef(p.oid)))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public','auth') AND p.prokind IN ('f','p')
ORDER BY n.nspname COLLATE "C", p.proname COLLATE "C", pg_get_function_identity_arguments(p.oid) COLLATE "C";

SELECT format('SELECT jsonb_build_object(''kind'',''sequence_state'',''name'',%L,''last_value'',last_value,''is_called'',is_called) FROM %I.%I;',
  n.nspname || '.' || c.relname,n.nspname,c.relname)
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relkind='S'
ORDER BY n.nspname COLLATE "C",c.relname COLLATE "C"
\gexec
COMMIT;
