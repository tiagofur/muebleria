# Review — feature F145 (proyectar_environment_multispace, #311 P3D-4)

**Veredicto:** APPROVED

**Diff:** `feat/f145-environment-multispace` (base `origin/main` @ 7138aa3).
Dominio `kitchenEnvironmentCommands.ts` (+27 tests), `kitchenLayout.ts`,
`types.ts`, `index.ts`; storage `apiMappers.ts` (+1 test); UI
`FurnitureScene3D.tsx`, `AmbientMeshes.tsx`, `ProjectSpatialStudio.tsx` (+9
tests), `projectSpatialStudio.css`; smoke Playwright (+1).

## Checkpoints

- C1: [x] — harness completo; `./init.sh` no re-ejecutado en esta sesión, pero
  install/typecheck/test corrieron directos (deuda OC-001 documentada en
  `docs/verification.md`).
- C2: [x] — una feature (F145) con tests asociados pasando; `current.md`
  describe esta sesión.
- C3: [x] — `kitchenEnvironmentCommands.ts` sin react/fs/xlsx ni `any`; errores
  como resultado discriminated (`EnvironmentCommandResult`) con mensajes que
  enseñan, consistente con `kitchenLayoutCommands`; UI no calcula dominio
  (splitWallSegments/occlusión viven en domain); sin `console.log`.
- C4: [x] — `pnpm test` 2.952 exit 0 (domain 1.022 · storage 154 · excel 89 ·
  ui 1.324 · mobile 45 · desktop 17 · web 301); no toca export/motor de costos;
  storage verificado con round-trip mapper test (la persistencia física del
  layout es blob JSON ya cubierta por suites existentes).
- C5: [x] — sin archivos sospechosos sin trackear; `history.md` con entrada
  F145; ledger F145 `done` (+ F142 restaurada); `current.md` en plantilla de
  cierre de sesión.

## Diseño UI/UX

- D1: [x] — CSS sólo tokens (`--space-*`, `--text-xs`, `--border-subtle`,
  `--surface-card`, `--radius-sm`); colores de escena (vidrio `#bcd7e8`,
  fantasma 0.12) siguen la convención de constantes de `AmbientMeshes`
  (material de escena, no chrome UI).
- D2: [x] — inspector Ambiente mantiene zona estable + progressive disclosure
  (`<details>` origen avanzado); patrón preset-grid reutilizado para ángulos y
  alta de huecos.
- D3: [x] — sin modales nuevos (nada que trappear).
- D4: [x] — sin toasts nuevos; mensajes que enseñan vía `role="status"` con
  `data-testid` (consistente con `import-msg`).
- D5: [x] — iconos Lucide existentes (`Plus`, `Trash2`) con `strokeWidth={1.5}`.
- D6: [x] — sin animaciones nuevas.
- D7: [x] — gate `docs/design.md §8`: estados hover/focus heredados de `.btn` /
  `.spatial-studio__preset`; `aria-pressed` en toggles; `aria-expanded` en
  tarjeta de muro; labels visibles por campo; una acción primaria por contexto
  (Crear L sigue siendo la primaria del ambiente vacío).
- D8: [x] — copy en español con lenguaje de taller («Huecos del muro»,
  «Antepecho», mensajes que enseñan cómo resolver); sin internals
  (instanceKey/offset crudo) en copy; unidades mm visibles.

## Reglas duras

- Tests verdes (ver C4); smoke WebGL real 4/4 con screenshot revisado
  (`test-results/proyectar-multispace.png`).
- `git status` limpio de archivos ajenos; diff de una sola feature (+ backfill
  de ledger F142 en commit separado `chore`).
- Push: requerido antes del cierre — verificado en el flujo de cierre.

## Hallazgos durante la review (aplicados por el implementador)

1. **Performance (§17/§18):** `WallOcclusionTracker` actualizaba estado por
   cambio de posición de cámara (re-render por frame durante órbita con el modo
   activo). Corregido: guard por CONTENIDO del conjunto oculto — la órbita sólo
   re-renderiza cuando un muro entra/sale del conjunto.
2. **Undo por intención (§12, bar F144):** los inputs de muro/hueco commiteaban
   por tecla. Corregido: `CommitOnBlurInput` commitea en blur/Enter (una
   intención por edición; Escape restaura el draft).
3. **Tokens (design.md §3):** `var(--radius-sm, 6px)` inventaba un fallback
   distinto del token. Corregido a `var(--radius-sm)`.

## Notas

- `WallOpening` es presentation-only: `ambientLeakGuard` y BOM siguen sin ver
  huecos (verificado por diseño del tipo + suites existentes).
- Backfill F142: entrada restaurada byte-idéntica desde git (1076997); el
  incidente (F143 pisó el ledger desde copia stale) quedó registrado en
  `progress/history.md` y en el commit `chore`.
