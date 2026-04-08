# AKRASIA STUDIO — Product Requirements Document (PRD)

> **Version:** 1.0  
> **Fecha:** 2026-04-08  
> **Proyecto:** Web oficial de Acrasia Studio — Productora Audiovisual basada en IA  
> **Dominio:** akrasia.studio  

---

## 1. Vision General

AKRASIA STUDIO es una productora audiovisual que utiliza inteligencia artificial como motor creativo. La web debe funcionar como un **Command Center** inmersivo donde el visitante experimenta la interfaz como si estuviera dentro de un entorno de produccion cinematografica con IA.

### 1.1 Propuesta de valor

- La web NO es un portfolio tradicional. Es una **experiencia interactiva** tipo HUD (Heads-Up Display).
- El usuario no navega por menus; **interactua con un agente de IA** que le proporciona informacion, presupuestos y contenido.
- El diseno transmite: "El futuro de la produccion audiovisual ya esta aqui".

### 1.2 Publico objetivo

| Segmento | Descripcion |
|----------|------------|
| Agencias de publicidad | Buscan produccion audiovisual innovadora con IA |
| Directores / Creativos | Quieren explorar nuevas herramientas narrativas |
| Marcas / Empresas | Necesitan contenido visual de alta calidad |
| Eventos / Festivales | Proyecciones, instalaciones, experiencias inmersivas |

---

## 2. Layout y Estructura

La web se organiza en un grid de **3 columnas** que ocupa toda la pantalla (fullscreen, sin scroll).

```
+------------------------------------------------------------------+
|  HEADER — Logo + Status Bar + CTA                                |
+----------+---------------------------+----------------------------+
|          |                           |                            |
| LEFT     |  CENTER                   |  RIGHT                     |
| PANEL    |  (Viewport Principal)     |  PANEL                     |
| 2 cols   |  7 cols                   |  3 cols                    |
|          |                           |                            |
| - Sobre  |  - Video/Imagen principal |  - Master Timeline         |
|   nosotros|  - Overlay HUD           |    (ultimos trabajos)      |
| - Servicios| - Radar animado         |  - Recent Outputs          |
| - Estado |  - Datos tecnicos         |    (grid de thumbnails)    |
|   del    |                           |  - System Logs             |
|   sistema|  + PROMPT INPUT           |                            |
|          |    (chat con agente)      |                            |
+----------+---------------------------+----------------------------+
|  FOOTER — Links + Copyright + Status                              |
+------------------------------------------------------------------+
```

### 2.1 Header

- **Logo AKRASIA** (izquierda) con texto `AKRASIA // STUDIO`
- **Barra de estado central**: indicadores del sistema (simulados)
- **CTA derecha**: boton de accion principal (`CONTACTAR` / `INICIAR PROYECTO`)
- **Indicador**: `● EN DIRECTO` con timestamp

### 2.2 Left Panel (col-span-2) — Informacion

Contenido adaptado a productora audiovisual:

| Seccion | Contenido |
|---------|-----------|
| **Proyecto Activo** | Nombre del ultimo proyecto destacado + barra de progreso |
| **Servicios** | Lista de servicios: Direction, Post, VFX, Sound, AI Gen |
| **Sobre Nosotros** | Mini texto de identidad |
| **Estado en Vivo** | Logs simulados de actividad del estudio |

### 2.3 Center Panel (col-span-7) — Viewport Principal

- **Fondo**: Video o imagen del ultimo trabajo / showcase
- **Overlay HUD**: Datos tecnicos superpuestos (resolucion, formato, etc.)
- **Radar animado**: Elemento central giratorio que representa el motor de IA
- **Prompt Input**: Barra inferior tipo terminal donde el usuario escribe al agente de Acrasia
  - Placeholder: `Escribe tu mensaje al agente Acrasia...`
  - Boton: `ENVIAR`

### 2.4 Right Panel (col-span-3) — Portfolio y Timeline

| Seccion | Contenido |
|---------|-----------|
| **Master Timeline** | Linea de tiempo con los ultimos proyectos/escenas |
| **Recent Outputs** | Grid 2x2 de thumbnails de videos recientes |
| **System Logs** | Logs simulados de la actividad del estudio |

### 2.5 Footer

- Links: `MANIFIESTO` | `PROYECTOS` | `CONTACTO`
- Centro: `AKRASIA.STUDIO // AI_CINEMA_ENGINE // 2024`
- Derecha: Status de sesion

---

## 3. Funcionalidades Principales

### 3.1 Chat con Agente Acrasia (Prioridad ALTA)

- Input de texto en la seccion central inferior
- El usuario escribe preguntas, solicita presupuestos, pide informacion
- El agente responde inline (reemplaza o complementa el contenido central)
- **Requisito tecnico**: Integracion con API de IA (OpenAI / personalizado)
- Las respuestas aparecen como mensajes tipo chat dentro del viewport

### 3.2 Portfolio Dinamico (Prioridad ALTA)

- Los thumbnails del right panel son clicables
- Al hacer clic, el video/imagen se muestra en el viewport central
- Los proyectos se cargan desde un archivo de datos (JSON)

### 3.3 Animaciones y Efectos HUD (Prioridad MEDIA)

- Scanlines sobre toda la pantalla
- Grid de puntos (dot grid) como fondo
- Glitch text en titulos
- Bordes cyberpunk con esquinas iluminadas en cyan
- Radar circular animado con spin
- Clases CSS: `.hud-scanline`, `.cyber-border`, `.glitch-text`, `.angular-cut`, `.data-grid`

### 3.4 Responsive Design (Prioridad MEDIA)

