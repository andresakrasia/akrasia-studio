# Contrato del chat y las reservas (A07)

Corrección local del 2 de octubre de 2026. Reutiliza la sesión HMAC, las cuotas y el deadline de A02, la propiedad de A04 y el renderizado de A03. No añade sesiones, variables, tablas, migraciones ni otro sistema de reservas. No se ha desplegado ni se han probado servicios reales.

Actualización del 4 de octubre: el flujo vigente utiliza el calendario y `booking_request` estructurado del visitante para preparar propuestas sin IA; el proveedor habitual ya no recibe herramientas de reserva. La aceptación contextual abre la guía mediante `{"meeting_guide":true}` después de `[DONE]`. El adaptador estricto descrito a continuación se conserva, pero la selección de fechas no se delega al modelo. Ver [Briefing y calendario](CHAT_Y_CAPTACION.md) y [migración v23 de disponibilidad](RESERVAS_E_INTEGRACIONES.md).

## Entrada y autoridad

`POST /api/chat` exige origen autorizado, sesión válida o nueva sesión emitida por el servidor, JSON UTF-8 sin compresión y todos los límites de A02. El contrato habitual es:

```json
{"messages":[{"role":"user","content":"Quiero una llamada el 2026-10-05 a las 12:00. Mi email es persona@example.invalid."}]}
```

Cada mensaje tiene exclusivamente `role` y `content`. Solo se admiten `user` y `assistant`, con contenido string no vacío. Se rechazan `system`, `developer`, `tool`, `function`, objetos de contenido, arrays, campos adicionales, `tool_calls`, `function_call`, identificadores de herramienta y tamaños/cantidades excesivos antes de admisión, consulta personal, IA o escrituras. El último mensaje debe ser `user`.

Por compatibilidad se validan los transcripts antiguos, pero solo el último mensaje de usuario se utiliza. Los mensajes `assistant` del cliente nunca entran en el prompt ni en los efectos. Se acepta `visitor_id` propio opcional; una identidad ajena y referencias a conversaciones, leads, contactos o reservas se rechazan. No autoriza ninguna operación.

Los únicos otros campos admitidos son `visitor_history`, `visitor_name` y `visitor_company` antiguos, siempre strings acotados (historial: bytes y caracteres hasta `CHAT_MAX_HISTORY_BYTES`; nombre/empresa: 160 bytes y caracteres). Se ignoran. Cualquier otro campo falla, incluidas instrucciones, funciones, herramientas, resultados y configuración. Las referencias por query también fallan.

Hay una sola instrucción `system`, construida exclusivamente en servidor, con fecha actual y zona Europe/Madrid. El historial y el perfil se leen después de la admisión y exclusivamente bajo el propietario de la cookie firmada. El perfil se serializa como datos en un mensaje `user`, no se concatena a las instrucciones del sistema. También se comprueban tipos y límites del contexto recuperado. No se usan instrucciones ni resultados de herramientas proporcionados por el navegador.

Esto acota autoridad y ejecución; no elimina la manipulación semántica de un modelo. Un mensaje o historial propio puede influir en su prosa o generar una propuesta inconveniente. La prosa del asistente, incluidas afirmaciones de éxito, etiquetas o JSON, no acredita acciones. La tarjeta de reserva se controla exclusivamente con eventos del servidor y exige revisar los datos antes de confirmar.

## Proveedor y propuesta

El SDK instalado `openai` utiliza Chat Completions contra OpenRouter y el modelo fijo `~deepseek/deepseek-v4-flash-latest`. Se envía una única herramienta:

```json
{"name":"prepare_booking","arguments":{"date":"2026-10-05","time":"12:00","email":"persona@example.invalid","name":"Persona"}}
```

Es una función con `strict: true`, `additionalProperties: false` y los cuatro campos requeridos; `name` puede ser vacío. La estructura anterior ilustra los argumentos: un JSON escrito como texto no es una llamada. Solo los `delta.tool_calls` del proveedor pueden construir la solicitud. El servidor vuelve a validar nombre, estructura y argumentos aunque el proveedor declare respetar el esquema.

Se exige fecha calendárica `YYYY-MM-DD` no anterior al día actual de Madrid, hora `HH:MM`, email válido de hasta 254 caracteres y nombre string de hasta 150 caracteres sin controles. Los argumentos JSON tienen como máximo 2048 bytes UTF-8. No admiten IDs, instrucciones, URLs, destinatarios de notificaciones, referencias personales, duración, estado, notas ni campos administrativos. Las ambigüedades de una fecha natural se resuelven revisando la fecha civil de la tarjeta; el parser natural antiguo de `/api/bookings` no se utiliza aquí.

