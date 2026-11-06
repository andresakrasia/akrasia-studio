-- Disposable PostgreSQL only; all synthetic rows are rolled back.
BEGIN;
DO $$ BEGIN
  IF pg_catalog.current_database() NOT LIKE 'akrasia_a05_%' THEN RAISE EXCEPTION 'Disposable journey fixture required'; END IF;
END $$;
INSERT INTO public.leads(id,name,email,company,project_type) VALUES('00000000-0000-4000-8000-000000002001','Cliente sintético','journey@example.invalid','Empresa ficticia','Vídeo sintético');
SET LOCAL ROLE service_role;
DO $$
DECLARE j JSONB;r JSONB;d JSONB;q JSONB;fields JSONB;before_count BIGINT;v_stage TEXT;v_status TEXT;
BEGIN
  SELECT count(*) INTO before_count FROM public.clients;
  BEGIN
    PERFORM public.dashboard_create_client_journey('00000000-0000-4000-8000-000000002099','00000000-0000-4000-8000-000000002090','Ausente','Ficticio','');
    RAISE EXCEPTION 'Missing lead created records';
  EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL;END;
  IF (SELECT count(*) FROM public.clients)<>before_count THEN RAISE EXCEPTION 'Missing lead left a partial client'; END IF;
  j:=public.dashboard_create_client_journey('00000000-0000-4000-8000-000000002001','00000000-0000-4000-8000-000000002002','Cliente sintético','Proyecto privado sintético','Brief ficticio');
  r:=public.dashboard_create_client_journey('00000000-0000-4000-8000-000000002001','00000000-0000-4000-8000-000000002002','Cliente sintético','Proyecto privado sintético','Brief ficticio');
  IF r<>j THEN RAISE EXCEPTION 'Create replay changed result'; END IF;
  r:=public.dashboard_create_client_journey('00000000-0000-4000-8000-000000002001','00000000-0000-4000-8000-000000002003','Cliente sintético','Proyecto privado sintético','Brief ficticio');
  IF r->>'id'<>j->>'id' OR (SELECT count(*) FROM public.clients)<>before_count+1 THEN RAISE EXCEPTION 'Same lead created duplicate client'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(j->>'project_id')::UUID AND status='planning' AND NOT is_published AND client_id=(j->>'client_id')::UUID) THEN RAISE EXCEPTION 'Linked project was public or missing'; END IF;
  BEGIN
    PERFORM public.dashboard_create_client_journey('00000000-0000-4000-8000-000000002001','00000000-0000-4000-8000-000000002002','Changed','Proyecto privado sintético','Brief ficticio');
    RAISE EXCEPTION 'Changed operation payload accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
  r:=public.dashboard_update_client_journey((j->>'id')::UUID,'00000000-0000-4000-8000-000000002004','{"stage":"evaluating","note":"Evaluación humana","budget_amount":0.29,"budget_scope":"Pieza de 30 segundos"}');
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,'00000000-0000-4000-8000-000000002004','{"stage":"evaluating","note":"Evaluación humana","budget_amount":0.29,"budget_scope":"Pieza de 30 segundos"}');
  IF (SELECT count(*) FROM public.client_journey_events WHERE journey_id=(j->>'id')::UUID)<>3 THEN RAISE EXCEPTION 'Stage/quote replay duplicated history'; END IF;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,'00000000-0000-4000-8000-000000002005','{"stage":"evaluating"}');
  IF (SELECT count(*) FROM public.client_journey_events WHERE journey_id=(j->>'id')::UUID)<>3 THEN RAISE EXCEPTION 'Unchanged stage invented history'; END IF;
  FOR v_stage,v_status IN SELECT * FROM (VALUES ('delivered','delivered'),('evaluating','planning'),('closed','completed'),('accepted','planning'),('in_production','in_production'),('lost','planning'),('review','post_production'),('received','planning'),('evaluating','planning')) transitions LOOP
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),pg_catalog.jsonb_build_object('stage',v_stage));
    IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(j->>'project_id')::UUID AND status=v_status AND NOT is_published) THEN RAISE EXCEPTION 'Journey stage % failed to restore project disposition %',v_stage,v_status; END IF;
  END LOOP;
  fields:=pg_catalog.jsonb_build_object('to_email','journey@example.invalid','to_name','Cliente','subject','Estamos evaluando tu propuesta','body_text','Hola, Cliente. El equipo está revisando tu propuesta.','template_type','evaluation','journey_id',j->>'id','lead_id',NULL,'client_id',NULL,'project_id',NULL);
  d:=public.dashboard_save_email_draft('00000000-0000-4000-8000-000000002006',0,'00000000-0000-4000-8000-000000002007',fields);
  IF (d->>'revision')::INTEGER<>1 OR d->>'client_id'<>j->>'client_id' THEN RAISE EXCEPTION 'Saved draft missing revision or associations'; END IF;
  IF public.dashboard_save_email_draft('00000000-0000-4000-8000-000000002006',0,'00000000-0000-4000-8000-000000002007',fields)<>d THEN RAISE EXCEPTION 'Draft replay changed'; END IF;
  d:=public.dashboard_save_email_draft('00000000-0000-4000-8000-000000002006',1,'00000000-0000-4000-8000-000000002008',fields||'{"subject":"Revisado"}');
  BEGIN
    PERFORM public.dashboard_save_email_draft('00000000-0000-4000-8000-000000002006',1,'00000000-0000-4000-8000-000000002009',fields||'{"subject":"Obsoleto"}');
    RAISE EXCEPTION 'Stale draft overwrote content';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
  BEGIN
    PERFORM public.dashboard_queue_email_draft('00000000-0000-4000-8000-000000002006',1,'00000000-0000-4000-8000-000000002010');
    RAISE EXCEPTION 'Stale draft queued';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
  q:=public.dashboard_queue_email_draft('00000000-0000-4000-8000-000000002006',2,'00000000-0000-4000-8000-000000002011');
  IF q->>'status'<>'queued' OR q->>'provider_status'<>'queued' OR q->>'queue_id' IS NULL THEN RAISE EXCEPTION 'Queue status misrepresented'; END IF;
  IF public.dashboard_queue_email_draft('00000000-0000-4000-8000-000000002006',2,'00000000-0000-4000-8000-000000002011')<>q THEN RAISE EXCEPTION 'Queue replay changed'; END IF;
  r:=public.dashboard_queue_email_draft('00000000-0000-4000-8000-000000002006',2,'00000000-0000-4000-8000-000000002012');
  IF r->>'queue_id'<>q->>'queue_id' OR (SELECT count(*) FROM public.client_journey_events WHERE journey_id=(j->>'id')::UUID AND event_type='email_queued')<>1 THEN RAISE EXCEPTION 'Repeated queue duplicated email/history'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.sent_emails WHERE operation_id=(q->>'queue_id')::UUID AND lead_id=(j->>'lead_id')::UUID AND template_type='evaluation' AND status='queued') THEN RAISE EXCEPTION 'Queued email missing lead/template context'; END IF;
  PERFORM public.dashboard_save_email_draft('00000000-0000-4000-8000-000000002013',0,'00000000-0000-4000-8000-000000002014',fields||'{"body_text":"Presupuesto {{importe}} pendiente"}');
  BEGIN
    PERFORM public.dashboard_queue_email_draft('00000000-0000-4000-8000-000000002013',1,'00000000-0000-4000-8000-000000002015');
    RAISE EXCEPTION 'Placeholder email queued';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  UPDATE public.client_journey_operations SET created_at=pg_catalog.now()-INTERVAL '31 days' WHERE id='00000000-0000-4000-8000-000000002007';
  IF public.client_journey_operations_retention(1)<>1 OR NOT EXISTS(SELECT 1 FROM public.email_drafts WHERE id='00000000-0000-4000-8000-000000002006') THEN RAISE EXCEPTION 'Receipt retention changed saved draft or failed'; END IF;
