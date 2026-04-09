# AKRASIA STUDIO — Roadmap de Desarrollo

> **Version:** 2.0  
> **Fecha:** 2026-04-09  
> **Ultima actualizacion:** Incorporacion de Fase 4 (Leads) y Fase 5 (Admin Dashboard)

---

## Vision General

```
FASE 0: Pre-Produccion                        ✅ COMPLETADO
FASE 1: Shell Estatico                        ✅ COMPLETADO
FASE 2: Datos Dinamicos (JSON)                ← ACTUAL
FASE 3: Chat con Agente IA                    Chat funcional con OpenAI
FASE 4: Captacion de Leads + Base de Datos    Supabase + extraccion automatica
FASE 5: Admin Dashboard                       Panel privado sin login
FASE 6: Pulido y Animaciones                  Refinamiento visual
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

## FASE 3: Chat con Agente IA

**Objetivo:** Sistema de chat funcional conectado a API de OpenAI.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| ChatInput component (React) | ALTA | Input + boton de envio |
| ChatMessage component (React) | ALTA | Mensaje individual con estilo |
| ChatPanel component (React) | ALTA | Contenedor con historial |
| Endpoint API (OpenAI) | ALTA | Endpoint seguro para respuestas |
| System prompt de Acrasia | ALTA | Personalidad y tono del agente |
| Mostrar chat en viewport | ALTA | Reemplazar overlay con chat |
| Toggle entre chat y viewport | MEDIA | Cambiar vista sin perder estado |
| Indicador "escribiendo..." | MEDIA | Feedback visual mientras responde |
| Respuestas con formato | BAJA | Markdown o HTML en respuestas |
| Historial de sesion | MEDIA | Mantener contexto en localStorage |

**Criterio de aceptacion:** El usuario puede escribir y recibir respuestas del agente Acrasia con personalidad definida.

---

## FASE 4: Captacion de Leads + Base de Datos

**Objetivo:** El chat se convierte en herramienta de captacion automatica. Supabase como backend.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Configurar proyecto Supabase | ALTA | Base de datos + API |
| Tabla `visitors` | ALTA | Identificacion anonima (cookie/localStorage) |
| Tabla `conversations` | ALTA | Historial completo de chats |
| Tabla `leads` | ALTA | Datos de contacto extraidos |
| Extraccion automatica de datos | ALTA | IA detecta email, telefono, empresa en el chat |
| Guardar conversaciones en BD | ALTA | Cada mensaje se almacena |
| Asociar visitor → conversation → lead | ALTA | Relaciones entre tablas |
| Notificacion de lead nuevo | MEDIA | Email o Telegram al capturar un lead |
| Tag automatico de leads | BAJA | Clasificar por interes (web, branding, etc.) |
| Estadisticas basicas | BAJA | Contador de visitantes y leads |

**Criterio de aceptacion:** Cuando un visitante menciona su email o telefono en el chat, se captura automaticamente como lead en Supabase.

---

## FASE 5: Admin Dashboard

**Objetivo:** Panel privado para gestionar leads, conversaciones y contenido web — sin tocar codigo, sin sistema de login.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Ruta secreta `/dashboard/{secret}` | ALTA | Acceso via URL secreta (sin login) |
| Vista de visitantes | ALTA | Lista con tags, estado (color), ultima actividad |
| Vista de conversaciones | ALTA | Historial completo por visitante |
| Vista de leads | ALTA | Datos de contacto + origen + estado |
| Exportar leads a CSV | MEDIA | Descarga de lista de leads |
| Editor de contenido web | MEDIA | Editar proyectos y servicios desde el panel |
| Metricas basicas | MEDIA | Visitas hoy, leads esta semana, pregunta mas frecuente |
| Filtros y busqueda | BAJA | Buscar por nombre, email, fecha |
| Marcar lead como contactado | BAJA | Cambiar estado del lead |

**Criterio de aceptacion:** Desde el panel se pueden ver todos los leads, leer conversaciones y editar el contenido de la web.

---

## FASE 6: Pulido y Animaciones

**Objetivo:** Refinar la experiencia visual y las animaciones.

**Duracion estimada:** 1-2 sesiones

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Animaciones de entrada | ALTA | Fade-in de paneles al cargar |
| Hover effects en thumbnails | ALTA | Zoom o reveal al pasar cursor |
| Transicion entre vistas | MEDIA | Smooth swap entre viewport y chat |
| Parallax sutil en overlay | BAJA | Movimiento del overlay con mouse |
| Sonido ambiente (opcional) | BAJA | Click en botones, envio de chat |
| Loading state | MEDIA | Pantalla de carga con logo animado |
| Micro-interacciones | BAJA | Feedback visual en cada accion |

**Criterio de aceptacion:** La experiencia se siente fluida y profesional.

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
SEMANA 2:  FASE 2 (migracion Astro + datos dinamicos)           ← ACTUAL
SEMANA 3:  FASE 3 (chat con IA) + inicio FASE 4 (leads)
SEMANA 4:  FASE 4 (leads + Supabase) + FASE 5 (admin dashboard)
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
