# Auditoría de preparación para producción de Akrasia Studio

Fecha de revisión: 2 de octubre de 2026.

## Estado posterior a las correcciones

La auditoría que sigue conserva el **diagnóstico inicial y los resultados de revisiones previas**, incluidas las primeras correcciones A01–A10. Las referencias a Astro 4, Node 18, errores de tipos y ausencia de pruebas SQL describen esas etapas históricas. Durante el trabajo posterior se han implementado las correcciones de seguridad y fiabilidad, actualizado el entorno a Node 24/Astro 7 y ejecutado SQL/RLS y concurrencia en PostgreSQL 18.4 local real. Esto no acredita la configuración de Supabase ni Vercel desplegados.

El [estado central de producción](ESTADO_PRODUCCION.md) reúne las guías, evidencias y pendientes vigentes de A01–A41. [Entorno y validación](ENTORNO_Y_VALIDACION.md) documenta el recorrido conjunto, y [Migraciones y reproducción](MIGRACIONES_Y_REPRODUCCION.md) explica hashes, journal y adopción explícita. El resultado final del recorrido queda en `docs/evidence/production-local.json`; no se ha desplegado ni modificado datos remotos. MFA, infraestructura, contenidos acreditados, revisión jurídica y recuperación siguen sujetos a su validación específica.

## Diagnóstico inicial y revisiones previas

El proyecto tiene una identidad visual reconocible, una elección de tecnologías razonable y un alcance comercial útil. Sin embargo, la versión local revisada todavía no está preparada para recibir tráfico público y gestionar contactos y reservas de forma fiable. Los bloqueos principales son la autenticación administrativa, el control de gasto de IA, la protección de datos, la confirmación de reservas y las operaciones que muestran éxito sin haber guardado correctamente.

La recomendación es conservar la dirección visual y la base Astro y React, cerrar estos problemas y publicar primero un recorrido comercial sencillo y verificable. Añadir más funcionalidades antes de estabilizar las actuales aumentaría el coste de mantenimiento y las posibilidades de perder oportunidades comerciales.

## Alcance y límites de la revisión

Se revisaron las páginas y componentes de `src`, las API públicas y administrativas, las librerías de datos e integraciones, los archivos de contenido, las ocho migraciones SQL, la configuración de compilación y la documentación. La revisión corresponde al estado actual del directorio, incluidos cambios sin commit y archivos nuevos; no equivale a auditar únicamente el último commit.

Se ejecutaron la compilación de producción, comprobaciones de tipos, una consulta de vulnerabilidades de dependencias y pruebas locales con datos sintéticos. Se comprobó la portada y una página de servicio en el navegador en disposición de escritorio y móvil. Para la revisión visual se utilizaron respuestas locales vacías de base de datos y se desactivaron las credenciales de IA, Telegram y email únicamente en los procesos de prueba.

No se modificó el código de la aplicación, no se desplegó la web y no se enviaron emails, notificaciones ni reservas reales. Se generaron archivos de compilación y este informe. No se han verificado la configuración real de Vercel, los permisos y migraciones aplicados en Supabase, el contenido del contenedor GTM, la entrega de Resend, el DNS del dominio ni una restauración de copias de seguridad. Tampoco se ha obtenido una medición Lighthouse o de rendimiento real en dispositivos físicos.

La conexión de Supabase configurada no resolvió durante una prueba local y produjo un error de red. Esto acredita que la aplicación maneja mal esa situación, pero no permite atribuir la causa a una caída de producción, un proyecto eliminado o la red del entorno.

En este informe, P1 significa que debe resolverse antes de habilitar la función afectada en producción. P2 identifica mejoras importantes de calidad, operación o crecimiento. Algunos riesgos de base de datos dependen de los permisos efectivos del servicio desplegado y se señalan expresamente.

## Resultados de las comprobaciones

| Comprobación | Resultado | Implicación |
| --- | --- | --- |
| Compilación de producción | Termina correctamente con Astro 4.16.19 | El código se empaqueta, pero la compilación no garantiza corrección de tipos ni del flujo comercial. |
| Destino de la función de Vercel | El archivo generado declara `nodejs18.x` | Es un bloqueo para un nuevo despliegue con esa configuración. |
| Comprobación TypeScript del proyecto | Falla por sintaxis TypeScript en `tailwind.config.mjs` | Falta una comprobación de calidad reproducible. |
| Comprobación adicional de fuentes excluyendo ese archivo | Cuatro errores | Dos usos de `chatRef` inexistente y dos propiedades `projectType` incompatibles. No incluye diagnóstico integral de plantillas Astro. |
| Auditoría de dependencias sin dependencias de desarrollo | 17 paquetes señalados: 2 críticos, 9 altos, 4 moderados y 2 bajos | Incluye dependencias transitivas y herramientas de compilación; no son 17 vulnerabilidades independientes explotadas en la web. |
| Botón de contacto en ficha de servicio en escritorio | Genera conversación pero no presenta chat | El usuario no puede continuar el recorrido desde esa página. |
| Chat de la portada en móvil | Se abre y presenta el historial | La navegación móvil tiene una base funcional. |
| Pruebas de seguridad con proveedor simulado | 25 solicitudes sin identificador, 25 respuestas 200 y ninguna 429 | El límite actual de gasto se puede eludir. |
| Pruebas locales de reservas | Doble inserción concurrente, bloqueos ignorados y fechas mal interpretadas | Hace falta corregir la lógica y garantizar integridad en la base de datos. |

Las versiones principales instaladas son Astro 4.16.19, adaptador Vercel 7.8.2, React 18.3.1, Vite 5.4.21 y Marked 18.0.0. La versión local de Node es 24.21.0. El problema inicial con el lanzador local de npm se evitó utilizando su ejecutable instalado; es un problema del entorno local, separado de los defectos de la aplicación.

## Lo que conviene conservar

- **La identidad visual.** La estética HUD, el cyan y la tipografía dan una dirección reconocible. La página de servicio mantiene esa identidad con una lectura más clara que la portada. Conviene conservarla y mejorar jerarquía, contraste y navegación.
- **Astro y React.** Separar contenido y estructura de las interacciones es adecuado para una web comercial con chat y panel. No hay una razón derivada de esta auditoría para cambiar de framework.
- **El alcance comercial.** Contactos, conversaciones, clientes, proyectos, tareas, email y agenda cubren necesidades reales del estudio. Su valor depende ahora de conectar bien los flujos y hacer fiable cada operación.
- **La base de datos relacional.** Hay UUID, relaciones, índices y restricciones de estados y roles en varias tablas. Las primeras tablas activan RLS, el mecanismo que restringe acceso por fila.
- **La separación inicial de librerías.** Reservas, notificaciones, email y extracción de contactos tienen módulos propios. Esto facilita corregir la lógica sin rehacer la web.
- **Los fundamentos del chat.** Hay contexto compartido entre interfaces, bloqueo de envíos simultáneos, respuesta progresiva y persistencia local. Las respuestas prefijadas reducen el uso de IA, aunque necesitan registro y coherencia entre idiomas.
- **Los fundamentos SEO.** Ya existen títulos, descripciones, canonical, robots, sitemap y fichas de servicios y proyectos. Hace falta corregir assets, idiomas y publicación.
- **Algunos detalles de calidad.** Las miniaturas usan carga diferida, existen estilos de foco visible y etiquetas en la navegación móvil. El cuerpo del email escapa HTML y las claves de proveedores se utilizan en módulos de servidor, sin prefijo público.

