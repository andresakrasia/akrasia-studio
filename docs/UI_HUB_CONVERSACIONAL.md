# Hub conversacional de Akrasia

Implementación local del diseño aprobado y sus ajustes del 3 de octubre de 2026. El escritorio presenta ahora un hub más compacto: cabecera baja, texto contenido, más espacio para la conversación y detalles HUD de líneas finas, esquinas y un dial decorativo. La cabecera y los paneles comparten cristal translúcido, con marcos angulares dobles y segmentos luminosos cian; los interiores y los respaldos conservan la simplificación que libera espacio de lectura. El hub abre directamente la conversación, sin el bloque inicial «¿Qué quieres crear?» ni sus tres botones. El logo original conserva sus siete caracteres, proporciones y tiempos de iluminación, con color y halo cian y picos de luz en cian hielo. El núcleo holográfico permanece en el fondo con un emblema más tenue y se extiende hacia los márgenes mediante circuitos, anillos y puntos de luz. El móvil conserva sus tamaños de lectura y controles. Las secciones de iteraciones anteriores registran su aspecto y verificaciones de aquel momento; el último apartado describe el diseño actual.

## Funcionamiento

La ampliación del 4 de octubre conserva estos accesos conversacionales y añade páginas públicas de lectura en servicios, proyectos y contacto, enlazadas desde el pie. Estas páginas permiten entrar desde buscadores y continuar en el chat. El sitemap sigue las reglas de aprobación y traducción del catálogo. Las cuentas de Google y la indexación efectiva permanecen pendientes de activación. [SEO y analítica](SEO_Y_ANALITICA.md).

- Servicios, proyectos y contacto envían la pregunta correspondiente del visitante y muestran la respuesta dentro del mismo chat. Los enlaces de las seis fichas, los trabajos y la actividad pública utilizan el mismo mecanismo.
- El chat mantiene una sola instancia al cambiar entre escritorio y móvil. Conserva el borrador y el historial de la sesión. Enter envía; Mayús + Enter introduce una nueva línea.
- Los trabajos aparecen como tarjetas dentro de las respuestas del catálogo. La descripción completa sigue disponible en un desplegable; el texto de IA conserva el renderizador seguro existente.
- Las tarjetas consultan exclusivamente el contrato público de proyectos. Se actualizan cada 30 segundos y al volver a la pestaña; las retiradas y los errores eliminan los resultados. No usan contenido del modelo como autorización ni recuperan un portfolio alternativo.
- «Quiero algo así» envía un mensaje sobre el proyecto a la conversación. La reproducción se ofrece solo cuando hay un vídeo publicado y pasa por el control de consentimiento existente. Una imagen de demostración no simula un vídeo terminado.
- Las propuestas de reunión siguen requiriendo revisión y confirmación explícita. Permanecen los controles de sesión, cuotas, privacidad y borrado.
- Los paneles laterales pueden desplazarse en escritorios bajos. En móvil la conversación aparece antes que los paneles informativos, con la escritura visible en la primera pantalla. Se mantienen el foco por teclado, los anuncios accesibles y la preferencia de movimiento reducido.

## Proyecto de demostración y fotograma

DEMO · ORIGEN solo se añade en la vista previa local de demostración. Es una pieza conceptual ficticia de 20 segundos; no representa un cliente, un encargo ni una película entregada. El fotograma no se inserta en la base de datos real ni se publica como trabajo del estudio.

Fotograma final: [demo-origen.webp](<C:/Users/anfeg/Carpeta DIGI storage/∆KR∆SI∆/∆KR∆SI∆/AKRASIA/Web Akrasia.studio/public/img/demo-origen.webp>). Tamaño: 101.790 bytes. Se utilizó la herramienta integrada imagegen para reconstruir la fotografía a partir del mockup aprobado; después se convirtió a WebP para servirla desde el proyecto.

Prompt final utilizado:

> Extract and reconstruct ONLY the large central cinematic film still from the Akrasia UI mockup into a standalone 16:9 thumbnail. Preserve the fictional woman's identity, side profile, hair and dark costume, facing right, with amber side lighting, studio windows, deep shadows and softly visible crew. Remove all website UI, borders, text, logos, badges, play controls, timers and buttons. Only the photograph; no watermark and no real client claim.

## Verificación local

Compilación aislada correcta con Node 24, funciones de 60 segundos y streaming. Los tipos del código fuente pasan. La suite nueva de tarjetas pasa 6 grupos y 76 aserciones: campos públicos, límites, medios, retiradas, fallos, cancelación y renderizado literal. Está incorporada al verificador general para futuras ejecuciones; no se ha repetido toda la batería de producción para este cambio visual.

Regresiones focalizadas correctas: navegación (227 comprobaciones), respuestas predefinidas (6 grupos/200), catálogo de servicios (114), renderizador seguro (13.841 aserciones y 2.411 prefijos de streaming), acciones del cliente (1.893) y contrato del chat (24 grupos/1.208).

