# Límites del chat público (A02)

Corrección local del 2 de octubre de 2026. Sustituye el contador en memoria y el identificador elegido por el cliente por una admisión persistente en Supabase. No aplica SQL ni despliega a servicios reales. Conserva los controles administrativos descritos en `ACCESO_ADMINISTRATIVO.md`.

## Preparación

1. Aplicar `supabase/migration-v10.sql` como propietario de PostgreSQL **antes de habilitar esta versión del chat**. Crea únicamente dos tablas privadas y dos RPC del chat; no modifica las tablas administrativas ni de negocio. La v9 del panel sigue siendo necesaria para el panel.
2. Generar un secreto aleatorio independiente de las credenciales administrativas, por ejemplo con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Guardar el resultado como `CHAT_SESSION_SECRET`, exclusivamente en el servidor y en el gestor de secretos. No guardarlo en Git ni usar el valor de ejemplo.
3. Configurar `CHAT_ORIGIN=https://akrasia.studio`, el origen exacto del navegador sin rutas. Desarrollo: `http://localhost:4321`. Configurar `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `OPENROUTER_API_KEY`. No usar prefijos `PUBLIC_`. `.env.example` contiene las cuotas predeterminadas; `.env` del usuario no se modifica.
4. Todas las instancias y despliegues que compartan el chat deben utilizar la misma base, el mismo secreto y las mismas cuotas. Las versiones antiguas sin estos controles deben dejar de estar accesibles. Durante una rotación, actualizar todas las instancias; el cambio de secreto invalida las cookies antiguas, pero no reinicia las cuotas de IP/global.
5. Comprobar SQL, permisos, RPC y dirección real del cliente en un entorno controlado de la plataforma antes de habilitar IA pública. La migración ausente, credenciales incompletas, respuesta RPC inválida o caída del almacén producen 503 y **ninguna llamada de pago**. No hay alternativa basada en memoria.

## Identidad y proxy

La primera solicitud válida sin cookie recibe un UUID aleatorio firmado con HMAC-SHA256 y caducidad. La cookie es `HttpOnly`, `SameSite=Strict`, ruta `/`, sin dominio; en producción se llama `__Host-akrasia_chat` y lleva `Secure`. En desarrollo es `akrasia_chat`. Caduca en 24 horas por defecto, sin renovación en cada mensaje. Cookies duplicadas, manipuladas, caducadas o firmadas con otro secreto se rechazan con 401 y se borran. El próximo envío del usuario puede crear otra sesión; no se reintenta automáticamente.

`visitor_id` y los campos `visitor_history`, `visitor_name` y `visitor_company` del JSON no otorgan identidad ni se reenvían al modelo. Las escrituras asociadas al chat usan exclusivamente el UUID validado por el servidor. Los roles de red se validan y solo pueden ser `user` o `assistant`; la instrucción de sistema procede del servidor. Se exige JSON, el origen configurado y ausencia de `Sec-Fetch-Site: cross-site`.

En el runtime real de Vercel (`process.env.VERCEL === '1'`) solo se utiliza `x-vercel-forwarded-for`, una cabecera de la plataforma. No se confía en `Forwarded`, `X-Forwarded-For`, `X-Real-IP`, cabeceras de otros CDN ni cadenas seleccionadas por el cliente. Fuera de Vercel, producción utiliza un único grupo `unknown`; desarrollo usa la dirección de conexión de Astro. Una dirección ausente o inválida también comparte ese grupo, conservando las cuotas. IPv4 y sus formas IPv6 mapeadas se normalizan; IPv6 se agrupa por /64 para limitar rotación de direcciones. Los contadores guardan hashes de sesión/dirección, nunca IP en claro ni cookies.

Un proxy adicional puede agrupar a todos sus usuarios bajo una IP. No configurar cabeceras arbitrarias como alternativa: verificar la integración de proxy confiable de la plataforma. La cuota global se mantiene aunque cambie la IP. [Referencia de cabeceras de Vercel](https://vercel.com/docs/headers/request-headers).

La corrección A04 completa esta identidad: el historial remoto y las reservas comprueban la misma cookie, y el contexto del modelo se obtiene de datos propios en servidor. Sin cookie, el historial emite una nueva sesión y devuelve datos vacíos sin consultar la base. UUID ajenos por query/JSON se rechazan; los identificadores y el historial local antiguos se retiran del navegador sin vincular ni borrar datos de servidor. La recuperación dura mientras la cookie sea válida. El cliente renueva la sesión después de 401, sin repetir un POST. Ver `AISLAMIENTO_VISITANTES.md` para el contrato y el ciclo de vida.

## Cuotas configurables

Todos los números se expresan como enteros decimales positivos. Valores vacíos usan el predeterminado; valores inválidos cierran el chat con 503. Las variables son privadas del servidor.

| Variable | Predeterminado | Significado y rango permitido |
| --- | ---: | --- |
| `CHAT_SESSION_SECRET` | Obligatorio | Secreto aleatorio de 64–128 caracteres hexadecimales. |
| `CHAT_ORIGIN` | Obligatorio | Origen HTTPS exacto; HTTP solo localhost en desarrollo. |
| `CHAT_SESSION_SECONDS` | 86400 | Vida de cookie: 60–2592000 segundos. |
| `CHAT_SESSION_REQUESTS` | 20 | Admisiones por sesión/ventana: 1–1000000. |
| `CHAT_IP_REQUESTS` | 20 | Admisiones agregadas por IP/ventana: 1–1000000. |
| `CHAT_WINDOW_SECONDS` | 3600 | Ventana común de sesión/IP: 1–86400 segundos. |
| `CHAT_GLOBAL_REQUESTS` | 200 | Admisiones del chat completo/ventana global: 1–10000000. |
| `CHAT_GLOBAL_UNITS` | 1000000 | Unidades reservadas del chat completo/ventana global: 1–1000000000000. |
| `CHAT_GLOBAL_WINDOW_SECONDS` | 86400 | Ventana global: 1–604800 segundos. |
| `CHAT_SESSION_CONCURRENCY` | 1 | Llamadas/trabajos concurrentes por sesión: 1–100. |
| `CHAT_IP_CONCURRENCY` | 2 | Llamadas/trabajos concurrentes por IP: 1–1000. |
| `CHAT_GLOBAL_CONCURRENCY` | 4 | Llamadas/trabajos concurrentes del chat: 1–10000. |
| `CHAT_PROVIDER_TIMEOUT_MS` | 25000 | Duración máxima conjunta desde lectura/admisión hasta streaming y efectos: 100–60000 ms. |
| `CHAT_STORE_TIMEOUT_MS` | 5000 | Tiempo máximo por RPC; también del historial remoto: 100–10000 ms. |
| `CHAT_LEASE_SECONDS` | 60 | Vida de plaza en la base: 5–3600 segundos. Debe cubrir timeout total + timeout de RPC + 10 segundos de margen. |
| `CHAT_MAX_BODY_BYTES` | 32768 | Cuerpo JSON máximo medido al leer el stream: 1–131072 bytes. |
| `CHAT_MAX_MESSAGES` | 20 | Número máximo de mensajes: 1–50. |
| `CHAT_MAX_MESSAGE_CHARS` | 2000 | Longitud máxima por mensaje, unidades UTF-16 de JavaScript: 1–8000. |
| `CHAT_MAX_HISTORY_BYTES` | 8192 | Límite UTF-8 del JSON de mensajes y del historial propio recuperado en servidor: 1–32768 bytes. |
| `CHAT_MAX_INPUT_UNITS` | 24000 | Entrada completa con prompt y margen de formato: 1–65536 unidades. |
| `CHAT_MAX_OUTPUT_TOKENS` | 500 | `max_tokens` enviado al proveedor: 1–1000. |

Las ventanas son fijas y se calculan con el reloj de PostgreSQL desde epoch UTC: por defecto sesión/IP reinician al cambiar la hora UTC y el global a medianoche UTC. Cerca de un borde se pueden utilizar dos cuotas en un intervalo corto; no son ventanas deslizantes. Cada contador vivo conserva su caducidad al cambiar configuración. Eliminar cookies, cambiar `visitor_id`, crear sesiones nuevas o reiniciar instancias no reinicia las cuotas de IP/global. Los visitantes que comparten IP comparten cuota. Una rotación de IP sigue limitada por la cuota global.

`chat_admit` adquiere un bloqueo transaccional común, limpia filas caducadas y comprueba las tres cuotas y las tres concurrencias antes de incrementar los contadores e insertar la plaza. No hay lecturas y escrituras separadas que admitan de más entre instancias. Un rechazo no reserva nueva cuota ni inicia efectos. Devuelve 429 con `Retry-After` y un código que distingue cuota agotada (`chat_rate_limited`) de concurrencia (`chat_busy`).

Una admisión reserva siempre toda la entrada y la salida máxima, incluso si luego falla el proveedor o el cliente cancela. No se devuelven contadores. Solo los trabajos completados liberan explícitamente su plaza; una cancelación, error, respuesta ambigua o fallo de liberación conserva la plaza hasta caducar, limitando reintentos rápidos. La expiración recupera ejecuciones interrumpidas, sin depender de temporizadores de limpieza en un proceso serverless.

## Tokens, unidades y dinero

La entrada se reserva de forma conservadora antes de consultar datos personales: un punto por byte UTF-8 del prompt, fecha del servidor y mensaje nuevo, 2200 unidades para el perfil serializado, 16 por mensaje y 256 de margen. A07 incluye también el esquema de herramienta y 256 unidades de margen adicional. Se reserva el historial máximo hasta `CHAT_MAX_HISTORY_BYTES` que quepa en `CHAT_MAX_INPUT_UNITS`, seleccionando después un sufijo de mensajes completos dentro de esa capacidad. Se comprueba que la entrada efectiva no supere la reserva ni ese límite. Para el contador global se añade `CHAT_MAX_OUTPUT_TOKENS`. Es una aproximación conservadora de texto y formato, no el conteo real del tokenizer. Si el prompt crece se reduce la capacidad de historial; no se aumentan las cuotas. Contrato y pruebas: [A07](CONTRATO_CHAT_IA.md).

Las cuotas de solicitudes/unidades reducen y acotan el tráfico autorizado; **no representan un presupuesto en euros o dólares**. El coste real depende de tokens facturados, tarifas, caché, condiciones y comportamiento del proveedor. La cuota solo cubre `/api/chat`; otros usos de la misma clave, como generación administrativa, requieren controles de cuenta propios. Para un techo monetario configurar además el límite de crédito de una clave dedicada en OpenRouter y revisar su consumo. [Crédito y límites de OpenRouter](https://openrouter.ai/docs/api_reference/limits).

El SDK usa `maxRetries: 0` tanto al construir el cliente como al enviar la petición. OpenRouter recibe `provider.allow_fallbacks: false` y `reasoning.enabled: false`, con modelo fijo `~deepseek/deepseek-v4-flash-latest`. No hay reintento automático del navegador. Esto evita que una admisión se multiplique por los reintentos habituales del SDK o por fallbacks solicitados a OpenRouter. Los tokens de razonamiento pueden ser facturados, por eso se solicita desactivarlos explícitamente. [Razonamiento de OpenRouter](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

El deadline y la señal de desconexión abortan la solicitud y el cuerpo del stream del proveedor. Abortar una conexión no garantiza que el proveedor deje de facturar trabajo ya iniciado; conservar la reserva y configurar su límite monetario siguen siendo necesarios. La plaza debe durar más que la ejecución local, y el timeout máximo real de Vercel debe permitir completar el trabajo y responder antes de terminar la función. El adaptador actual sigue generando Node 18; su actualización es un pendiente previo, fuera de A02.

## Streaming y efectos asociados

El proveedor entrega texto progresivamente. Se exige una razón terminal de fin `stop` o `length` para texto; un EOF con texto parcial no se presenta como completado. A07 exige terminal `tool_calls` y stream completo para una propuesta estructurada, nunca ejecuta etiquetas del texto ni una reserva sin confirmación explícita. Solo tras finalizar correctamente se guardan visita, mensajes y lead y se realizan las notificaciones de contacto existentes. La confirmación de reserva es una petición admitida sin IA y con resultado de servidor; no ejecuta efectos generales de lead/historial. Todas estas operaciones reciben una señal de cancelación y se esperan antes de enviar `[DONE]`; no se dejan promesas desacopladas tras cerrar la respuesta. Un mensaje rechazado no escribe visita, conversación, lead o reserva ni envía notificaciones.

El cliente conserva eventos SSE partidos entre bloques de red y exige `[DONE]`. Ante fallo descarta la respuesta parcial del historial, presenta códigos públicos en español/inglés y muestra la espera indicada por el servidor. Envía únicamente el mensaje nuevo y verifica antes su sesión; el contexto histórico procede del servidor. El historial de presentación del navegador está vinculado a identidad y caducidad verificadas. La espera local ayuda a la interfaz, pero el servidor sigue siendo la autoridad. Los límites del cliente son los valores predeterminados; si se bajan en servidor se puede recibir 413 hasta adaptar el cliente. Su deadline es 120 segundos.

Las respuestas del chat y el historial llevan `no-store` para navegador y CDN. No se muestran mensajes internos del proveedor, cuerpos de errores ni credenciales; el logging del SDK está desactivado. Los datos y roles siguen siendo texto no confiable: sanear Markdown, validar reservas y completar los otros hallazgos de la auditoría continúa siendo necesario. No se ha convertido el flujo de reservas en una transacción ni añadido email de confirmación.

## Pruebas y validación

Ejecutar `npm run test:chat`. Usa dos instancias de módulos de aplicación, un almacén/RPC simulado compartido, reloj controlado, proveedor simulado y efectos sintéticos. No carga `.env`, bloquea conexiones externas y no consume IA, envía emails/Telegram, crea reservas reales ni escribe en Supabase publicado. Las pruebas ejercitan también el adaptador real del SDK con respuestas interceptadas y las funciones de efectos con datos ficticios.

Ejecutar `npm run test:dashboard` para la regresión de A01/A08 y `npm run check:chat` para los tipos de todo el flujo modificado y sus dependencias. `npm run check:types` revisa las fuentes TypeScript/TSX del proyecto; la comprobación global habitual también incluye `tailwind.config.mjs` y sigue fallando por su sintaxis TypeScript preexistente. No se modifican esos archivos ajenos al alcance para ocultar el diagnóstico.

La compilación se verifica con `npm run build`, desactivando telemetría y credenciales de integraciones únicamente en el proceso de comprobación. La carpeta de salida es local y no se despliega.

Validación local realizada el 2 de octubre de 2026:

- Chat: 31 grupos y 633 aserciones correctas. La reproducción de 25 solicitudes sin identificador y descartando cada cookie acepta 20 y bloquea 5 con 429; solo las 20 admitidas llegan al proveedor y a los efectos simulados. Incluye cookies manipuladas/duplicadas/caducadas, sesiones nuevas, varias instancias, solicitudes simultáneas, ventanas y caducidad de plazas, cuota global de solicitudes/unidades, payloads inválidos/excesivos, errores/timeout del almacén, cancelación/apertura/streaming del proveedor, EOF incompleto, efectos reales interceptados y fragmentación SSE por cada byte.
- Regresión administrativa: 20 grupos y 1676 aserciones correctas con las 19 rutas y 41 handlers existentes, incluidas autorización, CSRF, cierre, caducidad, revocación, cuotas y fallos de base. No se alteran los controles de A01/A08.
- `check:chat` pasa. `check:types` detecta solo los dos errores preexistentes de `chatRef` en `src/components/Chat.tsx` y `MobileChat.tsx`. Las dos llamadas antiguas con `projectType` incompatible se corrigen al conservarlas en `chat-effects.ts` como `project_type`. La comprobación global sigue detectando las dos construcciones TypeScript inválidas de `tailwind.config.mjs`.
- Build de producción correcto. Persisten avisos previos de Browserslist y del adaptador Vercel sobre destino Node 18. No se despliega esa salida ni se valida Node 18 en el servicio real.
- No se han cargado secretos en las pruebas ni producido conexiones externas, IA de pago, emails, Telegram, reservas o escrituras remotas. No hay PostgreSQL local operativo para ejecutar SQL/RLS; la validación de esa migración sigue pendiente.

### Pendientes antes de habilitar IA pública

- Ejecutar y validar `migration-v10.sql` sobre PostgreSQL real en un entorno controlado: concurrencia transaccional de las RPC, permisos del propietario de las funciones y RLS/denegación de tablas/RPC para `anon` y `authenticated`. El doble local acredita el contrato de la aplicación, no la ejecución SQL o RLS real.
- Comprobar detrás de Vercel el origen, las cookies, `no-store`, el runtime, el timeout de función y la sobrescritura de `x-vercel-forwarded-for` ante intentos de suplantación y proxy adicional.
- Configurar y verificar el crédito de la clave dedicada y observar unidades/tokens facturados. Mantener los mismos límites en todas las instancias y retirar las rutas/versiones anteriores.
- Continúan los hallazgos fuera de A02: saneamiento de HTML, integridad/disponibilidad/confirmación de reservas, retención de datos y permisos de otras tablas/API, además de los errores de tipos preexistentes.

Los cambios no despliegan ni aplican migraciones, y no prueban servicios reales. Los límites SQL, las cabeceras y el presupuesto de cuenta necesitan esa validación posterior.
