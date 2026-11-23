# Operación y lanzamiento verificable (A41)

El [estado central de producción](ESTADO_PRODUCCION.md) reúne las correcciones A01–A41 y distingue su evidencia local de la activación pendiente en las cuentas reales.

## Comprobación incorporada

`src/lib/production-config.ts` valida la configuración sin hacer peticiones. Reutiliza los contratos del chat y de conservación; exige Node 24, orígenes coherentes, hash administrativo válido, límites numéricos y secretos independientes. Si se configura email o Telegram, exige también el worker privado. Una integración opcional sin credenciales aparece como `disabled`; no se presenta como operativa.

`GET /api/health` exige la sesión administrativa revocable de A01. No acepta secretos en URL, parámetros ni solicitudes desde otro origen. Su respuesta tiene `no-store` para navegador y CDN, además de las cabeceras administrativas. Solo devuelve estados y códigos controlados: nunca credenciales, direcciones de servidores, remitentes, destinatarios, datos de clientes o conversaciones. El acceso a la sesión conserva el plazo máximo existente de cinco segundos.

El resultado `configuration_valid` significa que los valores tienen un contrato válido. `scope: configuration_only` y `externalChecks: not_run` indican expresamente que no acredita conexión real, SQL/RLS, Storage, TLS, entrega de email, disponibilidad de IA, trabajos programados o backups. Una configuración inválida devuelve 503; una sesión ausente o revocada, 401. La web pública mantiene sus destinos y contacto aunque falten integraciones opcionales.

La función `requireProductionComponent` permite aplicar la misma comprobación en una frontera de funcionalidad. Los handlers existentes mantienen sus validadores y respuestas cerradas ante fallos; el inspector no inicia servicios ni sustituye esos controles. No hay un servidor adicional ni un sondeo que consuma proveedores al arrancar.

## Variables y estados

| Componente | Variables / condición | Comprobación local | Pendiente en plataforma |
| --- | --- | --- | --- |
| Runtime | Node 24 | Versión principal soportada; pins y adaptador gestionados por A37 | Confirmar runtime efectivo de cada función y entorno |
| Base de datos | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Origen HTTPS y credencial privada sin placeholder | SQL/RLS aplicado, permisos de roles y acceso real mínimo |
| Administración | `DASHBOARD_ORIGIN`, `DASHBOARD_PASSWORD_HASH`, `SITE_URL` | Origen de sitio coherente y hash scrypt de A01 | Cookies, proxies, cabeceras y logout en la URL desplegada |
| Sesión y agenda | `CHAT_ORIGIN`, `CHAT_SESSION_SECRET`, límites A02 | Origen exacto, secreto independiente, límites válidos | IP fiable, admisión atómica, concurrencia y runtime reales |
| IA | `OPENROUTER_API_KEY`, límites A02 | Se habilita solo si hay credencial válida | Presupuesto monetario, modelo, errores/stream y gasto real |
| Videollamada | `JITSI_MEET_BASE_URL` opcional; `BOOKING_MEETING_URL` sobrescribe | Jitsi por defecto `https://meet.jit.si/`, sala única por cita; sólo HTTPS válido | Anfitrión autenticado en Jitsi; comprobar cámara/micrófono |
| Email | `RESEND_API_KEY`, `EMAIL_FROM` | Remitente explícito válido y sin inyección de cabeceras | Dominio remitente, DNS y entrega a buzones de prueba autorizados |
| Telegram | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Ambos campos y formato válidos | Acceso del bot y destinatario autorizado |
| Worker | `INTEGRATION_WORKER_SECRET`, `INTEGRATION_WORKER_BATCH` | Secreto independiente de 64 caracteres hexadecimales; lote 1–10 | Programación, duración, permisos y revisión de estados inciertos |
| Conservación | `RETENTION_CRON_SECRET`, límites A09 | Secreto independiente de 64–128 caracteres hexadecimales y plazos válidos | Programación y evidencia de mantenimiento: mensajes 30 días, perfiles 90, registros de email 90 |
| Analítica | `PUBLIC_GA4_REVIEWED`, `PUBLIC_GA4_MEASUREMENT_ID`; alternativa GTM | La revisión explícita requiere ID válido; GA4 directo tiene prioridad | Revisar flujo o contenedor, desactivar medición automática y comprobar consentimiento y red real antes de activar |

