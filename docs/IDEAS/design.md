# Diseño Visual y UX — Muebles CAD/CAM

> **Propósito**: Sistema de diseño propio para la aplicación. Define tokens,
> patrones de interacción y lineamientos visuales.

---

## 1. Identidad de Producto

La interfaz debe sentirse **profesional, técnica y precisa**. Es una herramienta
de taller, no una galería de arte. Cada elemento tiene una función utilitaria.

- **Estilo**: Industrial / Tooling. Sobrio, preciso, sin ornamentos.
- **Personalidad**: Robusto como una sierra de banco, preciso como un calibre.

## 2. Paleta de Colores (HSL)

Todos los valores se definen en HSL para facilitar ajustes de tema.

### 2.1 Neutros (Base)

| Token | HSL | Uso |
|-------|-----|-----|
| `--color-bg` | `hsl(0 0% 97%)` | Fondo principal de la app |
| `--color-surface` | `hsl(0 0% 100%)` | Tarjetas, paneles, inputs |
| `--color-surface-hover` | `hsl(0 0% 95%)` | Hover de superficies |
| `--color-border` | `hsl(0 0% 85%)` | Bordes de componentes |
| `--color-border-strong` | `hsl(0 0% 65%)` | Bordes de inputs activos |
| `--color-text-primary` | `hsl(0 0% 10%)` | Texto principal |
| `--color-text-secondary` | `hsl(0 0% 45%)` | Texto secundario, labels |
| `--color-text-disabled` | `hsl(0 0% 65%)` | Texto deshabilitado |

### 2.2 Acento (Acción)

| Token | HSL | Uso |
|-------|-----|-----|
| `--color-accent` | `hsl(210 70% 45%)` | Botones primarios, links, selección |
| `--color-accent-hover` | `hsl(210 70% 38%)` | Hover de acciones primarias |
| `--color-accent-light` | `hsl(210 70% 92%)` | Background de elementos seleccionados |
| `--color-accent-text` | `hsl(0 0% 100%)` | Texto sobre acento |

### 2.3 Semántico (Feedback)

| Token | HSL | Uso |
|-------|-----|-----|
| `--color-success` | `hsl(140 60% 42%)` | Operación exitosa, snapping confirmado |
| `--color-warning` | `hsl(35 90% 50%)` | Advertencia, tolerancia excedida |
| `--color-error` | `hsl(0 72% 51%)` | Error en cota, conflicto de ensamble |
| `--color-info` | `hsl(200 70% 45%)` | Información, ayuda contextual |

### 2.4 Canvas 3D/2D

| Token | HSL | Uso |
|-------|-----|-----|
| `--color-canvas-bg` | `hsl(0 0% 92%)` | Fondo del viewport 3D/2D |
| `--color-canvas-grid` | `hsl(0 0% 80%)` | Líneas de rejilla técnica |
| `--color-canvas-grid-major` | `hsl(0 0% 65%)` | Líneas de rejilla principales (cada 1m) |
| `--color-canvas-selection` | `hsl(210 70% 45% / 0.3)` | Selección/área de arrastre |
| `--color-canvas-snap` | `hsl(140 60% 42%)` | Indicador de snapping activo |

## 3. Tipografía

- **Font family**: `Inter`, system-ui, sans-serif.
- **Monospace**: `JetBrains Mono`, `SF Mono`, monospace (para cotas y medidas).

### 3.1 Escala tipográfica

| Token | Tamaño | Line-height | Uso |
|-------|--------|-------------|-----|
| `--text-xs` | 0.75rem (12px) | 1.4 | Labels, medidas en canvas |
| `--text-sm` | 0.875rem (14px) | 1.4 | Cuerpo secundario, tabs inactivos |
| `--text-base` | 1rem (16px) | 1.5 | Cuerpo principal |
| `--text-lg` | 1.125rem (18px) | 1.5 | Títulos de panel |
| `--text-xl` | 1.25rem (20px) | 1.4 | Títulos de sección |
| `--text-2xl` | 1.5rem (24px) | 1.3 | Título de página |
| `--text-3xl` | 2rem (32px) | 1.25 | Encabezado principal |

## 4. Espaciado

Sistema de 4px base (multiplicador):

| Token | Rem | Px | Uso |
|-------|-----|-----|-----|
| `--space-1` | 0.25rem | 4px | Micro-espaciado, gap entre icono y texto |
| `--space-2` | 0.5rem | 8px | Padding interno de inputs, chips |
| `--space-3` | 0.75rem | 12px | Gap entre elementos relacionados |
| `--space-4` | 1rem | 16px | Padding de tarjetas, entre secciones |
| `--space-6` | 1.5rem | 24px | Margen entre paneles |
| `--space-8` | 2rem | 32px | Padding de página, separación mayor |
| `--space-12` | 3rem | 48px | Separación de secciones grandes |

## 5. Bordes y Sombras

| Token | Valor | Uso |
|-------|-------|-----|
| `--radius-sm` | 4px | Inputs, botones pequeños, chips |
| `--radius-md` | 6px | Tarjetas, paneles, modales |
| `--radius-lg` | 8px | Contenedores grandes, drawer |
| `--shadow-sm` | `0 1px 2px hsl(0 0% 0% / 0.06)` | Elevación sutil (inputs) |
| `--shadow-md` | `0 4px 6px hsl(0 0% 0% / 0.08)` | Elevación media (tarjetas) |
| `--shadow-lg` | `0 10px 20px hsl(0 0% 0% / 0.12)` | Elevación alta (modal, toast) |

## 6. Iconos

