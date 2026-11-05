# Chat, captación e idempotencia (A16–A18, A27)

## Contrato y cambios

POST `/api/chat` requiere la cookie firmada, origen exacto y JSON limitado de A02/A04/A07. Cada operación añade `operation_id` UUID y `language: 'es' | 'en'`. El cliente crea un UUID por mensaje lógico, lo conserva en su caché de sesión mientras el resultado sea incierto y lo reutiliza al volver a enviar el mismo texto. Tras éxito, un envío intencional nuevo genera otro UUID. Cambiar sesión, generación o borrar el chat invalida la caché anterior. Clientes anteriores sin los campos nuevos reciben 400; actualizar cliente y servidor juntos.

La migración `supabase/migration-v17.sql` se aplica después de v16. `chat_turn_operations` tiene RLS y carece de privilegios directos para roles API. Contiene identificadores, generación, concesión y HMAC del texto/idioma; no guarda una copia del texto, contactos o respuesta. La respuesta y metadatos de propuestas permanecen en mensajes, con la retención de 30 días y borrado A09. Los recibos completos desaparecen al borrar cualquiera de sus mensajes; los restantes caducan con la sesión y su limpieza es acotada. La retención integrada usa también `chat_operations_retention`.

`chat_claim_turn` distingue petición nueva, petición activa y respuesta ya guardada. Una operación activa devuelve espera; un ID reutilizado con otro visitante, contexto o contenido se rechaza. Después de completar el guardado, repetir el mensaje devuelve la respuesta persistida sin una segunda llamada IA, mensaje, contacto ni aviso. Toda petición pasa por A02 y los reintentos no restituyen las cuotas. Si se pierde la respuesta después del commit, el mismo UUID recupera el resultado. Si la IA terminó pero no se persistió, un reintento tras la concesión puede consumir otra llamada acotada; no hay promesa de idempotencia del proveedor IA.

`chat_save_turn` guarda los dos mensajes, acumula el perfil y crea un aviso mínimo en `integration_outbox` dentro de la misma transacción. La firma antigua del RPC queda revocada a `service_role`; sólo la firma con UUID/HMAC puede escribir. El aviso de Telegram contiene una referencia de lead para revisar en el panel, sin copiar emails, teléfonos ni la conversación. Los estados y reintentos de entrega se describen en [Reservas e integraciones](RESERVAS_E_INTEGRACIONES.md).

Las propuestas A07 guardadas en mensajes pueden recuperarse mientras sean válidas; si caducaron se informa y se pide una propuesta nueva. Las confirmaciones mantienen su propia idempotencia por UUID firmado de reserva y no se vuelven a pasar por IA. El comando exacto es `Confirmar reserva` en ES y `Confirm booking` en EN; la frase y el token se validan conjuntamente. Propuestas, resultados de reserva y estados de borrado siguen el idioma de la petición/interfaz.

## Briefing y calendario de videollamadas (4 de octubre de 2026)

El agente desarrolla la idea del visitante y conserva los datos ya facilitados. No ofrece proyectos como referencias parecidas ni deriva al catálogo durante el briefing: servicios y trabajos se muestran cuando el visitante los pide. Al conocer la pieza, duración o uso y dirección creativa, propone una videollamada de 30 minutos para valorar el alcance con el equipo.

Una petición explícita de llamada o una aceptación de la oferta más reciente («sí, me interesa») produce la respuesta del servidor y el evento SSE `{"meeting_guide":true}`. Ese evento solo abre la guía después de `[DONE]`, sin consultar IA, preparar una propuesta ni crear una reserva. Un «sí» sin oferta previa, una petición de contacto directo y el texto que imite el evento no abren la guía. El recibo idempotente restaura la misma guía en un reintento. La elección de seguir por chat/email cierra el calendario; un cambio o borrado de sesión elimina su estado.

La guía muestra un calendario mensual con los días que tienen horarios disponibles y todas las horas del día seleccionado, en Europe/Madrid. El visitante selecciona una hora, aporta email/nombre opcional y revisa la propuesta. Los datos se envían como `booking_request` junto al mensaje exacto de `guidedBookingMessage`; el servidor usa `prepareBookingAction` sin pasar por IA. La conversación habitual ya no expone la herramienta de reserva al proveedor ni pide fechas u horas por texto. Escribir «mañana a las 12» tras una oferta abre el calendario para elegir disponibilidad real.

