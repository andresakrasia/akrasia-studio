# Privacidad, consentimiento y ciclo de vida del chat (A09)

Corrección local del 2 de octubre de 2026. Se preservan las correcciones A01–A08 y los cambios previos sin commit. No se ha desplegado, aplicado SQL a servicios, limpiado datos remotos, accedido al contenedor GTM ni utilizado IA, correo, Telegram o reservas reales.

## Identificación y alcance jurídico

El titular comunicó y confirmó expresamente: responsable **Andrés Gómez Martínez**, NIF **39418645A**, domicilio **Bonaventura Polles 28, 08014 Barcelona**, canal de derechos **info@akrasia.studio**. Se incorporan a las páginas `/privacidad`, `/aviso-legal` y `/cookies`; no constituye comprobación registral/fiscal. El nombre comercial AKRASIA STUDIO y ese correo también figuraban en el contenido del proyecto. No se deduce una sociedad, inscripción registral, DPO, establecimiento adicional ni contrato de esos datos.

Las páginas tienen enlaces en el footer y navegación entre ellas. El chat identifica su IA, finalidad, almacenamiento, proveedores de código comprobados y canal de derechos cerca de la interacción. No se pide aceptar analítica para enviar mensajes, solicitar contacto ni revisar/confirmar una propuesta de reserva.

La corrección técnica **no certifica cumplimiento jurídico completo**. El responsable confirmó los plazos técnicos 30/90/90 días el 2 de octubre de 2026. Antes de habilitar tratamiento público debe completar la base jurídica correspondiente a consultas/contactos/reservas y seguridad, documentar la justificación de esos plazos, comprobar encargados/subencargados, contratos, regiones, transferencias y copias, e informar cualquier tratamiento adicional real. No se asigna automáticamente consentimiento a todo el tratamiento ni interés legítimo sin evaluación. El consentimiento implementado aquí se limita a categorías opcionales del navegador.

