# Sesión actual

- **Carpeta canónica:** `/Users/tiagofur/dev/carpinteria/muebles`
- **Branch:** `chore/ui-token-migration-v3` (basada en `feat/structures-versioning-108`)
- **No usar:** `muebles-orig` para features nuevas

## Hecho en esta pasada (2026-07-18) — F054 Rediseño tabla de Catálogos

Rediseño VISIBLE del patrón de tabla que se replica en Materiales / Cantos /
Herrajes (5 pantallas comparten `CatalogTable` + `catalogs.css`).

- **F054 (`ui_catalogs_table_redesign`) — done:**
  - Título de catálogo: 18px → 22px (`--text-xl`) + `letter-spacing: -0.01em`
    → jerarquía de pantalla coherente con Home.
  - **Acciones SIEMPRE visibles**: opacidad 0 → 0.55 en reposo (1 en
    hover/focus/expanded). Era la queja #1 del análisis visual: «acciones
    invisibles hasta hover». Ahora se ven siempre, con prominencia reducida.
  - Ritmo de filas: `min-height` 32px → 40px (escaneo cómodo). Padding-x 8px →
    12px. Respeta contrato `--density-table-pad-y` (issue #49, designSystem.test).
  - Header de tabla: `--surface-hover` → `--surface-input`, + `text-transform:
    uppercase` + `letter-spacing: 0.04em` + `font-size: --text-xs` → jerarquía
    clara (Linear/Stripe pattern).
  - Hover de fila: `--surface-hover` → `--surface-input` (consistente con Home).
  - Status badge: `inline-block` → `inline-flex` + `gap` → dot alineado con texto.
  - Barra search+filters: dos controles sueltos → **toolbar cohesiva** con
    borde `--border-subtle`, fondo `--surface-card`, search con `flex-grow`.
  - Detail row expandido: padding 12px → 16px, fondo `--surface-app` →
    `--surface-input` (diferenciado sin chocar).
- **Verificación:** 297 tests @muebles/ui verdes (incl. designSystem.test
  contrato densidad #49) · typecheck 6 packages verde · check-tokens.mjs cero
  deuda · Playwright ANTES/DESPUÉS en `tests/visual/_before-after/F054-catalogs/`.
- **Cumple bans impeccable** + patrón reutilizable (Materiales/Cantos/Herrajes
  heredan todos los cambios vía catalogs.css compartido).

## Hecho en esta pasada (2026-07-18) — F053 Rediseño visible del Home

Respuesta directa al feedback «no veo cambios ni mejoras en la UI/UX». F052 fue
cimientos invisibles; F053 es el **rediseño visible** del Home/Dashboard.

- **F053 (`ui_home_redesign_visible`) — done:**
  - H1 «Inicio»: 22px → 28px (`--text-2xl`) + `letter-spacing: -0.01em` → jerarquía
    clara sobre títulos de sección y números hero. Icon decorativo oculto (ruido).
  - Stat cards rediseñadas: icon ahora flota top-right como acento quieto (antes
    lideraba el valor). Label arriba + número hero abajo + `margin: auto 0 0`.
  - **Énfasis por jerarquía interna, NO por borde morado ad-hoc**: la card de
    «Total cotizado del mes» ahora comparte elevation/borde con las demás; se
    distingue solo por icon chip brand + valor brand. Consistencia visual.
  - Hover uniforme en stat cards + recent cards: `border-brand` + `shadow-md` +
    `translateY(-1px)` (mismo patrón que `structure-card`).
  - Tabla «Por responsable»: padding 8/12px → 12/16px, `border-subtle`, headers
    con tracking 0.04em, hover de fila `--surface-input`, números tabulares con
    color `--text-primary`.
  - Cadencia vertical: `gap: --space-6` → `--space-8` entre secciones.
- **Verificación:** 297 tests @muebles/ui verdes · typecheck 6 packages verde ·
  `check-tokens.mjs` cero deuda · Playwright screenshot ANTES/DESPUÉS capturado
  en `tests/visual/_before-after/F053-home/`.
- **Cumple bans impeccable:** sin side-stripe, sin gradient text, sin
  glassmorphism, sin hero-metric template, sin eyebrow tracked en cada sección.
- **Intensidad:** pulido profundo (no estructural). No se tocó TSX, solo CSS.

## Hecho en esta pasada (2026-07-17) — F052 UI Judgment Day

- SUPER JUDGMENT DAY de UI/UX completo → `docs/judgment-day-ui-2026-07-17.md`
- Issue maestro [#145](https://github.com/tiagofur/muebleria/issues/145) creado
  con 5 fases como checklist
- **F052 ejecutada (Fases 1+2+2b+3):**
  - Fase 1: ~50 tokens indefinidos → canónicos (cero restantes; verificado con
    `scripts/check-tokens.mjs`)
  - Fase 2: 47 valores rem ad-hoc → escala `--space-*` estricta
  - Fase 2b: `!important` en projects.css resuelto vía especificidad
  - Fase 3: `scripts/check-tokens.mjs` + integración warning en `init.sh` §5
- **Infraestructura nueva:** Playwright visual regression (config + 6 tests +
  baselines en `tests/visual/`). Script `pnpm visual`.
- **Verificación:** `init.sh` verde · typecheck 6 packages verde · build verde ·
  screenshots 6/6 estables
- DEFERRIDO: namespace 3D (`part3DViewer.css`, `moduleScene3d.css`) — issue
  separado. Fases 3-5 del plan original (expand-row, z-index, polish) en #145.

## Docs

| Doc | Rol |
|-----|-----|
| `docs/judgment-day-ui-2026-07-17.md` | Reporte + resultados F052 |
| `docs/app-excellence.md` | Plan + issues excelencia |
| `docs/judgment-day-wip-3d-2026-07-17.md` | JD findings 3D |
| `docs/prd.md` §6.7 | Política corte / CNC / layout |
| `docs/design.md` | Design system (fuente de verdad) |

## Siguiente

1. Commit/PR de F052 (cuando pedís) — basado en #108, mergear después de #108
2. Fases 3-5 del JD (#145): expand-row → detalle, z-index semántico, polish
3. Tokenización del namespace 3D deferido


- Judgment Day Round 1 → ESCALATED; issues #125–#142
- Plan App Excellence documentado
- **Fixes JD Round 1 (confirmed):**
  - #127 App.tsx → ProjectsScreen structures/components
  - #125 apiMappers spatial round-trip component + instance
  - #126 Go formulas PH/PW/PD/T/i
  - #128 per-axis pose fallback + lateral_derecho + laterals rotX/Y
  - #129 multi-módulo WebGL msg, ghosts, DEFAULT_MODULE_FOOTPRINT_MM
  - #130 preview color validate/normalize; no pisar color al upload
- Tests: domain, storage, ui preview/materials, go engine — verdes

## Docs

| Doc | Rol |
|-----|-----|
| `docs/app-excellence.md` | Plan + issues |
| `docs/judgment-day-wip-3d-2026-07-17.md` | JD findings |
| `docs/prd.md` §6.7 | Política corte / CNC / layout |

## Siguiente

1. Commit/PR de fixes JD + docs (cuando pedís)
2. Residual opcional: migration `structure_components.overrides` + rotate NULL en components
3. Ola B: #133 layout cocina
