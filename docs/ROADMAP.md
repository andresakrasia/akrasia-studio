# AKRASIA STUDIO — Roadmap de Desarrollo

> **Version:** 3.0  
> **Fecha:** 2026-04-09  
> **Ultima actualizacion:** Fase 5 completada

---

## Vision General

```
FASE 0: Pre-Produccion                        ✅ COMPLETADO
FASE 1: Shell Estatico                        ✅ COMPLETADO
FASE 2: Datos Dinamicos (JSON)                ✅ COMPLETADO
FASE 3: Chat con Agente IA                    ✅ COMPLETADO
FASE 4: Captacion de Leads + Base de Datos    ✅ COMPLETADO
FASE 5: Admin Dashboard                       ✅ COMPLETADO
FASE 6: Pulido y Animaciones                  ← ACTUAL
FASE 7: Responsive y Accesibilidad            Multi-dispositivo
FASE 8: Deploy y Produccion                   Publicacion en akrasia.studio
```

---

## FASE 0: Pre-Produccion ✅

**Objetivo:** Documentacion, planificacion y preparacion del entorno.

| Tarea | Estado | Notas |
|-------|--------|-------|
| Analizar codigo original | ✅ COMPLETADO | HTML extraido y documentado |
| Definir PRD | ✅ COMPLETADO | `docs/PRD.md` |
| Definir Brand Guidelines | ✅ COMPLETADO | `docs/BRAND_GUIDELINES.md` |
| Definir Arquitectura | ✅ COMPLETADO | `docs/ARCHITECTURE.md` |
| Definir Roadmap | ✅ COMPLETADO | Este documento |
| Inicializar repositorio Git | ✅ COMPLETADO | Repo privado en GitHub |
| Inicializar proyecto Astro | PENDIENTE | `npm create astro@latest` |
| Configurar Tailwind | PENDIENTE | Plugin + configuracion de marca |
| Preparar assets | PENDIENTE | Copiar logo, robot, videos |

**Entregable:** Repositorio inicializado con documentacion completa y entorno configurado.

---

## FASE 1: Shell Estatico ✅

**Objetivo:** Layout completo con HTML/CSS estatico. Sin interactividad real.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Estado |
|-------|-----------|--------|
| Layout grid 3 columnas | ALTA | ✅ Implementado en mockup.html |
| Header (logo + status + CTA) | ALTA | ✅ |
| Footer (links + copyright) | ALTA | ✅ |
| Left Panel — Proyecto Activo | ALTA | ✅ Con progress bar |
| Left Panel — Servicios | MEDIA | ✅ Con animacion de rotacion |
| Left Panel — AI Feed | MEDIA | ✅ Feed de logs simulados |
| Center Panel — Viewport | ALTA | ✅ Imagen de fondo + overlay |
| Center Panel — Radar | MEDIA | ✅ Circulo animado con spin |
| Center Panel — HUD Overlay | ALTA | ✅ Datos tecnicos superpuestos |
| Right Panel — Timeline | ALTA | ✅ Linea de tiempo de proyectos |
| Right Panel — Thumbnails | ALTA | ✅ Grid 2x2 de portfolio |
| Right Panel — System Logs | MEDIA | ✅ Logs decorativos |
| Efectos HUD (scanlines, dot grid, glitch) | MEDIA | ✅ |
| Chat demo con respuestas aleatorias | ALTA | ✅ Typewriter effect + burbujas |
| Chat overlay movil | ALTA | ✅ FAB + overlay completo |
| Responsive basico | BAJA | ✅ Stack en movil |

**Entregable:** `mockup.html` — Shell estatico completo con chat demo funcional.

---

## FASE 2: Datos Dinamicos (JSON) ← ACTUAL

**Objetivo:** Migrar mockup a Astro. Contenido cargado desde JSON. Sistema de datos para portfolio.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Inicializar proyecto Astro | ALTA | `npm create astro` con React + Tailwind |
| Configurar Tailwind (colores, fuentes) | ALTA | Replicar config de mockup |
| Componente Layout principal | ALTA | Grid 3 columnas responsive |
| Componente Header | ALTA | Logo + status bar + CTA |
| Componente Footer | ALTA | Links + copyright |
| Componente LeftPanel | ALTA | Paneles de proyecto, servicios, AI feed |
| Componente Viewport (Center) | ALTA | Imagen/video + radar + HUD |
| Componente RightPanel | ALTA | Timeline + thumbnails + logs |
| Componente Chat | ALTA | Input + mensajes + typewriter |
| projects.json | ALTA | Schema de proyectos con datos reales |
| services.json | MEDIA | Lista de servicios con descripcion |
| Cargar portfolio desde JSON | ALTA | Timeline y thumbnails dinamicos |
| Click en thumbnail → viewport | ALTA | Mostrar imagen/video seleccionado |
| Animacion de transicion | MEDIA | Fade/swap al cambiar contenido |
| Status messages dinamicos | BAJA | Rotacion de mensajes de log |
| Efecto glass-panel | ALTA | Preservar borderSweep y conic-gradient |
| Chat overlay movil | ALTA | FAB + overlay responsive |

