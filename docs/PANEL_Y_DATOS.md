# Panel, contenido y datos (A19–A27)

El panel confirma el resultado del servidor antes de cerrar formularios o mostrar cambios guardados. Las rutas administrativas mantienen las sesiones revocables, CSRF y cabeceras de A01/A08. Un almacén inaccesible, una respuesta malformada o una escritura sin fila confirmada produce un error; nunca se convierte en una lista vacía o en un éxito.

## Aplicación y configuración

`supabase/migration-v16.sql` sigue a v15 y debe preceder a v17/v18. Añade los contratos editoriales, los RPC del panel, métricas y recibos de operaciones IA. Su reaplicación conserva datos y no aprueba contenido automáticamente. La ruta reproducible, hashes y adopción de instalaciones anteriores se describen en [Migraciones y reproducción](MIGRACIONES_Y_REPRODUCCION.md).

La cadena vigente contiene 21 migraciones. v20 incorpora cliente, proyecto, seguimiento y borradores vinculados al lead. v21 añade las reglas consecutivas del ciclo, la coherencia del cliente y estado del proyecto, los controles de tareas al entregar/cerrar y las plantillas de avances, entrega final y cierre. Estas migraciones no publican proyectos ni activan un proveedor de correo.

Los servicios existentes reciben un slug estable basado en su UUID y comienzan sin publicar. Revisar el slug, las traducciones y el contenido antes de aprobarlos. Los casos de proyecto existentes tienen campos editoriales vacíos: el editor no importa ejemplos de los archivos JSON antiguos. La autorización de publicación de proyectos de A06 sigue siendo independiente del estado de producción.

Se reutilizan las variables privadas de Supabase y la sesión administrativa. La generación interna requiere la clave IA existente; ninguna credencial llega al navegador. Comprobar las funciones y permisos efectivos con los roles `anon`, `authenticated` y `service_role` en staging antes de habilitar el panel desplegado.

## Escrituras y recuperación de fallos

- Las entradas JSON tienen tamaño máximo, campos permitidos y tipos explícitos. Crear devuelve un objeto; actualizar sólo cambia los campos incluidos. Un UUID inexistente devuelve 404 y un conflicto devuelve 409.
- Un proyecto conserva `thumbnail` cuando no se modifica. Eliminar la asociación de cliente utiliza `client_id: null`; no se envía una cadena vacía como UUID. La edición rápida envía directamente el valor elegido, sin esperar a un estado React anterior.
- Los formularios conservan el borrador ante fallos. Los controles pendientes impiden repetir una acción y las respuestas tardías de páginas anteriores no sustituyen el estado actual. El panel presenta los errores de lectura y escritura, incluidos fallos de confirmación.
- Las creaciones usan un `operation_id` UUID estable por intento lógico, convertido en el ID de la fila. Un reintento con los mismos datos recupera la fila; el mismo ID con datos diferentes falla. El navegador conserva ese ID mientras el resultado sea ambiguo y lo libera tras validar el objeto confirmado. El bloqueo local no sustituye la comprobación del servidor.
- Los errores del almacén tienen códigos controlados e identificador de petición; los logs no vuelcan contactos, contenidos, claves o respuestas del proveedor. Hay límites de tiempo y tamaño para lecturas del servidor.

Las modificaciones de datos ya publicados aparecen en la siguiente lectura pública confirmada. Si un contenido necesita revisión previa, retirarlo antes de editar y aprobarlo después de revisar. Esta implementación no incorpora un sistema separado de versiones editoriales.

## Fuente editorial y publicación

`services` y `projects` son las fuentes canónicas. El editor guarda esas mismas filas mediante `dashboard_save_content`, que valida todos los cambios y los aplica en una transacción; una fila ausente invalida el lote entero. No puede aprobar publicaciones mediante el guardado editorial.

