-- Synthetic transaction only; psql -v ON_ERROR_STOP=1. Never run against production.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.agenda_assert(p_value BOOLEAN,p_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF p_value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Agenda assertion: %',p_message; END IF; END $$;
DO $$ DECLARE v_day DATE:=(pg_catalog.clock_timestamp() AT TIME ZONE 'Europe/Madrid')::DATE+10;
  v_owner TEXT:='a1515151-0000-4000-8000-000000000001';v_other TEXT:='a1515151-0000-4000-8000-000000000002';
  v_id UUID:='a1515151-0000-4000-8000-000000000010';v_second UUID:='a1515151-0000-4000-8000-000000000011';
  v_expiry BIGINT:=EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())::BIGINT+3600;v_payload JSONB;v_result JSONB;v_job JSONB;v_rows JSONB;v_count INTEGER;
BEGIN
  -- Dedicated synthetic windows override no real schedules: transaction rolls back.
  INSERT INTO public.availability(day_of_week,start_time,end_time,is_active) VALUES(EXTRACT(DOW FROM v_day),'08:00','20:00',true);
  DELETE FROM public.availability_overrides WHERE override_date=v_day;
  INSERT INTO public.availability_overrides(override_date,start_time,end_time,is_available) VALUES(v_day,'10:00','11:00',false);
  PERFORM pg_temp.agenda_assert(NOT public.booking_available(v_day,'10:00'),'partial block start');
  PERFORM pg_temp.agenda_assert(NOT public.booking_available(v_day,'09:45'),'appointment intersects block');
  PERFORM pg_temp.agenda_assert(public.booking_available(v_day,'11:00'),'block upper boundary opens');
  PERFORM pg_temp.agenda_assert(NOT public.booking_available('2000-01-01','12:00'),'past rejected');
  PERFORM pg_temp.agenda_assert(NOT public.booking_available(v_day,'24:00'),'24:00 rejected');
  PERFORM pg_temp.agenda_assert(NOT public.booking_available(v_day,'12:00:30'),'seconds rejected');
  INSERT INTO public.availability_overrides(override_date,start_time,end_time,is_available) VALUES(v_day,'21:00','22:00',true);
  PERFORM pg_temp.agenda_assert(public.booking_available(v_day,'21:00'),'exception opens outside weekly window');
  PERFORM pg_temp.agenda_assert(NOT public.booking_available(v_day,'21:45'),'duration outside exception rejected');
  v_rows:=public.booking_slots(v_day,10);
  FOR v_job IN SELECT value FROM pg_catalog.jsonb_array_elements(v_rows) LOOP
    PERFORM pg_temp.agenda_assert(public.booking_available((v_job->>'date')::DATE,(v_job->>'time')::TIME),'every offered slot can be created');
  END LOOP;
  v_payload:=pg_catalog.jsonb_build_object('id',v_id,'visitor_id',v_owner,'booked_date',v_day,'booked_time','12:00',
    'duration_min',30,'buffer_min',30,'meet_url','https://example.invalid/meeting','visitor_email','synthetic@example.invalid','visitor_name','Synthetic');
  v_result:=public.booking_create_once(v_owner,v_expiry,0,v_payload);
  PERFORM pg_temp.agenda_assert((v_result->>'created')::BOOLEAN AND v_result->'booking'->>'id'=v_id::TEXT,'persisted confirmation');
  PERFORM pg_temp.agenda_assert((SELECT COUNT(*)=2 FROM public.integration_outbox WHERE booking_id=v_id),'notifications committed atomically');
  v_result:=public.booking_create_once(v_owner,v_expiry,0,v_payload);
  PERFORM pg_temp.agenda_assert(NOT (v_result->>'created')::BOOLEAN,'same operation replay');
  PERFORM pg_temp.agenda_assert((SELECT COUNT(*)=2 FROM public.integration_outbox WHERE booking_id=v_id),'no duplicate notifications');
  v_result:=public.booking_create_once(v_other,v_expiry,0,v_payload||pg_catalog.jsonb_build_object('id',v_second,'visitor_id',v_other));
  PERFORM pg_temp.agenda_assert(v_result->'booking'='null'::JSONB,'different visitors cannot overlap');
  PERFORM pg_temp.agenda_assert(NOT public.booking_available(v_day,'11:45'),'new interval+buffer intersects later booking');
  PERFORM pg_temp.agenda_assert(NOT public.booking_available(v_day,'12:45'),'existing buffer respected');
  PERFORM pg_temp.agenda_assert(public.booking_available(v_day,'13:00'),'half open buffer boundary');
  BEGIN PERFORM public.booking_create_once(v_owner,v_expiry,0,v_payload||'{"booked_time":"13:00"}'::JSONB); RAISE EXCEPTION 'reused operation must reject'; EXCEPTION WHEN raise_exception THEN IF SQLERRM='reused operation must reject' THEN RAISE; END IF; END;
  PERFORM pg_temp.agenda_assert(public.booking_owned_action(v_other,v_id,'get')->>'error'='invalid_reference','foreign read rejected');
  PERFORM pg_temp.agenda_assert(public.booking_owned_action(v_other,v_id,'cancel')->>'error'='invalid_reference','foreign cancellation rejected');
  PERFORM pg_temp.agenda_assert(public.booking_owned_action(v_owner,v_id,'cancel')->>'status'='cancelled','own cancellation');
  PERFORM pg_temp.agenda_assert((SELECT COUNT(*)=2 FROM public.integration_outbox WHERE booking_id=v_id AND status='disabled'),'cancel queued notifications');
  PERFORM pg_temp.agenda_assert(public.booking_available(v_day,'12:00'),'cancel releases slot');
  BEGIN PERFORM public.booking_admin_status(v_id,'confirmed');RAISE EXCEPTION 'reactivation must reject';EXCEPTION WHEN raise_exception THEN IF SQLERRM='reactivation must reject' THEN RAISE;END IF;END;
  v_result:=public.integration_enqueue('synthetic:a15:one','telegram','{"text":"Synthetic notice"}',v_owner,0);
  PERFORM pg_temp.agenda_assert(v_result->>'status'='queued','durable notification acceptance');
  PERFORM pg_temp.agenda_assert(public.integration_enqueue('synthetic:a15:one','telegram','{"text":"Synthetic notice"}',v_owner,0)->>'id'=v_result->>'id','notification replay');
  BEGIN PERFORM public.integration_enqueue('synthetic:a15:one','telegram','{"text":"Changed"}',v_owner,0);RAISE EXCEPTION 'different payload must reject';EXCEPTION WHEN raise_exception THEN IF SQLERRM='different payload must reject' THEN RAISE;END IF;END;
  v_rows:=public.integration_claim(10);
  FOR v_job IN SELECT value FROM pg_catalog.jsonb_array_elements(v_rows) LOOP
    PERFORM public.integration_finish((v_job->>'id')::UUID,(v_job->>'leaseToken')::UUID,'accepted','fake-provider-id',NULL,0);
  END LOOP;
  PERFORM pg_temp.agenda_assert((SELECT status='accepted' FROM public.integration_outbox WHERE id=(v_result->>'id')::UUID),'provider acceptance recorded');
  v_result:=public.integration_enqueue('synthetic:a15:crash','telegram','{"text":"Synthetic crash"}',NULL,NULL);
  v_rows:=public.integration_claim(10);UPDATE public.integration_outbox SET lease_until=pg_catalog.now()-INTERVAL '1 second' WHERE id=(v_result->>'id')::UUID;
  PERFORM public.integration_claim(10);
  PERFORM pg_temp.agenda_assert((SELECT status='uncertain' FROM public.integration_outbox WHERE id=(v_result->>'id')::UUID),'Telegram lease crash never resends');
  UPDATE public.integration_outbox SET created_at=pg_catalog.now()-INTERVAL '91 days' WHERE id=(v_result->>'id')::UUID;
  v_count:=public.integration_retention(90,100);PERFORM pg_temp.agenda_assert(v_count>=1,'bounded 90 day outbox retention');
  PERFORM pg_temp.agenda_assert(NOT pg_catalog.has_any_column_privilege('service_role','public.bookings','INSERT'),'no direct service booking insert');
  PERFORM pg_temp.agenda_assert(NOT pg_catalog.has_any_column_privilege('anon','public.integration_outbox','SELECT,INSERT,UPDATE,REFERENCES'),'anon no outbox columns');
  PERFORM pg_temp.agenda_assert(NOT pg_catalog.has_function_privilege('anon','public.booking_create_once(text,bigint,integer,jsonb)','EXECUTE'),'anon no booking RPC');
END $$;
ROLLBACK;
