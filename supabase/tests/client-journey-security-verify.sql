-- Actual role/ACL/RLS checks run only in the disposable loopback cluster.
BEGIN;
DO $$ BEGIN IF pg_catalog.current_database() NOT LIKE 'akrasia_a05_%' THEN RAISE EXCEPTION 'Disposable CRM security database required'; END IF; END $$;
ALTER ROLE service_role NOBYPASSRLS;
DO $$
DECLARE t TEXT;r TEXT;f TEXT;v_service OID;
BEGIN
 SELECT oid INTO v_service FROM pg_catalog.pg_roles WHERE rolname='service_role';
 IF (SELECT rolbypassrls FROM pg_catalog.pg_roles WHERE oid=v_service) THEN RAISE EXCEPTION 'Service RLS probe unexpectedly bypassed'; END IF;
 FOREACH t IN ARRAY ARRAY['client_journeys','client_journey_events','email_drafts','client_journey_operations'] LOOP
   IF NOT (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid=pg_catalog.to_regclass('public.'||t)) THEN RAISE EXCEPTION 'CRM RLS missing %',t; END IF;
   IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=pg_catalog.to_regclass('public.'||t) AND polname='service_only' AND polcmd='*' AND polroles=ARRAY[v_service] AND pg_catalog.pg_get_expr(polqual,polrelid)='true' AND pg_catalog.pg_get_expr(polwithcheck,polrelid)='true') OR
     EXISTS(SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid=pg_catalog.to_regclass('public.'||t) AND (polroles<>ARRAY[v_service] OR polcmd<>'*')) THEN RAISE EXCEPTION 'CRM policy is not service-only %',t; END IF;
   FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
     IF pg_catalog.has_table_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
       pg_catalog.has_any_column_privilege(r,'public.'||t,'SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Browser effective table/column access % %',r,t; END IF;
   END LOOP;
   FOREACH r IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE'] LOOP
     IF NOT pg_catalog.has_table_privilege('service_role','public.'||t,r) THEN RAISE EXCEPTION 'Reviewed service CRUD grant missing % %',t,r; END IF;
   END LOOP;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['public.dashboard_create_client_journey(uuid,uuid,text,text,text)','public.dashboard_update_client_journey(uuid,uuid,jsonb)','public.dashboard_save_email_draft(uuid,integer,uuid,jsonb)','public.dashboard_queue_email_draft(uuid,integer,uuid)','public.client_journey_operations_retention(integer)','public.client_journey_project_status(text)','public.client_journey_project_guard()','public.client_journey_task_guard()'] LOOP
   IF pg_catalog.has_function_privilege('anon',f,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',f,'EXECUTE') OR NOT pg_catalog.has_function_privilege('service_role',f,'EXECUTE') THEN RAISE EXCEPTION 'Private CRM function effective ACL %',f; END IF;
 END LOOP;
 IF (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='public.dashboard_create_client_journey(uuid,uuid,text,text,text)'::REGPROCEDURE) OR
    (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='public.dashboard_update_client_journey(uuid,uuid,jsonb)'::REGPROCEDURE) OR
    (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='public.dashboard_save_email_draft(uuid,integer,uuid,jsonb)'::REGPROCEDURE) OR
    NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid='public.dashboard_queue_email_draft(uuid,integer,uuid)'::REGPROCEDURE) THEN RAISE EXCEPTION 'Unexpected CRM invoker/definer boundary'; END IF;
END $$;
INSERT INTO public.leads(id,name,email,project_type) VALUES('00000000-0000-4000-8000-000000002201','Cliente privado de seguridad','crm-security@example.invalid','Prueba privada');
SET LOCAL ROLE service_role;
DO $$
DECLARE j JSONB;d JSONB;v_probe UUID:=pg_catalog.gen_random_uuid();v_event UUID:=pg_catalog.gen_random_uuid();v_draft UUID:=pg_catalog.gen_random_uuid();
BEGIN
 j:=public.dashboard_create_client_journey('00000000-0000-4000-8000-000000002201',pg_catalog.gen_random_uuid(),'Cliente privado de seguridad','Proyecto CRM privado','Brief privado: acceso del servidor sin BYPASSRLS.');
 IF NOT EXISTS(SELECT 1 FROM public.client_journeys WHERE id=(j->>'id')::UUID) THEN RAISE EXCEPTION 'Service RLS blocked valid journey creation/read'; END IF;
 PERFORM public.dashboard_update_client_journey((j->>'id')::UUID,pg_catalog.gen_random_uuid(),'{"stage":"evaluating","note":"Evaluación interna privada."}');
 -- Exercise INSERT, SELECT, UPDATE and DELETE of every reviewed service table
 -- without bypassing RLS. Direct writes remain inaccessible to browser roles.
 INSERT INTO public.client_journey_operations(id,operation_type,payload,result) VALUES(v_probe,'update','{}','{}');
 UPDATE public.client_journey_operations SET payload='{"server_test":true}' WHERE id=v_probe;
 IF NOT EXISTS(SELECT 1 FROM public.client_journey_operations WHERE id=v_probe AND payload->>'server_test'='true') THEN RAISE EXCEPTION 'Service operations RLS blocked'; END IF;
 DELETE FROM public.client_journey_operations WHERE id=v_probe;
 INSERT INTO public.client_journey_events(id,journey_id,event_type,stage,note,operation_id) VALUES(v_event,(j->>'id')::UUID,'note','evaluating','Sólo servidor.',pg_catalog.gen_random_uuid());
 UPDATE public.client_journey_events SET note='Nota privada corregida.' WHERE id=v_event;
 IF NOT EXISTS(SELECT 1 FROM public.client_journey_events WHERE id=v_event AND note='Nota privada corregida.') THEN RAISE EXCEPTION 'Service events RLS blocked'; END IF;
 DELETE FROM public.client_journey_events WHERE id=v_event;
 d:=public.dashboard_save_email_draft(v_draft,0,pg_catalog.gen_random_uuid(),pg_catalog.jsonb_build_object('to_email','crm-security@example.invalid','to_name','Cliente','subject','Asunto privado','body_text','Texto privado de prueba.','template_type','evaluation','journey_id',j->>'id','lead_id',NULL,'client_id',NULL,'project_id',NULL));
 UPDATE public.email_drafts SET subject='Asunto privado corregido' WHERE id=v_draft;
 IF NOT EXISTS(SELECT 1 FROM public.email_drafts WHERE id=v_draft AND subject='Asunto privado corregido') THEN RAISE EXCEPTION 'Service drafts RLS blocked'; END IF;
 DELETE FROM public.email_drafts WHERE id=v_draft;
 UPDATE public.client_journeys SET brief='Brief privado corregido por el servidor.' WHERE id=(j->>'id')::UUID;
 IF NOT EXISTS(SELECT 1 FROM public.client_journeys WHERE id=(j->>'id')::UUID AND brief='Brief privado corregido por el servidor.') THEN RAISE EXCEPTION 'Service journey updates RLS blocked'; END IF;
 DELETE FROM public.client_journeys WHERE id=(j->>'id')::UUID;
 IF EXISTS(SELECT 1 FROM public.client_journeys WHERE id=(j->>'id')::UUID) THEN RAISE EXCEPTION 'Service journey delete RLS blocked'; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE anon;
DO $$
DECLARE t TEXT;statement TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['client_journeys','client_journey_events','email_drafts','client_journey_operations'] LOOP
   FOREACH statement IN ARRAY ARRAY['SELECT * FROM public.'||t,'SELECT id FROM public.'||t,'INSERT INTO public.'||t||' DEFAULT VALUES','UPDATE public.'||t||' SET id=id WHERE false','DELETE FROM public.'||t||' WHERE false'] LOOP
     BEGIN EXECUTE statement;RAISE EXCEPTION 'Anonymous CRM statement succeeded %',statement;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
   END LOOP;
 END LOOP;
 BEGIN PERFORM public.dashboard_create_client_journey(NULL,NULL,NULL,NULL,NULL);RAISE EXCEPTION 'Anonymous create RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.dashboard_update_client_journey(NULL,NULL,NULL);RAISE EXCEPTION 'Anonymous update RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.dashboard_save_email_draft(NULL,NULL,NULL,NULL);RAISE EXCEPTION 'Anonymous save RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.dashboard_queue_email_draft(NULL,NULL,NULL);RAISE EXCEPTION 'Anonymous queue RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE t TEXT;statement TEXT;
BEGIN
 FOREACH t IN ARRAY ARRAY['client_journeys','client_journey_events','email_drafts','client_journey_operations'] LOOP
   FOREACH statement IN ARRAY ARRAY['SELECT * FROM public.'||t,'SELECT id FROM public.'||t,'INSERT INTO public.'||t||' DEFAULT VALUES','UPDATE public.'||t||' SET id=id WHERE false','DELETE FROM public.'||t||' WHERE false'] LOOP
     BEGIN EXECUTE statement;RAISE EXCEPTION 'Authenticated browser CRM statement succeeded %',statement;EXCEPTION WHEN insufficient_privilege THEN NULL;END;
   END LOOP;
 END LOOP;
 BEGIN PERFORM public.dashboard_create_client_journey(NULL,NULL,NULL,NULL,NULL);RAISE EXCEPTION 'Browser create RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.dashboard_update_client_journey(NULL,NULL,NULL);RAISE EXCEPTION 'Browser update RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.dashboard_save_email_draft(NULL,NULL,NULL,NULL);RAISE EXCEPTION 'Browser save RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
 BEGIN PERFORM public.dashboard_queue_email_draft(NULL,NULL,NULL);RAISE EXCEPTION 'Browser queue RPC';EXCEPTION WHEN insufficient_privilege THEN NULL;END;
END $$;
RESET ROLE;
ROLLBACK;
