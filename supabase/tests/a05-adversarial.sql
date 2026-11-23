-- A05 fixture ADVERSARIAL. SOLO BD/CLUSTER DESECHABLES del bootstrap.
-- Aplicar DESPUES de v1-v10 y ANTES de v11. Nunca en datos/plataforma reales.
-- Abre intencionadamente ACL, columnas, politicas y EXECUTE para comprobar que
-- v11 repara permisos previos amplios sin revocar objetos ajenos al alcance.
-- Requiere superusuario. No ejecuta servicios externos. No es una migracion.
\set ON_ERROR_STOP on
BEGIN;
DO $fixture$
DECLARE
  table_name text;
  column_name text;
BEGIN
  IF current_database() !~ '^akrasia_a05_[a-zA-Z0-9_]+$'
     OR current_setting('akrasia.a05_disposable', true) IS DISTINCT FROM 'true'
     OR NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Fixture requiere bootstrap y superusuario de una BD desechable';
  END IF;
  FOREACH table_name IN ARRAY ARRAY[
    'visitors', 'conversations', 'messages', 'leads', 'content', 'projects',
    'project_tasks', 'feed_entries', 'studio_logs', 'studio_stats', 'services',
    'clients', 'bookings', 'availability', 'availability_overrides', 'sent_emails',
    'dashboard_sessions', 'dashboard_login_limits', 'chat_quota_buckets', 'chat_concurrency_leases'
  ] LOOP
    EXECUTE format('GRANT ALL ON TABLE public.%I TO PUBLIC, anon, authenticated, service_role', table_name);
    SELECT a.attname INTO column_name FROM pg_catalog.pg_attribute a
      WHERE a.attrelid = format('public.%I', table_name)::regclass AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum LIMIT 1;
    -- Comprobar ACL explicitamente concedidos a columnas y a tablas; tambien
    -- permite ensayar despues el caso de un grant solo de columna.
    EXECUTE format('GRANT SELECT (%I), INSERT (%I), UPDATE (%I), REFERENCES (%I) ON public.%I TO PUBLIC, anon, authenticated',
      column_name, column_name, column_name, column_name, table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('DROP POLICY IF EXISTS a05_open_fixture ON public.%I', table_name);
    EXECUTE format('CREATE POLICY a05_open_fixture ON public.%I TO PUBLIC USING (true) WITH CHECK (true)', table_name);
  END LOOP;
END
$fixture$;

-- Las fuentes v1-v10 usan UUID, no secuencias. Esta columna prueba una secuencia
-- vinculada futura. v11 debe quitar USAGE/SELECT/UPDATE de clientes y PUBLIC,
-- y conservar USAGE necesario para INSERT del servidor, sin permitir setval.
ALTER TABLE public.visitors ADD COLUMN IF NOT EXISTS a05_probe_serial bigserial;
GRANT ALL ON SEQUENCE public.visitors_a05_probe_serial_seq TO PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.increment_message_count(uuid), public.update_updated_at(),
  public.dashboard_consume_login_attempt(text), public.chat_admit(text, text, uuid, jsonb, bigint),
  public.chat_release(uuid) TO PUBLIC, anon, authenticated;

-- Objetos deliberadamente fuera del alcance: v11 debe conservar estos ACL.
CREATE TABLE IF NOT EXISTS public.a05_unrelated_table (label text PRIMARY KEY);
INSERT INTO public.a05_unrelated_table(label) VALUES ('ficticio') ON CONFLICT DO NOTHING;
GRANT SELECT ON public.a05_unrelated_table TO PUBLIC;
CREATE OR REPLACE FUNCTION public.a05_unrelated_helper() RETURNS integer
  LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $unrelated$ SELECT 42 $unrelated$;
GRANT EXECUTE ON FUNCTION public.a05_unrelated_helper() TO PUBLIC;
COMMIT;
\echo 'Fixture adversarial preparada. Esta BD tiene ACL inseguros hasta aplicar v11.'
