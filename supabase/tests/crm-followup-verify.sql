-- v26: single lead notice, manual contacts and dated next step.
-- Fictitious identities on the disposable loopback database; final ROLLBACK.
BEGIN;
DO $$ BEGIN IF pg_catalog.current_database() NOT LIKE 'akrasia_a05_%' THEN RAISE EXCEPTION 'Disposable CRM fixture required'; END IF; END $$;

-- 1. One Telegram notice per lead and reason, without contact data.
DO $$ DECLARE v_owner TEXT:='a2626262-0000-4000-8000-000000000001';v_other TEXT:='a2626262-0000-4000-8000-000000000002';
 v_expiry BIGINT:=EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())::BIGINT+3600;v_op UUID;v_hash TEXT;v_lead UUID;v_payload JSONB;i INTEGER;
BEGIN
 FOR i IN 1..3 LOOP
   v_op:=pg_catalog.gen_random_uuid();v_hash:=pg_catalog.repeat(i::TEXT,64);
   PERFORM public.chat_claim_turn(v_owner,v_expiry,0,v_op,v_hash);
   PERFORM public.chat_save_turn(v_owner,v_expiry,0,v_op,v_hash,'Mensaje '||i::TEXT||' crm@example.invalid','Respuesta ficticia',
     '{"email":"crm@example.invalid","phone":null,"name":"Ana Ficticia","company":null,"project_type":"videoclip","budget_mentioned":null,"interest_score":80,"interest_level":"hot"}',NULL);
 END LOOP;
 SELECT id INTO v_lead FROM public.leads WHERE visitor_id=v_owner;
 IF (SELECT COUNT(*) FROM public.integration_outbox WHERE visitor_id=v_owner AND channel='telegram')<>1 THEN RAISE EXCEPTION 'Lead notice repeated per message';END IF;
 SELECT payload INTO v_payload FROM public.integration_outbox WHERE idempotency_key='lead:'||v_lead::TEXT||':contact';
 IF v_payload IS NULL OR v_payload->>'panel'<>'lead:'||v_lead::TEXT OR v_payload->>'text'<>'Nuevo contacto en el chat · videoclip · interés alto.' THEN RAISE EXCEPTION 'Unexpected lead notice: %',v_payload;END IF;
 IF v_payload::TEXT LIKE '%example.invalid%' OR v_payload::TEXT LIKE '%Ana%' OR v_payload::TEXT LIKE '%Mensaje%' THEN RAISE EXCEPTION 'Personal data copied to Telegram';END IF;
 -- Interest without contact is announced once; the later contact once more.
 FOR i IN 1..2 LOOP
   v_op:=pg_catalog.gen_random_uuid();v_hash:=pg_catalog.repeat((i+3)::TEXT,64);
   PERFORM public.chat_claim_turn(v_other,v_expiry,0,v_op,v_hash);
   PERFORM public.chat_save_turn(v_other,v_expiry,0,v_op,v_hash,'Necesito presupuesto '||i::TEXT,'Respuesta ficticia',
     '{"email":null,"phone":null,"name":null,"company":null,"project_type":null,"budget_mentioned":null,"interest_score":60,"interest_level":"hot"}',NULL);
 END LOOP;
 SELECT id INTO v_lead FROM public.leads WHERE visitor_id=v_other;
 IF (SELECT COUNT(*) FROM public.integration_outbox WHERE visitor_id=v_other)<>1 OR
   NOT EXISTS(SELECT 1 FROM public.integration_outbox WHERE idempotency_key='lead:'||v_lead::TEXT||':interest' AND payload->>'text'='Conversación con interés alto, todavía sin contacto · interés alto.') THEN RAISE EXCEPTION 'Interest notice failed';END IF;
 v_op:=pg_catalog.gen_random_uuid();v_hash:=pg_catalog.repeat('6',64);
 PERFORM public.chat_claim_turn(v_other,v_expiry,0,v_op,v_hash);
 PERFORM public.chat_save_turn(v_other,v_expiry,0,v_op,v_hash,'Mi teléfono es 600000000','Respuesta ficticia',
   '{"email":null,"phone":"600000000","name":null,"company":null,"project_type":"spot","budget_mentioned":null,"interest_score":20,"interest_level":"warm"}',NULL);
 IF (SELECT COUNT(*) FROM public.integration_outbox WHERE visitor_id=v_other)<>2 OR
   NOT EXISTS(SELECT 1 FROM public.integration_outbox WHERE idempotency_key='lead:'||v_lead::TEXT||':contact' AND payload->>'text'='Nuevo contacto en el chat · spot · interés medio.') THEN RAISE EXCEPTION 'Contact notice after interest failed';END IF;
END $$;

-- 2. Manual contact, idempotent, never linked to a visitor, and usable by the journey.
SET LOCAL ROLE service_role;
DO $$ DECLARE v_id UUID:='a2626262-0000-4000-8000-000000000101';r JSONB;j JSONB;v_today DATE:=(pg_catalog.now() AT TIME ZONE 'Europe/Madrid')::DATE;v_count BIGINT;
 v_fields JSONB:='{"name":" Marta Ficticia ","company":"Sello Ficticio","email":"marta@example.invalid","phone":"","project_type":"videoclip","summary":"Videoclip para el single de otoño.","origin":"Instagram"}';