Servicios incluyen título, descripción, slug, icono permitido, textos de ficha, características y proceso en español e inglés. Los casos incluyen brief, proceso, resultado y servicios en ambos idiomas. El formulario utiliza campos estructurados y envía únicamente diferencias. La web, las fichas y el sitemap consumen los contratos públicos reconstruidos por `public-content.ts` y `public-projects.ts`, con publicación explícita y sin datos de clientes, tareas o notas internas.

Antes de aprobar, registrar evidencia de los resultados anunciados, autorización de clientes y derechos sobre imágenes, vídeos y textos. Revisar también las traducciones. Los campos públicos de un caso se publican completos cuando el proyecto se aprueba: no introducir allí información privada. No se incluyen casos ficticios ni afirmaciones importadas de demos.

Las lecturas públicas usan `no-store`; se recorren páginas de cien filas hasta un máximo de mil registros publicados y con un plazo total de cinco segundos. La cancelación llega a la petición activa. Superar un límite produce un error explícito para ampliar el contrato, en lugar de truncar silenciosamente el portfolio o el sitemap. La retirada y las cabeceras de caché reales del CDN deben verificarse en la plataforma.

## Calendario y correos

### Cliente y proyecto desde Leads

La acción **Ficha y seguimiento** permite revisar el nombre del cliente, el título del proyecto y el brief antes de crearlos juntos. `supabase/migration-v20.sql`, posterior a v19, añade las fichas, sus eventos, los borradores y los recibos de operaciones. Repetir la creación para el mismo lead recupera su ficha y conserva un único cliente y proyecto. El proyecto comienza privado, en planificación; la publicación del portfolio sigue requiriendo su aprobación independiente.

**Seguimiento** reúne las fichas. El roadmap comprende recepción, evaluación, preparación y envío del presupuesto, aceptación, producción, revisión, entrega y cierre. Se avanza una etapa cada vez, con indicación del próximo paso. Marcar una propuesta que no continúa, retroceder o retomarla exige una nota con el motivo. El historial registra creación, cambios de etapa, notas, presupuesto y correos puestos en cola. Preparar un correo no confirma una etapa ni un envío.

Para confirmar **Presupuesto enviado** se requieren importe, moneda, alcance, condiciones/plazo y una nota que acredite cómo se confirmó el envío. **Presupuesto aceptado** necesita la confirmación del cliente en una nota. Antes de **Producción** debe existir al menos una tarea. **Entregado** y **Cerrado** exigen que no queden tareas pendientes y una nota sobre materiales/confirmación de entrega o acuerdos de cierre. Los requisitos se comprueban en la interfaz, la ruta y la transacción SQL; los cambios de tareas y etapa se coordinan para impedir una entrega simultánea a la reapertura de trabajo pendiente.

**Abrir proyecto y tareas** abre el proyecto vinculado en **Proyectos y clientes**. Allí se gestionan tareas y se pueden editar nombre, empresa, email, teléfono y notas del contacto; los datos actuales del cliente tienen prioridad sobre los contactos originales del lead. En proyectos vinculados, cliente y estado de producción se derivan del seguimiento y sus selectores son de sólo lectura. El servidor y SQL rechazan un cambio contradictorio; título, descripción, medios y publicación siguen teniendo sus controles propios. Para añadir o reabrir tareas después de entregar o cerrar, primero se retoma el proyecto desde Seguimiento.

La ficha conserva importe y moneda, alcance/condiciones y plazo previsto para preparar el presupuesto. Estos datos proceden del equipo: no se estiman automáticamente a partir del chat. Desde la ficha o el proyecto se pueden preparar correos vinculados al cliente.

### Redacción y recuperación de emails

**Emails** ofrece nueve tipos: recepción/evaluación, presupuesto, seguimiento de propuesta, preparación del proyecto, avances de producción, entrega para revisión, entrega final, cierre y redacción libre. Los textos tienen un tono humano y profesional en español. Los borradores permiten editar destinatario, asunto y mensaje, revisar la vista previa y guardar sin enviar. La adaptación con IA es opcional y requiere la configuración privada existente. Los datos del proyecto se usan como contexto, nunca como instrucciones para el generador.

