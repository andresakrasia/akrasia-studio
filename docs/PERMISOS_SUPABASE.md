# Permisos de Supabase y RLS (A05)

Corrección local del 2 de octubre de 2026. `supabase/migration-v11.sql` refuerza los permisos de las veinte tablas utilizadas por la aplicación, sus columnas, sus posibles secuencias asociadas y las cinco funciones del repositorio. Incluye `bookings`, `availability`, `availability_overrides` y `sent_emails`, que las migraciones v6–v8 creaban sin RLS. Las v9 y v10 ya protegían las sesiones administrativas y las cuotas; v11 revisa también esos objetos y sus permisos efectivos.

**SQL/RLS y reaplicación ya se han validado en PostgreSQL 18.4 local y desechable; Supabase desplegado sigue pendiente.** Esta guía conserva el alcance original de v11 y sus resultados históricos. La cadena actual añade las restricciones de v12–v18 y pasa la comprobación conjunta: véase [Estado de producción](ESTADO_PRODUCCION.md) y [Migraciones y reproducción](MIGRACIONES_Y_REPRODUCCION.md). Auth y metadatos de Storage son fixtures; PostgREST, objetos, CDN y roles efectivos del destino necesitan validación específica. No se ha desplegado ni modificado datos remotos.

## Identidad y roles utilizados

El navegador llama a las API de Astro. El código de servidor utiliza `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` mediante `apikey` y `Authorization: Bearer …` para todas las operaciones Supabase, incluidas las API de contenido público. No hay un cliente Supabase con `anon` o `authenticated` en el navegador. El nombre de la variable expresa el rol previsto; las credenciales y la asignación efectiva del servicio publicado no se han inspeccionado.

Las cookies firmadas de visitantes y las sesiones administrativas pertenecen a la aplicación y **no equivalen a usuarios de Supabase Auth**. No se añaden políticas con `auth.uid()`. `anon` y `authenticated` no deben leer ni escribir directamente ninguna de estas veinte tablas ni invocar las funciones privadas. `PUBLIC` tampoco conserva permisos sobre ellas.

`service_role` accede a las tablas con los permisos mínimos de la tabla siguiente. En Supabase este rol puede omitir RLS; eso no elimina la necesidad de permisos SQL y tampoco convierte una petición del navegador en una petición autorizada. V11 conserva una política explícita para `service_role` en las tablas con acceso directo, de modo que también funciona en un entorno de prueba donde ese rol no tenga `BYPASSRLS`. La autorización administrativa de [A01/A08](ACCESO_ADMINISTRATIVO.md), los límites de [A02](LIMITES_CHAT.md) y la comprobación de propietario de [A04](AISLAMIENTO_VISITANTES.md) siguen siendo obligatorios en el servidor.

### Inventario de tablas

Todas están en `public`. `S`, `I`, `U` y `D` significan `SELECT`, `INSERT`, `UPDATE` y `DELETE`. No se conceden `TRUNCATE`, `REFERENCES`, `TRIGGER` ni opciones para delegar permisos. En PostgreSQL, revocar privilegios de tabla también retira los correspondientes privilegios de columna. V11 revoca explícitamente las columnas y comprueba los derechos efectivos para cubrir también concesiones previas solo de columna. En PostgreSQL 17 o posterior comprueba además que no quede `MAINTAIN` directo o heredado.

| Tabla | `service_role` directo | Operaciones actuales |
| --- | --- | --- |
| `visitors` | S I U | Perfil del visitante, historial propio y panel |
| `conversations` | S I U | Conversaciones propias y panel |
| `messages` | S I | Persistencia y lectura de mensajes |
| `leads` | S I U | Contactos propios, seguimiento y panel |
| `content` | S I U | Lectura y edición del contenido del panel |
| `projects` | S I U D | Gestión de proyectos y API pública existente |
| `project_tasks` | S I U D | Gestión de tareas y cálculo de avance |
| `feed_entries` | S I U | Actividad, publicación y desactivación |
| `studio_logs` | S I U | Logs, publicación y desactivación |
| `studio_stats` | S U | Estadísticas y modificación de valores existentes |
| `services` | S I U D | Servicios, gestión y API pública |
| `clients` | S I U D | Gestión administrativa de clientes |
| `bookings` | S I U | Reservas propias, agenda y cambios de estado |
| `availability` | S I D | Consulta y gestión de franjas |
| `availability_overrides` | S | Lectura de excepciones; no hay una escritura actual |
| `sent_emails` | S I | Registro y consulta de correos enviados |
| `dashboard_sessions` | S I D | Comprobación, creación y revocación de sesiones |
| `dashboard_login_limits` | Ninguno | Solo mediante la RPC de admisión del login |
| `chat_quota_buckets` | Ninguno | Solo mediante las RPC del chat |
| `chat_concurrency_leases` | Ninguno | Solo mediante las RPC del chat |

