# Publicación del portfolio y separación de la gestión interna

Validación local del 2 de octubre de 2026. Esta guía explica la corrección A06, cómo aplicar su migración y qué falta verificar antes de habilitarla en producción. La publicación depende de una aprobación administrativa guardada; el estado de producción no concede acceso público.

## Política de publicación

`supabase/migration-v12.sql`, posterior a v11, añade `is_published BOOLEAN NOT NULL DEFAULT false` y `public_description TEXT NOT NULL DEFAULT ''`. En la primera aplicación todos los registros existentes quedan sin publicar, incluidos proyectos completados, entregados y demostraciones. Las nuevas inserciones también nacen sin publicar. No se copia la descripción interna al texto editorial ni se aprueban proyectos para llenar el portfolio.

La migración está diseñada para conservar las aprobaciones y el texto público ya guardados al reaplicarse: no contiene una actualización masiva de filas. Ante una columna preexistente incompatible o permisos que no coincidan con A05, la transacción aborta y exige revisar el esquema. No se amplían permisos de `anon` o `authenticated`, no se añaden RPC ni se modifica la política de servidor de A05. La reaplicación real sigue pendiente de PostgreSQL.

En el panel, la pestaña **Clientes** conserva proyectos, clientes, descripción interna y tareas. La ficha muestra **Portfolio público**, **Aprobar publicación** y **Retirar del portfolio**. Primero se guarda el contenido editorial y después se aprueba. El estado mostrado procede de la respuesta guardada, no de una actualización optimista. Un error deja visible la decisión anterior y muestra el fallo. La retirada puede guardarse aunque existan cambios de edición pendientes.

Cambiar el estado de producción no modifica la aprobación. Editar un proyecto aprobado mantiene su publicación; sus campos públicos guardados pasan a las siguientes respuestas. Para revisar cambios sin mostrarlos durante la edición, retirar primero, guardar y aprobar de nuevo. La aprobación implica revisar título, texto editorial y derechos de las miniaturas y vídeos.

## Contrato público

`src/lib/public-projects.ts` define y reutiliza la selección y la reconstrucción explícita de cada objeto. La consulta de servidor siempre incluye `is_published=eq.true`, incluso usando `service_role`. Se lee también el booleano para comprobarlo de nuevo antes de proyectar; no se devuelve al público.

| Campos publicados | Necesidad de la interfaz |
| --- | --- |
| `id`, `slug` | Identificar la ficha y retirar una tarjeta o vídeo abierto durante la revalidación. El ID no autoriza acceso. |
| `title`, `type`, `category` | Título y clasificación editorial de la pieza. |
| `thumbnail`, `video_url` | Medios deliberadamente aprobados; solo HTTPS o rutas del sitio, sin credenciales ni esquemas ejecutables. |
| `resolution`, `aspect`, `duration` | Ficha técnica y presentación del portfolio. |
| `public_description` | Texto editorial separado, inicialmente vacío y renderizado como texto escapado. Nunca se rellena desde la descripción interna. |

No se publican `client_id`, `client_name`, `description`, clientes/contactos relacionados, tareas, progreso, notas, presupuesto, estado de producción, orden interno ni fechas de gestión. Tampoco se propagan columnas nuevas por accidente: no hay `SELECT *` ni serialización de filas completas en salidas públicas de proyectos.

`GET /api/projects` devuelve un array. Solo admite un `id` y/o un `slug` válido; parámetros para ampliar columnas, estados, relaciones o límites y filtros repetidos se rechazan con 400 antes de consultar. Una referencia válida sin aprobación o inexistente devuelve 404 sin revelar si existe internamente. Un listado vacío devuelve `[]`; ausencia de configuración, de la migración o fallo del almacén devuelve 503 genérico sin datos ni error privado del proveedor.

Las escrituras de `/api/dashboard/projects` requieren autorización central de A01 y origen más CSRF de la sesión en A08. La creación fija `is_published=false` y rechaza `true`, cadenas o números. La aprobación usa exclusivamente `PATCH {"id":"UUID","is_published":true}` y la retirada el mismo contrato con `false`; no se mezclan con otros cambios. UUID, slug, tipos, longitudes, estados, URLs y campos permitidos se validan en servidor. Las respuestas administrativas siguen incluyendo los datos necesarios para gestionar los proyectos.

