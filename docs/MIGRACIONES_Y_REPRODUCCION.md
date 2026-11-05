# Migraciones y reproducción (A40)

El manifiesto ordena veinticinco archivos de esquema y verifica su SHA256. El ejecutor utiliza un cliente PostgreSQL proporcionado explícitamente por el llamador, un journal privado y bloqueo de migración. No descubre credenciales, no lee `.env` para conectarse y su CLI comprueba archivos sin abrir una base de datos.

## Fuentes y comprobación offline

`supabase/migration-manifest.json` contiene `migration.sql`, después `migration-v2.sql` hasta `migration-v25.sql`. Los seeds opcionales están fuera del manifiesto y no se ejecutan como parte del esquema. Los proyectos, servicios y horarios de ejemplo ya no se insertan mediante la cadena principal; los archivos de `supabase/seeds` requieren su activación explícita y sólo son para la base ficticia señalada por sus guardas.

v20 incorpora las fichas de seguimiento, eventos, borradores y recibos de operaciones vinculados al lead. v21 exige avances consecutivos con evidencia del equipo en presupuesto, aceptación, entrega y cierre; sincroniza cliente/estado del proyecto con su seguimiento y coordina las tareas pendientes con los hitos de entrega. También admite las plantillas de avances, entrega final y cierre. La reparación de coherencia de v21 no cambia `is_published`; publicar el portfolio sigue siendo una decisión independiente. Revisar estas reglas y las instalaciones anteriores antes de aplicar o adoptar un prefijo.

v22 añade recordatorios de reservas; v23 expone al servidor la agenda completa para el selector de fechas. v24 habilita los cambios de horarios semanales y las aperturas o bloqueos para una fecha concreta desde el panel. Sólo concede al rol del servidor las operaciones y columnas necesarias; conserva RLS y los bloqueos que coordinan reservas y cambios de agenda. No cambia filas de horarios, reservas ni notificaciones. Aplicar v24 antes de publicar el nuevo editor de disponibilidad.

v25 añade un aviso por email al administrador para cada nueva reserva confirmada. El aviso se encola en la misma transacción que la reserva, mantiene una única clave por cita y congela destinatario y contenido para sus reintentos. No envía avisos retrospectivos ni altera reservas existentes. Aplicar v25 y configurar remitente, proveedor y worker antes de activar estos avisos en producción.

```text
node scripts/migration-manifest.mjs
node scripts/apply-migrations.mjs --checkmanifest
node scripts/test-migration-manifest.mjs
```

Estas comprobaciones rechazan orden incorrecto, archivos ausentes, hashes distintos y transacciones SQL externas incompletas. Una edición intencional requiere revisar primero el cambio y actualizar el manifiesto local con `node scripts/migration-manifest.mjs --refresh`. No actualizarlo para silenciar una diferencia de una migración ya aplicada: el journal de esa instalación seguirá detectando el cambio y detendrá el proceso.

El lexer reconoce cadenas, identificadores entrecomillados, cuerpos `$$`/`$tag$`, comentarios de línea y comentarios de bloque anidados. Sólo retira el `BEGIN`/`COMMIT` del archivo que envuelve una migración completa; no modifica las instrucciones de cuerpos de funciones. Cada archivo y su entrada de journal se ejecutan juntos en una transacción propia.

## Aplicación mediante cliente explícito

`readMigrationPlan()` de `scripts/migration-manifest.mjs` valida los archivos antes de obtener el plan. `applyMigrationPlan(client, plan)` de `scripts/apply-migrations.mjs` exige un `pg.Client` ya conectado y dedicado a esta operación. El responsable debe identificar y autorizar el destino; el repositorio no incluye una orden que aplique automáticamente el plan a una cuenta real.

El bloqueo consultivo impide dos ejecutores simultáneos que usan este contrato. `akrasia_migrations.journal` registra versión, nombre, hash de fuente, hash de catálogo, fecha de registro y si se adoptó un estado anterior. Su schema y tabla revocan acceso a `PUBLIC`, `anon`, `authenticated` y `service_role`: no se exponen en la API pública. El usuario de migración necesita permisos DDL; una clave API de servicio no es ese usuario.

Una repetición valida las fuentes ya registradas y el catálogo actual, omite el prefijo aplicado y ejecuta sólo las versiones pendientes. Una diferencia de hash, un hueco o un cambio inesperado de catálogo detiene la operación. Una migración fallida revierte ese archivo y su entrada; los archivos anteriores que terminaron correctamente quedan registrados. Corregir el motivo y revisar el estado antes de continuar.

El catálogo incluye tablas gestionadas, columnas, valores por defecto, índices, restricciones, RLS, políticas, triggers, propietarios, ACL y funciones declaradas por el plan. También incluye `integration_outbox`, `chat_turn_operations`, `client_journeys`, `client_journey_events`, `email_drafts` y `client_journey_operations`. No verifica contenido de filas, configuración externa, objetos de Storage, roles ajenos al contrato ni cualquier objeto no gestionado por estas migraciones. El journal no demuestra por sí solo que una instalación esté lista para producción.

## Instalaciones anteriores sin journal

Si ya existen tablas gestionadas pero no hay historial, la aplicación se detiene. No se vuelve a ejecutar una secuencia antigua a ciegas: podría duplicar políticas o datos y alterar privilegios vigentes.

