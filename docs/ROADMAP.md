# AKRASIA STUDIO — Roadmap de Desarrollo

> **Version:** 4.0  
> **Fecha:** 2026-04-14  
> **Ultima actualizacion:** Fase 7 completada, Fase 8-14 planificadas

---

## Vision General

```
FASE 0: Pre-Produccion                        ✅ COMPLETADO
FASE 1: Shell Estatico                        ✅ COMPLETADO
FASE 2: Datos Dinamicos (JSON)                ✅ COMPLETADO
FASE 3: Chat con Agente IA                    ✅ COMPLETADO
FASE 5: Admin Dashboard                       ✅ COMPLETADO
FASE 6: Pulido y Animaciones                  ✅ COMPLETADO
FASE 7: Responsive y Accesibilidad            ✅ COMPLETADO
FASE 8: Seguridad y SEO                       ← AHORA
FASE 9: Analytics y Graficas                  Pre-deploy
FASE 10: Telegram Bidireccional               Notificaciones inteligentes
FASE 11: Agente IA con Memoria                Conversaciones entre sesiones
FASE 12: Booking + Qualifier                  Cal.com + cualificacion IA
FASE 13: Email Builder                        Constructor desde dashboard
FASE 14: i18n + Contenido Estatico            Ingles, SEO pages, case studies
FASE 15: Deploy Produccion                    Vercel + dominio
```

---

## FASE 8: Seguridad y SEO

**Objetivo:** Proteger el endpoint del chat y añadir metadatos basicos.

**Duracion estimada:** 1-2 horas

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Rate limiting chat | URGENTE | Limite 20 msgs/hora por visitor_id en el endpoint `/api/chat`. Middleware simple con contador en memoria o Supabase |
| SEO meta tags | ALTA | Title, description, og:image en `Layout.astro`. Open Graph para LinkedIn/WhatsApp |
| Favicon | ALTA | Logo AKRASIA como favicon.ico + SVG |
| PIN dashboard | MEDIA | Ademas del secret URL, pedir un PIN (env var `DASHBOARD_PIN`). Cookie httpOnly con expiracion 7 dias. No hace falta Supabase Auth para un solo usuario |
| Paginas de servicios estaticas | MEDIA | `/servicios/branded-content`, `/servicios/cortometraje`, etc. con texto real para Google. No son el foco de la experiencia pero indexan bien |

**Archivos afectados:**
- `src/pages/api/chat.ts` — Rate limiting
- `src/layouts/Layout.astro` — Meta tags OG
- `src/pages/dashboard/[secret].astro` — PIN check
- `src/pages/servicios/[slug].astro` — Paginas SEO (nuevo)

**Criterio de aceptacion:** Un bot no puede disparar costes de API. La URL se ve bien en WhatsApp/LinkedIn.

---

## FASE 9: Analytics y Graficas en Dashboard

**Objetivo:** Visualizar evolucion temporal de leads y conversaciones.

**Duracion estimada:** 2-3 horas

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| GA4 basico | ALTA | Script de Google Analytics en Layout.astro. Cero mantenimiento |
| Grafica leads/semana | ALTA | Chart simple (barras o linea) en OverviewTab usando datos de Supabase |
| Tiempo medio conversacion | ALTA | Calcular avg(msgs) y avg(duracion) por conversacion, mostrar en Overview |
| Ratio conversacion→lead | MEDIA | De todas las conversaciones, cuantas generaron lead. KPI de eficacia del agente |
| Visitas unicas por dia | MEDIA | Agrupar visitors por fecha, mostrar tendencia |

**Enfoque:** No PostHog por ahora. GA4 para trafico general + graficas propias en el dashboard con datos de Supabase. PostHog cuando haya 500+ visitas/mes.

**Archivos afectados:**
- `src/layouts/Layout.astro` — GA4 script
- `src/components/dashboard/DashboardApp.tsx` — OverviewTab con graficas
- `src/pages/api/dashboard/metrics.ts` — Endpoint con datos agrupados

**Dependencia:** `recharts` o `chart.js` para las graficas (npm install)

**Criterio de aceptacion:** El dashboard muestra leads por semana, tiempo medio de chat, y ratio de conversion.

---

## FASE 10: Telegram Bidireccional

**Objetivo:** Detectar leads calientes automaticamente y notificar con contexto.

**Duracion estimada:** 2-3 horas

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Deteccion lead caliente | ALTA | En el system prompt o post-procesamiento del chat, detectar palabras clave: presupuesto, plazo, presupuesto, tipo de proyecto, urgencia |
| Cambio estado automatico | ALTA | Si se detecta lead caliente → cambiar estado a `hot` en Supabase |
| Notificacion estructurada | ALTA | Enviar a Telegram: nombre, tipo proyecto, presupuesto mencionado, enlace al dashboard, ultimos 3 mensajes del chat |
| Botones en Telegram | MEDIA | Boton "Ver conversacion" que enlace al dashboard con la conversacion abierta |

