-- A11-A15/A27: atomic Madrid agenda and durable bounded integration outbox.
-- Apply after v14. Existing invalid/overlapping bookings stop this migration;
-- review them manually. No real row is deleted or silently corrected here.
BEGIN;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS context_version INTEGER;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS operation_id UUID;
ALTER TABLE public.sent_emails ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT pg_catalog.now();
ALTER TABLE public.sent_emails DROP CONSTRAINT IF EXISTS sent_emails_status_check;
ALTER TABLE public.sent_emails ADD CONSTRAINT sent_emails_status_check CHECK(status IN('draft','sent','failed','queued','accepted','uncertain','disabled'));
CREATE UNIQUE INDEX IF NOT EXISTS sent_emails_operation ON public.sent_emails(operation_id) WHERE operation_id IS NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.bookings'::regclass AND conname='bookings_valid_interval') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_valid_interval CHECK(duration_min IS NOT NULL AND duration_min BETWEEN 1 AND 240
      AND buffer_min IS NOT NULL AND buffer_min BETWEEN 0 AND 120 AND booked_time < '24:00'::TIME
      AND EXTRACT(SECOND FROM booked_time)=0 AND booked_date BETWEEN '2000-01-01'::DATE AND '2199-12-31'::DATE);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid='public.bookings'::regclass AND conname='bookings_no_overlap') THEN
    ALTER TABLE public.bookings ADD CONSTRAINT bookings_no_overlap EXCLUDE USING gist
      (pg_catalog.tsrange(booked_date + booked_time, booked_date + booked_time + pg_catalog.make_interval(mins => duration_min + buffer_min),'[)') WITH &&)
      WHERE(status IN('pending','confirmed'));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.integration_outbox (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(), idempotency_key TEXT NOT NULL UNIQUE CHECK(pg_catalog.length(idempotency_key) BETWEEN 1 AND 200),
  channel TEXT NOT NULL CHECK(channel IN('email','telegram','booking_email','booking_telegram')),
  payload JSONB NOT NULL CHECK(pg_catalog.jsonb_typeof(payload)='object' AND pg_catalog.octet_length(payload::TEXT)<=24576),
  visitor_id TEXT, context_version INTEGER, booking_id UUID REFERENCES public.bookings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN('queued','sending','accepted','failed','uncertain','disabled')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5), available_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  lease_token UUID, lease_until TIMESTAMPTZ, provider_id TEXT, error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);
CREATE INDEX IF NOT EXISTS integration_outbox_due ON public.integration_outbox(available_at,created_at) WHERE status='queued';
ALTER TABLE public.integration_outbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.integration_outbox FROM PUBLIC,anon,authenticated,service_role;
-- New bookings can only enter through RPCs. Admin reads and status changes stay explicit.
REVOKE INSERT, UPDATE ON public.bookings FROM service_role;
GRANT UPDATE(status,updated_at,privacy_retention_until) ON public.bookings TO service_role;