V11 activa RLS en las veinte tablas y sustituye sus políticas por `a05_server_only` para `service_role` donde hay acceso directo. Las tres tablas que solo usan RPC quedan sin política de acceso directo. Este cambio retira políticas antiguas, incluso las personalizadas, **solo en estas veinte tablas**. Antes de aplicarlo, comprobar que ningún cliente legítimo ajeno al diseño actual depende de esas políticas o de permisos más amplios.

### Funciones, propietarios y secuencias

| Firma exacta | Tipo y `search_path` tras v11 | `EXECUTE` para roles API |
| --- | --- | --- |
| `dashboard_consume_login_attempt(text)` | `SECURITY DEFINER`, vacío | Solo `service_role` |
| `chat_admit(text,text,uuid,jsonb,bigint)` | `SECURITY DEFINER`, vacío | Solo `service_role` |
| `chat_release(uuid)` | `SECURITY DEFINER`, vacío | Solo `service_role` |
| `increment_message_count(uuid)` | `SECURITY INVOKER`, vacío | Ninguno; helper antiguo no utilizado por las API actuales |
| `update_updated_at()` | `SECURITY INVOKER`, vacío | Ninguno; sigue siendo función de los triggers existentes |

Las tres RPC privilegiadas conservan los algoritmos atómicos de v9/v10. Sus tablas están calificadas con el esquema y sus propietarios deben ser roles de confianza capaces de operar sobre ellas. V11 verifica esa capacidad: un propietario sin permisos o sometido a `FORCE ROW LEVEL SECURITY` sin poder omitirla puede impedir que funcionen las cuotas. No se cambia el propietario ni se conceden membresías para resolverlo automáticamente.

Retirar el `EXECUTE` directo de `update_updated_at()` evita su invocación como RPC y mantiene los triggers ya creados; el procedimiento SQL comprueba actualizaciones reales con esos triggers. No recrear triggers fuera de su contexto de propietario sin revisar los permisos necesarios.

Las migraciones v1–v10 usan identificadores UUID/texto y no declaran vistas ni secuencias de aplicación. Si una tabla gestionada tiene una secuencia añadida posteriormente por propiedad o dependencia de un valor por defecto, v11 retira sus permisos públicos y solo concede `USAGE` a `service_role` cuando esa tabla admite `INSERT`. No concede `SELECT` ni `UPDATE` sobre la secuencia. Una secuencia compartida con otra tabla causa un aborto para revisar su impacto antes de revocar permisos.

## Contenido público y alcance pendiente

El cierre del acceso directo a Supabase conserva las respuestas públicas a través del servidor:

| Ruta | Salida pública existente |
| --- | --- |
| `GET /api/services` | Servicios; conserva el contenido de reserva local |
| `GET /api/stats` | Estadísticas del estudio |
| `GET /api/feed` | Entradas activas, campos seleccionados y título del proyecto asociado |
| `GET /api/logs` | Logs activos con los campos seleccionados |
| `GET /api/bookings` | Huecos de agenda derivados; sin contactos, notas ni filas completas de reservas |
| `GET /api/projects` | Proyectos y avance de tareas del contrato actual; requiere la corrección A06 |

**A06 sigue pendiente:** `/api/projects` usa `select=*`, devuelve el objeto completo del proyecto y no filtra por aprobación de publicación. Puede incluir `client_id`, `client_name`, descripciones internas y todos los estados. A05 no justifica esos campos como publicación intencionada ni los oculta: el servidor usa `service_role` y puede publicarlos a pesar de RLS. La revisión de qué actividad, logs y métricas debe publicarse también pertenece al alcance editorial de A06.

La migración v3 creó el bucket público `project-thumbnails` y una política de lectura de sus objetos. Ese es el contrato histórico comprobado por las pruebas A05 **antes de v14**. V11 **no cambia** `storage.objects`, sus políticas, el bucket ni privilegios generales de Storage. No almacenar contactos, correos o archivos privados en ese bucket. El stub de Storage del procedimiento local solo comprueba que los cambios A05 no rompen ese contrato SQL; no acredita el funcionamiento ni los permisos del servicio Storage publicado.

