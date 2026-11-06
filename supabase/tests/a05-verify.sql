-- A05: pruebas SQL REALES cuando este fichero se ejecuta con psql.
-- SOLO BD/CLUSTER DESECHABLES creados por a05-bootstrap.sql, v1-v10, fixture
-- adversarial opcional y v11. Nunca Supabase/datos reales. Requiere superusuario.
-- Ejecutar v11 DOS VECES antes de este fichero para probar reaplicacion.
-- psql -X -v ON_ERROR_STOP=1 -d akrasia_a05_test -f supabase/tests/a05-verify.sql
-- BEGIN/ROLLBACK revierte datos ficticios, rol probe y ACL temporales. No envia
-- correo/Telegram, no consume IA, no crea una reserva fuera de la BD desechable.
-- Los contadores de secuencia pueden avanzar pese a ROLLBACK (PostgreSQL):
-- otra razon para usar exclusivamente una BD/cluster desechables.
-- Exito esperado: notices A05 ... OK, ROLLBACK y mensaje final. Un EXCEPTION
-- significa fallo: ON_ERROR_STOP impide presentar un exito falso.
-- No certifica PostgREST, Supabase remoto, esquemas expuestos remotos, claves,
-- proxies, sesiones de navegador ni carreras de dos conexiones simultaneas.
\set ON_ERROR_STOP on
BEGIN;
DO $guard$
BEGIN
  IF current_database() !~ '^akrasia_a05_[a-zA-Z0-9_]+$'
     OR current_setting('akrasia.a05_disposable', true) IS DISTINCT FROM 'true'
     OR NOT (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname = current_user) THEN
    RAISE EXCEPTION 'Pruebas requieren bootstrap y superusuario de una BD desechable';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'a05_rls_probe') THEN
    RAISE EXCEPTION 'Rol de prueba preexistente: no se modifica';
  END IF;
END
$guard$;

