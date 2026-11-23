-- Branded video-call confirmations, calendar attachments and durable reminders.
-- Apply after v21. Only future reminder jobs are created; no provider is called.
BEGIN;
ALTER TABLE public.integration_outbox ADD COLUMN IF NOT EXISTS first_attempt_at TIMESTAMPTZ;
ALTER TABLE public.integration_outbox ADD COLUMN IF NOT EXISTS delivery_payload JSONB;
COMMENT ON COLUMN public.integration_outbox.first_attempt_at IS
  'Retry window starts at the first delivery attempt, not creation of a future reminder.';
COMMENT ON COLUMN public.integration_outbox.delivery_payload IS
  'Server-rendered Resend request frozen before first send, including calendar; never browser HTML.';

CREATE OR REPLACE FUNCTION public.booking_reminders()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_hours INTEGER;
BEGIN
  IF NEW.status='confirmed' AND NEW.visitor_email IS NOT NULL AND NEW.starts_at IS NOT NULL THEN
    FOREACH v_hours IN ARRAY ARRAY[24,1] LOOP
      IF NEW.starts_at-pg_catalog.make_interval(hours=>v_hours)>pg_catalog.now() THEN
        INSERT INTO public.integration_outbox(idempotency_key,channel,payload,booking_id,visitor_id,available_at)
          VALUES('booking:'||NEW.id::TEXT||':reminder:'||v_hours::TEXT,'booking_email',
            pg_catalog.jsonb_build_object('reminderHours',v_hours),NEW.id,NEW.visitor_id,NEW.starts_at-pg_catalog.make_interval(hours=>v_hours))
          ON CONFLICT(idempotency_key) DO NOTHING;
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS booking_reminders ON public.bookings;
CREATE TRIGGER booking_reminders AFTER INSERT ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.booking_reminders();
-- Existing future confirmed appointments join the same idempotent schedule.
INSERT INTO public.integration_outbox(idempotency_key,channel,payload,booking_id,visitor_id,available_at)
 SELECT 'booking:'||b.id::TEXT||':reminder:'||hours::TEXT,'booking_email',pg_catalog.jsonb_build_object('reminderHours',hours),
   b.id,b.visitor_id,COALESCE(b.starts_at,(b.booked_date+b.booked_time) AT TIME ZONE 'Europe/Madrid')-pg_catalog.make_interval(hours=>hours)
 FROM public.bookings b CROSS JOIN pg_catalog.unnest(ARRAY[24,1]) hours
 WHERE b.status='confirmed' AND b.visitor_email IS NOT NULL
   AND COALESCE(b.starts_at,(b.booked_date+b.booked_time) AT TIME ZONE 'Europe/Madrid')-pg_catalog.make_interval(hours=>hours)>pg_catalog.now()
 ON CONFLICT(idempotency_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.integration_claim(p_limit INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.integration_outbox%ROWTYPE;v_booking public.bookings%ROWTYPE;v_result JSONB:='[]';v_template TEXT;
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 10 THEN RAISE EXCEPTION 'Invalid worker batch';END IF;
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
-- Renderer updates between retries must not change a Resend idempotent request.
-- This service-only RPC accepts worker output, never a public/dashboard HTML body.
CREATE OR REPLACE FUNCTION public.integration_email_payload(p_id UUID,p_token UUID,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.integration_outbox%ROWTYPE;
BEGIN
 SELECT * INTO v_row FROM public.integration_outbox WHERE id=p_id AND status='sending' AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND OR v_row.channel NOT IN('email','booking_email') THEN RAISE EXCEPTION 'Worker lease lost';END IF;
 IF v_row.context_version IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.chat_context_states WHERE visitor_id=v_row.visitor_id AND context_version=v_row.context_version) THEN
   UPDATE public.integration_outbox SET payload='{}',delivery_payload=NULL,updated_at=pg_catalog.now() WHERE id=p_id;
   RETURN pg_catalog.jsonb_build_object('disabled',true);
 END IF;
 IF v_row.booking_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.bookings WHERE id=v_row.booking_id AND status='confirmed') THEN
   RETURN pg_catalog.jsonb_build_object('disabled',true);
 END IF;
 IF v_row.delivery_payload IS NULL THEN
   IF p_payload IS NULL OR pg_catalog.jsonb_typeof(p_payload)<>'object' OR pg_catalog.octet_length(p_payload::TEXT)>65536 OR
     EXISTS(SELECT 1 FROM pg_catalog.jsonb_object_keys(p_payload) k WHERE k NOT IN('to','toName','subject','bodyText','bodyHtml','templateType','meeting','attachments','from','replyTo')) OR
     (p_payload ? 'from' AND (pg_catalog.jsonb_typeof(p_payload->'from') IS DISTINCT FROM 'string' OR pg_catalog.length(p_payload->>'from') NOT BETWEEN 3 AND 357)) OR
     (p_payload ? 'replyTo' AND (pg_catalog.jsonb_typeof(p_payload->'replyTo') IS DISTINCT FROM 'string' OR pg_catalog.length(p_payload->>'replyTo') NOT BETWEEN 3 AND 254)) OR
     EXISTS(SELECT 1 FROM pg_catalog.unnest(ARRAY['to','subject','bodyText','bodyHtml']) k WHERE pg_catalog.jsonb_typeof(p_payload->k) IS DISTINCT FROM 'string') OR
     pg_catalog.length(p_payload->>'to') NOT BETWEEN 3 AND 254 OR pg_catalog.length(p_payload->>'subject') NOT BETWEEN 1 AND 200 OR
     pg_catalog.length(p_payload->>'bodyText') NOT BETWEEN 1 AND 10000 OR pg_catalog.length(p_payload->>'bodyHtml') NOT BETWEEN 1 AND 50000 THEN
     RAISE EXCEPTION 'Invalid delivery payload';
   END IF;
   UPDATE public.integration_outbox SET delivery_payload=p_payload,updated_at=pg_catalog.now() WHERE id=p_id;
   v_row.delivery_payload:=p_payload;
 END IF;
 RETURN pg_catalog.jsonb_build_object('payload',v_row.delivery_payload);
END $$;
CREATE OR REPLACE FUNCTION public.integration_finish(p_id UUID,p_token UUID,p_status TEXT,p_provider_id TEXT,p_error TEXT,p_retry_seconds INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.integration_outbox%ROWTYPE;v_reminder BOOLEAN;
BEGIN
 IF p_status IS NULL OR p_status NOT IN('queued','accepted','failed','uncertain','disabled') OR p_retry_seconds IS NULL OR p_retry_seconds NOT BETWEEN 0 AND 7200
   OR pg_catalog.length(COALESCE(p_provider_id,''))>200 OR pg_catalog.length(COALESCE(p_error,''))>100 THEN RAISE EXCEPTION 'Invalid worker result';END IF;
 SELECT * INTO v_row FROM public.integration_outbox WHERE id=p_id AND status='sending' AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Worker lease lost';END IF;
 IF p_status='queued' AND (v_row.attempts>=5 OR COALESCE(v_row.first_attempt_at,v_row.created_at)<pg_catalog.now()-INTERVAL '20 hours') THEN p_status:='failed';END IF;
 UPDATE public.integration_outbox SET status=p_status,provider_id=p_provider_id,error_code=p_error,
   available_at=pg_catalog.now()+pg_catalog.make_interval(secs=>p_retry_seconds),lease_token=NULL,lease_until=NULL,updated_at=pg_catalog.now() WHERE id=p_id;
 IF v_row.channel IN('email','booking_email') THEN
   IF v_row.channel='booking_email' THEN
     v_reminder:=v_row.payload ? 'reminderHours';
     INSERT INTO public.sent_emails(operation_id,visitor_id,to_email,subject,template_type,status,resend_id)
       SELECT p_id,b.visitor_id,b.visitor_email,CASE WHEN v_reminder THEN 'Recordatorio de videollamada' ELSE 'Confirmación de videollamada' END,
         CASE WHEN v_reminder THEN 'booking_reminder' ELSE 'booking_confirmation' END,p_status,p_provider_id
       FROM public.bookings b WHERE b.id=v_row.booking_id ON CONFLICT DO NOTHING;
   END IF;
   UPDATE public.sent_emails SET status=p_status,resend_id=p_provider_id,updated_at=pg_catalog.now() WHERE operation_id=p_id;
 END IF;
 RETURN pg_catalog.jsonb_build_object('saved',true);
END $$;
CREATE OR REPLACE FUNCTION public.integration_retention(p_days INTEGER,p_limit INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count INTEGER;
BEGIN
 IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 730 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN RAISE EXCEPTION 'Invalid retention';END IF;
 DELETE FROM public.integration_outbox WHERE id IN(
   SELECT o.id FROM public.integration_outbox o WHERE
     (CASE WHEN o.payload ? 'reminderHours' THEN COALESCE(o.first_attempt_at,o.created_at) ELSE o.created_at END)<pg_catalog.now()-pg_catalog.make_interval(days=>p_days)
     AND (o.status<>'sending' OR o.lease_until IS NULL OR o.lease_until<=pg_catalog.now())
     -- A 180-day booking may outlive the email retention horizon. Before its
     -- first delivery this reminder holds only agenda references, no email body.
     AND NOT (o.status='queued' AND o.first_attempt_at IS NULL AND o.payload ? 'reminderHours' AND EXISTS(
       SELECT 1 FROM public.bookings b WHERE b.id=o.booking_id AND b.status='confirmed'
         AND COALESCE(b.starts_at,(b.booked_date+b.booked_time) AT TIME ZONE 'Europe/Madrid')>pg_catalog.now()))
   ORDER BY o.created_at,o.id LIMIT p_limit FOR UPDATE OF o SKIP LOCKED);
 GET DIAGNOSTICS v_count=ROW_COUNT;RETURN v_count;
END $$;
REVOKE ALL ON FUNCTION public.booking_reminders() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.integration_claim(INTEGER),public.integration_finish(UUID,UUID,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.integration_claim(INTEGER),public.integration_finish(UUID,UUID,TEXT,TEXT,TEXT,INTEGER) TO service_role;
REVOKE ALL ON FUNCTION public.integration_email_payload(UUID,UUID,JSONB) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.integration_email_payload(UUID,UUID,JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.integration_retention(INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.integration_retention(INTEGER,INTEGER) TO service_role;
REVOKE ALL (first_attempt_at,delivery_payload) ON public.integration_outbox FROM PUBLIC,anon,authenticated,service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