CREATE OR REPLACE FUNCTION public.booking_available(p_date DATE,p_time TIME)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_start TIMESTAMP; v_end TIMESTAMP; v_instant TIMESTAMPTZ; v_dow INTEGER;
BEGIN
  IF p_date IS NULL OR p_time IS NULL OR p_date NOT BETWEEN '2000-01-01'::DATE AND '2199-12-31'::DATE
    OR p_time >= '24:00'::TIME OR EXTRACT(SECOND FROM p_time)<>0 THEN RETURN false; END IF;
  v_start := p_date+p_time; v_end := v_start+INTERVAL '30 minutes';
  v_instant := v_start AT TIME ZONE 'Europe/Madrid';
  -- Gap or repeated clock hour: neither is offered without an explicit offset.
  IF v_instant AT TIME ZONE 'Europe/Madrid' <> v_start OR
    (v_instant-INTERVAL '1 hour') AT TIME ZONE 'Europe/Madrid'=v_start OR
    (v_instant+INTERVAL '1 hour') AT TIME ZONE 'Europe/Madrid'=v_start OR
    v_instant <= pg_catalog.clock_timestamp() OR p_date > (pg_catalog.clock_timestamp() AT TIME ZONE 'Europe/Madrid')::DATE+180 THEN RETURN false; END IF;
  -- A malformed admin row closes the agenda rather than being silently skipped.
  IF EXISTS(SELECT 1 FROM public.availability WHERE is_active AND (day_of_week IS NULL OR day_of_week NOT BETWEEN 0 AND 6 OR
    end_time<=start_time OR end_time>='24:00'::TIME OR EXTRACT(SECOND FROM start_time)<>0 OR EXTRACT(SECOND FROM end_time)<>0)) OR
    EXISTS(SELECT 1 FROM public.availability_overrides WHERE override_date=p_date AND (is_available IS NULL OR
      (start_time IS NULL)<>(end_time IS NULL) OR (start_time IS NOT NULL AND (end_time<=start_time OR end_time>='24:00'::TIME OR
      EXTRACT(SECOND FROM start_time)<>0 OR EXTRACT(SECOND FROM end_time)<>0)))) THEN RAISE EXCEPTION 'Invalid agenda'; END IF;
  IF EXISTS(SELECT 1 FROM public.availability_overrides WHERE override_date=p_date AND NOT is_available AND
    (start_time IS NULL OR pg_catalog.tsrange(p_date+start_time,p_date+end_time,'[)') && pg_catalog.tsrange(v_start,v_end,'[)'))) THEN RETURN false; END IF;
  v_dow := EXTRACT(DOW FROM p_date)::INTEGER;
  IF NOT EXISTS(SELECT 1 FROM public.availability WHERE is_active AND day_of_week=v_dow AND p_time>=start_time AND v_end<=p_date+end_time)
    AND NOT EXISTS(SELECT 1 FROM public.availability_overrides WHERE override_date=p_date AND is_available AND
      ((start_time IS NULL AND v_end<=p_date+1) OR (p_time>=start_time AND v_end<=p_date+end_time))) THEN RETURN false; END IF;
  RETURN NOT EXISTS(SELECT 1 FROM public.bookings WHERE status IN('pending','confirmed') AND
    pg_catalog.tsrange(booked_date+booked_time,booked_date+booked_time+pg_catalog.make_interval(mins=>duration_min+buffer_min),'[)') &&
    pg_catalog.tsrange(v_start,v_end+INTERVAL '30 minutes','[)'));
END $$;
CREATE OR REPLACE FUNCTION public.booking_slots(p_date DATE,p_count INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_date DATE; v_time TIME; v_result JSONB:='[]'::JSONB; v_day INTEGER; v_min INTEGER;
BEGIN
  IF p_date IS NULL OR p_count IS NULL OR p_count NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid slots query'; END IF;
  FOR v_day IN 0..13 LOOP
    v_date:=p_date+v_day;
    -- One authoritative function for both display and insertion; no alternate windows.
    FOR v_min IN 0..47 LOOP
      v_time:='00:00'::TIME+pg_catalog.make_interval(mins=>v_min*30);
      IF public.booking_available(v_date,v_time) THEN
        v_result:=v_result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('date',v_date::TEXT,'time',pg_catalog.to_char(v_date+v_time,'HH24:MI')));
        IF pg_catalog.jsonb_array_length(v_result)>=p_count THEN RETURN v_result; END IF;
      END IF;
    END LOOP;
  END LOOP;
  RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.booking_guard()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(724612083943::BIGINT);
  IF TG_OP='INSERT' OR (NEW.booked_date,NEW.booked_time,NEW.duration_min,NEW.buffer_min,NEW.status)
    IS DISTINCT FROM (OLD.booked_date,OLD.booked_time,OLD.duration_min,OLD.buffer_min,OLD.status) THEN
    IF NEW.status IN('pending','confirmed') THEN
      IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Create a new proposal to reschedule or reactivate'; END IF;
      IF NEW.duration_min<>30 OR NEW.buffer_min<>30 OR NOT public.booking_available(NEW.booked_date,NEW.booked_time) THEN RAISE EXCEPTION 'Slot unavailable' USING ERRCODE='23P01'; END IF;
    END IF;
  END IF;
  NEW.starts_at:=(NEW.booked_date+NEW.booked_time) AT TIME ZONE 'Europe/Madrid'; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS bookings_guard ON public.bookings;