En navegador se verificaron escritorio de 1.600 × 900, móvil de 390 × 844 y ventana baja de 1.280 × 642. Comprobados el logo, una sola conversación y caja de escritura, ausencia de desbordamiento horizontal, preguntas únicas de los menús, ficha de dirección creativa, menú móvil de proyectos, conservación del borrador al redimensionar, teclado, restauración del historial, lectura del inicio y del final y acceso al panel de privacidad.

La vista previa queda disponible en http://localhost:4322/. Las comprobaciones de esta interfaz usaron respuestas predefinidas y datos locales ficticios; no consumieron IA ni crearon reservas, notificaciones o datos remotos. El proveedor real sigue disponible para las consultas que el titular escriba en esta vista previa. No hubo despliegue.

Capturas reales: [escritorio](evidence/ui-hub-desktop.jpg), [proyecto en el chat](evidence/ui-hub-project-chat.jpg), [móvil](evidence/ui-hub-mobile.jpg).

## Iteración del núcleo holográfico

El segundo ajuste del 3 de octubre responde a la petición de un hub más tecnológico y vivo. Conserva el logo original y la navegación por preguntas del chat. Añade azul nocturno, cian y violeta, marcos de instrumentos con profundidad, luces suaves, retícula ambiental y un núcleo holográfico visible durante la conversación. Los indicadores expresan el estado de la consulta; no simulan métricas de máquinas, agentes o trabajos en ejecución.

`StudioCore` proyecta una esfera tridimensional con malla, 36 nodos y tres órbitas. Usa Canvas 2D y un SVG decorativo, sin bibliotecas ni peticiones nuevas. Tiene 792 puntos fijos, un máximo de 30 dibujos por segundo, DPR limitado a 2 y una superficie máxima de 600 × 600 píxeles. Las fases dependen de `isTyping` y del texto de streaming: reposo, procesamiento y respuesta. El efecto gráfico se mantiene entre fragmentos de la respuesta.

El nuevo control de pausa utiliza la preferencia existente del hub. Detiene el núcleo y las animaciones decorativas; las consultas y la actualización de información pública siguen funcionando. La preferencia de movimiento reducido, la pestaña oculta y el núcleo fuera de pantalla también detienen el bucle. Se retiran observadores, eventos y frames al desmontarlo. El gráfico no captura foco ni eventos y queda excluido del árbol accesible. La entrada del contenido no depende de una animación que lo pueda dejar invisible, y las respuestas permanecen visibles cuando se pausa el movimiento.

En móvil se reducen las dimensiones del núcleo y se omiten los tres accesos iniciales redundantes; los menús del chat siguen disponibles. En ventanas de escritorio bajas se compacta la cabecera holográfica para conservar espacio de lectura. Se mantiene una conversación y una caja de escritura al cambiar de tamaño, con el borrador intacto.

Validación de esta iteración: tipos del código fuente correctos; compilación aislada correcta con Node 24 y streaming; actividad HUD (4 grupos/35 comprobaciones), navegación (227), tarjetas públicas (6 grupos/76) y acciones del cliente (1.893) correctas. Revisión independiente del núcleo, renderizado del servidor y limpieza de sus recursos correctos. No se repitió toda la batería de producción.

En navegador: 1.600 × 900, 390 × 844 y 1.280 × 642 sin desbordamiento horizontal; núcleo único, caja de escritura única, borrador conservado y menús de contacto, servicios y proyectos dentro de la misma página. Se observó el estado de respuesta durante streaming. Pausa y reanudación verificadas, incluyendo una respuesta nueva visible con el movimiento pausado. En la ventana baja queda espacio de lectura y la escritura permanece visible; el aviso inferior admite desplazamiento de la página. La reducción de movimiento se revisó en código, sin emular la preferencia del sistema en el navegador.

Las verificaciones usaron consultas predefinidas y datos ficticios locales, sin llamadas de IA, reservas, notificaciones ni cambios remotos. La vista previa permanece en http://localhost:4322/ y conserva el proveedor real para las consultas que escriba el titular. No hubo despliegue.

Capturas de esta iteración: [escritorio](evidence/ui-hub-neon-desktop.jpg), [móvil](evidence/ui-hub-neon-mobile.jpg). Registro: [verificación](evidence/ui-hub-neon-local.json).

## Núcleo de fondo y paneles de cristal

La siguiente petición traslada el núcleo al fondo de toda la página y refuerza el cristal, los bordes luminosos y la profundidad del menú. Se mantiene un único `StudioCore`, ahora mediante un portal estable al fondo fijo de la página. Se elimina el gráfico de la introducción del chat; el mismo estado de procesamiento, respuesta y pausa sigue llegando al núcleo. El fondo no captura eventos ni aparece en el árbol accesible. La cabecera, los paneles, la conversación y el pie quedan encima; los diálogos conservan su capa superior.

