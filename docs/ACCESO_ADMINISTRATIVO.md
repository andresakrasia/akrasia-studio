# Acceso administrativo de Akrasia Studio

Esta corrección cierra A01 y aborda A08 de la auditoría del 2 de octubre de 2026. El administrador entra por `/dashboard/login` con una contraseña única. Las API de `/api/dashboard` requieren una sesión existente y vigente en Supabase; el antiguo secreto de URL, la cabecera `x-dashboard-secret`, el parámetro `secret` y la cookie literal del PIN ya no autorizan el acceso.

## Configuración

1. Aplicar `supabase/migration-v9.sql` en el editor SQL de Supabase con el propietario de la base. La migración añade dos tablas privadas y una función para limitar intentos. No modifica las tablas de negocio. Aplicarla antes de activar la nueva versión del panel.
2. Generar una contraseña única de entre 16 y 256 caracteres; se recomienda una contraseña aleatoria de al menos 24 caracteres guardada en el gestor de contraseñas del administrador. No reutilizar el PIN ni el secreto antiguo.
3. Ejecutar `npm run dashboard:password`. La entrada de la contraseña está oculta en una terminal interactiva y el programa devuelve su hash scrypt. No pasar la contraseña como argumento ni guardarla en el repositorio. El formato es `scrypt:131072:8:1:<salt hexadecimal>:<hash hexadecimal>`; los dos puntos evitan la expansión de variables de los archivos `.env`.
4. Configurar `DASHBOARD_PASSWORD_HASH` con el hash completo y `DASHBOARD_ORIGIN=https://akrasia.studio` con el origen exacto del navegador, sin ruta ni parámetros. Para desarrollo local usar `DASHBOARD_ORIGIN=http://localhost:4321`. La dirección usada en el navegador debe coincidir, incluido el puerto. En producción se exige HTTPS. Conservar `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` exclusivamente en el servidor, sin prefijo `PUBLIC_`.
5. Retirar `DASHBOARD_SECRET` y `DASHBOARD_PIN` de la configuración. No editar los enlaces existentes para incluir otra credencial: los enlaces nuevos y los de Telegram apuntan a `/dashboard`, con pestaña e identificador de visita cuando corresponde. Actualizar el marcador del navegador.
6. Reiniciar el proceso de desarrollo después de cambiar las variables. Para producción harán falta una compilación y un despliegue con la nueva configuración; este encargo no los aplica al servicio publicado.

Si faltan las variables nuevas, no existe la migración o falla la lectura de sesiones, la autorización se deniega. El panel no vuelve al antiguo mecanismo como alternativa. No se ha modificado el archivo `.env` del usuario.

## Sesiones y cierre

Cada acceso correcto genera un token aleatorio de 256 bits. El navegador lo conserva en una cookie `HttpOnly`, `SameSite=Strict`, con ruta `/`; en producción se usa `__Host-akrasia_admin` con `Secure` y sin dominio. En desarrollo se llama `akrasia_admin` y admite HTTP solamente en localhost. El servidor guarda únicamente el SHA-256 del token, la versión de la credencial y la caducidad.

La sesión caduca ocho horas después de acceder, sin renovación automática. La caducidad se comprueba contra la base en cada petición y la interfaz vuelve al acceso al llegar esa hora o recibir un 401. La base debe estar disponible para operar. Las filas caducadas se limpian al intentar acceder nuevamente.

“Cerrar sesión” elimina la sesión actual en la base antes de borrar la cookie. Una copia de esa cookie deja de funcionar. Si falla la revocación, se muestra el error y no se presenta un cierre correcto. Otras sesiones abiertas en otros navegadores continúan hasta su caducidad. Para revocar todas inmediatamente, ejecutar como propietario:

```sql
DELETE FROM public.dashboard_sessions;
```

Cambiar `DASHBOARD_PASSWORD_HASH` por un hash nuevo también invalida las sesiones anteriores cuando todas las instancias están usando la configuración nueva. Para una revocación inmediata durante la rotación, borrar las sesiones además de cambiar el hash.

## Protección de las peticiones

El middleware de Astro comprueba la sesión centralmente para todas las páginas y rutas administrativas, incluidas rutas futuras. Los 41 handlers administrativos existentes conservan además un guard que solo acepta la misma petición que el middleware ha autorizado. No activar `edgeMiddleware` del adaptador Vercel: este guard requiere que middleware y handler se ejecuten juntos en Node.

Las escrituras exigen el origen configurado y una cabecera `x-dashboard-csrf` válida para esa sesión. El token CSRF se entrega a la interfaz; por sí solo no permite acceder ni sustituye a la cookie `HttpOnly`. También se rechazan peticiones identificadas por el navegador como `cross-site`. El login exige el origen correcto, JSON y un cuerpo de hasta 2048 bytes.