La disponibilidad vuelve a comprobarse al preparar y confirmar. Si el horario deja de estar disponible, se muestra un solo aviso y se reabre/refresca el calendario; nunca se anuncia una reserva fallida como confirmada. El selector necesita `migration-v23.sql` antes de desplegar, según [Reservas e integraciones](RESERVAS_E_INTEGRACIONES.md). Pruebas: `test-meeting-intent.mjs`, `test-meeting-guide.mjs`, contrato A07 y la vista sintética de navegador.

## Captación

Email, teléfono, nombre, empresa y tipo de pieza se extraen únicamente del mensaje nuevo del visitante. El contexto previo procede del servidor y permite interpretar una respuesta aislada a una pregunta de nombre/empresa. Un nombre sin contexto explícito se deja sin atribuir; no se convierte una empresa en persona. Los campos se acumulan sin borrar los enviados en mensajes anteriores, incluso cuando el mensaje contiene sólo nombre, empresa o tipo.

Las palabras del tipo de pieza se comparan completas y las cláusulas negadas no aportan intención positiva. Cuando aparecen dos tipos distintos sin elección clara no se fuerza uno. La puntuación utiliza categorías únicas con pesos, sin duplicar «estreno» ni tomar substrings de palabras ajenas. Una negación explícita reciente enfría la cualificación; las heurísticas son señales para revisión humana, no garantías comerciales.

`interest_score` (0–100) e `interest_level` (`cold`, `warm`, `hot`) están separados de `status`. La captación automática conserva el estado que el equipo haya establecido. `contact_captured_at` de v16 registra el primer email o teléfono y las métricas usan ambos canales. No se infiere un nombre de cualquier palabra ni se asegura que un email extraído pertenezca a la persona.

## Respuestas y streaming

Las respuestas de botones habituales se seleccionan en el servidor, en español o inglés, con el mismo control de sesión, cuotas, contexto y persistencia. No llaman a la IA y funcionan aunque se suspenda su clave, siempre que almacenamiento y autenticación estén disponibles. No contienen casos demostrativos ni promesas de proyectos, precios, disponibilidad, correo o reservas. Se elimina la conversación prefijada que antes sólo vivía en el navegador.

A16 ya estaba cubierto por el parser con buffer de A02: conserva JSON entre bloques, usa decodificación UTF-8 continua y exige la terminación del stream. Se verifica de nuevo sin sustituirlo. La interfaz sólo añade una respuesta completa; errores y texto parcial no acreditan un guardado ni una acción.

## Verificación

`node scripts/test-chat-capture.mjs`: 8 grupos y 172 comprobaciones sobre campos separados/acumulados, negaciones, respuestas ES/EN sin IA, repetición de UUID, respuesta perdida tras commit, operación activa, entradas malformadas, borrado A09 y todos los cortes de bytes de un ejemplo UTF-8/SSE.

La comprobación conjunta en navegador de `scripts/chat-contract-browser.tsx` pasa 11 grupos y 254 aserciones, con 18 solicitudes sintéticas y cero conexiones externas. Verifica propuesta/confirmación tras DONE, enlaces configurados o vacíos, errores, reintentos explícitos sin duplicados, propiedad/caché y cambio dinámico ES/EN incluido el borrado. Evidencia: `docs/evidence/chat-browser-local.json` y `docs/evidence/chat-contract-integrated.jpg`.

Regresiones adaptadas conservando las verificaciones relevantes: contrato A07 24 grupos/1207 comprobaciones, acciones 159 y ciclo de vida A09 210; aislamiento de reservas 294. Los tipos del chat pasan. PostgreSQL 18.4 local y desechable ha aplicado v17 dos veces y superado `supabase/tests/a17-a18-verify.sql`, con validación de recibos, propiedad, idempotencia, perfil, cola atómica y borrado mediante ROLLBACK. V18 y su retención integrada también pasan. La evidencia está en `docs/evidence/postgres-local.json`; estos resultados no acreditan PostgREST ni Supabase remoto. La comprobación conjunta de navegador, compilación y servicios se consolida en el informe principal.

No se ha consumido IA de pago, contactado destinatarios, modificado Supabase remoto ni desplegado. Aplicar y verificar las migraciones, configurar worker/mantenimiento y probar la plataforma siguen siendo pasos de activación.