A10 prepara v14 para cerrar esa lectura pública alternativa y crear un bucket privado de miniaturas. La entrega pasa por el servidor y requiere administración o aprobación A06; no se mueve ni borra contenido real. Aplicar las pruebas históricas A05 antes de v14 y las nuevas A10 después. Configuración, compatibilidad de referencias, revisión de permisos históricos y verificación pendiente de la plataforma: [Almacenamiento y exportaciones](ALMACENAMIENTO_Y_EXPORTACIONES.md). Los permisos de las tablas de aplicación no resuelven por sí solos los permisos de Storage.

Las credenciales privilegiadas permanecen exclusivamente en el servidor, sin prefijo `PUBLIC_`. No incluirlas en respuestas JSON, URLs, logs, componentes o configuración del navegador. La compilación local revisada no encontró referencias privilegiadas en sus artefactos de cliente; la configuración real del despliegue queda pendiente.

## Aplicación revisada de v11

1. Confirmar el entorno y obtener un respaldo recuperable antes de cambiar permisos. Revisar las consultas de catálogo siguientes y guardar el inventario de datos, ACL, propietarios y políticas en un lugar privado.
2. Confirmar que v1–v10 ya están aplicadas. **No volver a ejecutar sus seeds sobre datos existentes** para preparar v11. En una base nueva de prueba sí se aplican en orden para crear el esquema ficticio.
3. Revisar los veinte objetos, los cinco overloads previstos y los roles efectivos. Confirmar que la configuración publicada utiliza `service_role` solo desde el servidor y que A01/A02/A04 siguen activos.
4. Ejecutar exclusivamente `supabase/migration-v11.sql` como propietario de los objetos, con permisos suficientes sobre sus ACL y funciones, en el entorno aprobado. Por ejemplo, con una conexión preparada sin credenciales en el comando: `psql -X -v ON_ERROR_STOP=1 -f supabase/migration-v11.sql`.
5. Comprobar los permisos efectivos, RPC y operaciones legítimas. Reaplicar v11 en el entorno aislado y comparar datos y ACL; después verificar por la Data API del entorno controlado que `anon` y un usuario `authenticated` no puedan leer ni escribir tablas o funciones privadas. Comprobar también las API públicas del servidor y Storage.

V11 usa `BEGIN`/`COMMIT`: un error revierte todos sus cambios y la notificación de recarga de PostgREST solo se entrega al confirmar. Conservar el primer error; no ignorarlo ni continuar en la misma transacción fallida. No contiene seeds, borrados ni modificaciones de filas. Está escrita para reaplicarse de forma segura, pero esa propiedad aún **no se ha ejecutado en PostgreSQL en esta sesión**.

La migración falla deliberadamente ante: roles ausentes; `CREATE` en `public` para roles no confiables; superusuario, `BYPASSRLS` o membresías privilegiadas de `anon`/`authenticated`; propiedad o membresía de propietarios por roles API; tablas ausentes, sustituidas, heredadas o particionadas; secuencias compartidas; privilegios efectivos inesperados; overloads nuevos de las funciones gestionadas; propietarios de RPC incapaces de operar; funciones `SECURITY DEFINER` no pertenecientes a extensiones en `public` que puedan ejecutar roles no confiables; y vistas o vistas materializadas dependientes de las tablas gestionadas accesibles a esos roles, incluso a través de otras vistas o membresías.

Ante un aborto, identificar el objeto, su dueño y sus consumidores mediante el catálogo. Revisar una corrección específica con el propietario y probarla por separado. No borrar una vista, retirar todas las funciones de un esquema, cambiar roles globales ni eliminar membresías sin conocer las operaciones legítimas que dependen de ellas. V11 no realiza esas correcciones generales; tampoco altera permisos por defecto, privilegios del esquema o políticas de Storage.

## Inventario de la plataforma: consultas de lectura

Estas consultas **no se han ejecutado aquí**. Se ofrecen para el propietario en un entorno controlado. El resultado contiene definiciones de rutinas y puede incluir texto privado: guardar el inventario de forma restringida y redactar cualquier secreto antes de compartirlo. No consultar ni imprimir `pgrst.jwt_secret`, claves o variables de proveedores.

### Esquemas expuestos y roles

