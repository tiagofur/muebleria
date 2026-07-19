# Judgment Day UI/UX — 2026-07-17

> **SUPER JUDGMENT DAY** sobre toda la app de taller (`packages/ui/src` + `apps/web/src`).
> Register: **product** (clase Linear/Stripe — preciso, calmo, operacional).
> Detector impeccable: ✅ clean en tells grandes (sin gradient-text, glassmorphism,
> hero-metrics). La enfermedad **no** es AI-slop; es **inconsistencia de ejecución**.

---

## TL;DR — la causa raíz

La app no es "fea por diseño"; es **una herramienta interna a medio migrar**.
`docs/design.md` define un design system profesional y los tokens (`tokens.css`)
son correctos. Pero la **migración desde el sistema legacy está incompleta**, y por
eso se percibe "desorganizada, fea, desalineada" sin un solo bug visible:

- **20 referencias a tokens legacy con fallbacks hardcoded** (`var(--color-border, …)`,
  `#0f1115`, `#1a1c1e`) → bordes/grises ligeramente "off" en toda la app.
- **40 valores rem ad-hoc + 235 px sueltos** fuera de la escala `--space-*` →
  deltas de 1–2px que el ojo percibe como "desalineado".
- **101 estilos inline** que esquivaron la migración.
- **11 valores `z-index` mágicos** (incluye `z-index: 1000`) sin escala semántica.
- **Expand-row** en catálogos que empuja filas (viola spatial stability; design.md
  §4.2 ya definió "click → ver detalle" pero la implementación se desvió).

Cada componente aislado se ve "bien"; la suma del caos subliminal es lo que duele.

---

## Audit Health Score: 11/20 (Acceptable → Poor)

