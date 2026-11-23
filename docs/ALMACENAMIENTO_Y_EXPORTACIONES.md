# Almacenamiento y exportaciones (A10)

Corrección local del 2 de octubre de 2026. El panel necesita miniaturas de proyectos. Las nuevas imágenes se guardan en un bucket privado y solo el servidor decide su lectura: administración autorizada o referencia exacta de un proyecto con aprobación `is_published=true` de A06. El material deliberadamente público de `public/img` conserva su funcionamiento.

**V14 y sus pruebas SQL/RLS ya se han ejecutado y reaplicado en PostgreSQL 18.4 local y desechable.** Storage usa metadatos simulados y dobles HTTP: buckets, objetos, CDN y permisos efectivos remotos siguen pendientes. Node 24, los tipos generales y el runtime compilado están corregidos; Sharp Linux y la plataforma requieren validación. Véase [Estado de producción](ESTADO_PRODUCCION.md). Los resultados de la etapa inicial A10 que se conservan abajo son históricos; no se ha desplegado ni modificado datos remotos.

## Buckets y referencias

| Uso | Bucket | Acceso y referencia |
| --- | --- | --- |
| Nuevas miniaturas reencodificadas | `project-media-private`, `public=false`, 2.097.152 bytes, solo `image/webp` | Clave de servidor `thumbs/<uuid>.webp`; referencia local `/api/project-media/<uuid>.webp` |
| Miniaturas antiguas | `project-thumbnails`, pasa a `public=false` | Objeto conservado; referencia Supabase antigua normalizada a `/api/project-media/legacy/<nombre>` por el servidor |
| Material público del sitio | Archivos locales del repositorio | Rutas locales existentes, sin dependencia de Storage ni cambio de permisos |
| Buckets ajenos | Configuración preexistente | V14 no cambia sus filas, ACL ni políticas; debe inventariarse cualquier consumidor compartido |

Un bucket público permite recuperar cualquier objeto conociendo su URL; RLS sobre `public.projects` no cierra esa vía. Por eso v14 también convierte el bucket antiguo en privado. Esta diferencia entre acceso público y privado está documentada por [Supabase: buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals).