CREATE TEMP TABLE a05_tables (name text PRIMARY KEY, service_acl text[] NOT NULL);
INSERT INTO a05_tables VALUES
  ('visitors', ARRAY['SELECT','INSERT','UPDATE']),
  ('conversations', ARRAY['SELECT','INSERT','UPDATE']),
  ('messages', ARRAY['SELECT','INSERT']),
  ('leads', ARRAY['SELECT','INSERT','UPDATE']),
  ('content', ARRAY['SELECT','INSERT','UPDATE']),
  ('projects', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
  ('project_tasks', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
  ('feed_entries', ARRAY['SELECT','INSERT','UPDATE']),
  ('studio_logs', ARRAY['SELECT','INSERT','UPDATE']),
  ('studio_stats', ARRAY['SELECT','UPDATE']),
  ('services', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
  ('clients', ARRAY['SELECT','INSERT','UPDATE','DELETE']),
  ('bookings', ARRAY['SELECT','INSERT','UPDATE']),
  ('availability', ARRAY['SELECT','INSERT','DELETE']),
  ('availability_overrides', ARRAY['SELECT']),
  ('sent_emails', ARRAY['SELECT','INSERT']),
  ('dashboard_sessions', ARRAY['SELECT','INSERT','DELETE']),
  ('dashboard_login_limits', ARRAY[]::text[]),
  ('chat_quota_buckets', ARRAY[]::text[]),
  ('chat_concurrency_leases', ARRAY[]::text[]);
CREATE TEMP TABLE a05_routines (signature text PRIMARY KEY, service_execute boolean, definer boolean);
INSERT INTO a05_routines VALUES
  ('public.increment_message_count(uuid)', false, false),
  ('public.update_updated_at()', false, false),
  ('public.dashboard_consume_login_attempt(text)', true, true),
  ('public.chat_admit(text,text,uuid,jsonb,bigint)', true, true),
  ('public.chat_release(uuid)', true, true);

-- Helpers INVOKER: SET ROLE dentro de SECURITY DEFINER estaria prohibido.
-- Solo existen en pg_temp de esta conexion; no son RPC public ni persisten.
CREATE FUNCTION pg_temp.a05_expect_denied(role_name text, command text) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $helper$
DECLARE denied boolean := false;
BEGIN
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I', role_name);
  BEGIN
    EXECUTE command;
  EXCEPTION WHEN insufficient_privilege THEN
    denied := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT denied THEN RAISE EXCEPTION 'Acceso indebidamente permitido a %: %', role_name, command; END IF;
END
$helper$;
CREATE FUNCTION pg_temp.a05_expect_zero(role_name text, command text) RETURNS void
  LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $helper$
DECLARE affected bigint;
BEGIN
  EXECUTE pg_catalog.format('SET LOCAL ROLE %I', role_name);
  EXECUTE command;
  GET DIAGNOSTICS affected = ROW_COUNT;
  EXECUTE 'RESET ROLE';
  IF affected <> 0 THEN RAISE EXCEPTION 'RLS dejo % filas a %: %', affected, role_name, command; END IF;
END
$helper$;

DO $catalog$
DECLARE
  target record;
  client_role text;
  privilege text;
  rel record;
  routine record;
  function_oid oid;
BEGIN
  FOR target IN SELECT * FROM pg_temp.a05_tables LOOP
    SELECT c.* INTO rel FROM pg_catalog.pg_class c
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = target.name;
    IF NOT FOUND OR rel.relkind NOT IN ('r','p') OR NOT rel.relrowsecurity THEN
      RAISE EXCEPTION 'Falta tabla/RLS: %', target.name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(rel.relacl,
        pg_catalog.acldefault('r', rel.relowner))) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'ACL de tabla PUBLIC persiste: %', target.name;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute col,
        LATERAL pg_catalog.aclexplode(col.attacl) a
        WHERE col.attrelid = rel.oid AND col.attnum > 0 AND NOT col.attisdropped
          AND a.grantee = 0) THEN
      RAISE EXCEPTION 'ACL de columna PUBLIC persiste: %', target.name;
    END IF;
    FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.pg_has_role(client_role, rel.relowner, 'MEMBER') THEN
        RAISE EXCEPTION '% es propietario o miembro del propietario de %', client_role, target.name;
      END IF;
      FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
        IF pg_catalog.has_table_privilege(client_role, rel.oid, privilege) THEN
          RAISE EXCEPTION '% tiene % efectivo de tabla %', client_role, privilege, target.name;
        END IF;
      END LOOP;
      FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
        IF pg_catalog.has_any_column_privilege(client_role, rel.oid, privilege) THEN
          RAISE EXCEPTION '% tiene % efectivo de columna %', client_role, privilege, target.name;
        END IF;
      END LOOP;
    END LOOP;
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] LOOP
      IF pg_catalog.has_table_privilege('service_role', rel.oid, privilege)
          IS DISTINCT FROM (privilege = ANY(target.service_acl)) THEN
        RAISE EXCEPTION 'ACL service_role no coincide: % %', target.name, privilege;
      END IF;
    END LOOP;
    FOREACH privilege IN ARRAY ARRAY['SELECT','INSERT','UPDATE','REFERENCES'] LOOP
      IF pg_catalog.has_any_column_privilege('service_role', rel.oid, privilege)
          IS DISTINCT FROM (privilege = ANY(target.service_acl)) THEN
        RAISE EXCEPTION 'ACL columna service_role no coincide: % %', target.name, privilege;
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = rel.oid
        AND (p.polroles <> ARRAY['service_role'::regrole::oid]
             OR p.polcmd <> '*' OR NOT p.polpermissive
             OR pg_catalog.pg_get_expr(p.polqual, p.polrelid) <> 'true'
             OR pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) <> 'true')) THEN
      RAISE EXCEPTION 'Politica inesperada/no limitada TO service_role: %', target.name;
    END IF;
    IF (SELECT count(*) FROM pg_catalog.pg_policy p WHERE p.polrelid = rel.oid)
       <> (CASE WHEN cardinality(target.service_acl) > 0 THEN 1 ELSE 0 END) THEN
      RAISE EXCEPTION 'Numero inesperado de politicas: %', target.name;
    END IF;
  END LOOP;
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r
      WHERE pg_catalog.pg_has_role(client_role, r.oid, 'MEMBER') AND (r.rolsuper OR r.rolbypassrls)) THEN
      RAISE EXCEPTION '% alcanza un rol superusuario/BYPASSRLS', client_role;
    END IF;
    IF pg_catalog.has_schema_privilege(client_role, 'public', 'CREATE') THEN
      RAISE EXCEPTION '% puede crear objetos en public: revisar via alternativa', client_role;
    END IF;
  END LOOP;
  FOR target IN SELECT * FROM pg_temp.a05_routines LOOP
    function_oid := pg_catalog.to_regprocedure(target.signature);
    IF function_oid IS NULL THEN RAISE EXCEPTION 'Falta funcion %', target.signature; END IF;
    SELECT * INTO routine FROM pg_catalog.pg_proc WHERE oid = function_oid;
    IF routine.prosecdef IS DISTINCT FROM target.definer
      OR NOT EXISTS (SELECT 1 FROM unnest(routine.proconfig) config
        WHERE config ~ '^search_path=' AND replace(substr(config, 13), '"', '') = '') THEN
      RAISE EXCEPTION 'Modo/search_path inseguro: %', target.signature;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(routine.proacl,
      pg_catalog.acldefault('f', routine.proowner))) a WHERE a.grantee = 0) THEN
      RAISE EXCEPTION 'EXECUTE PUBLIC persiste: %', target.signature;
    END IF;
    FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF pg_catalog.has_function_privilege(client_role, function_oid, 'EXECUTE') THEN
        RAISE EXCEPTION '% ejecuta %', client_role, target.signature;
      END IF;
    END LOOP;
    IF pg_catalog.has_function_privilege('service_role', function_oid, 'EXECUTE')
       IS DISTINCT FROM target.service_execute THEN
      RAISE EXCEPTION 'EXECUTE service_role inesperado: %', target.signature;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname IN ('increment_message_count','update_updated_at',
       'dashboard_consume_login_attempt','chat_admit','chat_release')
       AND NOT EXISTS (SELECT 1 FROM pg_temp.a05_routines r WHERE pg_catalog.to_regprocedure(r.signature) = p.oid)) THEN
    RAISE EXCEPTION 'Overload no inventariado de una funcion de proyecto';
  END IF;
  RAISE NOTICE 'A05 catalogo: 20 tablas, 17 politicas, ACL efectivos, columnas, roles y 5 funciones OK';
