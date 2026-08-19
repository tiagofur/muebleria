# Design Guide — Muebles App

> **Estado:** v3.0 — estándar de excelencia UI/UX: ejecución Apple × sistema Material (2026-08-18)
> **Autores:** Producto + agente de diseño
> **Fecha:** 2026-08-18
> **Referencias:** critique 30/40 (`.impeccable/critique/2026-08-19T03-12-17Z__*.md` — la ruta a 32+ queda codificada en este doc) · capa de craft v2.1 (2026-08-19) · unificación v2 (2026-08-18)

**Cómo leer:** §2 = el estándar (ADN + bar de calidad) · §3–5 = el sistema (tokens, patrones, componentes) · §6 = specs por pantalla · §7–8 = contenido y gate de calidad · §9–10 = implementación y referencias.

---

## 1. Diagnóstico del estado actual

> **Archivado.** El diagnóstico pre-rediseño (U1–U8 de UX, I1–I8 de UI) está
> resuelto: F016–F023 + unificación v2 + capa de craft v2.1 lo cerraron.
> Ver `docs/history/diagnostico-ui-pre-rediseno.md` como memoria de por qué
> se rediseñó. Este documento describe el sistema **actual** (§2 en adelante).

---

## 2. Principios de Diseño

Estos principios no son decorativos — son restricciones que todo componente debe respetar.

1. **Claridad sobre decoración.** Cada elemento visual debe tener una función. Si eliminar algo no cambia la comunicación, se elimina.
2. **Jerarquía explícita.** El peso visual (tamaño, color, contraste) comunica importancia. La acción principal siempre debe ser obvia.
3. **Feedback inmediato.** Toda acción del usuario recibe una respuesta visual en menos de 150ms.
4. **Contexto preservado.** El usuario nunca pierde de vista dónde está ni qué estaba haciendo. Los modales preservan el contexto de la lista.
5. **Progressive disclosure.** Mostrar lo mínimo necesario. Los detalles aparecen cuando se piden.
6. **Consistencia de patrones.** Un mismo problema siempre se resuelve de la misma manera. Si crear un Material usa un modal, crear un Herraje también usa un modal.

### 2.1 ADN visual — Apple × Google (regla de fusión)

El estándar de **ejecución** es Apple (Human Interface Guidelines); el estándar de **sistema** es Google (Material 3). La mezcla no es "un poco de cada": cada casa aporta a un **dominio distinto** y hay una regla de desempate para que la combinación no degenere.

| Dominio | Gana | Qué significa aquí |
|---------|------|--------------------|
| **Chrome y movimiento** | Apple | Contenido primero, chrome que se difumina. Si un efecto no explica jerarquía o estado, no existe. Animaciones 150–250ms, sin bounce, sin coreografías de carga (§3.6). |
| **Profundidad** | Apple | La elevación dice dónde está el usuario — contenido < toolbar < modal < overlay (§3.3.1). Nunca como adorno: glassmorphism prohibido por defecto. |
| **Precisión táctil** | Apple | Cada control "se siente" físico: hover, press (`translateY(1px)` + oscurecimiento), foco visible. Un botón plano que no responde está roto, no "minimalista". |
| **Estados de componentes** | Google (M3) | Todo control interactivo nace con su matriz completa: default/hover/focus/active/disabled (+loading/error si aplica). Fusionar con estados a medias es un bug, no una omisión menor (§3.6.1). |
| **Color por roles** | Google (M3) | Color como sistema de roles — brand / área / semántico / superficie (§3.2) — con state layers tonales. Nunca color decorativo ni bordes a saturación plena para señalizar estado. |
| **Accesibilidad** | Google (M3) | AA no es opcional: contraste, targets, teclado, lectores de pantalla (§4.8). La a11y es parte del diseño, no un parche posterior. |
| **Densidad** | Google (M3) | Herramienta profesional: densa pero con aire (tokens `--density-*`). La densidad nunca compra legibilidad por debajo de 14px cuerpo / 12px labels. |

**Regla de desempate:** si la decisión es sobre *decoración* → gana Apple (se quita).
Si la decisión es sobre *completitud del sistema* (estados, roles, a11y) → gana
Google (se completa). Lo prohibido es el cruce inverso: decoración ruidosa con
estados incompletos — eso es la app mediocre y fea que este documento existe
para impedir.

**Clase de referencia:** Linear y Stripe Dashboard (registro `product`, ver
`docs/PRODUCT.md`). El test no es "se parece a Apple"; es "Apple o Google
firmarían esta pantalla" — ejecutando el producto de un taller.

### 2.2 La prueba de las 8 horas

El usuario de Muebles pasa la jornada laboral entera dentro de esta app, en un
taller, con prisa, donde los errores cuestan dinero. El bar de calidad se mide
contra eso — no contra una demo:

1. **Cero deuda visual.** A las 6 horas de uso, lo que molesta no es lo que falta: es lo que sobra. Cada elemento que no sirve a la tarea se vuelve ruido acumulado. Se elimina.
2. **Todo responde.** Cada acción tiene feedback < 150ms (hover, toast, cambio de estado). Una app que no responde se siente rota aunque funcione perfecto.
3. **Nada grita.** Superficies calmadas, UNA acción primaria por vista, color con rol. El drama visual cansa a la hora; la confianza no cansa nunca.
4. **Consistencia = velocidad.** Mismo patrón resuelve mismo problema (§4.2): la memoria muscular del usuario es la característica más valiosa del producto. Una excepción "solo esta vez" cuesta un micro-error por día, por usuario, para siempre.
5. **El detalle se nota sin nombrarse.** Números tabulares alineados a la derecha, teléfonos formateados, `—` en vez de vacío, truncado con ellipsis, unidades correctas (§7.2). Nadie lo señala, pero todos lo sienten: *"esta app la hizo alguien que sabe lo que hace"*. Ese es el estándar "digno de premio".

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

#### 3.2.1 Contexto tonal de área — identidad por proceso

El color de área comunica **ubicación dentro del proceso del taller**, no prioridad
ni estado. Cada destino del shell resuelve exactamente un contexto: `sales`,
`eng`, `work` o `neutral`. El contexto se aplica en el frame compartido y se
propaga mediante roles semánticos, nunca mediante hex o mezclas locales.

