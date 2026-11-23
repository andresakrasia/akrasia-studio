-- v26: a CRM a single person can rely on. Apply after v25.
-- 1. One useful Telegram notice per lead (piece type, interest, panel link) instead of
--    a bare reference repeated on every hot message. Still no contact data or chat text.
-- 2. Contacts that arrive outside the chat can be registered by hand and follow the
--    same journey. They are business contacts, outside the chat retention policy.
-- 3. A dated next step on each journey, reminded once by Telegram on its day.
-- No provider is called and no existing row is rewritten by this migration.
BEGIN;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS origin TEXT NOT NULL DEFAULT '';
ALTER TABLE public.client_journeys ADD COLUMN IF NOT EXISTS next_action_date DATE;
ALTER TABLE public.client_journeys ADD COLUMN IF NOT EXISTS next_action_note TEXT NOT NULL DEFAULT '';
DO $checks$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.leads'::regclass AND conname='leads_origin_length') THEN
    ALTER TABLE public.leads ADD CONSTRAINT leads_origin_length CHECK(length(origin)<=80);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.client_journeys'::regclass AND conname='client_journeys_next_action_note') THEN
    ALTER TABLE public.client_journeys ADD CONSTRAINT client_journeys_next_action_note CHECK(length(next_action_note)<=300 AND next_action_note !~ E'[\\r\\n]');
  END IF;
END $checks$;
CREATE INDEX IF NOT EXISTS client_journeys_next_action ON public.client_journeys(next_action_date) WHERE next_action_date IS NOT NULL;
COMMENT ON COLUMN public.leads.origin IS 'Free note on where a manually registered contact came from; empty for chat leads.';
COMMENT ON COLUMN public.client_journeys.next_action_date IS 'Europe/Madrid civil day of the next follow-up; reminded once by the integration worker.';

CREATE OR REPLACE FUNCTION public.client_journey_stage_label(p_stage TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE p_stage WHEN 'received' THEN 'Propuesta recibida' WHEN 'evaluating' THEN 'En evaluación' WHEN 'quote_preparation' THEN 'Preparando presupuesto'
   WHEN 'quote_sent' THEN 'Presupuesto enviado' WHEN 'accepted' THEN 'Presupuesto aceptado' WHEN 'in_production' THEN 'En producción'
   WHEN 'review' THEN 'Revisión del cliente' WHEN 'delivered' THEN 'Entregado' WHEN 'closed' THEN 'Cerrado' ELSE 'No continúa' END;
$$;

-- Manual contacts: source 'manual' and no visitor, so chat erasure and the chat
-- retention batch (both limited to source 'web') never touch them.
CREATE OR REPLACE FUNCTION public.dashboard_create_manual_lead(p_id UUID,p_fields JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.leads%ROWTYPE;v_name TEXT;
  v_text CONSTANT TEXT[]:=ARRAY['name','company','email','phone','project_type','summary','origin'];
BEGIN
  IF p_id IS NULL OR p_fields IS NULL OR pg_catalog.jsonb_typeof(p_fields)<>'object' OR
    EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_fields) k WHERE k<>ALL(v_text)) OR NOT p_fields ?& v_text OR
    EXISTS(SELECT 1 FROM pg_catalog.jsonb_each(p_fields) e WHERE pg_catalog.jsonb_typeof(e.value)<>'string') THEN RAISE EXCEPTION 'Invalid manual contact' USING ERRCODE='PT400'; END IF;
  v_name:=pg_catalog.btrim(p_fields->>'name');
  IF length(v_name) NOT BETWEEN 1 AND 150 OR length(p_fields->>'company')>150 OR length(p_fields->>'email')>254 OR length(p_fields->>'phone')>40 OR
    length(p_fields->>'project_type')>80 OR length(p_fields->>'summary')>8000 OR length(p_fields->>'origin')>80 OR
    (p_fields->>'email'<>'' AND p_fields->>'email' !~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$') OR
    (p_fields->>'name')||(p_fields->>'company')||(p_fields->>'email')||(p_fields->>'phone')||(p_fields->>'project_type')||(p_fields->>'origin') ~ E'[\\r\\n]' THEN RAISE EXCEPTION 'Invalid manual contact' USING ERRCODE='PT400'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('manual-lead:'||p_id::TEXT,0));
  SELECT * INTO v_row FROM public.leads WHERE id=p_id;
  IF FOUND THEN
    -- The same attempt returns its row; the same id with other data is a conflict.
    IF v_row.source IS DISTINCT FROM 'manual' OR v_row.name IS DISTINCT FROM v_name OR COALESCE(v_row.email,'')<>p_fields->>'email' OR
      COALESCE(v_row.phone,'')<>p_fields->>'phone' OR COALESCE(v_row.summary,'')<>p_fields->>'summary' THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='PT409'; END IF;
    RETURN pg_catalog.to_jsonb(v_row);
  END IF;
  INSERT INTO public.leads(id,visitor_id,conversation_id,source,status,name,company,email,phone,project_type,summary,origin,interest_score,interest_level)
    VALUES(p_id,NULL,NULL,'manual','new',v_name,NULLIF(pg_catalog.btrim(p_fields->>'company'),''),NULLIF(pg_catalog.btrim(p_fields->>'email'),''),
      NULLIF(pg_catalog.btrim(p_fields->>'phone'),''),NULLIF(pg_catalog.btrim(p_fields->>'project_type'),''),NULLIF(p_fields->>'summary',''),
      pg_catalog.btrim(p_fields->>'origin'),0,'cold') RETURNING * INTO v_row;
  RETURN pg_catalog.to_jsonb(v_row);