**Logica de deteccion:**
```
Palabras clave: presupuesto, precio, cuanto cuesta, plazo, fecha, urgente, 
  necesitamos, proyecto, producir, rodar, grabar, campana
Si visitor menciona 2+ keywords → marcar como hot
Si visitor da email o telefono → lead confirmado
```

**Archivos afectados:**
- `src/pages/api/chat.ts` — Post-procesamiento de mensajes
- `src/lib/notify.ts` — Mensaje estructurado a Telegram
- `src/hooks/ChatContext.tsx` — Posible ajuste del system prompt

**Criterio de aceptacion:** Cuando un visitante menciona presupuesto + tipo de proyecto, recibes un Telegram con el contexto completo.

---

## FASE 11: Agente IA con Memoria

**Objetivo:** El agente reconoce visitantes que vuelven y carga historial.

**Duracion estimada:** 2-3 horas

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Cookie visitor_id persistente | ALTA | Ya se genera un visitor_id. Guardarlo en cookie con expiracion 30 dias |
| Cargar historial al volver | ALTA | Cuando un visitante con historial abre el chat, el agente carga las ultimas 10 conversaciones como contexto |
| Mensaje de bienvenida personalizado | MEDIA | "Hola de nuevo, la ultima vez hablabamos de [tema]. En que te puedo ayudar hoy?" |
| System prompt con contexto | MEDIA | Incluir resumen de conversaciones anteriores en el prompt del agente |

**Enfoque tecnico:**
1. Visitor ya existe en Supabase con `visitor_id`
2. Al cargar el chat, si hay cookie → GET `/api/dashboard/conversations?visitor_id=X`
3. Las ultimas N conversaciones se pasan como contexto en el system prompt
4. No hace falta vector DB, con las ultimas 5-10 conversaciones es suficiente

**Archivos afectados:**
- `src/lib/visitorId.ts` — Cookie persistente
- `src/hooks/ChatContext.tsx` — Cargar historial al iniciar
- `src/pages/api/chat.ts` — Contexto de conversaciones anteriores

**Criterio de aceptacion:** Si vuelvo a la web despues de 2 semanas, el agente sabe de que hablamos.

---

## FASE 12: Booking + Qualifier

**Objetivo:** Cualificar leads y ofrecer llamada directamente en el chat.

**Duracion estimada:** 2-3 horas

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Cal.com integration | ALTA | Embeber link de Cal.com cuando el agente detecta intencion de avanzar. El agente muestra: "Te ofrezco una llamada de 30 min para hablar de tu proyecto" + link |
| Preguntas cualificadoras | ALTA | El agente pregunta: tipo proyecto, duracion, localizaciones, actores, post-produccion, plazo. NO da precios, solo cualifica |
| Flow agente→llamada | ALTA | Cuando el agente tiene suficiente contexto → ofrece la llamada. "Con este contexto, tiene sentido que hablemos en una llamada" |
| Boton de llamada en el chat | MEDIA | Cuando el agente ofrece llamada, muestra un boton estilo "Reservar llamada" que abre Cal.com en nueva tab |

**Decision de diseno:** NO mostrar precios automaticamente. El agente cualifica con preguntas y al final deriva a llamada. Asi no anclas mal un precio.

**Archivos afectados:**
- `src/hooks/ChatContext.tsx` — Ajuste del system prompt
- `src/components/ChatWrapper.tsx` — Boton "Reservar llamada" en el chat
- `.env` — `CALCOM_LINK=https://cal.com/akrasia-studio/...`

**Criterio de aceptacion:** El agente cualifica y ofrece llamada cuando tiene contexto suficiente.

---

## FASE 13: Email Builder

**Objetivo:** Enviar emails a leads directamente desde el dashboard con IA.

**Duracion estimada:** 3-4 horas

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| API Resend o SendGrid | ALTA | Cuenta gratuita (100 emails/dia). Guardar API key en env |
| Plantillas basicas | ALTA | Seguimiento, propuesta, cierre. 3 templates con variables |
| IA genera email con contexto | ALTA | Desde el dashboard, seleccionas lead → la IA genera email con el contexto de la conversacion |
| Editor simple | MEDIA | Textarea con preview, enviar directamente |
| Historial emails enviados | BAJA | Tabla `sent_emails` en Supabase para tracking |

**Flujo:**
1. Dashboard → tab Leads → seleccionar lead → boton "Enviar email"
2. La IA genera el email con el contexto de la conversacion
3. Revisas/editas el texto
4. Enviar → Resend API → llega al lead

**Archivos afectados:**
- `src/pages/api/dashboard/send-email.ts` — Nuevo endpoint
- `src/components/dashboard/DashboardApp.tsx` — UI de email builder
- `supabase/migration-v5.sql` — Tabla `sent_emails`
- `.env` — `RESEND_API_KEY`

**Dependencia:** `npm install resend`

**Criterio de aceptacion:** Desde el dashboard puedes enviar un email personalizado a un lead con un click.

---

## FASE 14: i18n + Contenido Estatico

**Objetivo:** Version en ingles + paginas de servicios para SEO + case studies.

