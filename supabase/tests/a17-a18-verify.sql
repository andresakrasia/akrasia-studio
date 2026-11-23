-- Dedicated fictitious identities; actual PostgreSQL, final ROLLBACK.
BEGIN;
DO $$ DECLARE v_owner TEXT:='a1717171-0000-4000-8000-000000000001';v_other TEXT:='a1717171-0000-4000-8000-000000000002';
 v_op UUID:='a1717171-0000-4000-8000-000000000010';v_next UUID:='a1717171-0000-4000-8000-000000000011';
 v_expiry BIGINT:=EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())::BIGINT+3600;v_hash TEXT:=pg_catalog.repeat('a',64);v_result JSONB;v_lead UUID;v_count INTEGER;
BEGIN
 v_result:=public.chat_claim_turn(v_owner,v_expiry,0,v_op,v_hash);IF v_result->>'status'<>'claimed' THEN RAISE EXCEPTION 'New operation not claimed';END IF;
 IF public.chat_claim_turn(v_owner,v_expiry,0,v_op,v_hash)->>'error'<>'chat_busy' THEN RAISE EXCEPTION 'Pending operation not locked';END IF;
 IF public.chat_claim_turn(v_owner,v_expiry,0,v_op,pg_catalog.repeat('b',64))->>'error'<>'invalid_request' THEN RAISE EXCEPTION 'Changed content hash accepted';END IF;
 IF public.chat_claim_turn(v_other,v_expiry,0,v_op,v_hash)->>'error'<>'invalid_request' THEN RAISE EXCEPTION 'Foreign operation accepted';END IF;
 v_result:=public.chat_save_turn(v_owner,v_expiry,0,v_op,v_hash,'Mi email es synthetic@example.invalid','Respuesta ficticia',
   '{"email":"synthetic@example.invalid","phone":null,"name":null,"company":null,"project_type":"spot","budget_mentioned":null,"interest_score":60,"interest_level":"hot"}',NULL);
 IF v_result->>'saved'<>'true' THEN RAISE EXCEPTION 'Turn not saved';END IF;
 IF (SELECT COUNT(*) FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.visitor_id=v_owner)<>2 THEN RAISE EXCEPTION 'Turn not atomic';END IF;
 IF (SELECT COUNT(*) FROM public.integration_outbox WHERE idempotency_key='lead:'||v_op::TEXT||':telegram')<>1 THEN RAISE EXCEPTION 'Missing atomic outbox';END IF;
 IF EXISTS(SELECT 1 FROM public.integration_outbox WHERE idempotency_key='lead:'||v_op::TEXT||':telegram' AND payload::TEXT LIKE '%synthetic@example.invalid%') THEN RAISE EXCEPTION 'Contact data copied to Telegram';END IF;
 v_result:=public.chat_claim_turn(v_owner,v_expiry,0,v_op,v_hash);IF v_result->>'status'<>'complete' OR v_result->>'response'<>'Respuesta ficticia' THEN RAISE EXCEPTION 'Completed response replay failed';END IF;
 PERFORM public.chat_save_turn(v_owner,v_expiry,0,v_op,v_hash,'Mi email es synthetic@example.invalid','Another response',NULL,NULL);
 IF (SELECT COUNT(*) FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id WHERE c.visitor_id=v_owner)<>2 THEN RAISE EXCEPTION 'Duplicate messages';END IF;
 BEGIN PERFORM public.chat_save_turn(v_owner,v_expiry,0,v_op,v_hash,'Different input','Response',NULL,NULL);RAISE EXCEPTION 'Changed replay accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM='Changed replay accepted' THEN RAISE;END IF;END;
 SELECT id INTO v_lead FROM public.leads WHERE visitor_id=v_owner;UPDATE public.leads SET status='contacted' WHERE id=v_lead;
 PERFORM public.chat_claim_turn(v_owner,v_expiry,0,v_next,pg_catalog.repeat('c',64));
 PERFORM public.chat_save_turn(v_owner,v_expiry,0,v_next,pg_catalog.repeat('c',64),'Mi empresa es Synthetic Studio','Response',
   '{"email":null,"phone":null,"name":"Ana Ficticia","company":"Synthetic Studio","project_type":null,"budget_mentioned":null,"interest_score":10,"interest_level":"cold"}',NULL);
 IF NOT EXISTS(SELECT 1 FROM public.leads WHERE id=v_lead AND name='Ana Ficticia' AND company='Synthetic Studio' AND email='synthetic@example.invalid' AND status='contacted' AND interest_score=10 AND interest_level='cold') THEN RAISE EXCEPTION 'Profile accumulation or business status failed';END IF;
 IF (SELECT COUNT(*) FROM public.leads WHERE visitor_id=v_owner)<>1 THEN RAISE EXCEPTION 'Duplicate profile';END IF;
 -- Erasure removes the message references and completed receipt via CASCADE.
 v_result:=public.chat_erase_context(v_owner,v_expiry,0,pg_catalog.repeat('d',64));
 IF v_result->>'contextVersion'<>'1' THEN RAISE EXCEPTION 'Erasure failed';END IF;
 IF EXISTS(SELECT 1 FROM public.chat_turn_operations WHERE visitor_id=v_owner AND status='complete') THEN RAISE EXCEPTION 'Receipt survived message erasure';END IF;
 IF public.chat_claim_turn(v_owner,v_expiry,0,v_op,v_hash)->>'error'<>'chat_context_changed' THEN RAISE EXCEPTION 'Old version replay exposed data';END IF;
 PERFORM public.integration_claim(10);
 IF EXISTS(SELECT 1 FROM public.integration_outbox WHERE visitor_id=v_owner AND status NOT IN('disabled','accepted','failed','uncertain')) THEN RAISE EXCEPTION 'Erased context queued delivery';END IF;
 PERFORM public.chat_claim_turn(v_owner,v_expiry,1,v_op,v_hash);UPDATE public.chat_turn_operations SET expires_at=pg_catalog.now()-INTERVAL '1 second' WHERE operation_id=v_op;
 v_count:=public.chat_operations_retention(100);IF v_count<1 THEN RAISE EXCEPTION 'Receipt cleanup failed';END IF;
 IF pg_catalog.has_any_column_privilege('anon','public.chat_turn_operations','SELECT,INSERT,UPDATE,REFERENCES') OR
   pg_catalog.has_function_privilege('anon','public.chat_claim_turn(text,bigint,integer,uuid,text)','EXECUTE') OR
   pg_catalog.has_function_privilege('service_role','public.chat_save_turn(text,bigint,integer,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Operation bypass grants';END IF;
END $$;
ROLLBACK;
