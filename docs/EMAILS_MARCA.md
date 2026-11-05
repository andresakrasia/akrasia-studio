# Correspondencia de AKRASIA STUDIO

La colección conserva la identidad oscura y cyan de la web y aplica un titular y una etiqueta visual distintos a cada etapa. El mensaje se escribe y guarda como texto; el servidor lo escapa y genera el diseño final. Los clientes no pueden enviar HTML propio ni adjuntos.

| Plantilla | Momento |
| --- | --- |
| `evaluation` | Recepción y evaluación del brief |
| `quote` | Presupuesto y alcance |
| `follow_up` | Seguimiento de la propuesta |
| `kickoff` | Preparación del proyecto |
| `progress` | Avances de producción |
| `delivery` | Material para revisión |
| `final_delivery` | Entrega final |
| `closure` | Cierre del proyecto |
| `custom` | Mensaje libre |
| `booking_confirmation` | Confirmación automática de una reserva real |
| `booking_reminder` | Recordatorio automático de la videollamada |

El compositor del admin muestra el mismo HTML que se usa al enviar, en un marco aislado y con vistas de escritorio y móvil. Los textos pendientes se conservan al guardar y bloquean el envío hasta completarlos. La confirmación y los recordatorios se generan desde los datos de la reserva, con hora de Madrid, duración, botón de acceso y enlace de texto de respaldo. Si falta el enlace, el correo indica que el equipo lo facilitará.

El logo de código de `StudioCore` se rasteriza a PNG con `node scripts/generate-email-logo.mjs`. La imagen pública es `/img/email-studio-core.png`; los correos referencian su URL HTTPS, sin incluir un Base64 que desborde el límite de 24 KiB de la cola. El nombre del estudio, el contenido y los datos de reunión siguen siendo texto legible cuando un cliente bloquea las imágenes. Al publicar los cambios hay que incluir este PNG.

El diseño usa tablas, estilos en línea, colores explícitos y fuentes de sistema compatibles. Las consultas de pantalla mejoran la presentación móvil, y el HTML incluye un contenedor de ancho fijo para Outlook clásico. Las web fonts, el SVG, los scripts y las animaciones de la web no son necesarios. El aspecto de las fuentes y los ajustes automáticos de color puede variar por aplicación de correo; no se ha realizado una prueba de entrega real a Gmail u Outlook.

Resend recibe versiones HTML y de texto, con la misma clave de idempotencia para cada reintento. El worker congela el contenido, los adjuntos, el remitente y el buzón de respuesta antes del primer envío; un cambio de plantilla o de configuración mantiene el mismo cuerpo de solicitud al reintentar. Las claves secretas del proveedor no se guardan en esa copia. `EMAIL_FROM` identifica el remitente verificado y `EMAIL_REPLY_TO` permite dirigir las respuestas a un buzón atendido; por defecto se usa el contacto público `info@akrasia.studio`. Una dirección de respuesta inválida desactiva un envío nuevo. Las reservas pueden añadir un calendario `.ics` generado por el servidor con contenido Base64 y tipo `text/calendar`; no se aceptan adjuntos ni remitentes desde solicitudes del navegador. [API oficial de Resend](https://resend.com/docs/api-reference/emails/send-email), [idempotencia de Resend](https://resend.com/docs/dashboard/emails/idempotency-keys).

Validación: `node scripts/test-email-templates.mjs` usa únicamente datos sintéticos y un proveedor simulado. Cubre las once plantillas, escape de contenido, enlaces HTTPS, horas de Madrid y cambios de horario, tamaños de payload, adjuntos, claves de idempotencia, respuesta al buzón del estudio y la vista previa aislada. Genera la galería autocontenida `docs/evidence/email-templates-preview.html`.