La variante grande usa un diámetro responsive de hasta 1.000 píxeles. Su escala interna es uniforme y el bitmap se limita a 1.600 × 1.600, con DPR adaptativo de hasta 2. Conserva 792 puntos fijos, el máximo de 30 dibujos por segundo y la detención por pausa, preferencia de movimiento reducido, pestaña oculta y salida de pantalla. El buffer RGBA de tamaño máximo ocupa aproximadamente 10,24 MB; esta cifra no incluye los buffers del navegador y no constituye una medición de rendimiento del dispositivo.

Los paneles principales usan fondos translúcidos y desenfoque. En el chat se limita a 1,5 píxeles (1,25 en móvil) para que la malla siga siendo reconocible; los laterales usan 8 píxeles, con un fondo más opaco cuando el navegador no admite el efecto. No se añade desenfoque a cada fila de servicios ni se transforma el cuerpo o el contenido principal.

Los bordes de los bloques tienen una luz que recorre el marco al pasar el cursor o enfocar sus controles. El menú de servicios usa perspectiva: la fila elegida sale 24 píxeles hacia delante y crece ligeramente; las anteriores suben 6 píxeles y las siguientes bajan 6. Son transformaciones visuales, sin redistribuir el contenido. Un margen interior reserva espacio y las columnas conservan su desplazamiento vertical. El efecto tiene acceso por teclado, queda estático en dispositivos táctiles y se desactiva con movimiento reducido o pausa.

Los siete caracteres del logo mantienen su estructura y estilos inline de tamaño, separación, duración y retraso. Se armonizan la iluminación y el subtítulo con cian, azul y violeta. La pausa sigue deteniendo también la iluminación del logo.

Verificación: tipos fuente y compilación aislada correctos con Node 24, 60 segundos y streaming; navegación (227 comprobaciones), actividad HUD (4 grupos/35) y tarjetas públicas (6 grupos/76) correctas. El núcleo pasa renderizado de servidor en sus dos variantes y tres fases; revisión independiente de la integración sin fallos materiales. No se repitió la batería completa de producción.

En navegador se comprobaron 1.600 × 900, 390 × 844 y 1.280 × 642: sin desbordamiento horizontal, una sola conversación, un solo núcleo de fondo y una sola caja de escritura. Se verificaron el borrador entre tamaños, la proyección de servicios con ratón y teclado, los desplazamientos de sus vecinos, los siete caracteres y tiempos del logo, el estado de respuesta y la pausa con una respuesta nueva visible. En la ventana baja quedan 214 píxeles de lectura y la escritura visible. Movimiento reducido y comportamiento táctil se revisaron en código; no se emularon las preferencias del sistema ni un dispositivo táctil real.

La prueba de conversación usó una respuesta predefinida de dirección creativa y datos ficticios locales. Sin consumo de IA, cambios remotos, reservas, notificaciones ni despliegue. La vista previa permanece en http://localhost:4322/.

Capturas de esa iteración: [escritorio](evidence/ui-hub-glass-desktop.jpg), [profundidad del menú](evidence/ui-hub-glass-services-depth.jpg), [móvil](evidence/ui-hub-glass-mobile.jpg). Registro: [verificación](evidence/ui-hub-glass-local.json).

## Pantallas por capas y paleta azul

El ajuste actual separa las pantallas mediante respaldos desplazados, sombras, marcos y pequeños solapamientos. Cada columna tiene dos planos de respaldo que no capturan eventos, seguidos por su pantalla principal. La conversación ocupa el plano frontal; las pantallas laterales tienen alturas visuales diferentes. Dentro del chat se distinguen la cabecera elevada, el plano de lectura, las tarjetas y la bandeja de escritura. La ficha del portfolio adelanta su información sobre el borde inferior del fotograma. El cuerpo y el contenido principal mantienen `transform: none`; la página no se inclina como un objeto.

La nueva hoja `studio-screen-depth.css` se aplica únicamente a la portada. Conserva el desplazamiento de las columnas, los focos, el menú de servicios con perspectiva y los controles existentes. No añade bucles de animación, desenfoques ni dependencias. El compositor conserva `z-index: auto` para permitir que el desplegable de privacidad comparta la capa del chat y quede por encima del acceso a los últimos mensajes. Sus respaldos tienen `pointer-events: none`. En móvil se reducen los desplazamientos y márgenes de las capas para mantener la escritura visible.

Se sustituyen los tonos violetas del logo, las luces, los bordes, el ambiente y el núcleo por azules. La malla, los nodos, las órbitas y el emblema usan la misma familia cromática. Los siete caracteres del logo mantienen tamaños, separación, retrasos y duración; cambia su iluminación. Los colores propios de los fotogramas de los proyectos se conservan. No cambian la geometría del núcleo, sus límites de dibujo ni su limpieza de recursos.

