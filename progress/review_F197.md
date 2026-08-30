# Review — feature F197

**Veredicto:** CHANGES_REQUESTED

**Rama revisada:** `feat/483-typed-parameters`
**Head de implementación/evidencia:** `8417157e2c32cc84fe871601f534d10c261eec5c`
**Base:** `d85d6fd21aa040c4d1f08c5c76c0ab099db7c83b`

## Checkpoints

- C1: [x] Harness completo; `./init.sh` terminó con exit code 0 contra PostgreSQL 16 aislado.
- C2: [x] Sólo F197 está `in_progress`; `progress/current.md` describe la corrección activa.
- C3: [ ] La ruta TypeScript todavía separa validación estructural/publicada de evaluación y permite definiciones que el contrato declara inválidas.
- C4: [ ] Las suites están verdes, pero el corpus no cubre los dos bypasses TypeScript reproducibles detallados abajo ni las negativas Create/Update requeridas por el review del owner.
- C5: [x] Head local y remoto coinciden, no hay commits locales ni archivos sospechosos; F197 permanece correctamente abierto hasta corregir y re-revisar.

## Evidencia ejecutada

- `./init.sh`: verde; TypeScript completo, Go completo con PostgreSQL 16, Pilot Readiness y Ruby/RBZ.
- `pnpm --filter @granete/domain test`: 96 archivos / 1198 tests verdes.
- Go enfocado de parámetros/catalog/resolve: verde.
- PostgreSQL enfocado: fresh/upgrade/down, direct-SQL corrupto, tenant scope y round-trip verdes.
- `bundle exec rake verify`: 248 unit tests + 3 boundary tests verdes; RBZ `ad149f46bb500a564505ce8a1a02efa7d6d4fb24eb683f816fa2e78a6ee48f45`.
- TestUp real-host: SketchUp `26.2.242`, 8/8 tests, 98 assertions, cero failures/errors/skips. El RBZ instalado coincide byte a byte con el artifact; golden y test file coinciden con los hashes declarados.
- Readback remoto: head exacto `8417157e...`; seis checks CI `SUCCESS`; PR abierto, draft y mergeable; issue #483 abierta.

## Cambios requeridos

1. **P1 — Los entry points TypeScript aceptan un parámetro físico sin consumidor.**
   `evaluateFurnitureParameters` llama sólo a `validateFurnitureParameterDefinitions` (`packages/domain/src/furnitureParameters.ts:275-280`), mientras la regla que exige binding vive aparte en `validatePublishedFurnitureParameterDefinitions` (`:149-165`). `instantiateFurniture` y `evaluateInteractive` consumen directamente ese evaluator (`packages/domain/src/furnitureCompositionEngine.ts:61-90,144-175`), por lo que una definición `shelfCount` de categoría `configuration` sin binding devuelve `normalized: { shelfCount: 2 }` y cero issues, aunque el validador publicado reporta `binding: non-metadata parameters require an authoritative binding`. Esto deja exactamente una ruta real de resolve que acepta intención física no vinculada. Hacé que los tres entry points fallen con `PARAMETER_DEFINITION_INVALID` antes de composición y añadí el negative proof en `furnitureCompositionEngine.parameters.test.ts`.

2. **P1 — El parser TypeScript de catálogo corrupto no garantiza el error tipado.**
   `parsedDefinitionShapeIssues` sólo verifica que `binding` sea un objeto (`packages/domain/src/furnitureParameters.ts:199-231`); después `validateBinding` invoca `.trim()` y accede a `relationship.targets` sin validar tipos anidados (`:235-270`). Con `componentId: 5` o `relationship.kind: 5`, `parseFurnitureParameterDefinitions` lanza `TypeError` (`...trim is not a function`) en vez de `FurnitureParameterDefinitionsError`/`PARAMETER_DEFINITION_INVALID`. El composition engine sólo traduce la clase tipada (`packages/domain/src/furnitureCompositionEngine.ts:81-90,160-170`), así que este input puede escapar como excepción no estructurada. Validá exhaustivamente la forma anidada, agregá estos casos al corpus compartido y probá parser + los tres entry points fail-closed.

3. **P2 — Falta la matriz negativa Create/Update exigida por el review del owner.**
   `backend-go/internal/storage/module_parameter_definitions_migration_test.go:146-183` sólo prueba Create/Update positivos con metadata. El corpus/direct-SQL y POST cubren otros boundaries, pero no demuestran que Create y Update rechacen dimensiones reservadas/default divergente/tipo incompatible. Añadí negativas ejecutables para ambos writes; mantené además GET/catalog y POST decimal/type como pruebas separadas.

## Blockers del review de `97194c9a`

- Binding autoritativo Go y efecto `shelfCount=1` vs `3`: [x]
- Evaluator estricto en valores de los entry points TS: [x]
- Definiciones inválidas/bindings en todos los entry points TS: [ ]
- W/H/D con única fuente, proyección y `sortOrder`: [x] implementación; [ ] cobertura Create/Update solicitada.
- Publicación/read fail-closed Go y Ruby + hash no ignorado: [x]
- Corpus corrupto compartido: [ ] incompleto para shapes anidados TS.
- TestUp real-host con cero mutación en rechazos: [x]
- Down migration, tenant isolation e issues estructurados: [x]
