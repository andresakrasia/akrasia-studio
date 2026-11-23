-- Only invoked by the newly created disposable PostgreSQL runner.
BEGIN;
DO $$ BEGIN
  IF pg_catalog.current_database() NOT LIKE 'akrasia_a05_%' THEN RAISE EXCEPTION 'Disposable activity fixture required'; END IF;
END $$;
INSERT INTO public.projects(id,title,slug,is_published) VALUES('00000000-0000-4000-8000-000000001901','SQL fictitious activity project','sql-activity-demo',false);
INSERT INTO public.feed_entries(id,project_id,text) VALUES('00000000-0000-4000-8000-000000001902','00000000-0000-4000-8000-000000001901','INTERNAL_NEVER_PUBLIC');
INSERT INTO public.studio_logs(id,text) VALUES('00000000-0000-4000-8000-000000001903','INTERNAL_NEVER_PUBLIC');
DO $$ BEGIN
  IF (SELECT is_published OR public_title<>'' OR public_text<>'' OR public_occurred_at IS NOT NULL OR public_revision<>0 FROM public.feed_entries WHERE id='00000000-0000-4000-8000-000000001902') THEN RAISE EXCEPTION 'New activity must start an empty draft'; END IF;
  BEGIN
    UPDATE public.studio_logs SET is_published=true WHERE id='00000000-0000-4000-8000-000000001903';
    RAISE EXCEPTION 'Empty editorial content was approved';
  EXCEPTION WHEN check_violation OR raise_exception THEN
    IF SQLERRM='Empty editorial content was approved' THEN RAISE; END IF;
  END;
END $$;
UPDATE public.feed_entries SET public_title='Título',public_title_en='Title',public_text='Texto editorial',public_text_en='Editorial text',public_occurred_at='2026-01-01T00:00:00Z',public_event_type='process' WHERE id='00000000-0000-4000-8000-000000001902';
UPDATE public.studio_logs SET public_title='Estudio',public_title_en='Studio',public_text='Texto editorial',public_text_en='Editorial text',public_occurred_at='2026-01-01T00:00:00Z' WHERE id='00000000-0000-4000-8000-000000001903';
DO $$ BEGIN
  BEGIN
    UPDATE public.feed_entries SET is_published=true WHERE id='00000000-0000-4000-8000-000000001902';
    RAISE EXCEPTION 'Private project was approved';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='Private project was approved' THEN RAISE; END IF; END;
  UPDATE public.studio_logs SET public_occurred_at=pg_catalog.now()+INTERVAL '1 day' WHERE id='00000000-0000-4000-8000-000000001903';
  BEGIN
    UPDATE public.studio_logs SET is_published=true WHERE id='00000000-0000-4000-8000-000000001903';
    RAISE EXCEPTION 'Future occurrence was approved';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM='Future occurrence was approved' THEN RAISE; END IF; END;
  UPDATE public.studio_logs SET public_occurred_at='2026-01-01T00:00:00Z' WHERE id='00000000-0000-4000-8000-000000001903';
END $$;
UPDATE public.projects SET is_published=true WHERE id='00000000-0000-4000-8000-000000001901';
SET LOCAL ROLE service_role;
UPDATE public.feed_entries SET is_published=true WHERE id='00000000-0000-4000-8000-000000001902' AND public_revision=1;
UPDATE public.studio_logs SET is_published=true WHERE id='00000000-0000-4000-8000-000000001903';
RESET ROLE;
DO $$ BEGIN
  IF NOT (SELECT is_published FROM public.feed_entries WHERE id='00000000-0000-4000-8000-000000001902') THEN RAISE EXCEPTION 'Server approval did not persist'; END IF;
  IF NOT (SELECT is_published FROM public.studio_logs WHERE id='00000000-0000-4000-8000-000000001903') THEN RAISE EXCEPTION 'Standalone studio approval failed'; END IF;
END $$;
UPDATE public.feed_entries SET public_text='Reviewed again',is_published=true WHERE id='00000000-0000-4000-8000-000000001902';
DO $$ BEGIN
  IF (SELECT is_published OR public_revision<>2 FROM public.feed_entries WHERE id='00000000-0000-4000-8000-000000001902') THEN RAISE EXCEPTION 'Edit must atomically withdraw and increment revision'; END IF;
END $$;
UPDATE public.feed_entries SET is_published=true WHERE id='00000000-0000-4000-8000-000000001902' AND public_revision=1;
DO $$ BEGIN
  IF (SELECT is_published FROM public.feed_entries WHERE id='00000000-0000-4000-8000-000000001902') THEN RAISE EXCEPTION 'Stale approval must not match'; END IF;
END $$;
UPDATE public.feed_entries SET is_published=true WHERE id='00000000-0000-4000-8000-000000001902' AND public_revision=2;
UPDATE public.projects SET is_published=false WHERE id='00000000-0000-4000-8000-000000001901';
UPDATE public.projects SET is_published=true WHERE id='00000000-0000-4000-8000-000000001901';
DO $$ BEGIN
  IF (SELECT is_published FROM public.feed_entries WHERE id='00000000-0000-4000-8000-000000001902') THEN RAISE EXCEPTION 'Project reapproval must not resurrect withdrawn activity'; END IF;
  IF NOT (SELECT is_published FROM public.studio_logs WHERE id='00000000-0000-4000-8000-000000001903') THEN RAISE EXCEPTION 'Unrelated studio activity was changed'; END IF;
  IF pg_catalog.has_function_privilege('anon','public.enforce_public_activity()','EXECUTE') OR pg_catalog.has_function_privilege('authenticated','public.withdraw_project_activity()','EXECUTE') THEN RAISE EXCEPTION 'Trigger functions must not be API RPCs'; END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN PERFORM 1 FROM public.feed_entries;RAISE EXCEPTION 'anon read allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
  BEGIN PERFORM 1 FROM public.studio_logs;RAISE EXCEPTION 'anon log read allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN UPDATE public.feed_entries SET is_published=true;RAISE EXCEPTION 'authenticated write allowed';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
CREATE TEMP TABLE activity_before_reapplication AS SELECT id,to_jsonb(f) AS data FROM public.feed_entries f WHERE id='00000000-0000-4000-8000-000000001902' UNION ALL SELECT id,to_jsonb(l) FROM public.studio_logs l WHERE id='00000000-0000-4000-8000-000000001903';
COMMIT;
\ir ../migration-v19.sql
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM activity_before_reapplication b LEFT JOIN (SELECT id,to_jsonb(f) AS data FROM public.feed_entries f UNION ALL SELECT id,to_jsonb(l) FROM public.studio_logs l) a ON a.id=b.id WHERE a.data IS DISTINCT FROM b.data) THEN RAISE EXCEPTION 'Reapplication changed stored editorial/private data or approval'; END IF;
END $$;
DELETE FROM public.feed_entries WHERE id='00000000-0000-4000-8000-000000001902';
DELETE FROM public.studio_logs WHERE id='00000000-0000-4000-8000-000000001903';
DELETE FROM public.projects WHERE id='00000000-0000-4000-8000-000000001901';
DROP TABLE activity_before_reapplication;
COMMIT;