```sql
-- Estas variables pueden ser NULL aunque la Data API exponga esquemas.
-- Confirmar también los esquemas expuestos en la configuración real de la plataforma.
SELECT current_setting('pgrst.db_schemas', true) AS db_schemas,
       current_setting('pgrst.db_extra_search_path', true) AS extra_search_path;

SELECT r.rolname, setting
FROM pg_catalog.pg_roles r
CROSS JOIN LATERAL unnest(r.rolconfig) AS config(setting)
WHERE setting LIKE 'pgrst.db_schemas=%'
   OR setting LIKE 'pgrst.db_extra_search_path=%'
ORDER BY r.rolname, setting;

SELECT d.datname, CASE WHEN s.setrole = 0 THEN 'ALL'
                      ELSE pg_catalog.pg_get_userbyid(s.setrole) END AS role_name,
       setting
FROM pg_catalog.pg_db_role_setting s
LEFT JOIN pg_catalog.pg_database d ON d.oid = s.setdatabase
CROSS JOIN LATERAL unnest(s.setconfig) AS config(setting)
WHERE (s.setdatabase = 0 OR d.datname = current_database())
  AND (setting LIKE 'pgrst.db_schemas=%'
       OR setting LIKE 'pgrst.db_extra_search_path=%');

SELECT n.nspname, pg_catalog.pg_get_userbyid(n.nspowner) AS owner, n.nspacl,
       pg_catalog.has_schema_privilege('anon', n.oid, 'USAGE') AS anon_usage,
       pg_catalog.has_schema_privilege('anon', n.oid, 'CREATE') AS anon_create,
       pg_catalog.has_schema_privilege('authenticated', n.oid, 'USAGE') AS authenticated_usage,
       pg_catalog.has_schema_privilege('authenticated', n.oid, 'CREATE') AS authenticated_create
FROM pg_catalog.pg_namespace n ORDER BY n.nspname;

SELECT rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb,
       rolcanlogin, rolreplication, rolbypassrls
FROM pg_catalog.pg_roles ORDER BY rolname;

SELECT member.rolname AS member, parent.rolname AS granted_role, m.admin_option
FROM pg_catalog.pg_auth_members m
JOIN pg_catalog.pg_roles member ON member.oid = m.member
JOIN pg_catalog.pg_roles parent ON parent.oid = m.roleid
ORDER BY member.rolname, parent.rolname;

-- Incluye membresías indirectas: revisar también NOINHERIT + SET ROLE.
SELECT api.rolname AS api_role, r.rolname AS assumable_role
FROM pg_catalog.pg_roles api CROSS JOIN pg_catalog.pg_roles r
WHERE api.rolname IN ('anon','authenticated','service_role')
  AND pg_catalog.pg_has_role(api.oid, r.oid, 'MEMBER')
ORDER BY api.rolname, r.rolname;
```

Se espera que `anon`/`authenticated` carezcan de `CREATE` sobre `public`, de atributos privilegiados y de vías para asumir los propietarios de datos o `service_role`. El rol de conexión de PostgREST puede tener membresías necesarias para seleccionar el rol de una petición; revisar su configuración de confianza sin conceder esas membresías al usuario final. No confundir ese rol de conexión con `authenticated`.

### Tablas, columnas, políticas, vistas y secuencias

