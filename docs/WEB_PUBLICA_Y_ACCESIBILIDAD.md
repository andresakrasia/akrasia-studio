# Web pública, contenido y accesibilidad

## Alcance de esta corrección

Este trabajo aborda A28–A36 del informe de producción y elimina los usos antiguos de `chatRef` de A39. Conserva las sesiones, los límites, Markdown seguro, consentimiento, borrado y publicación de A01–A10. El catálogo de servicios y los casos editoriales usan el contrato público único de A20; sus cambios de esquema se documentan en la guía del panel y las migraciones correspondientes.

La revisión visual del 2 de octubre restituye la interfaz HUD anterior: composición 2/7/3, logo neón escalonado, radar central, paneles compactos y tipografías Space Grotesk/JetBrains Mono. Las mejoras funcionales preservan este diseño de referencia; un rediseño requiere un encargo explícito. Las fuentes se sirven desde `public/fonts`, con licencias OFL y sin peticiones a Google. Se mantienen el contenido aprobado, el estado vacío honesto, SSR, enlaces reales, consentimiento y movimiento reducido.

En esta restitución se repiten las 238 comprobaciones SSR, 13.841 de representación segura, 67 de cookies, la revisión de 115 plantillas/archivos sin diagnósticos, los tipos generales y la compilación aislada. Se comprueban visualmente escritorio, móvil e interfaz ES/EN, sin desbordamiento horizontal, y el chat a 640×320 con desplazamiento, foco y regreso con Escape. El botón del chat incrustado permanece montado y recupera el foco después de volver a estar visible. [Captura del diseño recuperado](evidence/ui-hud-restaurada.png).

La restitución del chat conserva el radar y el HUD en escritorio, burbujas con transparencia, tipografía compacta y compositor de una línea que crece hasta 84 px. La privacidad tiene un aviso visible de IA/proveedores, contacto directo y desplegable con información completa y borrado confirmado; su estado permanece visible fuera del desplegable. Una reserva sin propuesta no genera tarjeta. Se repiten cinco regresiones (16.170 comprobaciones), tipos y compilación. El fixture de privacidad abre el desplegable y conserva las aserciones anteriores; también verifica su cierre durante la confirmación: [10 grupos/116 comprobaciones correctas](evidence/chat-ui-privacy-browser.json). La revisión manual incluye foco, Escape, cancelación sin borrado, texto multilínea, transparencia y scroll a 640×320. [Vista del chat recuperado](evidence/chat-ui-restaurada.png). No se consumen proveedores ni se borran datos reales.

El recorrido principal sigue siendo el chat. Cabecera, servicios, proyectos y accesos móviles abren mensajes predefinidos. El chat incorpora accesos a servicios, proyectos, contacto y manifiesto; los enlaces de sus respuestas cargan la siguiente ficha en la misma conversación. Las respuestas deterministas del servidor consultan exclusivamente los catálogos públicos actuales después de verificar sesión, cuotas y contexto. No consumen IA. El texto libre conserva el proveedor de IA configurado y las mismas protecciones. La ampliación SEO del 4 de octubre añade páginas públicas de lectura en las rutas de servicios, proyectos y contacto, con enlaces propios y CTA al chat. Las páginas legales permanecen accesibles por separado. [SEO y activación de Google](SEO_Y_ANALITICA.md).

