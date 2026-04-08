# AKRASIA STUDIO — Roadmap de Desarrollo

> **Version:** 1.0  
> **Fecha:** 2026-04-08  

---

## FASE 0: Pre-Produccion (ACTUAL)

**Objetivo:** Documentacion, planificacion y preparacion del entorno.

| Tarea | Estado | Notas |
|-------|--------|-------|
| Analizar codigo original | COMPLETADO | HTML extraido y documentado |
| Definir PRD | COMPLETADO | `docs/PRD.md` |
| Definir Brand Guidelines | COMPLETADO | `docs/BRAND_GUIDELINES.md` |
| Definir Arquitectura | COMPLETADO | `docs/ARCHITECTURE.md` |
| Definir Roadmap | COMPLETADO | Este documento |
| Inicializar repositorio Git | PENDIENTE | `git init` + estructura base |
| Inicializar proyecto Astro | PENDIENTE | `npm create astro@latest` |
| Configurar Tailwind | PENDIENTE | Plugin + configuracion de marca |
| Preparar assets | PENDIENTE | Copiar logo, robot, videos |

**Entregable:** Repositorio inicializado con documentacion completa y entorno configurado.

---

## FASE 1: Shell Estatico

**Objetivo:** Layout completo con HTML/CSS estatico. Sin interactividad.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| Layout grid 3 columnas | ALTA | Header + Main(3 cols) + Footer |
| Header | ALTA | Logo + status bar + CTA |
| Footer | ALTA | Links + copyright + status |
| Left Panel — estructura | ALTA | Paneles con contenido placeholder |
| Left Panel — Proyecto Activo | ALTA | Componente con nombre + progress bar |
| Left Panel — Servicios | MEDIA | Lista de servicios del estudio |
| Left Panel — AI Feed | MEDIA | Feed de logs simulados |
| Center Panel — Viewport | ALTA | Imagen/video de fondo + overlay |
| Center Panel — Radar | MEDIA | Circulo animado con spin |
| Center Panel — HUD Overlay | ALTA | Datos tecnicos superpuestos |
| Right Panel — Timeline | ALTA | Linea de tiempo de proyectos |
| Right Panel — Thumbnails | ALTA | Grid 2x2 de portfolio |
| Right Panel — System Logs | MEDIA | Logs decorativos |
| Efectos HUD | MEDIA | Scanlines, dot grid, glitch text |
| Responsive basico | BAJA | Stack en movil (primera version) |

**Criterio de aceptacion:** La web se ve identica al diseno original pero con contenido adaptado a Acrasia Studio.

---

## FASE 2: Datos Dinamicos

**Objetivo:** Contenido cargado desde JSON. Sistema de datos para portfolio.

**Duracion estimada:** 1-2 sesiones

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| projects.json | ALTA | Definir schema de proyectos |
| services.json | MEDIA | Lista de servicios con descripcion |
| Cargar portfolio desde JSON | ALTA | Timeline y thumbnails dinamicos |
| Click en thumbnail → viewport | ALTA | Mostrar video/imagen seleccionado |
| Animacion de transicion | MEDIA | Fade/swap al cambiar contenido |
| Status messages dinamicos | BAJA | Rotacion de mensajes de log |

**Criterio de aceptacion:** Anadir un nuevo proyecto solo requiere editar el JSON.

---

## FASE 3: Chat con Agente IA

**Objetivo:** Sistema de chat funcional conectado a API de IA.

**Duracion estimada:** 2-3 sesiones

| Tarea | Prioridad | Descripcion |
|-------|-----------|-------------|
| ChatInput component | ALTA | Input + boton de envio (React) |
| ChatMessage component | ALTA | Mensaje individual con estilo |
| ChatPanel component | ALTA | Contenedor con historial |
| Integracion API (OpenAI) | ALTA | Endpoint para respuestas |
| System prompt del agente | ALTA | Personalidad de Acrasia |
| Mostrar chat en viewport | ALTA | Reemplazar overlay con chat |
| Toggle entre chat y viewport | MEDIA | Cambiar vista sin perder estado |
| Indicador "escribiendo..." | MEDIA | Feedback visual mientras responde |
| Respuestas con formato | BAJA | Markdown o HTML en respuestas |

**Criterio de aceptacion:** El usuario puede escribir y recibir respuestas del agente Acrasia.

---

## FASE 4: Pulido y Animaciones

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

**Criterio de aceptacion:** La experiencia se siente fluida y profesional.

---

## FASE 5: Responsive y Accesibilidad

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

## FASE 6: Deploy y Produccion

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

**Criterio de aceptacion:** La web esta publicada y accesible en akrasia.studio.

---

## Timeline Estimado

```
SEMANA 1:  FASE 0 + FASE 1 (shell estatico)
SEMANA 2:  FASE 2 (datos dinamicos) + inicio FASE 3 (chat)
SEMANA 3:  FASE 3 (chat completo) + FASE 4 (pulido)
SEMANA 4:  FASE 5 (responsive) + FASE 6 (deploy)
```

---

## Notas

- Cada fase produce codigo funcional y deployable.
- Se puede hacer deploy en cualquier momento despues de FASE 1.
- Las fases son incrementales: cada una anade sobre la anterior sin reescribir.
- Si alguna fase requiere cambios en el PRD o Brand Guidelines, actualizar la documentacion primero.