END
$catalog$;

-- Vistas/materializadas transitivas y funciones declarativamente dependientes.
-- prosrc tambien detecta SQL/plpgsql que nombra tablas privadas. SQL dinamico
-- construido/obfuscado en funciones ajenas exige revision manual del inventario.
DO $alternatives$
BEGIN
  IF EXISTS (
    WITH RECURSIVE dependent(oid) AS (
      SELECT format('public.%I', name)::regclass::oid FROM pg_temp.a05_tables
      UNION
      SELECT rw.ev_class FROM dependent base
        JOIN pg_catalog.pg_depend dep ON dep.refclassid = 'pg_class'::regclass AND dep.refobjid = base.oid
        JOIN pg_catalog.pg_rewrite rw ON dep.classid = 'pg_rewrite'::regclass AND dep.objid = rw.oid
    )
    SELECT 1 FROM dependent d JOIN pg_catalog.pg_class c ON c.oid = d.oid
    WHERE c.relkind IN ('v','m') AND (
      pg_catalog.has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      OR pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
      OR pg_catalog.has_any_column_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE')
      OR pg_catalog.has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE'))
  ) THEN RAISE EXCEPTION 'Vista alternativa accesible sobre tablas de A05'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname !~ '^pg_(temp|toast)'
      AND p.prokind = 'f'
      AND (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
      AND EXISTS (SELECT 1 FROM pg_temp.a05_tables t
        WHERE p.prosrc ~ ('\m' || t.name || '\M')
          OR EXISTS (SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid = 'pg_proc'::regclass
             AND d.objid = p.oid AND d.refclassid = 'pg_class'::regclass
             AND d.refobjid = format('public.%I', t.name)::regclass))
  ) THEN RAISE EXCEPTION 'Funcion alternativa accesible que referencia tablas de A05'; END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class seq
    JOIN pg_catalog.pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = seq.oid
      AND d.refclassid = 'pg_class'::regclass AND d.deptype IN ('a','i')
    JOIN pg_temp.a05_tables t ON d.refobjid = format('public.%I', t.name)::regclass
    WHERE seq.relkind = 'S' AND (
      pg_catalog.has_sequence_privilege('anon', seq.oid, 'USAGE,SELECT,UPDATE')
      OR pg_catalog.has_sequence_privilege('authenticated', seq.oid, 'USAGE,SELECT,UPDATE')
      OR pg_catalog.has_sequence_privilege('service_role', seq.oid, 'UPDATE')
      OR EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(seq.relacl,
         pg_catalog.acldefault('S',seq.relowner))) a WHERE a.grantee = 0))
  ) THEN RAISE EXCEPTION 'Secuencia vinculada expone permisos indebidos'; END IF;
  IF to_regclass('public.a05_unrelated_table') IS NOT NULL THEN
    IF NOT pg_catalog.has_table_privilege('anon','public.a05_unrelated_table','SELECT')
      OR NOT pg_catalog.has_function_privilege('anon','public.a05_unrelated_helper()','EXECUTE') THEN
      RAISE EXCEPTION 'La migracion revoco permisos de objetos ajenos al alcance';
    END IF;
  END IF;
  RAISE NOTICE 'A05 vias alternativas catalogables y preservacion de objetos ajenos OK';
END
$alternatives$;

