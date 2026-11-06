-- Approved public activity; internal feed/log text remains private.
BEGIN;
SELECT pg_catalog.set_config('akrasia.activity_initial_search_path',pg_catalog.current_setting('search_path'),true);
SET LOCAL search_path = pg_catalog;
DO $activity_columns$
DECLARE t TEXT; expected RECORD;
BEGIN
  FOREACH t IN ARRAY ARRAY['feed_entries','studio_logs'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('public.'||t) AND relkind='r' AND relrowsecurity) THEN
      RAISE EXCEPTION 'Public activity requires existing RLS-protected % and v1-v18',t;
    END IF;
    IF pg_catalog.has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
       pg_catalog.has_any_column_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,REFERENCES') OR
       pg_catalog.has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
       pg_catalog.has_any_column_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'Review server-only ACL/RLS before public activity';
    END IF;
    EXECUTE pg_catalog.format('ALTER TABLE public.%I
      ADD COLUMN IF NOT EXISTS public_title TEXT NOT NULL DEFAULT '''',
      ADD COLUMN IF NOT EXISTS public_title_en TEXT NOT NULL DEFAULT '''',
      ADD COLUMN IF NOT EXISTS public_text TEXT NOT NULL DEFAULT '''',
      ADD COLUMN IF NOT EXISTS public_text_en TEXT NOT NULL DEFAULT '''',
      ADD COLUMN IF NOT EXISTS public_event_type TEXT NOT NULL DEFAULT ''studio'',
      ADD COLUMN IF NOT EXISTS public_occurred_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS public_revision INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT false',t);
    FOR expected IN SELECT * FROM (VALUES
      ('public_title','text'::regtype,true,$default$''::text$default$),('public_title_en','text'::regtype,true,$default$''::text$default$),
      ('public_text','text'::regtype,true,$default$''::text$default$),('public_text_en','text'::regtype,true,$default$''::text$default$),
      ('public_event_type','text'::regtype,true,$default$'studio'::text$default$),
      ('public_occurred_at','timestamptz'::regtype,false,NULL),
      ('public_revision','integer'::regtype,true,'0'),('is_published','boolean'::regtype,true,'false')
    ) AS spec(name,type_oid,required,expression) LOOP
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
        WHERE a.attrelid=pg_catalog.to_regclass('public.'||t) AND a.attname=expected.name AND NOT a.attisdropped
          AND a.atttypid=expected.type_oid AND a.attnotnull=expected.required AND a.attidentity='' AND a.attgenerated=''
          AND pg_catalog.pg_get_expr(d.adbin,d.adrelid) IS NOT DISTINCT FROM expected.expression) THEN
        RAISE EXCEPTION 'Incompatible editorial column %.%; review without resetting approvals',t,expected.name;
      END IF;
    END LOOP;
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=pg_catalog.to_regclass('public.'||t) AND conname=t||'_public_activity_contract') THEN
      EXECUTE pg_catalog.format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (
        length(public_title)<=200 AND length(public_title_en)<=200 AND
        length(public_text)<=2000 AND length(public_text_en)<=2000 AND
        public_event_type IN (''milestone'',''process'',''studio'') AND public_revision>=0 AND
        (NOT is_published OR (btrim(public_title)<>'''' AND btrim(public_title_en)<>'''' AND
          btrim(public_text)<>'''' AND btrim(public_text_en)<>'''' AND public_occurred_at IS NOT NULL)))',t,t||'_public_activity_contract');
    END IF;
    EXECUTE pg_catalog.format('CREATE INDEX IF NOT EXISTS %I ON public.%I (public_occurred_at DESC,id DESC) WHERE is_published',t||'_public_activity_order',t);
  END LOOP;
END;
$activity_columns$;

CREATE OR REPLACE FUNCTION public.enforce_public_activity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE approved BOOLEAN;
BEGIN
  IF TG_OP='UPDATE' AND ROW(NEW.project_id,NEW.public_title,NEW.public_title_en,NEW.public_text,NEW.public_text_en,NEW.public_event_type,NEW.public_occurred_at)
    IS DISTINCT FROM ROW(OLD.project_id,OLD.public_title,OLD.public_title_en,OLD.public_text,OLD.public_text_en,OLD.public_event_type,OLD.public_occurred_at) THEN
    NEW.is_published:=false;
    NEW.public_revision:=OLD.public_revision+1;
  END IF;
  IF NEW.is_published THEN
    IF NEW.public_occurred_at IS NULL OR NEW.public_occurred_at>pg_catalog.clock_timestamp() OR NEW.public_occurred_at<'2000-01-01T00:00:00Z'::TIMESTAMPTZ THEN
      RAISE EXCEPTION 'Publication requires a real past occurrence date';
    END IF;
    IF NEW.project_id IS NOT NULL THEN
      -- SHARE conflicts with withdrawal's NO KEY UPDATE row lock. A race may
      -- abort rather than approve an event after its project has been withdrawn.
      SELECT is_published INTO approved FROM public.projects WHERE id=NEW.project_id FOR SHARE;
      IF approved IS DISTINCT FROM true THEN RAISE EXCEPTION 'Publication requires an approved public project'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.withdraw_project_activity()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.is_published AND NOT NEW.is_published THEN
    UPDATE public.feed_entries SET is_published=false WHERE project_id=NEW.id AND is_published;
    UPDATE public.studio_logs SET is_published=false WHERE project_id=NEW.id AND is_published;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.enforce_public_activity() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.withdraw_project_activity() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS trg_public_activity ON public.feed_entries;
CREATE TRIGGER trg_public_activity BEFORE INSERT OR UPDATE ON public.feed_entries FOR EACH ROW EXECUTE FUNCTION public.enforce_public_activity();
DROP TRIGGER IF EXISTS trg_public_activity ON public.studio_logs;
CREATE TRIGGER trg_public_activity BEFORE INSERT OR UPDATE ON public.studio_logs FOR EACH ROW EXECUTE FUNCTION public.enforce_public_activity();
DROP TRIGGER IF EXISTS trg_withdraw_project_activity ON public.projects;
CREATE TRIGGER trg_withdraw_project_activity AFTER UPDATE OF is_published ON public.projects FOR EACH ROW EXECUTE FUNCTION public.withdraw_project_activity();
COMMENT ON COLUMN public.feed_entries.is_published IS 'Explicit approval of separate public editorial fields; not derived from is_active, AI output, internal text or project status.';
COMMENT ON COLUMN public.studio_logs.is_published IS 'Explicit approval of separate public editorial fields; project withdrawal also withdraws linked entries.';
NOTIFY pgrst,'reload schema';
-- The migration journal fingerprints the catalog before COMMIT. Preserve its
-- caller's deparser context as well as the session context restored at commit.
SELECT pg_catalog.set_config('search_path',pg_catalog.current_setting('akrasia.activity_initial_search_path'),true);
COMMIT;
