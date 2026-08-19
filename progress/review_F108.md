# Review — feature F108

**Veredicto:** APPROVED

Fecha: 2026-08-19

## Alcance revisado

- `packages/ui/src/design-system/tokens.css` — `--text-muted`
  hsl(230 10% 52%) → hsl(230 12% 46%) y `--warning-700` hsl(38 80% 38%) →
  hsl(38 80% 32%). Sin cambios en surfaces, brand ni resto de semánticos.
- `packages/ui/src/auth/login.css` — placeholder 40% → 60% blanco.
- `packages/ui/src/design-system/textContrast.test.ts` (nuevo) — 25 tests:
  3 roles de texto × 6 surfaces, 5 pares de badge semántico, warning-700 sobre
  superficies planas, y guard de alpha del placeholder de login.
- `docs/design.md` — §3.2 valores actualizados; §4.8 tabla de valores medidos
  que referencia el test de regresión.

## Checkpoints

- C1: [x] init.sh verde (2026-08-19, todos los workspaces).
- C2: [x] Solo F108 en `in_progress` al revisar; `current.md` al día.
- C3: [x] Sin cambios de boundaries (tokens CSS + test node + docs).
- C4: [x] Ratios recalculados independientemente (script sRGB externo):
  muted 5.18/4.83/5.18/4.61/4.95/4.59 sobre white/app/card/hover/input/
  selected; warning-700 4.92 sobre warning-50 y 5.21 sobre blanco; login
  placeholder 5.77 sobre card brand-800 (peor caso). Coinciden con §4.8.
- C5: [x] Al cierre: F108 `done`, entrada en history, commit atómico sin el
  WIP ajeno `processStage.*`, `git push`.

## Diseño UI/UX

- D1: [x] Solo tokens; el placeholder usa `color-mix` con token existente.
- D8: [x] A11y §4.8: los badges usan `--text-xs` (12px semibold) — NO
  califican como large text, por eso se exige 4.5:1 (documentado en el test).
  Verificado que ningún uso de `--text-muted` vive sobre superficie oscura
  (appShell/commandPalette lo usan sobre surface-card).

## Notas

- `--warning-800` referenciado en `productionManagerDashboard.css` no existe
  en tokens (pre-existente, fuera de scope de F108; cae en fallback
  inherit). Se deja para F111/deuda de vocabularios.
