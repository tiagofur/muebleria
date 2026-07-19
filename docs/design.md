# Design Guide — Muebles App

> **Estado:** v1.1 — post phase-4 + F024 growth  
> **Autores:** Producto + agente de diseño  
> **Fecha:** 2026-07-15  
> **Referencia de implementación:** `feature_list.json` fases 4 (F016–F023) + F024 (clientes/auth) y residual UI slices A–F

---

## 1. Diagnóstico del estado actual

> **Nota histórica:** esta sección documenta el **diagnóstico pre-rediseño** (estado previo a F016–F023). La app actual implementa los patrones de phase-4 (sidebar, modales, toasts, lista→detalle, dashboard, login gate, clientes). No borrar esta tabla: sirve como memoria de por qué se rediseñó.

Antes de definir hacia dónde vamos, es crítico entender qué tenemos y qué duele.

### 1.1 Problemas de UX

| # | Problema | Evidencia en el código | Impacto |
|---|---------|----------------------|---------|
| U1 | **Navegación plana de tabs** — 6 tabs horizontales que mezclan configuración (Materiales, Cantos, Herrajes, Opciones) con el flujo productivo (Muebles, Proyectos) | `App.tsx` L754–807 | El usuario no distingue qué es setup de qué es su trabajo diario |
| U2 | **Form inline siempre visible** — el formulario de crear/editar vive al costado de la tabla en un grid 60/40, sin modo "ver" | `MaterialsCatalog.tsx` L157–288 | Pierde contexto; no puede comparar ítems mientras edita |
| U3 | **Sin modo lectura** — no hay "ver detalle" de un ítem; solo "editar" | Todos los `*Screen.tsx`: el click en un row arranca `startEdit()` | No se puede consultar información sin riesgo de modificarla |
| U4 | **Sin búsqueda ni filtros** — solo un checkbox "mostrar inactivos" | `MaterialsCatalog.tsx` L63 | Con 50+ materiales es inmanejable |
| U5 | **Sin jerarquía de acciones** — todos los botones lucen igual | `catalogs.css` L185–222 | No es claro cuál es la acción principal vs la destructiva |
| U6 | **Sin feedback de acciones** — no hay toasts, spinners, ni confirmaciones visuales | No existe componente `Toast` en el codebase | Las acciones se sienten "muertas" |
| U7 | **Sin pantalla de inicio** — la app abre en "Materiales", no en lo más útil | `App.tsx` L405: `useState<CatalogTab>('materials')` | El usuario siempre tiene que navegar hasta Proyectos |
| U8 | **Sin modales** — crear/editar ocurre en la misma vista desplazando contenido | Todos los catálogos usan `setEditingId` + form inline | Pierde contexto visual al editar |

### 1.2 Problemas de UI

| # | Problema | Evidencia | Impacto |
|---|---------|-----------|---------|
| I1 | **Colores genéricos** — Google Blue `#1a73e8`, gris `#f0f2f5`, sin personalidad | `app.css` L11–14, `catalogs.css` L204–210 | Parece un prototipo interno, no una app terminada |
| I2 | **Tipografía sin identidad** — `system-ui, -apple-system, Segoe UI, sans-serif` | `app.css` L14 | Sin personalidad visual; cada OS se ve diferente |
| I3 | **Sin iconos** — navegación y acciones son puro texto | No hay dependencia de iconografía en el repo | La UI es pesada de escanear |
| I4 | **Sin sombras ni profundidad** — borders planos `#d0d4d8` en todos los contenedores | `catalogs.css` L47 | Todo tiene el mismo peso visual |
| I5 | **Sin animaciones** — cero transiciones en tabs, hover states | No hay `transition` ni `animation` en ningún `.css` | La app se siente estática y fría |
| I6 | **Sin responsive real** — un solo breakpoint en 900px | `catalogs.css` L39, `modules.css` L142 | Experiencia deficiente en tablets y móvil |
| I7 | **Cards sin jerarquía** — todo tiene el mismo peso visual | `module-part-card`, `project-item-card`: misma apariencia | Nada destaca; todo compite por atención |
| I8 | **Estados vacíos sin contexto** — solo texto plano | `.catalog-empty` como `<p>` simple | Oportunidad perdida de guiar al usuario |

---

## 2. Principios de Diseño

Estos principios no son decorativos — son restricciones que todo componente debe respetar.

1. **Claridad sobre decoración.** Cada elemento visual debe tener una función. Si eliminar algo no cambia la comunicación, se elimina.
2. **Jerarquía explícita.** El peso visual (tamaño, color, contraste) comunica importancia. La acción principal siempre debe ser obvia.
3. **Feedback inmediato.** Toda acción del usuario recibe una respuesta visual en menos de 150ms.
4. **Contexto preservado.** El usuario nunca pierde de vista dónde está ni qué estaba haciendo. Los modales preservan el contexto de la lista.
5. **Progressive disclosure.** Mostrar lo mínimo necesario. Los detalles aparecen cuando se piden.
6. **Consistencia de patrones.** Un mismo problema siempre se resuelve de la misma manera. Si crear un Material usa un modal, crear un Herraje también usa un modal.

---

## 3. Design System

### 3.1 Tipografía