END $$;
RESET ROLE;
-- Web lead retention/erasure must unlink references without destroying CRM.
UPDATE public.sent_emails SET lead_id=NULL WHERE lead_id='00000000-0000-4000-8000-000000002001';
DELETE FROM public.leads WHERE id='00000000-0000-4000-8000-000000002001';
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.client_journeys j JOIN public.clients c ON c.id=j.client_id JOIN public.projects p ON p.id=j.project_id WHERE j.lead_id IS NULL AND c.email='journey@example.invalid' AND NOT p.is_published) OR
    NOT EXISTS(SELECT 1 FROM public.email_drafts WHERE id='00000000-0000-4000-8000-000000002006' AND lead_id IS NULL) THEN RAISE EXCEPTION 'Lead erasure blocked or destroyed independent CRM records'; END IF;
END $$;
DO $$ DECLARE t TEXT; f TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['client_journeys','client_journey_events','email_drafts','client_journey_operations'] LOOP
    IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('public.'||t)) OR
      pg_catalog.has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') OR pg_catalog.has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN RAISE EXCEPTION 'Private table exposed %',t; END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.dashboard_create_client_journey(uuid,uuid,text,text,text)','public.dashboard_update_client_journey(uuid,uuid,jsonb)','public.dashboard_save_email_draft(uuid,integer,uuid,jsonb)','public.dashboard_queue_email_draft(uuid,integer,uuid)'] LOOP
    IF pg_catalog.has_function_privilege('anon',f,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',f,'EXECUTE') OR NOT pg_catalog.has_function_privilege('service_role',f,'EXECUTE') THEN RAISE EXCEPTION 'Private RPC ACL invalid %',f; END IF;
  END LOOP;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN BEGIN PERFORM 1 FROM public.client_journeys;RAISE EXCEPTION 'anon journey access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN BEGIN UPDATE public.email_drafts SET body_text='attack';RAISE EXCEPTION 'authenticated draft access';EXCEPTION WHEN insufficient_privilege THEN NULL;END;END $$;
RESET ROLE;
ROLLBACK;