```sql
-- Todos los esquemas: no limitar el inventario a public.
SELECT n.nspname, c.relname, c.relkind,
       pg_catalog.pg_get_userbyid(c.relowner) AS owner,
       c.relrowsecurity, c.relforcerowsecurity, c.reloptions, c.relacl
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r','p','v','m','S','f')
ORDER BY n.nspname, c.relname;

SELECT n.nspname, c.relname, p.polname, p.polcmd, p.polpermissive,
       ARRAY(SELECT CASE WHEN role_oid = 0 THEN 'PUBLIC'
                         ELSE pg_catalog.pg_get_userbyid(role_oid) END
             FROM unnest(p.polroles) AS roles(role_oid)) AS policy_roles,
       pg_catalog.pg_get_expr(p.polqual, p.polrelid) AS using_expression,
       pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) AS check_expression
FROM pg_catalog.pg_policy p
JOIN pg_catalog.pg_class c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
ORDER BY n.nspname, c.relname, p.polname;

SELECT n.nspname, c.relname, a.attname, a.attacl
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL
ORDER BY n.nspname, c.relname, a.attnum;

-- Derechos efectivos, incluidos PUBLIC y la herencia de roles.
SELECT n.nspname, c.relname, r.rolname, privilege,
       pg_catalog.has_table_privilege(r.oid, c.oid, privilege) AS permitted
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS rights(privilege)
WHERE c.relkind IN ('r','p','v','m','f')
  AND r.rolname IN ('anon','authenticated','service_role')
ORDER BY n.nspname, c.relname, r.rolname, privilege;

SELECT n.nspname, c.relname, a.attname, r.rolname, privilege,
       pg_catalog.has_column_privilege(r.oid, c.oid, a.attnum, privilege) AS permitted
FROM pg_catalog.pg_attribute a
JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
CROSS JOIN pg_catalog.pg_roles r
CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS rights(privilege)
WHERE c.relkind IN ('r','p','v','m','f') AND a.attnum > 0 AND NOT a.attisdropped
  AND r.rolname IN ('anon','authenticated','service_role')
ORDER BY n.nspname, c.relname, a.attnum, r.rolname, privilege;

SELECT n.nspname, c.relname, c.relkind, c.reloptions, c.relacl,
       pg_catalog.pg_get_viewdef(c.oid, true) AS definition
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('v','m') ORDER BY n.nspname, c.relname;

-- Relaciones de valores por defecto con secuencias, también sin OWNED BY.
SELECT ns.nspname AS sequence_schema, s.relname AS sequence_name,
       nt.nspname AS table_schema, t.relname AS table_name, a.attname,
       pg_catalog.pg_get_expr(ad.adbin, ad.adrelid) AS default_expression
FROM pg_catalog.pg_depend d
JOIN pg_catalog.pg_class s ON s.oid = d.refobjid AND s.relkind = 'S'
JOIN pg_catalog.pg_namespace ns ON ns.oid = s.relnamespace
JOIN pg_catalog.pg_attrdef ad ON ad.oid = d.objid
JOIN pg_catalog.pg_class t ON t.oid = ad.adrelid
JOIN pg_catalog.pg_namespace nt ON nt.oid = t.relnamespace
JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = ad.adnum
WHERE d.classid = 'pg_catalog.pg_attrdef'::regclass
  AND d.refclassid = 'pg_catalog.pg_class'::regclass
ORDER BY ns.nspname, s.relname, nt.nspname, t.relname;

SELECT n.nspname, s.relname, r.rolname, privilege,
       pg_catalog.has_sequence_privilege(r.oid, s.oid, privilege) AS permitted
FROM pg_catalog.pg_class s
JOIN pg_catalog.pg_namespace n ON n.oid = s.relnamespace
CROSS JOIN pg_catalog.pg_roles r
CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) AS rights(privilege)
WHERE s.relkind = 'S' AND r.rolname IN ('anon','authenticated','service_role')
ORDER BY n.nspname, s.relname, r.rolname, privilege;
```

En las veinte tablas se esperan `relrowsecurity=true`, ningún derecho efectivo ni de columna para `anon`/`authenticated`, y los derechos de servidor del inventario. Las tres tablas de cuotas/login tampoco deben permitir acceso directo a `service_role`. Revisar las vistas materializadas como copias de datos que pueden seguir leyéndose sin volver a consultar la tabla fuente; en las vistas normales revisar propietario, dependencias y `security_invoker` cuando la versión lo admita. No asumir que RLS en una tabla protege una vista privilegiada sobre ella.

### Rutinas, overloads, extensiones y permisos futuros

```sql
-- Cada OID/firma se revisa por separado. Incluye rutinas de todos los esquemas
-- y de extensiones; pg_get_functiondef no se aplica a agregados.
SELECT n.nspname, p.proname, p.oid,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
       p.prokind, pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef, p.proconfig, p.proacl, ext.extname,
       CASE WHEN p.prokind <> 'a'
            THEN pg_catalog.pg_get_functiondef(p.oid)
            ELSE '[aggregate: revisar pg_catalog.pg_aggregate]' END AS definition,
       pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
       pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
       pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
LEFT JOIN pg_catalog.pg_depend d
  ON d.classid = 'pg_catalog.pg_proc'::regclass AND d.objid = p.oid AND d.deptype = 'e'
LEFT JOIN pg_catalog.pg_extension ext
  ON d.refclassid = 'pg_catalog.pg_extension'::regclass AND ext.oid = d.refobjid
ORDER BY n.nspname, p.proname, identity_arguments;

SELECT pg_catalog.pg_get_userbyid(d.defaclrole) AS creator_role,
       n.nspname AS schema_name, d.defaclobjtype, d.defaclacl
FROM pg_catalog.pg_default_acl d
LEFT JOIN pg_catalog.pg_namespace n ON n.oid = d.defaclnamespace
ORDER BY creator_role, schema_name, d.defaclobjtype;
```

Se espera que solo las tres RPC del inventario tengan `EXECUTE` para `service_role`, con `SECURITY DEFINER` y `search_path` vacío; ninguno de los cinco helpers/RPC debe ser ejecutable por `anon`/`authenticated`. Los dos helpers son `SECURITY INVOKER`. La ausencia de una ACL explícita en una función no significa ausencia de `EXECUTE`: contrastar con los derechos efectivos, ya que los valores por defecto importan.