**Criterio de aceptacion:** El sitio Astro es visualmente identico al mockup. Anadir un proyecto solo requiere editar JSON.

**Branch:** `fase-2`

---

## FASE 3: Chat con Agente IA ✅

**Objetivo:** Sistema de chat funcional conectado a API de OpenAI.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Descripcion | Estado |
|-------|-----------|-------------|--------|
| Endpoint API (OpenAI) | ALTA | Endpoint seguro con streaming SSE | ✅ `/api/chat` |
| System prompt de Acrasia | ALTA | Personalidad y tono del agente | ✅ `src/data/systemPrompt.ts` |
| ChatInput + ChatMessage + ChatPanel (React) | ALTA | Componentes integrados en ChatWrapper | ✅ |
| ChatContext compartido | ALTA | Estado sincronizado desktop/mobile | ✅ React Context + Portal |
| Streaming visual en tiempo real | ALTA | Texto aparece progresivamente | ✅ SSE + ReadableStream |
| Indicador "escribiendo..." | MEDIA | Feedback visual mientras responde | ✅ |
| Historial de sesion (localStorage) | MEDIA | Mantener contexto entre visitas | ✅ MAX 50 mensajes |
| Respuestas con formato | BAJA | Markdown o HTML en respuestas | ✅ FormattedText.tsx |
| Toggle entre chat y viewport | MEDIA | Cambiar vista sin perder estado | PENDIENTE |

**Criterio de aceptacion:** El usuario puede escribir y recibir respuestas del agente Acrasia con personalidad definida.

**Branch:** `fase-3`

---

## FASE 4: Captacion de Leads + Base de Datos ✅

**Objetivo:** El chat se convierte en herramienta de captacion automatica. Supabase como backend.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Descripcion | Estado |
|-------|-----------|-------------|--------|
| Configurar proyecto Supabase | ALTA | Base de datos + API | ✅ REST API directa |
| Tabla `visitors` | ALTA | Identificacion anonima (localStorage UUID) | ✅ |
| Tabla `conversations` | ALTA | Historial completo de chats | ✅ |
| Tabla `messages` | ALTA | Mensajes individuales de chat | ✅ |
| Tabla `leads` | ALTA | Datos de contacto extraidos | ✅ |
| Extraccion automatica de datos | ALTA | Regex detecta email, telefono, tipo proyecto | ✅ `extractContactData.ts` |
| Guardar conversaciones en BD | ALTA | Cada mensaje se almacena via PostgREST | ✅ |
| Asociar visitor → conversation → lead | ALTA | Relaciones entre tablas | ✅ |
| Notificacion de lead nuevo | MEDIA | Telegram al capturar un lead | ✅ `notify.ts` |
| Tag automatico de leads | BAJA | Clasificar por tipo proyecto | ✅ project_type en leads |
| Estadisticas basicas | BAJA | Contador de visitantes y leads | DEFERIDO → Fase 5 |

**Criterio de aceptacion:** Cuando un visitante menciona su email o telefono en el chat, se captura automaticamente como lead en Supabase.

---

## FASE 5: Admin Dashboard ✅

**Objetivo:** Panel privado para gestionar leads, conversaciones y contenido web — sin tocar codigo, sin sistema de login.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Descripcion | Estado |
|-------|-----------|-------------|--------|
| Ruta secreta `/dashboard/{secret}` | ALTA | Acceso via URL secreta (sin login) | ✅ |
| Vista de visitantes | ALTA | Lista con ultima actividad, busqueda, ver conversaciones | ✅ |
| Vista de conversaciones | ALTA | Historial completo expandible por conversacion | ✅ |
| Vista de leads | ALTA | Tabla con estado, filtros, cambio de estado inline | ✅ |
| Exportar leads a CSV | MEDIA | Descarga de lista completa de leads | ✅ `/api/dashboard/export` |
| Editor de contenido web | MEDIA | Editar proyectos y servicios (JSON) desde el panel | ✅ Via Supabase `content` table |
| Metricas basicas | MEDIA | Visitas hoy, leads semana, leads por estado | ✅ |
| Filtros y busqueda | BAJA | Buscar por nombre, email, fecha | ✅ |
| Marcar lead como contactado | BAJA | Cambiar estado del lead via dropdown | ✅ |