-- Inventario manual complementario: esperado vacio en fixture limpia salvo el
-- helper ajeno INVOKER. No equivale a certificar SQL dinamico ajeno ni otros
-- esquemas configurados como expuestos en una plataforma remota.
SELECT n.nspname AS schema, p.oid::regprocedure AS routine, p.prosecdef AS security_definer,
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND (
  pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
  OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
ORDER BY p.oid::regprocedure::text;

-- Datos ficticios completos para que las pruebas RLS no dependan de NOT NULL,
-- checks, UUID privados reales ni ausencia de filas. Todos se revierten.
INSERT INTO public.visitors(id,visitor_id) VALUES
 ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
INSERT INTO public.conversations(id,visitor_id) VALUES
 ('00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000001');
INSERT INTO public.messages(id,conversation_id,role,content) VALUES
 ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002','user','Mensaje ficticio A05');
INSERT INTO public.leads(id,visitor_id,conversation_id,email) VALUES
 ('00000000-0000-4000-8000-000000000004','00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002','ficticio@example.invalid');
INSERT INTO public.content(key,data) VALUES ('a05-fixture','{"title":"Contenido publico ficticio servido por API"}');
INSERT INTO public.clients(id,name) VALUES ('00000000-0000-4000-8000-000000000010','Cliente ficticio A05');
INSERT INTO public.projects(id,title,slug) VALUES ('00000000-0000-4000-8000-000000000005','Proyecto ficticio A05','a05-fixture');
INSERT INTO public.project_tasks(id,project_id,title) VALUES
 ('00000000-0000-4000-8000-000000000006','00000000-0000-4000-8000-000000000005','Tarea ficticia');
INSERT INTO public.feed_entries(id,text) VALUES ('00000000-0000-4000-8000-000000000007','Feed ficticio A05');
INSERT INTO public.studio_logs(id,text) VALUES ('00000000-0000-4000-8000-000000000008','Log ficticio A05');
INSERT INTO public.studio_stats(key,value,label) VALUES ('a05-fixture',1,'Estadistica ficticia');
INSERT INTO public.services(id,title) VALUES ('00000000-0000-4000-8000-000000000009','Servicio ficticio A05');
INSERT INTO public.bookings(id,visitor_id,booked_date,booked_time,visitor_email,notes) VALUES
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001',
  '2035-01-01','09:00','ficticio@example.invalid','SOLO fixture SQL; sin reserva externa');
INSERT INTO public.availability(id,day_of_week,start_time,end_time) VALUES
 ('00000000-0000-4000-8000-000000000012',1,'09:00','10:00');
INSERT INTO public.availability_overrides(id,override_date,is_available,note) VALUES
 ('00000000-0000-4000-8000-000000000013','2035-01-01',false,'Excepcion ficticia privada');
INSERT INTO public.sent_emails(id,to_email,subject,body_text,status) VALUES
 ('00000000-0000-4000-8000-000000000014','ficticio@example.invalid','Ficticio A05','No enviado','draft');
INSERT INTO public.dashboard_sessions(token_hash,credential_version,expires_at)
 VALUES(repeat('a',64),repeat('b',64),now()+interval '1 hour');
INSERT INTO public.dashboard_login_limits(bucket,attempts,expires_at)
 VALUES('a05-fixture',1,now()+interval '1 hour');
INSERT INTO public.chat_quota_buckets(bucket,requests,units,expires_at)
 VALUES('session:'||repeat('c',64),1,0,now()+interval '1 hour');
INSERT INTO public.chat_concurrency_leases(lease_id,session_key,ip_key,created_at,expires_at)
 VALUES('00000000-0000-4000-8000-000000000015',repeat('c',64),repeat('d',64),now(),now()+interval '1 hour');

