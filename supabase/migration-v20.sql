-- Private client follow-up and saved email drafts. No provider delivery occurs here.
BEGIN;
SELECT pg_catalog.set_config('akrasia.journey_initial_search_path',pg_catalog.current_setting('search_path'),true);
SET LOCAL search_path=pg_catalog;

CREATE TABLE IF NOT EXISTS public.client_journeys (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  lead_id UUID UNIQUE REFERENCES public.leads(id) ON DELETE SET NULL,
  client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  project_id UUID NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE RESTRICT,
  client_name TEXT NOT NULL CHECK(length(client_name) BETWEEN 1 AND 150),
  project_title TEXT NOT NULL CHECK(length(project_title) BETWEEN 1 AND 200),
  brief TEXT NOT NULL DEFAULT '' CHECK(length(brief)<=8000),
  stage TEXT NOT NULL DEFAULT 'received' CHECK(stage IN('received','evaluating','quote_preparation','quote_sent','accepted','in_production','review','delivered','closed','lost')),
  budget_amount NUMERIC(11,2) CHECK(budget_amount>=0 AND budget_amount<=999999999),
  budget_currency TEXT NOT NULL DEFAULT 'EUR' CHECK(budget_currency ~ '^[A-Z]{3}$'),
  budget_scope TEXT NOT NULL DEFAULT '' CHECK(length(budget_scope)<=8000),
  budget_timing TEXT NOT NULL DEFAULT '' CHECK(length(budget_timing)<=1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
CREATE TABLE IF NOT EXISTS public.client_journey_events (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  journey_id UUID NOT NULL REFERENCES public.client_journeys(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK(event_type IN('created','stage_changed','note','quote_updated','email_queued')),
  stage TEXT NOT NULL CHECK(stage IN('received','evaluating','quote_preparation','quote_sent','accepted','in_production','review','delivered','closed','lost')),
  note TEXT NOT NULL DEFAULT '' CHECK(length(note)<=4000),
  metadata JSONB NOT NULL DEFAULT '{}' CHECK(pg_catalog.jsonb_typeof(metadata)='object'),
  operation_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE(operation_id,event_type)
);
CREATE TABLE IF NOT EXISTS public.email_drafts (
  id UUID PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  to_email TEXT NOT NULL DEFAULT '' CHECK(length(to_email)<=254),
  to_name TEXT NOT NULL DEFAULT '' CHECK(length(to_name)<=150),
  subject TEXT NOT NULL DEFAULT '' CHECK(length(subject)<=200 AND subject !~ E'[\\r\\n]'),
  body_text TEXT NOT NULL DEFAULT '' CHECK(length(body_text)<=10000),
  template_type TEXT NOT NULL DEFAULT 'custom' CHECK(template_type IN('evaluation','quote','follow_up','kickoff','delivery','custom')),
  journey_id UUID REFERENCES public.client_journeys(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  client_id UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN('draft','queued')),
  queue_id UUID UNIQUE REFERENCES public.integration_outbox(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  CHECK(status<>'draft' OR queue_id IS NULL)
);
CREATE TABLE IF NOT EXISTS public.client_journey_operations (
  id UUID PRIMARY KEY,
  operation_type TEXT NOT NULL CHECK(operation_type IN('create','update','save_draft','queue_draft')),
  payload JSONB NOT NULL,
  result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS client_journeys_order ON public.client_journeys(updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS client_journeys_client ON public.client_journeys(client_id);
CREATE INDEX IF NOT EXISTS client_journey_events_order ON public.client_journey_events(journey_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS email_drafts_order ON public.email_drafts(updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS email_drafts_journey ON public.email_drafts(journey_id,updated_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS email_drafts_lead ON public.email_drafts(lead_id);
CREATE INDEX IF NOT EXISTS email_drafts_project ON public.email_drafts(project_id);
CREATE INDEX IF NOT EXISTS email_drafts_client ON public.email_drafts(client_id);
DO $private_acl$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['client_journeys','client_journey_events','email_drafts','client_journey_operations'] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE public.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE pg_catalog.format('GRANT SELECT,INSERT,UPDATE,DELETE ON TABLE public.%I TO service_role',t);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS service_only ON public.%I',t);
    EXECUTE pg_catalog.format('CREATE POLICY service_only ON public.%I FOR ALL TO service_role USING(true) WITH CHECK(true)',t);
  END LOOP;
END $private_acl$;

CREATE OR REPLACE FUNCTION public.dashboard_create_client_journey(p_lead_id UUID,p_operation UUID,p_client_name TEXT,p_project_title TEXT,p_brief TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_op public.client_journey_operations%ROWTYPE;v_lead public.leads%ROWTYPE;v_row public.client_journeys%ROWTYPE;
  v_payload JSONB:=pg_catalog.jsonb_build_object('lead_id',p_lead_id,'client_name',p_client_name,'project_title',p_project_title,'brief',p_brief);
  v_client UUID;v_project UUID;
BEGIN
  IF p_lead_id IS NULL OR p_operation IS NULL OR p_client_name IS NULL OR length(btrim(p_client_name)) NOT BETWEEN 1 AND 150 OR
    p_project_title IS NULL OR length(btrim(p_project_title)) NOT BETWEEN 1 AND 200 OR p_brief IS NULL OR length(p_brief)>8000 THEN RAISE EXCEPTION 'Invalid follow-up' USING ERRCODE='PT400'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-journey-operation:'||p_operation::TEXT,0));
  SELECT * INTO v_op FROM public.client_journey_operations WHERE id=p_operation;
  IF FOUND THEN
    IF v_op.operation_type<>'create' OR v_op.payload<>v_payload THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='PT409'; END IF;
    RETURN v_op.result;
  END IF;
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead missing' USING ERRCODE='PT404'; END IF;
  SELECT * INTO v_row FROM public.client_journeys WHERE lead_id=p_lead_id;
  IF NOT FOUND THEN
    INSERT INTO public.clients(name,company,email,phone,notes) VALUES(btrim(p_client_name),v_lead.company,v_lead.email,v_lead.phone,p_brief) RETURNING id INTO v_client;
    v_project:=pg_catalog.gen_random_uuid();
    INSERT INTO public.projects(id,title,slug,type,status,client_id,client_name,description,is_published)
      VALUES(v_project,btrim(p_project_title),'proyecto-'||v_project::TEXT,v_lead.project_type,'planning',v_client,btrim(p_client_name),p_brief,false);
    INSERT INTO public.client_journeys(lead_id,client_id,project_id,client_name,project_title,brief)
      VALUES(p_lead_id,v_client,v_project,btrim(p_client_name),btrim(p_project_title),p_brief) RETURNING * INTO v_row;
    INSERT INTO public.client_journey_events(journey_id,event_type,stage,note,operation_id)
      VALUES(v_row.id,'created',v_row.stage,'Cliente y proyecto creados desde el lead.',p_operation);
  END IF;
  INSERT INTO public.client_journey_operations(id,operation_type,payload,result) VALUES(p_operation,'create',v_payload,pg_catalog.to_jsonb(v_row));
  RETURN pg_catalog.to_jsonb(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.dashboard_update_client_journey(p_id UUID,p_operation UUID,p_changes JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_op public.client_journey_operations%ROWTYPE;v_before public.client_journeys%ROWTYPE;v_after public.client_journeys%ROWTYPE;
  v_payload JSONB:=pg_catalog.jsonb_build_object('id',p_id,'changes',p_changes);v_note TEXT;
BEGIN
  IF p_id IS NULL OR p_operation IS NULL OR p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes)<>'object' OR p_changes='{}' OR
    EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_changes) k WHERE k NOT IN('stage','note','budget_amount','budget_currency','budget_scope','budget_timing')) THEN RAISE EXCEPTION 'Invalid follow-up change' USING ERRCODE='PT400'; END IF;
  IF (p_changes?'stage' AND (pg_catalog.jsonb_typeof(p_changes->'stage')<>'string' OR p_changes->>'stage' NOT IN('received','evaluating','quote_preparation','quote_sent','accepted','in_production','review','delivered','closed','lost'))) OR
    (p_changes?'note' AND (pg_catalog.jsonb_typeof(p_changes->'note')<>'string' OR length(p_changes->>'note')>4000)) OR
    (p_changes?'budget_scope' AND (pg_catalog.jsonb_typeof(p_changes->'budget_scope')<>'string' OR length(p_changes->>'budget_scope')>8000)) OR
    (p_changes?'budget_timing' AND (pg_catalog.jsonb_typeof(p_changes->'budget_timing')<>'string' OR length(p_changes->>'budget_timing')>1000)) OR
    (p_changes?'budget_currency' AND (pg_catalog.jsonb_typeof(p_changes->'budget_currency')<>'string' OR p_changes->>'budget_currency' !~ '^[A-Z]{3}$')) OR
    (p_changes?'budget_amount' AND pg_catalog.jsonb_typeof(p_changes->'budget_amount') NOT IN('number','null')) THEN RAISE EXCEPTION 'Invalid follow-up fields' USING ERRCODE='PT400'; END IF;
  IF p_changes->>'budget_amount' IS NOT NULL AND ((p_changes->>'budget_amount')::NUMERIC<0 OR (p_changes->>'budget_amount')::NUMERIC>999999999 OR
    pg_catalog.round((p_changes->>'budget_amount')::NUMERIC,2)<>(p_changes->>'budget_amount')::NUMERIC) THEN RAISE EXCEPTION 'Invalid quote amount' USING ERRCODE='PT400'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-journey-operation:'||p_operation::TEXT,0));
  SELECT * INTO v_op FROM public.client_journey_operations WHERE id=p_operation;
  IF FOUND THEN
    IF v_op.operation_type<>'update' OR v_op.payload<>v_payload THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='PT409'; END IF;
    RETURN v_op.result;
  END IF;
  SELECT * INTO v_before FROM public.client_journeys WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Follow-up missing' USING ERRCODE='PT404'; END IF;
  v_note:=coalesce(p_changes->>'note','');
  UPDATE public.client_journeys SET
    stage=CASE WHEN p_changes?'stage' THEN p_changes->>'stage' ELSE stage END,
    budget_amount=CASE WHEN p_changes?'budget_amount' THEN (p_changes->>'budget_amount')::NUMERIC ELSE budget_amount END,
    budget_currency=CASE WHEN p_changes?'budget_currency' THEN p_changes->>'budget_currency' ELSE budget_currency END,
    budget_scope=CASE WHEN p_changes?'budget_scope' THEN p_changes->>'budget_scope' ELSE budget_scope END,
    budget_timing=CASE WHEN p_changes?'budget_timing' THEN p_changes->>'budget_timing' ELSE budget_timing END,
    updated_at=pg_catalog.now() WHERE id=p_id RETURNING * INTO v_after;
  IF v_before.stage IS DISTINCT FROM v_after.stage THEN
    INSERT INTO public.client_journey_events(journey_id,event_type,stage,note,metadata,operation_id)
      VALUES(p_id,'stage_changed',v_after.stage,v_note,pg_catalog.jsonb_build_object('from',v_before.stage,'to',v_after.stage),p_operation);
    -- Backward transitions must also undo a previous delivery/completion state.
    -- Pre-production and a lost proposal use the existing planning status;
    -- cancellation remains expressed by the private journey's lost stage.
    UPDATE public.projects SET status=CASE v_after.stage WHEN 'in_production' THEN 'in_production' WHEN 'review' THEN 'post_production' WHEN 'delivered' THEN 'delivered' WHEN 'closed' THEN 'completed' ELSE 'planning' END WHERE id=v_after.project_id;
  ELSIF btrim(v_note)<>'' THEN
    INSERT INTO public.client_journey_events(journey_id,event_type,stage,note,operation_id) VALUES(p_id,'note',v_after.stage,v_note,p_operation);
  END IF;
  IF ROW(v_before.budget_amount,v_before.budget_currency,v_before.budget_scope,v_before.budget_timing) IS DISTINCT FROM ROW(v_after.budget_amount,v_after.budget_currency,v_after.budget_scope,v_after.budget_timing) THEN
    INSERT INTO public.client_journey_events(journey_id,event_type,stage,note,metadata,operation_id)
      VALUES(p_id,'quote_updated',v_after.stage,'Presupuesto actualizado.',pg_catalog.jsonb_build_object('amount',v_after.budget_amount,'currency',v_after.budget_currency,'scope',v_after.budget_scope,'timing',v_after.budget_timing),p_operation);
  END IF;
  INSERT INTO public.client_journey_operations(id,operation_type,payload,result) VALUES(p_operation,'update',v_payload,pg_catalog.to_jsonb(v_after));
  RETURN pg_catalog.to_jsonb(v_after);
END $$;

CREATE OR REPLACE FUNCTION public.dashboard_save_email_draft(p_id UUID,p_revision INTEGER,p_operation UUID,p_fields JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_op public.client_journey_operations%ROWTYPE;v_row public.email_drafts%ROWTYPE;v_journey public.client_journeys%ROWTYPE;
  v_payload JSONB:=pg_catalog.jsonb_build_object('id',p_id,'revision',p_revision,'fields',p_fields);
BEGIN
  IF p_id IS NULL OR p_operation IS NULL OR p_revision IS NULL OR p_revision<0 OR p_fields IS NULL OR pg_catalog.jsonb_typeof(p_fields)<>'object' OR
    EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_fields) k WHERE k NOT IN('to_email','to_name','subject','body_text','template_type','journey_id','lead_id','client_id','project_id')) OR
    NOT p_fields ?& ARRAY['to_email','to_name','subject','body_text','template_type','journey_id','lead_id','client_id','project_id'] OR
    EXISTS(SELECT 1 FROM pg_catalog.unnest(ARRAY['to_email','to_name','subject','body_text','template_type']) k WHERE pg_catalog.jsonb_typeof(p_fields->k)<>'string') OR
    length(p_fields->>'to_email')>254 OR length(p_fields->>'to_name')>150 OR length(p_fields->>'subject')>200 OR (p_fields->>'subject') ~ E'[\\r\\n]' OR length(p_fields->>'body_text')>10000 OR
    p_fields->>'template_type' NOT IN('evaluation','quote','follow_up','kickoff','delivery','custom') THEN RAISE EXCEPTION 'Invalid email draft' USING ERRCODE='PT400'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-journey-operation:'||p_operation::TEXT,0));
  SELECT * INTO v_op FROM public.client_journey_operations WHERE id=p_operation;
  IF FOUND THEN
    IF v_op.operation_type<>'save_draft' OR v_op.payload<>v_payload THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='PT409'; END IF;
    RETURN v_op.result;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-draft:'||p_id::TEXT,0));
  SELECT * INTO v_row FROM public.email_drafts WHERE id=p_id FOR UPDATE;
  IF FOUND AND (v_row.revision<>p_revision OR v_row.status<>'draft') THEN RAISE EXCEPTION 'Draft revision conflict' USING ERRCODE='PT409'; END IF;
  IF NOT FOUND AND p_revision<>0 THEN RAISE EXCEPTION 'Draft missing' USING ERRCODE='PT404'; END IF;
  IF p_fields->>'journey_id' IS NOT NULL THEN
    SELECT * INTO v_journey FROM public.client_journeys WHERE id=(p_fields->>'journey_id')::UUID FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Follow-up missing' USING ERRCODE='PT404'; END IF;
    IF ((p_fields->>'lead_id') IS NOT NULL AND (p_fields->>'lead_id')::UUID IS DISTINCT FROM v_journey.lead_id) OR
      ((p_fields->>'client_id') IS NOT NULL AND (p_fields->>'client_id')::UUID IS DISTINCT FROM v_journey.client_id) OR
      ((p_fields->>'project_id') IS NOT NULL AND (p_fields->>'project_id')::UUID IS DISTINCT FROM v_journey.project_id) THEN RAISE EXCEPTION 'Draft associations conflict' USING ERRCODE='PT409'; END IF;
    p_fields:=p_fields||pg_catalog.jsonb_build_object('lead_id',v_journey.lead_id,'client_id',v_journey.client_id,'project_id',v_journey.project_id);
  END IF;
  INSERT INTO public.email_drafts(id,revision,to_email,to_name,subject,body_text,template_type,journey_id,lead_id,client_id,project_id)
    VALUES(p_id,1,p_fields->>'to_email',p_fields->>'to_name',p_fields->>'subject',p_fields->>'body_text',p_fields->>'template_type',
      (p_fields->>'journey_id')::UUID,(p_fields->>'lead_id')::UUID,(p_fields->>'client_id')::UUID,(p_fields->>'project_id')::UUID)
    ON CONFLICT(id) DO UPDATE SET revision=public.email_drafts.revision+1,to_email=EXCLUDED.to_email,to_name=EXCLUDED.to_name,subject=EXCLUDED.subject,
      body_text=EXCLUDED.body_text,template_type=EXCLUDED.template_type,journey_id=EXCLUDED.journey_id,lead_id=EXCLUDED.lead_id,client_id=EXCLUDED.client_id,project_id=EXCLUDED.project_id,updated_at=pg_catalog.now()
    RETURNING * INTO v_row;
  INSERT INTO public.client_journey_operations(id,operation_type,payload,result) VALUES(p_operation,'save_draft',v_payload,pg_catalog.to_jsonb(v_row));
  RETURN pg_catalog.to_jsonb(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.dashboard_queue_email_draft(p_id UUID,p_revision INTEGER,p_operation UUID)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_op public.client_journey_operations%ROWTYPE;v_row public.email_drafts%ROWTYPE;v_journey public.client_journeys%ROWTYPE;
  v_payload JSONB:=pg_catalog.jsonb_build_object('id',p_id,'revision',p_revision);v_email JSONB;v_queued JSONB;v_result JSONB;v_html TEXT;v_visitor TEXT;v_status TEXT;
BEGIN
  IF p_id IS NULL OR p_operation IS NULL OR p_revision IS NULL OR p_revision<1 THEN RAISE EXCEPTION 'Invalid draft send' USING ERRCODE='PT400'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-journey-operation:'||p_operation::TEXT,0));
  SELECT * INTO v_op FROM public.client_journey_operations WHERE id=p_operation;
  IF FOUND THEN
    IF v_op.operation_type<>'queue_draft' OR v_op.payload<>v_payload THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='PT409'; END IF;
    RETURN v_op.result;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('email-draft:'||p_id::TEXT,0));
  SELECT * INTO v_row FROM public.email_drafts WHERE id=p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft missing' USING ERRCODE='PT404'; END IF;
  IF v_row.revision<>p_revision THEN RAISE EXCEPTION 'Draft revision conflict' USING ERRCODE='PT409'; END IF;
  IF v_row.status='draft' THEN
    IF v_row.to_email !~ '^[A-Za-z0-9.!#$%&''*+/=?^_`{|}~-]+@[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+$' OR
      btrim(v_row.subject)='' OR btrim(v_row.body_text)='' OR (v_row.subject||v_row.body_text) ~ '\{\{[^}]+\}\}|\[[^]\n]{1,120}\]' THEN RAISE EXCEPTION 'Complete and review the email draft' USING ERRCODE='PT400'; END IF;
    v_html:='<div style="font-family:Arial,sans-serif;line-height:1.6;color:#222">'||pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(v_row.body_text,'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;'),E'\n','<br>')||'</div>';
    v_email:=pg_catalog.jsonb_build_object('to',v_row.to_email,'toName',v_row.to_name,'subject',v_row.subject,'bodyText',v_row.body_text,'bodyHtml',v_html);
    IF pg_catalog.octet_length(v_email::TEXT)>24576 THEN RAISE EXCEPTION 'Email too long' USING ERRCODE='PT400'; END IF;
    SELECT visitor_id INTO v_visitor FROM public.leads WHERE id=v_row.lead_id;
    v_queued:=public.integration_enqueue('email-draft:'||v_row.id::TEXT||':'||v_row.revision::TEXT,'email',v_email,v_visitor,NULL);
    UPDATE public.email_drafts SET status='queued',queue_id=(v_queued->>'id')::UUID,updated_at=pg_catalog.now() WHERE id=p_id RETURNING * INTO v_row;
    UPDATE public.sent_emails SET template_type=v_row.template_type,lead_id=v_row.lead_id WHERE operation_id=v_row.queue_id;
    IF v_row.journey_id IS NOT NULL THEN
      SELECT * INTO v_journey FROM public.client_journeys WHERE id=v_row.journey_id;
      INSERT INTO public.client_journey_events(journey_id,event_type,stage,note,metadata,operation_id)
        VALUES(v_row.journey_id,'email_queued',v_journey.stage,'Email preparado para envío.',pg_catalog.jsonb_build_object('draft_id',v_row.id,'queue_id',v_row.queue_id,'subject',v_row.subject,'template_type',v_row.template_type),p_operation);
    END IF;
  END IF;
  SELECT status INTO v_status FROM public.sent_emails WHERE operation_id=v_row.queue_id;
  v_result:=pg_catalog.to_jsonb(v_row)||pg_catalog.jsonb_build_object('provider_status',v_status);
  INSERT INTO public.client_journey_operations(id,operation_type,payload,result) VALUES(p_operation,'queue_draft',v_payload,v_result);
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.dashboard_create_client_journey(UUID,UUID,TEXT,TEXT,TEXT) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dashboard_update_client_journey(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dashboard_save_email_draft(UUID,INTEGER,UUID,JSONB) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.dashboard_queue_email_draft(UUID,INTEGER,UUID) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_create_client_journey(UUID,UUID,TEXT,TEXT,TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_update_client_journey(UUID,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_save_email_draft(UUID,INTEGER,UUID,JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_queue_email_draft(UUID,INTEGER,UUID) TO service_role;

-- Operation receipts contain copies of draft text, so include them in the
-- existing bounded server maintenance. CRM records and saved drafts retain
-- their independent business purpose; chat lead erasure only unlinks the FK.
CREATE OR REPLACE FUNCTION public.client_journey_operations_retention(p_limit INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid retention'; END IF;
  DELETE FROM public.client_journey_operations WHERE id IN (
    SELECT id FROM public.client_journey_operations WHERE created_at<pg_catalog.now()-INTERVAL '30 days'
    ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;
CREATE OR REPLACE FUNCTION public.production_retention_batch(p_chat_days INTEGER,p_profile_days INTEGER,p_notification_days INTEGER,p_batch_size INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB;v_outbox INTEGER:=0;v_operations INTEGER:=0;v_ai INTEGER:=0;v_journey INTEGER:=0;
BEGIN
  v_result:=public.chat_retention_batch(p_chat_days,p_profile_days,p_notification_days,p_batch_size);
  IF coalesce((v_result->>'deferred')::BOOLEAN,false) THEN RETURN v_result||pg_catalog.jsonb_build_object('outbox',0,'chat_operations',0,'dashboard_operations',0,'client_journey_operations',0); END IF;
  v_outbox:=public.integration_retention(p_notification_days,p_batch_size);
  v_operations:=public.chat_operations_retention(p_batch_size);
  DELETE FROM public.dashboard_ai_operations WHERE id IN (
    SELECT id FROM public.dashboard_ai_operations WHERE created_at<pg_catalog.now()-INTERVAL '30 days'
    ORDER BY created_at,id LIMIT p_batch_size FOR UPDATE SKIP LOCKED);
  GET DIAGNOSTICS v_ai=ROW_COUNT;
  v_journey:=public.client_journey_operations_retention(p_batch_size);
  RETURN v_result||pg_catalog.jsonb_build_object('outbox',v_outbox,'chat_operations',v_operations,'dashboard_operations',v_ai,'client_journey_operations',v_journey);
END $$;
REVOKE ALL ON FUNCTION public.client_journey_operations_retention(INTEGER),public.production_retention_batch(INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.client_journey_operations_retention(INTEGER),public.production_retention_batch(INTEGER,INTEGER,INTEGER,INTEGER) TO service_role;
COMMENT ON TABLE public.client_journeys IS 'Private lifecycle from lead to project. Creating or advancing a journey never publishes its project or sends email.';
COMMENT ON TABLE public.email_drafts IS 'Saved drafts with optimistic revision control; queued means integration queued, never delivered.';
NOTIFY pgrst,'reload schema';
SELECT pg_catalog.set_config('search_path',pg_catalog.current_setting('akrasia.journey_initial_search_path'),true);
COMMIT;
