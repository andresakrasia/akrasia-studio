-- A05: SOLO un PostgreSQL local/aislado, con BD Y CLUSTER DESECHABLES.
-- NUNCA usar en Supabase ni en una BD con datos reales. Los roles son globales
-- al cluster. Este fichero no es una migracion de produccion ni emula PostgREST.
-- Requiere superusuario, PostgreSQL 14+, BD vacia llamada akrasia_a05_* y:
-- psql -X -v ON_ERROR_STOP=1 -v a05_disposable=YES_DISPOSABLE_DATABASE_AND_CLUSTER
--      -d akrasia_a05_test -f supabase/tests/a05-bootstrap.sql
-- Despues aplicar migration.sql, migration-v2.sql ... migration-v11.sql en orden.
-- No crea usuarios LOGIN, passwords, conexiones externas ni envios de mensajes.
-- Los seeds originales solo escriben filas/URLs ficticias; no descargan URLs.
\set ON_ERROR_STOP on
\if :{?a05_disposable}
  SELECT :'a05_disposable' = 'YES_DISPOSABLE_DATABASE_AND_CLUSTER' AS a05_confirmed \gset
\else
  \echo 'Falta -v a05_disposable=YES_DISPOSABLE_DATABASE_AND_CLUSTER. No se ha cambiado nada.'
  \quit 3
\endif
\if :a05_confirmed
\else
  \echo 'Confirmacion de entorno desechable incorrecta. No se ha cambiado nada.'
  \quit 3
\endif

BEGIN;
DO $bootstrap$
BEGIN
  IF current_database() !~ '^akrasia_a05_[a-zA-Z0-9_]+$' THEN
    RAISE EXCEPTION 'Solo BD desechables llamadas akrasia_a05_*';
  END IF;
  IF current_setting('server_version_num')::integer < 140000 THEN
    RAISE EXCEPTION 'Este procedimiento requiere PostgreSQL 14 o posterior';
  END IF;
  IF NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Bootstrap requiere superusuario en un cluster desechable';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f'))
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname IN ('auth', 'storage')) THEN
    RAISE EXCEPTION 'Bootstrap requiere una BD vacia, sin objetos public/auth/storage';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolname IN ('anon', 'authenticated', 'service_role', 'a05_rls_probe')) THEN
    RAISE EXCEPTION 'Roles preexistentes: usar otro CLUSTER desechable; no se alteran roles ajenos';
  END IF;
  EXECUTE format('ALTER DATABASE %I SET akrasia.a05_disposable = %L', current_database(), 'true');
END
$bootstrap$;
SET akrasia.a05_disposable = 'true';

CREATE ROLE anon NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE authenticated NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE service_role NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Replica el riesgo de ACL amplios de tablas nuevas, independiente de RLS.
-- Estos defaults solo pertenecen al creador de objetos de esta BD de prueba.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

CREATE SCHEMA auth;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE SECURITY INVOKER
  SET search_path = '' AS $auth$
  SELECT COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''), current_user::text)
$auth$;
GRANT EXECUTE ON FUNCTION auth.role() TO anon, authenticated, service_role;

-- Stub minimo para migration-v3: la lectura publica de thumbnails es intencionada.
-- No valida permisos de Storage/PostgREST reales ni el bucket remoto.
CREATE SCHEMA storage;
CREATE TABLE storage.buckets (
  id text PRIMARY KEY,
  name text NOT NULL,
  public boolean NOT NULL DEFAULT false
);
CREATE TABLE storage.objects (
  id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  bucket_id text NOT NULL REFERENCES storage.buckets(id),
  name text NOT NULL
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
GRANT SELECT ON storage.objects TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects, storage.buckets TO service_role;
COMMIT;
\echo 'Bootstrap desechable preparado; aplicar v1-v10, fixture adversarial opcional, v11 dos veces y a05-verify.sql.'