| Contexto | Secciones actuales | Familia | Propósito |
|---|---|---|---|
| `sales` | VENTAS | teal | relación comercial y avance |
| `eng` | INGENIERÍA, LIBRERÍA, CATÁLOGOS | indigo | precisión y estructura técnica |
| `work` | PRODUCCIÓN, COMPRAS / ALMACÉN | naranja taller | operación física y secuencia |
| `neutral` | TRABAJO, CONFIG | neutral con sesgo brand | visión transversal y administración |

Apple aporta la jerarquía calma del frame y feedback de interacción; Material 3
aporta roles, state layers y pares accesibles; Muebles decide la taxonomía y
significado de cada área. Si hay conflicto, la prevención de errores del taller
prevalece; después, Apple guía chrome/jerarquía y Material guía sistema/a11y.
No se copian skins ni componentes de plataforma.

**Cascada de roles:** el `AppShell` declara `data-area-context` y ese atributo
resuelve `--area-canvas`, `--area-chrome`, `--area-container`, `--area-border`,
`--area-selected`, `--area-ink`, `--area-state-hover`, `--area-state-pressed` y
`--area-state-focus`. El contenido usa únicamente estos aliases contextuales;
los aliases cambian de familia, no de significado.

| Superficie o estado | Rol | Regla observable |
|---|---|---|
| Main canvas completo | `--area-canvas` | El fondo del trabajo cambia sutilmente al navegar entre Sales, Engineering, Production y neutral. |
| Topbar/chrome compartido | `--area-chrome` + `--area-border` | Ancla el área sin competir con el contenido. |
| Selección e inspector contextual | `--area-selected` / `--area-container` | Tinte medio, acompañado de texto, icono o forma; nunca color solo. |
| Texto/icono sobre tinte de área | `--area-ink` | Par AA verificado sobre canvas, chrome, container y selected. |
| Cards, body de tablas e inputs | superficies `--surface-*` neutrales | Siguen siendo superficies de concentración y lectura de datos. |
| CTA primaria y focus | `--brand-*`, `--shadow-focus` globales | No cambian entre áreas. |
| Success/warning/danger/info | roles semánticos globales | No cambian entre áreas ni se reutilizan para ubicación. |

**Reglas duras:** el área tiñe el canvas y chrome de la pantalla completa con
baja cromaticidad; no rellena indiscriminadamente superficies de trabajo ni
sustituye colores semánticos o brand. Tablas conservan su body neutral. Una
card estándar no recibe fondo de área solo para “agregar color”.

**Accesibilidad y temas:** cada par `--area-ink` / canvas, chrome, container y
selected debe sostener contraste WCAG AA (4.5:1 para texto normal). Los valores
light se verifican mediante los 16 cálculos de contraste en `packages/ui/src/shell/appShell.test.ts`; dark e increased-contrast requieren
sus propios tokens y una feature dedicada, no una inversión automática.

**QA:** al alternar `data-area-context` en el shell, canvas y topbar cambian de
familia; cards, formularios y tablas permanecen neutrales; primary, focus y
estados semánticos conservan su significado global.
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

#### 3.3.1 Semántica de elevación (capas del producto)

La profundidad dice **dónde estás**, no decora. El producto entero vive en cinco niveles:

| Nivel | Superficie | Tratamiento |
|-------|-----------|-------------|
| **L0** | Fondo de app (`--surface-app`) | Plano, sin sombra |
| **L1** | Cards, panels, formularios (`--surface-card`) | Borde `--border-subtle` + `--shadow-xs/sm` |
| **L2** | Chrome sticky (topbar, workspace-chrome, `th` sticky, tabs) | `--surface-card` + `--shadow-sm` + borde inferior |
| **L3** | Dropdowns, popovers, tooltips | `--surface-card` + `--shadow-md` |
| **L4** | Modales, drawers, toasts, command palette | `--surface-card` + `--shadow-lg/xl` + overlay |

**Reglas:**
- Cada elemento pertenece a UN nivel. Prohibido apilar borde + sombra grande como decoración ("ghost card"): en L1 se elige borde sutil **o** `--shadow-sm`. Las sombras del sistema son de blur chico a propósito.
- Elevar = subir **exactamente un nivel** (L1→L2 en hover de card). Saltarse dos niveles rompe la metáfora espacial.
- La elevación nunca reemplaza jerarquía tipográfica: un título no "sube de nivel", se hace más grande.

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
- Toggle «Cómoda / Compacta» no está implementado; hoy la app **es** compacta por defecto.
- Solo tokens; sin hex ni `px` sueltos en feature CSS.

---

### 3.5 Border Radius

```css
--radius-sm:   4px;
--radius-md:   8px;
--radius-lg:   12px;
--radius-xl:   16px;
--radius-2xl:  24px;
--radius-full: 9999px;
```

**Política de geometría (v2.1):** TODO control interactivo (`.btn`, chips de filtro, tabs, inputs, select) usa `--radius-md`. `--radius-full` queda **reservado** a tags de estado (`.status-badge`) y barras de progreso. Cards: `--radius-md` (entity) / `--radius-lg` (secundarias). `--radius-sm` solo para detalles intra-componente (kbd, chips diminutos).

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

#### 3.6.1 State layers — el sistema táctil completo (M3)

El estado de un control se expresa con **capas tonales sobre el color propio del
control**, nunca cambiando su tamaño ni estructura:

| Estado | Receta |
|--------|--------|
| `:hover` | Overlay tonal ~6–8% (ink o color del control) — o, en rellenos sólidos, un paso de la rampa (500→600) |
| `:active` | Overlay ~10–12% + `translateY(1px)` (se desactiva con reduced motion) |
| `:focus-visible` | `--shadow-focus` (ring 3px brand 25%). Nunca `outline: none` sin alternativa |
| `:disabled` | Opacidad ~50% + `cursor: not-allowed`; sin hover ni active |
| Selected/pressed persistente | Fondo tonal de la rampa (`-100`/`-200`) — no borde a saturación plena |

**Reglas:**
- El cambio de estado **nunca mueve el layout**: solo color, sombra u overlay. Nada crece 1px al hacer hover (provoca jitter y mis-clicks).
- La matriz completa aplica a TODO control interactivo: botones, chips, tabs, filas, cards, inputs, badges clickeables. Un control sin sus estados no se mergea (ver §8 DoD).

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