Tipos fuente y compilación aislada correctos con Node 24, funciones de 60 segundos y streaming. Regresiones focalizadas correctas: navegación (227 comprobaciones), actividad HUD (4 grupos/35) y tarjetas públicas (6 grupos/76). La revisión independiente de colores y capas no detecta problemas materiales; el núcleo pasa las seis combinaciones de renderizado del servidor (dos variantes y tres fases). No se repite la batería completa de producción para este ajuste visual.

En navegador se verifican 1.600 × 900, 390 × 844 y 1.280 × 642 sin desbordamiento horizontal, con una sola conversación, un núcleo y una caja de escritura. Un borrador ficticio sobrevive al cambio de tamaño y se retira sin enviarlo. En móvil la escritura termina a 715 píxeles; en la ventana baja termina a 549 píxeles y quedan 208 píxeles de lectura. Privacidad se abre por encima de la conversación y recibe los eventos en su superficie. Pausa y reanudación funcionan; el logo detiene sus siete animaciones y las respuestas permanecen visibles. El foco de teclado proyecta el servicio 24 píxeles hacia delante. Movimiento reducido y dispositivos táctiles conservan las reglas existentes, revisadas en código sin emulación del sistema.

El clic en Contacto añade una única pregunta y su respuesta predefinida dentro de la misma página. La verificación usa datos ficticios locales; no consume IA, crea reservas o notificaciones ni modifica servicios remotos. No hay despliegue. La vista previa permanece en http://localhost:4322/ con el proveedor real disponible para las consultas del titular.

Capturas actuales: [escritorio](evidence/ui-hub-depth-desktop.jpg), [móvil](evidence/ui-hub-depth-mobile.jpg). Registro: [verificación](evidence/ui-hub-depth-local.json).

## Material glass unificado

El último ajuste unifica el material de la cabecera, los paneles laterales, la conversación y el pie. Comparten un fondo translúcido, un borde claro, reflejos discretos y sombras que separan las superficies del núcleo de fondo. El radio principal es de 14 píxeles en escritorio y 12 en móvil. Se conserva un respaldo desplazado detrás de cada columna, sin captura de eventos, y la conversación permanece en el plano frontal.

El desenfoque es de 16 píxeles en cabecera, laterales y pie, y de 12 en la conversación de escritorio. En móvil pasa a 12 y 9 píxeles, respectivamente. La información del portfolio mantiene un panel superpuesto al fotograma con desenfoque de 12 píxeles. Las filas de servicios comparten el material de los controles sin añadir un desenfoque por fila. Cuando el navegador no admite el efecto, las pantallas principales y la información del portfolio usan un fondo más opaco para conservar la lectura.

La navegación usa Space Grotesk y texto con capitalización normal, dentro de una bandeja de cristal. El botón principal deja de tener una esquina recortada y comparte el acabado redondeado; los enlaces móviles tienen una altura mínima de 44 píxeles. Los siete caracteres y el subtítulo STUDIO usan cian, con halo cian y picos de luz en cian hielo. Se eliminan las variaciones azules de la iluminación del logo, conservando sus tamaños, separación, retrasos y duración.

Se retira de la conversación integrada del hub el bloque «¿Qué quieres crear?» y sus tres botones iniciales para liberar espacio de lectura. Se conservan los menús de la cabecera y los accesos del chat, además del núcleo de fondo. La introducción sigue disponible en la modalidad de chat que no está integrada en el hub. La vista previa a la hidratación de `CenterPanel` también deja de mostrar la bienvenida grande: conserva la etiqueta, el enlace para iniciar la conversación y el correo disponible sin JavaScript, evitando que el bloque reaparezca mientras carga el chat.

La importación de `studio-sidebar.css` se centraliza en `Layout.astro`, después de las bases del hub y antes de las capas de iluminación e interacción. `studio-screen-depth.css` se carga al final para aplicar el material común y sus ajustes de escritorio y móvil en un orden explícito. Se mantienen la pausa, la preferencia de movimiento reducido, el foco por teclado, la proyección de los servicios y la profundidad de las superficies. El compositor conserva `z-index: auto` para que el desplegable de privacidad comparta la capa del chat y quede por encima del acceso a los últimos mensajes.

Validación del material, anterior a la retirada del bloque inicial: tipos del código fuente y compilación aislada correctos. En navegador se verificaron escritorio de 1.600 × 900, móvil de 390 × 844 y ventana baja de 1.280 × 642 sin desbordamiento horizontal, con una sola conversación, un solo núcleo y una sola caja de escritura. El borrador se conserva al cambiar de tamaño. Un clic en Contacto añade una única pregunta; el panel de privacidad abierto recibe el puntero. La pausa detiene las siete animaciones del logo. En esa versión, la escritura termina a 737,64 píxeles en móvil y a 544,20 en la ventana baja, donde quedan 209,40 píxeles de lectura.

