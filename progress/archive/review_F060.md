# Review — feature F060 (phase0_split_engine)

**Veredicto:** APPROVED

## Resumen del cambio

`packages/domain/src/engine.ts` (2108 L) se partió en 6 sub-archivos bajo
`packages/domain/src/engine/` + barrel `index.ts`. `engine.ts` quedó como thin
re-export (10 L). Refactor mecánico puro, sin cambios de comportamiento.

```
packages/domain/src/engine/
  shared.ts    (128 L) — catalog finders, edge math, evaluatePartFormula
  validate.ts  (320 L) — VAL-01..VAL-07 + isProjectClosed
  bom.ts       (667 L) — resolveBom, resolveComposedModule, resolveStructure
  pricing.ts   (437 L) — line costs, breakdown, captureQuoteSnapshot, transitionProjectStatus
  cut.ts       (365 L) — generateCutRows, generatePieceLabels, formatEdgeBandingInstruction
  labels.ts    (311 L) — generateProjectMaterialSummary, generateHardwareList
  index.ts      (52 L) — barrel que re-exporta la superficie pública
```

## Verificación técnica

- `git status`: clean. `git log origin/wip/perfect-app-fase-0-engine..HEAD`: vacío
  (commit `80c0045` pushed, HEAD == origin). Sin trabajo no-pushed.
- `pnpm typecheck`: verde en los 6 workspace projects (domain, storage, excel,
  ui, web, desktop).
- `pnpm --filter @muebles/domain test`: **217/217 tests pasan** — incluyendo
  `engine.test.ts` con sus 90 tests (golden F003/F011 incluidos) y
  `index.test.ts`. Los tests no fueron tocados.
- `./init.sh`: verde ("Todos los tests pasan" + "Entorno listo"). Suite web
  suma otros 185 tests.
- `pnpm visual`: **6/6 sin re-baseline** (login, dashboard, materials, quotes,
  modules, project detail).

## Checkpoints

- C1 (harness completo): [x] — sin cambios.
- C2 (estado coherente): [x] — el implementador no tocó `progress/current.md`
  ni `feature_list.json` (correcto: es trabajo del líder al cerrar la sesión,
  no del implementador). F060 sigue `pending` en `feature_list.json`; esa
  transición a `done` se hace al cerrar.
- C3 (arquitectura): [x] — `packages/domain` sigue sin importar react/electron/
  fs/xlsx. Errores siguen siendo `ValidationError`/`ResolutionError`
  (`DomainError`). Sin `console.log`. Sin nuevas dependencias externas.
- C4 (verificación real): [x] — verificación ejecutada, no declarada.
- C5 (cierre limpio): [x] — sin archivos sospechosos sin trackear.

## Criterios de aceptación de F060

1. [x] `engine.ts` eliminado o < 200 L — quedó en **10 L** (solo barrel).
2. [x] Sub-archivos por responsabilidad — ver desviación documentada abajo.
3. [x] `packages/domain/src/index.ts` mantiene exports idénticos — sin
   breaking changes; `engine.test.ts` y los 217 tests pasan intactos.
4. [x] Tests existentes pasan sin modificarse (90 de engine + golden).
5. [x] `pnpm test` · `pnpm typecheck` · `./init.sh` todos verdes.

## Desviación del plan literal (no bloqueante)

El plan F060 mencionaba `bom/pricing/cut/hardware/validate/snapshot`. El
implementador optó por una partición ligeramente distinta:

- **`hardware.ts` no existe** como archivo separado: `generateHardwareList`
  (EXP-08) vive en `labels.ts` junto con `generateProjectMaterialSummary`
  (F047). Ambos son *planning summaries* y comparten el patrón
  `resolveBom → agregación por catálogo` — agrupación cohesiva y legítima.
- **`snapshot.ts` no existe** como archivo separado: `captureQuoteSnapshot` y
  `transitionProjectStatus` viven en `pricing.ts`. Tienen alta cohesión con el
  breakdown (llaman a `calcLiveProjectBreakdown` internamente), así que es
  razonable.
- **`shared.ts` no estaba en el plan**: se añadió para centralizar catalog
  finders + edge-band math + `evaluatePartFormula`, evitando ciclos entre
  `bom`/`pricing`/`cut`/`labels`.

El propio criterio de aceptación explicita flexibilidad ("o sub-carpetas"), y
la partición final cumple el espíritu del split: 6 sub-archivos por
responsabilidad, cada uno < 700 L, Grafo de dependencias acíclico y limpio.

## Dependencias acíclicas (verificadas)

```
shared   (hoja: solo ../errors, ../types)
validate (hoja: ../errors, ../types, ../measurePresets)
   │
   ├──> bom     (← shared, validate, ../spatialPlacement, ../structures/versioning)
   │       │
   │       ├──> pricing  (← bom, validate, shared, ../optionChoices, ../structures/versioning)
   │       ├──> cut      (← bom, shared, ../optionChoices)
   │       └──> labels   (← bom, pricing, shared, ../optionChoices)

index.ts  (barrel puro: re-exporta de los 6)
engine.ts (thin barrel → ./engine/index)
```

Sin ciclos. Sin imports `./` circulares.

## Comentarios JSDoc / decisiones de dominio

Preservados íntegramente en cada sub-archivo (reviso muestra):
- `bom.ts`: PRD §13.5 edge-band resolution, F053 structure→component, #108
  structureRevisionPin, H09 measure presets — todos intactos.
- `pricing.ts`: PRD §13.3 breakdown, PRD §7.4 status transition con nota de
  auditoría sobre por qué se mantienen pins al reabrir — intacta.
- `cut.ts`: F046/F048 (#96/#98), EXP-05 board-only, EXP-04 sort, VAL-05
  empty-cut-list — intactos.
- `labels.ts`: F047 (#97), EXP-08 hardware list — intactos.
- `validate.ts`: VAL-01..VAL-07 tags en JSDoc — intactos.

## Conclusión

Refactor mecánico limpio que cumple todos los criterios de aceptación. Sin
breaking changes, sin tests tocados, dependencias acíclicas, comentarios de
dominio preservados. Las desviaciones del plan literal son decisiones de
cohesión defendibles y no rompen el contrato público. Aprobado.
