# Review — feature F143

**Veredicto:** APPROVED

**Feature:** F143 — proyectar_multiselect_align (#310 P3D-1a, meta #308 etapa E3)
**Rama:** `feat/f143-multiselect-align` (desde `origin/main`; S2 sigue en PR #330 abierto — regla de stack de `docs/en-desarrollo.md` §0)
**SDD:** https://github.com/tiagofur/muebleria/issues/310#issuecomment-5382120603

## Checkpoints

- C1: [x] Harness base intacto; `pnpm test` exit 0 (2.872 tests) + `pnpm typecheck` exit 0.
- C2: [x] Una sola feature `in_progress` (F143); toda feature `done` con tests verdes en la corrida.
- C3: [x] `kitchenLayoutCommands`/`kitchenArrangementCommands` sólo importan de `./kitchenLayout` y `./types` (sin react/fs/xlsx); UI sin fórmulas de negocio — la geometría/validación vive en dominio, la UI sólo computa capacidades de botones a partir de placements; sin `console.log` sueltos (verificado con grep); sin `any` nuevo.
- C4: [x] `pnpm --filter @muebles/domain test` 972/972; no toca export ni storage; smoke WebGL real 2/2 (`pnpm smoke`) con screenshots revisados (`proyectar-multiselect.png`: barra + highlight ámbar de 2 unidades + inspector multi).
- C5: [ ] Se completa al cierre (tras APPROVED, orden del workflow de slices): history entry + feature_list `done` + current.md limpio + commit único + push. Verificado por el implementador antes de cerrar sesión.

## Diseño UI/UX

- D1: [x] Sólo tokens: barra usa `--surface-overlay-chrome/--border-subtle/--shadow-md/--radius-lg/--space-*`; sin hex nuevos (grep en 0). Los dos colores 3D (`#f5c542` guía, existente de selección) siguen el patrón preexistente de capas efímeras de la escena.
- D2: [x] Sin pantalla nueva: overlay contextual del studio (anti-scope §27 — la barra existe sólo con selección); inspector mantiene "misma zona, distinto contexto" (§8.4).
- D3: N/A (sin modales nuevos).
- D4: [x] Sin toasts nuevos; feedback de comandos por `role="status"` en la barra (errores que enseñan, §7.3).
- D5: [x] Sólo Lucide `strokeWidth 1.5`; 10 iconos nuevos documentados como filas en design.md §3.7.
- D6: N/A (sin animaciones nuevas; sin motion agregado que requiera reduced-motion).
- D7: [x] Gate §8: estados de control vía `.btn--small` (matriz del sistema); una primaria por contexto (la barra no tiene `.btn--primary`); a11y: `role="toolbar"` + `aria-label`, icon-only con `aria-label`, significado nunca sólo por color (chip textual "N seleccionados" + estados disabled con `title` que explica); copy español de taller, sentence case, errores que enseñan ("No queda lugar en Muro A… Liberá espacio o duplicá en otro muro"); screenshot review hecho.
- D8: [x] Responsive: barra con `flex-wrap` + `max-width min(92%, 980px)`; studio es herramienta desktop (patrón vigente).

## Verificación específica del slice (SDD)

- Comandos como intenciones puras: 43 tests de dominio nuevos (duplicate/paste/pasteRelative/compact/distribute/align/center + firstFreeOffsetOnWall + prune `extraInstanceKeys`), con rechazos que enseñan (multi-wall, too-few, colisión, overflow, muro lleno).
- Undo por intención: entrada de historial `{layout, itemQuantities}` — "duplicar → deshacer" restaura layout Y quantity (test jsdom explícito).
- Selección: 9 tests puros de `studioSelection` + 15 jsdom del studio (multi Ctrl/Shift-rango, click-vacío, auto-prune, Escape con precedencia, detalle pieza/herraje, atajos C/V/D/Del).
- Guías: 9 tests puros de `dragGuides`; render efímero en escena (no dominio).
- Smoke E2E real: multi-select por lista, barra "2 seleccionados", Duplicar → plano crece +2 y copias seleccionadas, Escape limpia sin cerrar.

## Hallazgos aplicados durante la review

1. **R1 (aplicado)** — `duplicateSelectionCommand` devolvía error cuando la posición trasladada chocaba sin desbordar el muro; ahora cae al primer hueco libre (mismo fallback que el overflow). Cubierto por test (copia a 1520 con par en 900–1500).
2. **R2 (aplicado)** — `kitchenLayoutCommands.ts` quedó en 1148 líneas (> soft budget ~500 de conventions §tamaño). Partido por capacidad: creación/clipboard (`kitchenLayoutCommands.ts`, 671 con JSDoc y tipos compartidos) vs organización (`kitchenArrangementCommands.ts`, 494). Un test por módulo (conventions).
3. **R3 (aplicado)** — El effect de teclado quedó tras el early return `if (!open)` (hooks condicionales, "Rendered more hooks"); reubicado antes del return.
4. **R4 (aplicado)** — Undo con `onUpdateItem` guardado por desigualdad de quantity fallaba si el store aún no re-renderizaba (Ctrl+D inmediato + Ctrl+Z): patches ahora idempotentes.

## Notas

- El smoke usa `Meta` para multi-select (macOS Chromium trata Ctrl+click como menú contextual); el studio acepta ambos (`ctrlOrMeta`).
- Deuda documentada en el SDD: drill-down a agregado (necesita identidad estable de instancia en `project3dPreview`), drag de grupo y nudge → F144.