## Vías públicas revisadas

- Portfolio SSR de portada, tarjetas, datos HTML, eventos del selector y vídeo: usan el contrato público, sin estado ni progreso interno.
- `/proyectos/[slug]`: consulta la publicación vigente; devuelve 404 para proyectos retirados y 503 ante fallo. Título, metadatos y descripción solo usan campos públicos.
- Sitemap: consulta las publicaciones vigentes; no enumera las fichas antiguas de `caseStudies.json`. Ante fallo devuelve 503.
- Demostraciones: `projects.json` y `caseStudies.json` se conservan con `is_published:false` para consulta administrativa; ninguna vista pública los utiliza como fallback. Las ediciones del JSON en **Contenido** no aprueban filas de proyectos.
- Chat: se retiraron los nombres de las ocho demostraciones del prompt. El contexto público del agente describe servicios y formatos genéricos, sin consultar proyectos, clientes o tareas. La ficha puede enviar al chat el título público que el visitante acaba de seleccionar. El historial firmado del visitante sigue sujeto a A04.
- Actividad y métricas: `/api/feed` y `/api/logs` devuelven `[]` sin consultar actividad interna. Sus textos podían contener títulos o tareas incluso con `project_id=null`, y no tienen aprobación editorial independiente. Se muestran estados vacíos. `/api/stats` y la portada muestran únicamente el número de entradas del portfolio publicado; se retiraron métricas de clientes, entregas y producción. La gestión administrativa de feeds, logs y métricas se conserva.

## Caché y retirada

Las consultas de proyectos usan `cache:'no-store'`, límite de cinco segundos y rechazo de redirecciones. Portada, fichas, sitemap y API relacionadas envían `Cache-Control`, `CDN-Cache-Control` y `Vercel-CDN-Cache-Control` con `no-store`, también en respuestas vacías y errores. No existe caché persistente de proyectos en el cliente.

Después de guardar una retirada, las siguientes consultas de servidor dejan de incluirla. Las vistas abiertas revalidan al volver a la pestaña, en `pageshow`, al recuperar foco y cada 30 segundos mientras son visibles. Una retirada o un error limpia tarjetas, selección del visor, vídeo abierto y contenido/metadatos de la ficha. Una vista ya entregada puede conservar el contenido hasta esa revalidación; una petición que ya estaba en curso también puede haber leído la aprobación anterior.

La bandera no revoca copias descargadas, indexaciones históricas ni texto histórico del chat; los vídeos externos dependen de su proveedor. Al cerrar A06, el bucket de miniaturas todavía era público. A10 prepara v14 para cerrar esa vía alternativa y servir sus miniaturas por un proxy local que comprueba la aprobación actual antes de entregar bytes, sin mover/borrar objetos reales. Su aplicación y verificación de Storage/CDN siguen pendientes: [Almacenamiento y exportaciones](ALMACENAMIENTO_Y_EXPORTACIONES.md). La retirada no interrumpe entregas que ya superaron la autorización. Al aplicar las correcciones, invalidar y comprobar las cachés antiguas afectadas; el nuevo `no-store` no borra copias previas por sí solo.

## Aplicación y comprobación pendiente

No se ha aplicado ninguna migración remota ni desplegado esta corrección. Preparar una ventana coordinada: restringir temporalmente las rutas antiguas, comprobar v1–v11 y permisos A05, aplicar v12 como propietario y activar esta versión de las API/vistas. Aplicar solo el SQL mientras sigue sirviéndose la API antigua no resuelve su selección de todas las filas. `ALTER TABLE` requiere un bloqueo de esquema; v12 notifica a PostgREST para recargar su caché al confirmar.

Después de aplicar, comprobar defaults y ausencia de proyectos aprobados, acceso administrativo, denegación de roles públicos, respuestas sin publicación, errores y cabeceras reales de la plataforma. Revisar y aprobar individualmente los proyectos y el texto editorial. No usar el estado `completed` o `delivered` como una aprobación masiva.

Para ejecutar las pruebas SQL, usar exclusivamente un PostgreSQL 14 o posterior con **base y clúster nuevos y desechables**, siguiendo `docs/PERMISOS_SUPABASE.md`. Los roles del bootstrap son globales al clúster; estas fixtures nunca se ejecutan en Supabase ni con datos reales:

