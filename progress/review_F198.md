# Review — feature F198

**Veredicto:** APPROVED

**Rama revisada:** `feat/483-typed-parameters`
**Head de implementación/evidencia:** `fec1c4e734774ccffc78d0c3aa7ff09b5728f66c`
**Base:** `d85d6fd21aa040c4d1f08c5c76c0ab099db7c83b`

## Checkpoints

- C1: [x] `./init.sh` terminó con exit code 0 contra PostgreSQL 16 aislado; TypeScript, Go, Pilot Readiness y Ruby/RBZ pasaron.
- C2: [x] F198 es la única feature `in_progress`; el cierre queda correctamente posterior a esta aprobación independiente.
- C3: [x] La evaluación publicada exige bindings autoritativos antes de componer y los tres entry points fallan con error tipado ante definiciones inválidas.
- C4: [x] El corpus compartido cubre shapes anidados corruptos y la matriz PostgreSQL Create/Update demuestra rechazo atómico sin persistencia parcial.
- C5: [x] El head de implementación local/remoto coincidió exactamente, el diff no tuvo whitespace errors y los seis checks CI del head terminaron `SUCCESS`.

## Revisión de las correcciones

1. **Validación publicada en todos los entry points: resuelto.**
   `evaluateFurnitureParameters` ejecuta `validatePublishedFurnitureParameterDefinitions`; `instantiateFurniture`, `evaluateInteractive` y `resolveFurnitureLayout` heredan el mismo límite fail-closed. La matriz negativa prueba definiciones sin binding y bindings anidados inválidos en los tres caminos, con `PARAMETER_DEFINITION_INVALID` y sin partes/componentes de layout. La reproducción independiente de `shelfCount` sin binding ahora devuelve `FurnitureParameterDefinitionsError` con issue estructurado en `binding`.

2. **Parser de bindings anidados sin `TypeError`: resuelto.**
   La validación de forma comprueba `binding`, `relationship` y cada target antes de la validación semántica. El corpus compartido incluye binding/relationship/targets/target entries y campos anidados con tipos inválidos. Las reproducciones con `componentId: 5` y `relationship.kind: 5` ahora devuelven `FurnitureParameterDefinitionsError` / `PARAMETER_DEFINITION_INVALID`; ninguna escapa como `TypeError`.

3. **Create/Update negativos y atomicidad: resuelto.**
   `TestCreateAndUpdateModuleRejectPersistedDimensionDefinitions` cubre `widthMm` con default divergente, `heightMm` con tipo/default incompatible y `depthMm` decimal. Create deja cero filas; Update conserva `width_mm = 600` y definiciones vacías, probando cero mutación parcial.

## Evidencia ejecutada

- `pnpm --filter @granete/domain test`: 96 archivos / 1205 tests verdes; incluye 16 casos en `furnitureCompositionEngine.parameters.test.ts`.
- Go enfocado de dominio/engine: verde.
- PostgreSQL 16 aislado: fresh/upgrade/down, direct-SQL corrupto, tenant scope, round-trip y matriz negativa Create/Update verdes.
- `./init.sh`: exit code 0; Go completo, TypeScript completo y Ruby 3.2.11 completos.
- Ruby/RBZ: 248 tests / 2349 assertions y 3 boundary tests / 1067 assertions, cero failures/errors/skips; RBZ SHA-256 `ad149f46bb500a564505ce8a1a02efa7d6d4fb24eb683f816fa2e78a6ee48f45`.
- TestUp real-host previo, aplicable porque la corrección no modificó Ruby ni evidencia host: SketchUp `26.2.242`, 8/8 tests, 98 assertions, cero failures/errors/skips; árbol instalado verificado byte a byte contra el RBZ.
- Readback remoto previo al commit de este artifact: PR #486 abierto, draft y mergeable; head exacto `fec1c4e7...`; seis checks `COMPLETED/SUCCESS`; base exacta `d85d6fd...`.
- `git diff --check 876c9d3f..fec1c4e7`: limpio; la corrección sólo toca los ocho archivos esperados de dominio, contratos/fixtures y storage tests.

## Blockers del review anterior

- Binding autoritativo Go y efecto `shelfCount=1` vs `3`: [x]
- Evaluator estricto en valores de los entry points TS: [x]
- Definiciones inválidas/bindings en todos los entry points TS: [x]
- W/H/D con única fuente, proyección, `sortOrder` y negativas Create/Update: [x]
- Publicación/read fail-closed Go y Ruby + hash no ignorado: [x]
- Corpus corrupto compartido, incluidos shapes anidados TS: [x]
- TestUp real-host con cero mutación en rechazos: [x]
- Down migration, tenant isolation e issues estructurados: [x]

No quedan cambios requeridos en el alcance revisado. Esta aprobación no mergea el PR ni cierra la issue; el owner todavía debe cerrar el ledger/progreso y volver a verificar CI/readback sobre ese commit final.