El límite de login persiste en Supabase y se consume atómicamente: cinco intentos por dirección y treinta en total en quince minutos, incluidos accesos correctos y cuerpos inválidos. Un bloqueo devuelve 429 y `Retry-After`. No depende de la memoria de una función serverless. Se utiliza la dirección proporcionada por el adaptador de Astro; la configuración del proxy debe verificarse en la plataforma real. El límite global sigue funcionando si la atribución de direcciones es imperfecta.

Las páginas administrativas usan un layout propio sin GTM ni fuentes externas. Las respuestas incluyen `no-store` para navegador y CDN, `noindex`, `Referrer-Policy: no-referrer`, prohibición de framing y una CSP que limita scripts y conexiones al mismo origen. La CSP permite scripts inline por la hidratación de Astro; no sustituye a sanear entradas ni a corregir los otros hallazgos de la auditoría.

## Pruebas locales sin servicios reales

Ejecutar `npm run test:dashboard` para las pruebas sintéticas del servidor. Usan una base simulada local, credenciales ficticias, un directorio de entorno vacío y un bloqueo de conexiones externas. No cargan `.env` ni llaman a Supabase publicado, IA, Telegram o Resend.

Para revisar manualmente la interfaz, ejecutar `npm run dev:dashboard-test` y abrir `http://localhost:4322/dashboard/login`. La contraseña ficticia está en la constante `TEST_PASSWORD` de `scripts/dashboard-auth-test-fixture.mjs`. El servidor usa exclusivamente datos ficticios. Para probar caducidad rápidamente, añadir `-- --session-seconds 5` al comando. No utilizar esta configuración en producción. Detenerlo con Ctrl+C al terminar.

La compilación habitual es `npm run build`; en este entorno restringido fue necesario desactivar la telemetría de Astro solamente en el proceso de compilación (`ASTRO_TELEMETRY_DISABLED=1`). La vista de desarrollo necesitó permisos de lectura ampliados para que el optimizador resolviese dependencias; las conexiones a proveedores continuaron bloqueadas.

## Validación realizada el 2 de octubre de 2026

- Pruebas reproducibles del servidor: 20 grupos y 1676 aserciones correctas, con los 19 archivos de rutas y 41 handlers administrativos existentes. Se verificaron rechazos sin sesión, cookie literal y token manipulado, secreto antiguo en cabecera y URL, sesión válida, cada método de escritura sin CSRF u origen correcto, caducidad, revocación por cierre y rotación, límites de acceso, fallos de base y configuración, y cookie de producción.
- HTTP real contra Astro con la base simulada: 401 sin sesión, con cookie literal, cabecera antigua y secreto en query; `/dashboard` devuelve 303 hacia login. Las respuestas llevan las cabeceras administrativas.
- Navegador: login incorrecto y correcto, carga de las nueve pestañas, apertura de conversación, creación de cliente ficticio, retorno a una conversación después del login, petición de exportación CSV con respuesta 200, cierre de sesión y retorno automático al acceso tras caducidad acelerada de cinco segundos. Se comprobó que el documento administrativo no contiene GTM, iframes ni scripts externos. No se enviaron emails, notificaciones ni reservas ni se llamó a IA.
- Compilación de producción correcta. Continúan los avisos anteriores de Browserslist y del adaptador Vercel sobre el destino Node 18.
- TypeScript global continúa fallando por las dos construcciones TypeScript en `tailwind.config.mjs`, como antes. Excluyendo ese archivo, siguen exactamente los cuatro errores anteriores: `chatRef` en `Chat.tsx` y `MobileChat.tsx`, y `projectType` en dos llamadas de `api/chat.ts`. Ningún error nuevo en esta corrección. También se verificó la sintaxis de las nuevas plantillas Astro y los tipos del cliente del panel.

Los datos de las pruebas son ficticios y se destruyen al cerrar los procesos. El archivo `.env` y los archivos y cambios previos del usuario se conservaron. La captura de verificación muestra únicamente datos sintéticos.

## Límites pendientes

La migración necesita verificación sobre PostgreSQL y comprobación de permisos con los roles de la base desplegada; el doble HTTP local no acredita RLS ni la ejecución real de SQL. Tampoco se han comprobado las cabeceras finales detrás de Vercel, el origen y las variables publicadas o la atribución de IP del proxy. No se ha desplegado ni conectado a servicios reales.

Esta solución está limitada al administrador actual y no incorpora MFA, gestión de usuarios ni recuperación por email. MFA mediante un proveedor de identidad mantenido sigue siendo una mejora pendiente. Un ataque al login puede agotar el límite global y bloquear nuevos accesos durante quince minutos; las sesiones ya abiertas continúan funcionando.

Los otros hallazgos de la auditoría siguen fuera de esta corrección, incluidas las vulnerabilidades del adaptador y su destino de Node 18, la fiabilidad de operaciones de negocio y los errores de tipos del chat.

Referencias de implementación: [middleware de Astro](https://docs.astro.build/en/guides/middleware/) y [criptografía de Node](https://nodejs.org/download/release/v18.18.0/docs/api/crypto.html).