El adaptador acumula fragmentos de herramientas con límites. Solo entrega una llamada completa después del terminal `tool_calls` y del cierre correcto del stream. Un prefijo, un terminal `length`/`stop` con llamada incompleta, error posterior, cancelación, función antigua o llamadas múltiples no pueden generar propuesta ni escrituras. Un frame final de contabilidad no vuelve a ejecutar la llamada. El handler admite una repetición idéntica del mismo evento sin segundo efecto; un tercero o una repetición diferente falla antes de efectos.

La herramienta comprueba disponibilidad y genera una propuesta firmada, nunca una reserva. La propuesta lleva datos visibles, propietario derivado de sesión, UUID de reserva generado por el servidor y caducidad de cinco minutos, limitada también por la caducidad de sesión. La firma HMAC utiliza `CHAT_SESSION_SECRET` con un dominio distinto del de la cookie. El token es readable por el navegador y contiene los datos de la propuesta; no se guarda en URLs ni almacenamiento local. No se recupera una propuesta tras recargar la página.

## Confirmación y resultado

El botón de la tarjeta envía un contrato distinto al mismo endpoint:

```json
{"messages":[{"role":"user","content":"Confirmar reserva"}],"booking_confirmation":"TOKEN_FIRMADO_POR_EL_SERVIDOR"}
```

Se valida token, propietario, caducidad y mensaje exacto antes de cuotas o trabajo. Se exige sesión existente. No basta un «sí», una frase del modelo, un historial falsificado o una etiqueta. La confirmación expresa la intención de reservar los datos revisados; el modelo no participa en esa petición y no puede alterarlos. El servidor no puede demostrar que una persona, en lugar de un cliente automatizado con su propia sesión, hizo físicamente el clic.

Tras la admisión se reutiliza la creación y disponibilidad existentes. No se aceptan referencias elegidas por el modelo: la reserva queda vinculada directamente al visitante de la sesión. Se vuelven a validar el propietario, UUID, fecha/hora, contacto, estado confirmado, duración y enlace devueltos por el almacén antes de comunicar éxito o iniciar la notificación. JSON de agenda incoherente o fallos de lectura cierran la operación.

El UUID firmado se inserta como la clave primaria existente de `bookings`. Una repetición consulta por UUID **y propietario**, comprueba los detalles y devuelve la misma reserva sin otra inserción ni aviso. Una colisión concurrente o escritura ambigua se recupera mediante esa consulta, sin repetir el INSERT. Una reserva cancelada no se reactiva. Esto evita duplicar una misma propuesta; **no garantiza exclusión de horarios entre propuestas distintas** (A13).

SSE conserva `content` y `[DONE]` y añade:

- `{"content":"Texto del servidor","replace":true}` sustituye la prosa acompañante de una acción por su estado real.
- `{"action":{"status":"confirmation_required","proposal":{...}}}` presenta los detalles y el botón.
- `{"action":{"status":"confirmed","booking":{"id":"...","date":"...","time":"...","duration_min":30,"meet_url":"..."},"notification":"attempted"}}` confirma una representación guardada validada.
- `{"action":{"status":"unavailable"}}` indica que no hay confirmación de reserva.

El cliente valida los eventos, conserva fragmentos arbitrarios y solo aplica la tarjeta después de `[DONE]`. Descarta errores y resultados incompletos, muestra el enlace HTTPS Jitsi validado mediante React y mantiene Markdown seguro. El token/propuesta se elimina al cambiar/caducar la sesión, limpiar el historial, cancelar la propuesta o enviar otra consulta. No se reconstruyen herramientas desde texto, Markdown ni historial local.

La prosa habitual sigue llegando progresivamente y puede contener afirmaciones inexactas del modelo. Cuando acompaña una llamada, se reemplaza al completar la propuesta. Ninguna frase cambia el estado de la tarjeta ni crea una reserva. La confirmación del servidor nunca se emite antes de validar la escritura.

La notificación existente al equipo no acredita entrega y puede omitir configuración. Por eso se informa `attempted`, `failed` o `already_processed`, nunca «email enviado». Un fallo de aviso no convierte una reserva guardada en inexistente. La confirmación no ejecuta los efectos generales de captura de contacto/transcript: evita volver a notificar leads o esconder una reserva guardada tras un fallo de historial. El resultado queda en la reserva y en la presentación de esta sesión, no se añade al historial remoto de mensajes. Si se interrumpe la conexión después del guardado, repetir el token aún vigente recupera el resultado; la notificación perdida no se reintenta. La recuperación comercial duradera y cola de avisos siguen en A11/A27.

## Límites y configuración

No cambian las variables ni límites de `LIMITES_CHAT.md`. Hay como máximo una llamada al proveedor por admisión y una preparación; no hay rondas de continuación ni reintentos SDK. La confirmación consume una admisión compartida y no llama a IA. Concurrencia, cuotas persistentes por sesión/IP/global, timeout total y comportamiento cerrado ante fallos del almacén siguen vigentes.

