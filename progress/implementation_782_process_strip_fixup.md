# Implementation — #782 fixup PR #783 (ProcessStrip)

- **Issue:** #782 (`status:approved`) · **PR:** #783 `feat/engineering-process-strip-compact`
- **Base de partida:** `f0771ccf681f5209b92bbaded3e00dc1fb730acf` (HEAD del PR, CI rojo)
- **Base:** `main` @ `9a37941f` · **Fecha:** 2026-09-18
- **Origen:** revisión independiente → `muebles-worktrees/reviews/review_782_pr783_f0771ccf.md` (CHANGES_REQUESTED, 3 bloqueos)

## Alcance del fixup (aceptación #782 intacta, sin ampliación)

1. **B1/B2 — invariante #739 restaurado en el aviso compacto.**
   `EngineeringWorkspace.tsx`: `eng-release-prep-notice` vuelve a declarar que
   ajustar el corte no modifica lo acordado («Ajustar el corte no modifica la
   cotización ni la liberación.») manteniendo el formato de una línea. El spec
   browser `engineering-cutting-demand.spec.ts:340` vuelve a pasar sin editarlo.
   El test unitario `EngineeringWorkspace.cuttingDemand.test.tsx` afirma ambas
   cláusulas (contenido congelado + no modifica la cotización).
2. **B3 — detalle duplicado en paso `unconfirmed`.**
   `ProcessStrip.tsx`: el `detail` no se renderiza cuando repite el texto de
   estado (`inlineStateText`); elimina «Pendiente de confirmar ×2» cuando el
   estado durable falla/absente. Regresión cubierta en
   `EngineeringWorkspace.releaseContext.test.tsx` (`getAllByText(...)` length 1).
3. **Limpieza propia del PR (sin refactor vecino):** CSS muerto
   `.eng-workspace__release-context`, ruleset vacío `.ps__step` en media query,
   comentario stale y aserción `Q1` redundante en `engineering-entry.spec.ts`.

## Pruebas (por impacto)

- `pnpm --filter @granete/ui exec tsc --noEmit` → PASS.
- `pnpm --filter @granete/ui exec vitest run src/engineering src/common` →
  26 archivos / **176 tests PASS** (incluye las dos aserciones restauradas y la
  regresión del dedup).
- Browser gate real (Go + PostgreSQL 16 docker + Chromium):
  `./scripts/organization-browser-gate.sh` sobre los 5 specs de engineering
  afectados (cutting-demand, entry, fabrication-flow-visibility, state,
  physical-gate) → resultado en la sección de evidencia final / PR.
- Matriz completa de CI en el push (Foundation Gate A, browser proofs,
  PostgreSQL, Go, TypeScript, SketchUp×3, Proyectar, metadata).

## Fuera de alcance (sugerencias no bloqueantes de la revisión)

Capturas 390/768/1280 y medición del alto del strip (§8 screenshot review);
tooltip del badge; concordancia «calculados» preexistente en
`eng-live-view-notice`.
