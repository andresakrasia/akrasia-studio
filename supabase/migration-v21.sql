-- The private journey owns the client's lifecycle. Provider queueing never advances it.
-- Existing operation receipts remain replayable and saved messages are preserved.
ALTER TABLE public.email_drafts DROP CONSTRAINT IF EXISTS email_drafts_template_type_check;
ALTER TABLE public.email_drafts ADD CONSTRAINT email_drafts_template_type_check CHECK(template_type IN('evaluation','quote','follow_up','kickoff','progress','delivery','final_delivery','closure','custom'));

CREATE OR REPLACE FUNCTION public.client_journey_project_status(p_stage TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_stage WHEN 'in_production' THEN 'in_production' WHEN 'review' THEN 'post_production' WHEN 'delivered' THEN 'delivered' WHEN 'closed' THEN 'completed' ELSE 'planning' END;
$$;
REVOKE ALL ON FUNCTION public.client_journey_project_status(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.client_journey_project_status(TEXT) TO service_role;

-- Repair earlier edits performed from the project status selector, without changing publication.
UPDATE public.projects p SET status=public.client_journey_project_status(j.stage),client_id=j.client_id
FROM public.client_journeys j WHERE j.project_id=p.id AND (p.status IS DISTINCT FROM public.client_journey_project_status(j.stage) OR p.client_id IS DISTINCT FROM j.client_id);

CREATE OR REPLACE FUNCTION public.client_journey_project_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_journey public.client_journeys%ROWTYPE;
BEGIN
 SELECT * INTO v_journey FROM public.client_journeys WHERE project_id=NEW.id;
 IF FOUND AND (NEW.client_id IS DISTINCT FROM v_journey.client_id OR NEW.status IS DISTINCT FROM public.client_journey_project_status(v_journey.stage)) THEN
   RAISE EXCEPTION 'The linked journey owns the client and production status' USING ERRCODE='PT409';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.client_journey_project_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.client_journey_project_guard() TO service_role;
DROP TRIGGER IF EXISTS client_journey_project_guard ON public.projects;
CREATE TRIGGER client_journey_project_guard BEFORE UPDATE OF status,client_id ON public.projects FOR EACH ROW EXECUTE FUNCTION public.client_journey_project_guard();

CREATE OR REPLACE FUNCTION public.client_journey_task_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_stage TEXT;v_project UUID;
BEGIN
 v_project:=CASE WHEN TG_OP='DELETE' THEN OLD.project_id ELSE NEW.project_id END;
 PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-journey-project:'||v_project::TEXT,0));
 IF TG_OP<>'DELETE' THEN
   IF TG_OP='UPDATE' AND OLD.project_id IS DISTINCT FROM NEW.project_id THEN
     RAISE EXCEPTION 'A production task cannot move between projects' USING ERRCODE='PT409';
   END IF;
   SELECT stage INTO v_stage FROM public.client_journeys WHERE project_id=v_project;
   IF v_stage IN('delivered','closed') AND NEW.status<>'completed' THEN RAISE EXCEPTION 'Reopen the journey before adding pending production work' USING ERRCODE='PT409'; END IF;
   RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.client_journey_task_guard() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.client_journey_task_guard() TO service_role;
DROP TRIGGER IF EXISTS client_journey_task_guard ON public.project_tasks;
CREATE TRIGGER client_journey_task_guard BEFORE INSERT OR UPDATE OR DELETE ON public.project_tasks FOR EACH ROW EXECUTE FUNCTION public.client_journey_task_guard();

CREATE OR REPLACE FUNCTION public.dashboard_update_client_journey(p_id UUID,p_operation UUID,p_changes JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_op public.client_journey_operations%ROWTYPE;v_before public.client_journeys%ROWTYPE;v_after public.client_journeys%ROWTYPE;
  v_payload JSONB:=pg_catalog.jsonb_build_object('id',p_id,'changes',p_changes);v_note TEXT;v_stage TEXT;v_from INTEGER;v_to INTEGER;v_total BIGINT;v_pending BIGINT;v_merged JSONB;
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
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('client-journey-project:'||v_before.project_id::TEXT,0));
  v_stage:=coalesce(p_changes->>'stage',v_before.stage);
  IF v_stage IS DISTINCT FROM v_before.stage THEN
    v_from:=pg_catalog.array_position(ARRAY['received','evaluating','quote_preparation','quote_sent','accepted','in_production','review','delivered','closed','lost'],v_before.stage);
    v_to:=pg_catalog.array_position(ARRAY['received','evaluating','quote_preparation','quote_sent','accepted','in_production','review','delivered','closed','lost'],v_stage);
    IF v_stage='lost' OR v_before.stage='lost' OR v_to<v_from THEN
      IF btrim(v_note)='' THEN RAISE EXCEPTION 'Record a reason for returning or stopping a proposal' USING ERRCODE='PT400'; END IF;
    ELSIF v_to<>v_from+1 THEN RAISE EXCEPTION 'Complete the next stage before continuing' USING ERRCODE='PT400'; END IF;
    v_merged:=pg_catalog.to_jsonb(v_before)||p_changes;
    IF v_stage='quote_sent' AND (v_merged->>'budget_amount' IS NULL OR v_merged->>'budget_currency' !~ '^[A-Z]{3}$' OR btrim(coalesce(v_merged->>'budget_scope',''))='' OR btrim(coalesce(v_merged->>'budget_timing',''))='') THEN RAISE EXCEPTION 'Complete the approved quote before confirming its sending' USING ERRCODE='PT400'; END IF;
    IF v_stage IN('quote_sent','accepted','delivered','closed') AND btrim(v_note)='' THEN RAISE EXCEPTION 'Record the client confirmation or delivery evidence' USING ERRCODE='PT400'; END IF;
    SELECT count(*),count(*) FILTER(WHERE status<>'completed') INTO v_total,v_pending FROM public.project_tasks WHERE project_id=v_before.project_id;
    IF v_stage='in_production' AND v_total<1 THEN RAISE EXCEPTION 'Add a production task before starting' USING ERRCODE='PT400'; END IF;
    IF v_stage IN('delivered','closed') AND v_pending>0 THEN RAISE EXCEPTION 'Complete pending production tasks before delivery or closure' USING ERRCODE='PT400'; END IF;
  END IF;
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
    UPDATE public.projects SET status=public.client_journey_project_status(v_after.stage) WHERE id=v_after.project_id;
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
    p_fields->>'template_type' NOT IN('evaluation','quote','follow_up','kickoff','progress','delivery','final_delivery','closure','custom') THEN RAISE EXCEPTION 'Invalid email draft' USING ERRCODE='PT400'; END IF;
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
REVOKE ALL ON FUNCTION public.dashboard_update_client_journey(UUID,UUID,JSONB),public.dashboard_save_email_draft(UUID,INTEGER,UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_update_client_journey(UUID,UUID,JSONB),public.dashboard_save_email_draft(UUID,INTEGER,UUID,JSONB) TO service_role;
COMMENT ON FUNCTION public.dashboard_update_client_journey(UUID,UUID,JSONB) IS 'Sequential human-confirmed workflow; return/loss requires a reason, quote and delivery need evidence, and project status follows the private journey.';
