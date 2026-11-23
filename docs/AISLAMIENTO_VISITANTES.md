# Aislamiento de visitantes y sus datos (A04)

Corrección local del 2 de octubre de 2026. Reutiliza la identidad HMAC de A02; no incorpora otra sesión, no aplica SQL y no vincula ni borra registros existentes. Las API administrativas conservan su autorización central de A01/A08.

## Identidad y ciclo de vida

`GET /api/visitor-history` inicia una sesión anónima si falta la cookie y devuelve un historial vacío, sin consultar datos privados. Una cookie válida permite recuperar exclusivamente sus conversaciones, nombre y empresa. La respuesta contiene `sessionId` y `sessionExpiresAt` (segundos epoch) para vincular la caché de presentación del navegador; esos campos públicos no autorizan ninguna API. La firma continúa siendo privada del servidor y la cookie `HttpOnly`, `SameSite=Strict` y `Secure` en producción.

La sesión tiene vida fija, 24 horas por defecto (`CHAT_SESSION_SECONDS`), sin renovación deslizante. Mientras sea válida, la vuelta al sitio conserva identidad, conversación y saludo. Al caducar, manipularse, duplicarse o rotarse el secreto, se devuelve 401 y se borra la cookie. El cliente elimina su historial de presentación y solicita una nueva sesión. Un POST fallido no se repite automáticamente. La nueva identidad no recupera ni se apropia de la anterior. Esta decisión acota cuánto tiempo funciona el retorno anónimo; para recuperación duradera haría falta una prueba de propiedad distinta, fuera de A04.

Los UUID antiguos de `akrasia_visitor_id`, `akrasia_vid` y el historial `akrasia_chat_history` se retiran del navegador. Los datos antiguos en la base permanecen intactos y accesibles al administrador autorizado. No se entrega una migración de vinculación: un UUID conocido no acredita propiedad. Tampoco se intenta recuperar una sesión perdida usando nombre, empresa, email o un UUID del navegador.

## Controles de las API

- Historial: solo consulta propietario validado. Una query que apunta a otra identidad o referencia devuelve 403 antes de consultar la base. Cookies ausentes con UUID antiguo no dan acceso. Se proyectan columnas concretas: no salen email, teléfono, IDs de contactos ni notas internas.
- Chat: un `visitor_id` ajeno, o referencias `conversation_id`, `lead_id`, `contact_id` o `booking_id`, se rechazan antes de admisión, datos personales, proveedor o efectos. Un ID propio opcional es compatible, pero no otorga autorización. Se validan tamaño, roles y textos de todo el JSON y solo se utiliza el último mensaje de usuario. Los mensajes anteriores y `visitor_history`, `visitor_name` y `visitor_company` del cliente no construyen contexto del modelo.
- Contexto: se obtiene en servidor desde conversaciones/contactos propios. El historial está acotado por `CHAT_MAX_MESSAGES`, `CHAT_MAX_MESSAGE_CHARS` y `CHAT_MAX_HISTORY_BYTES`; nombre y empresa tienen como máximo 160 caracteres cada uno. Las consultas incluyen límites y proyecciones; los mensajes comprueban también propiedad mediante la relación a conversaciones. Un fallo o respuesta incoherente del almacén bloquea el proveedor.
- Escrituras: las visitas/contactos usan el propietario de la sesión. Los helpers de mensajes y contactos verifican las referencias a conversaciones; las actualizaciones añaden `visitor_id` al filtro. Las reservas públicas exigen sesión vigente, origen configurado y propiedad de cualquier conversación referenciada antes de consultar disponibilidad o escribir. El helper de creación también comprueba conversación y lead. Una referencia ajena e inexistente obtiene el mismo error, sin confirmar que exista.
- Privacidad de respuestas: historial, chat y reservas usan `Cache-Control: no-store, private`, además de las cabeceras de CDN y Vercel. La conexión a datos utiliza `cache: no-store` y rechaza redirecciones. No se registran cuerpos de error de base de datos que puedan contener datos personales ni credenciales.

El cliente verifica la sesión en servidor antes de restaurar caché, al recuperar foco y antes de cada envío, incluso respuestas predefinidas. La caché `akrasia_chat_session_history` queda vinculada a ID y caducidad verificados. Un cambio, caducidad o 401 cancela la respuesta en curso y limpia la presentación anterior. Las cabeceras de sesión de una respuesta de chat permiten detectar una identidad recién creada durante el envío.

## Relación con A02 y configuración

