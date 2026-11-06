-- Fictitious local PostgreSQL verification only. Run after v1-v13 in a
-- disposable database bootstrapped by a05-bootstrap.sql. Always rolls back.
-- This fixture has been supplied, not executed against a real PostgreSQL here.
BEGIN;
SET LOCAL search_path = pg_catalog, public;
DO $$
DECLARE v_owner TEXT := '00000000-0000-4000-8000-000000000091'; v_other TEXT := '00000000-0000-4000-8000-000000000092';
  v_expiry BIGINT := EXTRACT(EPOCH FROM pg_catalog.now())::BIGINT + 3600;
  v_a UUID; v_b UUID; v_lead UUID; v_booking UUID; v_result JSONB; v_policy JSONB;
BEGIN
  INSERT INTO public.visitors(visitor_id) VALUES(v_owner),(v_other);
  INSERT INTO public.conversations(visitor_id) VALUES(v_owner) RETURNING id INTO v_a;
  INSERT INTO public.conversations(visitor_id) VALUES(v_other) RETURNING id INTO v_b;
  INSERT INTO public.messages(conversation_id,role,content) VALUES(v_a,'user','A fictitious old chat'),(v_b,'user','B untouched');
  INSERT INTO public.leads(visitor_id,conversation_id,name,source) VALUES(v_owner,v_a,'Fictitious derived profile','web') RETURNING id INTO v_lead;
  INSERT INTO public.bookings(visitor_id,conversation_id,lead_id,booked_date,booked_time,status,visitor_email)
    VALUES(v_owner,v_a,v_lead,CURRENT_DATE+1,'12:00','confirmed','fictitious@example.invalid') RETURNING id INTO v_booking;
  INSERT INTO public.chat_quota_buckets(bucket,requests,units,expires_at) VALUES('session:'||pg_catalog.repeat('a',64),19,0,pg_catalog.now()+INTERVAL '1 hour');
  PERFORM public.chat_context_state(v_owner,v_expiry);
  INSERT INTO public.chat_concurrency_leases(lease_id,session_key,ip_key,created_at,expires_at)
    VALUES('00000000-0000-4000-8000-000000000093',pg_catalog.repeat('a',64),pg_catalog.repeat('b',64),pg_catalog.now(),pg_catalog.now()+INTERVAL '60 seconds');
  v_result := public.chat_erase_context(v_owner,v_expiry,0,pg_catalog.repeat('a',64));
  IF v_result->>'error' <> 'chat_busy' OR NOT EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=v_a) OR
    NOT EXISTS(SELECT 1 FROM public.chat_context_states WHERE visitor_id=v_owner AND context_version=0) THEN RAISE EXCEPTION 'A09 admitted work fences erasure'; END IF;
  v_result := public.chat_retention_batch(30,90,90,1);
  IF v_result->>'deferred' <> 'true' OR v_result->>'messages' <> '0' THEN RAISE EXCEPTION 'A09 admitted work fences retention'; END IF;
  -- Simulate settled request/release; quota counters remain consumed.
  PERFORM public.chat_release('00000000-0000-4000-8000-000000000093');
  v_result := public.chat_erase_context(v_owner,v_expiry,0,pg_catalog.repeat('a',64));
  IF v_result->>'contextVersion' <> '1' THEN RAISE EXCEPTION 'A09 erase version'; END IF;
  IF EXISTS(SELECT 1 FROM public.conversations WHERE visitor_id=v_owner) OR EXISTS(SELECT 1 FROM public.leads WHERE visitor_id=v_owner) THEN RAISE EXCEPTION 'A09 erase scope'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=v_b AND content='B untouched') THEN RAISE EXCEPTION 'A09 foreign data'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bookings WHERE id=v_booking AND status='confirmed' AND lead_id IS NULL AND conversation_id IS NULL) THEN RAISE EXCEPTION 'A09 independent booking'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.chat_quota_buckets WHERE bucket='session:'||pg_catalog.repeat('a',64) AND requests=19) THEN RAISE EXCEPTION 'A09 quota reset'; END IF;
  v_result := public.chat_save_turn(v_owner,v_expiry,0,'stale','stale',NULL);
  IF v_result->>'error' <> 'chat_context_changed' THEN RAISE EXCEPTION 'A09 stale write'; END IF;
  v_result := public.chat_save_turn(v_owner,v_expiry,1,'new','new answer',NULL);
  IF v_result->>'saved' <> 'true' THEN RAISE EXCEPTION 'A09 fresh write'; END IF;
  PERFORM public.chat_erase_context(v_owner,v_expiry,0,pg_catalog.repeat('a',64));
  IF NOT EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.visitor_id=v_owner AND m.content='new') THEN RAISE EXCEPTION 'A09 retry re-erased newer turn'; END IF;
  UPDATE public.messages SET created_at=pg_catalog.now()-INTERVAL '31 days' WHERE conversation_id=v_b;
  UPDATE public.conversations SET updated_at=pg_catalog.now()-INTERVAL '31 days' WHERE id=v_b;
  v_result := public.chat_retention_batch(30,90,90,1);
  IF (v_result->>'messages')::INTEGER <> 1 OR EXISTS(SELECT 1 FROM public.messages WHERE conversation_id=v_b) THEN RAISE EXCEPTION 'A09 retention ages'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.messages WHERE content='new') THEN RAISE EXCEPTION 'A09 retention fresh content'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.bookings WHERE id=v_booking) THEN RAISE EXCEPTION 'A09 retention active booking'; END IF;
  IF pg_catalog.has_table_privilege('anon','public.chat_context_states','SELECT,INSERT,UPDATE,DELETE') OR
    pg_catalog.has_table_privilege('authenticated','public.chat_context_states','SELECT,INSERT,UPDATE,DELETE') OR
    pg_catalog.has_table_privilege('service_role','public.chat_context_states','SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'A09 state table ACL'; END IF;
  IF pg_catalog.has_function_privilege('anon','public.chat_erase_context(text,bigint,integer,text)','EXECUTE') OR
    pg_catalog.has_function_privilege('authenticated','public.chat_retention_batch(integer,integer,integer,integer)','EXECUTE') THEN RAISE EXCEPTION 'A09 RPC ACL'; END IF;
  IF NOT pg_catalog.has_function_privilege('service_role','public.chat_erase_context(text,bigint,integer,text)','EXECUTE') THEN RAISE EXCEPTION 'A09 service RPC'; END IF;
END;
$$;
ROLLBACK;
