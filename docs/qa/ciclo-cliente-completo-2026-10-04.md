# Recorrido completo del cliente · 4 de octubre de 2026

El ensayo manual termina con **Cacao Aurora cerrado, 20 tareas terminadas y 7 correos guardados en cola**. Se recorrieron las pantallas como cliente y como equipo de Akrasia, se corrigieron los fallos encontrados y se repitieron los pasos afectados. La ficha conserva los nueve hitos, el presupuesto y una ronda de cambios del cliente. [Resultado de los datos del ensayo](../evidence/ciclo-cliente-local.json).

## Alcance y cliente de prueba

Lucía Torres, de la marca ficticia Cacao Aurora, solicita una animación 3D de 30 segundos para Instagram, vertical 9:16, con chocolate y naranja, estética premium, música original y subtítulos, sin voz en off. Propone 1800 EUR y tres semanas. El chat presenta esos datos como deseos del cliente; el equipo confirma después el alcance, condiciones y calendario en la ficha.

La prueba usa `http://127.0.0.1:4323`, almacenamiento sintético aislado, correos `.example.invalid` y enlaces `example.invalid`. DeepSeek responde realmente en el chat y Gemini genera realmente un correo y planes de tareas mediante OpenRouter. Resend y Telegram permanecen sin credenciales: no hay mensajes externos, cobros, contratos, películas producidas ni entregas comerciales. Las reuniones, aceptación, producción, revisión y recepción se simulan y sus notas lo indican.

Se reinició la vista de ensayo para incorporar las reservas y operaciones IA que faltaban en su almacén simulado. La reserva se repitió en una sesión nueva del mismo personaje ficticio; la ficha principal conserva su conversación inicial de seis mensajes. La reserva queda vinculada a su visitante, conforme al contrato de reservas, y su comprobación se anota en el historial del proyecto. Los tres perfiles del ensayo incluyen el primer intento de conectividad y la repetición de la reserva; no representan tres clientes comerciales.

## Fases verificadas en el navegador

| Paso | Acción y resultado observado |
| --- | --- |
| Entrada y orientación | Iniciar proyecto pide pieza, público, plazo y presupuesto. La respuesta real de DeepSeek recoge el encargo y pide aclaraciones sin inventar precio, disponibilidad ni aceptación. |
| Reserva | Propuesta con día, hora, nombre y email; confirmar guarda una sola reserva. La agenda del admin muestra el 5 de octubre a las 10:00, Madrid. Completar la reunión de ensayo conserva su estado visible. |
| Visitantes y conversaciones | El admin carga los perfiles, conserva los mensajes y muestra el encargo y la aclaración de estilo. Sin los errores de carga iniciales. |
| Lead | Nombre, marca y contacto captados. Cambiar a Cualificado se guarda. Ficha y seguimiento abre el contexto de su conversación. |
| Propuesta recibida | Crear cliente y proyecto genera la ficha privada vinculada al lead. Título y necesidades se rellenan desde la conversación. Primer email mejorado con IA, guardado y puesto en cola. |
| Evaluación | El equipo registra la revisión de alcance y viabilidad. El siguiente paso explica cómo preparar el presupuesto. |
| Preparación del presupuesto | Se guardan 1800 EUR, entregables, dos rondas de revisión y plazo condicionado a aprobación y materiales. El correo incorpora esos acuerdos y exige revisión antes de envío. |
| Presupuesto enviado | Se comprueba que falta una nota para marcar el envío; un correo en cola no basta. Se registra expresamente el envío simulado. |
| Presupuesto aceptado | Aceptación ficticia con alcance y condiciones. Arranque bloqueado sin tareas. Contacto editado y persistido; los correos posteriores utilizan el email actual del cliente. |
| Producción | Abrir proyecto y tareas lleva al proyecto correcto. IA propone tareas con el alcance guardado. Se prueban Por hacer, Haciendo y Finalizado, conteos y porcentajes. Correo de avances con hechos y próximos pasos concretos. |
| Revisión | Correo de revisión con material de ejemplo. Se deja una exportación pendiente: Entregado queda bloqueado incluso con nota. Se prueba volver a producción con motivo, añadir una tarea manual de contraste de subtítulos y retornar a revisión tras el ajuste. |
| Entrega | Con 20 tareas terminadas se registra la aprobación y entrega simuladas. Correo final distinto del correo para revisión. El proyecto pasa a Entregado, con portfolio aún privado. |
| Cierre | Se registra recepción y conformidad ficticias, ausencia de pendientes y cierre. Se guarda el agradecimiento. Las dos secciones muestran Cerrado y se conserva una nota local al cambiar la etapa desde otra sección. |

También se abrieron Overview, Feed & Logs, Studio y Contenido. El proyecto del cliente sigue sin publicar en el editor y no aparece en la API pública del portfolio. La actividad interna, la publicación editorial y las fichas de servicios siguen sus flujos propios; no se publicaron novedades ni casos de estudio del ensayo.

## Problemas corregidos durante el recorrido