Siguen siendo necesarias la migración v10 y las variables privadas de `LIMITES_CHAT.md`. No se requieren variables ni tablas nuevas para A04. El historial y las reservas utilizan la misma configuración de sesión que el chat, por lo que configuración incompleta cierra esas funciones con 503.

La admisión del chat ocurre **antes** de consultar contexto personal. Se reserva el prompt del servidor, el mensaje nuevo, el máximo de bytes del contexto, 2200 unidades para el perfil serializado, el margen de mensajes y la salida máxima. La reserva se conserva incluso si falla después la carga del contexto. Así, los rechazos por cuota/concurrencia no consultan historial y la entrada enviada al proveedor nunca supera la reserva. Esta reserva conservadora puede alcanzar el límite global antes que una reserva basada solo en los textos efectivos; no aumentar cuotas sin revisar el presupuesto de A02.

## Verificación local y pendientes

`npm run test:visitors` utiliza dos identidades sintéticas A/B y un almacén local con red externa bloqueada. Cubre lecturas propias, queries y JSON ajenos, sesiones ausentes/manipuladas/caducadas, UUID antiguos, renovación sin vinculación, contexto del modelo, límites, caché, fallos del almacén y escrituras de mensajes/contactos/reservas. Incluye representaciones de escritura vacías, inválidas y con propietario/referencias incorrectos, sin efectos posteriores ni confirmación falsa. `npm run test:bookings` completa el recorrido público de referencias y cancelación. No cargan credenciales reales ni llaman a IA, email, Telegram o Supabase remoto.

El navegador se comprueba con `npm run dev:visitors-test` y `http://localhost:4324/`. Ejecuta el ChatProvider real con almacenamiento, historial y SSE sintéticos; comprueba que la caché espera verificación, no aparece B bajo A, cada POST contiene solo la entrada nueva, el retorno funciona, 401 no repite el POST y la caducidad durante SSE aborta y elimina contenido anterior. El fixture A03 actualizado sigue disponible con `dev:rendering-test`. Estos servidores de pruebas no cargan `.env` ni las API publicadas.

Resultados locales finales:

| Comprobación | Resultado |
| --- | --- |
| A04, aplicación y almacén sintético | 12 grupos / 353 aserciones correctas |
| Reservas públicas | 12 grupos / 293 aserciones correctas |
| A04 en navegador | 11 grupos / 116 aserciones correctas, sin conexiones externas |
| A01/A08 | 20 grupos / 1676 aserciones correctas, 19 rutas y 41 handlers |
| A02 | 31 grupos / 701 aserciones correctas |
| A03 unitarias | 9 grupos / 13841 aserciones correctas |
| A03 navegador | 11 grupos / 2411 prefijos y 93 actualizaciones SSE correctas; escritorio y móvil |
| Tipos del chat/reservas y renderizado | Correctos |
| Compilación de producción | Correcta; persiste aviso del adaptador que genera Node 18 |
| Tipos generales de fuentes | Persisten dos usos preexistentes de `chatRef` en Chat/MobileChat |
| Comprobación TypeScript global | Persisten dos errores de sintaxis TypeScript en `tailwind.config.mjs` |

Evidencias: [sesiones en navegador](evidence/A04-sesion-navegador.jpg) y [regresión de renderizado](evidence/A04-regresion-renderizado.jpg).

Ejecutar también `test:dashboard`, `test:chat`, `test:rendering`, `check:chat`, `check:rendering` y la compilación. Si el lanzador npm del equipo falla, los scripts se pueden ejecutar directamente con Node.

Las pruebas locales validan contratos de aplicación, no PostgreSQL/PostgREST desplegado, RLS, permisos públicos, cabeceras servidas realmente por CDN, proxies ni servicios externos. Antes de producción hay que comprobar esas condiciones, incluyendo la relación `messages → conversations` utilizada por el filtro de propiedad. A05 (permisos/RLS) y la integridad completa de reservas siguen pendientes de verificación real. [A09](PRIVACIDAD_Y_DATOS_CHAT.md) añade localmente retención/borrado, CSRF y versión de contexto persistente; la caché v2 incorpora esa versión y la API devuelve sus metadatos. Su migración y operación en plataforma siguen pendientes. A04 no convierte la reserva en una transacción. La confirmación estructurada y el contrato de ejecución se han añadido localmente en [A07](CONTRATO_CHAT_IA.md), reutilizando esta sesión y el aislamiento sin vincular datos antiguos. No se ha desplegado.