Tras retirar la bienvenida, los tipos del código fuente vuelven a pasar. En escritorio de 1.600 × 900, el espacio de lectura pasa de 290,35 a 463,85 píxeles: gana 173,50 píxeles, y la escritura termina a 748,85. En móvil de 390 × 844 quedan 408,64 píxeles de lectura y la escritura termina a 737,64. Ambas vistas conservan una sola conversación, un núcleo y una caja de escritura, sin el bloque inicial ni desbordamiento horizontal. Las capturas de escritorio y móvil se regeneran con esta versión.

Las comprobaciones usaron respuestas predefinidas y datos locales ficticios, sin consumo de IA ni despliegue. La vista previa permanece en http://localhost:4322/.

Capturas del material actual: [escritorio](evidence/ui-hub-unified-desktop.jpg), [móvil](evidence/ui-hub-unified-mobile.jpg).

La compilación aislada final, después de retirar la introducción y simplificar el fallback, pasa con Node 24, funciones de 60 segundos y streaming. En la ventana baja de 1.280 × 642, el plano de lectura mide 315,70 píxeles y la escritura termina a 561,70, sin desbordamiento horizontal. La vista previa permanece abierta en http://localhost:4322/.

## Escritorio compacto y detalles HUD finos

La siguiente iteración responde a la petición de conservar el aspecto futurista con menos carga visual y texto más pequeño en PC. Los ajustes de `studio-screen-depth.css` se aplican desde 1.024 píxeles de ancho: la cabecera pasa de 72 a 56 píxeles, los mensajes de 14,72 a 13 píxeles y la escritura usa también 13 píxeles. El manifiesto pasa de 15 a 12,5 píxeles. Las columnas laterales se limitan con `clamp` a 210–280 y 220–300 píxeles, dejando más ancho para el centro. Los radios principales bajan a 8 píxeles, los bordes pierden intensidad y las sombras son más leves.

En escritorio se retiran los respaldos desplazados, los marcos anidados y la proyección tridimensional de los servicios. El cristal mantiene profundidad con desenfoque de 12 píxeles en cabecera y laterales y de 6 en la conversación. Las pequeñas marcas, las esquinas, el indicador de estado y el dial conservan el carácter de instrumento sin añadir telemetría ficticia. El SVG decorativo del núcleo incorpora 72 marcas, tres anillos y cuatro conexiones, sin nuevas dependencias ni bucles de animación. Su diámetro de escritorio se limita a 860 píxeles; la opacidad del emblema pasa a 0,3 y a 0,45 durante la respuesta. El gráfico sigue fuera del árbol accesible y no captura eventos.

El móvil conserva el texto del chat de 14,72 píxeles, la cabecera de 122 píxeles y el desenfoque de 9 píxeles en la conversación. Los cambios de compactación no reducen sus controles. Los dispositivos con puntero grueso mantienen controles de al menos 44 píxeles también con ancho de escritorio; esta protección se revisa en código, sin emulación táctil. Se mantiene una sola conversación, caja de escritura, instancia del núcleo y grupo de marcas de calibración. Un borrador ficticio sobrevive al cambio de tamaño; la pausa inmoviliza el núcleo y detiene las siete animaciones del logo. La superficie de privacidad sigue recibiendo el puntero: en la ventana baja el desplegable ocupa aproximadamente desde 285 hasta 488 píxeles de altura.

Los tipos del código fuente, la compilación aislada y el análisis del CSS pasan. En navegador se verifican 1.600 × 900, 1.280 × 642, 1.025 × 720 y 390 × 844, sin desbordamiento horizontal. En escritorio grande el plano de lectura mide 561,95 píxeles frente a los 463,85 anteriores: gana 98,10 píxeles. En la ventana baja quedan 346,91 píxeles de lectura y la escritura termina a 559,91. En el escritorio estrecho la escritura termina a 581,91, y en móvil a 737,64. Las comprobaciones usan datos locales y no consumen IA, crean reservas o notificaciones ni despliegan cambios.

Capturas de esta iteración: [escritorio](evidence/ui-hub-compact-desktop.jpg), [móvil](evidence/ui-hub-compact-mobile.jpg). La vista previa permanece en http://localhost:4322/.

## Cristal del chat más transparente

Se reduce la opacidad del fondo de la conversación a un rango de 22–30 % y el desenfoque a 1,5 píxeles en escritorio y 2 en móvil, para mostrar con más claridad la malla y los anillos del núcleo de fondo. En móvil también se aclaran las capas interiores de lectura y de respuesta. La zona de escritura conserva su fondo para facilitar la lectura. Cabecera y laterales mantienen su material. El fondo alternativo para navegadores sin desenfoque también conserva transparencia en la conversación.

El análisis del CSS pasa. La revisión visual en 1.600 × 900 y 390 × 844 confirma el nuevo cristal, sin desbordamiento horizontal y con una sola conversación. El móvil mantiene el texto de 14,72 píxeles y la escritura visible hasta 737,64 píxeles. Capturas: [escritorio](evidence/ui-hub-clear-chat-desktop.jpg), [móvil](evidence/ui-hub-clear-chat-mobile.jpg).

## Marcos luminosos y expansión del núcleo