**La revisión manual de rutinas desconocidas y de extensiones es obligatoria.** El guard automático de v11 bloquea definers no pertenecientes a extensiones en `public`; no cubre por completo otros esquemas, extensiones, SQL dinámico, cadenas de funciones, HTTP/FDW/dblink u objetos creados fuera del repositorio. Leer cuerpos, propietarios, `search_path`, llamadas y dependencias de las rutinas invocables en los esquemas realmente expuestos, incluidos overloads y funciones de extensión. Revisar también funciones `SECURITY INVOKER` que llamen a una función privilegiada. No retirar funciones de extensión de forma general sin revisar sus consumidores.

V11 no cambia `ALTER DEFAULT PRIVILEGES`: los permisos futuros dependen del rol que cree cada objeto. Cada migración posterior debe aplicar RLS y concesiones explícitas antes de exponer sus tablas/RPC; comparar los ACL por defecto de todos los creadores usados en despliegues.

## Procedimiento reproducible de PostgreSQL aislado

Se necesita PostgreSQL 14 o posterior y **una base y un clúster desechables**. Los roles son globales al clúster: crear solo una base nueva dentro de un clúster compartido no aísla los cambios de roles del bootstrap. Los ficheros `supabase/tests` no son migraciones de producción y nunca deben ejecutarse sobre Supabase ni sobre datos reales.

Los ficheros disponibles son:

- `supabase/tests/a05-bootstrap.sql`: exige confirmación explícita, una base vacía `akrasia_a05_*`, superusuario y ausencia de los roles de prueba. Crea roles sin login, un sustituto de `auth.role()` y un stub mínimo de Storage. Añade el marcador de entorno desechable.
- `supabase/tests/a05-adversarial.sql`: después de v1–v10 abre intencionadamente ACL de tabla/columna, políticas y `EXECUTE`, añade una secuencia asociada y objetos ajenos al alcance. Sirve para comprobar que v11 corrige esa situación y conserva los objetos ajenos.
- `supabase/tests/a05-snapshot.sql`: genera instantáneas deterministas de hashes y recuentos de filas, ACL, columnas, políticas, funciones y estado de secuencias antes y después de la segunda aplicación de v11. Solo lee la base desechable; no imprime filas privadas.
- `supabase/tests/a05-verify.sql`: comprueba permisos efectivos, operaciones denegadas, aislamiento RLS independiente del ACL, operaciones de servidor, RPC, triggers y Storage ficticio. Su transacción revierte filas, el rol auxiliar y ACL temporales; los contadores de secuencias pueden avanzar pese a `ROLLBACK`, por eso se ejecuta después de comparar las instantáneas y exclusivamente en el clúster desechable.

Si ya se dispone de PostgreSQL local, este ejemplo de PowerShell prepara un clúster nuevo ligado exclusivamente a localhost. Ajustar únicamente las rutas de sus ejecutables y un puerto local libre. No reutilizar un servicio ni una base existente.

```powershell
$a05Cluster = Join-Path $env:TEMP ('akrasia-a05-' + [guid]::NewGuid().ToString('N'))
initdb -D $a05Cluster -A trust -U postgres --encoding=UTF8
if ($LASTEXITCODE -ne 0) { throw 'Fallo initdb; detener el procedimiento' }
pg_ctl -D $a05Cluster -l (Join-Path $a05Cluster 'postgres.log') -o '-h 127.0.0.1 -p 55432' start
if ($LASTEXITCODE -ne 0) { throw 'Fallo pg_ctl; detener el procedimiento' }
try {
createdb -h 127.0.0.1 -p 55432 -U postgres akrasia_a05_test
if ($LASTEXITCODE -ne 0) { throw 'Fallo createdb; detener el procedimiento' }

function Invoke-A05Sql([string] $a05File, [string[]] $a05Extra = @()) {
  & psql -X -h 127.0.0.1 -p 55432 -U postgres -d akrasia_a05_test `
    -v ON_ERROR_STOP=1 @a05Extra -f $a05File
  if ($LASTEXITCODE -ne 0) { throw "Fallo SQL en $a05File; detener el procedimiento" }
}

Invoke-A05Sql 'supabase/tests/a05-bootstrap.sql' @('-v', 'a05_disposable=YES_DISPOSABLE_DATABASE_AND_CLUSTER')
Invoke-A05Sql 'supabase/migration.sql'
foreach ($a05Version in 2..10) { Invoke-A05Sql "supabase/migration-v$a05Version.sql" }
Invoke-A05Sql 'supabase/tests/a05-adversarial.sql'
Invoke-A05Sql 'supabase/migration-v11.sql'