DO $denials$
DECLARE target record; client_role text; first_column text; command text; privilege text;
BEGIN
  FOR target IN SELECT * FROM pg_temp.a05_tables LOOP
    SELECT attname INTO first_column FROM pg_catalog.pg_attribute
      WHERE attrelid = format('public.%I',target.name)::regclass AND attnum>0 AND NOT attisdropped
      ORDER BY attnum LIMIT 1;
    FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      PERFORM pg_temp.a05_expect_denied(client_role,format('SELECT * FROM public.%I LIMIT 1',target.name));
      PERFORM pg_temp.a05_expect_denied(client_role,format('INSERT INTO public.%I DEFAULT VALUES',target.name));
      PERFORM pg_temp.a05_expect_denied(client_role,format('UPDATE public.%I SET %I = %I WHERE false',target.name,first_column,first_column));
      PERFORM pg_temp.a05_expect_denied(client_role,format('DELETE FROM public.%I WHERE false',target.name));
      PERFORM pg_temp.a05_expect_denied(client_role,format('TRUNCATE public.%I',target.name));
    END LOOP;
    IF NOT ('SELECT'=ANY(target.service_acl)) THEN
      PERFORM pg_temp.a05_expect_denied('service_role',format('SELECT * FROM public.%I LIMIT 1',target.name));
    END IF;
    IF NOT ('INSERT'=ANY(target.service_acl)) THEN
      PERFORM pg_temp.a05_expect_denied('service_role',format('INSERT INTO public.%I DEFAULT VALUES',target.name));
    END IF;
    IF NOT ('UPDATE'=ANY(target.service_acl)) THEN
      PERFORM pg_temp.a05_expect_denied('service_role',format('UPDATE public.%I SET %I=%I WHERE false',target.name,first_column,first_column));
    END IF;
    IF NOT ('DELETE'=ANY(target.service_acl)) THEN
      PERFORM pg_temp.a05_expect_denied('service_role',format('DELETE FROM public.%I WHERE false',target.name));
    END IF;
    PERFORM pg_temp.a05_expect_denied('service_role',format('TRUNCATE public.%I',target.name));
  END LOOP;
  FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    PERFORM pg_temp.a05_expect_denied(client_role,'SELECT public.increment_message_count(''00000000-0000-4000-8000-000000000002'')');
    PERFORM pg_temp.a05_expect_denied(client_role,'SELECT public.update_updated_at()');
    PERFORM pg_temp.a05_expect_denied(client_role,'SELECT public.dashboard_consume_login_attempt(repeat(''a'',64))');
    PERFORM pg_temp.a05_expect_denied(client_role,'SELECT public.chat_admit(repeat(''a'',64),repeat(''b'',64),''00000000-0000-4000-8000-000000000100'',''{}'',1)');
    PERFORM pg_temp.a05_expect_denied(client_role,'SELECT public.chat_release(''00000000-0000-4000-8000-000000000100'')');
  END LOOP;
  PERFORM pg_temp.a05_expect_denied('service_role','SELECT public.increment_message_count(''00000000-0000-4000-8000-000000000002'')');
  PERFORM pg_temp.a05_expect_denied('service_role','SELECT public.update_updated_at()');
  IF to_regclass('public.visitors_a05_probe_serial_seq') IS NOT NULL THEN
    FOREACH client_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      PERFORM pg_temp.a05_expect_denied(client_role,'SELECT nextval(''public.visitors_a05_probe_serial_seq'')');
      PERFORM pg_temp.a05_expect_denied(client_role,'SELECT currval(''public.visitors_a05_probe_serial_seq'')');
      PERFORM pg_temp.a05_expect_denied(client_role,'SELECT setval(''public.visitors_a05_probe_serial_seq'',1)');
    END LOOP;
    PERFORM pg_temp.a05_expect_denied('service_role','SELECT setval(''public.visitors_a05_probe_serial_seq'',1)');
  END IF;
  RAISE NOTICE 'A05 SQL: anon/authenticated sin SELECT/INSERT/UPDATE/DELETE/TRUNCATE ni RPC; minimos service_role OK';
END
$denials$;

-- Prueba independiente de ACL: un rol SIN BYPASSRLS y SIN ser propietario
-- recibe temporalmente CRUD, pero ninguna politica aplicable. Falsificar el
-- claim service_role del stub auth.role() tampoco satisface TO service_role.
CREATE ROLE a05_rls_probe NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT;
GRANT USAGE ON SCHEMA public TO a05_rls_probe;
SET LOCAL request.jwt.claim.role = 'service_role';
DO $rls$
DECLARE target record; first_column text; payload jsonb; fixture_count bigint;
BEGIN
  FOR target IN SELECT * FROM pg_temp.a05_tables LOOP
    EXECUTE format('SELECT count(*) FROM public.%I',target.name) INTO fixture_count;
    IF fixture_count=0 THEN RAISE EXCEPTION 'Prueba RLS sin filas: %',target.name; END IF;
    EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON public.%I TO a05_rls_probe',target.name);
    SELECT attname INTO first_column FROM pg_catalog.pg_attribute
      WHERE attrelid=format('public.%I',target.name)::regclass AND attnum>0 AND NOT attisdropped ORDER BY attnum LIMIT 1;
    EXECUTE format('SELECT to_jsonb(t) FROM public.%I t LIMIT 1',target.name) INTO payload;
    -- Copia valida contra NOT NULL/checks; la politica debe rechazar antes de
    -- comprobar unicidad. Cambiar claves tambien evita depender de esa prioridad.
    payload := jsonb_set(payload, ARRAY[first_column], to_jsonb(CASE first_column
      WHEN 'id' THEN '00000000-0000-4000-8000-000000000099'
      WHEN 'lease_id' THEN '00000000-0000-4000-8000-000000000099'
      WHEN 'token_hash' THEN repeat('9',64)
      WHEN 'bucket' THEN 'session:'||repeat('9',64)
      ELSE 'a05-rls-probe' END));
    IF target.name='visitors' THEN payload:=jsonb_set(payload,'{visitor_id}','"00000000-0000-4000-8000-000000000099"'); END IF;
    IF target.name='projects' THEN payload:=jsonb_set(payload,'{slug}','"a05-rls-probe"'); END IF;
    PERFORM pg_temp.a05_expect_zero('a05_rls_probe',format('SELECT * FROM public.%I',target.name));
    PERFORM pg_temp.a05_expect_zero('a05_rls_probe',format('UPDATE public.%I SET %I=%I',target.name,first_column,first_column));
    PERFORM pg_temp.a05_expect_zero('a05_rls_probe',format('DELETE FROM public.%I',target.name));
    PERFORM pg_temp.a05_expect_denied('a05_rls_probe',format(
      'INSERT INTO public.%1$I SELECT (pg_catalog.jsonb_populate_record(NULL::public.%1$I,%2$L::jsonb)).*',target.name,payload::text));
  END LOOP;
  RAISE NOTICE 'A05 SQL: RLS bloquea 20 tablas con ACL CRUD abierto y claim falsificado OK';