## Seguridad y protección de datos

### A01 El PIN del panel no protege las API

**P1.** `src/lib/dashboard.ts:1` valida únicamente un secreto compartido enviado por cabecera o por parámetro de URL. Las API administrativas no comprueban la cookie de PIN. La página acepta la cookie literal `dashboard_pin_verified=true`, sin firma ni sesión verificable (`src/pages/dashboard/[secret].astro:13`).

Quien conoce el secreto de la URL puede consultar o modificar datos y enviar emails sin superar el PIN. Para abrir la interfaz también puede fabricar esa cookie. Esto no significa acceso sin conocer el secreto; significa que el segundo control es aparente.

Usar autenticación real y una sesión de servidor, validada centralmente en cada ruta. Eliminar las credenciales de la URL, permitir cierre de sesión y revocación, y proteger el acceso con MFA cuando sea posible. Puede utilizarse Supabase Auth u otra solución mantenida, incluso para un solo administrador.

### A02 El límite de uso del chat se puede eludir

**P1.** En `src/pages/api/chat.ts:63` el límite solo se aplica si el cliente proporciona `visitor_id`. Se puede omitir o cambiar ese valor. El contador además reside en la memoria de cada proceso y no se comparte entre instancias ni sobrevive a reinicios.

La prueba local con proveedor simulado aceptó 25 solicitudes sin ID y llamó al proveedor 25 veces, sin ninguna respuesta 429. Aunque se limite la salida a 500 tokens, las entradas y el número de llamadas no tienen un presupuesto efectivo.

Emitir una identidad de sesión desde el servidor, limitar de forma persistente por sesión e IP y añadir un presupuesto global. Limitar también tamaño de solicitud, número de mensajes, longitud de texto y concurrencia. No habilitar la IA pública hasta verificar esos límites con pruebas de abuso.

### A03 El chat interpreta HTML sin sanear

**P1.** `src/components/FormattedText.tsx:9` pasa `marked.parse` directamente a `dangerouslySetInnerHTML`. La prueba local confirmó que la versión instalada conserva atributos como `onerror`. La salida de IA y el saludo de retorno que incorpora texto histórico de usuario pueden llegar a ese componente. Los feeds y logs también interpolan cadenas de base de datos en `innerHTML` (`LeftPanel.astro:235`, `RightPanel.astro:243`).

El mensaje de usuario mostrado directamente utiliza el escape normal de React; el problema está en el contenido interpretado como HTML. No se ha confirmado XSS en la vista administrativa de conversaciones.

