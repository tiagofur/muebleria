# F162 implementation evidence — GitHub #356

## Review state

- Feature: F162 — sketchup_parametric_relationships (issue #356)
- Branch: `feat/356-parametric-relationships`
- Invariant: **SketchUp owns authoring/interaction; Granete owns manufacturing truth.**
  Las perforaciones y mecanizados son resultados con provenance, nunca coordenadas CNC persistidas como verdad de autoría en SketchUp ni en Ruby.

## Domain Model & Architecture Alignment

Alineado con los documentos canónicos:
- `docs/architecture/domain-model.md` (FurnitureDefinition vs FurnitureInstance vs Components, Library vs Catalog)
- `docs/architecture/manufacturing-feature-model.md` (ManufacturingFeature con coordenadas locales por pieza/cara y provenance explícita)
- `docs/architecture/smart-furniture-engine.md` (Redimensionamiento paramétrico por parámetros y reglas, nunca escalado 3D)
- `docs/sketchup-manufacturing-contract.md` (§5 Authoring entities, §6 Relationship/joint resolution, §7 Round-trip feedback)

## Entregables Implementados

1. **`sketchupJoineryCatalog.ts`**:
   - `SketchUpJoineryCatalog`: interfaz de catálogo de ensambles de Granete (geometría de tableros, sistemas de unión, reglas de herrajes manuales).
   - `ShelfSupportRule`: soporte para Minifix + Tarugo (`minifix-dowel`) y solo tarugos (`dowel-only`).
   - `DEFAULT_SHELF_SUPPORT_RULE`: regla estándar (Minifix 15, Tarugo 8x30, márgenes 50mm, grid 32mm).

2. **`sketchupRelationshipMachining.ts`**:
   - `deriveRelationshipMachining`: resolvedor puro de relaciones constructivas (`shelf-support`) y herrajes manuales a partir de un snapshot de authoring.
   - Generación de operaciones de mecanizado en coordenadas locales del tablero (`Inside` face de costados, cantos de entrepaños).
   - Provenance tipada no vacía (`relationship`, `joint`, `manualHardwarePlacement`).
   - `relationshipBomFingerprint`: hash FNV-1a determinístico sobre JSON canónico ordenado de operaciones y placements.
   - `diffRelationshipMachining`: inspección diferencial por clave de provenance (`unchanged`, `recomputed`, `added`, `removed`).
   - `isFingerprintStale`: detección de staleness post-release ante cambios de manufactura.
   - Detección de errores estructurados (`RELATIONSHIP_INVALID`, `RELATIONSHIP_ORPHANED`, `HARDWARE_HOST_INVALID`, `JOINERY_SYSTEM_UNSUPPORTED`).

3. **`sketchupAuthoringExchange.ts` Integration**:
   - `applyAuthoringEnvelope` soporta el parámetro opcional `joineryCatalog?: SketchUpJoineryCatalog`.
   - Cuando se suministra y el snapshot es aceptado, genera `resolvedFeedback` con `identity` (`bomFingerprint`), `derivedHardwarePlacements`, `derivedMachiningOperations` y `preflightStatus`.

4. **Fixtures & Tests**:
   - `__fixtures__/sketchupJoineryCatalogFixture.ts`: fixture con definiciones de costados y entrepaños, sistemas Minifix/Tarugo y bisagra manual.
   - `sketchupRelationshipMachining.test.ts` (11 tests): 6 casos canónicos del issue #356 + casos de error y staleness.
   - `sketchupAuthoringExchange.test.ts` (23 tests): verificación de envelope exchange, tombstones, idempotencia y generación de `resolvedFeedback`.

## Verification Evidence

| Verificación | Comando | Resultado |
|---|---|---|
| Domain Unit Tests | `pnpm --filter @muebles/domain test` | 82 test files, 1073 tests pasando (0 fallos) |
| SketchUp Domain Suite | `pnpm vitest run sketchup` | 2 test files, 34 tests pasando (0 fallos) |
| Workspace Typecheck | `pnpm typecheck` | 7 workspace packages compilando con 0 errores |
| Backend Go Tests | `cd backend-go && go test ./...` | Todos los paquetes Go pasando (0 fallos) |

## Acceptance de Issue #356 — Cobertura

- [x] Modelo explícito para relaciones/joints con stable IDs y catálogo de uniones (`SketchUpJoineryCatalog`).
- [x] Anchors semánticos ligados siempre a `componentInstanceId`, nunca a `componentDefinitionId`.
- [x] Mover un entrepaño desplaza correctamente el machining derivado en piezas relacionadas.
- [x] Agregar un segundo entrepaño con definición compartida genera nuevas operaciones determinísticas sin duplicados.
- [x] Eliminar un entrepaño remueve únicamente sus operaciones derivadas sin dejar operaciones huérfanas.
- [x] Cambiar joinery system (`minifix-dowel` → `dowel-only`) recalcula machining desde reglas/catálogo.
- [x] Mover un herraje manual modifica únicamente su machining dependiente sin alterar el del entrepaño.
- [x] Operaciones derivadas conservan exactamente una provenance válida; combinaciones ambiguas son inválidas.
- [x] Relaciones inválidas o huérfanas fallan con error estructurado (`RELATIONSHIP_INVALID` / `RELATIONSHIP_ORPHANED`).
- [x] Cambios paramétricos alteran `bomFingerprint` determinístico e invalidan revisiones liberadas previas (`isFingerprintStale`).
- [x] Integración con `applyAuthoringEnvelope` para devolver `resolvedFeedback` read-only cuando se suministra el catálogo de ensambles.
- [x] Domain tests determinísticos pasan al 100% y `tsc --noEmit` pasa con 0 errores.
