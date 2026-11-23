-- A10: private project media and bucket-scoped Storage access restrictions.
-- Apply AFTER v1-v13, coordinated with the A10 media proxy. Owner review needed.
-- Does not move/delete objects, rewrite project references, change global ACLs,
-- alter Storage columns, or replace policies belonging to other buckets.
-- Old direct public URLs stop serving at origin; approved media uses the proxy.
BEGIN;
SET LOCAL search_path = pg_catalog;
-- Avoid config/policy races during the owner migration. Briefly blocks writes
-- across these shared tables; schedule a reviewed Storage maintenance window.
SET LOCAL lock_timeout = '5s';
LOCK TABLE storage.buckets, storage.objects IN SHARE ROW EXCLUSIVE MODE;

DO $a10_preflight$
DECLARE
  relation_name TEXT; relation_oid OID; role_name TEXT; target RECORD; routine RECORD; view_item RECORD;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=role_name) THEN
      RAISE EXCEPTION 'A10: required role % is missing', role_name;
    END IF;
  END LOOP;
  IF NOT pg_catalog.has_schema_privilege('service_role','storage','USAGE') THEN
    RAISE EXCEPTION 'A10: server Storage schema access is missing';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY['storage.objects','storage.buckets'] LOOP
    relation_oid := pg_catalog.to_regclass(relation_name);
    IF relation_oid IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class
        WHERE oid=relation_oid AND relkind='r' AND relrowsecurity)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhparent=relation_oid OR inhrelid=relation_oid) THEN
      RAISE EXCEPTION 'A10: ordinary RLS-protected % required; review Storage platform first', relation_name;
    END IF;
    -- Row policies cannot protect against owners, BYPASSRLS, TRUNCATE, schema
    -- replacement, triggers, or a role the caller can explicitly SET ROLE to.
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
      WHERE (pg_catalog.pg_has_role('anon',r.oid,'MEMBER') OR pg_catalog.pg_has_role('authenticated',r.oid,'MEMBER'))
        AND (r.rolsuper OR r.rolbypassrls OR r.rolname='service_role'
          OR pg_catalog.pg_has_role(r.oid,(SELECT relowner FROM pg_catalog.pg_class WHERE oid=relation_oid),'MEMBER')
          OR pg_catalog.has_schema_privilege(r.oid,'storage','CREATE')
          OR pg_catalog.has_table_privilege(r.oid,relation_oid,'TRUNCATE,REFERENCES,TRIGGER')
          OR pg_catalog.has_any_column_privilege(r.oid,relation_oid,'REFERENCES'))) THEN
      RAISE EXCEPTION 'A10: untrusted effective/assumable Storage privilege requires owner review';
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','DELETE']) AS rights(privilege)
      WHERE NOT pg_catalog.has_table_privilege('service_role','storage.objects',rights.privilege)) THEN
    RAISE EXCEPTION 'A10: existing server read/upload/cleanup privileges are missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='project-thumbnails' AND name='project-thumbnails') THEN
    RAISE EXCEPTION 'A10: expected legacy project-thumbnails bucket is missing or renamed';
  END IF;
  -- A preexisting new-name bucket must already match our exact contract. Do
  -- not silently take over an unrelated public bucket or incompatible media.
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='project-media-private'
    AND (name IS DISTINCT FROM 'project-media-private' OR public IS DISTINCT FROM false
      OR file_size_limit IS DISTINCT FROM 2097152::BIGINT
      OR allowed_mime_types IS DISTINCT FROM ARRAY['image/webp']::TEXT[]))
    OR EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='project-media-private'
      AND (name IS NULL OR name !~ '^thumbs/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}[.]webp$')) THEN
    RAISE EXCEPTION 'A10: preexisting project-media-private bucket/configuration/keys require review';
  END IF;

  -- Owner-privileged views/materialized copies can bypass object-row policies.
  -- Abort for review instead of changing ACLs of an unrelated consumer/view.
  FOR view_item IN
    WITH RECURSIVE related(oid) AS (
      SELECT pg_catalog.to_regclass('storage.objects')::OID
      UNION SELECT pg_catalog.to_regclass('storage.buckets')::OID
      UNION
      SELECT rw.ev_class FROM related r
      JOIN pg_catalog.pg_depend d ON d.refclassid='pg_catalog.pg_class'::regclass AND d.refobjid=r.oid
      JOIN pg_catalog.pg_rewrite rw ON d.classid='pg_catalog.pg_rewrite'::regclass AND d.objid=rw.oid
      JOIN pg_catalog.pg_class v ON v.oid=rw.ev_class AND v.relkind IN ('v','m')
    )
    SELECT c.oid,n.nspname,c.relname FROM related r JOIN pg_catalog.pg_class c ON c.oid=r.oid
    JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind IN ('v','m')
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
      WHERE (pg_catalog.pg_has_role('anon',r.oid,'MEMBER') OR pg_catalog.pg_has_role('authenticated',r.oid,'MEMBER'))
        AND (pg_catalog.has_table_privilege(r.oid,view_item.oid,'SELECT,INSERT,UPDATE,DELETE')
          OR pg_catalog.has_any_column_privilege(r.oid,view_item.oid,'SELECT,INSERT,UPDATE,REFERENCES'))) THEN
      RAISE EXCEPTION 'A10: exposed dependent Storage view %.% requires review',view_item.nspname,view_item.relname;
    END IF;
  END LOOP;

  -- A05 already fixed the original A10 definer helper; A09 added five private
  -- definers. Validate deployed catalog coverage; do not redefine or grant them.
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('increment_message_count','update_updated_at',
      'dashboard_consume_login_attempt','chat_admit','chat_release','chat_context_state',
      'chat_erase_context','chat_save_turn','chat_insert_booking','chat_retention_batch')) <> 10 THEN
    RAISE EXCEPTION 'A10: missing or unexpected overload in existing A05/A09 functions';
  END IF;
  FOR target IN SELECT * FROM (VALUES
    ('public.increment_message_count(uuid)',false,false),
    ('public.update_updated_at()',false,false),
    ('public.dashboard_consume_login_attempt(text)',true,true),
    ('public.chat_admit(text,text,uuid,jsonb,bigint)',true,true),
    ('public.chat_release(uuid)',true,true),
    ('public.chat_context_state(text,bigint)',true,true),
    ('public.chat_erase_context(text,bigint,integer,text)',true,true),
    ('public.chat_save_turn(text,bigint,integer,text,text,jsonb)',true,true),
    ('public.chat_insert_booking(text,bigint,integer,jsonb)',true,true),
    ('public.chat_retention_batch(integer,integer,integer,integer)',true,true)
  ) AS functions(signature,is_definer,server_execute) LOOP
    SELECT * INTO routine FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(target.signature);
    IF NOT FOUND OR routine.prosecdef IS DISTINCT FROM target.is_definer
      OR NOT EXISTS (SELECT 1 FROM unnest(routine.proconfig) config
        WHERE config IN ('search_path=','search_path=""'))
      OR pg_catalog.has_function_privilege('service_role',routine.oid,'EXECUTE') IS DISTINCT FROM target.server_execute
      OR pg_catalog.pg_has_role('service_role',routine.proowner,'MEMBER')
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
        WHERE (pg_catalog.pg_has_role('anon',r.oid,'MEMBER') OR pg_catalog.pg_has_role('authenticated',r.oid,'MEMBER'))
          AND (pg_catalog.has_function_privilege(r.oid,routine.oid,'EXECUTE')
            OR pg_catalog.pg_has_role(r.oid,routine.proowner,'MEMBER'))) THEN
      RAISE EXCEPTION 'A10: existing A05/A09 function restriction missing or changed: %',target.signature;
    END IF;
  END LOOP;
