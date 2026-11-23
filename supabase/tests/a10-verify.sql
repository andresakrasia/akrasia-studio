-- A10 PostgreSQL checks ONLY in a05-bootstrap's disposable DB AND CLUSTER.
-- Supplied for later execution; not evidence of SQL/Storage verification here.
-- Requires a10-prepare and first v14. Reapplies v14 in this same psql session.
-- Never run against Supabase/data real. No external Storage/network is used.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() !~ '^akrasia_a05_[a-zA-Z0-9_]+$'
     OR current_setting('akrasia.a05_disposable',true) IS DISTINCT FROM 'true'
     OR NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user)
     OR pg_catalog.to_regclass('akrasia_a10_fixture.before_objects') IS NULL THEN
    RAISE EXCEPTION 'A10 checks require prepared disposable bootstrap and its superuser';
  END IF;
END;
$guard$;

DO $preservation$
BEGIN
  IF EXISTS ((SELECT * FROM storage.objects EXCEPT SELECT * FROM akrasia_a10_fixture.before_objects)
    UNION ALL (SELECT * FROM akrasia_a10_fixture.before_objects EXCEPT SELECT * FROM storage.objects)) THEN
    RAISE EXCEPTION 'First v14 must preserve every existing object metadata row';
  END IF;
  IF EXISTS ((SELECT id,to_jsonb(p) FROM public.projects p EXCEPT SELECT * FROM akrasia_a10_fixture.before_projects)
    UNION ALL (SELECT * FROM akrasia_a10_fixture.before_projects EXCEPT SELECT id,to_jsonb(p) FROM public.projects p)) THEN
    RAISE EXCEPTION 'First v14 changed project references or publication decisions';
  END IF;
  IF EXISTS ((SELECT * FROM storage.buckets WHERE id='a10-unrelated-public' EXCEPT SELECT * FROM akrasia_a10_fixture.before_unrelated_bucket)
    UNION ALL (SELECT * FROM akrasia_a10_fixture.before_unrelated_bucket EXCEPT SELECT * FROM storage.buckets WHERE id='a10-unrelated-public')) THEN
    RAISE EXCEPTION 'First v14 changed unrelated bucket configuration';
  END IF;
  IF EXISTS (SELECT 1 FROM akrasia_a10_fixture.before_acl old JOIN pg_catalog.pg_class c ON c.oid=old.oid
    WHERE old.relacl IS DISTINCT FROM c.relacl::TEXT OR old.relowner<>c.relowner OR old.relrowsecurity<>c.relrowsecurity) THEN
    RAISE EXCEPTION 'First v14 changed shared-table ACL/owner/RLS';
  END IF;
  IF EXISTS (SELECT 1 FROM akrasia_a10_fixture.before_policies old LEFT JOIN pg_catalog.pg_policy p
    ON p.polrelid=old.polrelid AND p.polname=old.polname
    WHERE p.polname IS NULL OR (old.polcmd,old.polpermissive,old.polroles,old.qual,old.check_expression)
      IS DISTINCT FROM (p.polcmd,p.polpermissive,p.polroles,pg_catalog.pg_get_expr(p.polqual,p.polrelid),pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid))) THEN
    RAISE EXCEPTION 'First v14 changed unrelated/preexisting Storage policies';
  END IF;
  IF (SELECT count(*) FROM storage.buckets WHERE id IN ('project-thumbnails','project-media-private') AND NOT public AND file_size_limit=2097152) <> 2
    OR (SELECT allowed_mime_types FROM storage.buckets WHERE id='project-media-private') IS DISTINCT FROM ARRAY['image/webp']::TEXT[] THEN
    RAISE EXCEPTION 'Private bucket limits did not match the application contract';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polname IN ('a10_private_project_objects','a10_private_project_buckets')
      AND NOT polpermissive AND polcmd='*' AND polroles=ARRAY[0::OID]) <> 2 THEN
    RAISE EXCEPTION 'Restrictive ALL/PUBLIC policies missing';
  END IF;
END;
$preservation$;

-- Compare deterministic rows/catalog after actual second file application.
CREATE FUNCTION pg_temp.a10_snapshot() RETURNS JSONB LANGUAGE sql SECURITY INVOKER SET search_path='' AS $snapshot$
SELECT pg_catalog.jsonb_build_object(
 'objects',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(o) ORDER BY id) FROM storage.objects o),
 'buckets',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(b) ORDER BY id) FROM storage.buckets b),
 'projects',(SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(p) ORDER BY id) FROM public.projects p),
 'acl',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(oid,relacl::TEXT,relowner,relrowsecurity) ORDER BY oid)
   FROM pg_catalog.pg_class WHERE oid IN ('storage.objects'::regclass,'storage.buckets'::regclass)),
 'policies',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(polrelid,polname,polcmd,polpermissive,polroles,
   pg_catalog.pg_get_expr(polqual,polrelid),pg_catalog.pg_get_expr(polwithcheck,polrelid)) ORDER BY polrelid,polname)
   FROM pg_catalog.pg_policy WHERE polrelid IN ('storage.objects'::regclass,'storage.buckets'::regclass)),
 'functions',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_array(p.oid,p.proowner,p.prosecdef,p.proacl::TEXT,p.proconfig) ORDER BY p.oid)
   FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'));