CREATE TRIGGER bookings_guard BEFORE INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.booking_guard();
CREATE OR REPLACE FUNCTION public.booking_create_once(p_visitor_id TEXT,p_expires_at BIGINT,p_context_version INTEGER,p_booking JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_version INTEGER; v_booking public.bookings%ROWTYPE; v_id UUID; v_date DATE; v_time TIME;
BEGIN
  PERFORM public.chat_context_state(p_visitor_id,p_expires_at);
  SELECT context_version INTO v_version FROM public.chat_context_states WHERE visitor_id=p_visitor_id FOR UPDATE;
  IF p_context_version IS NULL OR p_context_version<>v_version THEN RETURN pg_catalog.jsonb_build_object('error','chat_context_changed'); END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(724612083943::BIGINT);
  IF p_booking IS NULL OR pg_catalog.jsonb_typeof(p_booking)<>'object' OR pg_catalog.octet_length(p_booking::TEXT)>4096 OR
    p_booking->>'visitor_id' IS DISTINCT FROM p_visitor_id OR p_booking->>'duration_min' IS DISTINCT FROM '30' OR p_booking->>'buffer_min' IS DISTINCT FROM '30' OR
    EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_booking) k WHERE k NOT IN('id','visitor_id','conversation_id','lead_id','booked_date','booked_time','duration_min','buffer_min','meet_url','visitor_email','visitor_phone','visitor_name','notes')) OR
    p_booking->>'booked_date' !~ '^20[0-9]{2}-[0-9]{2}-[0-9]{2}$' OR p_booking->>'booked_time' !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' OR
    pg_catalog.length(COALESCE(p_booking->>'visitor_name',''))>150 OR pg_catalog.length(COALESCE(p_booking->>'visitor_phone',''))>64 OR
    pg_catalog.length(COALESCE(p_booking->>'visitor_email',''))>254 OR pg_catalog.length(COALESCE(p_booking->>'notes',''))>1000 OR
    (COALESCE(p_booking->>'meet_url','')<>'' AND (p_booking->>'meet_url' !~ '^https://' OR pg_catalog.length(p_booking->>'meet_url')>1024)) THEN RAISE EXCEPTION 'Invalid booking'; END IF;
  v_id:=(p_booking->>'id')::UUID; v_date:=(p_booking->>'booked_date')::DATE; v_time:=(p_booking->>'booked_time')::TIME;
  IF v_id IS NULL OR v_date IS NULL OR v_time IS NULL THEN RAISE EXCEPTION 'Missing booking key'; END IF;
  IF p_booking->>'conversation_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=(p_booking->>'conversation_id')::UUID AND visitor_id=p_visitor_id)
    OR p_booking->>'lead_id' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.leads WHERE id=(p_booking->>'lead_id')::UUID AND visitor_id=p_visitor_id) THEN RETURN pg_catalog.jsonb_build_object('error','invalid_reference'); END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id=v_id;
  IF FOUND THEN
    IF v_booking.visitor_id IS DISTINCT FROM p_visitor_id OR v_booking.booked_date IS DISTINCT FROM v_date OR v_booking.booked_time IS DISTINCT FROM v_time OR
      v_booking.visitor_email IS DISTINCT FROM p_booking->>'visitor_email' OR v_booking.visitor_name IS DISTINCT FROM p_booking->>'visitor_name' OR
      v_booking.visitor_phone IS DISTINCT FROM p_booking->>'visitor_phone' OR v_booking.conversation_id IS DISTINCT FROM (p_booking->>'conversation_id')::UUID OR
      v_booking.lead_id IS DISTINCT FROM (p_booking->>'lead_id')::UUID THEN RAISE EXCEPTION 'Idempotency conflict'; END IF;
    RETURN pg_catalog.jsonb_build_object('created',false,'booking',pg_catalog.to_jsonb(v_booking));
  END IF;
  IF NOT public.booking_available(v_date,v_time) THEN RETURN pg_catalog.jsonb_build_object('created',false,'booking',NULL); END IF;
  INSERT INTO public.visitors(visitor_id) VALUES(p_visitor_id) ON CONFLICT(visitor_id) DO NOTHING;
  BEGIN
    INSERT INTO public.bookings(id,visitor_id,conversation_id,lead_id,booked_date,booked_time,duration_min,buffer_min,status,meet_url,visitor_email,visitor_phone,visitor_name,notes,context_version)
      VALUES(v_id,p_visitor_id,(p_booking->>'conversation_id')::UUID,(p_booking->>'lead_id')::UUID,v_date,v_time,30,30,'confirmed',COALESCE(p_booking->>'meet_url',''),
        p_booking->>'visitor_email',p_booking->>'visitor_phone',p_booking->>'visitor_name',p_booking->>'notes',v_version) RETURNING * INTO v_booking;
  EXCEPTION WHEN exclusion_violation THEN RETURN pg_catalog.jsonb_build_object('created',false,'booking',NULL); END;
  INSERT INTO public.integration_outbox(idempotency_key,channel,payload,booking_id,visitor_id)
    VALUES('booking:'||v_id::TEXT||':telegram','booking_telegram','{}',v_id,p_visitor_id);
  IF v_booking.visitor_email IS NOT NULL THEN
    INSERT INTO public.integration_outbox(idempotency_key,channel,payload,booking_id,visitor_id)
      VALUES('booking:'||v_id::TEXT||':email','booking_email','{}',v_id,p_visitor_id);
  END IF;
  RETURN pg_catalog.jsonb_build_object('created',true,'booking',pg_catalog.to_jsonb(v_booking));
