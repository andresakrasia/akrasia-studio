# Renderizado seguro del chat y la actividad

Corrección de A03 de la auditoría del 2 de octubre de 2026. El chat interpreta Markdown mediante tokens y crea elementos React explícitos. El HTML recibido queda como texto escapado. Los feeds y logs crean nodos DOM y asignan su contenido mediante `textContent`; no pasan los datos de la API al parser HTML.

## Formatos permitidos

`src/components/FormattedText.tsx` usa una instancia privada del lexer de Marked. Permite párrafos, saltos, separadores, títulos de nivel 1 a 6, negrita, cursiva, tachado, código, citas, listas numeradas o con viñetas y tablas. Las listas de tareas usan símbolos de texto. Las imágenes Markdown muestran su texto alternativo sin solicitar recursos externos. El HTML bruto, incluidos scripts, SVG, MathML, iframes, estilos y atributos de eventos, se muestra literalmente.

Los elementos posibles son `div` como contenedor, `p`, `br`, `hr`, `h1`–`h6`, `strong`, `em`, `del`, `code`, `pre`, `blockquote`, `ul`, `ol`, `li`, `table`, `thead`, `tbody`, `tr`, `th`, `td` y `a`. Ningún nombre de elemento ni propiedad DOM procede directamente del contenido. Solo se asignan la clase del contenedor, clases de alineación de tabla elegidas entre constantes, un inicio numérico de lista y las propiedades de enlace descritas a continuación. Los tokens desconocidos vuelven a texto. El código conserva su contenido literal; el texto ordinario y los títulos de enlace decodifican entidades antes de que React los escape.

`src/lib/markdown-link.ts` permite enlaces absolutos HTTP y HTTPS válidos, `mailto:`, rutas locales con `/`, `./` o `../`, fragmentos `#` y consultas `?`. Rechaza protocolos ejecutables o desconocidos, URLs relativas a protocolo como `//`, credenciales incrustadas, controles, espacios sin codificar y barras inversas. Valida las entidades HTML y los controles codificados antes de permitir la navegación; un protocolo oculto por percent encoding no cumple ninguna forma permitida. Un enlace rechazado conserva su etiqueta como texto.

Los enlaces HTTP, HTTPS y `mailto:` llevan `target="_blank"`, `rel="noopener noreferrer"` y `referrerPolicy="no-referrer"`. Las rutas y fragmentos locales abren en la misma pestaña. `href` y `title` se asignan mediante propiedades React; las comillas del texto no crean atributos.

Cada actualización del streaming pasa de nuevo por esta frontera, incluyendo las etiquetas o enlaces todavía incompletos. El historial local de agente y el saludo recurrente con nombre, empresa o tema histórico también usan el componente. Los mensajes del usuario conservan la interpolación escapada original de React. Si el contenido supera 32768 unidades UTF-16, el lexer falla o el render supera 64 niveles, se conserva como texto escapado.

## Feeds y logs

`src/lib/activity-dom.ts` construye las filas de actualización mediante `createElement`, `createTextNode`, `append` y `textContent`. Trata como texto tanto `text` como `project_title` y la hora recibida. Los niveles y tipos eligen clases y etiquetas constantes; valores desconocidos usan el aspecto predeterminado. También acepta valores de texto inesperados como vacíos, sin convertir objetos en HTML.

`LeftPanel.astro` y `RightPanel.astro` usan estos helpers en su actualización periódica y conservan el orden, las animaciones y los límites de cinco entradas de feed y seis de log. Su render inicial usa el escape de Astro. Los usos de `innerHTML` de traducciones en `Layout.astro` e `I18nScript.astro` solo reciben diccionarios constantes internos; no se identificó contenido externo en esas rutas. La vista administrativa de conversaciones usa texto React escapado.

## Dependencias

