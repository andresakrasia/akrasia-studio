-- A06 PostgreSQL tests: execute only after a06-prepare.sql and first v12.
-- ONLY disposable DB AND CLUSTER from a05-bootstrap.sql; never Supabase/data real.
-- Includes a second v12 via psql \ir, so do not wrap this file in a transaction.
-- Initial approvals/snapshots are committed in the disposable fixture; final
-- permission/default/mutation probes roll back. No external services are used.
-- This verifies SQL/defaults/ACL/reapplication, NOT API authorization or CSRF,
-- browser caching, PostgREST, deployed Supabase or parallel DB connections.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() !~ '^akrasia_a05_[a-zA-Z0-9_]+$'
     OR current_setting('akrasia.a05_disposable', true) IS DISTINCT FROM 'true'
     OR NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user)
     OR pg_catalog.to_regclass('akrasia_a06_fixture.before_rows') IS NULL THEN
    RAISE EXCEPTION 'A06 tests require the disposable bootstrap, preparation and its superuser';
  END IF;
END;
$guard$;

DO $initial$
DECLARE current_security jsonb;
BEGIN
  IF EXISTS(SELECT 1 FROM public.projects WHERE is_published IS DISTINCT FROM false OR public_description IS DISTINCT FROM '') THEN
    RAISE EXCEPTION 'First v12 must leave EVERY preexisting project unpublished and editorial text empty';
  END IF;
  IF EXISTS (
    (SELECT id, to_jsonb(p) - 'is_published' - 'public_description' FROM public.projects p
      EXCEPT SELECT id, row_data FROM akrasia_a06_fixture.before_rows)
    UNION ALL
    (SELECT id, row_data FROM akrasia_a06_fixture.before_rows
      EXCEPT SELECT id, to_jsonb(p) - 'is_published' - 'public_description' FROM public.projects p)
  ) THEN RAISE EXCEPTION 'First v12 changed preexisting internal rows'; END IF;
  SELECT jsonb_build_object(
    'acl', c.relacl::text, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
    'owner', c.relowner,
    'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname,a.attacl::text) ORDER BY a.attnum)
                FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
                  AND a.attname NOT IN ('is_published','public_description')),
    'policies', (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,
                 'permissive',p.polpermissive,'roles',p.polroles,
                 'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),
                 'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
                FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid)
  ) INTO current_security FROM pg_catalog.pg_class c WHERE c.oid='public.projects'::regclass;
  IF current_security IS DISTINCT FROM (SELECT snapshot FROM akrasia_a06_fixture.before_security) THEN
    RAISE EXCEPTION 'First v12 changed A05 ownership/RLS/ACL/policies';
  END IF;
  RAISE NOTICE 'A06 SQL: first-addition defaults, internal row preservation and unchanged A05 controls OK';
END;
$initial$;

-- Legitimate server access keeps internal fields; approval is independent of
-- production status. A completed project can remain private or be withdrawn.
SET LOCAL ROLE service_role;
DO $internal_access$
BEGIN
  IF (SELECT description FROM public.projects WHERE slug='a06-fictional-1') IS DISTINCT FROM 'A06_PRIVATE_DESCRIPTION_1'
     OR (SELECT client_name FROM public.projects WHERE slug='a06-fictional-1') IS DISTINCT FROM 'A06_PRIVATE_CLIENT_1' THEN
    RAISE EXCEPTION 'Legitimate server internal access was lost';
  END IF;
END;
$internal_access$;
INSERT INTO public.projects(id,title,slug,status,description)
VALUES ('a0600000-0000-4000-8000-000000000006','A06 new fictional project','a06-fictional-6','delivered','A06_PRIVATE_DESCRIPTION_6');
UPDATE public.projects SET is_published=true, public_description='A06 approved editorial planning'
WHERE slug='a06-fictional-1';
UPDATE public.projects SET is_published=true, public_description='A06 approved editorial post'
WHERE slug='a06-fictional-3';
UPDATE public.projects SET is_published=true, public_description='A06 withdrawn editorial'
WHERE slug='a06-fictional-4';
UPDATE public.projects SET is_published=false WHERE slug='a06-fictional-4';
RESET ROLE;

