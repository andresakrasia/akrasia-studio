# Actividad editorial del estudio y ambiente del HUD

Actualización del 3 de octubre de 2026. La web conserva el chat como navegación y recupera las ventanas de actividad del estudio con contenido editorial aprobado y animaciones de ambiente. Los registros del gestor de proyectos permanecen privados. El movimiento de la interfaz no acredita una generación, render o entrega en directo.

## Fuentes de información

Las tablas existentes `feed_entries` y `studio_logs` conservan `text`, `source`, `level`, `log_type`, `is_active` y los datos de gestión. `migration-v19.sql` añade campos editoriales separados, inicialmente vacíos, una aprobación `is_published=false` y un contador interno `public_revision=0`. No copia notas, tareas, clientes ni texto generado por IA a los nuevos campos.

| Campo editorial | Contrato |
| --- | --- |
| `public_title`, `public_title_en` | Títulos ES/EN de hasta 200 caracteres. |
| `public_text`, `public_text_en` | Textos ES/EN de hasta 2.000 caracteres. |
| `public_event_type` | `studio`, `process` o `milestone`. No afirma éxito técnico de una ejecución. |
| `public_occurred_at` | Fecha real del acontecimiento. La aprobación exige una fecha pasada desde 2000; no se sustituye por la hora del navegador. |
| `project_id` | Vinculación opcional. Requiere un proyecto publicado y se comprueba también en cada lectura pública. Sin vínculo representa una novedad editorial del estudio. |
| `is_published`, `public_revision` | Aprobación explícita y versión para revisar exactamente el contenido consultado; no forman parte del JSON público. |

Activar un registro interno con ON/OFF no lo publica. Completar una tarea, cambiar el estado del proyecto o generar una propuesta con IA tampoco lo publica.

## Gestión y aprobación

En **Feed & Logs** del panel se encuentra **Actividad editorial pública**, antes de los registros internos. Se elige **Avances de producción** o **Novedades del estudio**, se crea una entrada, se escriben ambas versiones, la fecha y un proyecto público opcional. La vista previa usa texto escapado, sin interpretar HTML. Primero se guarda el borrador y después se pulsa **Aprobar publicación editorial**. La retirada tiene su propio botón.

Las API administrativas existentes `/api/dashboard/feed-entries` y `/api/dashboard/studio-logs` conservan sus operaciones internas y admiten los campos nuevos. Todas pasan por sesión administrativa, origen y CSRF existentes. La creación fuerza `is_published=false` y rechaza que el cliente indique una aprobación o contador inicial. Un `operation_id` estable evita duplicados cuando se reintenta la misma creación.

La aprobación usa `PATCH {id,is_published:true,public_revision:N}`. El servidor valida texto ES/EN, fecha, tipo y publicación vigente del proyecto. La escritura filtra por la misma revisión; si otra edición ganó la carrera, responde con conflicto y exige recargar/revisar. La retirada usa `PATCH {id,is_published:false}` y puede realizarse sin aprobar una nueva revisión.

Editar cualquier campo editorial o `project_id` retira la aprobación. El trigger SQL incrementa `public_revision` cuando cambia materialmente el contenido, aunque la escritura provenga de otro camino administrativo. La aplicación también retira al guardar el borrador. Los cambios internos de `is_active`, `text`, `level` o `log_type` no alteran el texto editorial publicado.

Al retirar un proyecto, el trigger retira también sus entradas aprobadas. Volver a publicar el proyecto no las reactiva: hay que revisarlas y aprobarlas de nuevo. Los bloqueos de fila serializan aprobación/retirada; un conflicto concurrente puede abortar y debe mostrarse como fallo, sin atribuir éxito. Se conservaron ACL/RLS de servidor, sin conceder acceso a tablas o funciones a `anon`/`authenticated` ni exponer los triggers como RPC.

## Lectura pública

`src/lib/public-activity.ts` exporta `loadPublicActivity('feed'|'logs',{signal?})` y `PublicActivityEntry`. `/api/feed` devuelve hasta 20 avances y `/api/logs` hasta 15 novedades, ordenados por fecha e ID descendentes. Rechazan parámetros para ampliar campos o filtros.