**Fuente principal:** [Inter](https://fonts.google.com/specimen/Inter) — Sans-serif de alta legibilidad, diseñada para pantallas.

```html
<!-- Agregar en apps/web/index.html -->
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
```

**Escala tipográfica:**

```css
--font-sans: 'Inter', system-ui, -apple-system, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', ui-monospace, monospace;

--text-xs:   0.6875rem; /* 11px — badges, captions secundarios */
--text-sm:   0.75rem;   /* 12px — labels de campo */
--text-base: 0.875rem;  /* 14px — cuerpo de texto principal */
--text-md:   1rem;      /* 16px — títulos de sección */
--text-lg:   1.125rem;  /* 18px — títulos de página */
--text-xl:   1.375rem;  /* 22px — títulos de pantalla */
--text-2xl:  1.75rem;   /* 28px — números hero (precios, totales) */

--weight-regular:  400;
--weight-medium:   500;
--weight-semibold: 600;
--weight-bold:     700;

--leading-tight:   1.25;
--leading-normal:  1.5;
--leading-relaxed: 1.7;
```

**Reglas de uso:**

- Códigos de ítem (`MAT-001`, `MOD-GAB-01`): `font-family: var(--font-mono)`, color muted — permite escaneo rápido
- Precios y totales: `var(--text-2xl)`, `--weight-bold`, `font-variant-numeric: tabular-nums`
- Labels de campo: `var(--text-sm)`, `--weight-semibold`, color secondary
- Body/descripciones: `var(--text-base)`, `--weight-regular`

---

### 3.2 Paleta de Colores

La paleta usa HSL para permitir variaciones programáticas y preparar dark mode.

#### Brand

```css
/* Indigo profundo — reemplaza el genérico Google Blue */
--brand-50:  hsl(245 100% 97%);
--brand-100: hsl(245  96% 93%);
--brand-200: hsl(245  92% 85%);
--brand-300: hsl(245  86% 74%);
--brand-400: hsl(245  78% 63%);
--brand-500: hsl(245  58% 51%); /* PRIMARY — usar para acciones principales */
--brand-600: hsl(245  55% 43%);
--brand-700: hsl(245  52% 36%);
--brand-800: hsl(245  48% 28%);
--brand-900: hsl(245  44% 20%);

/* Teal — acento secundario para highlights, links, badges informativos */
--accent-400: hsl(170 65% 48%);
--accent-500: hsl(170 60% 40%); /* ACCENT */
--accent-600: hsl(170 55% 33%);
```

#### Surfaces

```css
--surface-app:      hsl(220 20% 97%); /* Fondo de la app */
--surface-sidebar:  hsl(230 18% 16%); /* Sidebar oscuro */
--surface-card:     hsl(0   0%  100%); /* Cards, formularios, modales */
--surface-input:    hsl(220 14% 98%); /* Fondo de inputs */
--surface-hover:    hsl(220 14% 95%); /* Hover state en listas */
--surface-selected: hsl(245 100% 97%); /* Ítem seleccionado */
--surface-overlay:  hsla(230 20% 10% / 0.55); /* Backdrop de modales */
```

#### Texto

```css
--text-primary:   hsl(230 18% 12%);
--text-secondary: hsl(230 12% 40%);
--text-muted:     hsl(230 10% 58%);
--text-disabled:  hsl(230 10% 74%);
--text-inverse:   hsl(0   0%  100%);
--text-brand:     var(--brand-600);
```

#### Semánticos

```css
--success-50:  hsl(145 60% 96%);
--success-500: hsl(145 58% 38%);
--success-700: hsl(145 55% 28%);

--warning-50:  hsl(38 100% 96%);
--warning-500: hsl(38  92% 50%);
--warning-700: hsl(38  80% 38%);

--danger-50:  hsl(0 80% 97%);
--danger-500: hsl(0 72% 51%);
--danger-700: hsl(0 65% 40%);

--info-50:  hsl(210 100% 96%);
--info-500: hsl(210 100% 45%);
--info-700: hsl(210  90% 36%);
```

#### Bordes

```css
--border-subtle:  hsl(220 16% 92%);
--border-default: hsl(220 14% 86%);
--border-strong:  hsl(220 12% 74%);
--border-brand:   var(--brand-400);
```

---

### 3.3 Sombras

```css
--shadow-xs: 0 1px 2px hsla(230 20% 12% / 0.05);
--shadow-sm: 0 1px 3px hsla(230 20% 12% / 0.08),
             0 1px 2px hsla(230 20% 12% / 0.04);
--shadow-md: 0 4px 8px hsla(230 20% 12% / 0.08),
             0 2px 4px hsla(230 20% 12% / 0.04);
--shadow-lg: 0 10px 20px hsla(230 20% 12% / 0.10),
             0 4px  8px  hsla(230 20% 12% / 0.04);
--shadow-xl: 0 20px 40px hsla(230 20% 12% / 0.12),
             0 8px  16px hsla(230 20% 12% / 0.06);
--shadow-focus: 0 0 0 3px hsla(245 58% 51% / 0.25);
```

**Reglas de uso:**
- `--shadow-sm` — cards en lista (estado rest)
- `--shadow-md` — cards en hover, dropdowns
- `--shadow-lg` — modales, drawers
- `--shadow-xl` — paleta global (Cmd+K)

---

### 3.4 Spacing

Escala de 4px base. Siempre usar variables; nunca valores ad-hoc.

```css
--space-1:  0.25rem;  /*  4px */
--space-2:  0.5rem;   /*  8px */
--space-3:  0.75rem;  /* 12px */
--space-4:  1rem;     /* 16px */
--space-5:  1.25rem;  /* 20px */
--space-6:  1.5rem;   /* 24px */
--space-8:  2rem;     /* 32px */
--space-10: 2.5rem;   /* 40px */
--space-12: 3rem;     /* 48px */
--space-16: 4rem;     /* 64px */
```

#### 3.4.1 Densidad compacta (product app / taller)

Default del producto: **herramienta densa**, no landing. Tokens semánticos en `tokens.css` (issue #49):

| Token | Uso |
|-------|-----|
| `--density-page-gap` | Gap vertical de pantalla (`catalog-page`, listas) |
| `--density-toolbar-gap` / `--density-filter-gap` | Header + filtros |
| `--density-table-pad-y` / `--density-table-pad-x` | Celdas de catálogo |
| `--density-row-min-height` | Altura mínima de fila (~32px) |
| `--density-card-pad` / `--density-card-gap` / `--density-card-grid-gap` | Cards de cotización/mueble |
| `--density-modal-header-*` / `--density-modal-body` / `--density-modal-footer-*` | Modales SM/MD/LG |
| `--density-form-gap` | Stack de campos en forms |
| `--density-btn-pad-*` / `--density-control-pad-*` | Botones y controles de fila |

**Reglas:**
- Preferir `--density-*` en tablas, toolbars, cards y modales de alta frecuencia.
- Cuerpo de texto mínimo `--text-base` (14px); labels pueden usar `--text-sm` (12px). Compact ≠ ilegible.
- Toggle «Cómoda / Compacta» es fase 2 (no en este slice); hoy la app **es** compacta por defecto.
- Solo tokens; sin hex ni `px` sueltos en feature CSS.

---

### 3.5 Border Radius

```css
--radius-sm:   4px;
--radius-md:   8px;
--radius-lg:  12px;
--radius-xl:  16px;
--radius-2xl: 24px;
--radius-full: 9999px;
```

---

### 3.6 Animaciones y Transiciones

```css
--ease-out:    cubic-bezier(0.0, 0, 0.2, 1);
--ease-in:     cubic-bezier(0.4, 0, 1, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);

--duration-fast:   150ms;
--duration-normal: 250ms;
--duration-slow:   350ms;

--transition-colors:   color var(--duration-fast) var(--ease-out),
                       background-color var(--duration-fast) var(--ease-out),
                       border-color var(--duration-fast) var(--ease-out);
--transition-shadow:   box-shadow var(--duration-fast) var(--ease-out);
--transition-transform:transform var(--duration-normal) var(--ease-out);
--transition-opacity:  opacity var(--duration-fast) var(--ease-out);
```

**Reglas:**
- **Sin bounce / spring** (issue #55): no easings con overshoot; product UI calm/operational
- Hover de botones y links → `--transition-colors` + `--duration-fast`
- Hover de cards (shadow elevation) → `--transition-shadow`
- Apertura de modales → `opacity` + `transform scale` con `--duration-slow` + `--ease-out`
- Slide-in de drawers → `transform translateX` con `--duration-slow`
- Siempre envolver en `@media (prefers-reduced-motion: no-preference)`

---

### 3.7 Iconografía

**Librería:** [Lucide React](https://lucide.dev)

```bash
pnpm add lucide-react --filter @muebles/ui
```

- **Stroke width:** siempre `strokeWidth={1.5}`
- **Tamaños:** 14px (badge inline), 16px (nav/botón), 18px (toolbar), 20px (sección), 32px/48px (empty states)

**Mapa de iconos por sección:**

| Sección | Icono |
|---------|-------|
| Dashboard | `LayoutDashboard` |
| Cotizaciones | `FileText` |
| Clientes | `Users` |
| Muebles / Módulos | `Package` |
| Materiales | `Layers` |
| Cantos | `Minus` |
| Herrajes | `Settings2` |
| Grupos de opciones | `ToggleLeft` |
| Login / iniciar sesión | `LogIn` |
| Acceso invitado (offline) | `WifiOff` |
| Cerrar sesión | `LogOut` |
| Nuevo / Crear | `Plus` |
| Editar | `Pencil` |
| Eliminar | `Trash2` |
| Desactivar | `EyeOff` |
| Reactivar | `Eye` |
| Exportar Excel | `FileSpreadsheet` |
| Duplicar | `Copy` |
| Buscar | `Search` |
| Cerrar modal | `X` |
| Atrás | `ChevronLeft` |
| Precio / Costo | `DollarSign` |
| Dimensiones | `Ruler` |
| Status activo | `CheckCircle2` |
| Status inactivo | `MinusCircle` |
| Email (login) | `Mail` |
| Contraseña (login) | `KeyRound` |

---

## 4. Patrones de Interacción

### 3.8 Breakpoints canónicos (issue #34)

Los media queries **no pueden** leer custom properties; los px de abajo son literales fijos y se documentan también en `tokens.css` (`--bp-*`, `--touch-min`).

| Nombre | Rango | Uso típico |
|--------|--------|------------|
| **phone** | `max-width: 639px` | Portrait ~390: 1 col de cards, scroll-x en tablas, touch targets ≥40px |
| **tablet** | `640px`–`899px` | Portrait ~768: 2 cols de cards, shell con drawer |
| **desktop** | `min-width: 900px` | Sidebar fija (F017), layout denso |
| **cards-3** | `min-width: 1100px` | 3 columnas en grillas de Muebles / Cotizaciones |
| **wide** | ~1280px | Smoke de no-overflow en monitores de taller |

**Grillas de cards (Muebles, Cotizaciones):** 1 → 2 → 3 columnas en esos cortes (no `auto-fill` suelto).

**Tablas de catálogo / usuarios:** `overflow-x: auto` + fade de bordes + `min-width` en phone para no aplastar celdas.

**Touch:** en `max-width: 767px`, `.btn` / `.btn--small` / acciones de fila usan `min-height: var(--touch-min)` (2.5rem ≈ 40px). Desktop compacto (#49) no cambia.

**Shell:** collapse drawer en `max-width: 899px` (sin cambio de contrato F017).

### 4.1 Layout General

**Gate de sesión:** antes del shell, la app muestra `LoginScreen` (pantalla completa). Solo tras `guest` o `auth` se monta el layout sidebar + content.

La app autenticada/invitada usa un layout de **sidebar + content area**, NO tabs horizontales.

```
┌──────────────────────────────────────────────────────────┐
│ ☰  Título de página     meta sesión              [Salir] │  TopBar 56px
├────────────┬─────────────────────────────────────────────┤
│            │                                             │
│  Sidebar   │  Content Area                               │
│  240px     │                                             │
│            │  ┌─────────────────────────────────────┐   │
│  TRABAJO   │  │ Título de página        [+ Nuevo]   │   │
│  ● Inicio  │  ├─────────────────────────────────────┤   │
│  · Cotiz.  │  │ [Buscar…] [Todos][Activos][Inactivos]│   │
│  · Client. │  ├─────────────────────────────────────┤   │
│  · Vitrina │  │                                     │   │
│  · Cola*   │  │  Lista / Tabla / Cards              │   │
│            │  │                                     │   │
│  ──────    │  │                                     │   │
│            │  └─────────────────────────────────────┘   │
│  INGENIERÍA│                                             │
│  · Muebles │                                             │
│  · Estruc. │                                             │
│  · Compon. │                                             │
│  · Mater.  │                                             │
│  · Cantos  │                                             │
│  · Herraj. │                                             │
│  · Grupos  │                                             │
│            │                                             │
│  ──────    │                                             │
│            │                                             │
│  CONFIG    │                                             │
│  · Ajustes │                                             │
│  · Usuarios*                                             │
│            │                                             │
└────────────┴─────────────────────────────────────────────┘
  * Cola: solo roles con `roleUsesProductionQueue` (hoy: produccion).
    Usuarios: solo admin (RBAC `roleCanManageUsers`).
```

**Navegación canónica (`AppShell` / `APP_NAV_SECTIONS`):**

| Sección | Ítems (label → nav id) |
|---------|------------------------|
| TRABAJO | Inicio (`home`), Cotizaciones (`projects`), Clientes (`customers`), Vitrina (`showcase`), Cola (`production`, solo si `roleUsesProductionQueue`) |
| INGENIERÍA | Muebles (`modules`), Estructuras (`structures`), Componentes (`components`), Materiales (`materials`), Cantos (`edges`), Herrajes (`hardware`), Grupos (`optionGroups`) |
| CONFIG | Ajustes (`settings`), Usuarios (`users`, solo admin) |

#### Vocabulario de producto (UI copy — issue #52)

Títulos de pantalla = labels de nav. Código/API en inglés; **copy de UI en español de taller**.

| Nav / UI | Código (no renombrar) | Notas |
|----------|------------------------|--------|
| **Inicio** | `home` | No «Home». Dashboard para todos los roles (variantes por `homeMode`) |
| **Cola** | `production` | Solo roles `roleUsesProductionQueue` (hoy: produccion). Antes polimórfico bajo `home`; ahora nav propio |
| **Cotizaciones** | `projects` / `Project` | No «Proyectos» en UI |
| **Clientes** | `customers` | |
| **Vitrina** | `showcase` | Catálogo comercial (sin BOM/costos). F040/F043 |
| **Muebles** | `modules` / `Module` | No «Módulos» en UI (salvo jargon técnico de export) |
| **Estructuras** | `structures` / `Structure` | Cuerpos reutilizables (F049) |
| **Componentes** | `components` / `Component` | Piezas reutilizables para estructuras |
| **Materiales / Cantos / Herrajes / Grupos** | catalogs | |
| **Ajustes** | `settings` | Defaults del taller (margen, MO, COST-02) |
| **Usuarios** | admin | Solo admin (aprobación de registros, roles) |

CTAs canónicos: «Nueva cotización», «Nuevo mueble», «Nuevo material», …

- **Sidebar**: `--surface-sidebar` (oscuro), texto inverse, ítem activo con borde izquierdo `--brand-400`
- **Brand chrome (issue #53):** `BrandMark` monochrome (tile + paneles) + wordmark «Muebles» — **sin emoji**; mismo mark en Login/Register y favicon web
- **Command palette (issue #54):** `Cmd/Ctrl+K` en el shell — secciones de nav + cotizaciones/muebles recientes; teclado ↑↓ Enter Esc; denso, sin búsqueda de marketing
- **TopBar**: `--surface-card` con `--shadow-sm`; acciones opcionales (`headerActions`, p. ej. **Salir**)
- **Content**: `--surface-app`, padding `--space-6`
- **Entrada por defecto:** `home` (Dashboard) para todos los roles. El redirect al gate de sesión / falta de permiso usa `home`. Para produccion, `home` sigue siendo Dashboard (la cola es su propia ruta `/produccion`).

### 4.2 Patrón Lista → Detalle → Editar

**Regla de oro:** click en un ítem de lista → **ver**, no editar de inmediato.

```
[Lista]
  └─ click row/card
      └─ [Vista Detalle] (read-only)
          ├─ [Editar] → Modal con form
          │     └─ guardar → cierra modal → toast "✓ Guardado"
          ├─ [Desactivar] → confirmación inline → toast
          └─ [Duplicar] → toast "✓ Duplicado como MOD-GAB-01-COPY"

[Lista]
  └─ [+ Nuevo] (header)
      └─ Modal con form vacío
            └─ guardar → cierra modal → toast "✓ Creado"
```

#### 4.2.1 Patrón por tipo de entidad (regla canónica — Fase 2 UI)

La lista elige su patrón según la **complejidad de la entidad**, no según la pantalla. Un solo criterio para todo el producto:

| Tipo de entidad | Patrón | Componentes | Ejemplos |
|-----------------|--------|-------------|----------|
| **Plana** (4–10 campos, sin sub-ítems) | **tabla-expand** | `.data-table` + `.data-table-wrap` + expand de fila + Modal **SM** editar | Materials, Edges, Hardware, OptionGroups, Customers, Users |
| **Compleja** (con sub-ítems, BOM, opciones, dimensiones) | **card-detalle** | `.entity-card` en lista + vista detalle inline (no modal) + Modal **MD** o vista edición | Projects, Modules, Structures, Components |
| **Comercial** (sin edición, presentación) | **card-grid** | `.entity-card` o `.module-showcase-card` + Modal informativo MD | Showcase |
| **Especial** | propio por feature | dashboard stats, queue, settings | Home, Production, Settings |

**Regla dura:** si una entidad tiene partes/herrajes/opciones/dimensiones múltiples, **no** usar tabla-expand ni card-expand. Usar card-detalle (vista inline). La edición compleja vive en su propia ruta (`/:id/edit`) o en modal **LG** con tabs (Fase 3 migrará los modales LG a rutas propias).

**Notas de estado actual (pre-Fase 3):**
- **Conforme:** Projects, Modules (card-detalle + Modal MD/LG). Materials/Edges/Hardware/OptionGroups/Customers/Users (tabla-expand). Showcase (card-grid).
- **Pendiente de migración a card-detalle (Fase 3):** Components y Structures hoy usan tabla-expand/card-expand + Modal LG con tabs. Deberían ser card-detalle igual que Modules.
- **Pendiente de migrar editores LG a rutas propias (Fase 3):** ModuleEditorForm, StructureEditorForm, ComponentEditorForm viven en Modal LG con tabs; el plan es mudarlos a `/[section]/:id/edit` (vista detalle inline) siguiendo el modelo de ProjectsScreen.

### 4.3 Modales

- **SM** (`max-width: 480px`): catálogos simples (Material, Canto, Herraje, Grupo)
- **MD** (`max-width: 680px`): metadatos de Proyecto
- **LG** (`max-width: 900px`): editor de Módulo

Estructura:
```
┌───────────────────────────────┐
│ Título del modal          [X] │  ← Header sticky
├───────────────────────────────┤
│  Cuerpo scrollable (el form)  │
├───────────────────────────────┤
│  [Cancelar]     [Guardar]     │  ← Footer sticky
└───────────────────────────────┘
```

### 4.4 Toasts

Position: **top-right**. Auto-dismiss: 4s. Máximo 3 simultáneos.

| Acción | Toast |
|--------|-------|
| Crear ítem | `✓ "MAT-001" creado` (success) |
| Actualizar ítem | `✓ Cambios guardados` (success) |
| Desactivar | `↓ "Arauco 15mm" desactivado` (info) |
| Reactivar | `↑ "Arauco 15mm" reactivado` (info) |
| Export exitoso | `✓ Optimizer.xlsx descargado` (success) |
| Error de validación | inline en el form, NO como toast |

### 4.5 Estados Vacíos

Componente: `EmptyState` (`variant: 'empty' | 'no-results'`).

| Caso | Cuándo | UI |
|------|--------|-----|
| **Lista vacía** (`empty`) | No hay datos en el workspace | Icono de sección + título + descripción + CTA primario `+ Nuevo…` |
| **Sin resultados** (`no-results`) | Hay datos pero búsqueda/chips/categoría no matchean | Icono `SearchX` + título «Sin resultados» + descripción + CTA secundario **Limpiar filtros** |

```
empty:                          no-results:
  [Icono sección 48px]            [SearchX 48px]
  [Título: "No hay materiales"]   [Título: "Sin resultados"]
  [Qué hacer a continuación]      [No hay ítems que coincidan…]
  [Botón "+ Agregar …"]           [Botón "Limpiar filtros"]
```

**Reglas:**
- Los conteos/filtros del sidebar (p. ej. categorías) no se confunden con empty: empty = catálogo vacío.
- «Limpiar filtros» restaura defaults de la pantalla (search vacío, chips al default, categoría «Todas»).
- Dashboard hub de onboarding (workspace casi vacío) es issue aparte; aquí solo listas.

### 4.6 Búsqueda y Filtros

Cada lista con más de ~10 ítems esperados tiene:
- `<SearchInput>` con placeholder específico ("Buscar materiales…")
- Filtro de estado como chips toggle: `[Todos] [Activos] [Inactivos]`
- Búsqueda client-side con debounce 150ms

### 4.7 Estados de carga (loading)

Patrones reutilizables en `@muebles/ui` (`Spinner`, `PageLoading`, `InlineLoading`, `ListSkeleton`, `submitBusyLabel`):

| Caso | Componente | Uso |
|------|------------|-----|
| Gate de workspace / pantalla entera | `PageLoading` (`fullPage`) | Primera carga del shell |
| Sección de catálogo / lista | `PageLoading` o `ListSkeleton` | Async de pantalla (Usuarios, etc.) |
| Panel inline (totales, toolbar) | `InlineLoading` | Recálculo, refresh parcial |
| Botón de guardar async | `disabled` + `submitBusyLabel` | Evitar doble submit |

Reglas:
- Solo tokens del design system (sin Tailwind / hex).
- Respetar `prefers-reduced-motion` en spinners/skeletons.
- Empty y error son estados **distintos** del loading (ver §4.5 y toasts §4.4).
- El busy es *durante* la operación; el toast de éxito/error va al terminar.

---

## 5. Componentes del Design System

### 5.1 Botones

Definidos en `packages/ui/src/catalogs/catalogs.css` con **BEM** (base + modificadores). No existen clases `.btn-primary` ni `.btn-secondary`.

```
.btn              — base (secundario por defecto: fondo card, borde)
.btn--primary     — acción principal (fondo brand, texto inverse)
.btn--ghost       — acción terciaria (sin borde, fondo transparente)
.btn--danger      — acción destructiva (texto/borde danger)
.btn--small       — tamaño compacto (rows de tabla, acciones inline)
.btn--icon        — cuadrado, solo icono
```

**Regla:** en cualquier grupo de acciones, max **1** `.btn--primary`. La secundaria es el `.btn` base (sin modificador de variante).

### 5.2 Badges de Status

```
.badge-active / ActiveBadge — verde    — "● Activo"
.badge-inactive             — gris     — "● Inactivo"
.status-badge--draft        — gris azulado — "● Borrador"
.status-badge--quoted       — azul     — "● Cotizado"
.status-badge--accepted     — verde    — "● Aceptado"
.status-badge--rejected     — rojo     — "● Rechazado"
.status-badge--produced     — morado   — "● En producción"
```

(Implementación de status de proyecto: clases `status-badge` + modificadores en `projects.css`.)

### 5.3 Cards vs Tabla

- **Cards**: Cotizaciones (Proyectos), Muebles — información rica y heterogénea
- **Tabla**: Materiales, Cantos, Herrajes, Grupos, Clientes — datos tabulares densos y comparables

---

## 6. Pantallas definidas

Especificaciones de pantalla alineadas con la app post F016–F023 + F024 + Fase 2 UI review. Cada pantalla es presentación en `@muebles/ui`; el shell (`apps/web`) posee estado de workspace, costos y sesión.

> **Tipos de patrón (§4.2):**
> - **tabla-expand**: tabla + expand de fila para ver + Modal SM/LG para editar.
> - **card-detalle**: cards en lista + vista detalle inline (no modal) para ver y editar.
> - **card-expand**: cards que expanden sobre la misma grid; edición en Modal LG.
> - **card-grid**: grid de cards sin editar (read-only + modal informativo).
> - **especial**: dashboard, cola de producción, settings — flujos propios.

### 6.1 Dashboard / Home

- **Ruta nav:** `home` (entrada por defecto del shell)
- **Path:** `packages/ui/src/dashboard/`
- **Roles que la ven:** todos (incluido guest). `home` **siempre** es Dashboard; el rol `produccion` tiene la cola en su propio nav `production` (ver §6.7).
- **Contrato:** props-driven — el shell precomputa stats y lista reciente; la UI no llama al engine de dominio
- **Variantes por rol (`homeMode`):**
  - `default` (admin, gerente_ventas, user): 4 stats + recientes + tabla «Por responsable» si `roleCanViewPortfolioDashboard` (F037)
  - `sales` (vendedor): stats reducidos (sin Muebles/Materiales), label «Tu total del mes», botón «Ver vitrina»
  - `engineering` (ingeniero): atajos a Materiales/Muebles, recordatorio «N plantillas sin foto»
- **Contenido base:**
  - 4 indicadores (vocabulario de nav): cotizaciones activas, total cotizado del mes, muebles en catálogo, materiales activos
  - «Total cotizado del mes» con énfasis visual (`.dashboard-stat--emphasis`); los conteos quedan secundarios
  - Montos: helper único `formatMoneyDisplay` (y wrappers `formatDashboardMoney` / `formatProjectMoney` / `formatModuleMoney`) → `$1,250.50 MXN` (locale `es-MX`, currency default MXN; issue #51)
  - Hasta 5 cotizaciones recientes (nombre, cliente resuelto, status badge, fecha, precio venta o `—`)
  - Lista reciente vacía (workspace no vacío): `EmptyState` **sin** CTA (el único primary es el header «Nueva cotización»)
  - Acciones rápidas: «Nueva cotización» (`.btn--primary`), «Nuevo mueble» (`.btn` base)
- **Workspace vacío (issue #33):** si `modulesCount === 0` y `projectsCount === 0`, mostrar bloque **Primeros pasos** (checklist) como **única región de contenido** (sin stats ni cotizaciones recientes — ceros y empty duplican ruido):
  1. Crear material (`onNewMaterial` → nav materials + `requestCreateKey`)
  2. Crear mueble (`onNewModule`)
  3. Crear cotización (`onNewProject`)
  - Paso hecho: badge con conteo (p. ej. «N materiales activos»); sin CTA
  - Paso pendiente: CTA; el primero pendiente usa **el único** `.btn--primary` de la pantalla
  - Header «Nueva cotización» / «Nuevo mueble» en empty-home: `.btn--ghost` (atajo, no compite con el paso activo)
  - Workspace con muebles o proyectos: **no** mostrar el bloque; stats + recientes + header con primary normal
- **Interacción:** click en card reciente → shell navega a Cotizaciones y abre detalle; acciones rápidas / primeros pasos → shell navega y dispara create modal vía `requestCreateKey`

### 6.2 Cotizaciones

- **Ruta nav:** `projects` (sección TRABAJO)
- **Path:** `packages/ui/src/projects/`
- **Título de pantalla:** **Cotizaciones** (no “Proyectos / Cotización”)
- **Patrón:** card-detalle (cards → vista detalle inline)
- **Lista:** cards con nombre, cliente, status badge, totales cuando el shell provee estimates; CTA «Nueva cotización»
- **Detalle (workspace tool — issue #50):**
  - **Chrome sticky** (`.workspace-chrome`): nombre, status, meta densa, precio de venta, **acciones agrupadas** (ver abajo)
  - Cuerpo en **2 columnas** (`.project-detail__body`): columna principal (`.project-detail__main` = opciones de proyecto opcionales + ítems/muebles) | panel sticky de desglose (`.project-totals`). Nunca más de dos hijos directos del grid o el layout se rompe.
- **Chrome — agrupación de acciones (Fase 2 UI):**
  - **Exportar Optimizer** (`btn--primary`): visible solo si `onExport && !productionExportDisabled` (rol puede exportar producción + status accepted/produced + no bloqueado). Caso típico de planta.
  - **Más exports ▾** (`btn` + `DropdownMenu`): menú con los 6 exports restantes agrupados por sección:
    - *Producción*: Lista de herrajes, Etiquetas (encintado PDF), Pack producción (ZIP). Solo visibles si `canExportProduction`.
    - *Comercial*: Exportar cotización (XLSX F030), PDF listado (F045 detailed), PDF resumen (F045 summary). Visibles para todos los roles excepto `produccion`.
  - **Presentar** (`btn--primary` o `btn`): overlay fullscreen de modo cliente, sin costos internos.
  - **Editar / Duplicar / Guardar como plantilla** (`btn`): solo si `canMutate`.
  - **Marcar en producción** (`btn--primary`): transición `accepted → produced`; visible solo si status=accepted y `canMarkProduced`.
  - **Reabrir a borrador** (`btn`): si `canReopen` y status ∈ {quoted, accepted, produced}.
  - **Eliminar** (`btn--danger`): si `canDelete`.
- **Cliente:** picker de clientes activos + acción «Nuevo cliente» (alta inline o navegación a Clientes según wiring del shell)
- **Plantillas (#110):** toolbar con «Desde plantilla» (picker) y «Plantillas» (gestión); chrome con «Guardar como plantilla» desde un proyecto
- **Búsqueda / filtros:** SearchInput
- **EmptyState** cuando no hay cotizaciones
- **RBAC**: `roleCanAccessProjects` (todos los roles salvo `user`). `produccion` ve lista filtrada a accepted/produced.

### 6.3 Muebles

- **Ruta nav:** `modules` (sección **INGENIERÍA**, no TRABAJO)
- **Path:** `packages/ui/src/modules/`
- **Título de pantalla:** **Muebles**
- **Patrón:** card-detalle (cards → vista detalle inline)
- **Lista:** cards con código, nombre, conteos de partes/herrajes, estimate de precio de venta (shell)
- **Detalle (workspace tool — issue #50):**
  - **Chrome sticky:** código, nombre, categoría/meta, precio estimado, Editar (primary), Duplicar/Eliminar
  - Cuerpo: preview de costo + piezas + herrajes densos (sin header de página web)
- **Editor:** Modal **LG** con tabs (General, Estructura, Componentes, Medidas, Herrajes, Costo). Pendiente de migración a vista detalle inline (Fase 3).
- **Preview de costo:** props del shell (`costPreview`, `previewBlocked`, `missingGroups`); sin fórmulas en UI
- **Categorías jerárquicas (F025):** panel lateral con árbol editable de hasta 3 niveles + filtro en cascada
- **EmptyState** + SearchInput con debounce
- **RBAC**: `roleCanAccessModulesNav` (admin, ingeniero)

### 6.4 Catálogos (Materiales / Cantos / Herrajes / Grupos)

- **Rutas nav:** `materials` | `edges` | `hardware` | `optionGroups` (sección INGENIERÍA)
- **Paths:** `packages/ui/src/catalogs/`, `packages/ui/src/optionGroups/`
- **Patrón común:** tabla-expand (`.data-table` + `--wrap` + expand de fila + Modal **SM**)
- **Tabla (issue #56 + Fase 1):** `.data-table-wrap` es scrollport (`overflow: auto` + `max-height`); `th` con `position: sticky; top: 0`, fondo sólido y `border-collapse: separate` para sticky fiable; filas densas vía tokens `--density-table-*`; edge-fade gradients laterales. Desde Fase 1 UI, `catalog-table-wrap` / `users-table-wrap` / `dashboard-owners-wrap` son aliases de `.data-table-wrap` en `common/dataTable.css`.
- **Materiales / Cantos / Herrajes:** `CatalogTable`, desactivar/reactivar, badges de activo, imagen (F042), color swatch y `defaultEdgeBandId` (F027)
- **Grupos de opciones:** pantalla propia con tabla/listado y modal; preview de precio gated por `PricePreviewGate` cuando faltan resoluciones
- **EmptyState** con CTA «+ Agregar…»
- **RBAC**: `roleCanAccessCatalogNav` (admin, ingeniero, gerente_ventas, vendedor). Mutar: `roleCanMutateCatalog` (solo admin/ingeniero).

### 6.5 Clientes

- **Ruta nav:** `customers` (sección TRABAJO)
- **Path:** `packages/ui/src/customers/`
- **Dominio:** entidad `Customer` (`@muebles/domain`)
- **Patrón:** tabla-expand (mismo que catálogos)
- **Campos típicos de draft:** name, email, phone, address, notes
- **Icono:** `Users`
- **RBAC**: `roleCanAccessCustomers` (admin, gerente_ventas, vendedor). Ownership de cliente por `ownerUserId` (F034).

### 6.6 Vitrina

- **Ruta nav:** `showcase` (sección TRABAJO)
- **Path:** `packages/ui/src/modules/ModuleShowcase.tsx`
- **Patrón:** card-grid (read-only + modal informativo MD)
- **Contenido:** catálogo comercial de muebles por foto **sin BOM ni costos** (F040/F043). Filtros por categoría (chips), búsqueda por código/nombre.
- **Card:** foto o placeholder, código, nombre, dimensiones principales, CTA «Usar en cotización» (dispara alta de cotización con ese módulo).
- **Detalle:** modal MD con imagen grande, descripción, dimensiones, opciones visibles (sin precios de costo).
- **RBAC**: `roleCanAccessShowcaseNav` (admin, ingeniero, gerente_ventas, vendedor). No `produccion`, no `user`.
- **Icono:** `Store`

### 6.7 Cola de producción

- **Ruta nav:** `production` (sección TRABAJO, solo roles con `roleUsesProductionQueue`)
- **Path:** `/produccion` · `packages/ui/src/production/ProductionQueue.tsx`
- **Patrón:** especial (cola de fabricación con tabs accepted/produced)
- **Contenido:**
  - Tabs: «Listos para fabricar» (accepted) y «En producción» (produced)
  - Por proyecto: cliente, muebles (resumen), exports de producción (Optimizer, herrajes, etiquetas, pack), acción «Marcar producido»
  - Sin edición de maestros, sin crear proyectos, sin costos
- **Histórico:** antes (pre-Fase 2 UI) esta pantalla se montaba polimórficamente bajo `home` para `produccion`. Ahora tiene nav + URL propia; `home` siempre es Dashboard para todos los roles.
- **RBAC**: solo `produccion` (vía `roleUsesProductionQueue`). Ingeniero/gerente gestionan producción vía `/projects` con exports (no usan la cola).
- **Icono:** `Factory`

### 6.8 Estructuras

- **Ruta nav:** `structures` (sección INGENIERÍA)
- **Path:** `packages/ui/src/structures/StructuresScreen.tsx` (F049)
- **Patrón actual:** card-expand (cards expandibles sobre la grid + Modal **LG** con tabs para editar). Pendiente de migración a card-detalle en Fase 3.
- **Contenido:** cuerpos reutilizables compuestos de piezas con roles. Cada card muestra código, nombre, dimensiones, revisión (`structure-revision-badge`).
- **Editor:** Modal LG con tabs: General, Componentes, Presets de medida, Preview. `structureRevisionPin` para congela revisión en cotizaciones cerradas.
- **RBAC**: `roleCanMutateModules` (admin, ingeniero).
- **Icono:** `LayoutGrid`

### 6.9 Componentes

- **Ruta nav:** `components` (sección INGENIERÍA)
- **Path:** `packages/ui/src/components/ComponentsScreen.tsx`
- **Patrón actual:** tabla-expand (usando `CatalogTable` con `expandedId`) + Modal **LG** con tabs para editar. Pendiente de migración a card-detalle en Fase 3.
- **Contenido:** piezas reutilizables para componer estructuras. Cada fila/card muestra código, nombre, dimensiones, placement, notas.
- **Editor:** Modal LG con tabs: General, Geometría, Cantos, Opciones, Preview 3D.
- **RBAC**: `roleCanMutateModules` (admin, ingeniero).
- **Icono:** `Puzzle`

### 6.10 Ajustes

- **Ruta nav:** `settings` (sección CONFIG)
- **Path:** `packages/ui/src/settings/SettingsScreen.tsx` (F031)
- **Patrón:** especial (formulario único, no lista)
- **Contenido:**
  - Defaults del taller: `defaultMarginFactor`, `defaultLaborFixedCost`, `currency`
  - `vendedorCanViewCosts` (COST-02 / F044): flag que habilita costos al vendedor
- **Comportamiento:** cambios en defaults **no mutan** proyectos ya creados. Persistencia entre recargas.
- **RBAC**: `roleCanAccessSettings` (admin, gerente_ventas, ingeniero).
- **Icono:** `Settings`

### 6.11 Usuarios

- **Ruta nav:** `users` (sección CONFIG, **solo admin**)
- **Path:** `packages/ui/src/users/UsersScreen.tsx` (F026)
- **Patrón:** tabla simple (acciones inline por fila, sin expand)
- **Contenido:**
  - Lista de usuarios con rol, email, estado (active/pending)
  - Acciones por fila: Aprobar registro pending (cambia a active), Asignar rol (select), Desactivar
  - Badge de pendientes en header (`users-badge`)
- **Roles asignables:** admin, user, vendedor, ingeniero (ex `disenador`), produccion (ex `carpintero`) (F035).
- **RBAC**: solo `admin` (vía `roleCanManageUsers`). El item se añade al sidebar condicionalmente.
- **Icono:** `ShieldCheck`

### 6.12 Login

- **Path:** `packages/ui/src/auth/LoginScreen.tsx`
- **CSS:** `login.css` — solo tokens del design system (sin colores hardcodeados)
- **Comportamiento:** pantalla completa **antes** del shell; no usa `AppShell`
- **Acciones:**
  - Login API: `POST …/auth/login` → JWT en `localStorage` (`muebles_token`) + modo `auth` en `sessionStorage` (`muebles_session`)
  - Invitado: `WifiOff` + «Acceder sin conexión» → modo `guest` (sin token); workspace seed local
  - Link a Registro (#6.13)
- **Iconos:** `LogIn` (submit), `Mail`, `KeyRound`, `WifiOff` (guest)
- **Salida de sesión:** control **Salir** en topbar del shell (`LogOut`); limpia `muebles_session` + `muebles_token` y vuelve a `LoginScreen`

### 6.13 Registro

- **Path:** `packages/ui/src/auth/RegisterScreen.tsx`
- **Patrón:** pantalla completa pre-shell, comparte `login.css`
- **Acciones:**
  - `POST …/auth/register` crea `role=user`, `active=false` (pendiente de aprobación admin)
  - Login de cuenta pendiente → 403 con mensaje claro
  - Tras registro exitoso: mensaje «pendiente de aprobación» + link a Login
- **Iconos:** `UserPlus` (submit), `Mail`, `KeyRound`
- **RBAC**: abierto a cualquiera (es alta de usuario).

---

## 7. Reglas de Implementación

1. **Todas las variables CSS en `src/design-system/tokens.css`** — ningún valor hardcoded
2. **Un solo reset** (`src/design-system/reset.css`) que todos importan
3. **Componentes en `packages/ui`**, nunca lógica en `apps/web`
4. **CSS co-localizado** — cada componente tiene su `.css` al lado
5. **Animaciones + `prefers-reduced-motion`** — siempre wrappear
6. **Foco visible** — `focus-visible` con `--shadow-focus`; nunca `outline: none` sin alternativa
7. **Iconos: solo Lucide React** — no mezclar librerías de icons
8. **Modales con focus trap** — el Tab no debe salir del modal
9. **No romper tests existentes** — el refactor es presentacional
10. **Phased delivery** — una feature a la vez según `feature_list.json`
11. **Botones BEM** — usar `.btn` / `.btn--primary` / `.btn--ghost` / `.btn--danger` / `.btn--small` (ver §5.1)
12. **Pantallas nuevas** — documentar en §6 antes o junto con la implementación

---

## 8. Referencias

- Inspiración de layout: [Linear](https://linear.app), [Notion](https://notion.so)
- Inspiración de design system: [Radix Themes](https://www.radix-ui.com/themes), [shadcn/ui](https://ui.shadcn.com)
- Iconos: [Lucide](https://lucide.dev)
- Tipografía: [Inter](https://rsms.me/inter/)
- Teoría de color: [Refactoring UI](https://www.refactoringui.com/)

---

*Este documento es fuente de verdad para el diseño. Ante cualquier duda sobre color, espaciado, patrón o componente, este documento es el árbitro. Si la respuesta no está aquí, agregarla aquí antes de implementar.*
