-- Optional fixture, NEVER included by the migration manifest.
-- Only the disposable test database may load this synthetic content.
BEGIN;
DO $$ BEGIN
  IF pg_catalog.current_database() NOT LIKE 'akrasia_a05_%' THEN
    RAISE EXCEPTION 'Demo seed requires a disposable akrasia_a05_* database';
  END IF;
END $$;
INSERT INTO public.projects(id,title,slug,status,is_published) VALUES
  ('00000000-0000-4000-8000-000000000801','Proyecto ficticio','demo-project','planning',false)
  ON CONFLICT (id) DO NOTHING;
INSERT INTO public.services(id,title,slug,is_published) VALUES
  ('00000000-0000-4000-8000-000000000802','Servicio ficticio','demo-service',false)
  ON CONFLICT (id) DO NOTHING;
COMMIT;
