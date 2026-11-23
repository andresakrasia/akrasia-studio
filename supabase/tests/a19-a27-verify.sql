-- Run only against a disposable, synthetic PostgreSQL database after v16.
-- Transaction rolls back every fixture; never point this file at production.
BEGIN;
DELETE FROM public.leads;
DELETE FROM public.messages;
DELETE FROM public.conversations;
DELETE FROM public.visitors;
SET LOCAL ROLE service_role;
INSERT INTO public.visitors(visitor_id,first_seen,last_seen) VALUES('panel-test',now(),now());
INSERT INTO public.conversations(id,visitor_id,created_at) VALUES('10000000-0000-4000-8000-000000000001','panel-test',now()),('10000000-0000-4000-8000-000000000002','panel-test',now());
INSERT INTO public.messages(id,conversation_id,role,content) VALUES('10000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','user','Synthetic question'),('10000000-0000-4000-8000-000000000004','10000000-0000-4000-8000-000000000001','assistant','Synthetic answer');
INSERT INTO public.leads(id,visitor_id,conversation_id,name,email) VALUES('10000000-0000-4000-8000-000000000005','panel-test','10000000-0000-4000-8000-000000000001','Synthetic contact','test@example.invalid'),('10000000-0000-4000-8000-000000000006','panel-test','10000000-0000-4000-8000-000000000002','Only profile',NULL);
INSERT INTO public.projects(id,title,slug,status,is_published,thumbnail) VALUES('10000000-0000-4000-8000-000000000007','Synthetic project','panel-test-project','planning',false,'/img/synthetic.webp');
DO $$
DECLARE saved jsonb; metrics jsonb; before_count integer; captured timestamptz;
BEGIN
 IF has_table_privilege('anon','public.dashboard_ai_operations','SELECT') OR has_table_privilege('authenticated','public.dashboard_ai_operations','INSERT') THEN RAISE EXCEPTION 'AI state leaked'; END IF;
 IF has_function_privilege('anon','public.dashboard_commit_ai(uuid,text,uuid,jsonb)','EXECUTE') OR has_function_privilege('authenticated','public.dashboard_save_content(text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Privileged RPC leaked'; END IF;
 saved=public.dashboard_save_content('projects','[{"id":"10000000-0000-4000-8000-000000000007","fields":{"title":"Saved title"}}]');
 IF saved->0->>'title'<>'Saved title' OR saved->0->>'thumbnail'<>'/img/synthetic.webp' OR saved->0->>'is_published'<>'false' THEN RAISE EXCEPTION 'Patch lost unrelated fields/publication'; END IF;
 BEGIN PERFORM public.dashboard_save_content('projects','[{"id":"10000000-0000-4000-8000-000000000007","fields":{"title":"Partial edit"}},{"id":"10000000-0000-4000-8000-999999999999","fields":{"title":"Missing"}}]');RAISE EXCEPTION 'Expected missing row failure'; EXCEPTION WHEN SQLSTATE 'P0002' THEN NULL; END;
 IF (SELECT title FROM public.projects WHERE id='10000000-0000-4000-8000-000000000007')<>'Saved title' THEN RAISE EXCEPTION 'Partial bulk edit committed'; END IF;
 BEGIN PERFORM public.dashboard_save_content('projects','[{"id":"10000000-0000-4000-8000-000000000007","fields":{"is_published":true}}]');RAISE EXCEPTION 'Expected publication rejection'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 BEGIN UPDATE public.conversations SET created_at=created_at-interval '1 day' WHERE id='10000000-0000-4000-8000-000000000001';RAISE EXCEPTION 'Expected immutable date'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 SELECT contact_captured_at INTO captured FROM public.leads WHERE id='10000000-0000-4000-8000-000000000005';
 IF captured IS NULL THEN RAISE EXCEPTION 'Contact timestamp absent'; END IF;
 UPDATE public.leads SET company='Synthetic company',contact_captured_at=now()+interval '1 day' WHERE id='10000000-0000-4000-8000-000000000005';
 IF (SELECT contact_captured_at FROM public.leads WHERE id='10000000-0000-4000-8000-000000000005') IS DISTINCT FROM captured THEN RAISE EXCEPTION 'Contact timestamp moved'; END IF;
 metrics=public.dashboard_metrics(now());
 IF (metrics->>'totalConversations')::integer<>2 OR (metrics->>'leadsThisMonth')::integer<>1 OR (metrics->>'conversionRatio')::integer<>50 OR (metrics->>'avgMessages')::integer<>1 THEN RAISE EXCEPTION 'Wrong cohort metric: %',metrics; END IF;
 saved=public.dashboard_claim_ai('10000000-0000-4000-8000-000000000010',repeat('a',64)); IF saved->>'state'<>'claimed' THEN RAISE EXCEPTION 'Claim failed'; END IF;
 saved=public.dashboard_claim_ai('10000000-0000-4000-8000-000000000010',repeat('a',64)); IF saved->>'state'<>'running' THEN RAISE EXCEPTION 'Repeated generation accepted'; END IF;
 BEGIN PERFORM public.dashboard_claim_ai('10000000-0000-4000-8000-000000000010',repeat('b',64));RAISE EXCEPTION 'Expected operation conflict'; EXCEPTION WHEN unique_violation THEN NULL; END;
 SELECT count(*) INTO before_count FROM public.project_tasks;
 BEGIN PERFORM public.dashboard_commit_ai('10000000-0000-4000-8000-000000000010',repeat('a',64),'10000000-0000-4000-8000-000000000007','{"tasks":[{"title":"Valid task","description":"Synthetic"},{"title":""}]}');RAISE EXCEPTION 'Expected task validation failure'; EXCEPTION WHEN SQLSTATE '22023' THEN NULL; END;
 IF (SELECT count(*) FROM public.project_tasks)<>before_count THEN RAISE EXCEPTION 'Partial AI tasks committed'; END IF;
 saved=public.dashboard_commit_ai('10000000-0000-4000-8000-000000000010',repeat('a',64),'10000000-0000-4000-8000-000000000007','{"tasks":[{"title":"Valid task","description":"Synthetic"}]}');
 IF jsonb_array_length(saved->'tasks')<>1 THEN RAISE EXCEPTION 'Task commit missing'; END IF;
 PERFORM public.dashboard_commit_ai('10000000-0000-4000-8000-000000000010',repeat('a',64),'10000000-0000-4000-8000-000000000007','{"tasks":[{"title":"Valid task","description":"Synthetic"}]}');
 IF (SELECT count(*) FROM public.project_tasks)<>before_count+1 THEN RAISE EXCEPTION 'AI replay duplicated task'; END IF;
  IF (SELECT result::text FROM public.dashboard_ai_operations WHERE id='10000000-0000-4000-8000-000000000010') LIKE '%Valid task%' THEN RAISE EXCEPTION 'Receipt copied task text'; END IF;
 DELETE FROM public.project_tasks WHERE id=(saved->'tasks'->0->>'id')::uuid;
 saved=public.dashboard_claim_ai('10000000-0000-4000-8000-000000000010',repeat('a',64));
 IF jsonb_array_length(saved->'result'->'tasks')<>0 OR saved::text LIKE '%Valid task%' THEN RAISE EXCEPTION 'Replay resurrected deleted task text'; END IF;
 saved=public.dashboard_claim_ai('10000000-0000-4000-8000-000000000011',repeat('c',64));
 saved=public.dashboard_commit_ai('10000000-0000-4000-8000-000000000011',repeat('c',64),NULL,'{"feed":[{"text":"Proposal only","level":"mid"}],"logs":[{"text":"Proposal only","log_type":"info"}]}');
 IF saved->'feed'->0->>'is_active'<>'false' OR saved->'logs'->0->>'is_active'<>'false' THEN RAISE EXCEPTION 'AI proposals automatically made public'; END IF;
END $$;
SET CONSTRAINTS dashboard_message_count IMMEDIATE;
DO $$BEGIN IF (SELECT message_count FROM public.conversations WHERE id='10000000-0000-4000-8000-000000000001')<>2 THEN RAISE EXCEPTION 'Incorrect actual message count'; END IF; END$$;
ROLLBACK;


