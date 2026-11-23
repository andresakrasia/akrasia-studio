-- A05: server-only Data API privileges for the current Akrasia application.
-- Apply after v1-v10 as the object owner, in a reviewed environment.
-- No data/seeds are changed. BEGIN/COMMIT makes failures roll back all changes.
-- Deliberately scoped: no ALL TABLES/FUNCTIONS IN SCHEMA, default ACL changes,
-- schema revocations, role changes, storage changes or CASCADE.
BEGIN;
SET LOCAL search_path = pg_catalog;

DO $a05$
DECLARE
  item RECORD;
  relation_oid OID;
  column_names TEXT;
  policy_name TEXT;
  sequence_item RECORD;
  role_name TEXT;
BEGIN
  FOR role_name IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = role_name) THEN
      RAISE EXCEPTION 'A05: required role % is missing', role_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolname IN ('anon', 'authenticated') AND (rolsuper OR rolbypassrls)) THEN
    RAISE EXCEPTION 'A05: untrusted roles must not be superusers or BYPASSRLS';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles r
    WHERE (r.rolsuper OR r.rolbypassrls OR r.rolname = 'service_role')
      AND (pg_catalog.pg_has_role('anon', r.oid, 'MEMBER') OR
           pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER'))
  ) THEN
    RAISE EXCEPTION 'A05: untrusted membership permits assuming a privileged role';
  END IF;
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') OR
     pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'A05: untrusted CREATE on public requires schema-owner review; no global schema privileges changed';
  END IF;
  IF NOT pg_catalog.has_schema_privilege('service_role', 'public', 'USAGE') THEN
    RAISE EXCEPTION 'A05: service_role requires USAGE on public';
  END IF;

  FOR item IN SELECT * FROM (VALUES
    ('visitors', 'SELECT, INSERT, UPDATE'),
    ('conversations', 'SELECT, INSERT, UPDATE'),
    ('messages', 'SELECT, INSERT'),
    ('leads', 'SELECT, INSERT, UPDATE'),
    ('content', 'SELECT, INSERT, UPDATE'),
    ('projects', 'SELECT, INSERT, UPDATE, DELETE'),
    ('project_tasks', 'SELECT, INSERT, UPDATE, DELETE'),
    ('feed_entries', 'SELECT, INSERT, UPDATE'),
    ('studio_logs', 'SELECT, INSERT, UPDATE'),
    ('studio_stats', 'SELECT, UPDATE'),
    ('services', 'SELECT, INSERT, UPDATE, DELETE'),
    ('clients', 'SELECT, INSERT, UPDATE, DELETE'),
    ('bookings', 'SELECT, INSERT, UPDATE'),
    ('availability', 'SELECT, INSERT, DELETE'),
    ('availability_overrides', 'SELECT'),
    ('sent_emails', 'SELECT, INSERT'),
    ('dashboard_sessions', 'SELECT, INSERT, DELETE'),
    ('dashboard_login_limits', NULL),
    ('chat_quota_buckets', NULL),
    ('chat_concurrency_leases', NULL)
  ) AS scope(table_name, server_privileges) LOOP
    relation_oid := pg_catalog.to_regclass(pg_catalog.format('public.%I', item.table_name));
    IF relation_oid IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class WHERE oid = relation_oid AND relkind = 'r'
    ) THEN
      RAISE EXCEPTION 'A05: expected ordinary table public.% is missing or changed; apply v1-v10/review drift first', item.table_name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_inherits WHERE inhparent = relation_oid OR inhrelid = relation_oid) THEN
      RAISE EXCEPTION 'A05: inheritance/partition drift on public.% requires separate review', item.table_name;
    END IF;
    -- Fail on ownership/membership drift; do not alter roles used by other apps.
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid = relation_oid AND (
        pg_catalog.pg_has_role('anon', c.relowner, 'MEMBER') OR
        pg_catalog.pg_has_role('authenticated', c.relowner, 'MEMBER') OR
        pg_catalog.pg_has_role('service_role', c.relowner, 'MEMBER')
      )
    ) THEN
      RAISE EXCEPTION 'A05: API roles must not own/inherit the owner of public.%', item.table_name;
    END IF;

    EXECUTE pg_catalog.format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', item.table_name);
    -- These are exclusively server tables, including the content read by public
    -- Astro APIs. Replace any old permissive policies on these exact objects.
    FOR policy_name IN SELECT polname FROM pg_catalog.pg_policy WHERE polrelid = relation_oid LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.%I', policy_name, item.table_name);
    END LOOP;
    EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', item.table_name);
    SELECT pg_catalog.string_agg(pg_catalog.quote_ident(attname), ', ' ORDER BY attnum)
      INTO column_names FROM pg_catalog.pg_attribute
      WHERE attrelid = relation_oid AND attnum > 0 AND NOT attisdropped;
    -- Explicitly remove column ACLs too, including a previously column-only grant.
    EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', column_names, item.table_name);
    IF item.server_privileges IS NOT NULL THEN
      EXECUTE pg_catalog.format('GRANT %s ON TABLE public.%I TO service_role', item.server_privileges, item.table_name);
      EXECUTE pg_catalog.format('CREATE POLICY a05_server_only ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', item.table_name);
    END IF;

    -- No sequences exist in v1-v10. If an owned/default sequence was added to
    -- a managed table, protect that sequence without touching unrelated ones.
    FOR sequence_item IN
      SELECT DISTINCT s.oid, n.nspname, s.relname
      FROM pg_catalog.pg_class s JOIN pg_catalog.pg_namespace n ON n.oid = s.relnamespace
      WHERE s.relkind = 'S' AND (
        EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_catalog.pg_class'::regclass
          AND d.objid = s.oid AND d.refclassid = 'pg_catalog.pg_class'::regclass
          AND d.refobjid = relation_oid AND d.deptype IN ('a', 'i')) OR
        EXISTS (SELECT 1 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_attrdef a ON a.oid = d.objid
          WHERE d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.refclassid = 'pg_catalog.pg_class'::regclass
          AND d.refobjid = s.oid AND a.adrelid = relation_oid)
      )
    LOOP
      -- A shared sequence is an unexpected dependency; revocation could break
      -- another application. Require review instead of changing its privileges.
      IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend d JOIN pg_catalog.pg_attrdef a ON a.oid = d.objid
        WHERE d.classid = 'pg_catalog.pg_attrdef'::regclass AND d.refclassid = 'pg_catalog.pg_class'::regclass
          AND d.refobjid = sequence_item.oid AND a.adrelid <> relation_oid
      ) OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_class'::regclass AND d.objid = sequence_item.oid
          AND d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid <> relation_oid AND d.deptype IN ('a', 'i')
      ) THEN
        RAISE EXCEPTION 'A05: shared sequence %.% requires separate review', sequence_item.nspname, sequence_item.relname;
      END IF;
      EXECUTE pg_catalog.format('REVOKE ALL PRIVILEGES ON SEQUENCE %I.%I FROM PUBLIC, anon, authenticated, service_role', sequence_item.nspname, sequence_item.relname);
      IF item.server_privileges LIKE '%INSERT%' THEN
        EXECUTE pg_catalog.format('GRANT USAGE ON SEQUENCE %I.%I TO service_role', sequence_item.nspname, sequence_item.relname);
      END IF;
      IF pg_catalog.has_sequence_privilege('anon', sequence_item.oid, 'USAGE, SELECT, UPDATE') OR
         pg_catalog.has_sequence_privilege('authenticated', sequence_item.oid, 'USAGE, SELECT, UPDATE') THEN
        RAISE EXCEPTION 'A05: inherited privileges remain on sequence %.%', sequence_item.nspname, sequence_item.relname;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
        WHERE (pg_catalog.pg_has_role('anon', r.oid, 'MEMBER') OR pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER'))
          AND pg_catalog.has_sequence_privilege(r.oid, sequence_item.oid, 'USAGE, SELECT, UPDATE')) OR
         EXISTS (SELECT 1 FROM unnest(ARRAY['USAGE','SELECT','UPDATE']) AS p(privilege)
           WHERE pg_catalog.has_sequence_privilege('service_role', sequence_item.oid, p.privilege)
             <> (p.privilege = 'USAGE' AND COALESCE(item.server_privileges LIKE '%INSERT%', false))) THEN
        RAISE EXCEPTION 'A05: unexpected assumable/server privileges on sequence %.%', sequence_item.nspname, sequence_item.relname;
      END IF;
    END LOOP;

    FOR role_name IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
      IF role_name <> 'service_role' OR item.server_privileges IS NULL THEN
        IF pg_catalog.has_table_privilege(role_name, relation_oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') OR
           pg_catalog.has_any_column_privilege(role_name, relation_oid, 'SELECT, INSERT, UPDATE, REFERENCES') THEN
          RAISE EXCEPTION 'A05: effective/inherited privileges remain for % on public.%', role_name, item.table_name;
        END IF;
      ELSE
        -- REVOKE must also remove privileges inherited through other roles;
        -- if it cannot, abort rather than changing global role memberships.
        IF EXISTS (
          SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS p(privilege)
          WHERE pg_catalog.has_table_privilege(role_name, relation_oid, p.privilege)
            <> (p.privilege = ANY (pg_catalog.string_to_array(item.server_privileges, ', ')))
        ) OR EXISTS (
          SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p(privilege)
          WHERE NOT (p.privilege = ANY (pg_catalog.string_to_array(item.server_privileges, ', ')))
            AND pg_catalog.has_any_column_privilege(role_name, relation_oid, p.privilege)
        ) THEN
          RAISE EXCEPTION 'A05: unexpected effective server privileges on public.%', item.table_name;
        END IF;
      END IF;
    END LOOP;
    -- Effective privilege checks alone do not cover NOINHERIT + SET ROLE.
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r
      WHERE (pg_catalog.pg_has_role('anon', r.oid, 'MEMBER') OR
             pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER'))
        AND (pg_catalog.has_table_privilege(r.oid, relation_oid, 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER') OR
             pg_catalog.has_any_column_privilege(r.oid, relation_oid, 'SELECT, INSERT, UPDATE, REFERENCES'))
    ) THEN
      RAISE EXCEPTION 'A05: untrusted role can assume a role with privileges on public.%', item.table_name;
    END IF;
    -- PostgreSQL 17 added MAINTAIN; older versions reject that privilege name.
    IF pg_catalog.current_setting('server_version_num')::INTEGER >= 170000 THEN
      IF pg_catalog.has_table_privilege('service_role', relation_oid, 'MAINTAIN') OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles r
        WHERE (pg_catalog.pg_has_role('anon', r.oid, 'MEMBER') OR pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER'))
          AND pg_catalog.has_table_privilege(r.oid, relation_oid, 'MAINTAIN')
      ) THEN
        RAISE EXCEPTION 'A05: unexpected effective/assumable MAINTAIN on public.%', item.table_name;
      END IF;
    END IF;
  END LOOP;
END;
$a05$;

-- Legacy helper is not used by any current API. Remove its elevation and RPC
-- access; keep its signature/data behavior for an owner-controlled maintenance call.
CREATE OR REPLACE FUNCTION public.increment_message_count(conv_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  UPDATE public.conversations
    SET message_count = message_count + 1, updated_at = pg_catalog.now()
    WHERE id = conv_id;
END;
$$;
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  NEW.updated_at = pg_catalog.now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.increment_message_count(UUID) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.update_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.dashboard_consume_login_attempt(TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_admit(TEXT, TEXT, UUID, JSONB, BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_release(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_consume_login_attempt(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_admit(TEXT, TEXT, UUID, JSONB, BIGINT) TO service_role;
GRANT EXECUTE ON FUNCTION public.chat_release(UUID) TO service_role;
-- v9/v10 already qualify private tables and use an empty search_path. Reassert
-- those properties without duplicating or changing the atomic quota algorithms.
ALTER FUNCTION public.dashboard_consume_login_attempt(TEXT) SECURITY DEFINER SET search_path = '';
ALTER FUNCTION public.chat_admit(TEXT, TEXT, UUID, JSONB, BIGINT) SECURITY DEFINER SET search_path = '';
ALTER FUNCTION public.chat_release(UUID) SECURITY DEFINER SET search_path = '';

DO $a05_guard$
DECLARE
  fn RECORD;
  role_name TEXT;
  view_item RECORD;
  dependency_item RECORD;
BEGIN
  FOR fn IN
    SELECT p.oid, p.proname, p.prosecdef, p.proowner
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname IN
      ('increment_message_count', 'update_updated_at', 'dashboard_consume_login_attempt', 'chat_admit', 'chat_release')
  LOOP
    IF fn.oid NOT IN (
      'public.increment_message_count(uuid)'::regprocedure, 'public.update_updated_at()'::regprocedure,
      'public.dashboard_consume_login_attempt(text)'::regprocedure,
      'public.chat_admit(text,text,uuid,jsonb,bigint)'::regprocedure, 'public.chat_release(uuid)'::regprocedure
    ) THEN
      RAISE EXCEPTION 'A05: unexpected overload of %; review it explicitly', fn.proname;
    END IF;
    IF pg_catalog.pg_has_role('anon', fn.proowner, 'MEMBER') OR
       pg_catalog.pg_has_role('authenticated', fn.proowner, 'MEMBER') OR
       pg_catalog.pg_has_role('service_role', fn.proowner, 'MEMBER') THEN
      RAISE EXCEPTION 'A05: API roles must not own/inherit function owner %', fn.proname;
    END IF;
    FOR role_name IN SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) LOOP
      IF pg_catalog.has_function_privilege(role_name, fn.oid, 'EXECUTE') <>
        (role_name = 'service_role' AND fn.proname IN ('dashboard_consume_login_attempt', 'chat_admit', 'chat_release')) THEN
        RAISE EXCEPTION 'A05: unexpected effective EXECUTE for % on %', role_name, fn.proname;
      END IF;
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r
      WHERE (pg_catalog.pg_has_role('anon', r.oid, 'MEMBER') OR
             pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER'))
        AND pg_catalog.has_function_privilege(r.oid, fn.oid, 'EXECUTE')
    ) THEN
      RAISE EXCEPTION 'A05: untrusted role can assume a role with EXECUTE on %', fn.proname;
    END IF;
    -- Definers must remain capable of applying the atomic operations. Owners
    -- bypass ordinary RLS, but FORCE RLS or changed ownership can break that.
    FOR dependency_item IN
      SELECT * FROM (VALUES
        ('dashboard_consume_login_attempt','dashboard_sessions','SELECT, DELETE'),
        ('dashboard_consume_login_attempt','dashboard_login_limits','SELECT, INSERT, UPDATE, DELETE'),
        ('chat_admit','chat_quota_buckets','SELECT, INSERT, UPDATE, DELETE'),
        ('chat_admit','chat_concurrency_leases','SELECT, INSERT, DELETE'),
        ('chat_release','chat_concurrency_leases','SELECT, DELETE')
      ) AS dependencies(function_name, table_name, privileges)
      WHERE function_name = fn.proname
    LOOP
      IF EXISTS (SELECT 1 FROM unnest(pg_catalog.string_to_array(dependency_item.privileges, ', ')) AS p(privilege)
        WHERE NOT pg_catalog.has_table_privilege(fn.proowner,
          pg_catalog.to_regclass(pg_catalog.format('public.%I', dependency_item.table_name)), p.privilege)) OR
        NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_roles r, pg_catalog.pg_class c
          WHERE r.oid = fn.proowner AND c.oid = pg_catalog.to_regclass(pg_catalog.format('public.%I', dependency_item.table_name))
            AND (r.rolsuper OR r.rolbypassrls OR
                 (NOT c.relforcerowsecurity AND pg_catalog.pg_has_role(fn.proowner, c.relowner, 'USAGE')))
        ) THEN
        RAISE EXCEPTION 'A05: definer owner cannot operate % on public.%', fn.proname, dependency_item.table_name;
      END IF;
    END LOOP;
  END LOOP;

  -- A privileged routine created outside the repository may bypass every table
  -- ACL/RLS check. Do not revoke unrelated functions automatically: require an
  -- explicit review if an untrusted role can execute a non-extension definer.
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef
      AND EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
        WHERE (pg_catalog.pg_has_role('anon', r.oid, 'MEMBER') OR pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER'))
          AND pg_catalog.has_function_privilege(r.oid, p.oid, 'EXECUTE'))
      AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_depend d
        WHERE d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e')
  ) THEN
    RAISE EXCEPTION 'A05: an exposed SECURITY DEFINER in public requires separate review';
  END IF;

  -- No views are declared by this application. Detect direct and nested views,
  -- including materialized views, over its tables. Do not silently rewrite a
  -- foreign view or assume that RLS protects an owner-privileged view.
  FOR view_item IN
    WITH RECURSIVE related(oid) AS (
      SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY (ARRAY[
        'visitors','conversations','messages','leads','content','projects','project_tasks',
        'feed_entries','studio_logs','studio_stats','services','clients','bookings',
        'availability','availability_overrides','sent_emails','dashboard_sessions',
        'dashboard_login_limits','chat_quota_buckets','chat_concurrency_leases'
      ])
      UNION
      SELECT rw.ev_class FROM related r
      JOIN pg_catalog.pg_depend d ON d.refclassid = 'pg_catalog.pg_class'::regclass AND d.refobjid = r.oid
      JOIN pg_catalog.pg_rewrite rw ON d.classid = 'pg_catalog.pg_rewrite'::regclass AND d.objid = rw.oid
      JOIN pg_catalog.pg_class v ON v.oid = rw.ev_class AND v.relkind IN ('v', 'm')
    )
    SELECT c.oid, n.nspname, c.relname FROM related r JOIN pg_catalog.pg_class c ON c.oid = r.oid
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('v','m')
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
      WHERE (pg_catalog.pg_has_role('anon', r.oid, 'MEMBER') OR pg_catalog.pg_has_role('authenticated', r.oid, 'MEMBER'))
        AND (pg_catalog.has_table_privilege(r.oid, view_item.oid, 'SELECT, INSERT, UPDATE, DELETE') OR
             pg_catalog.has_any_column_privilege(r.oid, view_item.oid, 'SELECT, INSERT, UPDATE, REFERENCES'))) THEN
      RAISE EXCEPTION 'A05: exposed dependent view %.% requires separate review/revocation', view_item.nspname, view_item.relname;
    END IF;
  END LOOP;
END;
$a05_guard$;

-- Refresh the Data API schema/privilege cache at commit, not on a failed run.
NOTIFY pgrst, 'reload schema';
COMMIT;