Sanear Markdown con una lista de elementos y enlaces permitidos, desactivar HTML bruto y utilizar `textContent` en feeds y logs. Añadir una política CSP como defensa complementaria. [La documentación de Marked confirma que no sanea HTML](https://marked.js.org/).

### A04 El historial no verifica a quién pertenece la identidad

**P1.** `src/pages/api/visitor-history.ts:4` devuelve conversaciones, nombre y empresa para un `visitor_id` recibido por URL, sin verificar una sesión propietaria. El chat también acepta esa identidad para escribir mensajes y actualizar contactos.

Los UUID aleatorios dificultan adivinar identificadores, pero conocer uno permite leer o contaminar sus registros. La prueba sintética devolvió información de otra identidad sin cookie ni autorización.

Resolver la identidad en el servidor mediante cookie segura y sesión, proteger lectura y escritura, minimizar el historial devuelto y usar `Cache-Control: no-store`. No tratar el identificador público como una credencial.

Corrección local A04: historial, contexto del modelo, mensajes, contactos y referencias de reservas quedan sujetos a la identidad firmada de A02. El navegador verifica sesión y caducidad antes de restaurar historial; los UUID antiguos no se vinculan a datos privados. Detalles, pruebas y condiciones pendientes de producción: [Aislamiento de visitantes](AISLAMIENTO_VISITANTES.md). No se ha aplicado SQL ni desplegado esta corrección.

### A05 Las tablas nuevas no activan RLS en las migraciones

**P1 condicionado al despliegue.** Las migraciones v6, v7 y v8 crean `bookings`, `availability`, `availability_overrides` y `sent_emails` sin activar RLS. No aparece una migración posterior que lo corrija.

Si el esquema está expuesto por la API de datos y los roles públicos conservan permisos, estas tablas podrían ser accesibles directamente. No se han inspeccionado las políticas ni los permisos de la base desplegada, por lo que no se afirma una filtración efectiva.

Activar RLS, restringir permisos innecesarios y probar lecturas y escrituras con los roles anónimo, autenticado y servidor. [Supabase explica la relación entre tablas expuestas, permisos y RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

Corrección local A05: `supabase/migration-v11.sql` activa RLS y restringe privilegios de las 20 tablas del proyecto, conserva únicamente las operaciones necesarias del servidor y restringe las cinco funciones existentes. Incluye comprobaciones de privilegios heredados, propietarios, secuencias vinculadas, vistas dependientes y funciones privilegiadas públicas inesperadas. Las sesiones firmadas de la aplicación no son Supabase Auth; se mantiene la autorización A01/A04 en las API que usan `service_role`. Guía, pruebas SQL reproducibles, comprobaciones locales y límites: [Permisos Supabase](PERMISOS_SUPABASE.md). No se ejecutó SQL por falta de PostgreSQL local utilizable; la reaplicación, RLS y permisos efectivos de la plataforma siguen pendientes de validación real. La separación local del contrato público de proyectos se documenta en A06.

### A06 La API pública mezcla portfolio y gestión interna

**P1 cuando los datos sean confidenciales.** `src/pages/api/projects.ts:24` selecciona todas las columnas y todos los estados; después devuelve el objeto completo con progreso de tareas (`:40`). Esto incluye nombres o identificadores de clientes y descripciones de proyectos en planificación o producción. No existe una bandera de aprobación de publicación.

Crear un campo `is_published` con valor inicial falso, filtrar por él y devolver únicamente campos públicos. La decisión de publicar un proyecto debe ser independiente de su estado de producción. Revisar también qué actividad y métricas internas deben ser visibles.

Corrección local A06 implementada y verificada con datos ficticios: v12 añade aprobación explícita inicialmente falsa y texto editorial separado, conserva las decisiones al reaplicarse y mantiene permisos A05. La API, portada SSR, detalle por slug, datos HTML, selector y sitemap reutilizan filtro y proyección pública; las demostraciones no actúan como fallback. El panel permite aprobar/retirar con sesión y CSRF, creación sin publicar y validación en servidor. Actividad interna retirada de las API públicas, métricas reducidas al portfolio aprobado y demos eliminadas del contexto del chat. Se verificaron 315 comprobaciones A06 con handlers/middleware/SSR reales y almacén simulado, el flujo en navegador, las regresiones A01/A08/A02/A03/A04/A05 y la compilación. Tipos afectados correctos; persisten los errores previos de `chatRef`, `tailwind.config.mjs` y el destino Node 18. Guía, política de registros existentes, caché y límites de retirada: [Publicación del portfolio](PUBLICACION_PORTFOLIO.md). No se ejecutó SQL por falta de PostgreSQL local utilizable; ejecución/reaplicación SQL, RLS/permisos efectivos y plataforma remota siguen pendientes. Sin despliegue ni cambios remotos.

### A07 La IA recibe roles y contexto arbitrarios del cliente

**P1.** Las interfaces TypeScript no validan el JSON de red. `chat.ts:164` reenvía los roles recibidos mediante una conversión de tipos, que no impide recibir `system`. La prueba local confirmó el envío de una segunda instrucción de sistema al proveedor simulado. El historial y nombre enviados por el cliente se concatenan al contexto del modelo.

La acción de reservar se activa mediante una etiqueta textual de la respuesta. Se necesita un contrato estructurado, validación en servidor, identidad vinculada a la sesión y confirmación de la operación real. Obtener el contexto anterior desde la base de datos y validar roles, textos y tamaño de la entrada antes de cualquier trabajo.

Corrección local A07 implementada: A02/A04 ya validaban roles básicos y recuperaban contexto propio; ahora el contrato JSON rechaza campos extra, herramientas/funciones falsificadas y tipos inesperados antes de trabajo. Los transcripts `assistant` del cliente y el contexto personal antiguo validado se descartan; las instrucciones y definiciones de herramientas proceden del servidor. Se elimina la reserva por etiquetas y se utiliza una única llamada estructurada `prepare_booking` del SDK real de OpenRouter, completa y validada tras terminar el streaming. Solo produce una propuesta firmada vinculada a la sesión, de cinco minutos. El usuario revisa fecha/hora/email y confirma mediante botón; esa petición crea sin IA, valida el resultado real y muestra una tarjeta de confirmación. El UUID de la propuesta y la PK existente impiden repetir la misma inserción/aviso; no resuelven el conflicto entre propuestas distintas de A13. El esquema y argumentos se contabilizan dentro de los límites A02, sin rondas ni llamadas ilimitadas. Lecturas de agenda malformadas cierran la operación. Guía del contrato, configuración, streaming, semántica y pendientes: [Contrato del chat y reservas](CONTRATO_CHAT_IA.md). La prosa del modelo conserva influencia semántica y no acredita acciones; los resultados del servidor son la autoridad. No se ha desplegado ni modificado servicios remotos; continúan las verificaciones reales de proveedor/SQL/RLS/plataforma y los problemas de reservas A11–A15/A27 que exceden este contrato.

Verificación final local A07: contrato de entrada/handler/efectos y cliente SSE, 23 grupos / 1175 aserciones; SDK instalado con respuestas interceptadas, 9 / 99; acciones y helper real de reservas con almacén/avisos ficticios, 9 / 324; navegador con ChatProvider, tarjeta y Markdown reales, 7 / 117. Regresiones A01/A08 (1676), A02 (701), A03 (13841), A04 visitantes (353) y reservas (293), A05 (173 de contrato/fuentes, no SQL) y A06 (315), correctas. Tipos del chat, renderizado y proyectos correctos; compilación de producción correcta con integraciones vacías y red externa bloqueada. Persisten solo los errores previos de `chatRef` en las fuentes generales, la sintaxis TypeScript de `tailwind.config.mjs` en el chequeo global y el adaptador que genera Node 18. Evidencia: [contrato en navegador](evidence/A07-contrato-navegador.jpg). A07 queda corregido y verificado localmente dentro de estos límites; no hay validación real de servicios ni certificación de disponibilidad/integridad completa de la agenda.

### A08 El panel comparte layout y analítica con la web pública

**P2.** El layout carga GTM también en el dashboard (`src/layouts/Layout.astro:48`). El secreto administrativo aparece en la URL, historial, canonical y propiedades del cliente; los enlaces de Telegram también lo incluyen. No se ha demostrado qué datos transmite el contenedor GTM configurado.

Crear un layout administrativo sin analítica pública, usar una URL sin credenciales y añadir `noindex`, `no-store`, protección frente a framing y política de referencias apropiada. Verificar las cabeceras realmente servidas por la plataforma; su ausencia en el repositorio no demuestra que Vercel no añada ninguna.

### A09 Faltan políticas visibles de privacidad y ciclo de vida de datos

**Hallazgo inicial P1.** Faltaban páginas/enlaces de privacidad, aviso legal y cookies, control visible de consentimiento y borrado real del chat. GTM cargaba inmediatamente y `clearHistory` limpiaba solo el navegador.

**Corrección técnica local A09 implementada.** Se añaden las tres páginas legales enlazadas, identificación del responsable confirmada por el titular, canal de derechos e información de IA/proveedores junto al chat. Aceptar, rechazar y configurar categorías opcionales empiezan sin autorización; GTM requiere consentimiento válido y revisión explícita del contenedor, cuyo flag permanece desactivado. Se retiran fuentes remotas, iconos remotos y miniaturas externas, y YouTube/Vimeo se cargan únicamente al abrir un vídeo con consentimiento multimedia. La retirada detiene cargas, retira el reproductor, limpia cookies analíticas propias conocidas y sincroniza pestañas; no deshace envíos anteriores ni borra dominios externos. El panel conserva su separación A08. El diseño se contrastó con [la guía vigente de cookies de la AEPD](https://www.aepd.es/guias/guia-cookies.pdf).

«Borrar conversación y perfil» exige segunda confirmación, cookie firmada, origen exacto, CSRF y versión de contexto. v13 elimina atómicamente mensajes/conversaciones y perfiles web propios, desliga referencias y minimiza visita; conserva reservas, otros canales, copias externas y cuotas vigentes. Comparte bloqueo con admisión A02: un lease propio activo devuelve `409 chat_busy` sin borrar ni reiniciar límites. El contexto persistente protege streaming, guardado y propuestas de A07; caché v2, marcadores y BroadcastChannel evitan restauración desde pestañas o respuestas antiguas. La retención acotada aplica los **30 / 90 / 90 días confirmados** para mensajes/perfiles/registros locales de correo. Las reservas requieren fecha específica revisada; NULL conserva. Mantenimiento POST privado se difiere mientras existan leases activos y sigue disponible sin clave de IA. No se ha programado ningún job ni ejecutado limpieza real.

Verificación final A09: consentimiento 67 comprobaciones; navegador 37 públicas / 36 panel; ciclo de vida 11 grupos / 210; borrado y sincronización 10 / 97, más dos pestañas reales; regresión de sesión 11 / 117. Páginas legales Astro reales verificadas en escritorio y móvil, sin cargas externas. Regresiones A01–A08 correctas: panel 1676, límites 701, renderizado 13841, visitantes 350, reservas 293, Supabase 211, portfolio 315, contrato chat 1175, acciones 325 y proveedor 99. Tipos afectados y compilación aislada correctos. Las pruebas usan datos ficticios y red externa bloqueada; las aserciones SQL son estáticas o transacciones simuladas. Se entrega `supabase/tests/a09-verify.sql` con rollback para ejecución posterior; **PostgreSQL, RLS, permisos, locks, concurrencia y reaplicación reales no se ejecutaron**.

**P1 pendiente para activar en producción:** completar bases jurídicas y justificación de los plazos confirmados, política de reservas, contratos/regiones/transferencias/encargados, backups/restauración y solicitudes externas; ejecutar v13 y pruebas reales en staging, activar/monitorizar mantenimiento, revisar contenedor antes de permitir GTM y verificar red/cabeceras/plataforma. Persisten los problemas previos de tipos generales y el adaptador que genera Node 18. A09 queda corregido localmente dentro del alcance indicado, sin certificación jurídica ni de operación remota. Guía y evidencias: [Privacidad y datos del chat](PRIVACIDAD_Y_DATOS_CHAT.md). Sin despliegue, migraciones remotas, IA de pago, emails, Telegram ni reservas reales.

### A10 Cargas y exportaciones necesitan controles adicionales

**Hallazgo inicial P2.** La carga administrativa admitía cualquier tipo/tamaño, materializaba el cuerpo sin límite y escribía en un bucket público; el CSV escapaba comillas sin neutralizar fórmulas. La función privilegiada de v1 carecía de restricciones explícitas de ejecución y `search_path`.

**Corrección local A10 implementada.** Cargas de una miniatura JPEG/PNG/WebP estática, 2 MiB, cuerpo multipart acotado en streaming incluso sin longitud o con longitud falsa, formato/MIME/extensión coherentes, estructura completa y decodificación real con límites de píxeles/canales/dimensiones/concurrencia. Sharp 0.35.5 reencodifica a WebP sin metadatos; nombres UUID del servidor, errores genéricos de Storage y limpieza del objeto nuevo ante fallos inciertos. El panel muestra límites y errores, conserva la miniatura anterior ante rechazo y distingue cargar de guardar. Autorización persistente, origen y CSRF A01/A08 preceden la lectura/escritura.

V14 prepara un bucket nuevo privado y el cierre del `project-thumbnails` antiguo sin mover/borrar objetos. Guardas RLS restrictivas para esos buckets contienen políticas permisivas generales y preservan usos ajenos; abortan ante privilegios efectivos peligrosos que requieren revisión. El proxy local entrega solo a administración o por referencia exacta de un proyecto aprobado A06, con validación también del contenido antiguo y sin caché ni URL firmada al visitante. La función original ya quedó cubierta por A05 (helper invocador, `search_path` vacío y sin ejecución API); v14 comprueba esa cobertura y las RPC privadas A05/A09 sin redefinirlas. CSV centralizado conserva delimitadores/comillas/saltos/Unicode y protege fórmulas y controles con prefijo de texto, incluidos espacios/apóstrofes previos y cabeceras; solo números finitos explícitos del servidor mantienen tratamiento numérico. Fallos de consulta ya no aparentan una exportación vacía correcta.

Verificación: cargas **253**, HTTP real de Astro con cuerpo por fragmentos **106**, proxy/autorización/publicación **141**, CSV **206** con parser Python independiente, Storage SQL **80 estáticas**; flujo de carga, guardado sin publicar, rechazos y descarga ficticios contrastados en navegador. Regresiones A01/A08 **1676**, A02 **701**, A03 **13841**, A04 **350/293**, A05 **214**, A06 **315 + 40 SQL estáticas**, A07 **1175/325/99**, A09 **67/210** correctas; tipos afectados y compilación aislada correctos. Los SQL de prueba incluyen reaplicación y políticas adversariales pero **no se ejecutaron PostgreSQL, RLS, ACL ni Storage reales**. Guía y procedimientos: [Almacenamiento y exportaciones](ALMACENAMIENTO_Y_EXPORTACIONES.md).

**Pendiente de plataforma para cerrar A10 en producción:** aplicar y verificar v14 en staging, inventariar referencias/contenido antiguo y consumidores compartidos, revisar privilegios históricos de Storage, invalidar y comprobar caché de URLs antiguas, probar recursos/buffer HTTP y limpieza de huérfanos. Sharp exige Node ≥20.9, mientras el adaptador sigue generando Node 18 (A37); el artefacto actual no es desplegable y requiere resolver ese bloqueo y verificar binarios Linux. Persisten los errores generales previos de tipos, las limitaciones de la agenda y el email automático documentadas. La retirada no recupera imágenes ya descargadas ni detiene peticiones ya autorizadas. Sin despliegue, cambios remotos, archivos reales, IA de pago, emails/Telegram o reservas reales.

## Fiabilidad del chat y las reservas

### A11 El chat comunica una reserva antes de crearla

**P1.** El prompt ordena confirmar una llamada y prometer un email (`src/data/systemPrompt.ts:69`). El modelo no recibe herramientas de disponibilidad ni una fecha actual explícita. `checkAvailability` y `getNextAvailableSlots` están importadas pero no se utilizan en el flujo del modelo.

En `src/pages/api/chat.ts:194` se envía `[DONE]` y se cierra la respuesta antes de guardar el mensaje y lanzar la reserva mediante promesas desacopladas. Si el horario está ocupado o la escritura falla, la interfaz ya ha mostrado la confirmación. Las tareas pendientes también pueden perderse cuando termina una ejecución serverless. [Vercel documenta este comportamiento del trabajo asíncrono posterior a la respuesta](https://vercel.com/kb/guide/troubleshooting-inconsistent-logs-in-vercel-functions).

Consultar disponibilidad real, ejecutar una acción validada y confirmar al cliente únicamente después de obtener la reserva guardada. Para trabajo posterior usar una cola o mecanismo explícito compatible con el proveedor, con seguimiento y reintentos.

### A12 No existe el email automático de confirmación prometido

**P1 si se mantiene esa promesa.** Tanto la ruta pública de reservas como el chat notifican por Telegram al equipo (`src/lib/notify.ts:128`). `sendEmail` solo se usa desde el panel administrativo. No hay envío automático al visitante con fecha y enlace de llamada.

Añadir confirmación transaccional al cliente y seguimiento de entrega, o retirar la promesa mientras no esté implementada. La respuesta debe presentar también el enlace real y los pasos para cambiar o cancelar la cita.

### A13 Dos visitantes pueden reservar el mismo horario

**P1.** `src/lib/bookings.ts:260` comprueba disponibilidad y después inserta por separado. La migración v6 solo tiene índices normales, sin una restricción que impida solapamientos. Dos llamadas concurrentes pueden superar la misma comprobación. La lógica de conflicto compara principalmente el inicio de la cita nueva y no cubre todos los solapamientos de duración y buffer.

La prueba local con base simulada produjo dos inserciones para el mismo horario. Garantizar la operación de forma atómica en PostgreSQL, con una restricción adecuada de intervalos y una clave de idempotencia por solicitud. La interfaz también debe gestionar que un hueco deje de estar disponible entre consulta y confirmación.

### A14 La disponibilidad contradice los bloqueos y excepciones

**P1.** `bookings.ts:210` ignora bloqueos parciales y aperturas excepcionales; `:240` sí anuncia algunas aperturas excepcionales. Puede ofrecer un hueco y rechazarlo al reservar. No se rechazan explícitamente fechas pasadas. Una lectura fallida de reservas se convierte en una lista vacía (`:79`), haciendo parecer libre el horario.

Las pruebas locales confirmaron un bloqueo 10:00–11:00 ignorado, una apertura excepcional anunciada pero rechazada y una fecha del año 2000 considerada disponible. Usar un único cálculo de disponibilidad para consulta y creación, y devolver un error explícito si no se puede consultar la agenda.

### A15 El parser cambia fechas y horas

**P1.** `bookings.ts:130` evalúa “mañana” antes de “pasado mañana”; `:168` toma el primer número de una fecha como hora; `:163` normaliza fechas imposibles en lugar de rechazarlas. La conversión de medianoche local a ISO UTC puede cambiar el día en España (`:196`, `:230`).

Con la fecha fija 2 de octubre de 2026 y zona UTC, “pasado mañana a las 17:00” produjo 3 de octubre; “20/10/2026 a las 17:00” produjo 20:00; “31/02/2027 a las 17:00” produjo 3 de marzo y 31:00. En Europe/Madrid aparece además el desplazamiento de fecha al convertir medianoche local a UTC.

Recoger fecha y hora estructuradas, validar sus límites y usar la zona del estudio explícitamente. Si se permiten consultas naturales, pedir confirmación de una fecha normalizada antes de reservar. Separar la fecha civil local del instante almacenado y probado con cambios de horario de verano.

### A16 El streaming puede perder partes de la respuesta

**P1.** `src/hooks/ChatContext.tsx:217` divide cada bloque de red por saltos de línea, sin conservar una línea JSON incompleta para el siguiente bloque. Un evento SSE puede dividirse en cualquier byte; el parseo fallido se descarta sin avisar.

Añadir un buffer de eventos, procesar la terminación y distinguir fallo, cancelación y respuesta completa. Probar fragmentación arbitraria de bloques. Limitar también el historial enviado al proveedor: el límite de persistencia de 50 mensajes no limita los mensajes acumulados en memoria durante una sesión.

### A17 La captura de contactos pierde datos y clasifica mal

**P1 para la propiedad perdida y P2 para la cualificación.** `chat.ts:99` y `:117` envían `projectType`, pero el helper espera `project_type` (`supabase.ts:90`). Con contacto se pierde la categoría; con solo categoría puede no crearse el lead. TypeScript detectó ambos puntos.

Solo se analiza el último mensaje. Un nombre enviado por separado puede perderse, las empresas se extraen como nombre y la puntuación por palabras incluye duplicados y negaciones. “Estreno” puntúa dos veces y “No queremos contratar” resulta caliente en las pruebas locales. La coincidencia por substring, incluido `ad`, también confunde el tipo de proyecto.

Unificar contratos, acumular campos confirmados de la conversación y separar información de persona y empresa. Evaluar cualificación con ejemplos positivos y negativos reales. Mantener la temperatura de interés separada del estado comercial para evitar que un mensaje vuelva a marcar como `hot` un contacto ya gestionado.

### A18 Los mensajes prefijados se quedan fuera del registro

**P2.** `ChatContext.tsx:149` devuelve respuestas prefijadas antes de llamar al servidor. Esas interacciones no generan registro de conversación o visita en el backend. La cobertura de frases en inglés tampoco es equivalente a la española.

Conservar la ventaja de coste de estas respuestas, registrando eventos y contactos de forma independiente del uso del modelo. La captura de un contacto no debería depender de que el texto active o no una respuesta prefijada.

## Panel administrativo y publicación

### A19 Hay operaciones que muestran éxito aunque la base falle

**P1.** `src/lib/dashboard.ts:34` convierte errores de consultas y escrituras en listas vacías o `null`. Varias API devuelven 200 o 201 sin verificar la operación y DELETE puede devolver `deleted:true` aunque falle. Ejemplos: clientes, tareas, servicios, proyectos y disponibilidad. Algunos helpers de contactos también devuelven `true` aunque falle la escritura.

El frontend no comprueba sistemáticamente `res.ok`. El editor de contenido muestra “guardado” incluso con errores HTTP (`DashboardApp.tsx:1853`, `:1873`). Esto puede ocultar la pérdida de una oportunidad comercial o de un cambio.

Centralizar un cliente de datos con error tipado, timeout y trazabilidad. Hacer que la API devuelva estados correctos y que la interfaz conserve el formulario y muestre el fallo. Diferenciar lista vacía, fallo temporal y operación completada.

### A20 El editor de contenido no publica lo que guarda

**P1.** `dashboard/content.ts:37` escribe en la tabla `content`. Las API públicas consultan tablas `projects` y `services`; las fichas y sitemap importan JSON locales. No se encontró un lector público de la tabla `content`.

Un caso de estudio puede aparecer actualizado en el panel y permanecer antiguo en la web. Elegir una única fuente de contenido y conectar edición, validación, borrador, publicación, caché y sitemap. Definir también quién aprueba información y proyectos para publicación.

### A21 Guardar un proyecto puede borrar su miniatura

**P1.** La base usa `thumbnail`, pero el formulario espera `thumbnail_url` (`DashboardApp.tsx:904`). Al abrir el proyecto, el campo puede quedar vacío; PATCH convierte ese vacío en `thumbnail` (`dashboard/projects.ts:71`). Guardar otro dato puede borrar la imagen existente.

Normalizar el contrato de lectura y escritura y aplicar PATCH solo a cambios intencionados. Probar abrir un proyecto existente, modificar su título y comprobar que todos sus otros campos se conservan.

### A22 La creación de proyectos puede repetirse o fallar

**P1.** La API devuelve la lista de filas de Supabase (`dashboard/projects.ts:42`), pero el frontend espera `created.id` (`DashboardApp.tsx:957`). La interfaz puede quedarse en modo creación y repetir POST al guardar de nuevo. Además, el cliente sin seleccionar se representa como `client_id:''`, incompatible con una columna UUID.

Definir una respuesta de objeto consistente, usar `null` para relaciones opcionales y salir de modo creación solo tras éxito confirmado. Añadir idempotencia y prevenir envíos repetidos mientras se guarda.

### A23 La edición rápida puede guardar el estado anterior

**P1.** `DashboardApp.tsx:1155` actualiza el estado React y programa una función que conserva los valores del render anterior (`:1072`). El retraso de 50 ms no actualiza esa referencia. La petición puede enviar el valor anterior y la recarga revertir la selección.

Pasar explícitamente el nuevo valor a la operación de guardado, conservar estados de pendiente y error y gestionar cambios rápidos consecutivos.

### A24 El calendario desplaza días en Europe Madrid

**P1.** El calendario crea fechas a medianoche local (`DashboardApp.tsx:2107`) y calcula claves con `toISOString().split('T')[0]` (`:2116`, `:2240`). En Madrid esa medianoche corresponde al día anterior en UTC. La celda puede mostrar un lunes y consultar las reservas del domingo.

Usar claves de fecha civil consistentes con la zona del estudio y probar semana, mes y cambios de horario en Madrid. El calendario y el backend deben compartir la misma interpretación de fecha y hora.

### A25 Las métricas no representan el embudo real

**P2.** `dashboard/metrics.ts:34` consulta solo `created_at` de los leads y después intenta leer `conversation_id` (`:61`); el ratio de conversión resulta siempre cero. Los periodos de numerador y denominador tampoco coinciden.

`upsertVisitor` establece `page_views:1` cada vez y solo se invoca al enviar un mensaje. Las visitas por día utilizan un `last_seen` mutable, que mueve registros anteriores al día de retorno. `message_count` no se incrementa porque su función SQL no se llama ni tiene trigger.

Registrar eventos con fechas inmutables y definir métricas con periodos consistentes. Medir visita, consulta de proyecto, inicio de conversación, contacto confirmado, reserva y oportunidad comercial, sin confundir una lista de visitantes de chat con tráfico web.

### A26 Las listas y exportaciones serán incompletas al crecer

**P2.** Hay límites fijos de 200 conversaciones, 500 leads o visitantes y 1000 registros de exportación, sin navegación completa. Las métricas leen tablas enteras y cuentan en memoria; los mensajes se consultan sin paginación.

Supabase limita por defecto el número de filas de una respuesta, de forma configurable. Añadir paginación de listas e historial, agregaciones y recuentos en SQL y exportación paginada. [Referencia oficial sobre límites y paginación](https://supabase.com/docs/reference/javascript/v1/select).

### A27 Reintentos y tareas externas pueden duplicar acciones

**P2.** La creación de conversaciones y leads utiliza SELECT seguido de INSERT sin una clave que garantice unicidad por sesión. Reintentar un mensaje puede guardarlo y notificarlo dos veces. El email se envía antes de registrar su resultado; si falla el registro, un reintento puede duplicar el envío.

Telegram utiliza Markdown con texto de usuario sin escape y sus errores se reducen a warnings. La generación de tareas/feed/logs con IA no valida completamente la respuesta y puede presentar inserciones parciales o errores como elementos creados.

Usar IDs de mensajes y operaciones, idempotencia, salida IA validada y una cola o tabla de trabajo pendiente con estado y reintentos controlados. Distinguir aceptación por el proveedor de entrega real de un email; incorporar rebotes y fallos cuando el volumen lo requiera.

## Experiencia comercial y contenido

### A28 El portfolio incluido es de demostración

**P1 antes de presentar el portfolio como trabajo real.** Los ocho elementos de `src/data/projects.json` apuntan al mismo vídeo `dQw4w9WgXcQ`; ese valor también está en los seeds SQL. Las miniaturas se repiten y dependen de URLs externas de referencia. Los case studies contienen resultados específicos que necesitan evidencia del propietario; esta revisión no confirma su veracidad.

Reemplazar demos por trabajos reales, miniaturas controladas y vídeos autorizados. Revisar créditos, clientes, permisos de publicación y resultados comprobables. Es preferible publicar dos o tres casos sólidos que ocho elementos de muestra. Las fichas de proyectos deberían mostrar la pieza, además del texto de proceso.

### A29 Los botones interiores no muestran el chat en escritorio

**P1.** Las páginas de servicios y proyectos montan `ChatWrapper` pero no contienen `#chat-desktop-root`. El componente solo presenta el chat de escritorio si existe ese elemento (`ChatWrapper.tsx:379`, `:385`). La prueba visual de “Hablemos de tu proyecto” en Branded Content confirmó que la conversación se genera y persiste, pero no aparece en la ficha de escritorio. Al volver a la portada aparece su historial.

Añadir un chat flotante autónomo o un contenedor en las fichas. En móvil las fichas tampoco incluyen el slot para el botón permanente, aunque un CTA puede abrir el chat mediante el evento. Probar cabecera, footer, CTA de ficha y vuelta al chat en cada tipo de página.

### A30 Servicios y navegación carecen de una salida comercial robusta

**P2 y P1 para acciones que quedan inactivas.** Las tarjetas de servicios dependen de `chat_message`, pero el fallback devuelve `chatMessage` y la creación administrativa no solicita ese campo. Algunas tarjetas pueden verse y no realizar ninguna acción. La home tampoco enlaza directamente a las fichas profundas; muchos enlaces del footer apuntan a `#` y disparan chat.

No se encontró un contacto humano directamente visible ni un formulario alternativo al chat. Añadir acceso a servicios, casos y contacto, con un canal que siga funcionando cuando la IA falle. Mostrar una acción principal clara, por ejemplo enviar un brief o solicitar una llamada, y qué respuesta debe esperar el cliente.

### A31 La actividad decorativa puede confundirse con datos reales

**P2.** Los paneles toman registros existentes aleatoriamente y les asignan la hora actual al mostrarlos (`LeftPanel.astro:229`, `RightPanel.astro:234`). Los fallback enseñan 3 proyectos, 24 piezas y 7 clientes incluso sin datos. No son indicadores comprobados de actividad nueva.

Mostrar fecha real y novedades por ID, evitar repetir registros como eventos recién ocurridos y retirar números no acreditados. Mantener lo decorativo como lenguaje visual, sin presentarlo como información empresarial actual.

## Accesibilidad idiomas y rendimiento

### A32 Hay controles que no se pueden usar bien con teclado o lector

**P2.** La home no tiene un `h1` semántico. Servicios, miniaturas y logo se implementan como elementos con clic sin semántica adecuada. Hay botones de cierre sin nombre accesible, campos sin etiqueta y chat sin avisos de nuevas respuestas. Los modales no gestionan completamente foco, Escape y retorno al disparador.

Usar botones y enlaces reales, etiquetar controles y gestionar foco y anuncios de estado. El estilo de foco visible existente es una buena base. Verificar el recorrido completo con teclado y con lector de pantalla, además de una herramienta automática.

### A33 Tamaño contraste y movimiento necesitan ajustes

**P2.** Mucho texto funcional usa tamaños de 8 a 12 px y tonos oscuros sobre fondo oscuro. Los contrastes calculados de slate-600 y slate-700 sobre `#0a0a0a` son aproximadamente 2,61:1 y 1,91:1. No hay una alternativa `prefers-reduced-motion` pese a animaciones y parpadeos continuos.

Subir la legibilidad del contenido y de las acciones principales, conservando los detalles HUD para información secundaria. Reducir el movimiento según preferencias y revisar zoom, pantallas pequeñas y modo horizontal. La revisión visual observó que el texto del chat puede competir con el HUD de fondo; separar mejor la jerarquía mejoraría la lectura.

### A34 El loader impide una salida progresiva sin JavaScript

**P2.** El loader es opaco, fijo y tiene z-index 9999 (`global.css:564`); únicamente se oculta mediante JavaScript (`Layout.astro:162`). Si ese script no se ejecuta, puede tapar indefinidamente el contenido servido.

Hacer visible el contenido por defecto y añadir la animación de carga solo cuando el script esté activo. Probar fallo de carga del script y navegación sin JavaScript. Una web comercial necesita que servicios y contacto sigan siendo accesibles en ese caso.

### A35 La imagen social y los idiomas tienen incoherencias

**P2.** El layout referencia `/img/og-akrasia.jpg` y `/favicon.ico`, que no existen en `public`. El SVG del favicon sí existe. La imagen social necesita una URL absoluta y un archivo válido.

Las fichas eligen idioma por query y cabecera, mientras el layout vuelve a aplicar otro idioma desde navegador o localStorage. Puede aparecer un artículo inglés con cabecera española y `html lang` incorrecto. El canonical elimina la query inglesa, el sitemap la incluye y no hay `hreflang`.

Unificar el idioma de ruta, contenido, metadatos y controles; usar variantes coherentes y enlazadas para ES y EN. Consolidar traducciones duplicadas en layout, `lib/i18n.ts` e `I18nScript.astro`. Añadir datos estructurados de organización y de proyectos solo con información verdadera.

### A36 Hay oportunidades de rendimiento que requieren medición

**P2.** El fondo JPG pesa unos 603 kB, hay fuentes con muchos pesos y una fuente completa de iconos. Las animaciones, desenfoques y sombras pueden consumir recursos. Los feeds hacen peticiones periódicas cada cinco o siete segundos, sin pausar por visibilidad; la caché HTTP reduce parte del tráfico.

El build genera aproximadamente 66,3 kB de JavaScript para ChatWrapper, 21,1 kB comprimidos, y 446,7 kB para DashboardApp, 124,4 kB comprimidos. React y otros módulos se empaquetan por separado; estas cifras no son el peso total de cada página ni una puntuación de rendimiento.

Medir antes de fijar objetivos: Core Web Vitals de páginas públicas, coste de animaciones, red lenta y móvil real. Optimizar imágenes y fuentes, cargar gráficos y pestañas del panel cuando se usen, pausar polling en segundo plano y mantener los datos públicos cacheables. Prerenderizar fichas públicas cuando su política de publicación lo permita.

## Ingeniería despliegue y operación

### A37 La configuración actual produce una función Node 18

**P1.** Aunque se compila con Node 24, el adaptador Vercel antiguo avisa de incompatibilidad y genera `.vercel/output/functions/_render.func/.vc-config.json` con `runtime: nodejs18.x`. Vercel dejó de admitir nuevos despliegues con Node 18 el 1 de septiembre de 2025. Marked instalado declara además Node 20 o superior.

Actualizar conjuntamente Astro y el adaptador compatible, fijar una versión de Node soportada en `package.json` y en Vercel, y verificar el archivo generado. No seguir el consejo antiguo del adaptador de volver a Node 18. [Referencia oficial de la retirada de Node 18](https://vercel.com/changelog/node-js-18-is-being-deprecated).

### A38 Hay alertas de dependencias que requieren actualización controlada

**P1 para cerrar la evaluación de seguridad.** La consulta a npm señala 17 paquetes, incluidos Astro, el adaptador, Marked y dependencias transitivas. Marked 18.0.0 está en el rango de un aviso de consumo de memoria por entradas especiales, corregido a partir de 18.0.2. El adaptador 7.8.2 está en el rango del aviso de reescritura de rutas que puede eludir restricciones de plataforma bajo ciertas configuraciones.

La alerta crítica de Astro asociada a optimización AVIF requiere que un atacante pueda hacer procesar una imagen AVIF no confiable; esa posibilidad no se ha demostrado en esta web. Los avisos de Vite y varias librerías pueden afectar principalmente a desarrollo o compilación. No se debe presentar el recuento como prueba de compromiso.

Actualizar en una rama, revisar avisos aplicables y migraciones de versiones, reconstruir, comprobar tipos y repetir las pruebas afectadas. Evitar una corrección automática con cambios mayores sin revisión. [Aviso del mantenedor de Marked](https://github.com/markedjs/marked/security/advisories/GHSA-6v9c-7cg6-27q7), [aviso del adaptador](https://github.com/withastro/astro/security/advisories/GHSA-mr6q-rp88-fx84) y [aviso de optimización AVIF](https://github.com/withastro/astro/security/advisories/GHSA-26w7-cxv4-gfx2).

### A39 Faltan comprobaciones automáticas y el panel concentra demasiada lógica

**P2 y P1 para los errores actuales de tipos.** `package.json` solo tiene desarrollo, build, preview y Astro; no hay scripts de pruebas, lint o comprobación de tipos ni pipeline CI identificado. El build permite pasar errores que la comprobación de tipos sí detecta. `tailwind.config.mjs` contiene `import type` y `satisfies`, sintaxis TypeScript en un archivo JavaScript. Los componentes antiguos `Chat.tsx` y `MobileChat.tsx` usan un `chatRef` que ya no existe en el contexto.

El panel tiene unas 2400 líneas y múltiples dominios y pestañas en un solo archivo. Dividirlo por funcionalidades, compartir contratos entre API y frontend y usar un cliente API común. Añadir comprobación integral de Astro y TypeScript al pipeline, y pruebas de los recorridos con riesgo real: autenticación, captura, guardado, reservas concurrentes, fragmentación del chat y publicación. No hace falta probar detalles cosméticos sin impacto.

### A40 Las migraciones y la documentación no permiten reproducir el despliegue con confianza

**P2.** Las migraciones son archivos manuales, sin evidencia de control de aplicación ni separación completa de datos demo. Algunas reejecuciones fallan por políticas existentes y otras duplican servicios, feed, logs o disponibilidad. Faltan restricciones de intervalos, duración y buffer. El roadmap marca varias fases completadas sin satisfacer los criterios funcionales identificados y menciona únicamente migraciones v3 y v4 en el despliegue, aunque las funciones nuevas requieren v5 a v8.

Crear un procedimiento reproducible en una base limpia, separar seeds y datos reales, versionar migraciones y probar restauración. Actualizar arquitectura y roadmap según las dependencias actuales. Hay numerosos cambios y archivos nuevos sin commit; preparar una versión revisada y recuperable antes del primer despliegue.

Existen archivos de claves SSH en el directorio local y están excluidos por patrones de `.gitignore`. No se encontraron esos nombres ni `.env` en el historial consultado. No hay evidencia de filtración ni razón para afirmar que ya están comprometidos. Guardarlos fuera del proyecto reduce el riesgo de copiarlos en un ZIP o paquete futuro; añadir detección de secretos al flujo de revisión.

### A41 Faltan pruebas operativas de las integraciones

**P2 antes del lanzamiento.** No se encontraron configuración de seguimiento de errores, objetivos de disponibilidad, procedimiento de recuperación, límites globales de coste ni comprobación de salud. Los helpers no distinguen de forma homogénea fallos de proveedor y ausencia de datos; no hay timeout explícito común en las llamadas de datos, email y Telegram. El fallback de servicios falla ante falta de variables o errores de red (`api/services.ts:19`) antes de llegar al JSON local.

Validar variables necesarias al arrancar, usar respuestas degradadas útiles para la web pública y errores explícitos para operaciones críticas. Configurar seguimiento de errores sin datos personales innecesarios, alertas por fallos de captación, presupuesto de IA y procedimiento de recuperación. Verificar dominio remitente, SPF, DKIM y DMARC para email, DNS y TLS del sitio, región de datos y funciones, y acceso y copias de Supabase. Su estado actual no se ha inspeccionado desde las cuentas reales.

## Plan recomendado para llegar a producción

El trabajo debería organizarse por resultados comprobables. Las duraciones de una o dos horas del roadmap no reflejan los problemas encontrados. Una estimación fiable necesita decidir primero si se mantiene la agenda propia y cuánto del panel debe estar operativo desde el primer lanzamiento.

| Etapa | Trabajo prioritario | Condición para darla por terminada |
| --- | --- | --- |
| 1 Seguridad y plataforma | Actualizar stack y Node, autenticación y sesiones, límites de IA, sanitización, propiedad de historial, RLS y campos públicos | API administrativa rechaza accesos indebidos; historial ajeno no se lee; límites sobreviven a reinicios; contenido no ejecuta HTML; build genera runtime soportado. |
| 2 Fiabilidad comercial | Errores reales de guardado, contratos del panel, captura de leads, reservas atómicas y confirmación verdadera, email, parser SSE y fuente única de contenido | Chat a contacto a panel funciona; no hay éxito falso ni dobles reservas; los cambios publicados llegan a la web; errores conservan datos y permiten recuperación. |
| 3 Presentación y conversión | Portfolio real, fichas con vídeo, chat interior, contacto humano, accesibilidad, idioma coherente, imagen social y privacidad | Todas las acciones principales funcionan en escritorio y móvil; existe salida si falla IA; contenidos y métricas publicados están acreditados. |
| 4 Lanzamiento verificable | Entorno staging separado, CI, migraciones reproducibles, pruebas integradas, medición de rendimiento, monitorización, DNS, remitente y recuperación | Versión identificable, checklist completado, restauración o rollback probado y observación de fallos y gasto activa. |

Para reducir el alcance inicial, una alternativa razonable es publicar primero servicios, casos reales y contacto directo, y habilitar después la IA y las reservas cuando sus controles e integridad estén verificados. Si la agenda propia no aporta una ventaja importante, integrar un proveedor de reservas mantenido puede reducir la lógica crítica que el estudio tiene que operar; requiere valorar necesidades y condiciones actuales del proveedor antes de elegirlo.

## Criterios concretos de lanzamiento

- [ ] Compilación y comprobación de Astro y TypeScript reproducibles, con versión soportada de Node.
- [ ] Dependencias actualizadas y evaluación documentada de alertas pendientes aplicables.
- [ ] Sesión administrativa real y control de autorización en todas las API.
- [ ] Pruebas de RLS y permisos de las tablas con datos personales en el Supabase desplegado.
- [ ] Sesión propietaria para historial y escritura de conversaciones, sin confiar en IDs enviados por el cliente.
- [ ] Límites persistentes, entrada acotada y presupuesto global de IA.
- [ ] Markdown saneado y contenido público sin HTML ejecutable de fuentes no confiables.
- [ ] Escrituras y borrados reportan su resultado real y la interfaz conserva cambios si fallan.
- [ ] Reserva confirmada solo después de guardarse, sin dobles reservas concurrentes y con fechas de Madrid correctas.
- [ ] Confirmación y enlace de llamada disponibles realmente para el cliente.
- [ ] Edición y publicación usan una única fuente de contenido.
- [ ] Portfolio, cifras, resultados y permisos de uso verificados.
- [ ] CTAs y contacto funcionan desde todas las páginas en escritorio y móvil, también ante fallo de IA.
- [ ] Idiomas, canonical, hreflang, sitemap, imagen social y semántica coherentes.
- [ ] Privacidad, cookies, información sobre proveedores, borrado y retención implementados según el uso real.
- [ ] Recorrido completo probado en staging con contactos de prueba y proveedores controlados.
- [ ] Medición de rendimiento y revisión de teclado, foco, contraste y movimiento.
- [ ] Monitorización, alertas, límite de gasto y recuperación comprobados.
- [ ] DNS, TLS, remitente email y copias de seguridad revisados en las cuentas reales.

Este listado es una propuesta de trabajo derivada de la auditoría; no certifica que la infraestructura actual cumpla o incumpla requisitos que todavía no se han inspeccionado.