END
$rls$;
RESET request.jwt.claim.role;

-- Operaciones legitimas reales del servidor (con RETURNING como PostgREST).
SET LOCAL ROLE service_role;
INSERT INTO public.visitors(visitor_id) VALUES ('00000000-0000-4000-8000-000000000021') RETURNING visitor_id;
UPDATE public.visitors SET page_views=2 WHERE visitor_id='00000000-0000-4000-8000-000000000021' RETURNING visitor_id;
INSERT INTO public.conversations(id,visitor_id) VALUES ('00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000021') RETURNING id;
UPDATE public.conversations SET message_count=1 WHERE id='00000000-0000-4000-8000-000000000022' RETURNING id;
INSERT INTO public.messages(conversation_id,role,content) VALUES ('00000000-0000-4000-8000-000000000022','user','Ficticio servidor') RETURNING id;
INSERT INTO public.leads(id,visitor_id,conversation_id,email) VALUES ('00000000-0000-4000-8000-000000000024','00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000022','servidor@example.invalid') RETURNING id;
UPDATE public.leads SET summary='Ficticio' WHERE id='00000000-0000-4000-8000-000000000024' RETURNING id;
INSERT INTO public.bookings(visitor_id,conversation_id,lead_id,booked_date,booked_time,notes) VALUES ('00000000-0000-4000-8000-000000000021','00000000-0000-4000-8000-000000000022','00000000-0000-4000-8000-000000000024','2035-01-01','11:00','SQL ficticio') RETURNING id;
UPDATE public.bookings SET notes='SQL ficticio actualizado' WHERE visitor_id='00000000-0000-4000-8000-000000000021' RETURNING id;
INSERT INTO public.sent_emails(to_email,subject,status) VALUES ('servidor@example.invalid','Ficticio sin envio','draft') RETURNING id;
INSERT INTO public.content(key,data) VALUES ('a05-server','{}') RETURNING key;
UPDATE public.content SET data='{"title":"Publico ficticio"}' WHERE key='a05-server' RETURNING key;
INSERT INTO public.clients(id,name,updated_at) VALUES ('00000000-0000-4000-8000-000000000030','Cliente servidor ficticio','2000-01-01') RETURNING id;
UPDATE public.clients SET name='Actualizado' WHERE id='00000000-0000-4000-8000-000000000030' RETURNING id;
INSERT INTO public.projects(id,title,slug,updated_at) VALUES ('00000000-0000-4000-8000-000000000025','Proyecto servidor','a05-server','2000-01-01') RETURNING id;
UPDATE public.projects SET title='Actualizado' WHERE id='00000000-0000-4000-8000-000000000025' RETURNING id;
DO $trigger_values$
BEGIN
  IF (SELECT updated_at FROM public.clients WHERE id='00000000-0000-4000-8000-000000000030') IS DISTINCT FROM pg_catalog.now()
    OR (SELECT updated_at FROM public.projects WHERE id='00000000-0000-4000-8000-000000000025') IS DISTINCT FROM pg_catalog.now() THEN
    RAISE EXCEPTION 'Triggers clients/projects no actualizaron el timestamp';
  END IF;