| Hallazgo | Corrección local | Verificación pendiente |
| --- | --- | --- |
| A28 | El JSON histórico de proyectos ficticios no actúa como fuente pública. Los JSON de servicios preparan la oferta editorial confirmada por el titular; tampoco son un fallback ante retiradas o fallos. El HUD y el chat muestran únicamente contenido aprobado de la base de datos. | El titular debe aportar trabajos reales, derechos y evidencia de resultados antes de aprobar cada caso. La DEMO autorizada del 3 de octubre vive únicamente en el fixture de vista previa local. |
| A29 | El chat se abre incrustado en el HUD de escritorio y en un diálogo en móvil. Servicios, proyectos, manifiesto y contacto envían mensajes predefinidos y devuelven la información dentro de la conversación. | Resta la revisión completa con lectores de pantalla. |
| A30 | Cabecera y tarjetas conservan los accesos al chat; el pie añade enlaces de lectura pública para SEO. Los catálogos y sus detalles se resuelven sin IA de pago. El contacto directo por email sigue accesible con el chat caído, y su respuesta incluye el teléfono confirmado. | Comprobar recepción del correo y teléfono con el titular. Las pruebas no enviaron comunicaciones. |
| A31 | Se retira el HUD de actividad interna, horas inventadas y estados «online». Solo se cuenta el portfolio público aprobado; los fallos muestran indisponibilidad. Las API de feed/logs siguen vacías por su falta de autorización editorial. | Decidir y aportar una fuente de novedades públicas si se necesita en el futuro. |
| A32 | Una cabecera principal h1, destinos de salto, enlaces/botones semánticos, campos etiquetados, estado de respuesta anunciado y diálogos nativos con foco. Las respuestas parciales no se anuncian en cada token. | Prueba manual con lector de pantalla y distintos navegadores, además del recorrido de teclado. |
| A33 | El contenido y las acciones principales usan tamaños legibles, colores contrastados, navegación que envuelve y contenido desplazable. La preferencia de movimiento reducido desactiva animaciones y transiciones. | Revisión visual a 200–400 %, orientación horizontal y dispositivos físicos. No se afirma conformidad WCAG completa a partir de estas pruebas. |
| A34 | Se elimina el loader opaco. El servidor entrega HUD, accesos, servicios y piezas aprobadas antes de ejecutar scripts. El recorrido conversacional necesita JavaScript; email y legales permanecen disponibles sin él. Sin JavaScript también aparece la información de cookies en el flujo normal. | Validación del recorrido en navegador con scripts desactivados. |
| A35 | El idioma lo decide exclusivamente la URL: español por defecto y `?lang=en` para la interfaz inglesa. Metadatos y canonical/hreflang coinciden. Sitemap incorpora páginas públicas y fichas editoriales aprobadas; consulta únicamente catálogos públicos. OG PNG local 1200×630 y favicon SVG válido. | Activar Search Console y verificar indexación. Las variantes inglesas de fichas requieren traducción completa; legales solo tienen variante española. |
| A36 | Fondo local WebP, vídeo diferido hasta uso/consentimiento, fuentes e iconos locales, ningún polling de actividad y portfolio cada 30 s solo con página visible. El observador de iconos inspecciona nodos nuevos en vez de recorrer todo el documento en cada token. | Core Web Vitals, Lighthouse y coste de renderizado en dispositivos/red reales; no se han medido ni prometido puntuaciones. |

## Materiales necesarios para un portfolio real

Antes de aprobar un proyecto, guardar la autorización de publicación, créditos y derechos del vídeo, música e imágenes. El texto editorial debe describir el encargo, proceso y resultado realmente comprobados. Las cifras de rendimiento, premios, clientes, presupuesto o tiempos necesitan su evidencia y permiso de comunicación.

Subir una miniatura raster mediante el panel protegido y aportar una pieza autorizada. Los accesos al proyecto abren su información dentro del chat; el visitante puede abrir la pieza externa mediante un enlace explícito. No se incrustan vídeos ni se cargan imágenes externas automáticamente en las respuestas. Un fallo de API no restaura demos.

No se han cambiado los datos remotos existentes ni se han eliminado proyectos reales. Los seeds históricos se gestionan dentro de A40, separados del contenido comercial.

## Idioma, SEO y contacto

El parámetro `lang=en` representa una variante estable de URL. No se sobreescribe con `Accept-Language`, navegador ni una preferencia local antigua. El selector de idioma es un enlace normal, que funciona sin JavaScript y recarga la misma ruta. Se eliminan parámetros ajenos del canonical.

Las variantes de la portada tienen referencias hreflang recíprocas. Las páginas legales conservan español y no anuncian una traducción inexistente. El chat obtiene textos de las columnas públicas ES/EN e indica si falta una traducción. Las páginas de lectura y el sitemap aplican las mismas reglas de publicación y traducción. Ante una caída del catálogo, el sitemap responde 503 para evitar un documento parcial; las páginas legales siguen disponibles.

El canal humano confirmado en A09 es `info@akrasia.studio` y `+34 637 26 40 41`. El chat ofrece estos datos y permite desarrollar un brief o dejar contacto voluntariamente. No se promete un plazo de respuesta no acordado ni se confirma una reserva por la prosa del modelo.

## Evidencia local reproducible

Ejecutar con Node soportado e integraciones vacías:

```text
node scripts/test-public-web.mjs
node scripts/test-chat-navigation.mjs
node scripts/test-predefined-chat.mjs
node scripts/test-project-publication.mjs
node scripts/test-safe-rendering.mjs
node scripts/test-privacy-consent.mjs
node node_modules/typescript/bin/tsc --noEmit --project scripts/tsconfig-src.json
```

Resultados de la restitución conversacional: web SSR 6 grupos/202 comprobaciones; navegación 227; respuestas predefinidas 6/200; A06 8/328; cinco regresiones de servidor 83/2449; representación segura 13.841 y resultados de reservas 1893. Tipos generales correctos y revisión Astro de 117 archivos sin diagnósticos. El recorrido manual verifica escritorio/móvil, servicios, proyectos, contacto, manifiesto, CTA, idioma inglés, entrada desde ruta antigua y ausencia de reenvío al recargar. [Resultados](evidence/chat-navigation-local.json) y [captura](evidence/chat-como-navegacion.png).