La adopción exige una revisión explícita del prefijo ya presente y del catálogo. `previewMigrationAdoption(client, plan, {throughVersion})` es de sólo lectura y devuelve la versión, los hashes de sus fuentes y `catalogSha256`. Comparar ese estado con el esquema esperado para dicha versión y revisar permisos, funciones y restricciones en un entorno separado; un hash capturado del destino no demuestra que el esquema sea correcto ni que todos esos archivos se ejecutaran históricamente.

Después de la revisión, pasar `adoptExisting: {throughVersion, catalogSha256}` a `applyMigrationPlan`. El booleano `true` se rechaza. Bajo el bloqueo, se vuelve a obtener el catálogo antes de escribir: una diferencia respecto al valor revisado impide la adopción. El prefijo se registra en una transacción como `adopted=true`, sin ejecutar sus SQL, INSERT o políticas; sólo se ejecutan las versiones posteriores con `adopted=false`.

Las fechas y snapshots del prefijo adoptado corresponden al momento de adopción y al catálogo revisado actual. No se fabrica un historial de aplicación ni snapshots anteriores. Conservar por separado la evidencia de revisión, versión y responsable. Si el catálogo no coincide con ninguna versión conocida, resolver esa discrepancia antes de adoptar; no elegir un número arbitrario.

## Reproducción y evidencia

`scripts/test-postgres.mjs` crea un PostgreSQL temporal en loopback, roles ficticios y los esquemas mínimos que usa Supabase. Aplica el esquema en orden, reaplica migraciones y ejecuta pruebas de permisos y concurrencia. Esa base se destruye al terminar; nunca usar el runner contra una base real. Los resultados finales se registran en `docs/evidence/postgres-local.json`.

`verifyMigrationJournal({Client, connection})`, exportado por `scripts/test-migration-manifest.mjs`, sólo admite la conexión temporal identificada por ese runner. Crea una base ficticia nueva; si ya existe ese nombre, falla sin borrarla. Comprueba aplicación, omisión al repetir, rechazo de hash/catalog drift, rollback atómico, journal privado y adopción de un prefijo con datos y política existentes sin reproducirlos. Las diez pruebas de lexer también pueden ejecutarse sin PostgreSQL mediante el comando offline anterior.

El runner completo también aplica las 25 migraciones mediante el journal en otra base nueva con metadatos mínimos de Storage, repite el plan y verifica que se omiten todas. Confirma que servicios, proyectos, estadísticas, feed, logs y horarios comienzan sin filas demostrativas. La prueba pequeña del journal aporta 36 comprobaciones de lexer, rechazo de drift, rollback y adopción; no sustituye las pruebas SQL/RLS de A05–A27 ni una revisión del esquema Supabase desplegado. Los fixtures terminan en rollback o viven exclusivamente en el cluster temporal. No se insertan datos demostrativos en producción para comprobar que funciona.

La evidencia vigente contiene 64 pasos correctos, incluyendo la reaplicación de v20–v25 y las pruebas de permisos semanales, aperturas, bloqueos parciales y bloqueos de día completo en `supabase/tests/dashboard-availability-verify.sql`. `supabase/tests/booking-admin-notification-verify.sql` comprueba el aviso administrativo, su idempotencia, el aislamiento de su historial y el rechazo de trabajos cancelados. `supabase/tests/client-journey-security-verify.sql` comprueba privilegios por tabla/columna y RLS con `service_role` sin bypass de RLS. `scripts/client-journey-concurrency-check.mjs` aporta 35 comprobaciones con seis conexiones: una sola creación de cliente/proyecto por lead, conflicto entre revisiones de borrador, un único correo y evento en cola, un único hito concurrente y rechazo de entrega cuando se confirma primero una tarea pendiente. El resultado del journal completo registra las versiones 1–25 tanto en aplicación como en omisión al repetir.

Estas pruebas SQL y las suites del panel utilizan datos y respuestas de proveedor ficticios. El ensayo manual en la vista aislada del puerto 4323 sí utiliza DeepSeek para el chat y Gemini para redacción/generación, con datos sintéticos en memoria y sin emails reales. Sus pasos y limitaciones se registran en [Ciclo del cliente](qa/ciclo-cliente-completo-2026-10-04.md); no acredita un despliegue, una auditoría completa de interfaz ni las integraciones de una cuenta externa.

## Preparación del despliegue

Preparar una copia protegida y ensayar su restauración en un entorno independiente, incluyendo Storage: no se ha efectuado un backup remoto ni se acredita recuperación por tener un journal. Revisar el destino, ventana de cambios, configuración de plataforma y los resultados de permisos antes de cualquier aplicación autorizada.

Para staging, comprobar primero hashes, plan y catálogo; aplicar o adoptar el prefijo revisado según corresponda; validar RLS/ACL, funciones y reaplicación; completar las pruebas de sesión, publicación, caché, agenda, cola y mantenimiento. Registrar hashes, versión efectiva, resultados y responsables. La retirada de contenido y revocación de sesiones deben seguir operativas durante una recuperación; no añadir bypasses de autorización.

DNS/TLS, remitentes, worker, presupuesto de IA y recuperación operativa se desarrollan en [Operación de producción](OPERACION_PRODUCCION.md). El manifiesto y estas pruebas hacen reproducible el trabajo local; la activación en servicios reales sigue siendo una acción separada que requiere su destino y autorización concretos.