END $$;

CREATE OR REPLACE FUNCTION public.chat_save_turn(p_visitor_id TEXT,p_expires_at BIGINT,p_context_version INTEGER,p_operation_id UUID,p_request_hash TEXT,
 p_user_content TEXT,p_assistant_content TEXT,p_lead JSONB,p_action JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_version INTEGER;v_operation public.chat_turn_operations%ROWTYPE;v_conversation UUID;v_lead UUID;v_user UUID;v_assistant UUID;v_contact BOOLEAN;v_type TEXT;v_level TEXT;
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
   -- One notice per lead and reason, keyed by the lead instead of the turn. It carries
   -- the piece type and interest only: no contact data, model output or conversation.
   -- The worker appends the private panel link from the "panel" reference.
   IF p_lead->>'email' IS NOT NULL OR p_lead->>'phone' IS NOT NULL OR p_lead->>'interest_level'='hot' THEN
     SELECT NULLIF(pg_catalog.btrim(pg_catalog.left(COALESCE(project_type,''),40)),''),interest_level INTO v_type,v_level FROM public.leads WHERE id=v_lead;
     v_contact:=p_lead->>'email' IS NOT NULL OR p_lead->>'phone' IS NOT NULL;
     INSERT INTO public.integration_outbox(idempotency_key,channel,payload,visitor_id,context_version)
       VALUES('lead:'||v_lead::TEXT||CASE WHEN v_contact THEN ':contact' ELSE ':interest' END,'telegram',pg_catalog.jsonb_build_object(
         'text',CASE WHEN v_contact THEN 'Nuevo contacto en el chat' ELSE 'Conversación con interés alto, todavía sin contacto' END
           ||COALESCE(' · '||v_type,'')||' · interés '||CASE v_level WHEN 'hot' THEN 'alto' WHEN 'warm' THEN 'medio' ELSE 'bajo' END||'.',
         'panel','lead:'||v_lead::TEXT),p_visitor_id,v_version) ON CONFLICT(idempotency_key) DO NOTHING;
   END IF;
 END IF;
 UPDATE public.chat_turn_operations SET status='complete',user_message_id=v_user,assistant_message_id=v_assistant WHERE operation_id=p_operation_id;
 RETURN pg_catalog.jsonb_build_object('saved',true,'contextVersion',v_version,'replayed',false);
END $$;

CREATE OR REPLACE FUNCTION public.integration_claim(p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.integration_outbox%ROWTYPE;v_booking public.bookings%ROWTYPE;v_result JSONB:='[]';v_template TEXT;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid worker batch';END IF;
 -- v26: a follow-up date becomes one Telegram reminder on its day, from 09:00 Madrid.
 -- Queued on demand, so changing or clearing a future date needs no cancellation and
 -- the reminder never waits in the queue long enough to hit the retry window.
 INSERT INTO public.integration_outbox(idempotency_key,channel,payload)
   SELECT 'journey:'||j.id::TEXT||':next:'||j.next_action_date::TEXT,'telegram',pg_catalog.jsonb_build_object(
     'text','Próximo paso pendiente hoy · '||public.client_journey_stage_label(j.stage)
       ||CASE WHEN pg_catalog.btrim(j.next_action_note)<>'' THEN ' · '||pg_catalog.btrim(j.next_action_note) ELSE '' END,
     'panel','journey:'||j.id::TEXT)
   FROM public.client_journeys j
   WHERE j.next_action_date IS NOT NULL AND j.stage NOT IN('closed','lost')
     AND j.next_action_date<=(pg_catalog.now() AT TIME ZONE 'Europe/Madrid')::DATE
     AND j.next_action_date>=(pg_catalog.now() AT TIME ZONE 'Europe/Madrid')::DATE-7
     AND (j.next_action_date<(pg_catalog.now() AT TIME ZONE 'Europe/Madrid')::DATE OR (pg_catalog.now() AT TIME ZONE 'Europe/Madrid')::TIME>=TIME '09:00')
   ON CONFLICT(idempotency_key) DO NOTHING;
 UPDATE public.integration_outbox SET status=CASE WHEN channel IN('telegram','booking_telegram') THEN 'uncertain' ELSE 'queued' END,
   error_code='worker_lease_expired',lease_token=NULL,lease_until=NULL,updated_at=pg_catalog.now()
   WHERE status='sending' AND lease_until<=pg_catalog.now();
 -- A reminder may have been queued months ahead. Its retry budget begins on delivery.
 UPDATE public.integration_outbox SET status='failed',error_code='retry_window_expired',updated_at=pg_catalog.now()
   WHERE status='queued' AND (attempts>=5 OR
     COALESCE(first_attempt_at,CASE WHEN payload ? 'reminderHours' THEN available_at ELSE created_at END)<pg_catalog.now()-INTERVAL '20 hours');
 FOR v_row IN SELECT * FROM public.integration_outbox WHERE status='queued' AND available_at<=pg_catalog.now()
   ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit LOOP
   IF v_row.context_version IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.chat_context_states WHERE visitor_id=v_row.visitor_id AND context_version=v_row.context_version) THEN
     UPDATE public.integration_outbox SET status='disabled',payload='{}',delivery_payload=NULL,error_code='context_erased',updated_at=pg_catalog.now() WHERE id=v_row.id;CONTINUE;
   END IF;
   IF v_row.booking_id IS NOT NULL THEN
     SELECT * INTO v_booking FROM public.bookings WHERE id=v_row.booking_id;
     IF NOT FOUND OR v_booking.status<>'confirmed' THEN
       UPDATE public.integration_outbox SET status='disabled',error_code='booking_cancelled',updated_at=pg_catalog.now() WHERE id=v_row.id;CONTINUE;
     END IF;
     IF v_row.payload ? 'reminderHours' AND COALESCE(v_booking.starts_at,(v_booking.booked_date+v_booking.booked_time) AT TIME ZONE 'Europe/Madrid')<=pg_catalog.now() THEN
       UPDATE public.integration_outbox SET status='disabled',error_code='booking_elapsed',updated_at=pg_catalog.now() WHERE id=v_row.id;CONTINUE;
     END IF;
     v_row.payload:=v_row.payload||pg_catalog.jsonb_build_object('id',v_booking.id,'date',v_booking.booked_date,
       'time',pg_catalog.to_char(v_booking.booked_date+v_booking.booked_time,'HH24:MI'),
       'name',v_booking.visitor_name,'email',v_booking.visitor_email,'meetUrl',COALESCE(v_booking.meet_url,''),'createdAt',v_booking.created_at);
   ELSIF v_row.channel='email' THEN
     -- Older draft rows did not carry the type in payload. Resolve the immutable queued draft.
     SELECT template_type INTO v_template FROM public.email_drafts WHERE queue_id=v_row.id;
     IF FOUND THEN v_row.payload:=v_row.payload||pg_catalog.jsonb_build_object('templateType',v_template);END IF;
   END IF;
   UPDATE public.integration_outbox SET status='sending',attempts=attempts+1,first_attempt_at=COALESCE(first_attempt_at,pg_catalog.now()),
     lease_token=pg_catalog.gen_random_uuid(),lease_until=pg_catalog.now()+INTERVAL '120 seconds',updated_at=pg_catalog.now()
     WHERE id=v_row.id RETURNING lease_token,attempts INTO v_row.lease_token,v_row.attempts;
   v_result:=v_result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_row.id,'key',v_row.idempotency_key,'channel',v_row.channel,
     'payload',v_row.payload,'leaseToken',v_row.lease_token,'attempt',v_row.attempts));
 END LOOP;
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.dashboard_update_client_journey(p_id UUID,p_operation UUID,p_changes JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE v_op public.client_journey_operations%ROWTYPE;v_before public.client_journeys%ROWTYPE;v_after public.client_journeys%ROWTYPE;
  v_payload JSONB:=pg_catalog.jsonb_build_object('id',p_id,'changes',p_changes);v_note TEXT;v_stage TEXT;v_from INTEGER;v_to INTEGER;v_total BIGINT;v_pending BIGINT;v_merged JSONB;
BEGIN
  IF p_id IS NULL OR p_operation IS NULL OR p_changes IS NULL OR pg_catalog.jsonb_typeof(p_changes)<>'object' OR p_changes='{}' OR
    EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_changes) k WHERE k NOT IN('stage','note','budget_amount','budget_currency','budget_scope','budget_timing','next_action_date','next_action_note')) THEN RAISE EXCEPTION 'Invalid follow-up change' USING ERRCODE='PT400'; END IF;
  IF (p_changes?'stage' AND (pg_catalog.jsonb_typeof(p_changes->'stage')<>'string' OR p_changes->>'stage' NOT IN('received','evaluating','quote_preparation','quote_sent','accepted','in_production','review','delivered','closed','lost'))) OR
    (p_changes?'note' AND (pg_catalog.jsonb_typeof(p_changes->'note')<>'string' OR length(p_changes->>'note')>4000)) OR
    (p_changes?'budget_scope' AND (pg_catalog.jsonb_typeof(p_changes->'budget_scope')<>'string' OR length(p_changes->>'budget_scope')>8000)) OR
    (p_changes?'budget_timing' AND (pg_catalog.jsonb_typeof(p_changes->'budget_timing')<>'string' OR length(p_changes->>'budget_timing')>1000)) OR
    (p_changes?'budget_currency' AND (pg_catalog.jsonb_typeof(p_changes->'budget_currency')<>'string' OR p_changes->>'budget_currency' !~ '^[A-Z]{3}$')) OR
    (p_changes?'budget_amount' AND pg_catalog.jsonb_typeof(p_changes->'budget_amount') NOT IN('number','null')) OR
    (p_changes?'next_action_note' AND (pg_catalog.jsonb_typeof(p_changes->'next_action_note')<>'string' OR length(p_changes->>'next_action_note')>300 OR (p_changes->>'next_action_note') ~ E'[\\r\\n]')) OR
    (p_changes?'next_action_date' AND pg_catalog.jsonb_typeof(p_changes->'next_action_date') NOT IN('string','null')) OR
    (p_changes->>'next_action_date' IS NOT NULL AND (p_changes->>'next_action_date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
      pg_catalog.to_char(pg_catalog.to_date(p_changes->>'next_action_date','YYYY-MM-DD'),'YYYY-MM-DD')<>p_changes->>'next_action_date')) THEN RAISE EXCEPTION 'Invalid follow-up fields' USING ERRCODE='PT400'; END IF;
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
    next_action_date=CASE WHEN p_changes?'next_action_date' THEN (p_changes->>'next_action_date')::DATE ELSE next_action_date END,
    next_action_note=CASE WHEN p_changes?'next_action_note' THEN pg_catalog.btrim(p_changes->>'next_action_note') ELSE next_action_note END,
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

REVOKE ALL ON FUNCTION public.client_journey_stage_label(TEXT) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.client_journey_stage_label(TEXT) TO service_role;
REVOKE ALL ON FUNCTION public.dashboard_create_manual_lead(UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_create_manual_lead(UUID,JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.chat_save_turn(TEXT,BIGINT,INTEGER,UUID,TEXT,TEXT,TEXT,JSONB,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.chat_save_turn(TEXT,BIGINT,INTEGER,UUID,TEXT,TEXT,TEXT,JSONB,JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.integration_claim(INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.integration_claim(INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.dashboard_update_client_journey(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_update_client_journey(UUID,UUID,JSONB) TO service_role;
COMMENT ON FUNCTION public.dashboard_create_manual_lead(UUID,JSONB) IS 'Idempotent registration of a contact that did not arrive through the chat; never linked to a visitor.';
COMMENT ON FUNCTION public.dashboard_update_client_journey(UUID,UUID,JSONB) IS 'Sequential human-confirmed workflow; return/loss requires a reason, quote and delivery need evidence, project status follows the private journey, and a dated next step may be set or cleared.';
NOTIFY pgrst, 'reload schema';
COMMIT;
