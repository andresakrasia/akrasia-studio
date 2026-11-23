# Catálogo de servicios y vista previa conversacional

El titular confirma seis servicios: producción audiovisual con IA, marketing y estrategia, creación de contenido, dirección creativa, VFX y postproducción, y diseño sonoro. `src/data/services.json` y `src/data/serviceDetails.json` preparan sus textos en español e inglés. Los textos concretan el trabajo sin garantizar resultados comerciales, presupuestos, plazos ni capacidades técnicas no confirmadas.

La fuente pública de producción sigue siendo la tabla `services`, con publicación explícita. Estos JSON no son un fallback: una retirada, un borrado o un fallo de base de datos no vuelve a mostrar el catálogo local. Los slugs históricos `ai-generation`, `direction`, `vfx-post` y `sound-design` se conservan. El registro histórico `branded-content`, si existe en la base de datos, no se borra ni modifica mediante esta preparación.

## Preparación e importación

`node scripts/prepare-services-catalogue.mjs` genera `supabase/seeds/services-editorial.sql` y no establece ninguna conexión. El archivo es una importación editorial opcional, separada del manifiesto de migraciones; requiere el esquema de migration-v16 o posterior.

El SQL inserta seis borradores con `is_published=false`. `ON CONFLICT (slug) DO NOTHING` conserva los registros que ya existan, sus textos y sus decisiones de publicación, también después de reaplicar. No actualiza proyectos, estadísticas o actividad. Antes de aplicar, revisar las coincidencias de slug y los textos existentes. Después de importar, completar o revisar las fichas desde «Contenido» y aprobar cada servicio desde «Studio». No se ejecutó contra una base de datos existente o remota.

## Vista previa local

`node scripts/serve-chat-first-test.mjs --port 4322` abre el hub y `/dashboard/login` con seis servicios publicados solamente en memoria. La contraseña de demostración es `Synthetic administrator password 2026`. Se utiliza el inicio de sesión normal, sesiones revocables y CSRF de la aplicación; no hay una excepción de autorización en producción.

La vista previa contiene un único proyecto claramente identificado como DEMO y dos avances ficticios vinculados a él, además del manifiesto del estudio. No representan encargos, clientes o resultados reales. El chat y el panel comparten la misma memoria: editar, aprobar, retirar o borrar un servicio cambia lo que devuelve la conversación. Reiniciar el proceso restablece la demostración. Los fixtures anteriores de regresión permanecen independientes.

El modo predeterminado (`npm run dev:hub-demo`) no carga `.env`, utiliza servicios locales simulados y bloquea acceso a servicios externos. La IA de pago, el envío de mensajes y las integraciones reales de agenda no se habilitan. Sirve para comprobar la navegación, el contenido y la edición: los mensajes libres requieren el modo siguiente y, sin él, devuelven «chat no disponible».

Para conversar con IA real usando el mismo hub de demostración: `npm run dev:hub-live`, equivalente a `node scripts/serve-chat-first-test.mjs --port 4322 --live-chat`. Esta opción lee únicamente `OPENROUTER_API_KEY` del entorno o de `.env`; no carga las credenciales reales de Supabase, correo, Telegram o agenda. Permite exclusivamente el POST de completions de OpenRouter, sin redirecciones. Las consultas escritas consumen el proveedor configurado; los mensajes predefinidos continúan respondiéndose desde el catálogo público local. La sesión firmada, cuotas, historial propio y validación del streaming son los mismos de la aplicación.

La base de datos y el panel siguen en memoria, con servicios y proyectos ficticios; reiniciarlos elimina esos datos de demostración. No se envían correos ni avisos reales y este modo no acredita una reserva o agenda desplegada. No es un arranque de producción ni aplica migraciones remotas. La clave permanece en el servidor y no se imprime en el arranque.

## Verificación

El diseño aprobado se ha aplicado conservando el logo original y la navegación mediante preguntas dentro del chat. La conversación permanece visible también en móvil y los proyectos públicos se muestran como tarjetas. [Diseño, fotograma de demostración y comprobaciones](UI_HUB_CONVERSACIONAL.md).

`node scripts/test-services-catalogue.mjs` verifica el catálogo completo ES/EN, los doce selectores de las seis fichas, detalles y características, autorización administrativa, sesión, CSRF, creación de borradores, aprobación, edición, retirada y borrado. También comprueba que el chat no usa fallback al retirar un servicio o fallar el almacén.

`node scripts/test-services-catalogue-sql.mjs` crea un PostgreSQL temporal nuevo en localhost y prueba la inserción, reaplicación y conservación de edición, aprobación y retirada. No acepta una URL de conexión ni accede a bases de datos existentes. Esta prueba focalizada no sustituye la validación del SQL/RLS y la plataforma desplegada.

Resultados locales del 3 de octubre de 2026: **114 comprobaciones funcionales correctas y 29 comprobaciones SQL correctas** en PostgreSQL desechable. En Windows el inicio del motor necesitó ejecución fuera del token restringido del sandbox; el proceso y el directorio temporal se cerraron al acabar.

La corrección del arranque conversacional pasa **5 grupos/72 aserciones** de selección de credenciales y aislamiento de red; proveedor **9/103**, contrato del chat **24/1208**, reloj de la vista previa **4/32**, límites del chat **31/701** y catálogo **114 comprobaciones**. Estas pruebas automatizadas usan claves, respuestas y almacenes ficticios. El diagnóstico inicial obtuvo **401** de OpenRouter; una configuración intermedia autenticaba una clave de administración, que no permitía inferencia. El titular aportó después una clave API normal: se corrigió exclusivamente su prefijo duplicado y su autenticación respondió **200**, sin privilegios de administración ni aprovisionamiento. La generación encontró además un **404** por exigir `parallel_tool_calls`, parámetro no admitido por los endpoints del modelo; se omitió conservando los requisitos de parámetros, el esquema estricto y el rechazo local de llamadas múltiples. Se corrigió también el reloj de los fixtures interactivos para que los bloqueos de concurrencia caducaran, manteniendo el reloj determinista de las pruebas y las cuotas. Tras reiniciar, **dos turnos completos de IA real se verificaron en el navegador**: el visitante pidió un vídeo de 20 segundos para una marca ficticia y, al preguntar después la duración indicada, el chat respondió 20 segundos usando el contexto de la conversación. No hubo errores ni propuestas o reservas en esa comprobación. Solo se conectó el proveedor de IA: base de datos y panel siguen siendo demostraciones locales, sin correo ni agenda reales. Esta comprobación no acredita SQL/RLS ni la plataforma desplegada. [Alcance del diagnóstico](evidence/chat-live-preview-local.json).