**Duracion estimada:** 3-4 horas

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Deteccion idioma en el chat | ALTA | El agente detecta si el visitante escribe en ingles y responde en ingles. Sin necesidad de i18n en la UI |
| Paginas de servicios estaticas | ALTA | `/servicios/branded-content`, `/servicios/cortometraje`, `/servicios/postproduccion` — texto SEO en es/en |
| Case studies (cuando haya contenido) | MEDIA | `/proyectos/[slug]` con brief → proceso → resultado → metricas. Empezar con el cortometraje entregado |
| Sitemap basico | BAJA | `@astrojs/sitemap` para Google indexe las paginas estaticas |

**Enfoque SEO:** La web HUD no indexa bien en Google. Las paginas de servicios son contenido estatico que SI indexa. No es blackhat, es arquitectura de contenido normal. El SEO organico no sera el canal principal — LinkedIn y referencias directas son mas importantes para el target B2B.

**Archivos afectados:**
- `src/pages/servicios/[slug].astro` — Nuevo
- `src/pages/proyectos/[slug].astro` — Nuevo
- `src/hooks/ChatContext.tsx` — Deteccion de idioma
- `astro.config.mjs` — Plugin sitemap

**Criterio de aceptacion:** Google puede indexar las paginas de servicios. El chat responde en ingles si el visitante escribe en ingles.

---

## FASE 15: Deploy Produccion

**Objetivo:** Publicar en akrasia.studio.

**Duracion estimada:** 1 hora

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Ejecutar migraciones SQL | URGENTE | `migration-v3.sql` y `migration-v4.sql` en Supabase SQL Editor |
| Conectar Vercel | ALTA | Repo Git → Vercel. Deploy automatico por push |
| Variables de entorno | ALTA | Todas las env vars en Vercel dashboard |
| DNS akrasia.studio | ALTA | Apuntar a Vercel + SSL automatico |
| Testeo end-to-end | ALTA | Flujo completo: chat → lead → dashboard → email |
| Lighthouse audit | MEDIA | Performance > 90, lazy load imagenes |

**Pre-requisitos completados:**
- [ ] Rate limiting en chat (Fase 8)
- [ ] PIN dashboard (Fase 8)
- [ ] SEO meta tags (Fase 8)
- [ ] Todas las migraciones SQL ejecutadas

**Criterio de aceptacion:** La web esta publicada, el chat funciona, el dashboard es accesible, leads llegan a Telegram.

---

## Orden de Ejecucion Recomendado

```
FASE 8  (Seguridad + SEO)          → 1-2h   — ANTES del deploy
FASE 9  (Analytics + Graficas)     → 2-3h   — Pre-deploy, nice to have
FASE 10 (Telegram Bidireccional)   → 2-3h   — Post-deploy
FASE 11 (Memoria IA)               → 2-3h   — Post-deploy
FASE 12 (Booking + Qualifier)      → 2-3h   — Post-deploy
FASE 13 (Email Builder)            → 3-4h   — Post-deploy
FASE 14 (i18n + Contenido)         → 3-4h   — Post-deploy
FASE 15 (Deploy)                   → 1h     — Cuando todo este listo
```

**Total estimado:** 16-23 horas de desarrollo

---

## Backlog Post-Deploy

| Tarea | Cuando |
|-------|--------|
| LinkedIn feed integrado | Cuando empieces redes sociales |
| Case studies con metricas | Cuando tengas proyectos documentados |
| PostHog analytics | Cuando haya 500+ visitas/mes |
| Supabase Auth (multi-usuario) | Si necesitas dar acceso a otras personas |
| Calculadora de precios en chat | Solo si el modelo de negocio lo permite sin riesgo |

---

## Timeline Estimado

```
SEMANA 1:  FASE 0 + FASE 1 (shell estatico)                    ✅
SEMANA 2:  FASE 2 (migracion Astro + datos dinamicos)           ✅
SEMANA 3:  FASE 3 (chat con IA) + FASE 4 (leads + Supabase)     ✅
SEMANA 4:  FASE 5 (admin dashboard)                              ✅
SEMANA 5:  FASE 6 (pulido) + FASE 7 (responsive)                ✅
SEMANA 6:  FASE 8 (seguridad + SEO)                              ← AHORA
SEMANA 7:  FASE 9-10 (analytics + telegram)
SEMANA 8:  FASE 11-12 (memoria IA + booking)
SEMANA 9:  FASE 13-14 (email + i18n)
SEMANA 10: FASE 15 (deploy produccion)
```

---

## Notas

- Cada fase produce codigo funcional y deployable.
- Se puede hacer deploy en cualquier momento despues de FASE 8.
- Las fases son incrementales: cada una anade sobre la anterior sin reescribir.
- Fase 8 (rate limiting) es urgente antes de poner la web publica.
- PIN de dashboard es suficiente para un solo usuario. Supabase Auth solo si hay multi-usuario.
- SEO: las paginas de servicios estaticas indexan bien. La web HUD no depende de SEO organico — el canal principal es LinkedIn + referencias.