Cada respuesta reconstruye únicamente `{id,title,title_en,text,text_en,event_type,occurred_at,project}`. `project` contiene `{slug,title}` de la publicación vigente o es `null`. No devuelve filas completas, campos internos, clientes, progreso de tareas, revisión ni el permiso de publicación. Filtra `is_published=true` en el almacén y vuelve a comprobarlo antes de proyectar. Las relaciones con proyectos privados o retirados se omiten.

Una lista sin publicaciones devuelve `[]`. Falta de configuración, migración, contrato válido o almacén devuelve 503 genérico y no usa datos privados ni semillas como fallback. Se propaga la cancelación y existe un límite de cinco segundos. La consulta se detiene al completar la ventana; explora como máximo 1.000 filas si hay referencias retiradas que todavía ocupan posiciones. Las cabeceras del servidor y CDN son `no-store` también en vacíos y fallos.

Las retiradas se comprueban mientras la ventana siga abierta. La pausa visual del HUD conserva la revalidación para poder eliminar contenido retirado; no cambia la autorización. Una respuesta ya entregada o una lectura que superó la comprobación previa a la retirada puede conservar el contenido hasta revalidar. El historial del visitante conserva texto público ya recibido conforme a la política de conservación del chat.

## Ambiente y demostración

Los paneles de actividad presentan fechas reales y vínculos hacia la conversación del proyecto. El ambiente visual del HUD usa elementos de interfaz y no inventa cargas GPU, facturación, clientes o rendimientos. **Pausar actividad** y la preferencia de movimiento reducido permiten leer con la misma funcionalidad del chat; las actualizaciones de autorización continúan.

La vista previa local compone un catálogo editorial y un proyecto **DEMO · Producción audiovisual ficticia**, autorizado para comprobar la experiencia. Dos entradas lo identifican expresamente como ficticio, con fechas fijas; otra presenta la filosofía del estudio. `scripts/public-activity-test-fixture.mjs` solo configura el almacén en memoria. La miniatura local `demo-audiovisual.svg` indica DEMO; no es una entrega audiovisual ni contenido de cliente. La migración y su manifiesto no insertan ninguna de estas filas.

## Validación y activación

`node scripts/test-public-activity.mjs` comprueba 9 grupos y 95 aserciones con HTTP ficticio: allowlist, separación de textos internos, publicación de proyectos, sesión/origen/CSRF, borradores y reintentos, ES/EN, fechas inválidas/futuras, CAS de revisión, retirada/reaprobación, límites, normalización del timestamp de PostgREST, texto HTML literal, cancelación y fallos cerrados. Bloquea peticiones externas y no carga `.env`.

`node scripts/test-postgres.mjs` pasó 44 archivos/módulos con PostgreSQL 18.4 nuevo y desechable en loopback: aplica y reaplica v1–v19 y ejecuta `supabase/tests/public-activity-verify.sql`. Se verifican defaults, textos separados, aprobación del servidor, denegación de roles públicos, retirada atómica al editar, contador, aprobación obsoleta, retirada/republicación de proyecto y conservación de filas al reaplicar. El manifiesto completo registra 19 migraciones y su repetición no ejecuta semillas ni vuelve a aplicar archivos. `public-activity-concurrency-check.mjs` pasó 7 comprobaciones con conexiones concurrentes para ambos órdenes de aprobación/retirada y una edición entre revisión y aprobación.

También pasan las regresiones administrativas: 20 grupos/1.680 aserciones de sesión y CSRF, 10 grupos/509 de datos del panel y 5 grupos/311 de permisos/HTTP A05. La evidencia se guarda en [public-activity-local.json](evidence/public-activity-local.json) y [postgres-local.json](evidence/postgres-local.json). Los tipos de `src` pasan; la verificación visual y compilación integradas se documentan en el estado global de esta restauración.

Antes de activar en producción: revisar el prefijo existente y su diario conforme a [Migraciones y reproducción](MIGRACIONES_Y_REPRODUCCION.md), aplicar v19 coordinadamente con este código y verificar respuestas, cabeceras, edición/aprobación/retirada y permisos mediante PostgREST real. La nueva versión falla cerrada si la migración no está disponible. No hay aprobación masiva de registros anteriores.

Estas comprobaciones locales no equivalen a validar Supabase/PostgREST, proxies o CDN desplegados. No se ha desplegado, consultado datos reales ni aplicado ninguna migración remota.
