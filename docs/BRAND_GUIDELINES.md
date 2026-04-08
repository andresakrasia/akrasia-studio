# AKRASIA STUDIO — Brand Guidelines v1.0

> **Version:** 1.0  
> **Fecha:** 2026-04-08  
> **Documento de referencia para todo cambio en la web**

---

## 1. Identidad

**Nombre:** AKRASIA STUDIO  
**Tagline:** AI-Powered Cinema Engine  
**Dominio:** akrasia.studio  

AKRASIA es una productora audiovisual donde la inteligencia artificial no es una herramienta, es el motor creativo. La marca comunica: precision, futuro, control cinematografico, y la convergencia entre arte y tecnologia.

---

## 2. Paleta de Colores

### 2.1 Colores Primarios

```
PRIMARY (Cyan)     ████████  #00f0ff  rgb(0, 240, 255)
BACKGROUND         ████████  #050505  rgb(5, 5, 5)
PANEL              ████████  #0a0a0a  rgb(10, 10, 10)
```

### 2.2 Colores Secundarios

```
PANEL_BORDER       ████████  #1a1a1a  rgb(26, 26, 26)
ACCENT_DIM         ████████  #003a3d  rgb(0, 58, 61)
```

### 2.3 Colores de Texto

```
TEXT_PRIMARY       ████████  #94a3b8  (slate-300)  — Texto principal
TEXT_MUTED         ████████  #64748b  (slate-500)  — Texto secundario
TEXT_DIM           ████████  #475569  (slate-600)  — Texto terciario
TEXT_BRIGHT        ████████  #e2e8f0  (slate-200)  — Texto destacado
TEXT_WHITE         ████████  #ffffff  — Solo para headlines
```

### 2.4 Colores Funcionales

```
SUCCESS            ████████  #22c55e  (green-500)
WARNING            ████████  #eab308  (yellow-500)
ERROR              ████████  #ef4444  (red-500)
GLITCH_CYAN        ████████  #00f0ff22  (con transparencia)
GLITCH_MAGENTA     ████████  #ff00ff11  (con transparencia)
```

### 2.5 Reglas de Color (OBLIGATORIAS)