Las pruebas verifican h1, lenguaje, canonical/hreflang, navegación conversacional, contacto, publicación de servicios/casos, retirada, estados vacíos/fallos, sitemap, ausencia de canarios privados, cuotas denegadas sin consulta de catálogos y assets decodificables. No equivalen a pruebas SQL, Storage/CDN desplegado o conformidad integral de accesibilidad.

Restitución funcional del 3 de octubre: catálogo de seis servicios ES/EN, proyecto DEMO autorizado únicamente en la vista previa y ventanas de actividad editorial del estudio. Los textos internos permanecen privados; v19 añade campos públicos separados y una aprobación independiente. Las entradas conservan la fecha del acontecimiento. El ambiente se identifica como interfaz visual y no acredita renders, entregas o disponibilidad. El movimiento reducido detiene las animaciones; «Pausar actividad» detiene rotación y novedades visuales. Se siguen revalidando permisos para quitar contenido retirado incluso durante la pausa. [Catálogo y preview](CATALOGO_SERVICIOS.md), [Actividad y migración](ACTIVIDAD_PUBLICA_ESTUDIO.md).

La compilación aislada final pasa y verifica Node 24, duración de 60 s y streaming del adaptador. Para evitar fallos locales sobre archivos generados anteriores, el comprobador usa un directorio de salida nuevo bajo `.codex-tmp`; conserva el resto de la configuración de producción y la validación de la salida Vercel. La entrada pública `chat` se consume después de abrir la conversación, para que recargar no reenvíe un turno.

El coordinador comprobó en navegador los CTA y el chat de fichas interiores en escritorio y móvil, con foco, cierre, regreso mediante Escape, navegación inglesa y ausencia de desbordamiento horizontal. También verificó un viewport efectivo de 640×320: el chat permite desplazarse hasta el campo de entrada y Escape devuelve el foco al disparador. [Registro manual del panel y web](evidence/panel-browser-local.json). Se mantiene la revisión manual con lectores de pantalla, zoom extremo y dispositivos físicos; estos resultados no acreditan conformidad integral WCAG.

La vista local `node scripts/serve-public-web-test.mjs` sirve datos ficticios en `http://localhost:4332`. Rutas: `/servicios/public-service`, `/proyectos/a06-planning-public`, `/contacto`, portada y variantes `?lang=en`. Se bloquea la red ajena al entorno sintético y la IA está deshabilitada, para comprobar también el contacto alternativo.

Revisión de navegador: desde cada página activar un CTA, comprobar que el chat es visible, que recibe el foco y que Escape vuelve al disparador; probar Tab/Mayús+Tab en diálogos, cambio de viewport, borrado y consentimiento. Repetir con JavaScript desactivado, movimiento reducido, zoom y móvil. No abrir servicios externos ni enviar correos o reservas reales durante esta prueba.

## Medidas de recursos

| Recurso | Antes | Ahora |
| --- | --- | --- |
| Fondo servido | JPG de 602.922 bytes | WebP de 59.362 bytes, reducción del 90,15 % |
| Imagen social | Ruta sin archivo | PNG local de 60.262 bytes, 1200×630 |
| Fuentes/iconos | Fuentes de sistema e iconos locales | Tipografías originales autoalojadas (62.692 bytes, WOFF2 variable), licencias OFL e iconos locales; observador acotado |
| Feed/logs | Actividad interna retirada por A06 | Sin peticiones periódicas ni datos ficticios |
| Portfolio | Revalidación de aprobación | 30 s, pausada en segundo plano, con timeout de 6 s y retirada ante fallo |

La imagen social es una composición tipográfica de marca, sin trabajo audiovisual o clientes simulados. Se inspeccionó visualmente el PNG generado. `scripts/build-public-assets.mjs` permite regenerar estos archivos desde el JPG local y el SVG de marca. La reducción del peso del fondo no prueba por sí sola una mejora concreta de LCP/INP/CLS.

## Límites operativos

Aprobación y retirada dependen del servidor y de las migraciones aplicadas. Las respuestas públicas mantienen `no-store`, también para CDN, siguiendo A06; no se amplía la caché del contenido retirado para ganar rendimiento. No se puede retirar información que un tercero ya haya copiado.

No se ha desplegado, usado IA de pago, realizado reservas reales ni cambiado servicios remotos. La acreditación del portfolio, traducciones, SEO real, correo, SQL, CDN y revisión manual de accesibilidad siguen pendientes según el procedimiento de lanzamiento.

