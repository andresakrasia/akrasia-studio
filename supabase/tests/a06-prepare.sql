-- A06 fixture, ONLY in the disposable DB AND CLUSTER from a05-bootstrap.sql.
-- Never run against Supabase, a shared cluster or real data. Requires superuser.
-- Order: bootstrap, v1-v11, this file, v12, a06-verify.sql (which reapplies v12).
-- Guarded fictional rows are committed only in this disposable database.
-- No .env, HTTP, AI, email, Telegram, Storage downloads or real booking calls.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() !~ '^akrasia_a05_[a-zA-Z0-9_]+$'
     OR current_setting('akrasia.a05_disposable', true) IS DISTINCT FROM 'true'
     OR NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'A06 fixture requires the A05 disposable bootstrap and its superuser';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
             WHERE attrelid = 'public.projects'::regclass
               AND attname IN ('is_published', 'public_description') AND NOT attisdropped)
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'akrasia_a06_fixture') THEN
    RAISE EXCEPTION 'A06 first-addition test requires a fresh v1-v11 disposable database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
                WHERE polrelid = 'public.projects'::regclass AND polname = 'a05_server_only') THEN
    RAISE EXCEPTION 'Apply A05/v11 before preparing A06';
  END IF;
END;
$guard$;

CREATE SCHEMA akrasia_a06_fixture;
-- This private fixture schema has no API-role USAGE or exposed functions.
REVOKE ALL ON SCHEMA akrasia_a06_fixture FROM PUBLIC, anon, authenticated, service_role;
INSERT INTO public.projects (id, title, slug, status, client_name, description)
SELECT ('a0600000-0000-4000-8000-00000000000' || n)::uuid,
       'A06 fictional project ' || n, 'a06-fictional-' || n, status,
       'A06_PRIVATE_CLIENT_' || n, 'A06_PRIVATE_DESCRIPTION_' || n
FROM (VALUES (1,'planning'), (2,'in_production'), (3,'post_production'),
             (4,'completed'), (5,'delivered')) AS fixture(n,status);

CREATE TABLE akrasia_a06_fixture.before_rows AS
SELECT p.id, to_jsonb(p) AS row_data FROM public.projects p;
CREATE TABLE akrasia_a06_fixture.before_security AS
SELECT jsonb_build_object(
  'acl', c.relacl::text, 'rls', c.relrowsecurity, 'force_rls', c.relforcerowsecurity,
  'owner', c.relowner,
  'columns', (SELECT jsonb_agg(jsonb_build_array(a.attname,a.attacl::text) ORDER BY a.attnum)
              FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped),
  'policies', (SELECT jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,
               'permissive',p.polpermissive,'roles',p.polroles,
               'using',pg_catalog.pg_get_expr(p.polqual,p.polrelid),
               'check',pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid)) ORDER BY p.polname)
              FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid)
) AS snapshot FROM pg_catalog.pg_class c WHERE c.oid='public.projects'::regclass;
COMMIT;
\echo 'A06 fictional preexisting rows/snapshot prepared. Apply migration-v12.sql then a06-verify.sql.'
