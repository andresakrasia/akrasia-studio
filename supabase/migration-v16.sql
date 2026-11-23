-- A19-A27: canonical editorial content, atomic admin IA and SQL metrics.
-- Apply after v14/v15. No seed/demo is published. Reapplication preserves rows.
BEGIN;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS slug text;
UPDATE public.services SET slug='service-' || id::text WHERE slug IS NULL;
ALTER TABLE public.services ALTER COLUMN slug SET NOT NULL;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS contact_captured_at timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS services_slug_unique ON public.services(slug);
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS title_en text NOT NULL DEFAULT '';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS description_en text NOT NULL DEFAULT '';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS tagline text NOT NULL DEFAULT '';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS tagline_en text NOT NULL DEFAULT '';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS hero_description text NOT NULL DEFAULT '';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS hero_description_en text NOT NULL DEFAULT '';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS cta_message text NOT NULL DEFAULT '';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS cta_message_en text NOT NULL DEFAULT '';
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS features_en jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS process jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS process_en jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS case_study jsonb NOT NULL DEFAULT '{"brief":"","process":"","result":"","services":[]}'::jsonb;
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS case_study_en jsonb NOT NULL DEFAULT '{"brief":"","process":"","result":"","services":[]}'::jsonb;
ALTER TABLE public.services ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.services FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.services TO service_role;