END;
$a10_preflight$;

-- Bucket configuration only. Existing object metadata/content remains intact.
UPDATE storage.buckets SET public=false, file_size_limit=2097152,
  allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp']::TEXT[]
WHERE id='project-thumbnails';
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('project-media-private','project-media-private',false,2097152,ARRAY['image/webp']::TEXT[])
ON CONFLICT(id) DO NOTHING;

-- Restrictive PUBLIC policies AND with every permissive policy, including the
-- old v3 public-read policy and arbitrary broad anon/authenticated policies.
-- For rows in unrelated buckets these expressions are true: unchanged access.
-- Trusted Storage owners/BYPASSRLS/service keys remain privileged by design.
DROP POLICY IF EXISTS a10_private_project_objects ON storage.objects;
CREATE POLICY a10_private_project_objects ON storage.objects AS RESTRICTIVE FOR ALL TO PUBLIC
USING (bucket_id NOT IN ('project-thumbnails','project-media-private') OR current_user='service_role')
WITH CHECK (bucket_id NOT IN ('project-thumbnails','project-media-private') OR current_user='service_role');
DROP POLICY IF EXISTS a10_private_project_buckets ON storage.buckets;
CREATE POLICY a10_private_project_buckets ON storage.buckets AS RESTRICTIVE FOR ALL TO PUBLIC
USING (id NOT IN ('project-thumbnails','project-media-private') OR current_user='service_role')
WITH CHECK (id NOT IN ('project-thumbnails','project-media-private') OR current_user='service_role');

-- Explicit legitimate server policy also works in a disposable non-BYPASSRLS
-- probe. No grants to anon/authenticated or shared-table/global revocations.
DROP POLICY IF EXISTS a10_server_project_objects ON storage.objects;
CREATE POLICY a10_server_project_objects ON storage.objects FOR ALL TO service_role
USING (bucket_id IN ('project-thumbnails','project-media-private'))
WITH CHECK (bucket_id IN ('project-thumbnails','project-media-private'));
DROP POLICY IF EXISTS a10_server_project_buckets ON storage.buckets;
CREATE POLICY a10_server_project_buckets ON storage.buckets FOR SELECT TO service_role
USING (id IN ('project-thumbnails','project-media-private'));

COMMENT ON POLICY a10_private_project_objects ON storage.objects IS
  'A10 application-owned restrictive guard: project media is server-only; no effect on other buckets. Public delivery requires application publication approval.';
COMMENT ON POLICY a10_private_project_buckets ON storage.buckets IS
  'A10 application-owned restrictive guard: API clients cannot expose or mutate managed project buckets; other buckets retain their policies.';
NOTIFY pgrst, 'reload schema';
COMMIT;