Marked pasa de 18.0.0 a 18.0.14, dentro de la misma versión principal, e incorpora el arreglo del [aviso de recursión y agotamiento de memoria](https://github.com/markedjs/marked/security/advisories/GHSA-6v9c-7cg6-27q7), corregido desde 18.0.2. Se añade `entities` 8.1.0 como decodificador de entidades HTML. El lock conserva las versiones resueltas. Node local 24 es compatible; `entities` exige Node 20.19 o superior y Marked Node 20 o superior.

## Archivos de la corrección

- Aplicación: `src/components/FormattedText.tsx`, `LeftPanel.astro`, `RightPanel.astro`, `src/lib/markdown-link.ts` y `src/lib/activity-dom.ts`.
- Dependencias y comandos: `package.json` y `package-lock.json`. Se conservan las dependencias y scripts de los encargos anteriores.
- Pruebas: `scripts/test-safe-rendering.mjs`, `safe-rendering-cases.mjs`, `safe-rendering-browser.tsx`, `safe-rendering-test.html`, `serve-safe-rendering-test.mjs` y `tsconfig-rendering.json`.
- Guía: este documento. Evidencia del entorno sintético: [escritorio](evidence/A03-renderizado-escritorio.jpg) y [móvil](evidence/A03-renderizado-movil.jpg).

## Verificación reproducible

- `npm run test:rendering` carga los módulos de presentación sin configuración de Astro ni `.env`. Comprueba Markdown válido, destinos y atributos de enlaces, HTML y eventos, SVG y MathML, embeds, URLs peligrosas y ofuscadas, prefijos parciales, contenido histórico y construcción de filas de actividad. La regresión de tres bytes de Marked se ejecuta en un proceso con límite de tiempo.
- `npm run dev:rendering-test` sirve una interfaz sintética local en el puerto 4323 con los componentes reales del chat y los helpers DOM. Las respuestas de historial y SSE son simuladas. Permite verificar escritorio y móvil, texto de usuario, persistencia local, streaming y un enlace local funcional. Los resultados y el contador de ejecución se muestran en el documento.
- `npm run test:dashboard` y `npm run test:chat` repiten la regresión de A01, A08 y A02 con proveedores y almacenamiento sintéticos.
- `npm run check:rendering` revisa los tipos de los componentes y helpers afectados, incluyendo sus dependencias. `check:chat`, `check:types` y la compilación completan las comprobaciones del proyecto.

Las pruebas no necesitan claves reales ni efectúan llamadas de IA de pago, emails, Telegram, reservas o escrituras remotas. La compilación local se comprueba con un directorio de entorno vacío, telemetría desactivada y bloqueo de conexiones de proveedores en el proceso de build.

Validación realizada el 2 de octubre de 2026:

- Renderizado de servidor: 9 grupos, 13841 aserciones y 2411 prefijos parciales correctos. Incluye el proceso con límite de tiempo para el aviso de Marked.
- Navegador: 11 grupos, 2411 prefijos y 93 actualizaciones SSE observadas en la ejecución registrada; 0 ejecuciones maliciosas y 0 intentos de conexiones externas. El canario positivo ejecutó un evento inline, por lo que la prueba no oculta la ejecución de eventos mediante CSP. El saludo recurrente incorpora los datos históricos sintéticos reales del doble; los mensajes guardados y progresivos atraviesan los componentes reales. También se verificaron el envío por teclado en escritorio y el botón de envío en móvil de 390 por 844 píxeles.
- Regresión administrativa: 20 grupos y 1676 aserciones correctas. Chat: 31 grupos y 633 aserciones correctas; las 25 peticiones de la reproducción original admiten 20 y rechazan cinco.
- `check:rendering` y `check:chat` pasan. `check:types` mantiene exclusivamente los dos errores anteriores de `chatRef` en `Chat.tsx` y `MobileChat.tsx`; el chequeo global mantiene las dos construcciones TypeScript inválidas de `tailwind.config.mjs`. No se cambian esos archivos para ocultar sus errores.
- Build de producción correcto sobre el código final. Persisten los avisos de Browserslist y del adaptador Vercel sobre el destino Node 18.

El entorno de navegador necesita que Vite pueda leer las dependencias de Node. Se utilizó lectura ampliada para el optimizador en este dispositivo, manteniendo el directorio de entorno sin `.env` y el bloqueo de proveedores. El preview utiliza una caché de dependencias propia bajo `node_modules` y debe cerrarse al finalizar la comprobación.

## Límites pendientes

Esta protección no depende de una CSP. No se introduce una política global en esta corrección: los scripts actuales, GTM y sus permisos requieren una revisión específica antes de imponerla. La autorización del historial y su ciclo de vida, los datos públicos y los demás hallazgos de la auditoría conservan su alcance independiente.

El adaptador de Vercel sigue generando `nodejs18.x`, incompatible con estas dependencias y ya señalado antes de A03. Debe actualizarse y verificarse en la plataforma antes de desplegar. Las migraciones, RLS, variables, proxies, runtime y límites monetarios siguen pendientes de validación en los servicios reales según `ACCESO_ADMINISTRATIVO.md` y `LIMITES_CHAT.md`. Esta corrección no despliega ni aplica migraciones.
