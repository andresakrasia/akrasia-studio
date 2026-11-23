-- A06: publication is an explicit editorial approval, independent of status.
-- Apply AFTER v1-v11 as the object owner. No remote application is performed here.
-- First addition gives EVERY existing row false / empty public description.
-- Reapplication preserves approvals and editorial text: no UPDATE/backfill/seed.
-- Existing description, client fields and task relations remain internal.
-- RLS/ACL from A05 remain server-only; service_role APIs MUST also filter and
-- project their public outputs. This migration grants no public table access.
BEGIN;
SET LOCAL search_path = pg_catalog;

DO $a06_preflight$
DECLARE
  relation_oid OID := pg_catalog.to_regclass('public.projects');
  role_name TEXT;
BEGIN
  IF relation_oid IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class
    WHERE oid = relation_oid AND relkind = 'r' AND relrowsecurity
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_inherits
    WHERE inhparent = relation_oid OR inhrelid = relation_oid
  ) THEN
    RAISE EXCEPTION 'A06: ordinary RLS-protected public.projects required; apply v1-v11/review drift first';
  END IF;
  FOR role_name IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      RAISE EXCEPTION 'A06: required A05 role % is missing', role_name;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_catalog.pg_policy WHERE polrelid = relation_oid) <> 1 OR
     NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy p
       WHERE p.polrelid = relation_oid AND p.polname = 'a05_server_only'
         AND p.polcmd = '*' AND p.polpermissive
         AND p.polroles = ARRAY[(SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role')]
         AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = 'true'
         AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = 'true'
     ) THEN
    RAISE EXCEPTION 'A06: expected A05 server-only projects policy is missing or changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE (pg_catalog.pg_has_role('anon', r.oid, 'MEMBER') OR
           pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER'))
      AND (r.rolsuper OR r.rolbypassrls OR r.rolname = 'service_role' OR
        pg_catalog.has_table_privilege(r.oid, relation_oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') OR
        pg_catalog.has_any_column_privilege(r.oid, relation_oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
  ) THEN
    RAISE EXCEPTION 'A06: untrusted effective/assumable project privileges require A05 review';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(privilege)
    WHERE pg_catalog.has_table_privilege('service_role', relation_oid, p.privilege)
      <> (p.privilege = ANY (ARRAY['SELECT','INSERT','UPDATE','DELETE']))
  ) THEN
    RAISE EXCEPTION 'A06: unexpected service_role project privileges require A05 review';
  END IF;
END;
$a06_preflight$;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_description TEXT NOT NULL DEFAULT '';

-- IF NOT EXISTS must not silently accept an incompatible preexisting column.
-- Abort atomically on drift instead of rewriting approvals or internal content.
DO $a06_columns$
DECLARE
  column_spec RECORD;
BEGIN
  FOR column_spec IN SELECT * FROM (VALUES
    ('is_published', 'boolean'::regtype, 'false'),
    ('public_description', 'text'::regtype, '''''::text')
  ) AS expected(name, type_oid, default_expression) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = 'public.projects'::regclass
        AND a.attname = column_spec.name AND NOT a.attisdropped
        AND a.atttypid = column_spec.type_oid AND a.attnotnull
        AND a.attidentity = '' AND a.attgenerated = ''
        AND pg_catalog.pg_get_expr(d.adbin, d.adrelid) = column_spec.default_expression
    ) THEN
      RAISE EXCEPTION 'A06: incompatible % column; review schema without resetting publication decisions', column_spec.name;
    END IF;
  END LOOP;
  IF pg_catalog.has_any_column_privilege('anon', 'public.projects', 'SELECT, INSERT, UPDATE, REFERENCES') OR
     pg_catalog.has_any_column_privilege('authenticated', 'public.projects', 'SELECT, INSERT, UPDATE, REFERENCES') THEN
    RAISE EXCEPTION 'A06: new columns must retain A05 server-only privileges';
  END IF;
END;
$a06_columns$;

COMMENT ON COLUMN public.projects.is_published IS
  'Explicit portfolio approval, independent of production status. Existing and new projects start false; only authenticated administration may approve/withdraw through the application.';
COMMENT ON COLUMN public.projects.public_description IS
  'Editorial text deliberately approved for public portfolio/chat output. Starts empty; never copied automatically from the internal description or client/task data.';
-- PostgREST reloads its metadata after the successful commit. A rollback does
-- not deliver this notification or expose a partially applied schema.
NOTIFY pgrst, 'reload schema';
COMMIT;
