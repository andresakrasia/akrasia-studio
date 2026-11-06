-- Synthetic rows; this transaction runs only in the disposable local cluster.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.schedule_assert(p_value BOOLEAN,p_message TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN IF p_value IS DISTINCT FROM TRUE THEN RAISE EXCEPTION 'Admin schedule assertion: %',p_message; END IF; END $$;
DO $$
DECLARE v_day DATE:=(pg_catalog.clock_timestamp() AT TIME ZONE 'Europe/Madrid')::DATE+15;
  v_weekly UUID:='a2424242-0000-4000-8000-000000000001';
  v_opening UUID:='a2424242-0000-4000-8000-000000000002'; v_block UUID;
BEGIN
  DELETE FROM public.availability; DELETE FROM public.availability_overrides;
  INSERT INTO public.availability(id,day_of_week,start_time,end_time,is_active) VALUES(v_weekly,EXTRACT(DOW FROM v_day),'09:00','10:00',true);
  INSERT INTO public.availability_overrides(id,override_date,start_time,end_time,is_available) VALUES(v_opening,v_day,'15:00','16:00',true);
  PERFORM pg_temp.schedule_assert(public.booking_available(v_day,'09:00'),'weekly starts available');
  SET LOCAL ROLE service_role;
  UPDATE public.availability SET start_time='10:00',end_time='12:00',is_active=true WHERE id=v_weekly;
  INSERT INTO public.availability_overrides(override_date,start_time,end_time,is_available,note)
    VALUES(v_day,'10:30','11:00',false,'Synthetic partial block') RETURNING id INTO v_block;
  UPDATE public.availability_overrides SET start_time='14:00',end_time='15:00',note='Synthetic edited opening' WHERE id=v_opening;
  RESET ROLE;
  PERFORM pg_temp.schedule_assert(NOT public.booking_available(v_day,'09:00'),'weekly edits remove previous hours');
  PERFORM pg_temp.schedule_assert(public.booking_available(v_day,'10:00'),'edited weekly starts available');
  PERFORM pg_temp.schedule_assert(NOT public.booking_available(v_day,'10:30'),'partial block removes slot');
  PERFORM pg_temp.schedule_assert(public.booking_available(v_day,'14:00'),'edited date opening available');
  SET LOCAL ROLE service_role;
  UPDATE public.availability_overrides SET start_time=NULL,end_time=NULL WHERE id=v_block;
  RESET ROLE;
  PERFORM pg_temp.schedule_assert(NOT public.booking_available(v_day,'10:00') AND NOT public.booking_available(v_day,'14:00'),'full-day block takes precedence over weekly and date opening');
  SET LOCAL ROLE service_role;
  DELETE FROM public.availability_overrides WHERE id=v_block;
  UPDATE public.availability SET is_active=false WHERE id=v_weekly;
  DELETE FROM public.availability_overrides WHERE id=v_opening;
  RESET ROLE;
  PERFORM pg_temp.schedule_assert(NOT public.booking_available(v_day,'10:00'),'paused weekly hours are unavailable');
  PERFORM pg_temp.schedule_assert(NOT public.booking_available(v_day,'14:00'),'deleted opening unavailable');
  PERFORM pg_temp.schedule_assert(NOT pg_catalog.has_table_privilege('anon','public.availability_overrides','INSERT,UPDATE,DELETE'),'anon cannot modify date rules');
  PERFORM pg_temp.schedule_assert(NOT pg_catalog.has_table_privilege('authenticated','public.availability_overrides','INSERT,UPDATE,DELETE'),'authenticated cannot modify date rules');
  PERFORM pg_temp.schedule_assert(NOT pg_catalog.has_column_privilege('service_role','public.availability','id','UPDATE'),'weekly identities cannot be changed');
  PERFORM pg_temp.schedule_assert(NOT pg_catalog.has_column_privilege('service_role','public.availability_overrides','id','INSERT'),'server uses generated override identities');
  PERFORM pg_temp.schedule_assert(NOT pg_catalog.has_column_privilege('service_role','public.availability_overrides','created_at','UPDATE'),'override creation times cannot be changed');
  PERFORM pg_temp.schedule_assert((SELECT COUNT(*)=2 FROM pg_catalog.pg_trigger WHERE tgname IN('availability_schedule_lock','overrides_schedule_lock') AND NOT tgisinternal),'schedule serialization still present');
END $$;
ROLLBACK;
