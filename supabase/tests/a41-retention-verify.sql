-- Disposable PostgreSQL only. Every synthetic row is rolled back.
BEGIN;
DO $$ BEGIN
  IF current_database() !~ '^akrasia_a05_[a-zA-Z0-9_]+$' OR current_setting('akrasia.a05_disposable',true) IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'Disposable cluster required';
  END IF;
END $$;
INSERT INTO public.integration_outbox(id,idempotency_key,channel,payload,status,created_at,lease_until) VALUES
 ('00000000-0000-4000-8000-000000000901','a41-queued','email','{"to":"old@example.invalid"}','queued',now()-interval '91 days',NULL),
 ('00000000-0000-4000-8000-000000000902','a41-accepted','email','{"to":"old@example.invalid"}','accepted',now()-interval '91 days',NULL),
 ('00000000-0000-4000-8000-000000000903','a41-expired','email','{"to":"old@example.invalid"}','sending',now()-interval '91 days',now()-interval '1 minute'),
 ('00000000-0000-4000-8000-000000000904','a41-active','email','{"to":"active@example.invalid"}','sending',now()-interval '91 days',now()+interval '5 minutes'),
 ('00000000-0000-4000-8000-000000000905','a41-fresh','email','{"to":"fresh@example.invalid"}','queued',now(),NULL);
INSERT INTO public.dashboard_ai_operations(id,fingerprint,state,created_at) VALUES
 ('00000000-0000-4000-8000-000000000906',repeat('a',64),'running',now()-interval '31 days'),
 ('00000000-0000-4000-8000-000000000907',repeat('b',64),'running',now());
INSERT INTO public.chat_turn_operations(operation_id,visitor_id,context_version,request_hash,lease_until,expires_at) VALUES
 ('00000000-0000-4000-8000-000000000908','00000000-0000-4000-8000-000000000909',0,repeat('c',64),now()-interval '1 hour',now()-interval '1 minute');
DO $test$
DECLARE result jsonb; i integer;
BEGIN
  IF pg_catalog.has_function_privilege('anon','public.production_retention_batch(integer,integer,integer,integer)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.production_retention_batch(integer,integer,integer,integer)','EXECUTE') THEN
    RAISE EXCEPTION 'Public maintenance execute grant';
  END IF;
  FOR i IN 1..3 LOOP
    SET LOCAL ROLE service_role;
    result:=public.production_retention_batch(30,90,90,2);
    RESET ROLE;
    IF (result->>'outbox')::integer>2 OR (result->>'chat_operations')::integer>2 OR (result->>'dashboard_operations')::integer>2 THEN
      RAISE EXCEPTION 'Maintenance exceeded batch bound';
    END IF;
  END LOOP;
  IF EXISTS(SELECT 1 FROM public.integration_outbox WHERE id IN ('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000903')) THEN
    RAISE EXCEPTION 'Expired pending payload retained';
  END IF;
  IF (SELECT count(*) FROM public.integration_outbox WHERE id IN ('00000000-0000-4000-8000-000000000904','00000000-0000-4000-8000-000000000905'))<>2 THEN
    RAISE EXCEPTION 'Fresh or active work removed';
  END IF;
  IF EXISTS(SELECT 1 FROM public.dashboard_ai_operations WHERE id='00000000-0000-4000-8000-000000000906') OR
    NOT EXISTS(SELECT 1 FROM public.dashboard_ai_operations WHERE id='00000000-0000-4000-8000-000000000907') OR
    EXISTS(SELECT 1 FROM public.chat_turn_operations WHERE operation_id='00000000-0000-4000-8000-000000000908') THEN
    RAISE EXCEPTION 'Receipt retention mismatch';
  END IF;
END $test$;
ROLLBACK;
