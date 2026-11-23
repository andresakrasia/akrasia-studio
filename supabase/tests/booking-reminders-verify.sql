-- Disposable PostgreSQL only. Every fixture and assertion rolls back.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.reminder_assert(value BOOLEAN,message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Reminder assertion: %',message;END IF;END $$;
DO $$
DECLARE owner TEXT:='a2222222-0000-4000-8000-000000000001';v_booking_id UUID:='a2222222-0000-4000-8000-000000000010';
 day DATE:=(pg_catalog.clock_timestamp() AT TIME ZONE 'Europe/Madrid')::DATE+10;
 expiry BIGINT:=EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())::BIGINT+3600;v_payload JSONB;result JSONB;jobs JSONB;job JSONB;v_delivery JSONB;
BEGIN
 INSERT INTO public.availability_overrides(override_date,start_time,end_time,is_available) VALUES(day,'10:00','18:00',true);
 v_payload:=pg_catalog.jsonb_build_object('id',v_booking_id,'visitor_id',owner,'booked_date',day,'booked_time','14:00','duration_min',30,'buffer_min',30,
   'meet_url','https://meet.jit.si/Akrasia-'||v_booking_id::TEXT,'visitor_email','synthetic@example.invalid','visitor_name','Synthetic');
 result:=public.booking_create_once(owner,expiry,0,v_payload);
 PERFORM pg_temp.reminder_assert((result->>'created')::BOOLEAN,'real confirmation');
 PERFORM pg_temp.reminder_assert((SELECT count(*)=4 FROM public.integration_outbox WHERE booking_id=v_booking_id),'confirmation and two reminders atomically queued');
 PERFORM pg_temp.reminder_assert((SELECT count(*)=2 FROM public.integration_outbox o JOIN public.bookings b ON b.id=o.booking_id
   WHERE o.booking_id=v_booking_id AND o.payload ? 'reminderHours' AND o.available_at=b.starts_at-pg_catalog.make_interval(hours=>(o.payload->>'reminderHours')::INTEGER)),'24h and 1h schedule in absolute Madrid instants');
 result:=public.booking_create_once(owner,expiry,0,v_payload);
 PERFORM pg_temp.reminder_assert(NOT (result->>'created')::BOOLEAN AND (SELECT count(*)=4 FROM public.integration_outbox WHERE booking_id=v_booking_id),'replay creates no duplicate reminder');
 UPDATE public.integration_outbox SET status='accepted' WHERE booking_id=v_booking_id AND NOT payload ? 'reminderHours';
 UPDATE public.integration_outbox SET created_at=pg_catalog.now()-INTERVAL '91 days' WHERE booking_id=v_booking_id AND payload ? 'reminderHours';
 PERFORM public.integration_retention(90,100);
 PERFORM pg_temp.reminder_assert((SELECT count(*)=2 FROM public.integration_outbox WHERE booking_id=v_booking_id AND payload ? 'reminderHours'),'retention preserves old future reminder references');
 jobs:=public.integration_claim(10);
 PERFORM pg_temp.reminder_assert(NOT EXISTS(SELECT 1 FROM pg_catalog.jsonb_array_elements(jobs) j WHERE j->'payload'->>'id'=v_booking_id::TEXT),'future reminders not sent early');
 -- An old creation timestamp must not consume a future reminder retry window.
 UPDATE public.integration_outbox SET created_at=pg_catalog.now()-INTERVAL '91 days',available_at=pg_catalog.now()-INTERVAL '1 minute'
   WHERE booking_id=v_booking_id AND payload->>'reminderHours'='24';
 jobs:=public.integration_claim(10);
 SELECT j INTO job FROM pg_catalog.jsonb_array_elements(jobs) j WHERE j->'payload'->>'id'=v_booking_id::TEXT;
 PERFORM pg_temp.reminder_assert(job->'payload'->>'reminderHours'='24' AND job->'payload'->>'meetUrl'='https://meet.jit.si/Akrasia-'||v_booking_id::TEXT,'first delivery survives age and carries persisted link');
 PERFORM pg_temp.reminder_assert((SELECT first_attempt_at>pg_catalog.now()-INTERVAL '1 minute' FROM public.integration_outbox WHERE id=(job->>'id')::UUID),'retry clock starts on first attempt');
 v_delivery:=pg_catalog.jsonb_build_object('to','synthetic@example.invalid','subject','Synthetic reminder','bodyText','Reviewed text','bodyHtml','<div>Version one</div>',
   'from','Synthetic <sender@example.invalid>','replyTo','synthetic@example.invalid');
 PERFORM pg_temp.reminder_assert(public.integration_email_payload((job->>'id')::UUID,(job->>'leaseToken')::UUID,v_delivery)->'payload'=v_delivery,'first server-rendered delivery is frozen');
 PERFORM public.integration_finish((job->>'id')::UUID,(job->>'leaseToken')::UUID,'queued',NULL,'email_http_429',60);
 PERFORM public.integration_retention(90,100);
 PERFORM pg_temp.reminder_assert((SELECT status='queued' FROM public.integration_outbox WHERE id=(job->>'id')::UUID),'scheduled email can retry after old creation');
 UPDATE public.integration_outbox SET available_at=pg_catalog.now() WHERE id=(job->>'id')::UUID;
 jobs:=public.integration_claim(10);SELECT j INTO job FROM pg_catalog.jsonb_array_elements(jobs) j WHERE j->'payload'->>'id'=v_booking_id::TEXT;
 PERFORM pg_temp.reminder_assert((job->>'attempt')::INTEGER=2 AND job->'payload'->>'reminderHours'='24','retry retains reminder metadata');
 PERFORM pg_temp.reminder_assert(public.integration_email_payload((job->>'id')::UUID,(job->>'leaseToken')::UUID,v_delivery||'{"bodyHtml":"<div>New deployed renderer</div>","from":"changed@example.invalid","replyTo":"changed@example.invalid"}'::JSONB)->'payload'=v_delivery,'deploy changes cannot change idempotent provider body or sender');
 PERFORM public.integration_finish((job->>'id')::UUID,(job->>'leaseToken')::UUID,'accepted','synthetic-provider-id',NULL,0);
 PERFORM pg_temp.reminder_assert((SELECT template_type='booking_reminder' AND status='accepted' FROM public.sent_emails WHERE operation_id=(job->>'id')::UUID),'reminder type recorded accurately');
 UPDATE public.integration_outbox SET available_at=pg_catalog.now() WHERE booking_id=v_booking_id AND payload->>'reminderHours'='1';
 jobs:=public.integration_claim(10);SELECT j INTO job FROM pg_catalog.jsonb_array_elements(jobs) j WHERE j->'payload'->>'id'=v_booking_id::TEXT;
 PERFORM public.booking_owned_action(owner,v_booking_id,'cancel');
 PERFORM pg_temp.reminder_assert((public.integration_email_payload((job->>'id')::UUID,(job->>'leaseToken')::UUID,v_delivery)->>'disabled')::BOOLEAN,'cancellation after claim rechecked before provider');
 PERFORM public.integration_finish((job->>'id')::UUID,(job->>'leaseToken')::UUID,'disabled',NULL,'booking_or_context_inactive',0);
 PERFORM pg_temp.reminder_assert((SELECT status='disabled' FROM public.integration_outbox WHERE booking_id=v_booking_id AND payload->>'reminderHours'='1'),'cancelled reminder never delivered');
 PERFORM pg_temp.reminder_assert(NOT pg_catalog.has_function_privilege('anon','public.booking_reminders()','EXECUTE') AND
   NOT pg_catalog.has_function_privilege('service_role','public.booking_reminders()','EXECUTE'),'trigger helper remains private');
 PERFORM pg_temp.reminder_assert(NOT pg_catalog.has_any_column_privilege('service_role','public.integration_outbox','SELECT,INSERT,UPDATE,REFERENCES'),'new retry column stays private');
 PERFORM pg_temp.reminder_assert(NOT pg_catalog.has_function_privilege('anon','public.integration_email_payload(uuid,uuid,jsonb)','EXECUTE'),'browser cannot freeze HTML');
END $$;
ROLLBACK;