CREATE OR REPLACE FUNCTION public.dashboard_save_content(p_entity text,p_changes jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE item jsonb; field text; allowed text[]; stmt text; saved jsonb; result jsonb='[]'::jsonb; seen uuid[]='{}'::uuid[]; row_id uuid;
BEGIN
 IF p_entity NOT IN ('services','projects') OR jsonb_typeof(p_changes)<>'array' OR jsonb_array_length(p_changes) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid content' USING ERRCODE='22023'; END IF;
 allowed=CASE WHEN p_entity='services' THEN ARRAY['slug','title','description','title_en','description_en','icon','chat_message','cta_message','cta_message_en','highlighted','sort_order','tagline','tagline_en','hero_description','hero_description_en','features','features_en','process','process_en'] ELSE ARRAY['title','slug','type','client_name','client_id','description','public_description','status','thumbnail','video_url','resolution','aspect','duration','category','sort_order','case_study','case_study_en'] END;
 FOR item IN SELECT value FROM jsonb_array_elements(p_changes) LOOP
  IF jsonb_typeof(item)<>'object' OR jsonb_typeof(item->'fields')<>'object' OR item->'fields'='{}'::jsonb OR (item - ARRAY['id','fields'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid change' USING ERRCODE='22023'; END IF;
  row_id=(item->>'id')::uuid; IF row_id=ANY(seen) THEN RAISE EXCEPTION 'Duplicate change' USING ERRCODE='22023'; END IF; seen=array_append(seen,row_id);
  stmt='';
  FOR field IN SELECT jsonb_object_keys(item->'fields') LOOP
   IF NOT field=ANY(allowed) THEN RAISE EXCEPTION 'Field denied' USING ERRCODE='22023'; END IF;
   stmt=stmt || CASE WHEN stmt='' THEN '' ELSE ',' END || format('%I=(jsonb_populate_record(NULL::public.%I,$1)).%I',field,p_entity,field);
  END LOOP;
  EXECUTE format('UPDATE public.%I SET %s WHERE id=$2 RETURNING to_jsonb(%I.*)',p_entity,stmt,p_entity) INTO saved USING item->'fields',row_id;
  IF saved IS NULL THEN RAISE EXCEPTION 'Record missing' USING ERRCODE='P0002'; END IF;
  result=result || jsonb_build_array(saved);
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.dashboard_save_content(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_save_content(text,jsonb) TO service_role;

CREATE TABLE IF NOT EXISTS public.dashboard_ai_operations (
 id uuid PRIMARY KEY, fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('running','complete')), result jsonb, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.dashboard_ai_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dashboard_ai_operations FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.dashboard_ai_operations TO service_role;
-- Normalize any reviewed pre-release receipt from complete rows to identifiers.
UPDATE public.dashboard_ai_operations o SET result=(
 SELECT coalesce(jsonb_object_agg(key,(SELECT coalesce(jsonb_agg(CASE WHEN jsonb_typeof(value)='object' THEN value->>'id' ELSE value #>> '{}' END),'[]'::jsonb) FROM jsonb_array_elements(o.result->key))),'{}'::jsonb)
 FROM jsonb_object_keys(o.result) AS keys(key)
) WHERE state='complete' AND result IS NOT NULL;
CREATE INDEX IF NOT EXISTS dashboard_ai_operations_created_idx ON public.dashboard_ai_operations(created_at);
-- Receipts retain IDs only. Replay resolves current rows and cannot restore deleted text.
CREATE OR REPLACE FUNCTION public.dashboard_ai_result(p_operation uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE receipt jsonb; bucket text; rows jsonb; result jsonb='{}'::jsonb;
BEGIN
 SELECT o.result INTO receipt FROM public.dashboard_ai_operations o WHERE o.id=p_operation AND o.state='complete';
 IF receipt IS NULL THEN RETURN NULL; END IF;
 FOR bucket IN SELECT jsonb_object_keys(receipt) LOOP
  IF bucket='tasks' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ids.position),'[]'::jsonb) INTO rows FROM jsonb_array_elements_text(receipt->bucket) WITH ORDINALITY AS ids(id,position) JOIN public.project_tasks t ON t.id=ids.id::uuid;
  ELSIF bucket='feed' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ids.position),'[]'::jsonb) INTO rows FROM jsonb_array_elements_text(receipt->bucket) WITH ORDINALITY AS ids(id,position) JOIN public.feed_entries t ON t.id=ids.id::uuid;
  ELSIF bucket='logs' THEN
   SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY ids.position),'[]'::jsonb) INTO rows FROM jsonb_array_elements_text(receipt->bucket) WITH ORDINALITY AS ids(id,position) JOIN public.studio_logs t ON t.id=ids.id::uuid;
  ELSE RAISE EXCEPTION 'Invalid receipt' USING ERRCODE='22023'; END IF;
  result=jsonb_set(result,ARRAY[bucket],rows);
 END LOOP;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.dashboard_ai_result(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_ai_result(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.dashboard_claim_ai(p_operation uuid,p_fingerprint text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE current public.dashboard_ai_operations; affected integer;
BEGIN
 IF p_fingerprint IS NULL OR p_fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Invalid fingerprint' USING ERRCODE='22023'; END IF;
 INSERT INTO public.dashboard_ai_operations(id,fingerprint,state) VALUES(p_operation,p_fingerprint,'running') ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS affected=ROW_COUNT;
 IF affected=1 THEN RETURN jsonb_build_object('state','claimed'); END IF;
 SELECT * INTO STRICT current FROM public.dashboard_ai_operations WHERE id=p_operation;
 IF current.fingerprint<>p_fingerprint THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
 RETURN jsonb_build_object('state',current.state,'result',CASE WHEN current.state='complete' THEN public.dashboard_ai_result(p_operation) ELSE NULL END);
END $$;
CREATE OR REPLACE FUNCTION public.dashboard_commit_ai(p_operation uuid,p_fingerprint text,p_project uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE current public.dashboard_ai_operations; item jsonb; inserted jsonb; v_result jsonb='{}'::jsonb; bucket text;
BEGIN
 SELECT * INTO STRICT current FROM public.dashboard_ai_operations WHERE id=p_operation FOR UPDATE;
 IF current.fingerprint<>p_fingerprint THEN RAISE EXCEPTION 'Operation conflict' USING ERRCODE='23505'; END IF;
 IF current.state='complete' THEN RETURN public.dashboard_ai_result(p_operation); END IF;
 IF jsonb_typeof(p_payload)<>'object' OR (p_payload ? 'tasks' AND p_project IS NULL) OR (p_payload - ARRAY['tasks','feed','logs'])<>'{}'::jsonb THEN RAISE EXCEPTION 'Invalid AI payload' USING ERRCODE='22023'; END IF;
 IF (p_payload ? 'tasks') = ((p_payload ? 'feed') OR (p_payload ? 'logs')) OR (NOT (p_payload ? 'tasks') AND (NOT (p_payload ? 'feed') OR NOT (p_payload ? 'logs'))) THEN RAISE EXCEPTION 'Invalid AI contract' USING ERRCODE='22023'; END IF;
 FOR bucket IN SELECT jsonb_object_keys(p_payload) LOOP
  IF jsonb_typeof(p_payload->bucket)<>'array' OR jsonb_array_length(p_payload->bucket) NOT BETWEEN 1 AND (CASE WHEN bucket='tasks' THEN 12 ELSE 3 END) THEN RAISE EXCEPTION 'Invalid AI list' USING ERRCODE='22023'; END IF;
  v_result=jsonb_set(v_result,ARRAY[bucket],'[]'::jsonb);
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->bucket) LOOP
   IF jsonb_typeof(item)<>'object' THEN RAISE EXCEPTION 'Invalid AI item' USING ERRCODE='22023'; END IF;
   IF bucket='tasks' THEN
    IF (item - ARRAY['title','description'])<>'{}'::jsonb OR jsonb_typeof(item->'title')<>'string' OR jsonb_typeof(item->'description')<>'string' OR length(item->>'title') NOT BETWEEN 1 AND 300 OR length(item->>'description')>5000 THEN RAISE EXCEPTION 'Invalid AI task' USING ERRCODE='22023'; END IF;
    INSERT INTO public.project_tasks(project_id,title,description,status,priority,created_by) VALUES(p_project,item->>'title',item->>'description','pending','medium','ai') RETURNING to_jsonb(project_tasks.*) INTO inserted;
   ELSIF bucket='feed' THEN
    IF (item - ARRAY['text','level'])<>'{}'::jsonb OR jsonb_typeof(item->'text')<>'string' OR length(item->>'text') NOT BETWEEN 1 AND 2000 OR coalesce(item->>'level','') NOT IN ('high','mid','low') THEN RAISE EXCEPTION 'Invalid AI feed' USING ERRCODE='22023'; END IF;
    INSERT INTO public.feed_entries(project_id,text,level,source,is_active) VALUES(p_project,item->>'text',item->>'level','ai',false) RETURNING to_jsonb(feed_entries.*) INTO inserted;
   ELSE
    IF (item - ARRAY['text','log_type'])<>'{}'::jsonb OR jsonb_typeof(item->'text')<>'string' OR length(item->>'text') NOT BETWEEN 1 AND 2000 OR coalesce(item->>'log_type','') NOT IN ('success','info','warning') THEN RAISE EXCEPTION 'Invalid AI log' USING ERRCODE='22023'; END IF;
    INSERT INTO public.studio_logs(project_id,text,log_type,source,is_active) VALUES(p_project,item->>'text',item->>'log_type','ai',false) RETURNING to_jsonb(studio_logs.*) INTO inserted;
   END IF;
   v_result=jsonb_set(v_result,ARRAY[bucket],v_result->bucket || jsonb_build_array(inserted));
  END LOOP;
 END LOOP;
  UPDATE public.dashboard_ai_operations SET state='complete',result=(
  SELECT jsonb_object_agg(key,(SELECT jsonb_agg(value->>'id') FROM jsonb_array_elements(v_result->key))) FROM jsonb_object_keys(v_result) AS keys(key)
 ) WHERE id=p_operation;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.dashboard_claim_ai(uuid,text),public.dashboard_commit_ai(uuid,text,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_claim_ai(uuid,text),public.dashboard_commit_ai(uuid,text,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.dashboard_metrics(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 WITH periods AS (
 SELECT (date_trunc('day',p_now AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid') AS today,
 (date_trunc('week',p_now AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid') AS week,
 (date_trunc('month',p_now AT TIME ZONE 'Europe/Madrid') AT TIME ZONE 'Europe/Madrid') AS month
 ), cohort AS (SELECT c.id,c.visitor_id FROM public.conversations c,periods p WHERE c.created_at>=p.month AND c.created_at<=p_now),
 contact AS (SELECT l.* FROM public.leads l,periods p WHERE coalesce(l.contact_captured_at,l.created_at)>=p.month AND coalesce(l.contact_captured_at,l.created_at)<=p_now AND (nullif(trim(l.email),'') IS NOT NULL OR nullif(trim(l.phone),'') IS NOT NULL)),
 conversation_metrics AS (SELECT c.id,count(m.id) AS messages,coalesce(extract(epoch FROM max(m.created_at)-min(m.created_at)),0) AS seconds FROM cohort c LEFT JOIN public.messages m ON m.conversation_id=c.id AND m.created_at<=p_now GROUP BY c.id),
 status_counts AS (SELECT status,count(*) AS amount FROM contact GROUP BY status),
 weeks AS (SELECT generate_series(date_trunc('week',p_now AT TIME ZONE 'Europe/Madrid')-interval '7 weeks',date_trunc('week',p_now AT TIME ZONE 'Europe/Madrid'),interval '1 week') AS start),
 days AS (SELECT generate_series(date_trunc('day',p_now AT TIME ZONE 'Europe/Madrid')-interval '13 days',date_trunc('day',p_now AT TIME ZONE 'Europe/Madrid'),interval '1 day') AS start)
 SELECT jsonb_build_object(
 'visitorsToday',(SELECT count(DISTINCT c.visitor_id) FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id,periods p WHERE m.role='user' AND m.created_at>=p.today AND m.created_at<=p_now),
 'leadsThisWeek',(SELECT count(*) FROM public.leads l,periods p WHERE coalesce(l.contact_captured_at,l.created_at)>=p.week AND coalesce(l.contact_captured_at,l.created_at)<=p_now AND (nullif(trim(l.email),'') IS NOT NULL OR nullif(trim(l.phone),'') IS NOT NULL)),
 'leadsThisMonth',(SELECT count(*) FROM contact), 'totalConversations',(SELECT count(*) FROM cohort),
 'leadsByStatus',coalesce((SELECT jsonb_object_agg(status,amount) FROM status_counts),'{}'::jsonb),
 'avgMessages',coalesce((SELECT round(avg(messages)) FROM conversation_metrics),0),
 'avgDurationSec',coalesce((SELECT round(avg(seconds)) FROM conversation_metrics),0),
 'avgDurationMin',coalesce((SELECT round(avg(seconds)/60) FROM conversation_metrics),0),
 'conversionRatio',CASE WHEN (SELECT count(*) FROM cohort)=0 THEN 0 ELSE round(100.0*(SELECT count(DISTINCT c.id) FROM cohort c JOIN contact l ON l.conversation_id=c.id)/(SELECT count(*) FROM cohort)) END,
 'leadsPerWeek',(SELECT jsonb_agg(jsonb_build_object('week',to_char(w.start,'DD/MM'),'leads',(SELECT count(*) FROM public.leads l WHERE coalesce(l.contact_captured_at,l.created_at) >= (w.start AT TIME ZONE 'Europe/Madrid') AND coalesce(l.contact_captured_at,l.created_at) < ((w.start+interval '1 week') AT TIME ZONE 'Europe/Madrid') AND coalesce(l.contact_captured_at,l.created_at)<=p_now AND (nullif(trim(l.email),'') IS NOT NULL OR nullif(trim(l.phone),'') IS NOT NULL))) ORDER BY w.start) FROM weeks w),
 'visitsPerDay',(SELECT jsonb_agg(jsonb_build_object('date',to_char(d.start,'DD/MM'),'visits',(SELECT count(*) FROM public.conversations c WHERE c.created_at >= (d.start AT TIME ZONE 'Europe/Madrid') AND c.created_at < ((d.start+interval '1 day') AT TIME ZONE 'Europe/Madrid') AND c.created_at<=p_now)) ORDER BY d.start) FROM days d),
 'definitions',jsonb_build_object('timezone','Europe/Madrid','cohort','Conversaciones iniciadas en el mes civil hasta ahora; contacto observado en el mismo periodo.','traffic','No se mide tráfico web. Son chats y contactos conservados.','retention','Los datos eliminados por retención no se reconstruyen; los gráficos representan datos conservados.')
 );
$$;
REVOKE ALL ON FUNCTION public.dashboard_metrics(timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_metrics(timestamptz) TO service_role;
CREATE INDEX IF NOT EXISTS messages_conversation_chronological ON public.messages(conversation_id,created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS leads_created_cursor ON public.leads(created_at DESC,id DESC);

CREATE OR REPLACE FUNCTION public.dashboard_immutable_created_at()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN RAISE EXCEPTION 'created_at is immutable' USING ERRCODE='22023'; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dashboard_immutable_created_at() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_immutable_created_at() TO service_role;
DROP TRIGGER IF EXISTS dashboard_created_immutable ON public.conversations;
CREATE TRIGGER dashboard_created_immutable BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.dashboard_immutable_created_at();
DROP TRIGGER IF EXISTS dashboard_created_immutable ON public.messages;
CREATE TRIGGER dashboard_created_immutable BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.dashboard_immutable_created_at();
DROP TRIGGER IF EXISTS dashboard_created_immutable ON public.leads;
CREATE TRIGGER dashboard_created_immutable BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.dashboard_immutable_created_at();
CREATE OR REPLACE FUNCTION public.dashboard_message_count()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
DECLARE affected uuid;
BEGIN
 affected=CASE WHEN TG_OP='DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
 UPDATE public.conversations SET message_count=(SELECT count(*) FROM public.messages WHERE conversation_id=affected),updated_at=now() WHERE id=affected;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.dashboard_message_count() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_message_count() TO service_role;
DROP TRIGGER IF EXISTS dashboard_message_count ON public.messages;
CREATE CONSTRAINT TRIGGER dashboard_message_count AFTER INSERT OR DELETE ON public.messages DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.dashboard_message_count();
CREATE OR REPLACE FUNCTION public.dashboard_contact_captured()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.contact_captured_at IS NOT NULL THEN NEW.contact_captured_at=OLD.contact_captured_at;
 ELSIF (nullif(trim(NEW.email),'') IS NOT NULL OR nullif(trim(NEW.phone),'') IS NOT NULL) AND (TG_OP='INSERT' OR (nullif(trim(OLD.email),'') IS NULL AND nullif(trim(OLD.phone),'') IS NULL)) THEN NEW.contact_captured_at=now();
 ELSE NEW.contact_captured_at=NULL;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.dashboard_contact_captured() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dashboard_contact_captured() TO service_role;
DROP TRIGGER IF EXISTS dashboard_contact_captured ON public.leads;
CREATE TRIGGER dashboard_contact_captured BEFORE INSERT OR UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.dashboard_contact_captured();
-- ACL/RLS above is explicit; no grant or policy is added for browser roles.
NOTIFY pgrst,'reload schema';
COMMIT;