- Las acciones recomendadas y los correos ahora corresponden a cada etapa: evaluación, presupuesto, seguimiento, arranque, avances, revisión, entrega final y cierre. Los textos son editables y los marcadores pendientes impiden el envío.
- Seguimiento es la fuente del estado y del cliente vinculado del proyecto. Proyectos muestra esa relación y permite abrir la ficha; no puede contradecirla mediante otra selección.
- Se avanza una fase cada vez. Envío, aceptación, retroceso, entrega y cierre necesitan constancia del hecho o motivo; producción necesita tareas; entrega y cierre necesitan todas las tareas terminadas. Las garantías también están en SQL, con bloqueo de la carrera entre una tarea pendiente y una entrega.
- El contacto puede editarse y prevalece sobre los datos históricos del lead. Los campos del proyecto tienen etiquetas accesibles y ejemplos en español. Las reservas muestran su estado por escrito, incluidas las canceladas.
- La IA obtiene desde el servidor proyecto, brief, alcance, presupuesto, plazo, etapa y tareas existentes; valida la respuesta completa antes de guardar y descarta duplicados. El primer plan real era demasiado comercial para una propuesta aceptada. La guía por fase corregida generó nueve tareas pertinentes: storyboard, modelado, animación, render, música, subtítulos, montaje, revisión y exportación. Se conservaron las diez tareas iniciales como preparación comprobada en el ensayo y se añadió una tarea de revisión: total final, veinte.
- Los paneles abiertos sincronizan etapa, presupuesto e historial entre secciones. La mezcla de campos conserva las ediciones locales y avisa si hay un cambio que revisar. Se probó con una nota sin guardar y el cierre desde otra sección.
- Las tareas de una página de proyectos cargan con un máximo de seis consultas simultáneas. Abrir un proyecto o cliente fuera de la página conserva y refresca el registro correcto.
- El almacén de la vista de pruebas modela reservas, métricas y operaciones IA compartidas. Se eliminaron los ceros fijos de Overview y las rutas simuladas ausentes que impedían verificar esos pasos. Esas correcciones son del ensayo; las garantías de producción se comprueban aparte.

## Datos conservados y verificación automática

El admin original de `localhost:4322` conserva sus visitantes, conversaciones, mensajes, lead, cliente, proyecto y correos; el cliente ficticio no entró en ese almacén. Se reinició con las correcciones y se comprobó la igualdad de los 25 conjuntos de datos restaurados. La miniatura privada conserva exactamente sus 155580 bytes. Se conservaron los cambios comerciales existentes antes del inicio del ensayo, que eran posteriores a la copia anterior. La sección Emails vuelve a mostrar los tres correos originales. [Comprobación de conservación](../evidence/ciclo-cliente-datos-preservados.json).

La verificación completa terminó con **45 de 45 suites correctas y compilación correcta**, registrada en [production-local.json](../evidence/production-local.json). Incluye autenticación, aislamiento de visitantes, chat, reservas, integraciones, renderizado, datos del panel, emails, contexto de IA, catálogo, publicación, medios y permisos SQL. Después se ajustó el texto de plazo para distinguir la petición inicial del plazo vigente guardado en la ficha; se repitieron la prueba específica de emails y la comprobación de tipos, ambas correctas. Las pruebas automáticas emplean respuestas de proveedores sintéticas; las llamadas reales citadas pertenecen exclusivamente al ensayo manual.

Las comprobaciones específicas incluyen seguimiento (262), contexto de conversación (118), emails y sincronización (255), contexto de producción IA (143), panel (509), seguridad (372), reservas/métricas del ensayo (91) y operaciones IA del ensayo (175). PostgreSQL temporal ejecuta 52 pasos, aplica las 21 migraciones, repite el plan y prueba permisos efectivos, RLS sin BYPASSRLS y concurrencia. [Evidencia SQL](../evidence/postgres-local.json).

## Límites y uso posterior

El cierre acredita el funcionamiento del recorrido y de sus registros en el entorno local; no acredita que se haya producido una película, recibido un pago o entregado un correo real. Los siete correos permanecen en cola y la interfaz los identifica así. Las nueve plantillas, incluido mensaje libre, requieren revisión humana de los datos y del tono; la IA no acredita acuerdos ni acciones ejecutadas.

La migración v21 está preparada y probada. No se ha aplicado a una base externa ni se ha desplegado la web. Para usar el flujo desplegado deben estar aplicadas v20/v21 y configurados los proveedores y el worker según [Panel y datos](../PANEL_Y_DATOS.md) y [Reservas e integraciones](../RESERVAS_E_INTEGRACIONES.md).

La vista del ensayo puede conservarse con `node scripts/serve-client-journey-audit.mjs --port 4323 --live-chat --restore`; el estado y la clave local quedan en `.codex-tmp`, ignorada por Git. La clave no es un acceso a producción y no se comparte en los informes. Usar `--live-chat` permite consumo real de OpenRouter; omitirlo conserva la prueba sin IA externa.

![Ficha cerrada y roadmap completo](../evidence/ciclo-cliente-cerrado-vista.jpg)

[Plan IA corregido](../evidence/ciclo-cliente-plan-ia.jpg) · [Reserva confirmada](../evidence/ciclo-cliente-reserva.jpg) · [Entrega bloqueada mientras había una tarea pendiente](../evidence/ciclo-cliente-entrega-bloqueada.jpg)
