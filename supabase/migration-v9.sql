-- A01: private, revocable dashboard sessions and an atomic login limit.
-- Run as the database owner; only the server's service_role can access these objects.
BEGIN;

CREATE TABLE IF NOT EXISTS public.dashboard_sessions (
  token_hash TEXT PRIMARY KEY CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  credential_version TEXT NOT NULL CHECK (credential_version ~ '^[a-f0-9]{64}$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS dashboard_sessions_expiry ON public.dashboard_sessions(expires_at);
ALTER TABLE public.dashboard_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_sessions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.dashboard_sessions TO service_role;

CREATE TABLE IF NOT EXISTS public.dashboard_login_limits (
  bucket TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  expires_at TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.dashboard_login_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_login_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.dashboard_login_limits FROM service_role;

CREATE OR REPLACE FUNCTION public.dashboard_consume_login_attempt(p_ip_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_ip public.dashboard_login_limits%ROWTYPE;
  v_global public.dashboard_login_limits%ROWTYPE;
  v_retry INTEGER := 1;
BEGIN
  IF p_ip_key IS NULL OR p_ip_key !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'Invalid rate limit key';
  END IF;
  -- All instances acquire the same transaction lock before consuming both buckets.
  PERFORM pg_catalog.pg_advisory_xact_lock(724612083941::bigint);
  v_now := clock_timestamp();
  DELETE FROM public.dashboard_login_limits WHERE expires_at <= v_now;
  DELETE FROM public.dashboard_sessions WHERE expires_at <= v_now;
  SELECT * INTO v_ip FROM public.dashboard_login_limits WHERE bucket = 'ip:' || p_ip_key;
  SELECT * INTO v_global FROM public.dashboard_login_limits WHERE bucket = 'global';
  IF COALESCE(v_ip.attempts, 0) >= 5 OR COALESCE(v_global.attempts, 0) >= 30 THEN
    IF COALESCE(v_ip.attempts, 0) >= 5 THEN
      v_retry := GREATEST(v_retry, ceil(extract(epoch FROM (v_ip.expires_at - v_now)))::integer);
    END IF;
    IF COALESCE(v_global.attempts, 0) >= 30 THEN
      v_retry := GREATEST(v_retry, ceil(extract(epoch FROM (v_global.expires_at - v_now)))::integer);
    END IF;
    RETURN jsonb_build_object('allowed', false, 'retry_after', v_retry);
  END IF;
  INSERT INTO public.dashboard_login_limits(bucket, attempts, expires_at)
    VALUES ('ip:' || p_ip_key, 1, v_now + interval '15 minutes'),
           ('global', 1, v_now + interval '15 minutes')
    ON CONFLICT (bucket) DO UPDATE SET attempts = dashboard_login_limits.attempts + 1;
  RETURN jsonb_build_object('allowed', true, 'retry_after', 0);
END;
$$;
REVOKE ALL ON FUNCTION public.dashboard_consume_login_attempt(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_consume_login_attempt(TEXT) TO service_role;

COMMIT;