La información y los controles se diseñan atendiendo al [RGPD, especialmente arts. 5, 12, 13, 17 y 19](https://www.boe.es/buscar/doc.php?id=DOUE-L-2016-80807) y la [LO 3/2018](https://www.boe.es/buscar/act.php?id=BOE-A-2018-16673). La identificación del prestador y la separación del almacenamiento necesario y opcional se contrastaron con [LSSI, arts. 10 y 22.2](https://www.boe.es/buscar/act.php?id=BOE-A-2002-13758). La transparencia del aviso, elección inicial y retirada se contrastaron con la [guía de cookies vigente publicada por la AEPD, actualización mayo de 2024](https://www.aepd.es/guias/guia-cookies.pdf). Los derechos y su canal se contrastaron con [la información oficial de la AEPD](https://www.aepd.es/derechos-y-deberes/ejerce-tus-derechos). Fuentes consultadas el 2 de octubre de 2026.

## Inventario técnico confirmado y límites externos

| Tratamiento | Dato/utilidad en este código | Destino o almacenamiento |
| --- | --- | --- |
| Conversación | Mensaje nuevo, historial reciente propio y nombre/empresa propios para responder | Caché del navegador, conversaciones/mensajes Supabase; inferencia a través de OpenRouter |
| Perfil/contacto del chat | Nombre, email/teléfono facilitados, proyecto, clasificación de interés/presupuesto para atender la consulta | Leads del canal web; avisos al equipo cuando Telegram está configurado |
| Propuesta | Fecha, hora, nombre, email y token firmado de confirmación de cinco minutos | Memoria del cliente; no localStorage, ni URL; invalida al borrar/cambiar contexto |
| Reserva confirmada | Contacto, fecha/hora, estado y enlace de llamada | Tabla bookings; resultado servidor autoritativo A07 |
| Correo/avisos | Correos administrativos y registro independiente de envío; Telegram de contactos/reservas | Resend y sent_emails cuando configurado; Telegram puede tener copias externas |
| Seguridad/cuotas | Firma de sesión, versión del contexto, expiración, contadores/leases | Cookie HttpOnly; estados y referencias hash de sesión/IP en Supabase, sin transcript ni IP en claro en las tablas de cuotas |
| Analítica opcional | Integración Google Tag Manager, solo si se habilita tras revisión y consentimiento | Deshabilitada de fábrica; no se verificaron etiquetas remotas |
| Multimedia opcional | Reproductor YouTube o Vimeo, únicamente al abrir vídeo con elección válida | YouTube con dominio nocookie, Vimeo con dnt; no implica ausencia de tratamiento |

El SDK configura `~deepseek/deepseek-v4-flash-latest` mediante OpenRouter, con fallbacks desactivados. Esto no identifica un proveedor concreto de inferencia ni acredita región, ausencia de entrenamiento, ZDR, contrato o plazos. [La política oficial de OpenRouter](https://openrouter.ai/privacy) explica diferencias entre proveedores; corresponde confirmar el routing/contrato efectivo. Las integraciones se contrastan también con información oficial de [Supabase](https://supabase.com/privacy), [Resend](https://resend.com/legal/privacy-policy), [Telegram](https://telegram.org/privacy/eu), [Google](https://policies.google.com/privacy?hl=es) y [Vimeo](https://vimeo.com/legal/privacy). No se han inspeccionado las cuentas ni se trasladan sus políticas genéricas como condiciones pactadas de esta instalación.

La configuración apunta a Vercel. Sus registros de plataforma, CDN, backups y restauraciones requieren inventario y política propios. El botón del chat no elimina esos registros ni copias del proveedor. Un envío a IA o notificación aceptado antes del borrado no puede deshacerse mediante esta acción.

## Consentimiento y cargas externas

`privacy-consent.ts` acepta exclusivamente una preferencia `akrasia_privacy_preferences` con versión 1, fecha válida y dos booleanos: `analytics` y `externalMedia`. Caduca a los 180 días. Valores ausentes, JSON corrupto, campos inesperados, versiones antiguas, fechas futuras o caducadas no autorizan cargas. No contiene identificadores de chat ni texto personal. Si el almacenamiento no está disponible, la elección puede durar solo durante la visita.

Aceptar, rechazar y configurar tienen botones visibles. Las categorías opcionales empiezan apagadas. La configuración permanece accesible desde footer y páginas legales. El diálogo gestiona Tab, Escape, foco inicial y devolución del foco. Cambiar multimedia retira el iframe abierto; retirar analítica ya ejecutada guarda primero la negativa, elimina cookies analíticas propias conocidas y recarga el documento para detener el código cargado. Las pestañas reaccionan a `storage`; al expirar una preferencia activa se aplica el mismo bloqueo. La recarga no borra la cookie del chat ni el transcript del servidor. No puede borrar cookies de otros dominios ni datos ya enviados.

No hay GTM inmediato, `noscript`, Consent Mode con pings previos, preconnect ni preload de analítica. El panel conserva `DashboardLayout` sin runtime público de consentimiento/analítica. Google Fonts y la fuente remota de iconos se sustituyen por fuentes del sistema e iconos SVG locales. Las miniaturas remotas del contrato público se suprimen: se aceptan rutas locales seguras, por lo que ejemplos externos pueden mostrarse sin imagen hasta cargar un asset local. A10 añade miniaturas de Storage entregadas por el servidor en el mismo origen tras aprobación A06; el navegador no contacta con Supabase ni recibe URLs firmadas de ese proveedor. Véase [Almacenamiento y exportaciones](ALMACENAMIENTO_Y_EXPORTACIONES.md). Los reproductores solo permiten formatos YouTube/Vimeo conocidos; URLs arbitrarias, credenciales y esquemas inseguros no crean iframes.

Variables públicas:

```dotenv
PUBLIC_GTM_CONTAINER_ID=GTM-WKFHZ928
PUBLIC_GTM_CONTAINER_REVIEWED=false
```

El ID consta en el código previo; no se ha consultado el contenedor. Aun cuando el visitante elija analítica, **no se carga GTM con el flag false**. No ponerlo a true hasta inventariar tags, finalidades/destinatarios, nombres y plazos de cookies, almacenamiento, redirecciones y cargas alternativas; verificar que ninguna etiqueta de publicidad, personalización u otra categoría se ejecute con la mera categoría analítica; impedir que tags accedan al transcript, contacto, token de reserva o credenciales; completar las páginas según el inventario real. Repetir pruebas de red de producción/staging con esa configuración. Revisar cookies diferentes de las estándar que limpia el código y cualquier almacenamiento propio de tags aprobados. Al cambiar sustancialmente finalidades, proveedores o condiciones, actualizar los textos y la versión de preferencia para solicitar una elección nueva; no reutilizar una autorización anterior de otro alcance. No se modificó ninguna cuenta externa.

## Contrato de borrado y concurrencia

«Borrar conversación y perfil» tiene una segunda confirmación con alcance explícito. `GET /api/visitor-history` devuelve la sesión y expiración verificadas, `contextVersion` persistente y un `csrfToken` HMAC para esta operación, ligado a propietario/expiración/versión. El token se mantiene solo en memoria.

```http
DELETE /api/visitor-history
Origin: https://akrasia.studio
Content-Type: application/json
X-Chat-CSRF: TOKEN_RECIBIDO_DEL_SERVIDOR
Cookie: __Host-akrasia_chat=SESION_FIRMADA

{"contextVersion":0}
```

Exige sesión existente y válida, origen exacto y token CSRF. No admite UUID ni otra autoridad elegida por el cliente, query, campos adicionales o cuerpo superior a 1024 bytes; la lectura también tiene un deadline. El RPC `chat_erase_context` toma el mismo bloqueo de admisión de A02 y un bloqueo de propietario en una transacción. Si hay un lease vigente propio devuelve `409 chat_busy` y `Retry-After`, sin borrar ni avanzar versión. La interfaz informa cuánto esperar y permite confirmar de nuevo. Los leases duran inicialmente 60 segundos y pueden conservarse hasta vencer tras cancelar o fallar una petición; no se reinician/refundan cuotas para acelerar el borrado. Cuando no hay trabajo propio admitido, elimina conversaciones/mensajes y leads web propios, desliga referencias de reservas/emails, limpia datos derivados de visita y avanza la versión. Los contactos de otros canales se conservan independientemente y no vuelven al contexto de IA del chat.

Respuesta coherente: `deleted:true`, misma `sessionId`/expiración, nueva `contextVersion`, nuevo CSRF, `scope:chat_and_derived_profile`, y conservación de `bookings`, `external_notifications`, `quota_security`. No se rota la identidad ni se borran/reembolsan cuotas. Una repetición de la versión inmediatamente anterior reconoce el borrado registrado en `last_erased_version` sin volver a borrar una conversación nueva; un incremento por retención no acredita esa operación. Otras versiones antiguas fallan. Ante error o respuesta incoherente el cliente no comunica éxito ni elimina el historial visible por su cuenta; una lectura fresca posterior puede detectar una operación de resultado ambiguo que sí se completó.

La caché local es versión 2 y está ligada también a `contextVersion`; una caché anterior se descarta. Tras éxito, se limpian transcript, perfil visible y propuestas, y se publica un marcador mínimo `akrasia_chat_erasure` sin mensajes/credenciales mediante `storage` y BroadcastChannel. Pestañas activas descartan la versión antigua y vuelven a verificar servidor; las que vuelven del segundo plano verifican de nuevo. La marca y la sesión en memoria no retroceden de versión; un DELETE o GET retrasado no reinstala un contexto anterior a un borrado recibido de otra pestaña. Un navegador cerrado no elimina físicamente localStorage hasta volver a abrirse: se comprueban expiración y versión antes de mostrarlo.

El cliente aborta streaming y bloquea envíos mientras borra; descarta respuestas de una generación anterior y vuelve a comprobar el bloqueo de borrado y su token de operación después de verificar sesión. La consulta de sesión tiene timeout de diez segundos y un finally antiguo no desbloquea una petición nueva. `POST /api/chat` transporta `context_version`, usa solamente la entrada nueva y nunca restaura autoridad desde un transcript del navegador. Antes de cargar/enviar contexto, durante el stream y antes de resultado comprueba la versión. El bloqueo compartido con admisión y la negativa a borrar mientras exista un lease cierran la ventana entre comprobar contexto y empezar una llamada de IA en otra instancia: el deadline del trabajo vence antes que su lease y se revalida después de awaits antes de iniciar proveedor, acción o aviso. Las nuevas admisiones tras un borrado no pueden utilizar la versión anterior. Un registro local complementa la cancelación de trabajo, y los RPC persistentes protegen escrituras entre instancias. `chat_save_turn` guarda turno/perfil bajo el mismo bloqueo de propietario; `chat_insert_booking` verifica versión de una propuesta firmada v2 antes de insertar. Las reservas ya confirmadas se conservan. Esta garantía todavía requiere ejecutar la verificación de transacciones y tiempos en PostgreSQL/plataforma, además de las simulaciones entregadas.

No confundir esta acción con cancelar reservas, suprimir registros comerciales independientes, recuperar una conversación sin cookie válida, ejercer todos los derechos o retirar copias externas. Esas gestiones se solicitan a `info@akrasia.studio` y requieren localizar lo pertinente sin dar acceso a otros visitantes.

## Retención y operación en plataforma

`supabase/migration-v13.sql` añade estado/versiones, RPC atómicos, retención y `bookings.privacy_retention_until` conservando los datos existentes. Activa RLS y restringe funciones/tablas a las operaciones de servidor necesarias. Requiere migraciones anteriores, especialmente A02 v10, A05 v11 y A06 v12; comprobar aplicación en staging antes de habilitar chat. Si faltan sus RPC, la aplicación falla cerrada, sin escritura alternativa que eluda el borrado.

| Configuración | Valor técnico inicial | Criterio y pendiente |
| --- | --- | --- |
| `CHAT_RETENTION_DAYS` | 30 días, desde cada mensaje | Confirmado por titular; continuidad limitada de consultas, documentar necesidad |
| `CHAT_PROFILE_RETENTION_DAYS` | 90 días, desde actualización del lead web | Confirmado por titular; seguimiento comercial corto, separado del transcript; base pendiente |
| `NOTIFICATION_RETENTION_DAYS` | 90 días, desde registro local de email | Confirmado por titular; seguimiento de envío/incidencias; no borra correo recibido ni Telegram/Resend externos |
| `RETENTION_BATCH_SIZE` | 100; máximo 500 por categoría | Acotar trabajo y repeticiones del mantenimiento |
| Reserva `privacy_retention_until` | NULL por defecto | No inventar plazo legal/comercial; solo completed/cancelled con fecha explícita vencida pueden eliminarse |
| Cookie chat | `CHAT_SESSION_SECONDS`, inicial 86400 | 24 h de identidad; expirar cookie no equivale a borrar inmediatamente todos los datos servidor |
| Estado mínimo de contexto | Expiración sesión + margen de siete días | Impedir reutilización de peticiones/contextos y cubrir máxima ventana de cuotas; si retención crea estado para un propietario histórico usa margen conservador de 30 + 7 días |
| Cuotas y leases | Expiración de su ventana/lease | Solo se limpian vencidos; nunca elimina contadores vigentes al borrar chat |
| Ficha mínima de visitante | 37 días de inactividad y ausencia de referencias | Máxima sesión de 30 días más margen de cuota de siete; conservada si tiene reservas u otros datos independientes |

Las páginas leen los mismos plazos configurados; la lectura de contexto excluye mensajes y perfiles fuera de su plazo aunque el mantenimiento esté retrasado. La retirada física del servidor depende de la ejecución del batch y su cola pendiente. No se promete un borrado físico al segundo exacto de vencimiento. No se inventa una obligación de conservar todas las reservas indefinidamente: NULL es un pendiente operativo del responsable, no una política terminada.

`POST /api/maintenance/retention` exige Bearer `RETENTION_CRON_SECRET` (64–128 caracteres hex aleatorios, solo servidor), política válida, configuración válida y RPC disponible. Historial, borrado y retención requieren solo la configuración de sesión y almacén; retirar la clave de IA no impide gestionar datos existentes. El POST de IA sigue fallando sin su clave. Devuelve únicamente contadores, con no-store; no expone datos ni acepta plazos arbitrarios desde la petición. Mantiene consultas por edad/ID con límites y bloqueo compatible con cuotas. Si existe un lease de chat vigente, el mantenimiento conserva el lote, devuelve `completed:false`, `deferred:true` y debe reintentarse en un intervalo libre; monitorizar backlog si el tráfico es continuo. Las filas de perfiles se bloquean y vuelven a comprobar antes de desvincularlas, y la eliminación de reservas revalida estado/fecha para proteger actualizaciones administrativas concurrentes. No lo invoca ningún cliente público ni se añadió automatización a la cuenta.

Procedimiento previsto, **no ejecutado**:

1. Revisar y respaldar esquema; aplicar v13 primero en una base de staging con datos ficticios después de v10–v12 y ejecutar las pruebas SQL. Comprobar reaplicación, privilegios anon/authenticated/service_role, FK, propietarios y comportamiento concurrente real.
2. Documentar la justificación de los plazos confirmados, configurar secretos/variables en la plataforma y completar bases jurídicas/contratos/políticas externas. Definir fechas de reservas finalizadas o canceladas atendiendo a su finalidad y obligaciones concretas; no asignarlas masivamente sin revisión.
3. Programar un job operativo del proyecto que realice **POST** autenticado al endpoint, desde una tarea de servidor o CI con secreto protegido. La llamada debe tener un timeout y registrar solo contadores/estado. Debe omitir `Origin`, `Cookie` y parámetros de URL, que el endpoint rechaza. El GET automático de un Vercel Cron no ejecuta este POST: usar un runner que soporte POST o adaptar un wrapper autenticado tras revisión. No poner el Bearer en la URL ni logs.
4. Empezar con batch 100; repetir un número máximo de batches acotado si hay backlog, controlar el tiempo total, y alertar si falla o crece la cola. Una ejecución diaria es una propuesta a evaluar según tráfico/plazo; no hay programación creada por este trabajo.
5. Verificar reglas reales de backups, expiración, restauración y procesado de solicitudes a proveedores. Una restauración debe reaplicar las supresiones pendientes antes de dar acceso a datos; fijar un procedimiento para este caso.

## Verificación y límites

Las pruebas locales utilizan identidad/datos A/B ficticios, red externa bloqueada y simulaciones explícitas de Supabase/IA/GTM/iframes. Resultados finales del 2 de octubre de 2026:

| Verificación | Resultado | Alcance |
| --- | --- | --- |
| Consentimiento (`test:privacy-consent`) | 67 comprobaciones correctas | Validación, caducidad, bloqueo de GTM/iframe y cargas externas |
| Consentimiento en navegador | 37 públicas / 36 panel correctas | Aceptar, rechazar, configurar, retirar, teclado y separación del panel; sincronización adicional en dos pestañas reales |
| Ciclo de vida (`test:chat-lifecycle`) | 11 grupos / 210 comprobaciones correctas | Handlers reales, datos A/B, CSRF, versiones, fence de leases, contexto caducado, endpoint y falta de clave IA; transacciones simuladas |
| Borrado en navegador (`dev:privacy-chat-test`) | 10 grupos / 97 comprobaciones correctas | ChatProvider/control reales; fallos, streaming, recarga, envío pendiente, DELETE retrasado y storage bloqueado; dos vistas simuladas y comprobación adicional con dos pestañas reales |
| Regresión de sesión en navegador | 11 grupos / 117 comprobaciones correctas | Renovación por 401, caducidad durante SSE, caché/identidad A/B, ninguna repetición del POST |
| Regresión de contrato/reservas en navegador | 7 grupos / 157 comprobaciones correctas | Propuesta, confirmación explícita, tarjeta autoritativa y limpieza asíncrona; todas las operaciones ficticias |
| Páginas legales Astro reales | Tres rutas 200; escritorio y móvil 390 × 844 correctos | Navegación, lectura, foco/teclado, tablas, sin scripts/fuentes/frames remotos |
| Regresiones de aplicación A01–A08 | Correctas | Panel 1676; límites 701; renderizado 13841; visitantes 350; reservas 293; seguridad Supabase 211; portfolio 315; contrato chat 1175; acciones 325; proveedor 99 |
| SQL de portfolio | 40 aserciones estáticas correctas | No ejecutan PostgreSQL |
| Tipos afectados | Correctos | Chat, ciclo de vida, privacidad, renderizado y proyectos; no constituye chequeo integral Astro |
| Compilación de producción aislada | Correcta | Integraciones vacías y red bloqueada; persiste salida Node 18 del adaptador |

Las cifras contabilizan aserciones de los fixtures, no vulnerabilidades distintas. A05 incluye inspección estática de SQL/ACL; no acredita permisos efectivos. Se preservan los errores previos del chequeo general: `chatRef` inexistente en `Chat.tsx`/`MobileChat.tsx`, y sintaxis TypeScript en `tailwind.config.mjs`. No se usa la compilación para ocultarlos.

Los scripts y fixtures se entregan para reproducir: `test:privacy-consent`, `test:chat-lifecycle`, `dev:privacy-consent-test`, `dev:privacy-chat-test`, `dev:legal-test`, `check:chat`, `check:privacy`, `check:chat-lifecycle`, `build:isolated` y las regresiones A01–A08. Evidencias locales: [privacidad escritorio](qa/a09/privacy-desktop.jpg), [cookies móvil](qa/a09/cookies-mobile.jpg), [aviso de consentimiento](qa/a09/consent-banner.jpg), [confirmación de borrado](qa/a09/chat-confirmation.jpg), [segunda pestaña](qa/a09/chat-second-tab.jpg) y [resultados de borrado](qa/a09/chat-tests.jpg).

La simulación demuestra el contrato de aplicación, no ejecuta PL/pgSQL ni acredita RLS, transacciones/locks, privilegios o planes efectivos de PostgreSQL. Se entregan pruebas SQL ficticias separadas para ejecutarlas en un entorno PostgreSQL adecuado. No se presenta su inspección estática como ejecución. Tampoco se verificaron contenedor GTM, routing IA, contratos, backups, cabeceras CDN ni operación programada real.

Pendientes de lanzamiento: revisión jurídica final del titular, justificación de plazos confirmados y política de reservas, inventario/contratos/transferencias/proveedores, SQL/RLS y concurrencia en PostgreSQL, Node soportado y plataforma, activación/observación del mantenimiento, revisión del contenedor antes de permitir GTM y pruebas de red en la plataforma. El desarrollo técnico local no cierra esos pendientes.
