-- A10 fictitious PostgreSQL fixture, NOT a production migration.
-- ONLY the empty disposable DB AND CLUSTER created by a05-bootstrap.sql.
-- Order: bootstrap, v1-v11, A05 checks, v12, v13, this file, v14, a10-verify.
-- SQL metadata stub only: no Storage service, images, network or real objects.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() !~ '^akrasia_a05_[a-zA-Z0-9_]+$'
     OR current_setting('akrasia.a05_disposable',true) IS DISTINCT FROM 'true'
     OR NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname=current_user)
     OR pg_catalog.to_regclass('akrasia_a10_fixture.before_objects') IS NOT NULL
     OR EXISTS (SELECT 1 FROM storage.buckets WHERE id='project-media-private') THEN
    RAISE EXCEPTION 'A10 preparation requires fresh A05 disposable bootstrap and its superuser';
  END IF;
  IF pg_catalog.to_regprocedure('public.chat_retention_batch(integer,integer,integer,integer)') IS NULL THEN
    RAISE EXCEPTION 'Apply v1-v13 before A10 preparation';
  END IF;
END;
$guard$;

-- Add ONLY to the disposable A05 stub the configuration fields supplied by
-- real Supabase Storage. V14 never adds/changes Storage schema columns.
ALTER TABLE storage.buckets ADD COLUMN file_size_limit BIGINT, ADD COLUMN allowed_mime_types TEXT[];
ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;
-- Simulate adversarial broad API permissions and permissive policies while
-- retaining an unrelated legitimate public bucket. V14 must AND-restrict only
-- its two managed bucket IDs, regardless of these broad permissions.
GRANT SELECT,INSERT,UPDATE,DELETE ON storage.objects,storage.buckets TO anon,authenticated;
CREATE POLICY a10_fixture_permissive_objects ON storage.objects FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
CREATE POLICY a10_fixture_permissive_buckets ON storage.buckets FOR ALL TO PUBLIC USING(true) WITH CHECK(true);
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('a10-unrelated-public','a10-unrelated-public',true,8388608,ARRAY['text/plain']);
INSERT INTO storage.objects(bucket_id,name) VALUES
 ('project-thumbnails','thumb-1700000000000-fictional.png'),
 ('a10-unrelated-public','unrelated.txt');
CREATE SCHEMA akrasia_a10_fixture;
REVOKE ALL ON SCHEMA akrasia_a10_fixture FROM PUBLIC,anon,authenticated,service_role;
CREATE TABLE akrasia_a10_fixture.before_objects AS SELECT * FROM storage.objects;
CREATE TABLE akrasia_a10_fixture.before_projects AS SELECT id,to_jsonb(p) AS row_data FROM public.projects p;
CREATE TABLE akrasia_a10_fixture.before_unrelated_bucket AS SELECT * FROM storage.buckets WHERE id='a10-unrelated-public';
CREATE TABLE akrasia_a10_fixture.before_acl AS
SELECT oid,relacl::TEXT,relowner,relrowsecurity FROM pg_catalog.pg_class
WHERE oid IN ('storage.objects'::regclass,'storage.buckets'::regclass);
CREATE TABLE akrasia_a10_fixture.before_policies AS
SELECT p.polrelid,p.polname,p.polcmd,p.polpermissive,p.polroles,
 pg_catalog.pg_get_expr(p.polqual,p.polrelid) AS qual,pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
FROM pg_catalog.pg_policy p WHERE p.polrelid IN ('storage.objects'::regclass,'storage.buckets'::regclass);
COMMIT;
\echo 'A10 fictional Storage snapshot prepared. Apply v14 then a10-verify.sql.'
