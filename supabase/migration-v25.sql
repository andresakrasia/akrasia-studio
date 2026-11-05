-- Durable admin email for every new confirmed video call. Apply after v24.
-- Destination and message are rendered by the private worker from server configuration.
-- Historical appointments are not backfilled and no provider is called by SQL.
BEGIN;
ALTER TABLE public.integration_outbox DROP CONSTRAINT IF EXISTS integration_outbox_channel_check;
ALTER TABLE public.integration_outbox ADD CONSTRAINT integration_outbox_channel_check
  CHECK(channel IN('email','telegram','booking_email','booking_telegram','booking_admin_email'));
CREATE OR REPLACE FUNCTION public.booking_admin_notification()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.status='confirmed' THEN
    INSERT INTO public.integration_outbox(idempotency_key,channel,payload,booking_id,visitor_id)
      VALUES('booking:'||NEW.id::TEXT||':admin-email','booking_admin_email','{}',NEW.id,NEW.visitor_id)
      ON CONFLICT(idempotency_key) DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS booking_admin_notification ON public.bookings;
CREATE TRIGGER booking_admin_notification AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.booking_admin_notification();
-- integration_claim already resolves every job carrying booking_id through the
-- persisted appointment and disables cancelled appointments before claiming.
CREATE OR REPLACE FUNCTION public.integration_email_payload(p_id UUID,p_token UUID,p_payload JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_row public.integration_outbox%ROWTYPE;
BEGIN
 SELECT * INTO v_row FROM public.integration_outbox WHERE id=p_id AND status='sending' AND lease_token=p_token FOR UPDATE;
 IF NOT FOUND OR v_row.channel NOT IN('email','booking_email','booking_admin_email') THEN RAISE EXCEPTION 'Worker lease lost';END IF;
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
 IF v_row.channel IN('email','booking_email','booking_admin_email') THEN
   IF v_row.channel='booking_email' THEN
     v_reminder:=v_row.payload ? 'reminderHours';
     INSERT INTO public.sent_emails(operation_id,visitor_id,to_email,subject,template_type,status,resend_id)
       SELECT p_id,b.visitor_id,b.visitor_email,CASE WHEN v_reminder THEN 'Recordatorio de videollamada' ELSE 'Confirmación de videollamada' END,
         CASE WHEN v_reminder THEN 'booking_reminder' ELSE 'booking_confirmation' END,p_status,p_provider_id
       FROM public.bookings b WHERE b.id=v_row.booking_id ON CONFLICT DO NOTHING;
   END IF;
   IF v_row.channel='booking_admin_email' AND v_row.delivery_payload IS NOT NULL THEN
     -- The admin copy never becomes part of a visitor's email/contact history.
     INSERT INTO public.sent_emails(operation_id,visitor_id,to_email,subject,body_text,body_html,template_type,status,resend_id)
       VALUES(p_id,NULL,v_row.delivery_payload->>'to',v_row.delivery_payload->>'subject',
         v_row.delivery_payload->>'bodyText',v_row.delivery_payload->>'bodyHtml','booking_admin_notification',p_status,p_provider_id)
       ON CONFLICT DO NOTHING;
   END IF;
   UPDATE public.sent_emails SET status=p_status,resend_id=p_provider_id,updated_at=pg_catalog.now() WHERE operation_id=p_id;
 END IF;
 RETURN pg_catalog.jsonb_build_object('saved',true);
END $$;
REVOKE ALL ON FUNCTION public.booking_admin_notification() FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.integration_email_payload(UUID,UUID,JSONB),public.integration_finish(UUID,UUID,TEXT,TEXT,TEXT,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.integration_email_payload(UUID,UUID,JSONB),public.integration_finish(UUID,UUID,TEXT,TEXT,TEXT,INTEGER) TO service_role;
COMMENT ON FUNCTION public.booking_admin_notification() IS 'Atomically queue one admin email per new confirmed appointment; destination is private worker configuration.';
NOTIFY pgrst, 'reload schema';
COMMIT;