$snapshot$;
CREATE TEMP TABLE a10_expected_snapshot AS SELECT pg_temp.a10_snapshot() AS value;
COMMIT;
\ir ../migration-v14.sql
BEGIN;
DO $reapplication$
BEGIN
  IF pg_temp.a10_snapshot() IS DISTINCT FROM (SELECT value FROM a10_expected_snapshot) THEN
    RAISE EXCEPTION 'Second v14 changed rows, policies, ACLs or functions';
  END IF;
END;
$reapplication$;

-- Probe server policies without relying on the role's usual BYPASSRLS.
ALTER ROLE service_role NOBYPASSRLS;
SET LOCAL ROLE service_role;
INSERT INTO storage.objects(bucket_id,name) VALUES('project-media-private','thumbs/a1000000-0000-4000-8000-000000000001.webp');
DO $server$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='project-thumbnails' AND name='thumb-1700000000000-fictional.png')
    OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='project-media-private' AND name='thumbs/a1000000-0000-4000-8000-000000000001.webp') THEN
    RAISE EXCEPTION 'Server private legacy/new reads or upload failed without BYPASSRLS';
  END IF;
END;
$server$;
DELETE FROM storage.objects WHERE bucket_id='project-media-private' AND name='thumbs/a1000000-0000-4000-8000-000000000001.webp';
RESET ROLE;

CREATE FUNCTION pg_temp.a10_api_probe(client_role TEXT) RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $probe$
DECLARE affected INTEGER;
BEGIN
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I',client_role);
  IF EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id IN ('project-thumbnails','project-media-private'))
    OR EXISTS (SELECT 1 FROM storage.buckets WHERE id IN ('project-thumbnails','project-media-private')) THEN
    RAISE EXCEPTION 'API role sees private Storage rows despite broad permissive policy';
  END IF;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES('project-media-private','thumbs/a1000000-0000-4000-8000-000000000002.webp');
    RAISE EXCEPTION 'API upload unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    INSERT INTO storage.objects(bucket_id,name) VALUES('project-thumbnails','thumb-denied.png');
    RAISE EXCEPTION 'API legacy upload unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  UPDATE storage.objects SET name='tampered.png' WHERE bucket_id='project-thumbnails';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'API replacement unexpectedly succeeded'; END IF;
  DELETE FROM storage.objects WHERE bucket_id='project-thumbnails';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'API deletion unexpectedly succeeded'; END IF;
  UPDATE storage.buckets SET public=true WHERE id='project-thumbnails';
  GET DIAGNOSTICS affected=ROW_COUNT;
  IF affected<>0 THEN RAISE EXCEPTION 'API bucket exposure unexpectedly succeeded'; END IF;
  -- Existing unrelated access must be retained; changing its bucket_id to a
  -- managed bucket must fail WITH CHECK even when USING accepted the old row.
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='a10-unrelated-public' AND name='unrelated.txt') THEN
    RAISE EXCEPTION 'Legitimate unrelated read changed';
  END IF;
  BEGIN
    UPDATE storage.objects SET bucket_id='project-thumbnails' WHERE bucket_id='a10-unrelated-public' AND name='unrelated.txt';
    RAISE EXCEPTION 'Cross-bucket move unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  INSERT INTO storage.objects(bucket_id,name) VALUES('a10-unrelated-public','unrelated-probe-'||client_role);
  DELETE FROM storage.objects WHERE bucket_id='a10-unrelated-public' AND name='unrelated-probe-'||client_role;
  EXECUTE 'RESET ROLE';
EXCEPTION WHEN OTHERS THEN EXECUTE 'RESET ROLE'; RAISE;
END;
$probe$;
SELECT pg_temp.a10_api_probe('anon');
SELECT pg_temp.a10_api_probe('authenticated');
DO $effects$
BEGIN
  IF EXISTS((SELECT * FROM storage.objects EXCEPT SELECT * FROM akrasia_a10_fixture.before_objects)
    UNION ALL(SELECT * FROM akrasia_a10_fixture.before_objects EXCEPT SELECT * FROM storage.objects)) THEN
    RAISE EXCEPTION 'Rejected requests or cleanup left object metadata effects';
  END IF;
  RAISE NOTICE 'A10 SQL: private buckets, broad-policy denial, server operations, preservation and second application OK (metadata stub only)';
END;
$effects$;
ROLLBACK;