El proxy no da al visitante una URL firmada de Storage ni redirige al bucket. Comprueba publicación o sesión administrativa, descarga con la credencial del servidor y devuelve una imagen con `no-store` y `nosniff`. Publicar o retirar un proyecto cambia la autorización de futuras peticiones; las imágenes ya descargadas por una persona no pueden recuperarse. La clave de servicio sigue siendo privilegiada y puede omitir RLS; su uso debe permanecer en el servidor tras autorización. [Supabase: control de acceso](https://supabase.com/docs/guides/storage/security/access-control).

Una entrega que ya superó la comprobación puede terminar si la retirada ocurre durante su descarga o conversión. No se promete revocación retroactiva de peticiones en vuelo. La salida local evita que el visitante contacte directamente con Supabase al navegar, preservando A09.

La compatibilidad antigua solo reconoce el origen configurado de Supabase y la ruta `/storage/v1/object/public/project-thumbnails/<nombre>`. El nombre simple usa letras, números, punto, guion y guion bajo, máximo 200 caracteres, sin segmentos de traversal, separadores ni controles. No se aceptan URLs de terceros como instrucciones para el proxy. No se renombra ningún objeto ni se reescriben masivamente filas: la API administrativa y la salida pública normalizan las referencias; un guardado posterior puede conservar la forma local. Inventariar referencias fuera de esas reglas antes de cerrar el bucket; un objeto de formato activo, corrupto o incompatible requiere revisión específica y no debe servirse como imagen por su extensión.

V14 limita nuevas escrituras en el bucket antiguo a JPEG, PNG y WebP y 2 MiB. Ese ajuste no transforma, borra ni acredita el contenido de los objetos previos. La API de carga utiliza exclusivamente el bucket nuevo. Las restricciones de MIME/tamaño del bucket complementan las validaciones de contenido del servidor; no las sustituyen. El límite global de Storage debe admitir al menos los 2 MiB del contrato; un límite global menor seguirá rechazando una subida. [Supabase: creación y restricciones](https://supabase.com/docs/guides/storage/buckets/creating-buckets), [límites](https://supabase.com/docs/guides/storage/uploads/file-limits).

## Qué hace v14

La migración exige v1–v13 y relaciones ordinarias de Storage con RLS activo. Conserva los ACL compartidos de `storage.objects` y `storage.buckets`, así como sus políticas existentes. Añade cuatro políticas con nombres `a10_*`: dos restrictivas `FOR ALL TO PUBLIC` y dos de acceso explícito del servidor. Para los dos buckets gestionados la política restrictiva exige `current_user='service_role'`; para cualquier otro bucket la expresión es verdadera y conserva el comportamiento anterior.

Una política permisiva genérica `USING(true)` o la lectura pública antigua de v3 no puede abrir esos dos buckets: las políticas restrictivas se combinan por AND con las permisivas. `USING` protege la fila anterior y `WITH CHECK` la nueva, incluido mover una fila desde otro bucket. No se confía únicamente en eliminar una política conocida. [PostgreSQL: CREATE POLICY](https://www.postgresql.org/docs/current/sql-createpolicy.html).

La comprobación previa aborta ante roles API con propiedad, superusuario, `BYPASSRLS`, capacidad de asumir roles privilegiados, `CREATE` en Storage, `TRUNCATE`, `REFERENCES` o `TRIGGER`, o vistas/materializaciones dependientes accesibles. RLS no protege esas vías. Un bucket nuevo preexistente con configuración o nombres incompatibles provoca un aborto para no apropiarse de almacenamiento ajeno. También exige los permisos existentes de lectura, subida y limpieza del servidor; no concede privilegios globales para reparar una configuración desconocida.

### Preparación revisada si Storage conserva privilegios históricos amplios

La [migración inicial oficial de Storage](https://github.com/supabase/storage/blob/master/migrations/tenant/0002-storage-schema.sql) contiene concesiones históricas `ALL` para los roles API. La configuración efectiva actual puede diferir. V14 abortará si aún concede operaciones que RLS no cubre; no las revoca silenciosamente. Antes de aplicar v14, el propietario debe inventariar los derechos efectivos y todos los roles que `anon`/`authenticated` puedan asumir:

```sql
SELECT r.rolname,c.oid::regclass AS relation,privilege,
  pg_catalog.has_table_privilege(r.oid,c.oid,privilege) AS permitted
FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_class c
CROSS JOIN unnest(ARRAY['TRUNCATE','REFERENCES','TRIGGER']) AS rights(privilege)
WHERE c.oid IN ('storage.objects'::regclass,'storage.buckets'::regclass)
  AND (pg_catalog.pg_has_role('anon',r.oid,'MEMBER') OR pg_catalog.pg_has_role('authenticated',r.oid,'MEMBER'));
SELECT r.rolname,c.oid::regclass AS relation,a.attname
FROM pg_catalog.pg_roles r CROSS JOIN pg_catalog.pg_class c
JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE c.oid IN ('storage.objects'::regclass,'storage.buckets'::regclass)
  AND (pg_catalog.pg_has_role('anon',r.oid,'MEMBER') OR pg_catalog.pg_has_role('authenticated',r.oid,'MEMBER'))
  AND pg_catalog.has_column_privilege(r.oid,c.oid,a.attnum,'REFERENCES');
```

Si nadie legítimo depende de esas operaciones, el propietario puede preparar y revisar la siguiente corrección **separada**. Retira exclusivamente `TRUNCATE`, `REFERENCES` y `TRIGGER` de las dos tablas compartidas, además de concesiones de `REFERENCES` por columna. Afecta esas operaciones SQL para **todos** sus buckets; conserva `SELECT`, `INSERT`, `UPDATE` y `DELETE` y sus políticas legítimas. No modifica filas, objetos ni bucket flags. No se ha ejecutado aquí:

```sql
BEGIN;
REVOKE TRUNCATE,REFERENCES,TRIGGER ON TABLE storage.objects,storage.buckets FROM PUBLIC,anon,authenticated;
DO $reviewed_storage_columns$
DECLARE item RECORD;
BEGIN
  FOR item IN SELECT n.nspname,c.relname,a.attname FROM pg_catalog.pg_attribute a
    JOIN pg_catalog.pg_class c ON c.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
    WHERE c.oid IN ('storage.objects'::regclass,'storage.buckets'::regclass) AND a.attnum>0 AND NOT a.attisdropped LOOP
    EXECUTE pg_catalog.format('REVOKE REFERENCES (%I) ON TABLE %I.%I FROM PUBLIC,anon,authenticated',item.attname,item.nspname,item.relname);
  END LOOP;
END;
$reviewed_storage_columns$;
COMMIT;
```

Una concesión heredada o un rol asumible con derechos propios exige el mismo análisis y una revocación explícita de esos derechos **en ese rol identificado**, incluidas sus columnas; revocar solo `anon`/`authenticated` no la elimina. Guardar el cambio concreto, probar los usos compartidos en staging y repetir las consultas antes de v14. Si el rol ajeno necesita mantenerlos, si falta capacidad del propietario para revocarlos, o existe propiedad, superusuario, `BYPASSRLS`, `CREATE` o una vista expuesta, detener la aplicación y acordar una solución específica con el administrador/proveedor. No cambiar roles globales, membresías o ACL ajenas automáticamente.

V14 utiliza `BEGIN`/`COMMIT` y bloqueos breves de escritura sobre las dos tablas compartidas con espera máxima de cinco segundos. Preparar una ventana revisada de Storage: pueden pausarse escrituras de otros buckets durante la transacción. Si no consigue los bloqueos o alguna comprobación falla, no continuar con una transacción fallida ni eliminar el guard. Revisar el objeto/configuración que motivó el aborto. Reaplicar solo v14, nunca los seeds de las migraciones históricas sobre datos existentes.

Se modifica únicamente configuración de los dos buckets y políticas `a10_*`; no se alteran columnas de Storage, objetos, referencias de proyectos, roles globales ni funciones. La creación/configuración de buckets está soportada, pero las operaciones de archivos deben pasar por Storage API: las tablas guardan metadata, no el contenido. La migración no usa SQL para mover o borrar archivos. [Supabase: esquema de Storage](https://supabase.com/docs/guides/storage/schema/design).

## Funciones privilegiadas: cobertura reutilizada

La función original `increment_message_count(uuid)` de `migration.sql` ya fue corregida en A05/v11: ahora es `SECURITY INVOKER`, tiene `search_path=''`, refiere `public.conversations` explícitamente y no permite `EXECUTE` a `PUBLIC`, `anon`, `authenticated` ni `service_role`. Las API actuales no la llaman. V14 verifica ese estado sin recrearla.

Las tres RPC A01/A02 de v11 y las cinco de A09/v13 permanecen `SECURITY DEFINER` con `search_path=''` y ejecución exclusiva de `service_role`. V14 verifica las diez firmas exactas, ausencia de overloads nuevos, configuración, propiedad y privilegios efectivos/asumibles de los roles API. Si la plataforma cambió esas restricciones, aborta y exige revisar A05/A09; no cambia algoritmos ni duplica sus correcciones. Véanse [permisos de Supabase](PERMISOS_SUPABASE.md) y [privacidad del chat](PRIVACIDAD_Y_DATOS_CHAT.md).

## Aplicación posterior en un entorno aprobado

1. Obtener respaldo recuperable e inventario privado de buckets, políticas, ACL, roles asumibles, funciones y consumidores; confirmar que v1–v13 están aplicadas. No imprimir credenciales ni secretos. Revisar accesos alternativos, URLs firmadas previas, CDN y copias existentes.
2. Validar primero en PostgreSQL desechable y en staging con imágenes ficticias. Coordinar la versión A10 del servidor y el cierre del bucket antiguo: desplegar la compatibilidad del proxy en la ventana preparada, suspender nuevas cargas durante el cambio y verificar antes de reactivarlas. No hay fallback de carga a un bucket público.
3. Confirmar que `project-thumbnails` es el bucket del repositorio y que `project-media-private` está ausente o ya cumple exactamente el contrato. Conexión previamente configurada y sin credenciales en el comando: `psql -X -v ON_ERROR_STOP=1 -f supabase/migration-v14.sql`. Guardar el resultado y detenerse ante el primer error. No ejecutar este paso en producción sin revisión del entorno.
4. Verificar catálogo y configuración desde una conexión de propietario, solo lectura:

```sql
SELECT id,name,public,file_size_limit,allowed_mime_types
FROM storage.buckets WHERE id IN ('project-thumbnails','project-media-private');
SELECT bucket_id,count(*) FROM storage.objects
WHERE bucket_id IN ('project-thumbnails','project-media-private') GROUP BY bucket_id;
SELECT c.relname,p.polname,p.polcmd,p.polpermissive,p.polroles,
  pg_catalog.pg_get_expr(p.polqual,p.polrelid) AS using_expression,
  pg_catalog.pg_get_expr(p.polwithcheck,p.polrelid) AS check_expression
FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
WHERE p.polrelid IN ('storage.objects'::regclass,'storage.buckets'::regclass);
SELECT p.oid::regprocedure,p.prosecdef,p.proconfig,
  pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
  pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
  pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE') AS server_execute
FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('increment_message_count','update_updated_at','dashboard_consume_login_attempt','chat_admit','chat_release',
  'chat_context_state','chat_erase_context','chat_save_turn','chat_insert_booking','chat_retention_batch');
```

5. En staging, con objetos ficticios cuya existencia se haya confirmado por el servidor, probar lectura pública directa y autenticada de ambos buckets: deben denegarse; subir, sustituir, mover y borrar con anon/usuario Supabase también deben denegarse. Verificar lectura/carga autorizada del panel, lectura pública solo tras aprobación y denegación después de retirarla. Confirmar que referencias antiguas aprobadas pasan por el proxy y que el bucket ajeno de prueba conserva sus permisos. Una lista vacía sin una fila positiva de control no demuestra aislamiento.
6. Revisar/purgar la caché heredada del bucket antiguo con la función soportada por el proveedor y comprobar las URLs antiguas después de la propagación. La [purga CDN oficial](https://supabase.com/docs/guides/storage/cdn/purge-cdn-cache) permite invalidar sin mover ni borrar objetos, requiere credencial privada y depende del plan. No modifica cachés de navegador. Si la plataforma no ofrece esa operación, acordar con el proveedor la invalidación y el periodo de exposición antes de declarar cerrado el bypass. No suponer que el SQL invalida todas las cachés o URLs firmadas: [Smart CDN](https://supabase.com/docs/guides/storage/cdn/smart-cdn) documenta su comportamiento separado.

Revertir poniendo `project-thumbnails` público vuelve a abrir el bypass de publicación. Ante un fallo de integración conservar los buckets privados, corregir el proxy y repetir las verificaciones; no usar una reapertura pública como recuperación automática.

## Pruebas SQL preparadas y pruebas locales ejecutadas

En un **clúster y base desechables** creados por `supabase/tests/a05-bootstrap.sql`, ejecutar primero las verificaciones A05 antes de v14: aquella fixture acredita el comportamiento histórico de v3 y espera su bucket público. Aplicar v12 y v13, después `a10-prepare.sql`, v14 y `a10-verify.sql`, siempre con `psql -X -v ON_ERROR_STOP=1`. Los dos archivos A10 exigen nombre de base `akrasia_a05_*`, marcador del bootstrap y superusuario de ese clúster. No son scripts de producción.

La preparación amplía únicamente el stub desechable de Storage con las columnas de configuración y RLS de buckets; introduce permisos API y políticas permisivas deliberadamente amplias. El verificador compara todas las filas de objetos/proyectos, configuración ajena, ACL y políticas previas; reaplica v14 y compara otra instantánea. Prueba el servidor temporalmente sin `BYPASSRLS`, ambos roles API, inserciones, sustituciones, borrados, exposición del bucket y movimiento desde un bucket ajeno; los cambios finales se revierten. El stub solo contiene metadata, por lo que aun al ejecutarlo no acredita MIME/tamaño ni la CDN o API de Storage real.

`node scripts/test-storage-sql.mjs` pasó **80 comprobaciones estáticas** sobre alcance, guards, políticas, cobertura de funciones y pruebas SQL preparadas. **PostgreSQL, ACL/RLS, reaplicación y Storage real siguen sin ejecutar**: no existe `psql`/`postgres` utilizable en PATH; no se arrancó Docker ni un servicio externo. Las pruebas de carga, CSV, proxy y navegador se registran con el resto de la verificación A10.

## Contrato de carga y recursos

El único uso de la carga actual es la miniatura del editor de proyectos. `/api/dashboard/upload` mantiene la autorización central A01/A08: cookie administrativa persistente y revocable, origen exacto y CSRF antes de leer el cuerpo. El navegador muestra los límites y errores deliberados del servidor; no sustituye su validación. Una carga fallida conserva la miniatura anterior y no muestra el proyecto como guardado. Una carga correcta indica que falta guardar su referencia. Durante la carga se bloquean guardado, publicación y cambios de selección para evitar vincularla a otro proyecto.

| Control | Límite y tratamiento |
| --- | --- |
| Formatos de entrada | JPEG (`.jpg/.jpeg`, `image/jpeg`), PNG y WebP estáticos; extensión, MIME y contenido deben coincidir |
| Archivo | 2.097.152 bytes inclusive; un byte adicional se rechaza |
| Petición | 2.113.536 bytes inclusive, incluyendo multipart; un único archivo llamado `file`, sin campos adicionales |
| Multipart | Boundary de hasta 70 caracteres, cabeceras internas hasta 8192 bytes; cierre exacto y parámetros/cabeceras estrechos; sin codificación comprimida |
| Imagen decodificada | Hasta 8192 píxeles por lado, 16.000.000 píxeles totales y cuatro canales |
| Salida | WebP de hasta 1920 píxeles por lado, sin ampliar, calidad 80, sin metadatos del original, máximo 2 MiB |
| Recursos | Dos cargas y dos decodificaciones simultáneas por proceso; petición 10 s, conversión Sharp 3 s, Storage 10 s y limpieza 3 s |

`Content-Length` solo adelanta el rechazo: el lector cuenta los bytes reales antes de retenerlos o concatenarlos, cancela cuando exceden el máximo, admite cuerpo sin cabecera y rechaza una longitud declarada que no coincide. No se usa `request.formData()` ni `file.arrayBuffer()` sobre un cuerpo ilimitado. La memoria del handler queda acotada, aunque no es cero: conserva el multipart pequeño y la conversión necesita buffers y píxeles. Astro 4 instalado adapta el cuerpo HTTP mediante un iterable al `Request` del servidor; una plataforma puede haberlo materializado antes. [Vercel documenta un límite de payload de 4,5 MB](https://vercel.com/docs/functions/limitations), independiente del límite menor de esta aplicación. Confirmar comportamiento del proxy, cabeceras falsas, cuerpos chunked y rechazos en staging; la prueba local no acredita el buffer de entrada de Vercel.

La comprobación no se limita a magic bytes: exige estructura completa, cierre JPEG, longitud/chunks/CRC PNG y contenedor WebP, y decodifica los píxeles con Sharp `failOn: warning`. Rechaza archivos truncados, corrupción de píxeles, payloads anexados, APNG/WebP animados y SVG/HTML/GIF/PDF/AVIF/TIFF u otros formatos innecesarios. APNG necesita un bloqueo explícito de `acTL/fcTL/fdAT`: un decodificador PNG estático puede ignorarlos, según [la especificación PNG](https://www.w3.org/TR/png-3/). Reencodificar elimina metadatos y contenido auxiliar: [Sharp constructor](https://sharp.pixelplumbing.com/api-constructor/), [salida](https://sharp.pixelplumbing.com/api-output/).

Después de comprobar la estructura y CRC del PNG original, se retiran sus chunks auxiliares no necesarios **antes** del decodificador: texto/perfiles comprimidos `iCCP/zTXt/iTXt`, EXIF/XMP y metadatos privados no pueden expandirse durante `metadata()`. Se conservan píxeles/paleta, transparencia y pistas pequeñas de gamma/sRGB/color/densidad. Esta decisión puede cambiar la apariencia de una miniatura PNG que dependía de un perfil ICC incrustado; la carga no es un archivo maestro con fidelidad de color de producción. JPEG/WebP conservan la interpretación de color/orientación durante la conversión, pero la salida elimina sus metadatos. No se relajan los límites de recursos del proceso por estas comprobaciones.

Los límites simultáneos son locales a cada proceso, no cuotas distribuidas. La respuesta de decodificación tiene un deadline de tres segundos que incluye metadatos y cola, además del timeout nativo de Sharp para la conversión. Al vencer se intenta destruir la operación; esto no garantiza interrumpir de inmediato todo trabajo nativo. El cupo permanece ocupado hasta que ese trabajo termine, para no acumularlo mediante reintentos. No es una sandbox del decodificador. Los formatos estrechos, tamaño, canales y píxeles reducen recursos; la plataforma debe imponer y verificar memoria/CPU/duración del proceso. [La política de seguridad de Sharp](https://sharp.pixelplumbing.com/security/) pide mantener la versión con soporte y límites de recursos de ejecución.

Los nombres de cliente no seleccionan objetos. El servidor genera un UUID v4 y `thumbs/<uuid>.webp`; no hay upsert ni sustitución elegida por el navegador. Nombres con rutas, controles o cabeceras y multipart malformados se rechazan antes de Storage. Las credenciales se envían solo al origen configurado, con redirects rechazados; los cuerpos de error del proveedor no se devuelven ni se registran. Ante un fallo o escritura incierta se intenta borrar exclusivamente ese UUID nuevo. Un conflicto 400/409 no desencadena borrado: podría referirse a un objeto ya existente que esa petición no creó. Supabase documenta [400 para subidas estándar duplicadas](https://supabase.com/docs/guides/storage/uploads/standard-uploads) y [409 en sus códigos de error](https://supabase.com/docs/guides/storage/debugging/error-codes); no se necesita leer el cuerpo interno para protegerlo. Si Storage está caído, un commit llega tarde o termina el proceso, puede quedar un objeto privado sin vincular: inventariar huérfanos con un periodo de gracia y revisión previa antes de cualquier limpieza real. También puede quedar una carga correcta si se abandona el formulario. No se añadió borrado automático de archivos reales.

El proxy aplica las mismas validaciones a los objetos antiguos y limita la lectura a 2 MiB, incluyendo respuestas sin `Content-Length`. Un archivo antiguo mayor, animado, corrupto o activo dejará de visualizarse a través del proxy; inventariarlo y preparar un reemplazo revisado antes de aplicar v14. Referencias antiguas con codificaciones, espacios, segmentos o formas de URL diferentes requieren revisión y normalización explícita; no se amplía la allowlist para acomodarlas silenciosamente.

**Dependencia y bloqueo de plataforma:** Sharp directo está fijado a **0.35.5**, con libvips **8.18.7**, vigente según la [fuente oficial de versiones](https://sharp.pixelplumbing.com/changelog/v0.35.5/). Requiere Node **20.9 o superior**. Las pruebas locales usan Node 24.21.0. El adaptador antiguo sigue generando `nodejs18.x` (A37), incompatible con esta dependencia y ya incompatible con otras del proyecto. La compilación local correcta no convierte ese artefacto en desplegable. Resolver A37 con versiones de Node/stack soportadas, instalar y verificar los binarios nativos del destino Linux y comprobar carga/conversión en staging antes de producción; no desplegar el artefacto actual.

## Exportación CSV

Solo se encontró una exportación CSV: `/api/dashboard/export`, descargada desde Leads. Mantiene sesión administrativa y bloqueo de lecturas cross-site A01, consulta un máximo de 1000 leads con nueve columnas explícitas y nombre fijo `akrasia-leads.csv`. Las respuestas llevan UTF-8, BOM, `no-store` del navegador/CDN y `nosniff`. Un fallo HTTP, JSON o de forma del almacén devuelve un error genérico 503 sin `Content-Disposition`; no descarga un archivo vacío aparentemente correcto. Una tabla realmente vacía sí produce una fila de cabecera.

`src/lib/csv.ts` centraliza cabeceras y celdas: separador coma, filas CRLF, comillas duplicadas y preservación de separadores, saltos y Unicode dentro del campo, conforme al [formato RFC 4180](https://www.rfc-editor.org/info/rfc4180/). Todos los campos de leads son texto no confiable, incluidos IDs, teléfono, fechas y tags; no se convierten a números por su apariencia. Solo un `number` finito aportado explícitamente por el servidor se serializa como número, conservando negativos legítimos.

El texto que empieza por `=`, `+`, `-` o `@`, también sus formas de anchura completa, se protege incluso tras espacios, caracteres de control/formato Unicode o apóstrofes. Los controles iniciales reciben igualmente protección. Antes del valor original se añade **tabulador más apóstrofe** (`\t'`) dentro de su campo entrecomillado. No se recorta ni elimina el original. Ejemplo: `=1+1` se convierte en el campo CSV que contiene tabulador, apóstrofe y `=1+1`; un teléfono textual `+34…` también recibe el prefijo. Entrecomillar por sí solo no neutraliza fórmulas.

La combinación es conservadora: [OWASP](https://community.owasp.org/attacks/CSV_Injection) documenta la protección mediante tabulador citado para Excel y los límites del apóstrofe tras guardar/reabrir. Un parser CSV independiente observa los dos caracteres añadidos, que pueden verse en otros importadores. No hay garantía universal ante aplicaciones que eliminan prefijos, vuelven a interpretar valores o transforman/reexportan el CSV. Para Excel importar UTF-8, delimitador coma y columnas de texto; el BOM facilita la apertura UTF-8, según [Microsoft](https://support.microsoft.com/en-us/excel/opening-csv-utf-8-files-correctly-in-excel). En LibreOffice Calc activar campos citados como texto y desactivar evaluación de fórmulas, según [su diálogo de importación](https://help.libreoffice.org/latest/en-US/text/shared/00/00000208.html). No quitar el guard de valores no confiables ni activar evaluación de fórmulas. Excel y Calc no se ejecutaron en estas pruebas.

## Resultados locales y reproducción

Ejecutar desde la raíz, con dependencias instaladas; los scripts usan archivos ficticios y Storage/REST simulado, sin leer `.env` ni permitir integraciones externas:

```text
node scripts/test-project-upload.mjs
node scripts/test-project-upload-http.mjs
node scripts/test-project-media.mjs
node scripts/test-csv-export.mjs
node scripts/test-storage-sql.mjs
node node_modules/typescript/bin/tsc --noEmit --project scripts/tsconfig-media.json
node node_modules/typescript/bin/tsc --noEmit --project scripts/tsconfig-projects.json
node scripts/build-isolated.mjs
```

Los alias correspondientes están en `package.json`. Cargas: **17 grupos / 253 aserciones**. HTTP real de Astro: **4 / 100**, tras mantener y comprobar el bloqueo de origen previo de Astro 7, con cuerpo por fragmentos sin `Content-Length`, exceso antes del parseo, multipart inválido/múltiple y autorización/origen/CSRF. Medios, autorización y publicación: **9 / 141**. CSV: **8 / 206**, con parser Python `csv` independiente, incluidas comillas, delimitadores, saltos, Unicode, fórmulas, controles, cabeceras y números tipados. Storage SQL: **80 estáticas**. En navegador real se cargó una imagen ficticia mediante el selector del panel, se guardó su referencia sin publicar y se visualizaron errores de contenido activo camuflado como PNG y tamaño excesivo, conservando la miniatura anterior y sin mostrar éxito falso. El botón de exportación produjo una descarga local verificada con BOM/UTF-8/CRLF, dos filas/nueve columnas por parser independiente y lead ficticio; el evento de descarga de la herramienta expiró aunque el archivo sí se guardó, por lo que se verificó el resultado local. Evidencias en `docs/qa/a10/`.

Para repetir la comprobación visual: `node scripts/create-a10-browser-files.mjs` genera únicamente entradas ficticias dentro de `docs/qa/a10/`; `node scripts/serve-dashboard-test.mjs --port 4330` abre el panel aislado con la contraseña ficticia exportada por su fixture. Usar el selector del panel y esos archivos, nunca una vista con `.env` real. La fixture administrativa actual usa UUID válidos y referencias coherentes para los clientes y proyectos; no requiere omitir el cliente para guardar. Los archivos corrupto/excesivo generados pueden retirarse tras la comprobación; las capturas y el CSV entregados no incluyen datos reales.

Regresiones A01/A08 **1676**; A02 **701**; A03 **13841**; A04 visitantes **350** y reservas **293**; A05/Supabase **214**; A06 **315** y SQL **40 estáticas**; A07 contrato **1175**, acciones **325**, proveedor **99**; A09 consentimiento **67**, ciclo de vida **210**: correctas. Tipos de medios y proyectos afectados, y compilación aislada correctos. El chequeo general de fuentes mantiene dos errores previos de `chatRef` en `Chat.tsx` y `MobileChat.tsx`; el chequeo global de Astro también conserva la configuración Tailwind con sintaxis TypeScript en `.mjs` ya documentada, no reevaluada como corrección A10. A37 sigue pendiente como se indica arriba.

La actualización fue local. No se aplicaron migraciones, no se cambiaron buckets/permisos/datos remotos, no se subieron archivos reales, no se usó IA de pago ni se enviaron emails/Telegram o crearon reservas reales. Persisten las limitaciones documentadas de disponibilidad, conflictos entre propuestas de reserva y email automático.