1. Ejecutar `supabase/tests/a05-bootstrap.sql` con su confirmación desechable y nombre `akrasia_a05_*`.
2. Aplicar `migration.sql` y v2–v11 en orden.
3. Ejecutar `supabase/tests/a06-prepare.sql`, que guarda filas ficticias existentes y una instantánea de datos y permisos.
4. Aplicar `supabase/migration-v12.sql`.
5. Ejecutar `supabase/tests/a06-verify.sql`; aplica v12 otra vez mediante `\ir` y compara filas y catálogo. Incluye defaults, conservación de datos internos, aprobación/retirada en distintos estados, acceso del servidor y denegación de roles públicos.

## Pruebas locales ejecutadas

Los scripts cargan módulos reales con Vite sin `.env`, usan almacenes HTTP/RPC ficticios y bloquean conexiones externas. La prueba A06 inicia además Astro para comprobar HTML real de portada, ficha y sitemap. No equivalen a ejecutar PostgreSQL ni a verificar Supabase o Vercel desplegados.

| Comprobación | Resultado |
| --- | --- |
| `node scripts/test-project-publication.mjs` | 8 grupos y 315 comprobaciones de API, middleware, datos sensibles adicionales, todos los estados, ID/slug, parámetros manipulados, errores, lista vacía, creación, publicación, retirada y SSR real. |
| `node scripts/test-projects-sql.mjs` | 40 comprobaciones estáticas de v12 y fixtures; no interpreta SQL ni acredita reaplicación real. |
| `node scripts/test-dashboard-auth.mjs` | 20 grupos y 1.676 comprobaciones A01/A08; 19 rutas y 41 handlers. |
| `node scripts/test-chat-limits.mjs` | 31 grupos y 701 comprobaciones A02. |
| `node scripts/test-safe-rendering.mjs` | 9 grupos y 13.841 comprobaciones A03. |
| `node scripts/test-visitor-isolation.mjs` | 12 grupos y 353 comprobaciones A04. |
| `node scripts/test-booking-isolation.mjs` | 12 grupos y 293 comprobaciones de aislamiento de reservas, sin reservas reales. |
| `node scripts/test-supabase-security.mjs` | 3 grupos y 171 comprobaciones estáticas/HTTP A05, adaptadas a la supresión de actividad privada. No SQL/RLS ejecutado. |
| Tipos específicos de proyectos, chat y renderizado | Correctos. `check:projects` incluye las API, middleware, panel y modal afectados. Cuatro plantillas Astro también se transformaron sin diagnósticos sintácticos. |
| Tipos generales de `src` | Solo los dos errores previos de `chatRef` en `Chat.tsx` y `MobileChat.tsx`. |
| Tipos integrales del proyecto | Persisten los dos errores previos de sintaxis TypeScript en `tailwind.config.mjs`. |
| Compilación Astro con entorno aislado y conexiones externas bloqueadas | Correcta. Persiste el destino `nodejs18.x` del adaptador de Vercel. |
| Navegador con Astro y almacén ficticio | Login, datos internos legítimos, aprobación/retirada guardada, portfolio 5→4→5 y ficha retirada por slug conocido con 404. CSP local bloquea analítica, fuentes y medios externos. |

Los comandos se pueden ejecutar con Node directamente porque el lanzador npm de esta máquina no tiene su `npm-cli.js`. Los alias `test:projects`, `test:projects-sql`, `check:projects` y `dev:projects-test` están en `package.json` para un entorno npm funcional. El preview local usa `scripts/serve-project-publication-test.mjs` en el puerto 4325; la contraseña es únicamente la ficticia exportada por su fixture. La primera prueba de navegador tuvo un bloqueo de permisos del sandbox al compilar dependencias; el servidor aislado se reinició con autorización de ejecución y el flujo se validó correctamente.

Evidencia visual con datos ficticios: [aprobación guardada](evidence/a06-publication-admin.jpg), [retirada guardada](evidence/a06-withdrawn-admin.jpg) y [ficha retirada](evidence/a06-withdrawn-detail.jpg).

No hay PostgreSQL local utilizable ni servicio Docker activo. **La ejecución SQL, RLS, permisos efectivos, reaplicación real y comportamiento remoto de caché siguen pendientes.** No se consumió IA de pago, no se enviaron emails/Telegram, no se crearon reservas reales ni se modificaron datos remotos.
