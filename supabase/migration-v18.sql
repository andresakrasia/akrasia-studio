-- A09/A41: one bounded maintenance transaction includes every operation receipt.
-- No cleanup runs while applying the migration; a reviewed job must invoke it.
BEGIN;
CREATE OR REPLACE FUNCTION public.integration_retention(p_days INTEGER,p_limit INTEGER)
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_count INTEGER;
BEGIN
  IF p_days IS NULL OR p_days NOT BETWEEN 1 AND 730 OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid retention';
  END IF;
  -- A stalled queue must not retain personal email payloads indefinitely.
  -- Active deliveries remain fenced until their lease expires.
  DELETE FROM public.integration_outbox WHERE id IN (
    SELECT id FROM public.integration_outbox
    WHERE created_at < pg_catalog.now()-pg_catalog.make_interval(days=>p_days)
      AND (status<>'sending' OR lease_until IS NULL OR lease_until<=pg_catalog.now())
    ORDER BY created_at,id LIMIT p_limit FOR UPDATE SKIP LOCKED
  );
  GET DIAGNOSTICS v_count=ROW_COUNT;
  RETURN v_count;
END $$;
CREATE OR REPLACE FUNCTION public.production_retention_batch(p_chat_days INTEGER,p_profile_days INTEGER,p_notification_days INTEGER,p_batch_size INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_result JSONB; v_outbox INTEGER:=0; v_operations INTEGER:=0; v_ai INTEGER:=0;
BEGIN
  v_result:=public.chat_retention_batch(p_chat_days,p_profile_days,p_notification_days,p_batch_size);
  IF COALESCE((v_result->>'deferred')::BOOLEAN,false) THEN
    RETURN v_result || pg_catalog.jsonb_build_object('outbox',0,'chat_operations',0,'dashboard_operations',0);
  END IF;
  v_outbox:=public.integration_retention(p_notification_days,p_batch_size);
  v_operations:=public.chat_operations_retention(p_batch_size);
  -- Proposal receipts contain entity references; retain at most 30 days.
  DELETE FROM public.dashboard_ai_operations WHERE id IN (
    SELECT id FROM public.dashboard_ai_operations WHERE created_at<pg_catalog.now()-INTERVAL '30 days'
    ORDER BY created_at,id LIMIT p_batch_size FOR UPDATE SKIP LOCKED
  );
  GET DIAGNOSTICS v_ai=ROW_COUNT;
  RETURN v_result || pg_catalog.jsonb_build_object('outbox',v_outbox,'chat_operations',v_operations,'dashboard_operations',v_ai);
END $$;
REVOKE ALL ON FUNCTION public.integration_retention(INTEGER,INTEGER),
  public.production_retention_batch(INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.integration_retention(INTEGER,INTEGER),
  public.production_retention_batch(INTEGER,INTEGER,INTEGER,INTEGER) TO service_role;
COMMIT;
