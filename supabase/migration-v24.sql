-- Admin edits weekly hours and opens/blocks specific dates.
-- Existing server-only RLS and booking_schedule_lock triggers remain in force.
-- Apply after v23. No schedule, booking or notification rows are changed.
BEGIN;
GRANT UPDATE(day_of_week,start_time,end_time,is_active) ON public.availability TO service_role;
GRANT INSERT(override_date,start_time,end_time,is_available,note),
      UPDATE(override_date,start_time,end_time,is_available,note), DELETE
  ON public.availability_overrides TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
