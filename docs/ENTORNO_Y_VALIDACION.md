# Entorno y validación conjunta (A37–A39)

Estado del repositorio a 2 de octubre de 2026. El [estado central](ESTADO_PRODUCCION.md) distingue estas comprobaciones locales de la activación pendiente en producción.

## Versiones y destino

Node 24 se declara en `.nvmrc` y `package.json`. Astro 7.3.5, el adaptador Vercel 11.0.11 y la integración React 7.0.0 quedan fijados; React conserva la versión 18.3.1. Tailwind 3 usa PostCSS y Autoprefixer. El archivo de configuración de Tailwind contiene JavaScript válido; se han corregido también las referencias inexistentes del chat y los errores de tipos afectados.

El build aislado verifica el artefacto real de Vercel: `nodejs24.x`, duración máxima de 60 segundos y soporte de streaming. No basta con que el Node instalado localmente sea reciente. Sharp se ha ejecutado en Windows; sus binarios Linux y los límites efectivos del alojamiento necesitan la ejecución de CI y staging.

El salto de versión conserva los controles administrativos, de chat, publicación y privacidad. Se han ajustado los lanzadores de pruebas a la entrada actual de Astro. `package-lock.json` acompaña las versiones; usar `npm ci` en un checkout limpio con Node 24.

Astro mantiene su comprobación de origen para peticiones de formulario: una carga multipart desde otro origen, o sin origen, recibe su 403 genérico antes del middleware de la aplicación. Las pruebas HTTP distinguen ese bloqueo del JSON administrativo y acreditan que ninguno produce acceso a Storage. Las cabeceras efectivas de la plataforma, también para respuestas previas a nuestros handlers, deben comprobarse en staging.

## Un único recorrido de comprobación

```text
npm ci
npm audit --audit-level=moderate
npm run test:production
```

El recorrido comprueba secretos del árbol versionable, hashes de las 18 migraciones, tipos y plantillas Astro, regresiones A01–A10, contratos de agenda/chat/panel/web/operación, PostgreSQL real desechable y compilación. Las suites se ejecutan en orden porque algunos previews usan los mismos recursos. Un fallo detiene el recorrido y queda registrado en `docs/evidence/production-local.json`; los resultados anteriores no convierten un recorrido incompleto en aprobado.

Las comprobaciones de tipos y build usan un directorio de entorno vacío y un control de red. Los fixtures sólo permiten sus servidores locales; no utilizan `.env`, IA de pago, destinatarios reales ni servicios remotos. El build aislado sirve para validar el paquete y el runtime; configurar las variables reales requiere un build y un destino de staging revisados.

`npm run test:postgres` crea un cluster nuevo de PostgreSQL 18.4 en loopback y lo elimina al finalizar. No acepta URL de conexión ni descubre credenciales. Las pruebas de roles, RLS, atomicidad, reaplicación y concurrencia usan el motor real. Auth y metadatos de Storage son fixtures: esto no prueba PostgREST, los objetos ni el CDN de Supabase. Véase [Migraciones y reproducción](MIGRACIONES_Y_REPRODUCCION.md).

La detección de secretos inspecciona archivos de texto versionados o nuevos no ignorados; informa sólo rutas. No acredita ausencia de filtraciones en todo el historial, copias externas o cuentas de proveedores. Los archivos privados locales excluidos deben seguir fuera de cualquier paquete compartido.

## Automatización y evidencia

`.github/workflows/production-check.yml` prepara Node 24 en Linux, instala desde el lock, consulta avisos de dependencias y ejecuta el mismo recorrido; conserva únicamente evidencias JSON. Está preparado en el repositorio y no se ha enviado ni ejecutado en GitHub durante este trabajo. Una comprobación local de Windows no acredita el resultado de esa ejecución Linux.

Los registros locales están en `docs/evidence`: `production-local.json`, `postgres-local.json` y `runtime-local.json`. La auditoría de dependencias se guarda separadamente. Las capturas muestran datos ficticios y los flujos comprobados, sin afirmar entrega de correo ni una reserva real.

El panel sigue siendo un componente grande. Los contratos, errores y pruebas reducen riesgos inmediatos; separar sus pantallas y lógica en módulos pequeños sigue siendo una mejora de mantenimiento. Las pruebas no sustituyen revisión de accesibilidad con lectores de pantalla ni mediciones CWV/Lighthouse sobre el despliegue.

## Activación pendiente

Revisar las variables y el catálogo del destino, aplicar o adoptar únicamente un prefijo de migraciones acreditado y ejecutar el recorrido comercial completo en staging. Comprobar IP/proxies, cookies, cabeceras, límites de funciones, publicación/retirada y almacenamiento. Configurar límites monetarios del proveedor de IA, worker y mantenimiento, remitente y alertas. Ensayar restauración de base de datos y Storage. La [guía de operación](OPERACION_PRODUCCION.md) concreta esos requisitos; este trabajo no despliega ni modifica servicios reales.
