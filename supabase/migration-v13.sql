-- A09: transactional chat erasure, persistent generations and bounded retention.
-- Apply only after owner review, v1-v12, and the local synthetic SQL checks.
-- This file preserves existing content; no migration-time cleanup is performed.
BEGIN;

CREATE TABLE IF NOT EXISTS public.chat_context_states (
  visitor_id TEXT PRIMARY KEY CHECK (visitor_id ~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'),
  context_version INTEGER NOT NULL DEFAULT 0 CHECK (context_version >= 0),
  last_erased_version INTEGER,
  expires_at TIMESTAMPTZ NOT NULL,
  cleanup_after TIMESTAMPTZ NOT NULL
);
ALTER TABLE public.chat_context_states ADD COLUMN IF NOT EXISTS last_erased_version INTEGER;
CREATE INDEX IF NOT EXISTS chat_context_states_cleanup ON public.chat_context_states(cleanup_after);
ALTER TABLE public.chat_context_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_context_states FROM PUBLIC, anon, authenticated, service_role;
-- NULL preserves every existing reservation. A responsible person must set an
-- individually reviewed date only after deciding its independent legal policy.
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS privacy_retention_until TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS bookings_privacy_retention ON public.bookings(privacy_retention_until)
  WHERE status IN ('completed', 'cancelled') AND privacy_retention_until IS NOT NULL;
CREATE INDEX IF NOT EXISTS conversations_retention ON public.conversations(updated_at);
CREATE INDEX IF NOT EXISTS leads_retention ON public.leads(updated_at,id) WHERE COALESCE(source,'web') = 'web';
CREATE INDEX IF NOT EXISTS bookings_lead_reference ON public.bookings(lead_id);
CREATE INDEX IF NOT EXISTS bookings_conversation_reference ON public.bookings(conversation_id);
CREATE INDEX IF NOT EXISTS leads_conversation_reference ON public.leads(conversation_id);
DO $a09_table_acl$
DECLARE v_column RECORD; v_owner OID; v_role TEXT;
BEGIN
  -- Table REVOKE alone does not remove legacy column-level privileges.
  FOR v_column IN SELECT attname FROM pg_catalog.pg_attribute WHERE attrelid = 'public.chat_context_states'::regclass AND attnum > 0 AND NOT attisdropped LOOP
    EXECUTE pg_catalog.format('REVOKE SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.chat_context_states FROM PUBLIC, anon, authenticated, service_role',
      v_column.attname, v_column.attname, v_column.attname, v_column.attname);
  END LOOP;
  SELECT relowner INTO v_owner FROM pg_catalog.pg_class WHERE oid='public.chat_context_states'::regclass;
  FOREACH v_role IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF pg_catalog.pg_has_role(v_role,v_owner,'MEMBER') OR
      pg_catalog.has_table_privilege(v_role,'public.chat_context_states','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR
      pg_catalog.has_any_column_privilege(v_role,'public.chat_context_states','SELECT,INSERT,UPDATE,REFERENCES') THEN
      RAISE EXCEPTION 'A09: unexpected effective state table privilege/ownership';
    END IF;
  END LOOP;
END;
$a09_table_acl$;

CREATE OR REPLACE FUNCTION public.chat_context_state(p_visitor_id TEXT, p_expires_at BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_expiry TIMESTAMPTZ; v_version INTEGER;
BEGIN
  IF p_visitor_id IS NULL OR p_visitor_id !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
     OR p_expires_at IS NULL OR p_expires_at <= EXTRACT(EPOCH FROM pg_catalog.clock_timestamp())
     OR p_expires_at > EXTRACT(EPOCH FROM pg_catalog.clock_timestamp()) + 2592001 THEN
    RAISE EXCEPTION 'Invalid chat state';
  END IF;
  v_expiry := pg_catalog.to_timestamp(p_expires_at::DOUBLE PRECISION);
  INSERT INTO public.chat_context_states(visitor_id, expires_at, cleanup_after)
    VALUES(p_visitor_id, v_expiry, v_expiry + INTERVAL '7 days')
    ON CONFLICT(visitor_id) DO NOTHING;
  -- No refresh on every request: expiry follows the signed session and the
  -- seven-day maximum quota window. Deletion never changes either quota key.
  SELECT context_version INTO v_version FROM public.chat_context_states WHERE visitor_id = p_visitor_id;
  RETURN pg_catalog.jsonb_build_object('contextVersion', v_version);
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_erase_context(p_visitor_id TEXT, p_expires_at BIGINT, p_context_version INTEGER, p_session_key TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_version INTEGER; v_last_erased INTEGER; v_now TIMESTAMPTZ; v_retry_at TIMESTAMPTZ;
BEGIN
  IF p_session_key IS NULL OR p_session_key !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid chat session key'; END IF;
  -- Same lock/order as A02 admission. An admitted request may have read the old
  -- context but not yet dispatched to its provider; its lease fences deletion.
  PERFORM pg_catalog.pg_advisory_xact_lock(724612083942::BIGINT);
  v_now := pg_catalog.clock_timestamp();
  PERFORM public.chat_context_state(p_visitor_id, p_expires_at);
  SELECT context_version, last_erased_version INTO v_version, v_last_erased FROM public.chat_context_states WHERE visitor_id = p_visitor_id FOR UPDATE;
  IF p_context_version IS NULL OR p_context_version < 0 THEN RAISE EXCEPTION 'Invalid context version'; END IF;
  -- An ambiguous client retry can acknowledge the already completed deletion,
  -- but cannot delete any newer turn created after that deletion.
  IF v_version = p_context_version + 1 AND v_last_erased = p_context_version THEN RETURN pg_catalog.jsonb_build_object('contextVersion', v_version); END IF;
  IF v_version <> p_context_version OR v_version >= 2147483646 THEN
    RETURN pg_catalog.jsonb_build_object('error', 'chat_context_changed');
  END IF;
  SELECT MIN(expires_at) INTO v_retry_at FROM public.chat_concurrency_leases WHERE session_key = p_session_key AND expires_at > v_now;
  IF v_retry_at IS NOT NULL THEN
    RETURN pg_catalog.jsonb_build_object('error','chat_busy','retry_after',LEAST(3600,GREATEST(1,pg_catalog.ceil(EXTRACT(EPOCH FROM (v_retry_at-v_now)))::INTEGER)));
  END IF;
  UPDATE public.bookings SET conversation_id = NULL
    WHERE visitor_id = p_visitor_id AND conversation_id IN (SELECT id FROM public.conversations WHERE visitor_id = p_visitor_id);
  UPDATE public.bookings SET lead_id = NULL
    WHERE visitor_id = p_visitor_id AND lead_id IN (SELECT id FROM public.leads WHERE visitor_id = p_visitor_id AND COALESCE(source, 'web') = 'web');
  UPDATE public.sent_emails SET lead_id = NULL
    WHERE (visitor_id = p_visitor_id OR visitor_id IS NULL) AND lead_id IN (SELECT id FROM public.leads WHERE visitor_id = p_visitor_id AND COALESCE(source, 'web') = 'web');
  DELETE FROM public.leads WHERE visitor_id = p_visitor_id AND COALESCE(source, 'web') = 'web';
  -- Contacts from another channel remain independently held, without chat FK.
  UPDATE public.leads SET conversation_id = NULL WHERE visitor_id = p_visitor_id;
  DELETE FROM public.conversations WHERE visitor_id = p_visitor_id;
  UPDATE public.visitors SET page_views = 0, source = 'chat', first_seen = pg_catalog.now(), last_seen = pg_catalog.now()
    WHERE visitor_id = p_visitor_id;
  UPDATE public.chat_context_states SET context_version = context_version + 1, last_erased_version = p_context_version WHERE visitor_id = p_visitor_id;
  RETURN pg_catalog.jsonb_build_object('contextVersion', v_version + 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_save_turn(p_visitor_id TEXT, p_expires_at BIGINT, p_context_version INTEGER,
  p_user_content TEXT, p_assistant_content TEXT, p_lead JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_version INTEGER; v_conversation UUID; v_lead UUID;
BEGIN
  PERFORM public.chat_context_state(p_visitor_id, p_expires_at);
  SELECT context_version INTO v_version FROM public.chat_context_states WHERE visitor_id = p_visitor_id FOR UPDATE;
  IF p_context_version IS NULL OR v_version <> p_context_version THEN RETURN pg_catalog.jsonb_build_object('error', 'chat_context_changed'); END IF;
  IF p_user_content IS NULL OR pg_catalog.length(p_user_content) NOT BETWEEN 1 AND 8000
     OR p_assistant_content IS NULL OR pg_catalog.octet_length(p_assistant_content) NOT BETWEEN 1 AND 16000 THEN
    RAISE EXCEPTION 'Invalid chat turn';
  END IF;
  IF p_lead IS NOT NULL AND (pg_catalog.jsonb_typeof(p_lead) <> 'object' OR
    EXISTS (SELECT 1 FROM pg_catalog.jsonb_object_keys(p_lead) k WHERE k NOT IN ('email','phone','name','project_type','status','budget_mentioned')) OR
    EXISTS (SELECT 1 FROM pg_catalog.jsonb_each(p_lead) e WHERE pg_catalog.jsonb_typeof(e.value) NOT IN ('string','null')) OR
    pg_catalog.octet_length(p_lead::TEXT) > 2048 OR (p_lead->>'status' IS NOT NULL AND p_lead->>'status' <> 'hot')) THEN
    RAISE EXCEPTION 'Invalid derived profile';
  END IF;
  INSERT INTO public.visitors(visitor_id, last_seen, page_views) VALUES(p_visitor_id, pg_catalog.now(), 1)
    ON CONFLICT(visitor_id) DO UPDATE SET last_seen = pg_catalog.now();
  SELECT id INTO v_conversation FROM public.conversations WHERE visitor_id = p_visitor_id
    AND created_at >= pg_catalog.date_trunc('day', pg_catalog.now()) ORDER BY created_at DESC, id DESC LIMIT 1;
  IF v_conversation IS NULL THEN
    INSERT INTO public.conversations(visitor_id) VALUES(p_visitor_id) RETURNING id INTO v_conversation;
  END IF;
  INSERT INTO public.messages(conversation_id, role, content) VALUES(v_conversation, 'user', p_user_content), (v_conversation, 'assistant', p_assistant_content);
  UPDATE public.conversations SET updated_at = pg_catalog.now(), message_count = message_count + 2 WHERE id = v_conversation AND visitor_id = p_visitor_id;
  IF p_lead IS NOT NULL THEN
    SELECT id INTO v_lead FROM public.leads WHERE visitor_id = p_visitor_id AND COALESCE(source, 'web') = 'web' ORDER BY updated_at DESC, id DESC LIMIT 1;
    IF v_lead IS NULL THEN
      INSERT INTO public.leads(visitor_id, conversation_id, source, email, phone, name, project_type, status, budget_mentioned)
        VALUES(p_visitor_id, v_conversation, 'web', p_lead->>'email', p_lead->>'phone', p_lead->>'name', p_lead->>'project_type', COALESCE(p_lead->>'status', 'new'), p_lead->>'budget_mentioned');
    ELSE
      UPDATE public.leads SET conversation_id = v_conversation, updated_at = pg_catalog.now(),
        email = COALESCE(p_lead->>'email', email), phone = COALESCE(p_lead->>'phone', phone), name = COALESCE(p_lead->>'name', name),
        project_type = COALESCE(p_lead->>'project_type', project_type), status = COALESCE(p_lead->>'status', status),
        budget_mentioned = COALESCE(p_lead->>'budget_mentioned', budget_mentioned) WHERE id = v_lead AND visitor_id = p_visitor_id;
    END IF;
  END IF;
  RETURN pg_catalog.jsonb_build_object('saved', true, 'contextVersion', v_version);
END;
$$;

-- Called only for a verified, user-confirmed, session/version-bound proposal.
-- Availability still uses A07's checks; distinct-proposal overlap remains A13.
CREATE OR REPLACE FUNCTION public.chat_insert_booking(p_visitor_id TEXT, p_expires_at BIGINT, p_context_version INTEGER, p_booking JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_version INTEGER; v_booking public.bookings%ROWTYPE;
BEGIN
  PERFORM public.chat_context_state(p_visitor_id, p_expires_at);
  SELECT context_version INTO v_version FROM public.chat_context_states WHERE visitor_id = p_visitor_id FOR UPDATE;
  IF p_context_version IS NULL OR v_version <> p_context_version THEN RETURN pg_catalog.jsonb_build_object('error', 'chat_context_changed'); END IF;
  IF p_booking IS NULL OR pg_catalog.jsonb_typeof(p_booking) <> 'object'
     OR p_booking->>'visitor_id' IS DISTINCT FROM p_visitor_id OR p_booking->>'status' IS DISTINCT FROM 'confirmed'
     OR p_booking->>'conversation_id' IS NOT NULL OR p_booking->>'lead_id' IS NOT NULL
     OR p_booking->>'duration_min' IS DISTINCT FROM '30' OR p_booking->>'buffer_min' IS DISTINCT FROM '30'
     OR p_booking->>'visitor_phone' IS NOT NULL OR p_booking->>'notes' IS NOT NULL
     OR pg_catalog.octet_length(p_booking::TEXT) > 2048 THEN RAISE EXCEPTION 'Invalid chat booking'; END IF;
  INSERT INTO public.visitors(visitor_id) VALUES(p_visitor_id) ON CONFLICT(visitor_id) DO NOTHING;
  INSERT INTO public.bookings(id, visitor_id, booked_date, booked_time, duration_min, buffer_min, status, meet_url, visitor_email, visitor_name)
    VALUES((p_booking->>'id')::UUID, p_visitor_id, (p_booking->>'booked_date')::DATE, (p_booking->>'booked_time')::TIME,
      30, 30, 'confirmed', p_booking->>'meet_url', p_booking->>'visitor_email', p_booking->>'visitor_name') RETURNING * INTO v_booking;
  RETURN pg_catalog.jsonb_build_array(pg_catalog.to_jsonb(v_booking));
END;
$$;

CREATE OR REPLACE FUNCTION public.chat_retention_batch(p_chat_days INTEGER, p_profile_days INTEGER, p_notification_days INTEGER, p_batch_size INTEGER)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now TIMESTAMPTZ := pg_catalog.now(); v_ids UUID[]; v_owners TEXT[]; v_owner TEXT;
  v_messages INTEGER := 0; v_conversations INTEGER := 0; v_profiles INTEGER := 0; v_notifications INTEGER := 0;
  v_bookings INTEGER := 0; v_states INTEGER := 0; v_visitors INTEGER := 0; v_quota INTEGER := 0; v_leases INTEGER := 0;
BEGIN
  IF p_chat_days IS NULL OR p_chat_days NOT BETWEEN 1 AND 365 OR p_profile_days IS NULL OR p_profile_days NOT BETWEEN 1 AND 730
     OR p_notification_days IS NULL OR p_notification_days NOT BETWEEN 1 AND 730 OR p_batch_size IS NULL OR p_batch_size NOT BETWEEN 1 AND 500 THEN
    RAISE EXCEPTION 'Invalid retention policy';
  END IF;
  -- Same namespace as A02. Expired entries only; live quotas never reset.
  PERFORM pg_catalog.pg_advisory_xact_lock(724612083942::BIGINT);
  -- Retention is also context erasure. A conservative global lease fence avoids
  -- sending a snapshot selected before cleanup after a successful cleanup.
  IF EXISTS(SELECT 1 FROM public.chat_concurrency_leases WHERE expires_at > pg_catalog.clock_timestamp()) THEN
    RETURN pg_catalog.jsonb_build_object('messages',0,'conversations',0,'profiles',0,'notifications',0,'bookings',0,'states',0,'visitors',0,'quota_buckets',0,'leases',0,'deferred',true);
  END IF;
  SELECT COALESCE(pg_catalog.array_agg(id), ARRAY[]::UUID[]) INTO v_ids FROM
    (SELECT id FROM public.messages WHERE created_at < v_now - pg_catalog.make_interval(days => p_chat_days) ORDER BY created_at,id LIMIT p_batch_size) candidates;
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT c.visitor_id ORDER BY c.visitor_id), ARRAY[]::TEXT[]) INTO v_owners
    FROM public.messages m JOIN public.conversations c ON c.id = m.conversation_id WHERE m.id = ANY(v_ids) AND c.visitor_id IS NOT NULL;
  FOREACH v_owner IN ARRAY v_owners LOOP
    INSERT INTO public.chat_context_states(visitor_id, context_version, expires_at, cleanup_after)
      VALUES(v_owner, 0, v_now + INTERVAL '30 days', v_now + INTERVAL '37 days') ON CONFLICT(visitor_id) DO NOTHING;
    PERFORM 1 FROM public.chat_context_states WHERE visitor_id = v_owner FOR UPDATE;
  END LOOP;
  DELETE FROM public.messages WHERE id = ANY(v_ids); GET DIAGNOSTICS v_messages = ROW_COUNT;
  UPDATE public.chat_context_states SET context_version = context_version + 1 WHERE visitor_id = ANY(v_owners);

  SELECT COALESCE(pg_catalog.array_agg(id), ARRAY[]::UUID[]) INTO v_ids FROM
    (SELECT c.id FROM public.conversations c WHERE c.updated_at < v_now - pg_catalog.make_interval(days => p_chat_days)
      AND NOT EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id) ORDER BY c.updated_at,c.id LIMIT p_batch_size) candidates;
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT visitor_id ORDER BY visitor_id), ARRAY[]::TEXT[]) INTO v_owners FROM public.conversations WHERE id = ANY(v_ids) AND visitor_id IS NOT NULL;
  FOREACH v_owner IN ARRAY v_owners LOOP
    INSERT INTO public.chat_context_states(visitor_id, context_version, expires_at, cleanup_after)
      VALUES(v_owner, 0, v_now + INTERVAL '30 days', v_now + INTERVAL '37 days') ON CONFLICT(visitor_id) DO NOTHING;
    PERFORM 1 FROM public.chat_context_states WHERE visitor_id = v_owner FOR UPDATE;
  END LOOP;
  -- Recheck after locking: a concurrent fresh turn must never be removed by
  -- ON DELETE CASCADE merely because this conversation was empty earlier.
  SELECT COALESCE(pg_catalog.array_agg(id), ARRAY[]::UUID[]) INTO v_ids FROM public.conversations c
    WHERE id = ANY(v_ids) AND updated_at < v_now - pg_catalog.make_interval(days => p_chat_days)
      AND NOT EXISTS(SELECT 1 FROM public.messages m WHERE m.conversation_id = c.id);
  UPDATE public.bookings SET conversation_id = NULL WHERE conversation_id = ANY(v_ids);
  UPDATE public.leads SET conversation_id = NULL WHERE conversation_id = ANY(v_ids);
  DELETE FROM public.conversations WHERE id = ANY(v_ids); GET DIAGNOSTICS v_conversations = ROW_COUNT;

  SELECT COALESCE(pg_catalog.array_agg(id), ARRAY[]::UUID[]) INTO v_ids FROM
    (SELECT id FROM public.leads WHERE COALESCE(source,'web') = 'web' AND updated_at < v_now - pg_catalog.make_interval(days => p_profile_days)
      ORDER BY updated_at,id LIMIT p_batch_size) candidates;
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT visitor_id ORDER BY visitor_id), ARRAY[]::TEXT[]) INTO v_owners FROM public.leads WHERE id = ANY(v_ids) AND visitor_id IS NOT NULL;
  FOREACH v_owner IN ARRAY v_owners LOOP
    INSERT INTO public.chat_context_states(visitor_id, context_version, expires_at, cleanup_after)
      VALUES(v_owner, 0, v_now + INTERVAL '30 days', v_now + INTERVAL '37 days') ON CONFLICT(visitor_id) DO NOTHING;
    PERFORM 1 FROM public.chat_context_states WHERE visitor_id = v_owner FOR UPDATE;
  END LOOP;
  SELECT COALESCE(pg_catalog.array_agg(id), ARRAY[]::UUID[]) INTO v_ids FROM
    (SELECT id FROM public.leads WHERE id = ANY(v_ids) AND COALESCE(source,'web') = 'web'
      AND updated_at < v_now - pg_catalog.make_interval(days => p_profile_days) FOR UPDATE) locked_profiles;
  UPDATE public.bookings SET lead_id = NULL WHERE lead_id = ANY(v_ids);
  UPDATE public.sent_emails SET lead_id = NULL WHERE lead_id = ANY(v_ids);
  DELETE FROM public.leads WHERE id = ANY(v_ids) AND COALESCE(source,'web') = 'web'
    AND updated_at < v_now - pg_catalog.make_interval(days => p_profile_days); GET DIAGNOSTICS v_profiles = ROW_COUNT;
  UPDATE public.chat_context_states SET context_version = context_version + 1 WHERE visitor_id = ANY(v_owners);

  DELETE FROM public.sent_emails WHERE id IN (SELECT id FROM public.sent_emails WHERE created_at < v_now - pg_catalog.make_interval(days => p_notification_days) ORDER BY created_at,id LIMIT p_batch_size);
  GET DIAGNOSTICS v_notifications = ROW_COUNT;
  DELETE FROM public.bookings WHERE status IN ('completed','cancelled') AND privacy_retention_until <= v_now
    AND id IN (SELECT id FROM public.bookings WHERE status IN ('completed','cancelled') AND privacy_retention_until <= v_now ORDER BY privacy_retention_until,id LIMIT p_batch_size);
  GET DIAGNOSTICS v_bookings = ROW_COUNT;
  DELETE FROM public.chat_context_states WHERE visitor_id IN (SELECT visitor_id FROM public.chat_context_states WHERE cleanup_after <= v_now ORDER BY cleanup_after,visitor_id LIMIT p_batch_size);
  GET DIAGNOSTICS v_states = ROW_COUNT;
  -- No browsing statistics remain after erasure. Remove even the minimal FK
  -- identity once no independent purpose holds it and max session+quota ended.
  DELETE FROM public.visitors WHERE visitor_id IN (SELECT v.visitor_id FROM public.visitors v
    WHERE v.last_seen < v_now - INTERVAL '37 days'
      AND NOT EXISTS(SELECT 1 FROM public.chat_context_states s WHERE s.visitor_id = v.visitor_id)
      AND NOT EXISTS(SELECT 1 FROM public.conversations c WHERE c.visitor_id = v.visitor_id)
      AND NOT EXISTS(SELECT 1 FROM public.leads l WHERE l.visitor_id = v.visitor_id)
      AND NOT EXISTS(SELECT 1 FROM public.bookings b WHERE b.visitor_id = v.visitor_id)
      AND NOT EXISTS(SELECT 1 FROM public.sent_emails e WHERE e.visitor_id = v.visitor_id)
    ORDER BY v.last_seen,v.visitor_id LIMIT p_batch_size);
  GET DIAGNOSTICS v_visitors = ROW_COUNT;
  DELETE FROM public.chat_quota_buckets WHERE bucket IN (SELECT bucket FROM public.chat_quota_buckets WHERE expires_at <= v_now ORDER BY expires_at,bucket LIMIT p_batch_size);
  GET DIAGNOSTICS v_quota = ROW_COUNT;
  DELETE FROM public.chat_concurrency_leases WHERE lease_id IN (SELECT lease_id FROM public.chat_concurrency_leases WHERE expires_at <= v_now ORDER BY expires_at,lease_id LIMIT p_batch_size);
  GET DIAGNOSTICS v_leases = ROW_COUNT;
  RETURN pg_catalog.jsonb_build_object('messages',v_messages,'conversations',v_conversations,'profiles',v_profiles,'notifications',v_notifications,
    'bookings',v_bookings,'states',v_states,'visitors',v_visitors,'quota_buckets',v_quota,'leases',v_leases);