- En movil: las 3 columnas se apilan verticalmente
- El viewport central pasa a ser full-width
- Los paneles laterales se convierten en secciones con scroll

---

## 4. Paleta de Colores (Brand Colors)

| Nombre | Hex | Uso |
|--------|-----|-----|
| **Primary / Cyan** | `#00f0ff` | Acentos, bordes, textos destacados, CTAs |
| **Background** | `#050505` | Fondo principal |
| **Panel** | `#0a0a0a` | Fondo de paneles |
| **Panel Border** | `#1a1a1a` | Bordes de paneles |
| **Accent Dim** | `#003a3d` | Tintes de acento sutiles |
| **Text Primary** | `#94a3b8` (slate-300) | Texto cuerpo |
| **Text Muted** | `#64748b` (slate-500) | Texto secundario |
| **Text Dim** | `#475569` (slate-600) | Texto terciario |
| **Success** | `#22c55e` (green-500) | Estados de exito en logs |
| **Warning** | `#eab308` (yellow-500) | Alertas en logs |

### 4.1 Reglas de Color

- **NUNCA** usar colores claros como fondo. El fondo siempre es oscuro (#050505).
- El cyan (#00f0ff) se usa UNICAMENTE para acentos y elementos interactivos.
- Los textos son siempre tonos de gris/slate para mantener legibilidad.
- Los bordes son sutiles (#1a1a1a) para crear profundidad sin ruido visual.
- El efecto glitch usa sombras cyan + magenta muy sutiles.

---

## 5. Tipografia

| Fuente | Uso | Pesos |
|--------|-----|-------|
| **Space Grotesk** | Titulos, headlines, nombres de seccion | 300-700 |
| **JetBrains Mono** | Body text, datos, labels, inputs, logs | 200-800 |

### 5.1 Escala tipografica

| Elemento | Tamano | Fuente | Peso |
|----------|--------|--------|------|
| Headline principal | `text-2xl` | Space Grotesk | 900 (font-black) |
| Titulo de seccion | `text-[10px]` | JetBrains Mono | 400, uppercase, tracking-widest |
| Label de datos | `text-[8px]` - `text-[9px]` | JetBrains Mono | 400 |
| Body text | `text-sm` | JetBrains Mono | 400 |
| Input | `text-sm` | JetBrains Mono | 400 |
| Footer | `text-[9px]` | JetBrains Mono | 400 |

---

## 6. Assets Necesarios

| Asset | Formato | Ubicacion actual |
|-------|---------|-----------------|
| Logo Acrasia | PNG | `/Logo/Logo akrasia.png` |
| Logo nuevo (rebrand) | PNG | `/Logo/rebrand/logo new.png` |
| Logo animado | MP4 | `/Logo/Logo animado/1.mp4`, `2.mp4` |
| Robot vistas | PNG | `/Robot/back.png`, `front.png`, `left.png`, `right.png` |
| Videos portfolio | MP4 | Por definir |
| Thumbnails portfolio | JPG/WebP | Por definir |

---

## 7. Requisitos Tecnicos

### 7.1 Stack Tecnológico

| Capa | Tecnologia | Razon |
|------|-----------|-------|
| Framework | **Astro** + **React** | Static site con componentes interactivos |
| Estilos | **Tailwind CSS** | Utilidades, dark mode, responsive |
| Fuentes | Google Fonts (Space Grotesk, JetBrains Mono) | Carga rapida via CDN |
| Iconos | Material Symbols Outlined | Consistencia visual |
| Chat/IA | API REST (OpenAI o custom) | Agente conversacional |
| Deploy | **Vercel** o **Netlify** | CI/CD automatico |
| Hosting | Dominio akrasia.studio | SSL incluido |

### 7.2 Estructura de Datos

```json
{
  "projects": [
    {
      "id": "neon-odyssey",
      "title": "NEON_ODYSSEY",
      "scene": "SCENE_01: THE_VOID",
      "duration": "04:12",
      "status": "done",
      "thumbnail": "/assets/portfolio/neon-odyssey-thumb.jpg",
      "video": "/assets/portfolio/neon-odyssey.mp4",
      "resolution": "7680x4320",
      "category": "commercial"
    }
  ]
}
```

### 7.3 Performance

- Lazy loading de imagenes y videos
- Videos en viewport: autoplay muted loop
- Fonts preload con `display=swap`
- CSS y JS minimizados en produccion
- Target: Lighthouse score > 90

### 7.4 SEO

- Meta tags completos (title, description, og:image)
- Schema markup para organizacion creativa
- Sitemap.xml
- robots.txt

---

## 8. Limitaciones y Consideraciones

- **No scroll**: La experiencia es fullscreen. Todo debe caber en viewport.
- **Simulacion**: Los "datos del sistema" (GPU, logs, timelines) son decorativos inicialmente.
- **El chat es la navegacion**: Los usuarios no buscan menus, preguntan al agente.
- **Accesibilidad**: El diseno cyberpunk puede ser un reto. Proporcionar alternativas claras.
- **Movil**: La experiencia full-HUD es compleja en movil. Version simplificada necesaria.

---

## 9. Criterios de Aceptacion

- [ ] Layout 3 columnas responde correctamente en desktop
- [ ] Chat funcional conectado a API de IA
- [ ] Portfolio carga proyectos desde JSON
- [ ] Click en thumbnail reproduce video en viewport central
- [ ] Animaciones HUD funcionan sin afectar rendimiento
- [ ] Responsive en tablet y movil
- [ ] Logo y branding coherentes
- [ ] Colores de marca aplicados consistentemente
- [ ] Tiempo de carga < 3 segundos
