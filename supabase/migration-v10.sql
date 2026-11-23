-- A02: persistent chat quotas and concurrency shared by every serverless instance.
-- Apply as the database owner. No remote application is performed by this file.
-- Only service_role may execute the two RPCs; it has no direct table access.
-- p_input_units reserves the server's conservative INPUT + MAXIMUM OUTPUT estimate.
-- These units and request counts bound traffic, not the provider's monetary bill.
BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_quota_buckets (
  bucket TEXT PRIMARY KEY CHECK (bucket = 'global' OR bucket ~ '^(session|ip):[a-f0-9]{64}$'),
  requests BIGINT NOT NULL CHECK (requests >= 0),
  units BIGINT NOT NULL CHECK (units >= 0),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS chat_quota_buckets_expiry ON public.chat_quota_buckets(expires_at);
ALTER TABLE public.chat_quota_buckets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_quota_buckets FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.chat_concurrency_leases (
  lease_id UUID PRIMARY KEY,
  session_key TEXT NOT NULL CHECK (session_key ~ '^[a-f0-9]{64}$'),
  ip_key TEXT NOT NULL CHECK (ip_key ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS chat_concurrency_leases_expiry ON public.chat_concurrency_leases(expires_at);
CREATE INDEX IF NOT EXISTS chat_concurrency_leases_session ON public.chat_concurrency_leases(session_key, expires_at);
CREATE INDEX IF NOT EXISTS chat_concurrency_leases_ip ON public.chat_concurrency_leases(ip_key, expires_at);
ALTER TABLE public.chat_concurrency_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_concurrency_leases FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.chat_admit(
  p_session_key TEXT,
  p_ip_key TEXT,
  p_lease_id UUID,
  p_policy JSONB,
  p_input_units BIGINT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ;
  v_epoch NUMERIC;
  v_local_expiry TIMESTAMPTZ;
  v_global_expiry TIMESTAMPTZ;
  v_session public.chat_quota_buckets%ROWTYPE;
  v_ip public.chat_quota_buckets%ROWTYPE;
  v_global public.chat_quota_buckets%ROWTYPE;
  v_key TEXT;
  v_value NUMERIC;
  v_session_requests INTEGER;
  v_ip_requests INTEGER;
  v_global_requests INTEGER;
  v_global_units BIGINT;
  v_window_seconds INTEGER;
  v_global_window_seconds INTEGER;
  v_session_concurrency INTEGER;
  v_ip_concurrency INTEGER;
  v_global_concurrency INTEGER;
  v_lease_seconds INTEGER;
  v_session_active BIGINT;
  v_ip_active BIGINT;
  v_global_active BIGINT;
  v_retry INTEGER := 1;
  v_retry_at TIMESTAMPTZ;
  v_blocked BOOLEAN := false;
BEGIN
  IF p_session_key IS NULL OR p_session_key !~ '^[a-f0-9]{64}$'
     OR p_ip_key IS NULL OR p_ip_key !~ '^[a-f0-9]{64}$'
     OR p_lease_id IS NULL
     OR p_input_units IS NULL OR p_input_units < 1 OR p_input_units > 1000000000000 THEN
    RAISE EXCEPTION 'Invalid chat admission arguments';
  END IF;
  IF p_policy IS NULL OR pg_catalog.jsonb_typeof(p_policy) <> 'object' THEN
    RAISE EXCEPTION 'Invalid chat quota policy';
  END IF;
  -- This policy is server configuration, never a client-controlled request field.
  -- Reject missing, fractional, negative, string, boolean and out-of-range values.
  FOREACH v_key IN ARRAY ARRAY[
    'session_requests', 'ip_requests', 'global_requests', 'global_units',
    'window_seconds', 'global_window_seconds', 'session_concurrency',
    'ip_concurrency', 'global_concurrency', 'lease_seconds'
  ] LOOP
    IF pg_catalog.jsonb_typeof(p_policy -> v_key) IS DISTINCT FROM 'number'
       OR (p_policy ->> v_key) !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'Invalid chat quota policy';
    END IF;
    v_value := (p_policy ->> v_key)::NUMERIC;
    IF v_value < 1 OR v_value > (CASE v_key
      WHEN 'session_requests' THEN 1000000
      WHEN 'ip_requests' THEN 1000000
      WHEN 'global_requests' THEN 10000000
      WHEN 'global_units' THEN 1000000000000
      WHEN 'window_seconds' THEN 86400
      WHEN 'global_window_seconds' THEN 604800
      WHEN 'session_concurrency' THEN 100
      WHEN 'ip_concurrency' THEN 1000
      WHEN 'global_concurrency' THEN 10000
      WHEN 'lease_seconds' THEN 3600
      ELSE 0
    END) THEN
      RAISE EXCEPTION 'Invalid chat quota policy';
    END IF;
  END LOOP;
  v_session_requests := (p_policy ->> 'session_requests')::INTEGER;
  v_ip_requests := (p_policy ->> 'ip_requests')::INTEGER;
  v_global_requests := (p_policy ->> 'global_requests')::INTEGER;
  v_global_units := (p_policy ->> 'global_units')::BIGINT;
  v_window_seconds := (p_policy ->> 'window_seconds')::INTEGER;
  v_global_window_seconds := (p_policy ->> 'global_window_seconds')::INTEGER;
  v_session_concurrency := (p_policy ->> 'session_concurrency')::INTEGER;
  v_ip_concurrency := (p_policy ->> 'ip_concurrency')::INTEGER;
  v_global_concurrency := (p_policy ->> 'global_concurrency')::INTEGER;
  v_lease_seconds := (p_policy ->> 'lease_seconds')::INTEGER;
  IF v_lease_seconds < 5 THEN
    RAISE EXCEPTION 'Invalid chat quota policy';
  END IF;

  -- A single transaction lock makes every read/check/consume and release atomic.
  -- This namespace is separate from the existing administrative login lock.
  PERFORM pg_catalog.pg_advisory_xact_lock(724612083942::BIGINT);
  v_now := pg_catalog.clock_timestamp();
  v_epoch := EXTRACT(EPOCH FROM v_now);
  v_local_expiry := pg_catalog.to_timestamp(
    ((pg_catalog.floor(v_epoch / v_window_seconds) + 1) * v_window_seconds)::DOUBLE PRECISION
  );
  v_global_expiry := pg_catalog.to_timestamp(
    ((pg_catalog.floor(v_epoch / v_global_window_seconds) + 1) * v_global_window_seconds)::DOUBLE PRECISION
  );
  DELETE FROM public.chat_quota_buckets WHERE expires_at <= v_now;
  DELETE FROM public.chat_concurrency_leases WHERE expires_at <= v_now;

  -- An RPC retry with an already active UUID cannot authorize a second paid call.
  SELECT expires_at INTO v_retry_at FROM public.chat_concurrency_leases WHERE lease_id = p_lease_id;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'allowed', false, 'reason', 'busy',
      'retry_after', GREATEST(1, pg_catalog.ceil(EXTRACT(EPOCH FROM (v_retry_at - v_now)))::INTEGER)
    );
  END IF;
  SELECT * INTO v_session FROM public.chat_quota_buckets WHERE bucket = 'session:' || p_session_key;
  SELECT * INTO v_ip FROM public.chat_quota_buckets WHERE bucket = 'ip:' || p_ip_key;
  SELECT * INTO v_global FROM public.chat_quota_buckets WHERE bucket = 'global';

  IF COALESCE(v_session.requests, 0) >= v_session_requests THEN
    v_blocked := true;
    v_retry := GREATEST(v_retry, pg_catalog.ceil(EXTRACT(EPOCH FROM (v_session.expires_at - v_now)))::INTEGER);
  END IF;
  IF COALESCE(v_ip.requests, 0) >= v_ip_requests THEN
    v_blocked := true;
    v_retry := GREATEST(v_retry, pg_catalog.ceil(EXTRACT(EPOCH FROM (v_ip.expires_at - v_now)))::INTEGER);
  END IF;
  IF COALESCE(v_global.requests, 0) >= v_global_requests
     OR COALESCE(v_global.units, 0) + p_input_units > v_global_units THEN
    v_blocked := true;
    v_retry := GREATEST(v_retry, pg_catalog.ceil(EXTRACT(EPOCH FROM (COALESCE(v_global.expires_at, v_global_expiry) - v_now)))::INTEGER);
  END IF;
  IF v_blocked THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'rate', 'retry_after', v_retry);
  END IF;

  SELECT COUNT(*) INTO v_session_active FROM public.chat_concurrency_leases WHERE session_key = p_session_key;
  SELECT COUNT(*) INTO v_ip_active FROM public.chat_concurrency_leases WHERE ip_key = p_ip_key;
  SELECT COUNT(*) INTO v_global_active FROM public.chat_concurrency_leases;
  IF v_session_active >= v_session_concurrency THEN
    v_blocked := true;
    SELECT expires_at INTO v_retry_at FROM public.chat_concurrency_leases
      WHERE session_key = p_session_key ORDER BY expires_at
      OFFSET (v_session_active - v_session_concurrency) LIMIT 1;
    v_retry := GREATEST(v_retry, pg_catalog.ceil(EXTRACT(EPOCH FROM (v_retry_at - v_now)))::INTEGER);
  END IF;
  IF v_ip_active >= v_ip_concurrency THEN
    v_blocked := true;
    SELECT expires_at INTO v_retry_at FROM public.chat_concurrency_leases
      WHERE ip_key = p_ip_key ORDER BY expires_at
      OFFSET (v_ip_active - v_ip_concurrency) LIMIT 1;
    v_retry := GREATEST(v_retry, pg_catalog.ceil(EXTRACT(EPOCH FROM (v_retry_at - v_now)))::INTEGER);
  END IF;
  IF v_global_active >= v_global_concurrency THEN
    v_blocked := true;
    SELECT expires_at INTO v_retry_at FROM public.chat_concurrency_leases
      ORDER BY expires_at OFFSET (v_global_active - v_global_concurrency) LIMIT 1;
    v_retry := GREATEST(v_retry, pg_catalog.ceil(EXTRACT(EPOCH FROM (v_retry_at - v_now)))::INTEGER);
  END IF;
  IF v_blocked THEN
    RETURN pg_catalog.jsonb_build_object('allowed', false, 'reason', 'busy', 'retry_after', v_retry);
  END IF;

  -- Stable keys prevent policy/version changes from creating separate live buckets.
  -- Existing live expiry is retained; only new buckets use the current fixed window.
  -- Provider failures, cancellation and release do not refund consumed quotas.
  INSERT INTO public.chat_quota_buckets AS current_bucket (bucket, requests, units, expires_at)
    VALUES ('session:' || p_session_key, 1, 0, v_local_expiry),
           ('ip:' || p_ip_key, 1, 0, v_local_expiry),
           ('global', 1, p_input_units, v_global_expiry)
    ON CONFLICT (bucket) DO UPDATE SET
      requests = current_bucket.requests + EXCLUDED.requests,
      units = current_bucket.units + EXCLUDED.units;
  INSERT INTO public.chat_concurrency_leases(lease_id, session_key, ip_key, created_at, expires_at)
    VALUES (p_lease_id, p_session_key, p_ip_key, v_now, v_now + pg_catalog.make_interval(secs => v_lease_seconds));
  RETURN pg_catalog.jsonb_build_object('allowed', true, 'reason', NULL, 'retry_after', 0);
END;
$$;
REVOKE ALL ON FUNCTION public.chat_admit(TEXT, TEXT, UUID, JSONB, BIGINT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_admit(TEXT, TEXT, UUID, JSONB, BIGINT) TO service_role;

CREATE OR REPLACE FUNCTION public.chat_release(p_lease_id UUID)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_lease_id IS NULL THEN
    RAISE EXCEPTION 'Invalid chat lease';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(724612083942::BIGINT);
  DELETE FROM public.chat_concurrency_leases WHERE lease_id = p_lease_id;
END;
$$;
REVOKE ALL ON FUNCTION public.chat_release(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_release(UUID) TO service_role;

-- IMPORTANT: the server must abort and fully settle provider calls before release.
-- Its entire request deadline (including admission latency) must be shorter than
-- lease_seconds, with margin. Expiry only recovers crashes; SQL cannot cancel AI.
-- On missing RPC, database failure or invalid result, the server must fail closed.
COMMIT;