La ficha y el redactor recuperan automáticamente la conversación vinculada al lead mediante `/api/dashboard/lead-context`. El servidor comprueba que corresponde al mismo visitante y usa las palabras del cliente para completar nombre, proyecto y necesidades. Las preguntas del asistente ayudan a interpretar respuestas breves; sus afirmaciones no se convierten en acuerdos del cliente. Los plazos pedidos se presentan como deseos, sin confirmar disponibilidad ni sustituir las condiciones del presupuesto.

La redacción con IA obtiene ese historial de nuevo en el servidor usando el ID del lead. No depende de que el navegador copie mensajes ni de un ID de visitante proporcionado al generador. El texto del chat es información, nunca instrucciones para la IA. Se omiten mensajes con credenciales identificables. Se conservan hasta 300 mensajes y 60.000 caracteres, con aviso si el contexto está abreviado; las conversaciones largas incluyen el inicio y las últimas aclaraciones. Si no hay historial conservado, el formulario usa los datos conocidos sin inventar los que faltan.

Los borradores ya guardados conservan su asunto y mensaje. El contexto recuperado permite preparar una nueva versión expresamente. Un error o una respuesta incompleta de IA conserva el texto abierto y no envía ningún correo.

Los campos pendientes aparecen como `{{importe_y_moneda}}`, `{{alcance}}` o `{{plazos_y_condiciones}}`. El envío se bloquea hasta completarlos y guardar la revisión vigente. El servidor encola exclusivamente el borrador guardado y rechaza una revisión desactualizada. Un mismo reintento no genera otro envío. La confirmación **En cola de envío** no acredita aceptación ni entrega: el worker y el proveedor mantienen sus estados separados.

Los borradores guardados se pueden recuperar después de recargar. Cambiar entre Leads, Seguimiento, Proyectos y Emails conserva los formularios abiertos durante la sesión de la página. Los cambios sin guardar no sobreviven a una recarga; cerrar el redactor permite guardarlos o descartarlos expresamente.

La vista local de pruebas conserva estos datos en memoria y no envía emails reales. Puede guardar y poner borradores en la cola local; eso no acredita un envío externo. Para el entorno desplegado se requiere aplicar la cadena revisada hasta v21 y disponer de la configuración del proveedor y del worker descrita en [Reservas e integraciones](RESERVAS_E_INTEGRACIONES.md). No se han aplicado migraciones a una base de datos externa durante este desarrollo.

La eliminación del chat desvincula los leads de las fichas y borradores. Clientes, proyectos y su seguimiento comercial tienen conservación independiente; no se eliminan por una limpieza del chat. Los recibos de operaciones caducan tras treinta días mediante el mantenimiento de retención.

Verificación local: `node scripts/test-client-journey.mjs`, `node scripts/test-lead-conversation-context.mjs`, `node scripts/test-email-writing.mjs` y `node scripts/test-postgres.mjs` (base temporal real, reaplicación, permisos y operaciones concurrentes).

El alcance del ensayo manual del ciclo en la vista aislada `127.0.0.1:4323` se registra en [Ciclo del cliente](qa/ciclo-cliente-completo-2026-10-04.md). Esa vista usa datos sintéticos locales, chat real mediante DeepSeek y redacción mediante Gemini; conserva una cola de correo local sin enviar emails reales. La evidencia manual debe leerse junto con sus pasos comprobados y límites: no constituye una auditoría completa de toda la interfaz ni un despliegue de producción. Las suites automáticas descritas abajo usan respuestas ficticias de IA.

La comprobación del redactor del 3 de octubre de 2026 incluye una generación real con el proveedor IA configurado y el historial del lead de la vista local. Se confirmó el contexto, se guardó el borrador vinculado y no se puso ningún correo en cola. La evidencia y el alcance se registran en [Contexto de conversación y emails](qa/lead-context-email-2026-10-03.md); las suites automáticas siguen usando respuestas sintéticas.

