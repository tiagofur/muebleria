# Review — feature F107

**Veredicto:** APPROVED

Fecha: 2026-08-19

## Alcance revisado

- `packages/ui/src/design-system/tokens.css` — calibración canvas/chrome de las
  5 áreas (L 97→95 / 94→92, croma al alza). Container/selected/ink/states,
  surfaces neutrales, brand y semánticos intactos (verificado por aserciones
  literales en el test nuevo).
- `packages/ui/src/shell/appShell.test.ts` — 20 expectativas `closeTo`
  actualizadas a los ratios recalculados (fórmula sRGB idéntica a la del test);
  mínimo absoluto sigue 5.87:1 (sales/container) ≥ 4.5:1. Nuevo test
  "calibrates canvas/chrome tints to a perceivable-but-calm intensity".
- `docs/design.md` §3.2.1 — guía "Intensidad calibrada (F107)" con la escalera
  canvas 95 → chrome 92 → selected ~91 → container 89.
- `feature_list.json`, `progress/current.md` — estado y bitácora.

## Checkpoints

- C1: [x] init.sh verde (todos los workspaces, 2026-08-19).
- C2: [x] Solo F107 en `in_progress`; `current.md` describe la sesión activa.
- C3: [x] Sin cambios de boundaries: solo valores de tokens CSS + tests + docs.
- C4: [x] `pnpm typecheck` verde; `./init.sh` verde (tests completos). Los 20
  pares AA recalculados independientemente (script sRGB externo) coinciden con
  las expectativas del test.
- C5: [x] Al cierre: F107 `done`, entrada en `progress/history.md`, commit
  atómico solo con archivos F107 (el WIP ajeno `packages/domain/processStage.*`
  queda sin tocar) y `git push`.

## Diseño UI/UX

- D1: [x] Solo tokens CSS del design system; cero hex/px nuevos.
- D2: [x] No cambia layout ni patrones de pantalla.
- D3–D6: [x] No aplica (sin modales/toasts/iconos/animaciones nuevos).
- D7: [x] DoD §8: perceptibilidad demostrada por cálculo (dE76 canvas vs
  `--surface-app`: 2.6–7.9 antes 0.3–3.5) y codificada como test de regresión.
- D8: [x] AA verificado numéricamente para ink sobre canvas/chrome/container/
  selected en las 5 áreas; copy en español.

## Notas

- Icon-chip coverage (acceptance #3) confirmada por los tests de rollout
  F104–F106 + librería ya existentes, que exigen `.page-header__icon`.
- La inspección viva lado a lado queda cubierta analíticamente (CIELAB dE76);
  no se abrió browser en esta sesión.