DO $decisions$
BEGIN
  IF (SELECT is_published FROM public.projects WHERE slug='a06-fictional-6') IS DISTINCT FROM false
     OR (SELECT public_description FROM public.projects WHERE slug='a06-fictional-6') IS DISTINCT FROM ''
     OR (SELECT is_published FROM public.projects WHERE slug='a06-fictional-1') IS DISTINCT FROM true
     OR (SELECT status FROM public.projects WHERE slug='a06-fictional-1') IS DISTINCT FROM 'planning'
     OR (SELECT is_published FROM public.projects WHERE slug='a06-fictional-4') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Default creation or explicit independent approval/withdrawal failed';
  END IF;
END;
$decisions$;

-- Snapshot deterministic row/catalog attributes in the same psql session.
-- Helper is invoker-only in pg_temp, never an application RPC.
CREATE FUNCTION pg_temp.a06_catalog_snapshot() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $snapshot$
SELECT jsonb_build_object(
  'relations', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',c.relname,
    'kind',c.relkind,'owner',c.relowner,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
    'options',c.reloptions,'acl',c.relacl::text) ORDER BY n.nspname,c.relname)
    FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','storage') AND c.relkind IN ('r','p','v','m','S','f')),
  'columns', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',a.attname,
    'type',a.atttypid,'notnull',a.attnotnull,'identity',a.attidentity,'generated',a.attgenerated,
    'acl',a.attacl::text,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) ORDER BY n.nspname,c.relname,a.attnum)
    FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class c ON c.oid=a.attrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
    WHERE n.nspname IN ('public','storage') AND a.attnum>0 AND NOT a.attisdropped
      AND c.relkind IN ('r','p','v','m','f')),
  'policies', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',p.polname,
    'command',p.polcmd,'roles',p.polroles,'permissive',p.polpermissive,
    'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))
    ORDER BY n.nspname,c.relname,p.polname)
    FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','storage')),
  'functions', (SELECT jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
    'arguments',pg_catalog.pg_get_function_identity_arguments(p.oid),'owner',p.proowner,
    'definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,
    'body_hash',pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)))
    ORDER BY n.nspname,p.proname,pg_catalog.pg_get_function_identity_arguments(p.oid))
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname IN ('public','auth') AND p.prokind IN ('f','p'))
)
$snapshot$;
CREATE TABLE akrasia_a06_fixture.expected_rows AS SELECT id,to_jsonb(p) AS row_data FROM public.projects p;
CREATE TABLE akrasia_a06_fixture.expected_catalog AS SELECT pg_temp.a06_catalog_snapshot() AS snapshot;
COMMIT;

-- Actual migration file, actual second application when run with PostgreSQL.
\ir ../migration-v12.sql

BEGIN;
DO $reapplication$
BEGIN
  IF EXISTS (
    (SELECT id,to_jsonb(p) FROM public.projects p EXCEPT SELECT id,row_data FROM akrasia_a06_fixture.expected_rows)
    UNION ALL
    (SELECT id,row_data FROM akrasia_a06_fixture.expected_rows EXCEPT SELECT id,to_jsonb(p) FROM public.projects p)
  ) OR pg_temp.a06_catalog_snapshot() IS DISTINCT FROM (SELECT snapshot FROM akrasia_a06_fixture.expected_catalog) THEN
    RAISE EXCEPTION 'Second v12 changed saved decisions/editorial text/internal rows or catalog';
  END IF;
  IF (SELECT count(*) FROM public.projects WHERE is_published IS TRUE) <> 2
     OR EXISTS(SELECT 1 FROM public.projects WHERE is_published IS TRUE AND id='a0600000-0000-4000-8000-000000000004')
     OR EXISTS(SELECT 1 FROM public.projects WHERE is_published IS TRUE AND slug='a06-fictional-4') THEN
    RAISE EXCEPTION 'Publication filter cannot recover a withdrawn project by known ID/slug';
  END IF;
  RAISE NOTICE 'A06 SQL: actual second v12 preserves all project rows and A05/catalog attributes OK';
