-- Disposable PostgreSQL only; all synthetic records roll back.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.admin_notice_assert(value BOOLEAN,message TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Admin notification assertion: %',message;END IF;END $$;
DO $$
DECLARE owner TEXT:='a2525252-0000-4000-8000-000000000001';v_booking_id UUID:='a2525252-0000-4000-8000-000000000010';
  day DATE:=(pg_catalog.clock_timestamp() AT TIME ZONE 'Europe/Madrid')::DATE+10;
  expiry BIGINT:=EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())::BIGINT+3600;
  input JSONB;result JSONB;jobs JSONB;job JSONB;delivery JSONB;admin_job UUID;
BEGIN
  INSERT INTO public.availability_overrides(override_date,start_time,end_time,is_available) VALUES(day,'10:00','18:00',true);
  input:=pg_catalog.jsonb_build_object('id',v_booking_id,'visitor_id',owner,'booked_date',day,'booked_time','14:30','duration_min',30,'buffer_min',30,
    'meet_url','https://meet.jit.si/Akrasia-'||v_booking_id::TEXT,'visitor_email','client@example.invalid','visitor_name','Synthetic client');
  result:=public.booking_create_once(owner,expiry,0,input);
  PERFORM pg_temp.admin_notice_assert((result->>'created')::BOOLEAN,'confirmation persists');
  PERFORM pg_temp.admin_notice_assert((SELECT count(*)=5 FROM public.integration_outbox o WHERE o.booking_id=v_booking_id),'admin, client, telegram and two reminders atomically queued');
  SELECT id INTO admin_job FROM public.integration_outbox o WHERE o.booking_id=v_booking_id AND channel='booking_admin_email';
  PERFORM pg_temp.admin_notice_assert(admin_job IS NOT NULL,'admin job exists');
  PERFORM pg_temp.admin_notice_assert((SELECT payload='{}' AND idempotency_key='booking:'||v_booking_id::TEXT||':admin-email' FROM public.integration_outbox WHERE id=admin_job),'no destination supplied by visitor');
  result:=public.booking_create_once(owner,expiry,0,input);
  PERFORM pg_temp.admin_notice_assert(NOT (result->>'created')::BOOLEAN AND (SELECT count(*)=1 FROM public.integration_outbox o WHERE o.booking_id=v_booking_id AND channel='booking_admin_email'),'replay does not duplicate admin job');
  UPDATE public.integration_outbox SET status='accepted' WHERE id<>admin_job;
  jobs:=public.integration_claim(10);
  SELECT j INTO job FROM pg_catalog.jsonb_array_elements(jobs) j WHERE j->>'id'=admin_job::TEXT;
  PERFORM pg_temp.admin_notice_assert(job->>'channel'='booking_admin_email' AND job->'payload'->>'email'='client@example.invalid'
    AND job->'payload'->>'time'='14:30','claim derives date/time/contact from persisted booking');
  delivery:=pg_catalog.jsonb_build_object('to','info@akrasia.studio','subject','Synthetic new booking','bodyText','Private admin notice','bodyHtml','<div>Original admin notice</div>',
    'templateType','booking_admin_notification','from','Synthetic <sender@example.invalid>','replyTo','info@akrasia.studio');
  PERFORM pg_temp.admin_notice_assert(public.integration_email_payload(admin_job,(job->>'leaseToken')::UUID,delivery)->'payload'=delivery,'first destination frozen');
  PERFORM public.integration_finish(admin_job,(job->>'leaseToken')::UUID,'queued',NULL,'email_http_429',0);
  jobs:=public.integration_claim(10);SELECT j INTO job FROM pg_catalog.jsonb_array_elements(jobs) j WHERE j->>'id'=admin_job::TEXT;
  PERFORM pg_temp.admin_notice_assert((job->>'attempt')::INTEGER=2,'retry claims same job');
  PERFORM pg_temp.admin_notice_assert(public.integration_email_payload(admin_job,(job->>'leaseToken')::UUID,delivery||'{"to":"changed@example.invalid","bodyHtml":"changed"}'::JSONB)->'payload'=delivery,'retry preserves configured destination and body');
  PERFORM public.integration_finish(admin_job,(job->>'leaseToken')::UUID,'accepted','synthetic-provider-id',NULL,0);
  PERFORM pg_temp.admin_notice_assert((SELECT visitor_id IS NULL AND to_email='info@akrasia.studio' AND template_type='booking_admin_notification'
    AND body_html='<div>Original admin notice</div>' AND status='accepted' FROM public.sent_emails WHERE operation_id=admin_job),'admin copy stays separate from visitor emails');
  -- Cancellation after a claim must suppress sending even with a frozen body.
  UPDATE public.integration_outbox SET status='queued' WHERE id=admin_job;
  jobs:=public.integration_claim(10);SELECT j INTO job FROM pg_catalog.jsonb_array_elements(jobs) j WHERE j->>'id'=admin_job::TEXT;
  PERFORM public.booking_owned_action(owner,v_booking_id,'cancel');
  PERFORM pg_temp.admin_notice_assert((public.integration_email_payload(admin_job,(job->>'leaseToken')::UUID,delivery)->>'disabled')::BOOLEAN,'cancelled notice cannot send');
  PERFORM public.integration_finish(admin_job,(job->>'leaseToken')::UUID,'disabled',NULL,'booking_or_context_inactive',0);
  PERFORM pg_temp.admin_notice_assert(NOT pg_catalog.has_function_privilege('anon','public.booking_admin_notification()','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('authenticated','public.booking_admin_notification()','EXECUTE')
    AND NOT pg_catalog.has_function_privilege('service_role','public.booking_admin_notification()','EXECUTE'),'trigger remains private');
  PERFORM pg_temp.admin_notice_assert(NOT pg_catalog.has_any_column_privilege('service_role','public.integration_outbox','SELECT,INSERT,UPDATE,REFERENCES'),'outbox remains private');
END $$;
ROLLBACK;
