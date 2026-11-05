-- Synthetic transaction in the disposable PostgreSQL runner only.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.calendar_assert(p_value BOOLEAN,p_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF p_value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Calendar assertion: %',p_message; END IF; END $$;
DO $$ DECLARE v_today DATE:=(pg_catalog.clock_timestamp() AT TIME ZONE 'Europe/Madrid')::DATE;v_day DATE:=v_today+10;
  v_rows JSONB;v_slot JSONB;v_result JSONB;v_previous TEXT:='';v_current TEXT;
  v_owner TEXT:='a2323232-0000-4000-8000-000000000001';v_id UUID:='a2323232-0000-4000-8000-000000000002';
BEGIN
  DELETE FROM public.availability;
  DELETE FROM public.availability_overrides;
  PERFORM pg_temp.calendar_assert(public.booking_slots_range(v_day,v_day)='[]'::JSONB,'unconfigured agenda stays empty');
  INSERT INTO public.availability_overrides(override_date,start_time,end_time,is_available) VALUES
    (v_day,'08:00','20:00',true),(v_day,'10:00','11:00',false),(v_day,'21:00','22:00',true),
    (v_day+1,'08:00','09:00',true),(v_today-1,'08:00','20:00',true),(v_today+181,'08:00','20:00',true);
  v_rows:=public.booking_slots_range(v_day,v_day);
  PERFORM pg_temp.calendar_assert(pg_catalog.jsonb_array_length(v_rows)=24,'all daily starts survive beyond old five/ten-slot limit');
  PERFORM pg_temp.calendar_assert(NOT v_rows @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('date',v_day::TEXT,'time','10:00')),'partial block excluded');
  PERFORM pg_temp.calendar_assert(v_rows @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('date',v_day::TEXT,'time','21:30')),'exceptional opening included');
  v_result:=public.booking_create_once(v_owner,EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())::BIGINT+3600,0,
    pg_catalog.jsonb_build_object('id',v_id,'visitor_id',v_owner,'booked_date',v_day,'booked_time','12:00',
      'duration_min',30,'buffer_min',30,'meet_url','https://example.invalid/meeting','visitor_email','synthetic@example.invalid'));
  PERFORM pg_temp.calendar_assert((v_result->>'created')::BOOLEAN,'synthetic occupied slot persisted');
  v_rows:=public.booking_slots_range(v_day,v_day);
  PERFORM pg_temp.calendar_assert(pg_catalog.jsonb_array_length(v_rows)=21,'reservation and both buffers excluded');
  PERFORM pg_temp.calendar_assert(NOT v_rows @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('date',v_day::TEXT,'time','11:30')),'preceding buffer excluded');
  PERFORM pg_temp.calendar_assert(NOT v_rows @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('date',v_day::TEXT,'time','12:00')),'occupied start excluded');
  PERFORM pg_temp.calendar_assert(NOT v_rows @> pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('date',v_day::TEXT,'time','12:30')),'following buffer excluded');
  v_rows:=public.booking_slots_range(v_day,v_day+1);
  PERFORM pg_temp.calendar_assert(pg_catalog.jsonb_array_length(v_rows)=23,'second day is complete');
  FOR v_slot IN SELECT value FROM pg_catalog.jsonb_array_elements(v_rows) LOOP
    PERFORM pg_temp.calendar_assert((SELECT COUNT(*)=2 FROM pg_catalog.jsonb_object_keys(v_slot)),'only date and time are public');
    PERFORM pg_temp.calendar_assert(public.booking_available((v_slot->>'date')::DATE,(v_slot->>'time')::TIME),'every display slot obeys creation availability');
    v_current:=v_slot->>'date'||' '||(v_slot->>'time');
    PERFORM pg_temp.calendar_assert(v_current>v_previous,'slots sorted and distinct');v_previous:=v_current;
  END LOOP;
  PERFORM pg_temp.calendar_assert(public.booking_slots_range(v_today-1,v_today-1)='[]'::JSONB,'past not offered');
  PERFORM pg_temp.calendar_assert(public.booking_slots_range(v_today+181,v_today+181)='[]'::JSONB,'180-day horizon not exceeded');
  FOR v_slot IN SELECT value FROM pg_catalog.jsonb_array_elements(public.booking_slots_range(v_today,v_today)) LOOP
    PERFORM pg_temp.calendar_assert(((v_slot->>'date')::DATE+(v_slot->>'time')::TIME) AT TIME ZONE 'Europe/Madrid'>pg_catalog.clock_timestamp(),'past times today not offered');
  END LOOP;
  BEGIN PERFORM public.booking_slots_range(v_day,v_day+31);RAISE EXCEPTION 'oversized window accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM='oversized window accepted' THEN RAISE;END IF;END;
  BEGIN PERFORM public.booking_slots_range(v_day+1,v_day);RAISE EXCEPTION 'reversed window accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM='reversed window accepted' THEN RAISE;END IF;END;
  BEGIN PERFORM public.booking_slots_range(NULL,v_day);RAISE EXCEPTION 'missing window accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM='missing window accepted' THEN RAISE;END IF;END;
  INSERT INTO public.availability(day_of_week,start_time,end_time,is_active) VALUES(EXTRACT(DOW FROM v_day),'20:00','08:00',true);
  BEGIN PERFORM public.booking_slots_range(v_day,v_day);RAISE EXCEPTION 'malformed agenda accepted';EXCEPTION WHEN raise_exception THEN IF SQLERRM='malformed agenda accepted' THEN RAISE;END IF;END;
  PERFORM pg_temp.calendar_assert(NOT pg_catalog.has_function_privilege('anon','public.booking_slots_range(date,date)','EXECUTE'),'anon cannot call DB calendar RPC');
  PERFORM pg_temp.calendar_assert(NOT pg_catalog.has_function_privilege('authenticated','public.booking_slots_range(date,date)','EXECUTE'),'authenticated cannot call DB calendar RPC');
  PERFORM pg_temp.calendar_assert(pg_catalog.has_function_privilege('service_role','public.booking_slots_range(date,date)','EXECUTE'),'service can query calendar');
END $$;
ROLLBACK;
