# SEO y analítica de Akrasia Studio

La portada mantiene el chat como recorrido principal. Los servicios y proyectos publicados tienen además páginas de lectura con enlaces al chat. Esta estructura permite llegar desde una búsqueda a contenido público concreto y continuar la conversación con el estudio. La preparación del repositorio no acredita conexión a cuentas de Google ni indexación real.

## Páginas que puede descubrir Google

La web entrega contenido público en HTML desde el servidor: portada, `/servicios`, fichas de servicio, `/proyectos`, casos de proyecto y `/contacto`. Las fichas aprovechan exclusivamente el catálogo aprobado del panel. Los borradores, mensajes privados y datos de clientes quedan fuera de estas páginas y del sitemap.

Las fichas con información editorial insuficiente llevan `noindex` y quedan fuera del sitemap hasta completar su contenido. Una retirada devuelve 404. Un fallo de almacenamiento devuelve 503 en las páginas afectadas y en el sitemap para evitar presentar un fallo como catálogo vacío. Las variantes inglesas de fichas se anuncian solo si existe traducción editorial completa. Las páginas legales permanecen en español.

Los enlaces de lectura permiten descubrir las páginas desde la portada y entre listados y fichas. Las URLs del chat siguen usando `?chat=…`; su canonical apunta a la portada del idioma correspondiente para evitar duplicados. Google recomienda enlaces HTML con destino real y contenido disponible desde el servidor para aplicaciones con JavaScript. [Documentación de enlaces](https://developers.google.com/search/docs/crawling-indexing/links-crawlable) y [SEO con JavaScript](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics).

## Conectar Search Console

Search Console sirve para revisar búsquedas, clics, impresiones y problemas de indexación. La verificación acredita control sobre el sitio; no instala analítica de visitantes.

1. Abre [Search Console](https://search.google.com/search-console) con la cuenta que deba ser propietaria.
2. Añade la propiedad de dominio `akrasia.studio`. Copia el registro TXT que Google genere y añádelo en el proveedor DNS. Conserva ese registro después de verificar.
3. Si prefieres verificar únicamente `https://akrasia.studio/`, añade una propiedad de prefijo de URL y elige «Etiqueta HTML». Copia solo el valor de `content` a `PUBLIC_GOOGLE_SITE_VERIFICATION`; la web genera la etiqueta en la cabecera pública.
4. Publica la versión preparada y comprueba que `https://akrasia.studio/sitemap.xml` devuelve XML válido con estado 200. Envía `sitemap.xml` desde la propiedad verificada.
5. Inspecciona portada y las fichas prioritarias. Comprueba contenido renderizado y canonical y solicita indexación cuando estén listos.

Los métodos disponibles y sus requisitos se describen en la [verificación de propiedad de Google](https://support.google.com/webmasters/answer/9008080?hl=es). El sitemap ayuda a descubrir URLs, pero no garantiza que Google las indexe ni que alcancen una posición determinada. [Guía de sitemaps](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap?hl=es).

## Conectar Google Analytics 4

GA4 mide la actividad de visitantes que permiten analítica. Para este sitio se recomienda la integración directa ya preparada; Tag Manager sigue disponible para un contenedor previamente revisado.

1. En [Google Analytics](https://analytics.google.com/) crea o selecciona la propiedad de Akrasia Studio. Configura zona horaria de Madrid y moneda EUR.
2. Añade un flujo web para `https://akrasia.studio` y copia su ID de medición `G-…`.
3. Desactiva la medición mejorada del flujo. La web envía las vistas y acciones explícitamente; las mediciones automáticas podrían duplicarlas o recoger URLs y campos no previstos.
4. Configura el ID real en `PUBLIC_GA4_MEASUREMENT_ID` y, después de revisar el flujo y la información de privacidad, activa `PUBLIC_GA4_REVIEWED=true`. Publica una versión nueva: las variables públicas forman parte de la compilación.
5. Permite analítica en una sesión de prueba y comprueba los eventos en el informe en tiempo real. Repítelo rechazando y retirando el permiso.

Google documenta la [creación de propiedades y flujos](https://support.google.com/analytics/answer/9304153?hl=es). Desactivar el envío inicial de vistas en código no evita las vistas automáticas de cambios de historial si la medición mejorada permanece activa. [Medición de vistas](https://developers.google.com/analytics/devguides/collection/ga4/views?hl=es).

## Eventos y privacidad

| Evento directo GA4 | Cuándo se registra |
| --- | --- |
| `page_view` | Al cargar una página pública y permitir analítica |
| `chat_start` | Al iniciar una interacción válida con el chat, una vez por carga |
| `booking_confirmed` | Tras recibir una confirmación válida de reserva del servidor |

La integración no envía textos, nombres, correo, identificadores de visitantes o reservas. Limpia las URLs de consulta y fragmentos, conservando únicamente el idioma, y usa un título fijo de marca y referencia vacía. Esta decisión limita la atribución de campañas y referencias. Se desactivan señales de Google y personalización publicitaria en GA4 directo. La configuración se basa en los [campos oficiales de GA4](https://developers.google.com/analytics/devguides/collection/ga4/reference/config).

No se emite `generate_lead`: la interfaz actual no dispone de una señal pública inequívoca de contacto persistido. Una apertura del chat o un clic en correo no cuentan como contacto enviado. Puedes marcar `booking_confirmed` como evento clave en GA4 después de comprobarlo.

Antes de aceptar no se cargan etiquetas de Google ni se guardan eventos para enviarlos después. Retirar o caducar el permiso detiene las mediciones y recarga la página para detener código remoto ya ejecutado. El panel administrativo queda excluido. El rechazo no impide usar el chat.

Si eliges GTM, configura `PUBLIC_GTM_CONTAINER_ID` con tu contenedor real y `PUBLIC_GTM_CONTAINER_REVIEWED=true`. Mantén `PUBLIC_GA4_REVIEWED=false`. El contenedor debe mapear `akrasia_page_view`, `akrasia_chat_start` y `akrasia_booking_confirmed` a sus eventos GA4 usando únicamente los parámetros saneados de esos eventos; desactiva recogida automática, publicidad y etiquetas que lean conversaciones. GA4 directo tiene prioridad si ambos modos están revisados y su ID es válido. Un ID directo inválido con su revisión activada bloquea la carga.

## Contenido que ayuda a posicionar

Completa cada servicio con el trabajo que se ofrece, entregables, proceso y diferencias comprobables. Para los proyectos, publica el encargo, el proceso y el resultado con imágenes y créditos autorizados. Usa títulos y descripciones que respondan a búsquedas pertinentes como producción audiovisual con IA, dirección creativa, VFX o postproducción, según la oferta real. Añadir palabras clave sin contenido útil no sustituye estas explicaciones.

La implementación no crea propiedades de Google, modifica DNS, publica la web ni solicita indexación por sí misma. Esas acciones requieren las cuentas del titular y el destino de producción.

## Validación local

Comprobado el 4 de octubre de 2026 con Node 24: 430 aserciones de páginas y sitemap, 166 de navegación, 80 de analítica, 67 de consentimiento, 131 de configuración, 218 de ciclo de privacidad y 1893 del contrato de confirmación de reservas. Tipos y revisión Astro sin diagnósticos; compilación del adaptador Vercel correcta. La compilación conserva un aviso de tamaño de algunos paquetes cliente; no se han medido Core Web Vitals sobre producción.

Se revisaron en navegador contacto y ficha inglesa, lectura en escritorio y vista estrecha sin desbordamiento, y la opción de analítica desactivada. Los datos de catálogo de esta revisión son ficticios y locales. No se ha repetido la batería completa de producción ni se ha contactado con Google Analytics desde las pruebas. [Registro de verificación](evidence/seo-analytics-local.json).