El calendario utiliza claves civiles `YYYY-MM-DD` de Europe/Madrid y semanas iniciadas en lunes. No deriva un día mediante la conversión de medianoche a ISO. Comparte `civil-time.ts` con la agenda y mantiene las reglas de reserva del servidor.

Las tarjetas de reserva muestran el estado escrito —Pendiente, Confirmada, Completada o Cancelada— junto al contacto y horario. Las canceladas siguen visibles en su semana para conservar la confirmación de la acción; el color no es la única indicación del estado.

El email administrativo conserva `operationId` mientras destinatario, asunto, cuerpo y plantilla representen la misma operación. La respuesta 202 significa **en cola**; el panel mantiene esa confirmación visible y permite consultar páginas del historial. `accepted` significa aceptación del proveedor, sin acreditar entrega. Generar o enviar desactiva los controles del borrador durante la operación. Las reglas de agenda, worker, reintentos inciertos y estados externos se detallan en [Reservas e integraciones](RESERVAS_E_INTEGRACIONES.md).

## Métricas y conservación

Las métricas son operativas del chat, no analítica de tráfico web. No se registran visitas de página para obtenerlas. El RPC agrega en SQL y usa los límites civiles de día, semana y mes de Europe/Madrid, incluyendo únicamente datos hasta el instante de consulta.

| Métrica | Definición |
| --- | --- |
| Personas con chat hoy | Visitantes distintos con un mensaje propio conservado desde el inicio del día |
| Conversaciones del mes | Conversaciones iniciadas desde el inicio del mes |
| Contactos de semana/mes | Filas con email o teléfono no vacío y primera captación en el periodo |
| Conversión del mes | Conversaciones iniciadas en el mes que tienen contacto captado en ese mismo mes, divididas por todas las conversaciones de esa cohorte |
| Media de mensajes | Mensajes reales de las conversaciones de la cohorte, incluyendo las que tienen cero |
| Duración observada | Distancia entre primer y último mensaje conservado por conversación, incluyendo cero; no mide tiempo de presencia en la web |
| Gráficos | Inicios de conversación por día durante catorce días y contactos captados por semana durante ocho semanas |

`created_at` de conversaciones, mensajes y leads es inmutable. El contador de mensajes se recalcula al finalizar la transacción, también al borrar mensajes. `contact_captured_at` se fija al obtener el primer email/teléfono y no cambia con las actualizaciones comerciales. Para contactos históricos sin fecha separada se usa `created_at`: esa aproximación no permite reconstruir cuándo se captó un contacto antiguo.

El interés calculado (`interest_level`, `interest_score`) se muestra separado del estado comercial manual. La existencia de un perfil sin email/teléfono no cuenta como contacto. Los registros eliminados por las políticas de A09 no se reconstruyen; métricas y gráficos representan los datos aún conservados y pueden reducirse después del mantenimiento. No se promete una serie histórica ilimitada ni una atribución publicitaria.

## Paginación y exportación

Las listas administrativas tienen páginas de cincuenta filas, con máximo de cien por petición y conteo exacto. Las cabeceras `X-Total-Count`, `X-Page-Offset`, `X-Page-Limit` y `X-Next-Offset` permiten recorrer todas las páginas. La búsqueda y el estado de leads se aplican en servidor al conjunto de resultados. Los filtros de perfiles y conversaciones indican que operan sobre la página y los mensajes cargados.

Los historiales cargan primero los últimos cien mensajes por conversación y permiten cargar páginas anteriores. Las tareas de un proyecto y el historial de correo tienen continuación independiente. La paginación por offset de pantallas no constituye una instantánea: nuevas filas o borrados durante la navegación pueden desplazar sus páginas; actualizar permite recuperar el estado vigente.

