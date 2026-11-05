-- Calendar availability: all actual starts for one visible month or day.
-- Apply after v22. No schedules, reservations or notifications are changed.
BEGIN;
CREATE OR REPLACE FUNCTION public.booking_slots_range(p_start_date DATE,p_end_date DATE)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_date DATE; v_time TIME; v_result JSONB:='[]'::JSONB; v_min INTEGER;
  v_today DATE:=(pg_catalog.clock_timestamp() AT TIME ZONE 'Europe/Madrid')::DATE;
BEGIN
  IF p_start_date IS NULL OR p_end_date IS NULL OR
    p_start_date NOT BETWEEN '2000-01-01'::DATE AND '2199-12-31'::DATE OR
    p_end_date NOT BETWEEN '2000-01-01'::DATE AND '2199-12-31'::DATE OR
    p_end_date<p_start_date OR p_end_date-p_start_date>30 THEN RAISE EXCEPTION 'Invalid calendar query'; END IF;
  v_date:=GREATEST(p_start_date,v_today);
  WHILE v_date<=LEAST(p_end_date,v_today+180) LOOP
    FOR v_min IN 0..47 LOOP
      v_time:='00:00'::TIME+pg_catalog.make_interval(mins=>v_min*30);
      -- Reuse insertion's rule: weekly windows, exceptions, blocks, bookings,
      -- 30-minute duration/buffer, Madrid DST and past times stay authoritative.
      IF public.booking_available(v_date,v_time) THEN
        v_result:=v_result||pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('date',v_date::TEXT,
          'time',pg_catalog.to_char(v_date+v_time,'HH24:MI')));
      END IF;
    END LOOP;
    v_date:=v_date+1;
  END LOOP;
  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.booking_slots_range(DATE,DATE) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.booking_slots_range(DATE,DATE) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