**Criterio de aceptacion:** Desde el panel se pueden ver todos los leads, leer conversaciones y editar el contenido de la web. ✅

**Archivos creados:**
- `src/pages/dashboard/[secret].astro` — Pagina del dashboard
- `src/components/dashboard/DashboardApp.tsx` — React SPA con 5 tabs
- `src/lib/dashboard.ts` — Helper compartido (auth + Supabase queries)
- `src/pages/api/dashboard/` — 6 API endpoints (visitors, conversations, leads, metrics, content, export)
- `supabase/migration-v2.sql` — Tabla `content` para editor web

**Branch:** `fase-5`

---

## FASE 6: Pulido y Animaciones

**Objetivo:** Refinar la experiencia visual y las animaciones.

**Duracion estimada:** 1-2 sesiones

| Tarea | Prioridad | Descripcion | Estado |
|-------|-----------|-------------|--------|
| Pantalla de carga con logo | ALTA | Loader animado con barra de progreso + logo AKRASIA | ✅ `#akrasia-loader` |
| Fade-in de paneles al cargar | ALTA | Header, Left, Center, Right, Footer con delays escalonados | ✅ `.fade-in-panel` |
| Hover effects en thumbnails | ALTA | Glow border + play icon reveal + image zoom | ✅ `.thumb-card::after` |
| Transicion entre vistas | MEDIA | Smooth backdrop blur reveal al abrir chat | ✅ `.chatRevealIn` |
| Parallax sutil en overlay | BAJA | Movimiento del HUD overlay con mouse | ✅ `.hud-overlay-parallax` |
| Micro-interacciones | BAJA | Pulse en botones, slide-in en feed/logs, timeline hover | ✅ `.btn-pulse`, `.feed-entry-new`, `.log-entry-new` |

**Criterio de aceptacion:** La experiencia se siente fluida y profesional. ✅

---

## FASE 7: Responsive y Accesibilidad

**Objetivo:** La web funciona perfectamente en todos los dispositivos.

**Duracion estimada:** 1-2 sesiones

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Responsive movil | ALTA | Stack vertical, scroll entre paneles |
| Responsive tablet | ALTA | Layout adaptado a pantalla media |
| Navegacion en movil | ALTA | Menu hamburguesa o tabs |
| Touch interactions | MEDIA | Swipe entre paneles en movil |
| Accesibilidad basica | MEDIA | Contrast ratio, aria labels |
| Keyboard navigation | BAJA | Tab navigation funcional |

**Criterio de aceptacion:** La web es usable en iPhone, Android y tablets.

---

## FASE 8: Deploy y Produccion

**Objetivo:** Publicar la web en el dominio akrasia.studio.

**Duracion estimada:** 1 sesion

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Configurar Vercel/Netlify | ALTA | Deploy automatico desde Git |
| Dominio akrasia.studio | ALTA | DNS y SSL |
| SEO meta tags | ALTA | Title, description, og:image |
| Favicon | ALTA | Logo como favicon |
| Performance audit | MEDIA | Lighthouse score > 90 |
| Analytics (opcional) | BAJA | Google Analytics o similar |
| Error pages | BAJA | 404 custom |
| Variables de entorno | ALTA | API keys, URL secreta, Supabase creds |

**Criterio de aceptacion:** La web esta publicada y accesible en akrasia.studio.

---

## Timeline Estimado

```
SEMANA 1:  FASE 0 + FASE 1 (shell estatico)                    ✅
SEMANA 2:  FASE 2 (migracion Astro + datos dinamicos)           ✅
SEMANA 3:  FASE 3 (chat con IA) + FASE 4 (leads + Supabase)     ✅
SEMANA 4:  FASE 5 (admin dashboard)                              ← ACTUAL
SEMANA 5:  FASE 6 (pulido) + FASE 7 (responsive)
SEMANA 6:  FASE 8 (deploy y produccion)
```

---

## Notas

- Cada fase produce codigo funcional y deployable.
- Se puede hacer deploy en cualquier momento despues de FASE 2.
- Las fases son incrementales: cada una anade sobre la anterior sin reescribir.
- Si alguna fase requiere cambios en el PRD o Brand Guidelines, actualizar la documentacion primero.
- **Fase 4 y 5 son el valor diferencial del proyecto:** convierten la web en una herramienta activa de captacion de clientes.