La referencia visual aportada destaca por las esquinas biseladas, el doble contorno, los segmentos cian casi blancos y los circuitos que enlazan el fondo con las pantallas. Se incorporan esos recursos en los marcos de cabecera, conversación, laterales y pie. Los cortes de 11 píxeles (9 en móvil) pertenecen a los pseudoelementos decorativos; los contenedores y controles no se recortan. El marco del chat usa una línea de 1,5 píxeles y segmentos de 3, con halos localizados. Los servicios, iconos, etiquetas y envío reciben más luz, conservando la escala compacta y la transparencia de la conversación.

`StudioCore` conserva la esfera, el canvas, su proyector y sus límites de tamaño, dibujo y pausa. Solo su variante de fondo incorpora un SVG estático de 660 × 400 unidades que extiende los circuitos por los márgenes, con arcos exteriores, diez terminales, dos retículas y 95 puntos de luz fijos. El nuevo campo ocupa un 220 % del ancho del núcleo (1.892 píxeles para un núcleo de 860 en escritorio), mientras el fondo de la página contiene la expansión. No añade bucles de animación ni dependencias; no recibe eventos y queda oculto a lectores de pantalla. En móvil baja su intensidad a 0,65.

Tipos fuente, análisis del CSS y compilación aislada correctos. Revisión visual en 1.600 × 900, 1.280 × 642 y 390 × 844 sin desbordamiento horizontal. Se conserva una sola instancia del núcleo y una caja de escritura; el chat mantiene texto de 13 píxeles y desenfoque de 1,5 en escritorio, y 14,72 y 2 en móvil. La escritura sigue visible hasta 561,91 píxeles en la ventana baja y 737,64 en móvil. El panel de privacidad abierto recibe el puntero, y la pausa detiene el núcleo y las siete animaciones del logo; las nuevas conexiones son estáticas. Capturas: [escritorio](evidence/ui-hub-sci-fi-desktop.jpg), [móvil](evidence/ui-hub-sci-fi-mobile.jpg). La vista previa permanece en http://localhost:4322/.

## Marca central, portfolio múltiple y vídeo dentro del chat

Se retiran del chat integrado los cuatro accesos «Servicios / Proyectos / Contacto / Manifiesto», ya disponibles en las pantallas del hub. La modalidad independiente conserva sus accesos. El centro del núcleo incorpora la marca completa `ΛKRΛSIΛ` y `STUDIO`, con las proporciones de los siete caracteres de la cabecera, iluminación cian y sin animaciones adicionales. La esfera y su campo exterior se conservan.

La vista local incluye cinco proyectos ficticios: ORIGEN, PULSE, NOCTURNA, MATERIA y HORIZONTE. Las cuatro portadas nuevas se generan con imagegen; las cinco muestras MP4 animan sus portadas y añaden audio sintetizado. Duran ocho segundos a 960 × 540, con vídeo H.264 y audio AAC, y suman aproximadamente 1,17 MB. Los títulos, etiquetas y pies las identifican como DEMO; son muestras de reproducción, no películas generadas completas ni trabajos de clientes. El catálogo de ejemplo pertenece únicamente a `chat-first-preview-fixture.mjs`. No se insertan proyectos en producción. Procedencia: [muestras audiovisuales](../public/media/README.md).

La galería deja de limitarse a tres tarjetas. En escritorio grande usa tres columnas, portadas de hasta 120 píxeles y descripciones resumidas en dos líneas; en móvil se apila. Al pulsar una portada se monta un único reproductor dentro de la conversación y se oculta la galería. Su caja tiene doble marco angular, luz cian, título, duración y botón para volver. Los archivos locales de `/media/` usan controles nativos, pantalla completa, póster, `playsInline` y carga de metadatos. No se reproducen automáticamente. YouTube y Vimeo mantienen el consentimiento para medios externos y tampoco arrancan solos. Cerrar devuelve el foco a la portada; Escape también cierra. Una retirada, error del catálogo o cambio de URL desmonta el reproductor.

La altura del vídeo se adapta a ventanas bajas. Mientras el reproductor tiene el foco, su encuadre se reajusta al cambiar de tamaño desplazando únicamente el área de lectura del chat. El nuevo observador y su tarea pendiente se limpian al cerrar; no se añade un bucle de animación. La zona de escritura sigue visible y las decoraciones no recortan los controles.

Comprobación: tipos fuente, CSS y tarjetas públicas (7 grupos / 115 comprobaciones) correctos; navegación (227 comprobaciones) correcta. En navegador se revisan 1.600 × 900, 1.280 × 642 y 390 × 844, sin desbordamiento horizontal. PULSE reproduce sus ocho segundos completos sin error; MATERIA carga y reproduce en móvil. Se verifican el montaje de un solo vídeo dentro del chat, el cierre con regreso a las cinco tarjetas y el foco en la portada, además del encuadre en la ventana baja. Capturas: [galería de cinco proyectos](evidence/ui-hub-portfolio-five-desktop.jpg), [vídeo en escritorio](evidence/ui-hub-inline-video-desktop.jpg), [vídeo en móvil](evidence/ui-hub-inline-video-mobile.jpg).