La preparación de páginas indexables, Search Console y los eventos del chat se detalla en [SEO y analítica](SEO_Y_ANALITICA.md). Search Console admite verificación DNS de dominio o la etiqueta pública opcional `PUBLIC_GOOGLE_SITE_VERIFICATION` para prefijo de URL. Las cuentas, la publicación y la indexación efectivas siguen pendientes de activación.

Un valor de sintaxis correcta puede ser una credencial revocada, un dominio sin verificar o una sala inexistente. Ninguno de esos estados se da por comprobado. No compartir secretos entre base de datos, sesión, mantenimiento y worker.

## Consulta y seguimiento

Después de iniciar sesión en el panel, una consulta al mismo origen con la cookie administrativa permite revisar los estados. Por ejemplo, desde las herramientas del navegador de esa sesión:

```js
const respuesta = await fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' });
console.log(respuesta.status, await respuesta.json());
```

No copiar cookies, tokens ni claves a URLs, tickets, capturas o repositorios. Una consulta anónima debe devolver 401, sin revelar qué integración falta.

El endpoint registra solo uno de tres eventos controlados, estado HTTP y duración: `authenticated_health_check`, `configuration_invalid`, `health_auth_unavailable`. No vuelca request, cabeceras, payload, URL ni excepción. Consultar los [logs de ejecución de Vercel](https://vercel.com/docs/logs/runtime) y restringir su acceso y conservación. El repositorio no crea cuentas de monitorización, alertas ni destinatarios de aviso.

Antes del lanzamiento, acordar quién revisa estos errores, la cola `failed`/`uncertain`/`disabled`, fallos de captación y consumo de IA. Activar alertas cuando se defina el canal autorizado y su umbral; no usar el texto completo del chat ni contactos personales como contexto del error. Un registro `queued` acredita aceptación en cola, y `accepted` aceptación del proveedor; la entrega efectiva necesita la evidencia o webhooks firmados correspondientes. Véase [Reservas e integraciones](RESERVAS_E_INTEGRACIONES.md).

## Mantenimiento integrado v18

Aplicar [migration-v18.sql](../supabase/migration-v18.sql) después de v17 mediante el plan revisado de [Migraciones y reproducción](MIGRACIONES_Y_REPRODUCCION.md). La migración crea el contrato; no ejecuta limpiezas ni programa trabajos. El POST privado `/api/maintenance/retention`, con su secreto independiente, utiliza `production_retention_batch`: conserva las protecciones de contexto y admisión de A09 y añade limpieza acotada de cola y recibos. Si existe trabajo activo del chat, el lote puede devolver `deferred` y debe revisarse/repetirse sin afirmar mantenimiento completo.

| Datos | Plazo / comportamiento |
| --- | --- |
| Mensajes y propuestas en mensajes | 30 días; el borrado del chat conserva la protección de generación A09 |
| Perfil derivado | 90 días; no confundirlo con reservas o contactos de otro canal |
| Registros locales de email y outbox | 90 días; incluye cola antigua pendiente. Una entrega `sending` con concesión vigente se aplaza hasta que termine su protección |
| Recibos de chat | Identificadores, generación y HMAC; sin copia del texto/contacto. Los completos desaparecen con sus mensajes y los restantes se limpian al caducar la sesión |
| Recibos IA administrativos | IDs de entidades y metadatos de operación; sin copia del texto generado. Elegibles para limpieza a los 30 días; replay resuelve filas vigentes y no recupera texto borrado |
| Reservas | Política independiente; no se borran por eliminar chat y no reciben automáticamente el plazo de 30/90 días |

Los lotes pueden dejar más filas pendientes y respetan las concesiones activas; acordar frecuencia y supervisión de resultados antes de activarlos. El worker `/api/integrations/process` procesa entregas y también puede limpiar outbox, pero el mantenimiento independiente cubre una cola detenida. No se ha programado ninguno de estos trabajos en una plataforma real.

PostgreSQL 18.4 local y desechable ha aplicado/reaplicado v18 y superado sus pruebas de retención. [Evidencia SQL local](evidence/postgres-local.json). Storage en ese entorno contiene solo metadatos simulados; sigue pendiente aplicar y comprobar los permisos, jobs y servicios del destino real.

## DNS, TLS y remitente

En staging y después en producción, contrastar los registros de dominio con los valores que muestre la plataforma, verificar HTTPS y redirección al origen canónico, y comprobar que `SITE_URL`, `CHAT_ORIGIN` y `DASHBOARD_ORIGIN` coincidan. Revisar ambas variantes del dominio si se usan y comprobar certificado, caducidad y nombres cubiertos. Seguir la [guía de dominios de Vercel](https://vercel.com/docs/domains/working-with-domains); no se han inspeccionado ni cambiado registros reales en esta corrección.

Para email, verificar la propiedad del dominio remitente y publicar exactamente los registros que entregue la cuenta de Resend. El remitente debe pertenecer a ese dominio y estar configurado expresamente. [Resend describe su verificación de dominios](https://resend.com/docs/dashboard/domains/introduction).

Validar SPF y DKIM antes de introducir una política DMARC restrictiva. Revisar todas las fuentes legítimas de correo y comenzar con observación cuando proceda, confirmando los resultados de autenticación en las cabeceras de mensajes de prueba. La dirección para recibir informes y la política final deben acordarse con el titular; no se inventan ni se activan en el repositorio. [Procedimiento de DMARC de Resend](https://resend.com/docs/dashboard/domains/dmarc).

## Presupuesto, regiones y recuperación

A02 limita solicitudes, unidades y concurrencia, pero no define un techo monetario en la cuenta del proveedor. Configurar un límite de crédito de la clave, revisar sus saldos y consumo y establecer avisos antes de agotarlo. No asumir que un límite de tráfico protege de cambios de precio o del coste de otras claves. [OpenRouter documenta los límites y la consulta de créditos por clave](https://openrouter.ai/docs/api/reference/limits). Las pruebas locales no consultaron una clave real ni gastaron crédito.

Revisar regiones efectivas de base de datos, Storage, funciones, email e IA y los contratos/transferencias tratados en A09. Registrar propietario operativo, accesos mínimos, procedimiento de rotación y recuperación. No añadir un secreto alternativo que eluda la revocación para facilitar un rollback.

Mantener una copia protegida y comprobar la restauración en un entorno separado. Los backups de base de datos de Supabase no incluyen los archivos de Storage: hay que respaldar y recuperar también esos objetos, verificar sus referencias y conservar su carácter privado. La disponibilidad de backups depende del plan; revisar recuperación, retención y una interrupción prevista antes de restaurar. [Alcance de los backups de Supabase](https://supabase.com/docs/guides/platform/backups).

La evidencia de restauración debe comprobar proyectos aprobados/retirados, permisos privados, reservas y cola, además de los datos recuperados. Acordar RPO/RTO reales y el procedimiento para una entrega externa incierta; no reenviar automáticamente una notificación que pueda haberse recibido. Se conservan las guías de aplicación y reaplicación de migraciones. No se ha hecho un backup ni restaurado datos de una cuenta real en este trabajo.

## Activación y verificación

1. Completar la aplicación/reaplicación de migraciones y controles de permisos en staging con datos ficticios; contrastar después el estado efectivo de la plataforma.
2. Configurar los secretos y orígenes en cada entorno, revisar health autenticado y comprobar cookies, proxies, cabeceras y runtime efectivos. Una web pública sin IA debe seguir permitiendo contactar.
3. Verificar el dominio remitente, destino Telegram y sala real antes de realizar una prueba de integración expresamente autorizada. No se acreditan con una configuración válida.
4. Programar por plataforma el POST privado `/api/integrations/process` y el POST `/api/maintenance/retention` con v18 y sus secretos independientes. El repositorio no ha creado trabajos remotos; confirmar frecuencia, duración máxima, permisos, errores, lotes aplazados y reintentos según las guías.
5. Activar observación de colas, errores y presupuesto; ensayar retirada de publicación, revocación de sesión y recuperación con datos ficticios.
6. Registrar la versión desplegada, evidencia y responsables. Las verificaciones locales no sustituyen la aceptación jurídica, editorial, de accesibilidad y operativa que queda indicada en las respectivas guías.

## Evidencia local

```text
node scripts/test-production-config.mjs
node node_modules/typescript/bin/tsc --noEmit --project scripts/tsconfig-src.json
```

El test ejecuta seis grupos y 120 comprobaciones: configuración válida/ inválida, servicios opcionales, límites, independencia de secretos, remitentes, autenticación real del handler mediante un almacén ficticio, revocación, rechazo de peticiones ampliadas, cabeceras y logs sin datos ajenos al contrato. La red se restringe al fixture local; no se leen claves de una cuenta ni se consulta IA, email, Telegram o Storage reales.

La compilación y el resto de regresiones se registran en la integración conjunta. A41 queda implementado para validación local de configuración y seguimiento mínimo. DNS/TLS, recepción real, programación, alertas operativas, regiones y restauración continúan pendientes de validación en las cuentas autorizadas; no se ha desplegado ni modificado infraestructura remota.
