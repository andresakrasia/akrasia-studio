-- All rows and provider jobs below belong to the disposable loopback database.
BEGIN;
DO $$ BEGIN IF pg_catalog.current_database() NOT LIKE 'akrasia_a05_%' THEN RAISE EXCEPTION 'Disposable workflow fixture required'; END IF; END $$;
INSERT INTO public.leads(id,name,email,project_type) VALUES('00000000-0000-4000-8000-000000002101','Cliente del ciclo completo','workflow@example.invalid','Animación 3D');
SET LOCAL ROLE service_role;
DO $$
DECLARE j JSONB;r JSONB;d JSONB;fields JSONB;v_task UUID;v_stage TEXT;v_status TEXT;v_template TEXT;v_count BIGINT;
BEGIN
  j:=public.dashboard_create_client_journey('00000000-0000-4000-8000-000000002101',pg_catalog.gen_random_uuid(),'Cliente del ciclo completo','Animación 3D 30 s','Pieza vertical, dos revisiones y entregable 1080x1920.');
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"closed","note":"Salto sin trabajar"}');
    RAISE EXCEPTION 'Skipped full lifecycle';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  BEGIN
    UPDATE public.projects SET status='delivered' WHERE id=(j->>'project_id')::UUID;
    RAISE EXCEPTION 'Direct project status drift';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
  BEGIN
    UPDATE public.projects SET client_id=NULL WHERE id=(j->>'project_id')::UUID;
    RAISE EXCEPTION 'Direct project client drift';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,'00000000-0000-4000-8000-000000002102','{"stage":"evaluating"}');
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"quote_preparation"}');
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"quote_sent","note":"Intento sin presupuesto"}');
    RAISE EXCEPTION 'Incomplete budget marked sent';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"budget_amount":1500,"budget_currency":"EUR","budget_scope":"Animación 3D 30 s, dos revisiones y máster vertical.","budget_timing":"Diez días laborables desde aceptación y materiales."}');
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"quote_sent"}');
    RAISE EXCEPTION 'Budget sent without confirmation';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"quote_sent","note":"Envío verificado por el equipo."}');
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"accepted"}');
    RAISE EXCEPTION 'Acceptance invented without client confirmation';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"accepted","note":"Cliente acepta por email alcance, precio y plazo."}');
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"in_production"}');
    RAISE EXCEPTION 'Production has no work plan';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  INSERT INTO public.project_tasks(project_id,title,status,priority) VALUES((j->>'project_id')::UUID,'Producir y revisar animación','pending','high') RETURNING id INTO v_task;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"in_production"}');
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(j->>'project_id')::UUID AND status='in_production' AND NOT is_published) THEN RAISE EXCEPTION 'Production status not canonical'; END IF;
  UPDATE public.project_tasks SET status='in_progress' WHERE id=v_task;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"review","note":"Versión de revisión recibida por cliente."}');
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"delivered","note":"Entrega con trabajo pendiente"}');
    RAISE EXCEPTION 'Pending task hidden by delivery';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  UPDATE public.project_tasks SET status='completed' WHERE id=v_task;
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"delivered"}');
    RAISE EXCEPTION 'Delivery invented without material evidence';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"delivered","note":"Máster final compartido; cliente confirma recepción."}');
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"closed"}');
    RAISE EXCEPTION 'Closure lacks final confirmation';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"closed","note":"Cliente aprueba cierre; no quedan asuntos pendientes."}');
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(j->>'project_id')::UUID AND status='completed' AND NOT is_published AND client_id=(j->>'client_id')::UUID) THEN RAISE EXCEPTION 'Completed project lost linked private client'; END IF;
  -- A lost HTTP response replays the receipt and never rewinds the actual state.
  r:=public.dashboard_update_client_journey((j->>'id')::UUID,'00000000-0000-4000-8000-000000002102','{"stage":"evaluating"}');
  IF r->>'stage'<>'evaluating' OR (SELECT stage FROM public.client_journeys WHERE id=(j->>'id')::UUID)<>'closed' THEN RAISE EXCEPTION 'Replay rewound the live stage'; END IF;
  BEGIN
    UPDATE public.project_tasks SET status='pending' WHERE id=v_task;
    RAISE EXCEPTION 'Completed client silently reopened by a task';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
  BEGIN
    INSERT INTO public.project_tasks(project_id,title,status) VALUES((j->>'project_id')::UUID,'Trabajo después del cierre','pending');
    RAISE EXCEPTION 'New pending work on a closed client';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;END;
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"review"}');
    RAISE EXCEPTION 'Return has no reason';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"review","note":"Cliente solicita una revisión adicional."}');
  UPDATE public.project_tasks SET status='pending' WHERE id=v_task;
  BEGIN
    PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"lost"}');
    RAISE EXCEPTION 'Lost proposal lacks reason';
  EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;END;
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"lost","note":"Cliente pospone el encargo adicional."}');
  PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"evaluating","note":"El cliente retoma la propuesta."}');
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id=(j->>'project_id')::UUID AND status='planning') THEN RAISE EXCEPTION 'Reopened proposal still completed'; END IF;
  FOREACH v_template IN ARRAY ARRAY['evaluation','quote','follow_up','kickoff','progress','delivery','final_delivery','closure','custom'] LOOP
    fields:=pg_catalog.jsonb_build_object('to_email','workflow@example.invalid','to_name','Cliente','subject','Mensaje de prueba','body_text','Mensaje editable sin envío externo.','template_type',v_template,'journey_id',j->>'id','lead_id',NULL,'client_id',NULL,'project_id',NULL);
    d:=public.dashboard_save_email_draft(pg_catalog.gen_random_uuid(),0,pg_catalog.gen_random_uuid(),fields);
    IF d->>'template_type'<>v_template THEN RAISE EXCEPTION 'Lifecycle template % unavailable',v_template; END IF;
  END LOOP;
  SELECT count(*) INTO v_count FROM public.client_journey_events WHERE journey_id=(j->>'id')::UUID AND event_type='stage_changed';
  IF v_count<>11 THEN RAISE EXCEPTION 'Lifecycle history lost or duplicated milestones: %',v_count; END IF;
END $$;
RESET ROLE;
DO $$ DECLARE f TEXT; BEGIN
 FOREACH f IN ARRAY ARRAY['public.client_journey_project_status(text)','public.client_journey_project_guard()','public.client_journey_task_guard()'] LOOP
   IF pg_catalog.has_function_privilege('anon',f,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',f,'EXECUTE') THEN RAISE EXCEPTION 'Internal workflow helper publicly callable %',f; END IF;
 END LOOP;
END $$;
ROLLBACK;
