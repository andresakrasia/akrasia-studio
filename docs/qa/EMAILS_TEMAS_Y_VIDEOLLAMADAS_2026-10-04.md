# Emails, apariencia del admin y videollamadas

Implementación y revisión repartidas entre tres agentes: correspondencia, temas del admin e integración de agenda. El calendario es propio; Jitsi Meet aporta las salas de videollamada.

## Resultado

- Once plantillas con identidad de AKRASIA: nueve etapas de comunicación del proyecto, confirmación de reserva y recordatorio. El logo existente de código se exporta como PNG compatible con correo. Vista previa aislada en escritorio y móvil, con logo local visible incluso antes de publicar.
- Selector Noche/Día persistente en el admin, con inicialización antes de pintar la página. El modo claro mantiene los textos y estados legibles y no reinicia los formularios al cambiar de tema.
- Guía dentro del chat: fecha, horarios disponibles y datos de contacto. La propuesta se revisa antes de confirmar; la confirmación crea la reserva y devuelve una sala Jitsi única. Chat, admin, invitación de calendario y correos conservan el mismo enlace.
- Confirmación y recordatorios de 24 horas y 1 hora, con archivo de calendario de 30 minutos. La agenda maneja hora de Madrid y cambios de horario. Los reintentos conservan contenido, adjunto, remitente y buzón de respuesta; la cancelación detiene avisos que aún no se han enviado.

## Verificación

| Comprobación | Resultado |
| --- | --- |
| Plantillas y contrato de Resend con proveedor simulado | 9 grupos / 231 comprobaciones |
| Guía de reserva y confirmación firmada | 41 comprobaciones |
| Jitsi, calendario protegido, adjuntos y reintentos | 5 grupos / 103 comprobaciones |
| Agenda e integraciones | 7 grupos / 1533 comprobaciones |
| Programación del worker con HTTP simulado | 33 comprobaciones |
| Regresión en navegador del chat real | 14 grupos / 146 comprobaciones |
| Autorización del admin, incluido calendario | 20 grupos / 1884 comprobaciones |
| Tema y contraste de textos claros | Aprobado |
| TypeScript del código | Sin errores |
| Diagnóstico Astro | 146 archivos, cero errores/advertencias |
| Construcción Vercel | Aprobada: Node 24, streaming y límite de 60 segundos |
| PostgreSQL real local y desechable | 55 archivos SQL; 22 migraciones y reproducción del manifest aprobados |

La revisión visual confirmó el logo del compositor móvil (600 px de origen), ausencia de desbordamiento horizontal, persistencia del modo día tras recarga y una reserva de demostración visible en la semana correspondiente del admin. El navegador verificó que cambiar de identidad o borrar el contexto limpia los campos de la guía y bloquea solicitudes pendientes con contacto anterior; también preserva el idioma de una propuesta durante la verificación de sesión.

Evidencia: [colección de plantillas](../evidence/email-templates-preview.html), [admin en modo día](../evidence/admin-day-meetings.png), [email de reserva](../evidence/email-booking-confirmation.png), [regresión del navegador](../evidence/meeting-guide-browser.json) y [PostgreSQL](../evidence/postgres-local.json).

## Activación en producción

Aplicar la migración v22 después de v21 y publicar los cambios con el PNG del logo. Configurar Resend, remitente verificado y buzón de respuesta; habilitar el envío programado con la URL desplegada y el secreto del worker. El workflow preparado consulta la cola cada cinco minutos y puede sufrir retrasos del scheduler.

El anfitrión debe autenticarse y abrir la sala del servicio público Jitsi; quien llegue antes espera al moderador. [Guía oficial de Jitsi](https://jitsi.github.io/handbook/docs/user-guide/user-guide-start-a-jitsi-meeting/).

Estas comprobaciones no enviaron correos, no abrieron videollamadas externas y no modificaron producción. Queda la prueba real de entrega con Resend y de cámara/micrófono tras activar el entorno. El diseño puede variar ligeramente entre aplicaciones de correo. Detalles de configuración en [correspondencia](../EMAILS_MARCA.md) y [reservas e integraciones](../RESERVAS_E_INTEGRACIONES.md).