La compilación final aislada completa correctamente y valida el contrato de Vercel: Node 24, límite de 60 segundos y streaming habilitado.

## Proyecto como respuesta lateral en escritorio

La respuesta con un solo proyecto vuelve a alinearse a la izquierda y limita su ancho a 27 rem. Su portada conserva el formato 16:9, sin el límite de 120 píxeles usado por la galería. Al abrir el vídeo, la misma respuesta amplía su ancho hasta 36 rem y mantiene el marco HUD. Los límites se aplican únicamente en escritorio; la galería múltiple y el móvil conservan su distribución. Comprobados CSS, una tarjeta de 432 píxeles y un reproductor de 576 píxeles en 1.600 × 900; móvil de 390 píxeles sin desbordamiento horizontal. Capturas: [tarjeta lateral](evidence/ui-hub-project-reply-desktop.jpg), [vídeo lateral](evidence/ui-hub-video-reply-desktop.jpg).

## Catálogo audiovisual visual y preparado para crecer

La ventana incorpora un marco HUD propio, cabecera de archivo y contador de piezas. Las portadas conservan 16:9 y muestran categoría, duración, número y etiqueta DEMO. Cada tarjeta ofrece dos acciones visibles: «Ver vídeo» y «Quiero algo así». Se elimina la introducción duplicada y, en el catálogo, las descripciones largas dejan espacio a las imágenes; la ficha individual mantiene su resumen y la información ampliada sigue desplegable en la conversación.

La colección incluye búsqueda sin distinguir acentos o mayúsculas, filtro por tipo y paginación de seis proyectos. Solo se montan las tarjetas de la página actual, con imágenes diferidas. Las categorías se calculan a partir del catálogo completo y el orden publicado se conserva. Los filtros y la página permanecen al abrir y cerrar un vídeo. Las páginas se ajustan si se retiran proyectos; si el botón de origen desaparece, cerrar devuelve el foco a la búsqueda del mismo catálogo. El estado vacío permite recuperar todos los resultados.

En escritorio, el catálogo se alinea a la izquierda hasta 44 rem y usa columnas según el espacio disponible. Un resultado filtrado conserva el ancho de tarjeta y ventana; la ficha individual conserva 27 rem y el vídeo 36 rem. En móvil se usa una columna y los controles tienen al menos 44 píxeles. Se comprueban búsqueda, filtros, estado vacío, reproducción y regreso con el filtro intacto en el navegador, sin desbordamiento horizontal a 1.600 y 390 píxeles. Tipos, CSS y compilación aislada correctos; diez grupos y 176 comprobaciones incluyen un catálogo de 15 proyectos en español e inglés. Capturas: [catálogo en PC](evidence/ui-hub-visual-catalogue-desktop.jpg), [búsqueda móvil](evidence/ui-hub-visual-catalogue-mobile.jpg).

## Calibración visual del hub · 2026-10-06

`studio-precision.css`, cargado al final de los estilos del layout, ajusta únicamente `.home-screen`. Conserva composición, esquinas biseladas, núcleo, logo y Oxanium. Por preferencia expresa del titular, se restauran las luces originales y su movimiento en todos los marcos. Los controles comparten un radio de 6 px. Las respuestas mantienen 16 px en escritorio y 15 px en móvil, con cristal más oscuro, menos desenfoque y texto sin halo.

Los contornos recuperan los recorridos originales: 16 segundos en cabecera/lateral izquierdo, 18 en chat, 20 en lateral derecho y 22 en pie; las burbujas mantienen 16 segundos y las tarjetas destacadas 14. El visor recupera su respiración de 5,6 segundos y el escáner de servicios su luz original. Hover y foco refuerzan la caja correspondiente mediante segmentos más blancos, contorno más intenso y halo local. El refuerzo incluye tarjetas del catálogo y filas del portfolio. Los servicios mantienen su posición y la respiración del proyector responde a `thinking`/`responding`. La circuitería sigue presente y la lectura no se cubre con nuevas decoraciones.

El estado, rol, aviso de datos y pie usan 11 px. La entrada móvil usa 16 px y el control de pausa 44 × 44 px. El aviso móvil reserva espacio a la derecha para el control persistente de cookies. Se mantiene el orden de capas del desplegable de privacidad, el foco individual de los controles y la ausencia de decoraciones sobre YouTube.

Tipos, compilación aislada y análisis de CSS correctos en el ajuste de lectura. Navegación: 166 comprobaciones; actividad: 35; tarjetas/reproductor: 184. Revisión en navegador en 1.440 × 900, 1.280 × 642, 390 × 844, 320 × 675 y 640 × 320 sin desbordamiento horizontal y con una sola conversación. Se conserva un borrador al cambiar de tamaño, se comprueba foco visible con teclado, la pausa detiene núcleo/logo/proyector y el panel de privacidad recibe el puntero. En 640 × 320 la página permite desplazamiento vertical y enfocar la escritura la deja visible. El iframe de YouTube mantiene 200 px de alto en móvil.