function Save-A05Snapshot([string] $a05Output) {
  $a05Lines = & psql -X -qAt -h 127.0.0.1 -p 55432 -U postgres -d akrasia_a05_test `
    -v ON_ERROR_STOP=1 -f 'supabase/tests/a05-snapshot.sql'
  if ($LASTEXITCODE -ne 0) { throw 'Fallo snapshot; detener el procedimiento' }
  $a05Lines | Set-Content -LiteralPath $a05Output -Encoding UTF8
}
$a05Before = Join-Path $a05Cluster 'before-second-v11.txt'
$a05After = Join-Path $a05Cluster 'after-second-v11.txt'
Save-A05Snapshot $a05Before
Invoke-A05Sql 'supabase/migration-v11.sql'
Save-A05Snapshot $a05After
$a05Difference = Compare-Object (Get-Content -LiteralPath $a05Before) (Get-Content -LiteralPath $a05After)
if ($a05Difference) { throw 'La segunda v11 cambio filas o catalogo; revisar las instantaneas antes de continuar' }
Invoke-A05Sql 'supabase/tests/a05-verify.sql'

# Detener solo este clúster de prueba, incluso si una comprobación falla.
} finally {
pg_ctl -D $a05Cluster -m fast stop
}
```

Los seeds históricos solo escriben filas ficticias y URLs; este procedimiento no debe abrir esas URLs ni conectar IA, correo o Telegram. El marcador y los requisitos del bootstrap bloquean su uso accidental sobre una base arbitraria, pero el aislamiento del clúster debe comprobarlo quien prepare el entorno.

Para comprobar los guard de objetos inesperados, únicamente después de pasar el flujo anterior y en ese mismo clúster desechable, crear cada caso por separado:

```sql
-- Caso 1: una vista con permisos del propietario no puede quedar abierta.
CREATE VIEW public.a05_exposed_view AS SELECT to_email FROM public.sent_emails;
GRANT SELECT ON public.a05_exposed_view TO anon;
-- Ejecutar v11: debe fallar con "exposed dependent view" y revertir sus cambios.
-- Después, retirar solo este objeto ficticio y volver a ejecutar v11/verificador.
DROP VIEW public.a05_exposed_view;

-- Caso 2: una función privilegiada adicional no queda protegida por RLS.
CREATE FUNCTION public.a05_exposed_definer() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT count(*) FROM public.sent_emails
$$;
GRANT EXECUTE ON FUNCTION public.a05_exposed_definer() TO anon;
-- Ejecutar v11: debe fallar con "exposed SECURITY DEFINER" y revertir sus cambios.
DROP FUNCTION public.a05_exposed_definer();
```

Estos son pasos separados: ejecutar el bloque de creación, capturar una instantánea, invocar v11 esperando error, capturar otra y comprobar que no hay diferencias, y ejecutar después la retirada del objeto ficticio. No ejecutar el bloque completo seguido ni envolver v11 en una transacción exterior: v11 administra su propio `COMMIT`. Repetir con una membresía `NOINHERIT` hacia un rol ficticio con `SELECT` en una tabla gestionada debe producir un error de privilegios asumibles. Ninguno de estos casos negativos se ha ejecutado aquí.

### Resultados SQL que deben obtenerse

- `anon` y `authenticated`: lectura, inserción, modificación, borrado y llamadas privadas rechazados con SQLSTATE `42501`. Verificar derechos de tabla, columnas, secuencias y `EXECUTE`, también a través de `PUBLIC` y membresías. No aceptar como prueba suficiente un `SELECT` vacío causado por ausencia de filas.
- Sonda RLS con un rol sin `BYPASSRLS` ni propiedad y con permisos de prueba temporales: no ve filas y no puede insertar/escribir filas protegidas. Separa la denegación por ACL de la protección por filas.
- `service_role`: lecturas y mutaciones legítimas del inventario correctas; operaciones excluidas y acceso directo a las tres tablas de cuotas/login denegados. Las RPC de login/admisión/liberación deben funcionar y mantener sus efectos atómicos. Los triggers de `updated_at` deben seguir actualizando la fila.
- Secuencia adversarial: clientes sin acceso; servidor con `USAGE` para insertar pero sin `SELECT`/`UPDATE`. Los ACL y datos de los objetos ajenos creados por la fixture deben conservarse.
- Storage ficticio: miniaturas del bucket público legibles, objetos fuera de ese bucket ocultos para los roles públicos y subidas de servidor admitidas por el stub. Estos resultados no sustituyen una prueba con Storage real.
- Antes y después de la **segunda aplicación de v11**: mismas filas y mismos ACL/políticas/atributos relevantes. La verificación debe registrar y comparar instantáneas, no solo ejecutar dos veces sin error.

Todas las filas y roles auxiliares deben ser ficticios. La verificación revierte sus cambios de prueba salvo los avances no transaccionales de las secuencias de ese clúster desechable. Capturar los errores inesperados, el resultado final del comprobador y la versión de PostgreSQL. Si cualquier comprobación falla, no presentar SQL/RLS ni la reaplicación como validados. El resultado correcto es una comparación sin diferencias, los avisos `A05 ... OK` del verificador y su `ROLLBACK` final. Las pruebas de RPC son secuenciales; no demuestran carreras entre conexiones PostgreSQL simultáneas.

## Pruebas locales ejecutadas

Las cinco suites usan Vite sin configuración ni `.env` del proyecto, un guard de conexiones externas y proveedores/datos ficticios. No se enviaron mensajes, correos o Telegram reales, no se crearon reservas reales y no se consumió IA de pago.

| Ejecución directa | Resultado |
| --- | --- |
| `node scripts/test-dashboard-auth.mjs` | 20 grupos, 1676 aserciones; 19 rutas y 41 handlers |
| `node scripts/test-chat-limits.mjs` | 31 grupos, 701 aserciones |
| `node scripts/test-visitor-isolation.mjs` | 12 grupos, 353 aserciones |
| `node scripts/test-booking-isolation.mjs` | 12 grupos, 293 aserciones |
| `node scripts/test-safe-rendering.mjs` | 9 grupos, 13841 aserciones; 2411 prefijos de streaming |

Total de estas regresiones: **84 grupos y 16864 aserciones correctas**. Son pruebas del contrato de aplicación con dobles locales de PostgREST/RPC, no ejecuciones de SQL.

La suite adicional `node scripts/test-supabase-security.mjs` pasó **3 grupos y 181 aserciones**: compara el alcance SQL con el esquema del repositorio, revisa restricciones de funciones/imports privilegiados y ejercita cinco API públicas con un almacén HTTP ficticio. Está disponible como `test:supabase`. Total combinado: **87 grupos y 17045 aserciones correctas**. Esta suite no interpreta ni ejecuta SQL y no acredita RLS, permisos ni reaplicación en PostgreSQL. Los resultados y límites están registrados en [la evidencia A05](evidence/A05_2026-10-02.json).

La compilación de producción pasó mediante la API de Astro con la configuración existente, directorio de entorno temporal vacío, variables de proveedores retiradas, telemetría desactivada y conexiones externas bloqueadas. Los 17 artefactos en `.vercel/output/static` no contienen `SUPABASE_SERVICE_ROLE_KEY`, `Authorization`, `serviceKey` ni el canario privilegiado ficticio usado durante la comprobación; tampoco se encontraron referencias/imports sensibles en componentes, hooks y `chat-client.ts`. El canario no apareció en los artefactos de servidor, por lo que su ausencia en cliente no acredita una sustitución efectiva de esa variable durante la compilación. La revisión de imports y los artefactos generados no verifica la configuración publicada.

`tsc` para `scripts/tsconfig-chat.json` y `scripts/tsconfig-rendering.json` pasó. La comprobación de `scripts/tsconfig-src.json` conserva únicamente los dos errores anteriores de `chatRef` en `Chat.tsx` y `MobileChat.tsx`. La comprobación global conserva los dos errores de sintaxis TypeScript en `tailwind.config.mjs`. Continúan los avisos anteriores de Browserslist y del adaptador Vercel, que elige Node 18 con el Node local 24.21.0. El launcher `npm` local busca un `npm-cli.js` inexistente; se ejecutaron directamente los mismos scripts con Node, sin instalar dependencias.

No se encontró PostgreSQL utilizable: `psql`, `postgres`, `pg_ctl` y Supabase CLI no están en PATH ni se halló una instalación en las ubicaciones habituales. Docker está instalado, pero su servicio está detenido, no hay procesos Docker y no existe su pipe local. No se arrancó un servicio ni se conectó una base preexistente. **Los ficheros SQL de prueba y la reaplicación siguen sin ejecutarse**; la Data API, los esquemas expuestos, los objetos externos al repositorio, los roles/ACL efectivos, Storage y la configuración real de producción requieren validación posterior.

## Referencias

- [Supabase: RLS y roles que lo omiten](https://supabase.com/docs/guides/database/postgres/row-level-security).
- [Supabase: proteger la Data API, funciones y vistas](https://supabase.com/docs/guides/api/securing-your-api).
- [PostgreSQL: REVOKE, columnas y privilegios heredados](https://www.postgresql.org/docs/current/sql-revoke.html).
- [PostgreSQL: funciones privilegiadas y search_path](https://www.postgresql.org/docs/current/sql-createfunction.html).