1. **Fondo siempre oscuro**: `#050505` es el fondo base. `#0a0a0a` para paneles.
2. **Cyan (#00f0ff) como UNICO acento**: No introducir nuevos colores de acento.
3. **Textos en escala de grises**: Usar la escala slate-300 a slate-600.
4. **Bordes sutiles**: `#1a1a1a` para separar paneles. Nunca usar cyan como borde general.
5. **Cyan con moderacion**: Solo en elementos interactivos, labels importantes, y estados activos.
6. **Transparencia para profundidad**: Usar opacidad (50-70%) y `backdrop-blur` para capas.

---

## 3. Tipografia

### 3.1 Fuentes

| Fuente | Provider | Uso |
|--------|----------|-----|
| **Space Grotesk** | Google Fonts | Headlines, titulos, nombre de marca |
| **JetBrains Mono** | Google Fonts | Todo lo demas: body, labels, datos, inputs, logs |

### 3.2 Pesos Disponibles

| Fuente | Pesos |
|--------|-------|
| Space Grotesk | 300, 400, 500, 600, 700 |
| JetBrains Mono | 200, 300, 400, 500, 600, 700, 800 |

### 3.3 Escala Tipografica

```
HEADLINE_GRANDE    text-2xl    font-black     tracking-tighter    uppercase    Space Grotesk
HEADLINE_MEDIO     text-sm     font-bold      tracking-tighter                 JetBrains Mono
LABEL_SECCION      text-[10px] font-normal    uppercase           tracking-widest  opacity-50  primary
LABEL_DATO         text-[9px]  font-normal                                          slate-500
LABEL_MINI         text-[8px]  font-normal                                          opacity-50
BODY               text-sm     font-normal                                          slate-300
INPUT              text-sm     font-mono                                             primary
FOOTER             text-[9px]  font-normal                                          slate-600
```

### 3.4 Reglas Tipograficas

1. **Labels de seccion**: Siempre `text-[10px]`, uppercase, tracking-widest, color primary con opacity-50.
2. **Headlines**: Siempre Space Grotesk, font-black, tracking-tighter.
3. **Todo lo demas**: JetBrains Mono.
4. **Uppercase**: Solo para labels, secciones y datos tecnicos. Los mensajes del chat van en normal.
5. **Kerning**: tracking-tighter para headlines grandes, tracking-widest para labels.

---

## 4. Componentes UI

### 4.1 Panel (`.bg-panel .cyber-border`)

```html
<div class="bg-panel cyber-border p-4">
  <!-- contenido -->
</div>
```
- Fondo: `#0a0a0a`
- Borde: `1px solid #1a1a1a`
- Esquina superior izquierda: accent cyan (2px border-top + border-left)
- Padding: `p-4`

### 4.2 Boton Principal (`.angular-cut`)

```html
<button class="bg-primary text-black px-6 py-2 text-[10px] font-black 
  hover:bg-white transition-all angular-cut">
  ACCION
</button>
```
- Forma: clip-path angular (esquina inferior derecha cortada)
- Fondo: cyan (#00f0ff)
- Texto: negro
- Hover: fondo blanco

### 4.3 Boton Secundario

```html
<button class="bg-primary/10 border border-primary/40 text-primary px-6 py-2 
  text-[10px] font-black hover:bg-primary hover:text-black transition-all angular-cut">
  ACCION
</button>
```
- Fondo: cyan con 10% opacidad
- Borde: cyan con 40% opacidad
- Hover: relleno cyan completo

### 4.4 Barra de Progreso

```html
<div class="h-[2px] bg-slate-800">
  <div class="h-full bg-primary w-[XX%]"></div>
</div>
```
- Alto: 2px
- Track: slate-800
- Fill: cyan (#00f0ff)

### 4.5 Timeline Item

```html
<div class="relative pl-4 border-l border-slate-800 py-2">
  <div class="absolute -left-1 top-3 w-2 h-2 bg-primary rounded-full"></div>
  <div class="text-[10px] font-bold text-primary">LABEL</div>
  <div class="text-[9px] text-slate-500">DATO SECUNDARIO</div>
</div>
```
- Linea vertical izquierda: border-l
- Dot indicador: 2x2px, cyan
- Estado activo: bg-primary/5 + animate-pulse en dot

### 4.6 Thumbnail Grid

```html
<div class="aspect-video bg-slate-900 cyber-border group cursor-pointer overflow-hidden">
  <img class="object-cover w-full h-full opacity-50 
    group-hover:opacity-100 transition-opacity" src="..." />
</div>
```
- Aspect ratio: 16:9
- Opacidad reposo: 50%
- Opacidad hover: 100%

---

## 5. Efectos Visuales

### 5.1 Scanlines (`.hud-scanline`)

```css
.hud-scanline {
  background: linear-gradient(to bottom, transparent 50%, rgba(0, 240, 255, 0.02) 50%);
  background-size: 100% 4px;
}
```
- Lineas horizontales cada 4px con tinte cyan ultra-sutil
- Aplicado al `<body>`

### 5.2 Dot Grid (`.data-grid`)

```css
.data-grid {
  background-image: radial-gradient(#1a1a1a 1px, transparent 1px);
  background-size: 20px 20px;
}
```
- Puntos cada 20px
- Color: #1a1a1a (mismo que bordes)
- Aplicado al `<body>`

### 5.3 Glitch Text (`.glitch-text`)

```css
.glitch-text {
  text-shadow: 2px 0 #00f0ff22, -2px 0 #ff00ff11;
}
```
- Solo para headlines principales
- Cyan sutil a la derecha, magenta ultra-sutil a la izquierda

### 5.4 Angular Cut (`.angular-cut`)

```css
.angular-cut {
  clip-path: polygon(0 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
}
```
- Corte diagonal en esquina inferior derecha
- Usado en botones y cajas de datos

### 5.5 Cyber Border (`.cyber-border`)

```css
.cyber-border {
  border: 1px solid #1a1a1a;
  position: relative;
}
.cyber-border::after {
  content: '';
  position: absolute;
  top: -1px; left: -1px;
  width: 10px; height: 10px;
  border-top: 2px solid #00f0ff;
  border-left: 2px solid #00f0ff;
}
```
- Borde oscuro estandar
- Accent cyan en esquina superior izquierda (10x10px)

### 5.6 Radar Animation

```html
<div class="w-64 h-64 border border-primary/20 rounded-full relative">
  <div class="absolute inset-0 border-4 border-primary/5 border-dashed 
    rounded-full animate-[spin_10s_linear_infinite]"></div>
</div>
```
- Circulo exterior: cyan 20% opacidad
- Circulo interior: dashed, cyan 5%, spin 10s

---

## 6. Espaciado y Grid

### 6.1 Grid Principal

```
grid-cols-12 gap-1 p-1
```
- 12 columnas
- Gap entre paneles: 1px (4px con Tailwind)
- Padding exterior: 1px (4px)

### 6.2 Distribucion

| Panel | Columnas | Breakpoint |
|-------|----------|-----------|
| Left | col-span-12 lg:col-span-2 | Full en movil, 2 en desktop |
| Center | col-span-12 lg:col-span-7 | Full en movil, 7 en desktop |
| Right | col-span-12 lg:col-span-3 | Full en movil, 3 en desktop |

### 6.3 Alturas

| Elemento | Altura |
|----------|--------|
| Header | h-12 (48px) |
| Main | h-[calc(100vh-48px)] |
| Footer | h-8 (32px) |

---

## 7. Assets de Marca

### 7.1 Logo

- **Version principal**: `/Logo/rebrand/logo new.png`
- **Version animada**: `/Logo/Logo animado/1.mp4`, `2.mp4`
- **Uso**: Header, favicon, og:image

### 7.2 Robot Mascot

- Vistas disponibles: front, back, left, right
- Uso potencial: Seccion "Sobre nosotros", animaciones, avatar del agente de chat

---

## 8. Convenciones de Nomenclatura

### 8.1 Clases CSS

- Componentes: `.cyber-border`, `.angular-cut`, `.glitch-text`, `.hud-scanline`, `.data-grid`
- Utilidades: `.scroll-hide`

### 8.2 Variables Tailwind

```js
tailwind.config = {
  colors: {
    "primary": "#00f0ff",
    "background": "#050505",
    "panel": "#0a0a0a",
    "panel-border": "#1a1a1a",
    "accent-dim": "#003a3d"
  },
  fontFamily: {
    "headline": ["Space Grotesk"],
    "mono": ["JetBrains Mono"]
  }
}
```

### 8.3 Textos HUD

- Labels de seccion: `UPPERCASE_SNAKE_CASE` con tracking-widest
- Nombres de proyecto: `UPPERCASE_SNAKE_CASE`
- Datos: Formato tecnico (timestamps, porcentajes, coordenadas)

---

## 9. Control de Cambios

Todo cambio en colores, fuentes o componentes debe actualizarse en este documento. La version actual es **1.0**.

| Fecha | Version | Cambio |
|-------|---------|--------|
| 2026-04-08 | 1.0 | Version inicial basada en analisis del codigo original |