La preferencia de movimiento reducido se revisa en código; no se emula en este navegador. No se prueba un teclado físico de iOS/Android. La vista usa datos locales de demostración y no acredita contenido comercial ni servicios de producción. Evidencias: [escritorio](evidence/hub-precision-desktop.jpg), [móvil](evidence/hub-precision-mobile.jpg), [visor](evidence/hub-precision-video-mobile.jpg).

Tras restaurar las luces se vuelve a comprobar el CSS y la vista en 1.440 × 900 y 390 × 844. Todos los marcos exteriores animan en reposo. Al colocar el ratón en el manifiesto, su segmento tiene opacidad 1 y ancho de 3 px; el panel de servicios vecino mantiene .95 y 2 px. La pausa detiene los once marcos y burbujas inspeccionados. Se conservan entrada móvil de 16 px, pausa de 44 × 44 px y ausencia de desbordamiento. Evidencias de esa restauración: [marcos y hover](evidence/hub-lit-frames-desktop.jpg), [móvil](evidence/hub-lit-frames-mobile.jpg).

### Limpieza de contornos tras la captura del titular

La superficie de cristal y su luz comparten ahora el mismo bisel, alineado con el perímetro exterior. La superficie vive en `::before`; un único `::after` combina la línea continua y los segmentos animados. Se retiran las aristas rectangulares de las sombras y el respaldo desplazado móvil, que sobresalían en las esquinas. El trazo queda fijo en 1,5 px (2 px en conversación): hover y foco aumentan la luz y el halo sin engordarlo. Las diagonales interiores son paralelas a las exteriores.

Las burbujas conservan una sola arista animada. La cabecera del chat usa un separador inferior, el compositor conserva el borde de la entrada y el catálogo pierde su contorno interior redundante. Los controles, el contenido y sus focos mantienen `clip-path: none`; solo se recorta la decoración. No se cambia el orden de capas del desplegable de privacidad ni la pausa.

Comprobado en 1.440 × 900, 390 × 844 y 320 × 675, sin desbordamiento horizontal. El manifiesto bajo el ratón recibe opacidad 1 y halo reforzado con el mismo grosor de 1,5 px que su vecino. La pausa detiene los trece marcos y burbujas inspeccionados; el desplegable de privacidad se ve y recibe el puntero. Se conservan entrada de 16 px y pausa de 44 × 44 px en móvil. Evidencias actuales: [escritorio](evidence/hub-clean-borders-desktop.jpg), [móvil](evidence/hub-clean-borders-mobile.jpg) y [mediciones locales](evidence/hub-clean-borders-local.json).

El titular señala después el contenedor exacto `.hud-viewport.center-viewport.studio-conversation-shell.fade-in-panel`: aún heredaba un radio de 3 px y recortaba con curva sus decoraciones angulares. Se fija `border-radius: 0` en ese contenedor y en los planos estructurales `.chat-layer` y `.chat-composer`, manteniendo el bisel de las luces. Radio cero comprobado en los tres elementos a 1.440 × 900 y 390 × 844, con animación del marco activa y sin desbordamiento. Evidencias: [escritorio](evidence/hub-angular-shell-desktop.jpg), [móvil](evidence/hub-angular-shell-mobile.jpg) y [mediciones](evidence/hub-angular-shell-local.json).

Una captura ampliada posterior descubre la arista rectangular que aún pintaban las sombras exteriores. La corrección actual unifica también la geometría del contenedor: `corner-shape: bevel` con un corte de 11 px (9 en móvil), sin borde físico y con ambas decoraciones en `inset: 0`. Así la sombra, el recorte, el cristal y la luz comparten el mismo perímetro. El valor de radio expresa la profundidad del bisel, no una curva. En motores sin soporte, el último bloque `@supports not` elimina las sombras del contenedor en reposo, hover y foco, conservando las luces animadas y su refuerzo.

El navegador local admite el bisel nativo, calculado como `superellipse(0)`. Se comprueba el vértice ampliado y el hub en 1.440 × 900 y 390 × 844, sin desbordamiento. Los nueve marcos exteriores mantienen la rotación; el manifiesto bajo el ratón aumenta opacidad y halo con grosor fijo. La pausa detiene trece marcos/burbujas y privacidad sigue visible y recibe el puntero. CSS y compilación aislada correctos. El fallback se revisa en código, sin emular otro motor. Evidencias actuales: [detalle de la esquina](evidence/hub-bevel-corner-detail.jpg), [escritorio](evidence/hub-bevel-halo-desktop.jpg), [móvil](evidence/hub-bevel-halo-mobile.jpg) y [mediciones](evidence/hub-bevel-halo-local.json).