END
$trigger_values$;
INSERT INTO public.project_tasks(id,project_id,title) VALUES ('00000000-0000-4000-8000-000000000026','00000000-0000-4000-8000-000000000025','Tarea servidor') RETURNING id;
UPDATE public.project_tasks SET title='Actualizada' WHERE id='00000000-0000-4000-8000-000000000026' RETURNING id;
DELETE FROM public.project_tasks WHERE id='00000000-0000-4000-8000-000000000026' RETURNING id;
DELETE FROM public.projects WHERE id='00000000-0000-4000-8000-000000000025' RETURNING id;
DELETE FROM public.clients WHERE id='00000000-0000-4000-8000-000000000030' RETURNING id;
INSERT INTO public.services(id,title) VALUES ('00000000-0000-4000-8000-000000000029','Servicio servidor') RETURNING id;
UPDATE public.services SET title='Actualizado' WHERE id='00000000-0000-4000-8000-000000000029' RETURNING id;
DELETE FROM public.services WHERE id='00000000-0000-4000-8000-000000000029' RETURNING id;
INSERT INTO public.feed_entries(text) VALUES ('Feed servidor ficticio') RETURNING id;
UPDATE public.feed_entries SET is_active=false WHERE text='Feed servidor ficticio' RETURNING id;
INSERT INTO public.studio_logs(text) VALUES ('Log servidor ficticio') RETURNING id;
UPDATE public.studio_logs SET is_active=false WHERE text='Log servidor ficticio' RETURNING id;
UPDATE public.studio_stats SET value=2,updated_at='2000-01-01' WHERE key='a05-fixture' RETURNING key;
INSERT INTO public.availability(id,day_of_week,start_time,end_time) VALUES ('00000000-0000-4000-8000-000000000032',6,'09:00','10:00') RETURNING id;
DELETE FROM public.availability WHERE id='00000000-0000-4000-8000-000000000032' RETURNING id;
INSERT INTO public.dashboard_sessions(token_hash,credential_version,expires_at) VALUES (repeat('e',64),repeat('f',64),now()+interval '1 hour') RETURNING token_hash;
DELETE FROM public.dashboard_sessions WHERE token_hash=repeat('e',64) RETURNING token_hash;
DO $service_reads$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.visitors WHERE visitor_id='00000000-0000-4000-8000-000000000021')
     OR NOT EXISTS(SELECT 1 FROM public.bookings WHERE visitor_id='00000000-0000-4000-8000-000000000021')
     OR NOT EXISTS(SELECT 1 FROM public.availability_overrides WHERE id='00000000-0000-4000-8000-000000000013')
     OR NOT EXISTS(SELECT 1 FROM public.content WHERE key='a05-server' AND data->>'title'='Publico ficticio') THEN
    RAISE EXCEPTION 'Lectura/mutacion legitima service_role fallo';
  END IF;
END
$service_reads$;
RESET ROLE;
DO $triggers$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM public.projects WHERE id='00000000-0000-4000-8000-000000000005') THEN
    RAISE EXCEPTION 'Se modifico el fixture privado sin autorizacion';
  END IF;
  IF (SELECT updated_at FROM public.studio_stats WHERE key='a05-fixture') IS DISTINCT FROM pg_catalog.now() THEN
    RAISE EXCEPTION 'Trigger studio_stats no actualizo el timestamp';
  END IF;
  RAISE NOTICE 'A05 SQL: operaciones servidor, RETURNING, triggers y contenido publico via servidor OK';
END
$triggers$;

-- Reset SOLO de tablas sinteticas en la BD desechable para resultados exactos.
DELETE FROM public.dashboard_login_limits;
DELETE FROM public.chat_quota_buckets;
DELETE FROM public.chat_concurrency_leases;
-- Sombras en pg_temp: los RPC con search_path='' deben operar en public.
CREATE TEMP TABLE dashboard_login_limits (bucket text, attempts integer);
INSERT INTO pg_temp.dashboard_login_limits VALUES ('sombra',999);
CREATE TEMP TABLE chat_quota_buckets (bucket text, requests bigint, units bigint);
INSERT INTO pg_temp.chat_quota_buckets VALUES ('sombra',999,999);
CREATE TEMP TABLE chat_concurrency_leases (lease_id uuid);
SET LOCAL ROLE service_role;
DO $rpc$
DECLARE
  result jsonb;
  attempt integer;
  policy jsonb := '{"session_requests":2,"ip_requests":2,"global_requests":10,"global_units":100,
    "window_seconds":86400,"global_window_seconds":604800,"session_concurrency":1,
    "ip_concurrency":2,"global_concurrency":4,"lease_seconds":60}';