END $$;
-- Close the old A09 RPC path, which otherwise bypasses durable notification creation.
CREATE OR REPLACE FUNCTION public.chat_insert_booking(p_visitor_id TEXT,p_expires_at BIGINT,p_context_version INTEGER,p_booking JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN RETURN public.booking_create_once(p_visitor_id,p_expires_at,p_context_version,p_booking); END $$;
CREATE OR REPLACE FUNCTION public.booking_owned_action(p_visitor_id TEXT,p_booking_id UUID,p_action TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_booking public.bookings%ROWTYPE;
BEGIN
  IF p_action IS NULL OR p_action NOT IN('get','cancel') THEN RAISE EXCEPTION 'Invalid action'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(724612083943::BIGINT);
  SELECT * INTO v_booking FROM public.bookings WHERE id=p_booking_id AND visitor_id=p_visitor_id FOR UPDATE;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error','invalid_reference'); END IF;
  IF p_action='cancel' AND v_booking.status IN('pending','confirmed') THEN
    UPDATE public.bookings SET status='cancelled',updated_at=pg_catalog.now() WHERE id=p_booking_id RETURNING * INTO v_booking;
    UPDATE public.integration_outbox SET status='disabled',error_code='booking_cancelled',updated_at=pg_catalog.now() WHERE booking_id=p_booking_id AND status='queued';
  END IF;
  RETURN pg_catalog.jsonb_build_object('id',v_booking.id,'booked_date',v_booking.booked_date,'booked_time',v_booking.booked_time,'duration_min',v_booking.duration_min,'status',v_booking.status,'meet_url',v_booking.meet_url);
END $$;
CREATE OR REPLACE FUNCTION public.booking_admin_status(p_id UUID,p_status TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_booking public.bookings%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN('cancelled','completed') THEN RAISE EXCEPTION 'Invalid booking status'; END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(724612083943::BIGINT);
  UPDATE public.bookings SET status=p_status,updated_at=pg_catalog.now() WHERE id=p_id RETURNING * INTO v_booking;
  IF NOT FOUND THEN RETURN pg_catalog.jsonb_build_object('error','not_found'); END IF;
  UPDATE public.integration_outbox SET status='disabled',error_code='booking_inactive',updated_at=pg_catalog.now() WHERE booking_id=p_id AND status='queued';
  RETURN pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_booking));
END $$;
CREATE OR REPLACE FUNCTION public.booking_schedule_lock()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN PERFORM pg_catalog.pg_advisory_xact_lock(724612083943::BIGINT); RETURN NULL; END $$;
DROP TRIGGER IF EXISTS availability_schedule_lock ON public.availability;
CREATE TRIGGER availability_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.availability FOR EACH STATEMENT EXECUTE FUNCTION public.booking_schedule_lock();
DROP TRIGGER IF EXISTS overrides_schedule_lock ON public.availability_overrides;
CREATE TRIGGER overrides_schedule_lock BEFORE INSERT OR UPDATE OR DELETE ON public.availability_overrides FOR EACH STATEMENT EXECUTE FUNCTION public.booking_schedule_lock();
CREATE OR REPLACE FUNCTION public.integration_enqueue(p_key TEXT,p_channel TEXT,p_payload JSONB,p_visitor_id TEXT DEFAULT NULL,p_context_version INTEGER DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.integration_outbox%ROWTYPE; v_version INTEGER;
BEGIN
  IF p_key IS NULL OR pg_catalog.length(p_key) NOT BETWEEN 1 AND 200 OR p_channel IS NULL OR p_channel NOT IN('email','telegram') OR
    p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload)<>'object' OR pg_catalog.octet_length(p_payload::TEXT)>24576 THEN RAISE EXCEPTION 'Invalid integration'; END IF;
  IF p_context_version IS NOT NULL THEN
    SELECT context_version INTO v_version FROM public.chat_context_states WHERE visitor_id=p_visitor_id FOR UPDATE;
    IF v_version IS DISTINCT FROM p_context_version THEN RETURN pg_catalog.jsonb_build_object('error','chat_context_changed'); END IF;
  END IF;
  INSERT INTO public.integration_outbox(idempotency_key,channel,payload,visitor_id,context_version)
    VALUES(p_key,p_channel,p_payload,p_visitor_id,p_context_version) ON CONFLICT(idempotency_key) DO NOTHING;
  SELECT * INTO v_row FROM public.integration_outbox WHERE idempotency_key=p_key;
  IF v_row.channel IS DISTINCT FROM p_channel OR v_row.payload IS DISTINCT FROM p_payload OR v_row.visitor_id IS DISTINCT FROM p_visitor_id THEN RAISE EXCEPTION 'Idempotency conflict'; END IF;
  IF p_channel='email' THEN
    INSERT INTO public.sent_emails(operation_id,visitor_id,to_email,to_name,subject,body_text,body_html,template_type,status)
      VALUES(v_row.id,p_visitor_id,p_payload->>'to',p_payload->>'toName',p_payload->>'subject',p_payload->>'bodyText',p_payload->>'bodyHtml','custom','queued') ON CONFLICT DO NOTHING;
  END IF;
  RETURN pg_catalog.jsonb_build_object('id',v_row.id,'status',v_row.status);
END $$;
CREATE OR REPLACE FUNCTION public.integration_claim(p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.integration_outbox%ROWTYPE; v_booking public.bookings%ROWTYPE; v_result JSONB:='[]';
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid worker batch'; END IF;
  -- A process crash after a non-idempotent Telegram send must never resend.
  UPDATE public.integration_outbox SET status=CASE WHEN channel IN('telegram','booking_telegram') THEN 'uncertain' ELSE 'queued' END,
    error_code='worker_lease_expired',lease_token=NULL,lease_until=NULL,updated_at=pg_catalog.now()
    WHERE status='sending' AND lease_until<=pg_catalog.now();
  UPDATE public.integration_outbox SET status='failed',error_code='retry_window_expired',updated_at=pg_catalog.now()
    WHERE status='queued' AND (attempts>=5 OR created_at<pg_catalog.now()-INTERVAL '20 hours');
  FOR v_row IN SELECT * FROM public.integration_outbox WHERE status='queued' AND available_at<=pg_catalog.now()
    ORDER BY available_at,created_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit LOOP
    IF v_row.context_version IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.chat_context_states WHERE visitor_id=v_row.visitor_id AND context_version=v_row.context_version) THEN
      UPDATE public.integration_outbox SET status='disabled',payload='{}',error_code='context_erased',updated_at=pg_catalog.now() WHERE id=v_row.id; CONTINUE;
    END IF;
    IF v_row.booking_id IS NOT NULL THEN
      SELECT * INTO v_booking FROM public.bookings WHERE id=v_row.booking_id;
      IF NOT FOUND OR v_booking.status<>'confirmed' THEN UPDATE public.integration_outbox SET status='disabled',error_code='booking_cancelled',updated_at=pg_catalog.now() WHERE id=v_row.id; CONTINUE; END IF;
      v_row.payload:=pg_catalog.jsonb_build_object('id',v_booking.id,'date',v_booking.booked_date,'time',pg_catalog.to_char(v_booking.booked_date+v_booking.booked_time,'HH24:MI'),
        'name',v_booking.visitor_name,'email',v_booking.visitor_email,'meetUrl',COALESCE(v_booking.meet_url,''));
    END IF;
    UPDATE public.integration_outbox SET status='sending',attempts=attempts+1,lease_token=pg_catalog.gen_random_uuid(),lease_until=pg_catalog.now()+INTERVAL '120 seconds',updated_at=pg_catalog.now()
      WHERE id=v_row.id RETURNING lease_token,attempts INTO v_row.lease_token,v_row.attempts;
    v_result:=v_result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id',v_row.id,'key',v_row.idempotency_key,'channel',v_row.channel,'payload',v_row.payload,'leaseToken',v_row.lease_token,'attempt',v_row.attempts));
  END LOOP;
  RETURN v_result;
END $$;
CREATE OR REPLACE FUNCTION public.integration_finish(p_id UUID,p_token UUID,p_status TEXT,p_provider_id TEXT,p_error TEXT,p_retry_seconds INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.integration_outbox%ROWTYPE;
BEGIN
  IF p_status IS NULL OR p_status NOT IN('queued','accepted','failed','uncertain','disabled') OR p_retry_seconds IS NULL OR p_retry_seconds NOT BETWEEN 0 AND 7200
    OR pg_catalog.length(COALESCE(p_provider_id,''))>200 OR pg_catalog.length(COALESCE(p_error,''))>100 THEN RAISE EXCEPTION 'Invalid worker result'; END IF;
  SELECT * INTO v_row FROM public.integration_outbox WHERE id=p_id AND status='sending' AND lease_token=p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Worker lease lost'; END IF;
  IF p_status='queued' AND (v_row.attempts>=5 OR v_row.created_at<pg_catalog.now()-INTERVAL '20 hours') THEN p_status:='failed'; END IF;
  UPDATE public.integration_outbox SET status=p_status,provider_id=p_provider_id,error_code=p_error,
    available_at=pg_catalog.now()+pg_catalog.make_interval(secs=>p_retry_seconds),lease_token=NULL,lease_until=NULL,updated_at=pg_catalog.now() WHERE id=p_id;
  IF v_row.channel IN('email','booking_email') THEN
    IF v_row.channel='booking_email' THEN
      INSERT INTO public.sent_emails(operation_id,visitor_id,to_email,subject,template_type,status,resend_id)
        SELECT p_id,b.visitor_id,b.visitor_email,'Confirmación de reserva','booking',p_status,p_provider_id FROM public.bookings b WHERE b.id=v_row.booking_id ON CONFLICT DO NOTHING;
    END IF;
    UPDATE public.sent_emails SET status=p_status,resend_id=p_provider_id,updated_at=pg_catalog.now() WHERE operation_id=p_id;
  END IF;
  RETURN pg_catalog.jsonb_build_object('saved',true);
END $$;
CREATE OR REPLACE FUNCTION public.integration_retention(p_days INTEGER,p_limit INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 730 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid retention'; END IF;
  DELETE FROM public.integration_outbox WHERE id IN(SELECT id FROM public.integration_outbox WHERE status NOT IN('queued','sending')
    AND created_at<pg_catalog.now()-pg_catalog.make_interval(days=>p_days) ORDER BY created_at,id LIMIT p_limit);
  GET DIAGNOSTICS v_count=ROW_COUNT; RETURN v_count;
END $$;
-- Remove legacy column grants, policies and unexpected alternate entry points.
DO $acl$
DECLARE v_column RECORD; v_function RECORD; v_signature TEXT; v_expected TEXT[]:=ARRAY[
  'public.booking_available(date,time without time zone)','public.booking_slots(date,integer)',
  'public.booking_guard()','public.booking_schedule_lock()','public.booking_admin_status(uuid,text)','public.booking_create_once(text,bigint,integer,jsonb)',
  'public.chat_insert_booking(text,bigint,integer,jsonb)','public.booking_owned_action(text,uuid,text)',
  'public.integration_enqueue(text,text,jsonb,text,integer)','public.integration_claim(integer)',
  'public.integration_finish(uuid,uuid,text,text,text,integer)','public.integration_retention(integer,integer)'];
BEGIN
  FOR v_column IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid='public.integration_outbox'::regclass AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE pg_catalog.format('REVOKE SELECT (%I),INSERT (%I),UPDATE (%I),REFERENCES (%I) ON public.integration_outbox FROM PUBLIC,anon,authenticated,service_role',v_column.attname,v_column.attname,v_column.attname,v_column.attname);
  END LOOP;
  FOR v_column IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid='public.bookings'::regclass AND attnum>0 AND NOT attisdropped LOOP
    EXECUTE pg_catalog.format('REVOKE INSERT (%I) ON public.bookings FROM service_role',v_column.attname);
    IF v_column.attname NOT IN('status','updated_at','privacy_retention_until') THEN EXECUTE pg_catalog.format('REVOKE UPDATE (%I) ON public.bookings FROM service_role',v_column.attname); END IF;
  END LOOP;
  FOR v_function IN SELECT p.oid,p.proname,p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN('booking_available','booking_slots','booking_guard','booking_schedule_lock','booking_admin_status','booking_create_once','chat_insert_booking','booking_owned_action','integration_enqueue','integration_claim','integration_finish','integration_retention') LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(v_expected) s WHERE pg_catalog.to_regprocedure(s)=v_function.oid) THEN RAISE EXCEPTION 'Unexpected agenda RPC overload'; END IF;
    IF pg_catalog.pg_has_role('anon',v_function.proowner,'MEMBER') OR pg_catalog.pg_has_role('authenticated',v_function.proowner,'MEMBER') OR pg_catalog.pg_has_role('service_role',v_function.proowner,'MEMBER') THEN RAISE EXCEPTION 'API roles cannot own RPCs'; END IF;
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',v_function.oid::regprocedure);
    IF v_function.proname NOT IN('booking_guard','booking_schedule_lock') THEN EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO service_role',v_function.oid::regprocedure); END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('anon','public.integration_outbox','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_table_privilege('authenticated','public.integration_outbox','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
    pg_catalog.has_any_column_privilege('service_role','public.integration_outbox','SELECT,INSERT,UPDATE,REFERENCES') OR
    pg_catalog.has_any_column_privilege('service_role','public.bookings','INSERT') THEN RAISE EXCEPTION 'Unexpected integration privileges'; END IF;
END $acl$;
COMMIT;