La reserva de entrada incorpora ahora la fecha del servidor, el esquema de la herramienta y 256 unidades de margen para herramientas. Se reserva el historial máximo que quepa en `CHAT_MAX_INPUT_UNITS`, nunca se amplía el límite. Se envía un sufijo de mensajes completos dentro de esa reserva; el perfil conserva 2200 unidades de margen. La salida incluye también los bytes de argumentos/nombre/ID de la primera herramienta, además del texto, dentro de `CHAT_MAX_OUTPUT_TOKENS * 16`. Se conserva la reserva de salida y el lease en errores o cancelación, sin refund.

OpenRouter recibe `tool_choice: auto`, `provider.require_parameters: true`, `allow_fallbacks: false`, razonamiento desactivado y salida máxima configurada. Se omite el parámetro opcional `parallel_tool_calls`; se conservan el esquema estricto y el parser local, que rechaza más de una llamada a herramientas antes de persistir el turno o preparar una propuesta. La ausencia de un proveedor compatible falla; no hay fallback a etiquetas. Semántica contrastada con la documentación oficial de [herramientas](https://openrouter.ai/docs/guides/features/tool-calling) y [streaming](https://openrouter.ai/docs/api_reference/streaming), y SDK instalado verificado con respuestas interceptadas. El soporte efectivo de la cuenta, modelo y proveedor se debe validar posteriormente en entorno controlado.

## Verificación local y pendientes

Ejecutar `test:chat-contract`, `test:chat-provider` y `test:chat-actions` (o sus scripts directamente con Node). Usan proveedores, almacenes y avisos ficticios y bloquean red externa, sin `.env`, IA de pago, reservas reales ni notificaciones reales. El fixture `dev:chat-contract-test` permite probar el cliente y la tarjeta reales con SSE y sesiones ficticias en navegador.

Resultados originales de A07: contrato/handler/efectos/cliente SSE 23 grupos / 1175 aserciones; SDK instalado 9 / 99; acciones/almacén simulado 9 / 324; navegador 7 / 117. En esa revisión pasaron las regresiones A01/A08/A02/A03/A04/A05/A06, los tipos afectados y la compilación de producción. Los errores de tipos y Node 18 anotados entonces son históricos; consultar el [estado actual](ESTADO_PRODUCCION.md). Evidencia: [pruebas de navegador](evidence/A07-contrato-navegador.jpg).

Revalidación del 3 de octubre de 2026 tras corregir el parámetro incompatible: SDK **9 grupos / 103 aserciones**, contrato **24 / 1208**, acciones **9 / 159** y tipos del chat correctos. Dos turnos de conversación libre con Gemini 2.5 Flash respondieron mediante el chat real; el segundo recuperó la duración de veinte segundos del historial propio, que también se conservó al recargar. La base de datos siguió siendo la demo local y no se solicitaron propuestas ni reservas. Esta comprobación acredita conversación e historial con el proveedor; las acciones de agenda se verificaron con respuestas ficticias. [Evidencia y alcance](evidence/chat-live-preview-local.json).

Revisión visual adicional de la tarjeta real con datos ficticios: [propuesta en escritorio](evidence/A07-propuesta-navegador.jpg), [propuesta en móvil](evidence/A07-propuesta-movil.jpg) y [resultado confirmado ficticio](evidence/A07-confirmacion-ficticia.jpg). No se abrió la videollamada ni se conectó con servicios externos.

El lanzador npm del equipo no funcionó; se ejecutaron directamente los scripts con Node y el compilador instalado. La compilación utilizó variables de integración vacías explícitas en el proceso hijo, telemetría desactivada y guardia de red externa. No se han leído ni mostrado credenciales en los resultados de pruebas.

Las pruebas de aplicación/SDK no ejecutan PostgreSQL/RLS ni verifican Supabase, OpenRouter, Telegram, Vercel, proxies o CDN publicados. Antes de producción siguen pendientes SQL/migraciones/permisos efectivos de A02/A05/A06, soporte real del proveedor, Node soportado y comprobación de la plataforma.

Continúan A12 (email transaccional), A13 (exclusión atómica de intervalos entre propuestas distintas), A14 (bloqueos parciales y aperturas excepcionales), A15 (parser de la API pública antigua) y A11/A27 (trabajo durable y seguimiento de avisos). [A09](PRIVACIDAD_Y_DATOS_CHAT.md) incorpora localmente retención, borrado y versión persistente del contexto; las propuestas v2 quedan ligadas a esa versión y se invalidan al borrarla. Su activación y verificación SQL/plataforma siguen pendientes. A07 no acredita disponibilidad comercial completa ni inmunidad semántica del modelo.
