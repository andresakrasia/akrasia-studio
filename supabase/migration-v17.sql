-- A17/A18/A27. Apply after v16. No actual user data is removed in this migration.
BEGIN;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS company TEXT;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS interest_score INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS interest_level TEXT NOT NULL DEFAULT 'cold';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.leads'::regclass AND conname='leads_interest_range') THEN
   ALTER TABLE public.leads ADD CONSTRAINT leads_interest_range CHECK(interest_score BETWEEN 0 AND 100 AND interest_level IN('cold','warm','hot'));
 END IF;
END $$;
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS action_json JSONB;
CREATE TABLE IF NOT EXISTS public.chat_turn_operations (
 operation_id UUID PRIMARY KEY,visitor_id TEXT NOT NULL,context_version INTEGER NOT NULL CHECK(context_version>=0),
 request_hash TEXT NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','complete')),
 user_message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,assistant_message_id UUID REFERENCES public.messages(id) ON DELETE CASCADE,
 lease_until TIMESTAMPTZ NOT NULL,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
 CHECK((status='pending' AND user_message_id IS NULL AND assistant_message_id IS NULL) OR(status='complete' AND user_message_id IS NOT NULL AND assistant_message_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS chat_operations_expiry ON public.chat_turn_operations(expires_at);
ALTER TABLE public.chat_turn_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_turn_operations FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.chat_claim_turn(p_visitor_id TEXT,p_expires_at BIGINT,p_context_version INTEGER,p_operation_id UUID,p_request_hash TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_version INTEGER;v_row public.chat_turn_operations%ROWTYPE;v_response TEXT;v_action JSONB;
BEGIN
 PERFORM public.chat_context_state(p_visitor_id,p_expires_at);
 SELECT context_version INTO v_version FROM public.chat_context_states WHERE visitor_id=p_visitor_id FOR UPDATE;
 IF v_version IS DISTINCT FROM p_context_version THEN RETURN pg_catalog.jsonb_build_object('error','chat_context_changed');END IF;
 IF p_operation_id IS NULL OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid operation';END IF;
 INSERT INTO public.chat_turn_operations(operation_id,visitor_id,context_version,request_hash,lease_until,expires_at)
   VALUES(p_operation_id,p_visitor_id,p_context_version,p_request_hash,pg_catalog.now()+INTERVAL '90 seconds',pg_catalog.to_timestamp(p_expires_at::DOUBLE PRECISION)) ON CONFLICT DO NOTHING;
 IF FOUND THEN RETURN pg_catalog.jsonb_build_object('status','claimed');END IF;
 SELECT * INTO v_row FROM public.chat_turn_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF v_row.visitor_id IS DISTINCT FROM p_visitor_id OR v_row.context_version IS DISTINCT FROM p_context_version OR v_row.request_hash IS DISTINCT FROM p_request_hash THEN RETURN pg_catalog.jsonb_build_object('error','invalid_request');END IF;
 IF v_row.status='complete' THEN
   SELECT content,action_json INTO v_response,v_action FROM public.messages WHERE id=v_row.assistant_message_id;
   IF v_response IS NULL THEN RAISE EXCEPTION 'Missing completed response';END IF;
   RETURN pg_catalog.jsonb_build_object('status','complete','response',v_response,'action',v_action);
 END IF;
 IF v_row.lease_until>pg_catalog.now() THEN RETURN pg_catalog.jsonb_build_object('error','chat_busy','retry_after',GREATEST(1,LEAST(90,pg_catalog.ceil(EXTRACT(EPOCH FROM(v_row.lease_until-pg_catalog.now())))::INTEGER)));END IF;
 UPDATE public.chat_turn_operations SET lease_until=pg_catalog.now()+INTERVAL '90 seconds' WHERE operation_id=p_operation_id;
 RETURN pg_catalog.jsonb_build_object('status','claimed');
END $$;
CREATE OR REPLACE FUNCTION public.chat_save_turn(p_visitor_id TEXT,p_expires_at BIGINT,p_context_version INTEGER,p_operation_id UUID,p_request_hash TEXT,
 p_user_content TEXT,p_assistant_content TEXT,p_lead JSONB,p_action JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_version INTEGER;v_operation public.chat_turn_operations%ROWTYPE;v_conversation UUID;v_lead UUID;v_user UUID;v_assistant UUID;v_contact BOOLEAN;
BEGIN
 PERFORM public.chat_context_state(p_visitor_id,p_expires_at);
 SELECT context_version INTO v_version FROM public.chat_context_states WHERE visitor_id=p_visitor_id FOR UPDATE;
 IF v_version IS DISTINCT FROM p_context_version THEN RETURN pg_catalog.jsonb_build_object('error','chat_context_changed');END IF;
 IF p_operation_id IS NULL OR p_request_hash IS NULL OR p_request_hash!~'^[a-f0-9]{64}$' OR p_user_content IS NULL OR pg_catalog.length(p_user_content) NOT BETWEEN 1 AND 8000 OR
   p_assistant_content IS NULL OR pg_catalog.octet_length(p_assistant_content) NOT BETWEEN 1 AND 16000 THEN RAISE EXCEPTION 'Invalid turn';END IF;
 SELECT * INTO v_operation FROM public.chat_turn_operations WHERE operation_id=p_operation_id FOR UPDATE;
 IF NOT FOUND OR v_operation.visitor_id IS DISTINCT FROM p_visitor_id OR v_operation.context_version IS DISTINCT FROM p_context_version OR v_operation.request_hash IS DISTINCT FROM p_request_hash THEN RETURN pg_catalog.jsonb_build_object('error','invalid_request');END IF;
 IF v_operation.status='complete' THEN
   IF NOT EXISTS(SELECT 1 FROM public.messages WHERE id=v_operation.user_message_id AND content=p_user_content) THEN RAISE EXCEPTION 'Operation payload changed';END IF;
   RETURN pg_catalog.jsonb_build_object('saved',true,'contextVersion',v_version,'replayed',true);
 END IF;
 IF v_operation.lease_until<pg_catalog.clock_timestamp() THEN RAISE EXCEPTION 'Operation lease expired';END IF;
 IF p_action IS NOT NULL AND (pg_catalog.jsonb_typeof(p_action)<>'object' OR pg_catalog.octet_length(p_action::TEXT)>4096 OR p_action->>'status' NOT IN('confirmation_required','unavailable')) THEN RAISE EXCEPTION 'Invalid action';END IF;
 IF p_lead IS NOT NULL AND (pg_catalog.jsonb_typeof(p_lead)<>'object' OR pg_catalog.octet_length(p_lead::TEXT)>2048 OR
   EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_lead) k WHERE k NOT IN('email','phone','name','company','project_type','budget_mentioned','interest_score','interest_level')) OR
   EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_lead) e WHERE e.key NOT IN('interest_score') AND pg_catalog.jsonb_typeof(e.value) NOT IN('string','null')) OR
   p_lead->>'interest_score' IS NULL OR p_lead->>'interest_score'!~'^[0-9]{1,3}$' OR (p_lead->>'interest_score')::INTEGER NOT BETWEEN 0 AND 100 OR
   p_lead->>'interest_level' IS NULL OR p_lead->>'interest_level' NOT IN('cold','warm','hot')) THEN RAISE EXCEPTION 'Invalid profile';END IF;
 INSERT INTO public.visitors(visitor_id,last_seen,page_views) VALUES(p_visitor_id,pg_catalog.now(),1) ON CONFLICT(visitor_id) DO UPDATE SET last_seen=pg_catalog.now();
 SELECT id INTO v_conversation FROM public.conversations WHERE visitor_id=p_visitor_id AND created_at>=pg_catalog.date_trunc('day',pg_catalog.now()) ORDER BY created_at DESC,id DESC LIMIT 1;
 IF v_conversation IS NULL THEN INSERT INTO public.conversations(visitor_id) VALUES(p_visitor_id) RETURNING id INTO v_conversation;END IF;
 INSERT INTO public.messages(conversation_id,role,content) VALUES(v_conversation,'user',p_user_content) RETURNING id INTO v_user;
 INSERT INTO public.messages(conversation_id,role,content,action_json) VALUES(v_conversation,'assistant',p_assistant_content,p_action) RETURNING id INTO v_assistant;
 UPDATE public.conversations SET updated_at=pg_catalog.now(),message_count=COALESCE(message_count,0)+2 WHERE id=v_conversation;
 IF p_lead IS NOT NULL THEN
   SELECT id INTO v_lead FROM public.leads WHERE visitor_id=p_visitor_id AND COALESCE(source,'web')='web' ORDER BY updated_at DESC,id DESC LIMIT 1;
   IF v_lead IS NULL THEN
     INSERT INTO public.leads(visitor_id,conversation_id,source,email,phone,name,company,project_type,budget_mentioned,interest_score,interest_level)
       VALUES(p_visitor_id,v_conversation,'web',p_lead->>'email',p_lead->>'phone',p_lead->>'name',p_lead->>'company',p_lead->>'project_type',p_lead->>'budget_mentioned',(p_lead->>'interest_score')::INTEGER,p_lead->>'interest_level') RETURNING id INTO v_lead;
   ELSE
     UPDATE public.leads SET conversation_id=v_conversation,updated_at=pg_catalog.now(),email=COALESCE(p_lead->>'email',email),phone=COALESCE(p_lead->>'phone',phone),name=COALESCE(p_lead->>'name',name),company=COALESCE(p_lead->>'company',company),
       project_type=COALESCE(p_lead->>'project_type',project_type),budget_mentioned=COALESCE(p_lead->>'budget_mentioned',budget_mentioned),interest_score=(p_lead->>'interest_score')::INTEGER,interest_level=p_lead->>'interest_level' WHERE id=v_lead;
   END IF;
   -- Reference only: no copy of contact data, model output or conversation in Telegram.
   IF p_lead->>'email' IS NOT NULL OR p_lead->>'phone' IS NOT NULL OR p_lead->>'interest_level'='hot' THEN
     INSERT INTO public.integration_outbox(idempotency_key,channel,payload,visitor_id,context_version)
       VALUES('lead:'||p_operation_id::TEXT||':telegram','telegram',pg_catalog.jsonb_build_object('text','Contacto para revisión en el panel. Referencia: '||v_lead::TEXT),p_visitor_id,v_version) ON CONFLICT(idempotency_key) DO NOTHING;
   END IF;
 END IF;
 UPDATE public.chat_turn_operations SET status='complete',user_message_id=v_user,assistant_message_id=v_assistant WHERE operation_id=p_operation_id;
 RETURN pg_catalog.jsonb_build_object('saved',true,'contextVersion',v_version,'replayed',false);
END $$;
-- Remove the pre-v17 write path: it lacked an operation ID and durable outbox.
CREATE OR REPLACE FUNCTION public.chat_operations_retention(p_limit INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count INTEGER;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid operations retention';END IF;
 DELETE FROM public.chat_turn_operations WHERE operation_id IN(SELECT operation_id FROM public.chat_turn_operations WHERE expires_at<=pg_catalog.now() ORDER BY expires_at,operation_id LIMIT p_limit);
 GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.chat_save_turn(TEXT,BIGINT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC,anon,authenticated,service_role;
DO $acl$ DECLARE v_column RECORD;v_role TEXT;v_function RECORD;
BEGIN
 FOR v_column IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid='public.chat_turn_operations'::regclass AND attnum>0 AND NOT attisdropped LOOP
   EXECUTE pg_catalog.format('REVOKE SELECT (%I),INSERT (%I),UPDATE (%I),REFERENCES (%I) ON public.chat_turn_operations FROM PUBLIC,anon,authenticated,service_role',v_column.attname,v_column.attname,v_column.attname,v_column.attname);
 END LOOP;
 FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF pg_catalog.has_table_privilege(v_role,'public.chat_turn_operations','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR pg_catalog.has_any_column_privilege(v_role,'public.chat_turn_operations','SELECT,INSERT,UPDATE,REFERENCES') THEN RAISE EXCEPTION 'Unexpected operation table grant';END IF;
 END LOOP;
 FOR v_function IN SELECT p.oid,p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN('chat_claim_turn','chat_save_turn','chat_operations_retention') LOOP
   IF v_function.oid NOT IN('public.chat_claim_turn(text,bigint,integer,uuid,text)'::regprocedure,'public.chat_save_turn(text,bigint,integer,uuid,text,text,text,jsonb,jsonb)'::regprocedure,'public.chat_save_turn(text,bigint,integer,text,text,jsonb)'::regprocedure,'public.chat_operations_retention(integer)'::regprocedure) THEN RAISE EXCEPTION 'Unexpected turn RPC overload';END IF;
   IF pg_catalog.pg_has_role('anon',v_function.proowner,'MEMBER') OR pg_catalog.pg_has_role('authenticated',v_function.proowner,'MEMBER') OR pg_catalog.pg_has_role('service_role',v_function.proowner,'MEMBER') THEN RAISE EXCEPTION 'API roles cannot own operation RPC';END IF;
   EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_function.oid::regprocedure);
 END LOOP;
END $acl$;
GRANT EXECUTE ON FUNCTION public.chat_claim_turn(TEXT,BIGINT,INTEGER,UUID,TEXT),public.chat_save_turn(TEXT,BIGINT,INTEGER,UUID,TEXT,TEXT,TEXT,JSONB,JSONB),public.chat_operations_retention(INTEGER) TO service_role;
COMMIT;
