# Contexto de conversación y emails · 3 de octubre de 2026

La ficha y el redactor consultan la conversación del lead para completar nombre, proyecto y necesidades. La generación IA vuelve a obtener el historial en el servidor y verifica que la conversación corresponde al visitante del lead. Los mensajes se transmiten como datos; las afirmaciones del asistente no acreditan acuerdos comerciales.

## Recorrido comprobado en el admin local

- Abrir **Leads → Ficha y seguimiento → Redactar recepción y evaluación**.
- Confirmar 18 mensajes recuperados, nombre real y proyecto de animación 3D de 30 segundos para Instagram.
- Revisar requisitos sobre promoción de un nuevo sabor de chocolates y el plazo solicitado de una semana, pendiente de confirmar.
- Pulsar **Mejorar con IA** con el proveedor OpenRouter configurado: respuesta completa y válida, correo específico al encargo y sin presupuesto ni compromiso de entrega inventados.
- Guardar revisión 1 del borrador, vinculada al lead, cliente, proyecto y seguimiento. No se pulsó **Enviar correo**; no se añadieron filas a la cola de integraciones.
- Recargar y reabrir el borrador: asunto y cuerpo de IA conservados, contexto recuperado de nuevo y revisión 1 vigente, sin cambios que guardar.
- Conservar las filas anteriores de visitantes, conversaciones, mensajes y leads, y los datos manuales de presupuesto. El almacén sigue siendo la vista local en memoria; no se modificó una base externa.

Se repararon únicamente los datos automáticos incompletos de la ficha local existente a partir de su conversación. El redactor conserva correcciones manuales, condiciones del equipo y el asunto y cuerpo de los borradores guardados. Los errores de lectura tienen aviso y reintento; un fallo de IA conserva el editor. La extracción descarta profesiones y procedencias ambiguas como nombres, y distingue los plazos afirmados de las negaciones o revocaciones del cliente.

## Verificación automática

| Comprobación | Resultado |
| --- | --- |
| Contexto de conversación | 10 grupos, 118 comprobaciones |
| Redacción, JSON completo y preservación de datos | 10 grupos, 213 comprobaciones |
| Autorización administrativa | 20 grupos, 1854 comprobaciones; 22 rutas y 47 handlers |
| Seguimiento, borradores e idempotencia | 7 grupos, 203 comprobaciones |
| TypeScript | Correcto |
| Build aislado sin credenciales externas | Correcto; Node 24, 60 segundos, streaming |

Las pruebas automáticas usan datos y respuestas sintéticos. La llamada real a la IA se limita al recorrido manual indicado. La lectura canónica no escribe datos ni llama a proveedores externos. El contexto está acotado a 300 mensajes y 60.000 caracteres, conserva inicio y últimas aclaraciones si excede el límite y muestra un aviso de extracto. No se ejecutaron nuevas migraciones.

![Borrador guardado con contexto de la conversación](../evidence/email-contexto-conversacion-vista.jpg)

[Vista completa del correo generado](../evidence/email-contexto-conversacion.jpg)