La lectura de tareas de los proyectos utiliza como máximo seis consultas simultáneas, manteniendo la página y conteo de cada proyecto por separado. Abrir un proyecto desde Seguimiento lo recupera por ID aunque quede fuera de la página visible. Después de crear, cambiar, eliminar o generar tareas, ese registro abierto se vuelve a consultar; el contacto vinculado también conserva su nombre visible aunque no esté en la página de clientes cargada. Las actualizaciones de servidor preservan los cambios de título/descripción que aún se están redactando.

La exportación recorre contactos mediante cursor `created_at/id`, con fecha límite inicial, hasta diez mil filas y ocho MiB. Si el conjunto excede el límite o falla una página, devuelve error sin ofrecer un CSV parcial. Conserva la protección contra fórmulas de A10. Es un resultado de las filas disponibles durante su recorrido, no un backup transaccional: los borrados concurrentes pueden retirar filas. Se debe ampliar el contrato o usar una exportación autorizada de base de datos si se supera el límite.

## IA administrativa e idempotencia

El servidor valida acción, contexto y resultado JSON de la IA. Las propuestas de tareas y de actividad admiten listas acotadas y campos exactos. Un resultado incompleto, truncado o ajeno al contrato no escribe filas. El RPC valida de nuevo y guarda todo el resultado en una transacción. Feed y logs generados comienzan inactivos y requieren activación explícita.

La generación de tareas carga desde el servidor el proyecto actual, brief del seguimiento, etapa, importe/moneda, alcance, plazo/condiciones y tareas existentes. No utiliza el título o resumen obsoleto que pueda enviar un formulario. Consulta hasta quinientas tareas para preparar el contexto; superar ese límite falla antes de llamar a la IA, en lugar de trabajar con una página incompleta. Entregado/Cerrado también rechazan nuevas tareas antes de consumir generación. Los títulos y notas son datos sin autoridad y se filtran las credenciales identificables.

La etapa comercial prevalece sobre el estado genérico de producción: Aceptado organiza preproducción, producción, revisión y entregables del alcance aprobado, aunque el proyecto siga en planificación. Preparando presupuesto propone trabajo sobre alcance y condiciones; Presupuesto enviado propone seguimiento sin darlo por aceptado. En producción y En revisión enfocan el trabajo pendiente y los comentarios disponibles. El prompt exige cubrir formatos, música, subtítulos y exportación cuando formen parte del alcance, sin reiniciar la negociación ni inventar prestaciones.

Se solicita JSON mediante esquema estructurado y un máximo de 4000 tokens de respuesta. Se acepta un objeto completo, también dentro de un único bloque JSON; texto adicional, campos inesperados o una respuesta terminada por límite de longitud no se guardan. Las tareas con título normalizado ya existente y las repeticiones del mismo resultado se filtran. Antes del guardado se consultan de nuevo las tareas para detectar las que aparecieron durante la generación. Los errores y las confirmaciones se muestran en el proyecto.

La reclamación persistente sucede antes de llamar al proveedor. Repetir una operación completa devuelve sus filas actuales sin volver a generar; una operación en curso o sin confirmación devuelve conflicto y necesita revisión. Un fallo del proveedor o una configuración ausente después de reclamar no autoriza otra llamada con el mismo ID. No se generan feed/logs automáticamente al completar una tarea.

El recibo conserva la huella de la operación e IDs de filas, sin copias de títulos, notas, emails o textos. En generaciones vinculadas al proyecto, esa huella identifica acción y proyecto y permanece estable aunque cambien las tareas guardadas; el contexto vigente se carga para una generación nueva. El replay resuelve filas vigentes: borrar una tarea impide recuperar su texto desde el recibo. v18 limpia los recibos administrativos después de treinta días e invoca la limpieza de operaciones del chat caducadas con su sesión. Fuera del plazo del recibo no se garantiza deduplicación. Los datos y mensajes transmitidos al proveedor siguen las condiciones y revisión de privacidad de A09; esta corrección no borra información de una cuenta externa.