| # | Dimensión | Score | Hallazgo clave |
|---|-----------|------:|----------------|
| 1 | Accesibilidad | 2/4 | `opacity: 0.55` en inactivos transmite estado solo por opacidad; contraste de muted al límite |
| 2 | Performance | 3/4 | `ProjectsScreen.tsx` = 2282 líneas, `App.tsx` = 82 KB |
| 3 | Responsive | 3/4 | Breakpoints canonizados (640/900/1100) — bien |
| 4 | **Theming** | **1/4** | ⚠️ Migración de tokens incompleta (causa raíz #1) |
| 5 | Anti-patterns | 2/4 | `z-index: 1000`, `border-left: 3px`, 10× `!important`, expand-row |
| | **Total** | **11/20** | La dimensión 4 arrastra todo |

## Nielsen Heuristics: 26/40 (Acceptable)

| # | Heurística | Score | Problema |
|---|-----------|------:|----------|
| 1 | Visibility of system status | 3 | Toasts + skeletons OK |
| 2 | Match system / real world | 3 | Vocabulario taller OK |
| 3 | User control | 3 | Cancel/undo en modales; falta undo global |
| 4 | **Consistency** | **1** | ⚠️ Dos vocabularios de tokens; spacing ad-hoc; inline idiomático |
| 5 | Error prevention | 3 | Confirmaciones inline |
| 6 | Recognition / recall | 3 | Sidebar iconos+labels, Cmd+K |
| 7 | Flexibility | 3 | Cmd+K, atajos |
| 8 | **Aesthetic/minimalist** | **2** | ⚠️ Cards anidados; todo con `--shadow-sm` = nada destaca |
| 9 | Error recovery | 3 | Inline + toast |
| 10 | Help/docs | 2 | Sin ayuda contextual |
| | **Total** | **26/40** | La consistencia la define |

---

## Hallazgos priorizados

### [P0] Migración de tokens a medias → grises/bordes "off"
- **Dónde:** `projects.css:535,671,672,794`, `catalogs.css:853,868`, `dashboard.css`,
  `moduleShowcase.css` — 20 ocurrencias en 5 archivos.
- `var(--color-border, hsl(220 13% 85%))` ≠ `--border-default` (`hsl(220 14% 86%)`).
- **Fix:** reemplazar los 20 usos por tokens canónicos. 1 tarde, efecto dramático.
- **Comando:** `$impeccable document`.

### [P0] Escala de espaciado destruida — 40 rem ad-hoc + 235 px sueltos
- **Dónde:** `projects.css`, `modules.css` — `0.85rem`, `0.65rem`, `0.35rem`,
  `0.375rem`, `0.45rem`, `0.55rem` en vez de `--space-*`.
- **Fix:** linter CSS que rechace rem/px fuera de `--space-*`. Reemplazar los 40 ad-hoc.
- **Comando:** `$impeccable layout`.

### [P1] Expand-row de catálogo que "mueve las cosas de línea"
- **Dónde:** `CatalogTable.tsx:120` — `catalog-table__detail-row` empuja filas.
- **Fix:** click en fila → vista detalle read-only (lo que design.md §4.2 ya define).
- **Comando:** `$impeccable shape` → `$impeccable distill`.

### [P1] `z-index` sin escala semántica — `z-index: 1000` mágico
- **Dónde:** `users.css:23` (1000), más 10 valores arbitrarios.
- Un dropdown de Users (1000) se dibuja sobre toasts (200) y modales (100).
- **Fix:** `--z-dropdown/sticky/modal-backdrop/modal/toast/tooltip` semánticos.
- **Comando:** `$impeccable harden`.

### [P1] Cards anidados + todo con `--shadow-sm`
- **Dónde:** `project-item-card` dentro de `project-detail__section` dentro de
  `app-content` — 3 niveles. "Nested cards are always wrong."
- **Fix:** `--shadow-sm` solo para cards flotantes; detalle = solo borde; nested = tinte.
- **Comando:** `$impeccable distill`.

### [P2] 101 estilos inline
- **Dónde:** `KitchenPlanPanel.tsx` (15), `ProjectsScreen.tsx` (14),
  `StructureEditorPresetsPanel.tsx` (12 — `style={{ margin: 0 }}` repetido).
- **Fix:** extraer a clases co-localizadas.
- **Comando:** `$impeccable extract`.

### [P2] `!important` × 10
- **Dónde:** `projects.css:509-513` (`.project-totals__sale`).
- **Fix:** resolver especificidad con BEM, no forzando.
- **Comando:** `$impeccable polish`.

### [P3] `border-left: 3px` en sidebar activo (`appShell.css:87`)
- Side-stripe que la skill banea. En nav-sidebar es convención, pero ya existe el
  bg tint de `brand-400 18%` → el stripe es redundante. Quitarlo = más limpio.

---

## Persona red flags

- **Alex (power user):** filas que se expanden al click rompen el escaneo; quiere
  click→detalle fijo. `ProjectsScreen` de 2282 líneas le da miedo de lentitud.
- **Sam (a11y):** `opacity: 0.55` esconde info solo por opacidad; `--text-muted`
  sobre `--surface-hover` tintado al límite de 4.5:1.
- **Jordan (primerizo):** catálogos sin vista "ver" real — click directo a
  expand/editar da miedo romper algo.

---

## Lo que SÍ funciona (mantener)

1. **Arquitectura de tokens** (`tokens.css`) — profesional y completa.
2. **Patrón lista→detalle→modal** en Projects/Modules con `workspace-chrome` sticky.
3. **Breakpoints responsivos** canonizados (640/900/1100) — responsive real.
4. **Lucide coherente + command palette Cmd+K.**

La base es buena. No hay que tirar nada: hay que **terminar la migración y
ejecutar consistencia**.

---

## Plan de acción → Excelencia (clase Apple/Linear)

1. **`$impeccable document`** — capturar tokens reales en uso; sincronizar con design.md.
2. **`$impeccable layout`** — erradicar 40 rem ad-hoc + 235 px → escala `--space-*`
   estricta. Cambia ~50% de la percepción de "desalineado".
3. **`$impeccable distill`** — eliminar expand-row → vista detalle; quitar cards
   anidadas; jerarquía de elevación (lista sombreada / detalle solo-borde / nested tinte).
4. **`$impeccable harden`** — escala `--z-*` semántica; eliminar `z-index: 1000`,
   `!important`; contrastes al límite.
5. **`$impeccable polish`** — estados hover/focus/active/disabled consistentes;
   micro-alineaciones; `prefers-reduced-motion`.

**Orden recomendado:** el #2 (layout) entrega el cambio visible más grande con
menor riesgo. #1 habilita el resto. #3 toca UX de interacción (más delicado,
pedir confirmación antes).
