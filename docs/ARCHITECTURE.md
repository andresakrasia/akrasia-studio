# AKRASIA STUDIO — Arquitectura del Proyecto

> **Version:** 1.0  
> **Fecha:** 2026-04-08  

---

## Estructura de Carpetas

```
akrasia.studio/
├── docs/                          # Documentacion del proyecto
│   ├── PRD.md                     # Product Requirements Document
│   ├── BRAND_GUIDELINES.md        # Guia de marca, colores, tipografia
│   ├── ARCHITECTURE.md            # Este archivo — estructura y decisiones
│   └── ROADMAP.md                 # Plan de desarrollo por fases
│
├── src/                           # Codigo fuente
│   ├── components/                # Componentes React reutilizables
│   │   ├── layout/                # Componentes de layout
│   │   │   ├── Header.astro       # Barra superior
│   │   │   ├── Footer.astro       # Barra inferior
│   │   │   ├── LeftPanel.astro    # Panel izquierdo (info)
│   │   │   ├── CenterPanel.astro  # Panel central (viewport)
│   │   │   ├── RightPanel.astro   # Panel derecho (portfolio)
│   │   │   └── MainLayout.astro   # Layout principal grid
│   │   │
│   │   ├── ui/                    # Componentes UI atomicos
│   │   │   ├── CyberBorder.astro  # Wrapper con borde cyberpunk
│   │   │   ├── AngularButton.astro # Boton con corte angular
│   │   │   ├── ProgressBar.astro  # Barra de progreso
│   │   │   ├── TimelineItem.astro # Item de timeline
│   │   │   ├── Thumbnail.astro    # Thumbnail de portfolio
│   │   │   ├── StatusDot.astro    # Indicador de estado (punto)
│   │   │   ├── SystemLog.astro    # Linea de log
│   │   │   └── RadarSpinner.astro # Radar animado central
│   │   │
│   │   ├── chat/                  # Componentes del chat
│   │   │   ├── ChatInput.tsx      # Input del chat (React — interactivo)
│   │   │   ├── ChatMessage.tsx    # Mensaje individual
│   │   │   └── ChatPanel.tsx      # Contenedor del chat
│   │   │
│   │   └── sections/              # Secciones dentro de paneles
│   │       ├── ActiveProject.astro    # Proyecto activo (left)
│   │       ├── Services.astro         # Servicios (left)
│   │       ├── AILiveFeed.astro       # Feed IA en vivo (left)
│   │       ├── ViewportOverlay.astro  # Overlay HUD central
│   │       ├── MasterTimeline.astro   # Timeline de proyectos (right)
│   │       ├── RecentOutputs.astro    # Grid de thumbnails (right)
│   │       └── SystemLogs.astro       # Logs del sistema (right)
│
│   ├── styles/                    # Estilos globales
│   │   ├── global.css             # Estilos base, efectos HUD
│   │   └── tailwind.css           # Import de Tailwind
│
│   ├── data/                      # Datos estaticos (JSON)
│   │   ├── projects.json          # Portfolio de proyectos
│   │   ├── services.json          # Lista de servicios
│   │   └── status-messages.json   # Mensajes de log simulados
│
│   ├── lib/                       # Utilidades y helpers
│   │   ├── api.ts                 # Cliente API para el chat
│   │   └── utils.ts               # Funciones utilitarias
│
│   └── pages/                     # Paginas (Astro routing)
│       └── index.astro            # Pagina principal (unica por ahora)
│
├── public/                        # Archivos estaticos (sin procesar)
│   ├── assets/
│   │   ├── logo/                  # Logo en diferentes formatos
│   │   ├── portfolio/             # Videos y thumbnails de portfolio
│   │   └── robot/                 # Imagenes del robot mascota
│   ├── favicon.svg                # Favicon
│   └── robots.txt                 # SEO
│
├── .gitignore                     # Archivos ignorados por Git
├── astro.config.mjs               # Configuracion de Astro
├── tailwind.config.mjs            # Configuracion de Tailwind
├── tsconfig.json                  # Configuracion TypeScript
├── package.json                   # Dependencias
└── README.md                      # Info del proyecto (solo si se necesita)
```

---

## Decisiones Arquitectonicas

### Por que Astro + React?

| Razon | Detalle |
|-------|---------|
| **Performance** | Astro genera HTML estatico por defecto. Solo hidrata componentes interactivos. |
| **Componentes** | React para el chat y elementos interactivos. Astro para layout estatico. |
| **SEO** | HTML pre-renderizado = mejor indexacion. |
| **Escalabilidad** | Se puede anadir React/Vue/Svelte segun necesidad sin reescribir. |
| **Zero JS por defecto** | Solo los componentes marcados como interactivos cargan JavaScript. |

### Separacion de Responsabilidades

```
Astro Components (.astro)  →  Layout, estructura, contenido estatico
React Components (.tsx)     →  Chat, interactividad, estado dinamico
JSON Data                   →  Portfolio, servicios, configuracion
CSS/Tailwind                →  Estilos, efectos HUD, responsive
```

### Convenciones

1. **Un componente = un archivo**. Sin mezclar componentes en un mismo archivo.
2. **Nombres en PascalCase** para componentes: `CyberBorder.astro`, `ChatInput.tsx`.
3. **Nombres en kebab-case** para archivos de datos: `projects.json`.
4. **Props tipadas** en todos los componentes React.
5. **Sin logica de negocio en componentes Astro** — solo layout y presentacion.
6. **Datos en JSON** — no hardcodear contenido en componentes.

---

## Flujo de Datos

```
projects.json → Astro carga datos → Genera HTML estatico (timeline, thumbnails)
                                     ↓
                              Usuario hace clic en thumbnail
                                     ↓
                              React (ChatPanel) gestiona estado
                                     ↓
                              Video se muestra en viewport central
                                     ↓
                              Chat input → API → Respuesta del agente
```

---

## Git Strategy

```
main        → Produccion (deploy automatico)
├── dev     → Desarrollo activo
├── feat/*  → Nuevas funcionalidades
└── fix/*   → Correcciones
```

### Convencion de Commits

```
feat: anadir componente de chat interactivo
fix: corregir overlay en viewport central
style: ajustar espaciado en left panel
docs: actualizar PRD con nuevos requisitos
refactor: separar timeline en componente independiente
```