- Usar [Lucide](https://lucide.dev/) como librería de iconos.
- Tamaños: 16px (sm), 20px (md), 24px (lg).
- Los iconos son siempre decorativos (con `aria-hidden`) salvo que sean
  el único medio de identificar una acción.

## 7. Patrones de Interacción

### 7.1 Barra de Navegación Secuencial (Modos 1–4)

Barra persistente en la parte superior. Muestra el progreso: 1 → 2 → 3 → 4.
Cada paso se habilita solo cuando el anterior tiene datos válidos.

- **Activo**: Acento sólido con icono.
- **Completado**: Checkmark verde + permite volver.
- **Bloqueado**: Gris, cursor not-allowed.
- **Transición**: Deslizamiento horizontal suave (300ms ease).

### 7.2 Panel de Propiedades Contextual

Aparece desde la derecha (drawer) cuando un objeto está seleccionado en el
canvas. Se cierra al deseleccionar o al presionar Escape.

- Ancho: 360px fijo.
- Animación: Slide-in 250ms ease-out.
- Tiene header (nombre del objeto + botón cerrar), body (parámetros
  agrupados), footer (acciones).

### 7.3 Vista Lista → Detalle (Split View en Modo 4)

Pantalla dividida con ratio 40/60.

- Izquierda: lista de piezas (BOM) con scroll infinito, búsqueda y filtros.
- Derecha: plano de corte 2D interactivo (Canvas nativo).
- Separador ajustable mediante drag horizontal.

### 7.4 Snapping (Retroalimentación visual)

- Distancia de activación: 10px (configurable).
- Feedback: línea de guía sólida verde (`--color-canvas-snap`).
- Micro-atracción magnética al soltar dentro del umbral.
- Sonido opcional (desactivado por defecto).

### 7.5 Modal / Confirmación

- Overlay semitransparente (`hsl(0 0% 0% / 0.4)`).
- Cerrar con Escape o click fuera.
- Botón primario (confirmar) y secundario (cancelar).
- Para acciones destructivas: botón primario en rojo (`--color-error`).

## 8. Layout General

```
┌────────────────────────────────────────────────┐
│ [Logo]  [Modo 1] → [Modo 2] → [Modo 3] → [4]  │  ← Navegación
├──────────┬──────────────────────────┬───────────┤
│ Catálogo │                          │ Prop.     │
│ Lateral  │      CANVAS 3D / 2D      │ Context.  │
│ (Modo 2) │                          │ (visible  │
│          │                          │  si sel.) │
│          │                          │           │
├──────────┴──────────────────────────┴───────────┤
│ [Barra de estado: Dimensiones|Coord|Zoom: 100%] │  ← Status
└────────────────────────────────────────────────┘
```

### 8.1 Breakpoints

| Rango | Layout |
|-------|--------|
| < 1024px | Paneles laterales colapsados en drawer |
| 1024px – 1440px | Paneles laterales visibles, colapsables |
| > 1440px | Paneles fijos, mínimo 600px para canvas |

## 9. Z-Index (Stacking Context)

| Elemento | z-index | Contexto |
|----------|---------|----------|
| Canvas 3D/2D | 0 | Capa base del viewport |
| Toolbar / Barra de navegación | 10 | Controles sobre el canvas |
| Panel lateral (drawer) | 20 | Panel deslizable desde bordes |
| Tooltip / Popover | 30 | Por encima de paneles |
| Select / Dropdown | 40 | Menús desplegables |
| Modal / Dialog | 50 | Diálogo modal con overlay |
| Toast / Notification | 60 | Notificaciones flotantes top-right |
| Overlay de carga | 70 | Loading state global |

El overlay semitransparente de modal se ubica en `z-index: 49` (justo debajo
pero sobre paneles). Esto asegura que el modal esté por encima del overlay.

## 10. Transiciones y Animaciones

| Elemento | Propiedad | Duración | Easing |
|----------|-----------|----------|--------|
| Panel lateral | transform / opacity | 250ms | ease-out |
| Modal aparecer | opacity / transform: scale | 200ms | ease-out |
| Modal desaparecer | opacity | 150ms | ease-in |
| Hover botón | background-color | 150ms | ease |
| Snap indicador | opacity / scale pulse | 200ms | ease-out |
| Selector de modo | translate-x | 300ms | ease-in-out |

## 11. Modos (Workspaces)

### Modo 1: Planimetría
- Fondo: `--color-canvas-bg` con rejilla visible.
- Herramientas: Dibujo de muros, inserción de obstáculos.
- Cursor: Crosshair en herramientas de dibujo.

### Modo 2: Diseño 3D
- Catálogo lateral (colapsable, 280px).
- Gizmos de transformación (traslación, rotación, escala).
- Cotas visibles en unidades mm.

### Modo 3: Presentación
- Sin rejillas ni cotas.
- Fondo neutro sólido.
- Botón flotante para "Vista Explosionada" (slider de separación).

### Modo 4: Producción
- Split horizontal con BOM a la izquierda.
- Toolbar de exportación (PDF, DXF, CSV).
- Métricas de eficiencia visibles (%, desperdicio).

## 12. Estados de Componentes

Todo componente interactivo debe considerar:

| Estado | Visual |
|--------|--------|
| Default | Según token base |
| Hover | `--color-surface-hover` + cursor pointer |
| Active | `--color-accent-light` |
| Focus | Outline 2px `--color-accent` |
| Disabled | Opacidad 0.4, cursor not-allowed |
| Loading | Skeleton shimmer (gradient animado) |
| Error | Borde `--color-error` + mensaje auxiliar |
| Empty | Mensaje centrado con icono y texto ("Sin módulos") |