## Verificación

Pruebas de ejecución local con almacén y proveedor ficticios:

```text
node scripts/test-panel-data.mjs
node scripts/test-dashboard-auth.mjs
node scripts/test-csv-export.mjs
node scripts/test-project-publication.mjs
node scripts/test-project-media.mjs
node scripts/test-client-journey.mjs
node scripts/test-lead-conversation-context.mjs
node scripts/test-email-writing.mjs
node scripts/test-production-ai-context.mjs
node scripts/test-postgres.mjs
node node_modules/typescript/bin/tsc --noEmit --project scripts/tsconfig-src.json
```

El contrato del panel tiene diez grupos y 509 comprobaciones: páginas completas, búsqueda/estado globales, historial independiente, escrituras confirmadas, inputs rechazados antes de red, preservación de miniatura, cliente nulo, publicación explícita, cancelación activa, CSV completo/acotado y generación atómica/repetible. Las regresiones verifican sesiones/CSRF, CSV seguro, publicación y medios. `supabase/tests/a19-a27-verify.sql` comprueba roles, atomicidad, marcas temporales, métricas, contador diferido y replay sin resucitar texto borrado. El runner PostgreSQL temporal aplica/reaplica las migraciones y registra su resultado final en `docs/evidence/postgres-local.json`; los mocks no acreditan esas garantías SQL.

La regresión de IA de producción tiene nueve grupos y 143 comprobaciones: contexto vigente, tareas fuera de la primera página, aislamiento entre proyectos/clientes, datos sin autoridad, filtrado de duplicados, tareas creadas durante la generación, respuestas completas/inválidas, replay, guía explícita del prompt por etapa, etapas entregada/cerrada y conservación de la edición al actualizar un proyecto fuera de página. Usa respuestas sintéticas, sin llamadas de pago: las comprobaciones del prompt no acreditan por sí solas la pertinencia de tareas de un proveedor real. La evidencia PostgreSQL vigente registra 52 pasos correctos, 21 migraciones aplicadas y omitidas al repetir el journal, y 35 comprobaciones de concurrencia del seguimiento con seis conexiones. Incluye la verificación de privilegios por tabla/columna y RLS con `service_role` sin bypass de RLS.

Antes del lanzamiento quedan la configuración y los permisos reales de Supabase, la aplicación revisada de migraciones, los límites/cabeceras de Vercel/CDN, la programación del mantenimiento, la revisión editorial y las pruebas autorizadas de integraciones. Las suites automáticas no despliegan, no usan IA de pago y no modifican datos reales. El ensayo manual de la vista aislada usa IA real y datos locales sintéticos, sin envío real de correo ni aplicación de migraciones a producción.

## Chat y admin en la vista previa local

La vista de `npm run dev:hub-live` comparte las filas ficticias del chat con el admin. Sus lecturas devuelven el conteo exacto antes de aplicar la página, también cuando no hay registros; los visitantes conservan las fechas de primer chat y última actividad, y los contactos comienzan con estado `new`. La búsqueda y los cambios de estado de leads actúan sobre esas mismas filas. Los mensajes de un turno comparten fecha y se presentan con la consulta del visitante antes de la respuesta.

`npm run test:hub-dashboard` verifica el recorrido compuesto con login y rutas reales, sin `.env` ni proveedor remoto: 7 grupos y 1079 comprobaciones de datos compartidos, listas vacías, filtros, paginación de visitantes/conversaciones/mensajes, orden y autorización. Esta regresión complementa las pruebas del admin aislado y forma parte de `test:production`. Un error de consulta no muestra un mensaje de lista vacía; conversaciones permite volver a consultar con **Actualizar**.

El almacén de esta vista sigue siendo temporal y en memoria; al terminar el proceso no constituye un registro persistente ni una base de producción. La corrección del conteo no requiere cambiar el esquema Supabase.