BEGIN
  FOR attempt IN 1..5 LOOP
    result := public.dashboard_consume_login_attempt(repeat('1',64));
    IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Login legitimo % fallo',attempt; END IF;
  END LOOP;
  result := public.dashboard_consume_login_attempt(repeat('1',64));
  IF result->>'allowed' IS DISTINCT FROM 'false' OR (result->>'retry_after')::integer<1 THEN
    RAISE EXCEPTION 'Login no bloqueo sexto intento';
  END IF;
  result := public.chat_admit(repeat('2',64),repeat('3',64),'00000000-0000-4000-8000-000000000100',policy,20);
  IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Chat primer admit fallo'; END IF;
  result := public.chat_admit(repeat('2',64),repeat('3',64),'00000000-0000-4000-8000-000000000100',policy,20);
  IF result->>'allowed' IS DISTINCT FROM 'false' OR result->>'reason' IS DISTINCT FROM 'busy' THEN
    RAISE EXCEPTION 'Chat duplicado no bloqueo lease';
  END IF;
  result := public.chat_admit(repeat('2',64),repeat('3',64),'00000000-0000-4000-8000-000000000101',policy,20);
  IF result->>'allowed' IS DISTINCT FROM 'false' OR result->>'reason' IS DISTINCT FROM 'busy' THEN
    RAISE EXCEPTION 'Chat no bloqueo concurrencia de sesion';
  END IF;
  PERFORM public.chat_release('00000000-0000-4000-8000-000000000100');
  PERFORM public.chat_release('00000000-0000-4000-8000-000000000100');
  result := public.chat_admit(repeat('2',64),repeat('3',64),'00000000-0000-4000-8000-000000000101',policy,20);
  IF result->>'allowed' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Chat segundo admit fallo'; END IF;
  PERFORM public.chat_release('00000000-0000-4000-8000-000000000101');
  result := public.chat_admit(repeat('2',64),repeat('3',64),'00000000-0000-4000-8000-000000000102',policy,20);
  IF result->>'allowed' IS DISTINCT FROM 'false' OR result->>'reason' IS DISTINCT FROM 'rate' THEN
    RAISE EXCEPTION 'Chat tercer intento no bloqueo cuota';
  END IF;
END
$rpc$;
RESET ROLE;
DO $rpc_effects$
BEGIN
  IF (SELECT attempts FROM public.dashboard_login_limits WHERE bucket='ip:'||repeat('1',64)) IS DISTINCT FROM 5
    OR (SELECT attempts FROM public.dashboard_login_limits WHERE bucket='global') IS DISTINCT FROM 5
    OR (SELECT count(*) FROM public.dashboard_login_limits) <> 2
    OR (SELECT requests FROM public.chat_quota_buckets WHERE bucket='session:'||repeat('2',64)) IS DISTINCT FROM 2::bigint
    OR (SELECT requests FROM public.chat_quota_buckets WHERE bucket='ip:'||repeat('3',64)) IS DISTINCT FROM 2::bigint
    OR (SELECT requests FROM public.chat_quota_buckets WHERE bucket='global') IS DISTINCT FROM 2::bigint
    OR (SELECT units FROM public.chat_quota_buckets WHERE bucket='global') IS DISTINCT FROM 40::bigint
    OR (SELECT count(*) FROM public.chat_quota_buckets) <> 3
    OR EXISTS(SELECT 1 FROM public.chat_concurrency_leases)
    OR (SELECT attempts FROM pg_temp.dashboard_login_limits WHERE bucket='sombra') IS DISTINCT FROM 999
    OR (SELECT requests FROM pg_temp.chat_quota_buckets WHERE bucket='sombra') IS DISTINCT FROM 999::bigint THEN
    RAISE EXCEPTION 'Efectos RPC no atomicos, duplicados o afectados por search_path';
  END IF;
  RAISE NOTICE 'A05 SQL: 3 RPC service_role, cuotas, rechazo sin doble consumo, release idempotente y search_path OK';
END
$rpc_effects$;

-- Storage publico se limita al bucket intencionado; otra ruta no queda visible.
INSERT INTO storage.buckets(id,name,public) VALUES ('a05-private','a05-private',false);
INSERT INTO storage.objects(bucket_id,name) VALUES ('project-thumbnails','a05-public-ficticio.png'),('a05-private','a05-private-ficticio.png');
SET LOCAL ROLE service_role;
INSERT INTO storage.objects(bucket_id,name) VALUES ('project-thumbnails','a05-server-ficticio.png');
RESET ROLE;
SET LOCAL ROLE anon;
DO $public_storage$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='project-thumbnails' AND name='a05-public-ficticio.png')
    OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='project-thumbnails' AND name='a05-server-ficticio.png')
    OR EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='a05-private') THEN
    RAISE EXCEPTION 'Stub Storage no conserva lectura publica limitada';
  END IF;
END
$public_storage$;
RESET ROLE;
DO $done$ BEGIN RAISE NOTICE 'A05 SQL: lectura publica intencionada del stub thumbnails OK'; END $done$;
ROLLBACK;
\echo 'A05: pruebas SQL desechables completadas y revertidas. No certifica Supabase desplegado ni carreras multiconexion.'