BEGIN
 r:=public.dashboard_create_manual_lead(v_id,v_fields);
 IF r->>'source'<>'manual' OR r->>'visitor_id' IS NOT NULL OR r->>'name'<>'Marta Ficticia' OR r->>'phone' IS NOT NULL OR r->>'origin'<>'Instagram' OR r->>'status'<>'new' OR r->>'contact_captured_at' IS NULL THEN RAISE EXCEPTION 'Manual contact not stored as expected: %',r;END IF;
 IF public.dashboard_create_manual_lead(v_id,v_fields)->>'id'<>v_id::TEXT THEN RAISE EXCEPTION 'Manual contact retry failed';END IF;
 BEGIN PERFORM public.dashboard_create_manual_lead(v_id,v_fields||'{"email":"otra@example.invalid"}');RAISE EXCEPTION 'Changed manual retry accepted';EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
 BEGIN PERFORM public.dashboard_create_manual_lead(pg_catalog.gen_random_uuid(),v_fields||'{"email":"sin-arroba"}');RAISE EXCEPTION 'Invalid email accepted';EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
 BEGIN PERFORM public.dashboard_create_manual_lead(pg_catalog.gen_random_uuid(),v_fields||'{"name":"  "}');RAISE EXCEPTION 'Empty name accepted';EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
 BEGIN PERFORM public.dashboard_create_manual_lead(pg_catalog.gen_random_uuid(),v_fields||'{"status":"qualified"}');RAISE EXCEPTION 'Unknown field accepted';EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
 SELECT COUNT(*) INTO v_count FROM public.leads WHERE source='manual';IF v_count<>1 THEN RAISE EXCEPTION 'Manual contact duplicated';END IF;
 j:=public.dashboard_create_client_journey(v_id,pg_catalog.gen_random_uuid(),'Marta Ficticia','Videoclip de otoño','Videoclip para el single de otoño.');
 IF j->>'lead_id'<>v_id::TEXT OR j->>'next_action_date' IS NOT NULL OR j->>'next_action_note'<>'' THEN RAISE EXCEPTION 'Journey from manual contact failed';END IF;
 r:=public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"next_action_note":"Nota como rol de servicio"}');
 IF r->>'next_action_note'<>'Nota como rol de servicio' THEN RAISE EXCEPTION 'Service role cannot set the next step';END IF;
END $$;
RESET ROLE;

-- 3. Dated next step: validated, clearable and reminded once on its day.
-- The private queue is not readable by service_role, so this part runs as owner.
DO $$ DECLARE j JSONB;r JSONB;v_today DATE:=(pg_catalog.now() AT TIME ZONE 'Europe/Madrid')::DATE;
BEGIN
 SELECT pg_catalog.to_jsonb(c) INTO j FROM public.client_journeys c WHERE c.lead_id='a2626262-0000-4000-8000-000000000101';
 BEGIN PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"next_action_date":"2026-02-31"}');RAISE EXCEPTION 'Impossible date accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM='Impossible date accepted' THEN RAISE;END IF;END;
 BEGIN PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"next_action_date":"mañana"}');RAISE EXCEPTION 'Free text date accepted';EXCEPTION WHEN OTHERS THEN IF SQLERRM='Free text date accepted' THEN RAISE;END IF;END;
 r:=public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),pg_catalog.jsonb_build_object('next_action_date',(v_today+30)::TEXT,'next_action_note','Llamar para confirmar fechas'));
 IF r->>'next_action_date'<>(v_today+30)::TEXT OR r->>'next_action_note'<>'Llamar para confirmar fechas' OR r->>'stage'<>'received' THEN RAISE EXCEPTION 'Next step not saved';END IF;
 IF (SELECT COUNT(*) FROM public.client_journey_events WHERE journey_id=(j->>'id')::UUID)<>1 THEN RAISE EXCEPTION 'Next step changed the client history';END IF;
 PERFORM public.integration_claim(10);
 IF EXISTS(SELECT 1 FROM public.integration_outbox WHERE idempotency_key LIKE 'journey:'||(j->>'id')||':next:%') THEN RAISE EXCEPTION 'Future next step reminded early';END IF;
 PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),pg_catalog.jsonb_build_object('next_action_date',(v_today-1)::TEXT));
 PERFORM public.integration_claim(10);PERFORM public.integration_claim(10);
 IF (SELECT COUNT(*) FROM public.integration_outbox WHERE idempotency_key='journey:'||(j->>'id')||':next:'||(v_today-1)::TEXT AND channel='telegram'
     AND payload->>'panel'='journey:'||(j->>'id') AND payload->>'text'='Próximo paso pendiente hoy · Propuesta recibida · Llamar para confirmar fechas')<>1 THEN RAISE EXCEPTION 'Due next step not reminded exactly once';END IF;
 r:=public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"next_action_date":null,"next_action_note":""}');
 IF r->>'next_action_date' IS NOT NULL OR r->>'next_action_note'<>'' THEN RAISE EXCEPTION 'Next step not cleared';END IF;
 -- A stopped proposal is never reminded, and an old date is not resurrected.
 PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),pg_catalog.jsonb_build_object('stage','lost','note','Sin presupuesto este año','next_action_date',(v_today-2)::TEXT));
 PERFORM public.integration_claim(10);
 IF EXISTS(SELECT 1 FROM public.integration_outbox WHERE idempotency_key='journey:'||(j->>'id')||':next:'||(v_today-2)::TEXT) THEN RAISE EXCEPTION 'Stopped proposal reminded';END IF;
END $$;
DO $$ BEGIN
 IF pg_catalog.has_function_privilege('anon','public.dashboard_create_manual_lead(uuid,jsonb)','EXECUTE') OR
   pg_catalog.has_function_privilege('authenticated','public.dashboard_create_manual_lead(uuid,jsonb)','EXECUTE') OR
   pg_catalog.has_function_privilege('anon','public.integration_claim(integer)','EXECUTE') OR
   pg_catalog.has_function_privilege('authenticated','public.dashboard_update_client_journey(uuid,uuid,jsonb)','EXECUTE') OR
   NOT pg_catalog.has_function_privilege('service_role','public.dashboard_create_manual_lead(uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Unexpected v26 grants';END IF;
END $$;
ROLLBACK;