END;
$reapplication$;

CREATE FUNCTION pg_temp.a06_expect_error(role_name text,command text,expected_state text) RETURNS void
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $helper$
DECLARE observed_state text;
BEGIN
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',role_name);
  BEGIN EXECUTE command;
  EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS observed_state=RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF observed_state IS DISTINCT FROM expected_state THEN
    RAISE EXCEPTION 'Expected SQLSTATE %, observed % for role %',expected_state,observed_state,role_name;
  END IF;
END;
$helper$;
DO $denied$
DECLARE role_name text;
BEGIN
  FOR role_name IN SELECT unnest(ARRAY['anon','authenticated']) LOOP
    PERFORM pg_temp.a06_expect_error(role_name,'SELECT id,title,public_description FROM public.projects WHERE is_published IS TRUE','42501');
    PERFORM pg_temp.a06_expect_error(role_name,'UPDATE public.projects SET is_published=true WHERE slug=''a06-fictional-4''','42501');
    PERFORM pg_temp.a06_expect_error(role_name,'UPDATE public.projects SET public_description=''A06 unauthorized editorial'' WHERE slug=''a06-fictional-1''','42501');
    PERFORM pg_temp.a06_expect_error(role_name,'INSERT INTO public.projects(title,slug,is_published) VALUES (''A06 forbidden'',''a06-forbidden'',true)','42501');
  END LOOP;
  PERFORM pg_temp.a06_expect_error('service_role','INSERT INTO public.projects(title,slug,is_published) VALUES (''A06 null'',''a06-null-published'',null)','23502');
  PERFORM pg_temp.a06_expect_error('service_role','INSERT INTO public.projects(title,slug,public_description) VALUES (''A06 null'',''a06-null-editorial'',null)','23502');
  RAISE NOTICE 'A06 SQL: anonymous/authenticated reads/mutations denied; both NOT NULL constraints enforced OK';
END;
$denied$;

SET LOCAL ROLE service_role;
INSERT INTO public.projects(id,title,slug,status)
VALUES ('a0600000-0000-4000-8000-000000000007','A06 default fictional project','a06-fictional-7','completed');
UPDATE public.projects SET status='delivered' WHERE slug='a06-fictional-7';
DO $default_status$
BEGIN
  IF (SELECT is_published FROM public.projects WHERE slug='a06-fictional-7') IS DISTINCT FROM false
     OR (SELECT public_description FROM public.projects WHERE slug='a06-fictional-7') IS DISTINCT FROM '' THEN
    RAISE EXCEPTION 'New project or production status change bypassed unpublished default';
  END IF;
END;
$default_status$;
UPDATE public.projects SET is_published=true,public_description='A06 explicit editorial' WHERE slug='a06-fictional-7';
DO $published$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE slug='a06-fictional-7' AND is_published IS TRUE AND public_description='A06 explicit editorial') THEN
    RAISE EXCEPTION 'Explicit server publication failed';
  END IF;
END;
$published$;
UPDATE public.projects SET is_published=false WHERE slug='a06-fictional-7';
DO $withdrawn$
BEGIN
  IF EXISTS(SELECT 1 FROM public.projects WHERE slug='a06-fictional-7' AND is_published IS TRUE)
     OR (SELECT public_description FROM public.projects WHERE slug='a06-fictional-7') IS DISTINCT FROM 'A06 explicit editorial' THEN
    RAISE EXCEPTION 'Explicit server withdrawal failed or destroyed saved editorial text';
  END IF;
END;
$withdrawn$;
RESET ROLE;
DO $done$ BEGIN RAISE NOTICE 'A06 SQL: new defaults, status-independent explicit publication/withdrawal and internal server access OK'; END $done$;
ROLLBACK;
\echo 'A06 SQL completed in disposable database: actual first/second migration and SQL probes passed. Final probes rolled back. No deployed Supabase/API/browser guarantee.'