**Reglas de uso (v3):**
- **Icono + texto por defecto** en nav y acciones. Icono solo (`btn--icon`) exige `aria-label` + tooltip; un icono nunca es la única pista de una acción.
- **Un solo weight visual:** `strokeWidth={1.5}` en todo tamaño; no se "compensa" con stroke más grueso en iconos chicos.
- El icono hereda el color del texto adyacente; color propio solo con rol explícito (área `--area-*-500`, semántico §3.2, o inverse sobre brand).
- Icono nuevo = fila nueva en esta tabla. Prohibido importar de otra librería o dibujar SVG propio.

---

## 4. Patrones de Interacción

### 4.0 Breakpoints canónicos (issue #34)

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

**Touch:** en `max-width: 767px`, `.btn` / `.btn--small` / acciones de fila usan `min-height: var(--touch-min)`. **Estándar v3: 44px** (Apple HIG; 48dp en móvil nativo, ver `docs/mobile-ui-ux.md`). Hoy `--touch-min` es 2.5rem (40px) — migrar a 2.75rem al tocar CSS de touch. Desktop compacto (#49) no cambia.

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
| TRABAJO | Inicio (`home`), Estado de Planta (`plantBoard`, todos los roles) |
| PRODUCCIÓN | Dashboard Producción (`productionDashboard`), Órdenes (`production`, cola + hub OP — temporal, M2 lo elimina), Producción (`fabric`, estaciones corte→embalaje), Embarques (`embarques`, carga), Instalaciones (`instalaciones`, en obra) |
| VENTAS | Dashboard (`salesDashboard`), Cotizaciones (`projects`), Clientes (`customers`), Vitrina (`showcase`) |
| INGENIERÍA | Ingeniería (`engineering`); ABM en LIBRERÍA/CATÁLOGOS |
| COMPRAS / ALMACÉN | Almacén (`purchasing`) |
| LIBRERÍA | Muebles (`modules`), Estructuras (`structures`), Agregados (`agregados`), Componentes (`components`), Grupos (`optionGroups`) |
| CATÁLOGOS | Materiales (`materials`), Cantos (`edges`), Herrajes (`hardware`), Acabados (`ambientMaterials`) |
| CONFIG | Ajustes (`settings`), Usuarios (`users`, solo admin) |

**Regla de orden** (menu reorg): dashboards PRIMERO, luego lo más general
bajando a lo más específico siguiendo el orden de proceso del taller
(orden de obra → fabricar → cargar → instalar).

**Reglas de carga del nav (v3 — salud de la IA):**
- **Labels únicos en TODO el nav** (y por ende en ⌘K). Prohibido repetir label entre secciones: dos «Dashboard» son ambigüedad en la paleta y en la memoria del usuario. Si dos dashboards coexisten, el label lleva el área: «Dashboard Ventas» / «Dashboard Producción» (el título de pantalla puede ser más corto).
- **Máx ~5 ítems visibles por sección**, ~24 ítems totales por rol. Si una sección crece más, se sub-agrupa o se mueve a una pantalla hub — no se "achata" el label para que quepa.
- El orden es fijo por proceso; NO se reordena por rol.
- Badge contador en ítems del nav: máximo 1 por sección (si todo tiene badge, nada lo tiene).

Secciones vacías por rol se auto-ocultan (AppShell filtra por `allowedNavIds`).

#### Vocabulario de producto (UI copy — issue #52)

Títulos de pantalla = labels de nav. Código/API en inglés; **copy de UI en español de taller**.

| Nav / UI | Código (no renombrar) | Notas |
|----------|------------------------|-------|
| **Inicio** | `home` | No «Home». Dashboard para todos los roles (variantes por `homeMode`) |
| **Producción** | `fabric` | Estaciones de fabricación (corte→embalaje), ex «Fábrica». Ruta `/fabrica` (histórica). Roles: `roleCanAccessFabricNav` |
| **Embarques** | `embarques` | Carga al transporte (embalado→cargado), board por obra. Roles: `roleCanAccessShippingNav` (sin almacén) |
| **Instalaciones** | `instalaciones` | Instalación en obra (cargado→instalado), board por obra + contador de instalados. Mismos roles que Embarques |
| **Órdenes** | `production` | Cola + hub OP por obra (`/produccion/:id`) — TEMPORAL, se elimina en M2. Roles con `roleCanAccessProductionNav`. Ver `docs/production-module.md` |
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

- **Sidebar**: `--surface-sidebar` (oscuro), texto inverse, ítem activo con borde izquierdo + **superficie del color de área al 28%** + ícono en color de área `-300` (v2.1 tonal — el activo tiene que verse); label de sección en color de área `-300` pleno
- **Brand chrome (issue #53):** `BrandMark` monochrome (tile + paneles) + wordmark «Muebles» — **sin emoji**; mismo mark en Login/Register y favicon web
- **Command palette (issue #54):** `Cmd/Ctrl+K` en el shell — secciones de nav + cotizaciones/muebles recientes; teclado ↑↓ Enter Esc; denso, sin búsqueda de marketing
- **TopBar**: `--surface-card` con `--shadow-sm`; **NO repite el título de la pantalla** (ver §4.1b); acciones opcionales (`headerActions`, p. ej. **Salir**)
- **Content**: `--surface-app`, padding `--space-6`
- **Entrada por defecto:** `home` (Dashboard) para todos los roles. El redirect al gate de sesión / falta de permiso usa `home`. Para produccion, `home` sigue siendo Dashboard (la cola es su propia ruta `/produccion`).

#### 4.1a Esqueleto único de página (v3 — OBLIGATORIO)

TODA pantalla del producto usa el mismo esqueleto, en este orden:

```
┌────────────────────────────────────────────────────────┐
│ PAGE-HEADER                                             │
│ [icon-chip área] Título (--text-xl, h2)  [acciones]     │
│ Subtítulo (--text-base, secondary)       [1 primary]    │
├────────────────────────────────────────────────────────┤
│ PAGE-TOOLBAR (opcional): buscar · filtros · tabs        │
├────────────────────────────────────────────────────────┤
│ CUERPO: lista / tabla / cards / board / form            │
├────────────────────────────────────────────────────────┤
│ ESTADOS: loading (skeleton) · empty (enseña) · error    │
└────────────────────────────────────────────────────────┘
```

- **Primitives obligatorios:** `PageHeader` y `PageToolbar` de `packages/ui/src/common/`; las pantallas no reconstruyen markup de header/toolbar. El header recibe slots tipados de `title`, `subtitle`, `icon`, `primaryAction`, `secondaryActions`, `overflowActions` y `contextualControls`. La toolbar recibe `search`, `filters`, `tabs` y `contextualControls`.
- **Page-header:** es el único dueño de título, icono de área, subtítulo y acciones de nivel página. Título `h2` en `--text-xl`; un panel interno de workspace puede usar `h3`, sin competir con el título del workspace.
- **Icon-chip de área:** cuadrado de 24–28px, radio `--radius-md`, fondo `--area-container` e ícono `--area-ink`. Es ubicación, nunca CTA ni estado semántico.
- **Toolbar:** aparece directamente bajo el header cuando existen búsqueda, filtros, tabs o controles de contexto. No se crean toolbars con placeholders vacíos.
- **Gap raíz:** `--density-page-gap` para TODAS las pantallas.
- **Estados:** `EmptyState` / `ListSkeleton` / `PageLoading` comunes — prohibidos empty states propios.
- **Workspaces tipo hub** (detalle de cotización, orden de producción `/orders/:id`): el chrome del workspace conserva back + título + meta densa + acciones. Dentro de una tab/panel, `PageHeader` puede presentar el contexto local en `h3`; nunca duplica la primaria del workspace.

**Gramática de acciones:**

1. Una página o tab activa tiene como máximo **una acción primaria visible**. La primaria vive en el `PageHeader` **o** en la tab activa, nunca en ambos niveles.
2. Acciones secundarias permanecen visibles solo si son frecuentes y no destructivas. Acciones poco frecuentes, administrativas o destructivas no primarias se envían a `overflowActions` (`DropdownMenu`); el menú debe abrirse por mouse y teclado, cerrar con Escape y devolver foco al trigger.
3. Una acción imposible por permiso o por ausencia de contexto se **oculta**. Una acción relevante pero bloqueada se mantiene `disabled` con un nombre/explicación accesible (por ejemplo `title`, texto auxiliar o descripción asociada); disabled no es sustituto de RBAC.
4. Los controles icon-only tienen `aria-label`. Todo control de chrome mantiene foco visible, target táctil de al menos 44px cuando es compacto y respeta `prefers-reduced-motion`.
5. El color de área solo ambienta `--area-canvas`, `--area-chrome` y el icon-chip. CTA primaria, focus y estados success/warning/danger/info conservan roles globales.

#### 4.1b Regla de título único (v2)

- El **page-header es el único dueño del título** de la vista (h2 `--text-xl`).
- El **topbar NO repite el título**. Su rol es contexto global: búsqueda Cmd+K + identidad/rol de usuario + Salir. Puede mostrar el **área** (label de sección, color de área, peso medio) a modo de "dónde estoy".
- El título del header debe **coincidir con el label del nav** que lleva a la pantalla (p. ej. nav «Órdenes» → título «Órdenes», no «Para fabricar»). El matiz de proceso va en el subtítulo.
- Jerarquía de headings: `h2` = título de pantalla; `h3` = sección; `h4` = subsección. Prohibido `h1` dentro del content (el `h1` semántico, si se necesita, es del documento).

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

**Regla dura:** si una entidad tiene partes/herrajes/opciones/dimensiones múltiples, **no** usar tabla-expand ni card-expand. Usar card-detalle (vista inline). La edición compleja vive en su propia ruta (`/:id/edit`) o en modal **LG** con tabs.

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

### 4.8 Accesibilidad y teclado (estándar AA)

La a11y no es una pasada final: es parte del sistema (§2.1, dominio Google).

**Contraste:**
- Texto body ≥ 4.5:1 · texto large (≥18px o bold ≥14px) y componentes UI ≥ 3:1 · placeholder ≥ 4.5:1 (mismo estándar que el texto — gris lavado prohibido).
- Verificar `--text-muted` sobre CADA superficie donde se use; si no pasa, subir a `--text-secondary`.

**Teclado — mapa completo del producto:**

| Tecla | Acción |
|-------|--------|
| `Tab` / `Shift+Tab` | Orden natural: el orden del DOM = orden visual |
| `Cmd/Ctrl+K` | Command palette (§4.1) |
| `Esc` | Cierra modal / drawer / dropdown / palette. NUNCA navega hacia atrás |
| `↑ ↓` | Roving focus en listas y boards (patrón ya usado en estaciones de Producción) |
| `Enter` | Activa el ítem enfocado |
| Focus trap | En modales: Tab no sale; al cerrar, el foco **vuelve al trigger** |

**Lectores de pantalla (VoiceOver/NVDA):**
- Landmarks: `nav` (sidebar), `main` (content), `dialog` (modales) + `aria-label` en cada uno.
- Toasts: `aria-live="polite"`; errores de form junto al campo con `aria-describedby`.
- El significado nunca viaja solo por color: los badges llevan dot + texto (§5.2); el estado de una fila nunca es solo un color.
- Botones icon-only: `aria-label` SIEMPRE.

**Targets y motor:** ≥44×44px en touch (§4.0), foco siempre visible (`:focus-visible` + `--shadow-focus`), `prefers-reduced-motion` en todo el sistema (§3.6).

### 4.9 Ayuda contextual

La ayuda vive DONDE se necesita, no en un centro de documentación. (Existe para subir el H10 del critique: 2/4.)

| Patrón | Cuándo | Regla |
|--------|--------|-------|
| **Hint inline** (`--text-sm` secondary bajo el campo) | Campos con consecuencias de negocio: margen, merma, presets, `structureRevisionPin` | Solo en campos críticos — hint en TODO es ruido |
| **Tooltip** (icono `Info` 14px, o sobre acciones icon-only) | Jerga técnica del taller/producto: «zócalo», «Optimizer», «pack», «rev» | Menos de 2 líneas; define el término, no un tutorial |
| **EmptyState que enseña** (§4.5) | Listas vacías | Ya estándar |
| **Error que enseña** (§7.3) | Validaciones | Dice qué pasó y cómo resolverlo |
| **Subtítulo de contexto** (§4.1a) | Pantallas con flujo no obvio («el avance se marca desde Producción») | Ya estándar en Estado de Planta |

**Prohibido:** tours forzados, popups de onboarding bloqueantes, "centro de ayuda"
al que haya que ir. El usuario experto no puede ser frenado por la ayuda al
novato: la ayuda es contextual u opt-in, nunca modal.

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

**Estados táctiles (v2.1 — obligatorio en todo control):**
- `:hover` — state layer: cambio de tono + `--border-strong` (secundarios) o elevación `--shadow-xs → --shadow-sm` (rellenos sólidos: primary/success).
- `:active` — `translateY(1px)` + oscurecimiento un paso (`brand-500→700` en primary). Mismo lenguaje que `.tab-btn`. Se desactiva el translate bajo `prefers-reduced-motion`.
- Primario en reposo lleva `--shadow-xs` (profundidad mínima que invita al toque); **nunca** sombra mayor a `--shadow-sm` en botones.

### 5.2 Badges de Status (v2 — vocabulario único)

Un SOLO sistema de badge de estado con modificadores **semánticos** (no por entidad):

```
.status-badge--draft      — gris azulado — "● Borrador"
.status-badge--quoted     — azul     — "● Cotizado"
.status-badge--accepted   — verde    — "● Aceptado"
.status-badge--rejected   — rojo     — "● Rechazado"
.status-badge--produced   — morado   — "● En producción"
.status-badge--open       — azul     — abierto / pendiente
.status-badge--progress   — índigo   — en proceso
.status-badge--done       — verde    — resuelto / documentado / completo
.status-badge--cancelled  — gris     — cancelado / enviado (read-only)
.status-badge--active     — verde    — "● Activo"
.status-badge--inactive   — gris     — "● Inactivo"
```

- Vive en `common/statusBadge.css` (extracción v2 completada). Las familias propias (`purch-badge`, `warranty-badge`, `internal-comms__status-badge`, `eng-badge`, `users-role-badge`, …) migran a este vocabulario y se eliminan.
- **Sin borde en los semánticos (v2.1):** badge = tinte de fondo (`-50`) + texto (`-700`) + dot. El borde 1px a saturación plena (`-500`) engorda y compite con el texto. Solo los neutrales (draft/cancelled/inactive) conservan `--border-default` para definirse sobre blanco.
- Estados de USO (activo/inactivo) y de FLUJO (draft/quoted/…) usan semánticos (§3.2), **nunca** color de área.
- Badges de categoría/meta (no estado) que no mappeen acá: texto `--text-secondary` sin cápsula de color, o chip neutral.

### 5.3 Cards vs Tabla

- **Cards**: Cotizaciones (Proyectos), Muebles — información rica y heterogénea
- **Tabla**: Materiales, Cantos, Herrajes, Grupos, Clientes — datos tabulares densos y comparables

### 5.4 Stat-card único (v2)

Un SOLO componente de indicador KPI, `.stat-card` en `common/statCard.css`
(reemplaza `dashboard__stat`, `eng-stat`, `purch-stat`, `pm-dashboard__card`,
`sales-monthly__card`, `ship-board__stat`):

```
┌──────────────────────────┐
│ [icon 18px área/semántico]│  ← opcional, tint -100 fondo / -500 ícono
│ 42              --text-2xl│  ← valor, tabular-nums, bold
│ Documentados    --text-sm │  ← label, secondary
└──────────────────────────┘
```

- Variante interactiva `.stat-card--button` (clickeable como filtro): borde `--area-*-400` + fondo `--area-*-100` cuando activo; NUNCA tinte de fondo en estado rest.
- Variante énfasis `.stat-card--emphasis` (KPI principal de dashboards) — **momento editorial (v2.1)**: borde `--brand-300`, lavado tonal sutil (`--brand-50` → card), chip de ícono brand y valor a escala hero `--text-2xl` incluso en `--stack`. Las demás stats de la fila quedan visiblemente secundarias.
- Iconos usan el color de ÁREA si el KPI es de área, o semántico si es de estado.
- Prohibido crear stat-cards por pantalla.

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
- **Chrome — agrupación de acciones (wave 4 density + PROD-0.2):**
  - **Exactamente un `btn--primary` de ciclo de vida** por status: Enviar (draft) · Aceptar (quoted) · **Abrir en Producción** (accepted/produced si el shell pasa `onOpenInProduction`) · si no hay workspace de fábrica: Marcar en producción / Exportar Optimizer.
  - **Sin exports de fábrica en cotización:** con `onOpenInProduction`, Optimizer / pack / herrajes / etiquetas / marcar producido **no** aparecen en el chrome ni en **Más** de cotización. Solo viven en el workspace **Producción** (hub / cola). En cotización queda como máximo la navegación **Abrir en Producción**.
  - **Exportar Optimizer** en chrome de cotización solo si plant-ready **y** no hay `onOpenInProduction` (shell legacy sin workspace de fábrica).
  - **Presentar** + **Editar** (si `canMutate`) como secundarios en chrome.
  - **Más ▾** (`DropdownMenu`): Abrir en Producción (si aplica, solo nav) + **Comercial** (cotización xlsx / PDF) + Duplicar / Guardar plantilla / Reabrir / **Eliminar**.
  - Mobile: total y actions full-width debajo del lead (`.project-detail` + workspace-chrome).
- **Cliente:** picker de clientes activos + acción «Nuevo cliente» (alta inline o navegación a Clientes según wiring del shell)
- **Plantillas (#110):** toolbar con «Desde plantilla» (picker) y «Plantillas» (gestión); chrome con «Guardar como plantilla» desde un proyecto
- **Búsqueda / filtros:** SearchInput
- **EmptyState** cuando no hay cotizaciones
- **RBAC**: `roleCanAccessProjects` (todos los roles salvo `user`). `produccion` ve lista filtrada a accepted/produced.

### 6.3 Muebles

- **Ruta nav:** `modules` (sección **INGENIERÍA**, no TRABAJO)
- **Path:** `packages/ui/src/modules/`
- **Título de pantalla:** **Muebles**
- **Patrón:** card-detalle + `EntityEditorLayout` (lista → detalle → editor full-page). Shell de detalle: `EngineeringDetailLayout` (`.eng-detail`).
- **Lista:** cards con **media 4:3/16:10 arriba** (foto si existe; sin foto = silueta con tinte `--area-eng-100` e ícono `--area-eng-400`, nunca caja dashed vacía — v2.1), código, nombre, conteos de partes/herrajes, estimate de precio de venta (shell)
- **Detalle (wave 3 UI):**
  - **Chrome sticky:** código, nombre, categoría/meta, **Precio est.**, Vista 3D, Editar (primary), menú **Más** (Duplicar / Eliminar)
  - **Body 2-col:** primario = preview de costo + componentes; secundario = estructura/medidas + herrajes + presets comerciales
- **Editor:** full-page workspace con tabs (General, Estructura, Componentes, Medidas, Herrajes, Costo).
- **Preview de costo:** props del shell (`costPreview`, `previewBlocked`, `missingGroups`); sin fórmulas en UI
- **Categorías jerárquicas (F025):** panel lateral con árbol editable de hasta 3 niveles + filtro en cascada
- **EmptyState** + SearchInput con debounce
- **RBAC**: `roleCanAccessModulesNav` (admin, ingeniero)

### 6.4 Catálogos (Materiales / Cantos / Herrajes / Grupos)

- **Rutas nav:** `materials` | `edges` | `hardware` | `optionGroups` (sección INGENIERÍA)
- **Paths:** `packages/ui/src/catalogs/`, `packages/ui/src/optionGroups/`
- **Patrón común:** tabla-expand (`.data-table` + `--wrap` + expand de fila + Modal **SM**/ **MD**)
- **Tabla (issue #56 + Fase 1):** `.data-table-wrap` es scrollport (`overflow: auto` + `max-height`); `th` con `position: sticky; top: 0`, fondo sólido y `border-collapse: separate` para sticky fiable; filas densas vía tokens `--density-table-*`; edge-fade gradients laterales. Desde Fase 1 UI, `catalog-table-wrap` / `users-table-wrap` / `dashboard-owners-wrap` son aliases de `.data-table-wrap` en `common/dataTable.css`.
- **Expand (wave 5):** `.catalog-row-detail` card inset con defs densas; en actions **Editar** es `btn--primary` small, desactivar/eliminar secundario.
- **Forms (wave 5):** fieldsets `.catalog-form__section` + título sentence-case (no ALL CAPS). Materiales ya tenía secciones; Cantos (Identidad / Medida y costo), Herrajes (Identidad / Compra), Grupos (Identidad / Miembros) alineados.
- **Materiales / Cantos / Herrajes:** `CatalogTable`, desactivar/reactivar, badges de activo, imagen (F042), color swatch y `defaultEdgeBandId` (F027)
- **Grupos de opciones:** pantalla propia con tabla/listado y modal; preview de precio gated por `PricePreviewGate` (tokens de estado, no hex sueltos)
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
- **Patrón:** card-grid comercial foto-first (read-only + modal informativo **LG**)
- **Contenido:** catálogo comercial de muebles por foto **sin BOM ni costos** (F040/F043). Filtros por categoría (chips root), búsqueda por código/nombre.
- **Card:** media **4:3**, nombre dominante, medidas, código muted + badge de categoría. Click abre detalle. **Sin** CTA primary en la card (browse-only).
- **Detalle:** modal **LG** con imagen hero, código, medidas, categoría, notas; un solo primary «Usar en cotización» (si el shell pasa `onUseInQuote`). Opciones visibles sin costo: pendiente de prop de grupos (no inventar precios).
- **RBAC**: `roleCanAccessShowcaseNav` (admin, ingeniero, gerente_ventas, vendedor). No `produccion`, no `user`.
- **Icono:** `Store`

### 6.7 Órdenes (cola + hub de obra)

- **Ruta nav:** `orders` (sección PRODUCCIÓN, label **Órdenes**). M2 puede consolidar dashboards — ver `docs/roadmap-screens/00-overview.md`
- **Paths:**
  - `/orders` — cola de trabajo
  - `/orders/:projectId` — hub de orden (OP)
  - `/orders/:projectId/:tab` — sub-vista, slugs en inglés (`summary`, `floor`, `labels`, `hardware`, `documents`; legacy `exports` → documentos)
- **Código:** `ProductionWorkspace` → `ProductionQueue` | `ProductionOrderHub` (`packages/ui/src/production/`)
- **Doc de producto:** `docs/production-module.md` (reglas R1–R7, roadmap)
- **Patrón:** workspace de fábrica con chrome propio (`.prod-hub__header` — ver §4.1a workspaces)
- **Contenido:**
  - Cola: tabs «Para fabricar» (sin claim de corte) / «Ya en producción» (con claim); CTA primario **Abrir orden**; Pack y Marcar en producción secundarios. Chip de **sector activo + %** por obra (F093, `ProjectFloorStageChip`)
  - Hub tabs: **Resumen · Piso · Etiquetas · Herrajes · Documentos** (única pestaña de descargas). **Control de Carga (despacho) migró a Embarques** (`/shipments/:projectId`, `EmbarquesProjectDetail`); las tabs técnicas (Módulos, Despiece, Vistas, Optimización) viven en **Ingeniería** (`EngineeringWorkspace`); generación de documentos = Ingeniería, uso = Fábrica
  - Tab **Piso**: paperless cards + escaneo QR (lector USB, cámara o manual) + avance one-tap (PROD-4.2); filtro por estado de piso con conteos
  - Hub: banner si el diseño cambió tras el último pack (PROD-3.2 OP rev. + fingerprint); filtro por ambiente en obras multi-ambiente (PROD-4.4)
  - Hub Resumen: checklist listo-para-cortar, totales de fábrica (módulos, piezas, m² tablero, ML canto) y desglose comprar/cargar por material; **solo lectura del diseño**
  - Pack ZIP ampliado: carátula + Optimizer + herrajes + etiquetas PDF/ZPL + resumen + despiece + elevaciones + hojas de armado + cut-list CSV configurable + CNC pilot JSON (`muebles.cnc-pilot.v1`) — no reemplaza Optimizer (#111)
  - Desde cotización accepted|produced: CTA **Abrir en Producción** (PROD-0.2: sin muro de exports en chrome ni Más)
  - Detalle de cotización accepted|produced: **franja de procesos** bajo el header (`ProjectFloorProgressStrip`, F093) — visible a cualquier rol con acceso a la obra (vendedor incl.)
- **RBAC nav:** `roleCanAccessProductionNav`. La ruta `/orders` sin permiso **debe redirigir a `home`** (§4.1) — deuda conocida: hoy renderiza main vacío.
- **Icono:** `Factory`

### 6.7a Producción (estaciones de fabricación)

- **Ruta nav:** `fabric` (sección PRODUCCIÓN, label **Producción**, ruta histórica `/fabrica`) — ex "Fábrica"
- **Path:** `packages/ui/src/production/FabricScreen.tsx`
- **Patrón:** tabs de estación (corte → encintado → armado → embalaje) con roving tabindex + cola por estación + toggle Cola/Métricas (gerente)
- **Contenido v1 (actual):** lista de ítems en cola por estación con avance one-tap (`onAdvance` → server con scoping + evento F092); Operador sector-scoped ve solo sus tabs
- **v2 APROBADA (JD 2026-08-18, pendiente de implementación):** board **por obra** con bloque de métricas por estación (Corte: tableros por acabado m²/piezas/planchas + surtido de almacén; Encintado: cintillas ML/piezas/lados; Armado: muebles; Embalaje: módulos), claim "Empezar [estación]" obra×estación (D9) y avance batch. **Spec completa: `docs/roadmap-screens/03-fabrica.md`** — implementar contra esa spec, no contra v1
- **RBAC nav:** `roleCanAccessFabricNav` (admin, gerente_produccion, produccion)
- **Icono:** `Factory`

### 6.7b Estado de Planta (tablero de avance para todos — F093)

- **Ruta nav:** `plantBoard` (sección TRABAJO, label **Estado de Planta**) — visible a **TODOS** los roles autenticados (vendedor y `user` incluidos) y a guest
- **Path:** `/planta` (fuera de `/produccion/…` para no chocar con el deep link de orden)
- **Patrón:** tabla matriz proyectos × sectores (`PlantBoardScreen`); solo lectura
- **Contenido:**
  - Filas: obras `accepted` | `produced` visibles para el rol (vendedor ve su portfolio vía ownership)
  - Columnas: los 6 sectores del pipeline (Corte · Encintado · Armado · Embalaje · Despacho · Instalación) + Avance %
  - Celda: `done/total` (verde al completar el sector) + "n en cola" (esperando ese sector); columna del cuello de botella resaltada (brand)
  - Nombre de obra: botón a la orden de fábrica si el rol puede entrar al hub; si no, a la cotización (vendedor)
  - Copy explícito "el avance se marca desde Producción" — nada se muta acá
- **Dominio:** `buildProjectFloorSummary` / `PIPELINE_SECTORS` / `PRODUCTION_SECTOR_LABELS_ES` (`@muebles/domain`, `productionSectors.ts`) — UI no calcula
- **Bitácora (F092):** cada transición de piso (web/escaneo/despacho) escribe un `FloorStatusEvent` inmutable (quién/cuándo/cómo, saltos anotados); `GET /api/projects/:id/floor-events`
- **Icono:** `KanbanSquare`

### 6.7c Embarques (carga al transporte)

- **Ruta nav:** `embarques` (sección PRODUCCIÓN) · **Path:** `/embarques`
- **Path código:** `packages/ui/src/production/EmbarquesScreen.tsx` (CSS compartido `.ship-board__*` con Instalaciones)
- **Patrón:** board por obra — cards de obra con la sección "Para cargar" (ítems `packaged` → "Marcar Cargado" → `loaded`)
- **Contenido:** stats en header ("N para cargar"); por obra: nombre + cliente + ítems con qty y estado + botón "Ver control de carga" (linkea al tab despacho del hub Órdenes mientras M2 migra el checklist)
- **Lo cargado pasa a Instalaciones** (subtítulo lo explica); avance por `handleFloorAdvance` compartido (server aplica scoping + evento F094)
- **RBAC nav:** `roleCanAccessShippingNav` (admin, gerente_produccion, produccion — sin almacén)
- **Icono:** `Truck`

### 6.7d Instalaciones (instalación en obra)

- **Ruta nav:** `instalaciones` (sección PRODUCCIÓN) · **Path:** `/instalaciones`
- **Path código:** `packages/ui/src/production/InstalacionesScreen.tsx` (mismo `.ship-board__*`)
- **Patrón:** board por obra — sección "En camino" (ítems `loaded` → "Marcar Instalado") + chip "N instalados" por obra
- **Pendiente aprobado (JD 2026-08-18, Fase 5.5):** mostrar **dirección + contacto del cliente** en la card (dato ya existe en `Customer`; hoy solo llega el nombre) — JTBD del instalador
- **RBAC nav:** mismo que Embarques
- **Icono:** `Hammer`

### 6.8 Estructuras

- **Ruta nav:** `structures` (sección INGENIERÍA)
- **Path:** `packages/ui/src/structures/StructuresScreen.tsx` (F049)
- **Patrón actual:** card-detalle + `EntityEditorLayout` (lista → detalle → editor full-page). Shell de detalle: `EngineeringDetailLayout` (`.eng-detail`).
- **Contenido:** cuerpos reutilizables compuestos de piezas. Cada card muestra código, nombre, dimensiones, revisión (`structure-revision-badge`).
- **Detalle (wave 2 UI):** chrome sticky con métrica Exterior (A×H×P) + Vista 3D + Editar; body 2-col — primario (dims + instancias de componentes), secundario (presets de medida + historial de revisiones en disclosure).
- **Editor:** full-page workspace con tabs sticky **General → Componentes → Presets** (sin tab Vista 3D suelto: 3D live sticky en Componentes). Badge si body vacío; save salta a Componentes. Presets con labels + validación blur. `structureRevisionPin` congela revisión en cotizaciones cerradas.
- **RBAC**: `roleCanMutateModules` (admin, ingeniero).
- **Icono:** `LayoutGrid`

### 6.9 Componentes

- **Ruta nav:** `components` (sección INGENIERÍA)
- **Path:** `packages/ui/src/components/ComponentsScreen.tsx`
- **Patrón actual:** card-detalle + `EntityEditorLayout` (lista → detalle → editor full-page). Shell de detalle: `EngineeringDetailLayout` (`.eng-detail`).
- **Contenido:** piezas reutilizables para componer estructuras. Cada card muestra código, nombre, dimensiones, placement.
- **Detalle (wave 1 UI):** chrome sticky con métrica de placa (L×A×E) + Editar; body 2-col — primario (geometría + `PlankEdgeDiagram` solo lectura), secundario (pose en disclosure, roles, perforaciones).
- **Editor:** full-page workspace con tabs sticky: General, Geometría (form | 3D sticky en desktop; guía de fórmulas colapsada), Cantos (`PlankEdgeDiagram`), Opciones (chips + badge si falta rol). Save exige ≥1 rol y salta a Opciones si falta.
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
- **Panel de marca (v2.1, desktop ≥900px):** split con panel indigo (`--brand-800`, borde `--brand-400` 30%) a la izquierda — `BrandMark` 64px + wordmark + tagline «Cotización y producción para talleres de carpintería» + meta de módulos — y la card de form a la derecha. Es el único momento "committed" del producto. En <900px el panel se oculta (card centrada). RegisterScreen comparte la hoja sin el aside.
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

## 7. Contenido, datos y copy

El copy es UI. Estas reglas existen porque el critique 30/40 encontró datos
crudos en pantalla (teléfono `195130.707627` como customerLabel, «schema v3» en
el topbar): la UI habla **humano de taller**, nunca interno de sistema.

### 7.1 Tono

- Español de taller, directo y sobrio. Sin marketing («¡Excelente!»), sin tecnicismos de sistema («schema», «id», «registro persistido»).
- **Sentence case en TODO** (botones, títulos, labels, toasts). ALL CAPS queda confinado a los labels de sección del sidebar existentes — en ningún texto nuevo.
- Botones = **verbo + objeto**: «Nueva cotización», «Guardar cambios», «Marcar cargado». «OK»/«Aceptar» solos están prohibidos; el primary de la vista empieza con el verbo.

### 7.2 Formato de datos (higiene de UI)

| Dato | Formato | Ejemplo |
|------|---------|---------|
| Dinero | `formatMoneyDisplay` (es-MX, MXN default) | `$1,250.50 MXN` |
| Números en tablas | `tabular-nums`, **alineados a la derecha** | `1,250.50` |
| Fecha | Humana `d MMM yyyy` es-MX, nunca timestamp crudo | `18 ago 2026` |
| Teléfono | Formateado con espacios, nunca el crudo de DB | `81 2345 6789` |
| Códigos | Mono, uppercase, prefijo del dominio | `MAT-001`, `MOD-GAB-01` |
| Dimensiones | `ancho × alto × prof` con `×` (U+00D7), unidad una vez al final | `600 × 800 × 450 mm` |
| Valor ausente | `—` (em dash), nunca vacío ni `null`/`undefined`/`N/A` | `—` |

**Reglas:**
- La UI **nunca** muestra internos del sistema: versiones de schema, ids de DB, timestamps crudos, keys, nombres de tablas. Eso es diagnóstico de dev y vive en logs.
- Nombres largos: ellipsis + `title` con el valor completo. Los CÓDIGOS nunca se truncan — son identidad.
- Números siempre con unidad en contexto de taller (`mm`, `m²`, `ML`, `pzs`): pegada al número o declarada en el header de columna, no repetida en cada celda.
- En cards de lista, el **nombre del ítem manda** la primera línea visual; el código mono lo acompaña en muted (nunca al revés).

### 7.3 Copy de estados

| Caso | Fórmula | Ejemplo |
|------|---------|---------|
| **Error** | Qué pasó (1 línea) + cómo resolverlo + acción si existe | «No se pudo guardar: el código MAT-001 ya existe. Cambiá el código o editá el material existente.» |
| **Confirmación destructiva** | Consecuencia + qué NO se pierde + botón con verbo específico | «Eliminar "MOD-GAB-01". Las cotizaciones que lo usan conservan su copia. Esta acción no se puede deshacer.» → [Eliminar] |
| **Toast de éxito** | Sujeto + verbo | «"Arauco 15mm" desactivado» |
| **Cargando** | Qué se está cargando | «Cargando órdenes…» (no «Cargando…») |
| **Vacío** | Estado + causa + siguiente paso | Cubierto por `EmptyState` (§4.5) |

**Prohibido:** «Algo salió mal», «Error inesperado», códigos de error visibles al
usuario, humor en errores, disculpas largas («Lo sentimos mucho, pero…»).

---

## 8. Definición de Done de UI (gate de calidad)

Una pantalla o feature de UI **no está done** hasta que pasa este gate completo.
Es el checklist del implementador ANTES de pedir review, y del reviewer para
aprobar (ver `reviewer` skill, bloque Diseño UI/UX).

- [ ] **Estados de pantalla**: loading (skeleton), empty, sin resultados, error — los 4 presentes o justificación escrita en el PR
- [ ] **Estados de control**: hover, focus-visible, active, disabled en TODO control interactivo nuevo (§3.6.1)
- [ ] **Una acción primaria por nivel de contexto**: en listas/boards, UNA primaria por card (la acción de esa card) y ninguna primaria suelta compitiendo; en workspaces con chrome + tabs, la primaria vive en UN solo nivel — chrome **o** tab activa, nunca en ambos a la vez (p. ej. «Pack» primario en chrome ⇒ en Documentos es secundario)
- [ ] **Solo tokens**: 0 hex, 0 px sueltos, 0 `font-size` literales; detector impeccable (`detect.mjs`) en 0 hallazgos
- [ ] **A11y**: contraste AA, teclado completo (§4.8), icon-only con `aria-label`, significado nunca solo por color
- [ ] **Copy**: taller + sentence case + datos formateados (§7.2) + errores que enseñan (§7.3)
- [ ] **Esqueleto único** (§4.1a): `PageHeader`, título = label de nav único, `PageToolbar` bajo el header cuando hay controles; acciones respetan una primaria + overflow accesible
- [ ] **Responsive smoke**: 390px / 768px / 1280px sin overflow ni contenido cortado (breakpoints §4.0)
- [ ] **Motion**: duraciones/easings del sistema + `prefers-reduced-motion` (§3.6)
- [ ] **Screenshot review**: captura de la pantalla comparada contra la spec §6 — «se ve bien en mi cabeza» no cuenta

Si un ítem falla, no es done. Si un ítem no aplica, el commit/PR lo dice explícitamente.

---

## 9. Reglas de Implementación

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
13. **Gate de calidad UI** — toda pantalla nueva o modificada pasa el §8 DoD antes de pedir review; el copy y el formato de datos cumplen §7

---

## 10. Referencias

- **Ejecución (estándar Apple):** [Apple Human Interface Guidelines](https://developer.apple.com/design/human-interface-guidelines/) — claridad, deferencia, profundidad
- **Sistema (estándar Google):** [Material 3](https://m3.material.io) — roles de color, state layers, componentes con estados completos
- Inspiración de layout: [Linear](https://linear.app), [Notion](https://notion.so)
- Inspiración de design system: [Radix Themes](https://www.radix-ui.com/themes), [shadcn/ui](https://ui.shadcn.com)
- Iconos: [Lucide](https://lucide.dev)
- Tipografía: [Inter](https://rsms.me/inter/)
- Teoría de color: [Refactoring UI](https://www.refactoringui.com/)

---

*Este documento es fuente de verdad para el diseño. Ante cualquier duda sobre color, espaciado, patrón o componente, este documento es el árbitro. Si la respuesta no está aquí, agregarla aquí antes de implementar.*