END;
$$;

REVOKE ALL ON FUNCTION public.chat_context_state(TEXT,BIGINT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_erase_context(TEXT,BIGINT,INTEGER,TEXT) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_save_turn(TEXT,BIGINT,INTEGER,TEXT,TEXT,JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_insert_booking(TEXT,BIGINT,INTEGER,JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.chat_retention_batch(INTEGER,INTEGER,INTEGER,INTEGER) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.chat_context_state(TEXT,BIGINT), public.chat_erase_context(TEXT,BIGINT,INTEGER,TEXT),
  public.chat_save_turn(TEXT,BIGINT,INTEGER,TEXT,TEXT,JSONB), public.chat_insert_booking(TEXT,BIGINT,INTEGER,JSONB),
  public.chat_retention_batch(INTEGER,INTEGER,INTEGER,INTEGER) TO service_role;
DO $a09_function_guard$
DECLARE v_function RECORD;
BEGIN
  FOR v_function IN SELECT p.oid,p.proname,p.proowner FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('chat_context_state','chat_erase_context','chat_save_turn','chat_insert_booking','chat_retention_batch') LOOP
    IF v_function.oid NOT IN ('public.chat_context_state(text,bigint)'::regprocedure, 'public.chat_erase_context(text,bigint,integer,text)'::regprocedure,
      'public.chat_save_turn(text,bigint,integer,text,text,jsonb)'::regprocedure, 'public.chat_insert_booking(text,bigint,integer,jsonb)'::regprocedure,
      'public.chat_retention_batch(integer,integer,integer,integer)'::regprocedure) THEN RAISE EXCEPTION 'A09: unexpected RPC overload'; END IF;
    IF pg_catalog.pg_has_role('anon',v_function.proowner,'MEMBER') OR pg_catalog.pg_has_role('authenticated',v_function.proowner,'MEMBER')
      OR pg_catalog.pg_has_role('service_role',v_function.proowner,'MEMBER') THEN RAISE EXCEPTION 'A09: API role must not own/inherit RPC owner'; END IF;
  END LOOP;
END;
$a09_function_guard$;
COMMIT;
