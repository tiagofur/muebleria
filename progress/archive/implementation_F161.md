# F161 implementation evidence — GitHub #346

## Review state

- Feature: F161 — sketchup_semantic_metadata_roundtrip (issue #346)
- Branch: `feat/346-semantic-metadata-roundtrip` (slice 1, PR #369, merged) +
  `feat/346-entity-tombstones-readonly-feedback` (slice 2)
- Invariant: SketchUp owns authoring/interaction; Granete owns manufacturing
  truth. Nada de BOM/drilling/joints/nesting/kerf/toolpath vive en el envelope
  o en Ruby.

## Decisión de namespace

El schema nace **`granete.sketchup-authoring.v1`** (rename de marca #366). El
issue #346 y el contract decían `muebles.sketchup-authoring.v1`; nada se
publicó bajo ese ID → no se debe migración. Nota explícita agregada a
`docs/sketchup-manufacturing-contract.md`.

## Slice 1 — contrato ejecutable (PR #369, merged)

- `sketchupAuthoringSchema.ts`: tipos v1 completos (envelope, stable IDs,
  transforms mm con frame explícito y quaternion, relationships/anchors,
  hardware placements, tombstones, response/receipt) + fingerprint canónico
  (invariante a key-order y ruido de redondeo por `precisionMm`).
- `sketchupAuthoringValidation.ts`: validación estructural/semántica →
  `ContractIssue[]` con paths estables; nunca lanza. Codes: SCHEMA_ID_MISMATCH,
  SCHEMA_VERSION_UNSUPPORTED, TRANSFORM_INVALID, CATALOG_REFERENCE_MISSING,
  CATALOG_REVISION_STALE, JOINERY_SYSTEM_UNSUPPORTED, STABLE_ID_DUPLICATE,
  RELATIONSHIP_INVALID/ORPHANED, HARDWARE_HOST_INVALID, ENTITY_TOMBSTONE_INVALID.
- `sketchupAuthoringExchange.ts`: apply atómico full-snapshot-with-tombstones
  con idempotencia por key+fingerprint (mismo payload replaya la misma
  respuesta; distinto → IDEMPOTENCY_CONFLICT), base stale → conflict sin
  mutación parcial, response correlacionada
  (responseMessageId/inReplyToMessageId/idempotencyKey/projectId/sourceRevisionId).
- `sketchupAuthoringMigrations.ts`: registry fail-closed; versión sin
  migration registrada lossless rechaza antes de mutar.
- Fixture golden `__fixtures__/sketchupAuthoringCabinet.ts`: caso canónico del
  contract §13 — cabinet con dos entrepaños que comparten
  `componentDefinitionId` con instancias/relationships independientes + bisagra
  manual + catálogo. Test golden SketchUp → Granete → SketchUp sin pérdida
  semántica.

## Slice 2 — sub-entidades y feedback read-only (esta rama)

- Completitud de snapshot a **toda granularidad**: omitir un componente,
  relationship o hardware placement sin su tombstone → `conflict`
  (`SOURCE_REVISION_CONFLICT` con entityId y path); nunca deletes por ausencia.
- Tombstones de sub-entidad: válidos sólo contra entidades vivas o ya
  eliminadas (`ENTITY_TOMBSTONE_INVALID` para desconocidas o coexistiendo con
  el snapshot); el receipt reporta lo que el sender mutó explícitamente (el
  tombstone de assembly reporta el assembly; sus sub-entidades mueren con él).
- **STABLE_ID_REUSE a nivel pieza**: un componentInstanceId/relationshipId/
  hardwarePlacementId eliminado jamás se reutiliza (cross-type check).
- Tipos read-only del lado Granete (contract §6/§7):
  `ResolvedManufacturingFeedback`, `ManufacturingIdentity`, provenance con
  discriminante único (`isValidDerivedOperationProvenance` — `{}` y
  combinaciones ambiguas inválidas), derived placements/operations; la response
  gana `resolvedFeedback?` opcional y el envelope no puede expresarlo
  (boundary verificado por test).

## Verification

| Command | Result |
|---|---|
| `pnpm vitest run src/sketchupAuthoring` | 22 tests, 0 failures (18 slice 1 + 4 nuevos bloques) |
| `tsc --noEmit` (domain) | 0 errores |
| `./init.sh` | exit 0 real — typecheck 7 workspaces, suite TS completa, Go ok, Ruby/RBZ gate ok |
| CI PR #369 | success (matriz Ruby 3 OS incluida) |

## Acceptance del issue #346 — cobertura

- [x] Renombrar no cambia stable ID (rename = update, mismo assemblyId/instanceId).
- [x] Dos entrepaños comparten definition, independencia por instanceId.
- [x] Anchors y hosts siempre `componentInstanceId`.
- [x] Unicidad por projectId + no-reuse tras delete (assembly y sub-entidades).
- [x] mm/transforms: rounding de transporte, fingerprint invariante al ruido.
- [x] Authoring intent separado por construcción de resolved data.
- [x] Relaciones/anchors para #356 sin coordenadas CNC como verdad primaria.
- [x] Catálogo desconocido → ContractIssue estructurados.
- [x] Reimport idempotente (mismo responseMessageId/receipt).
- [x] Response correlacionada completa.
- [x] Atomicidad create/update/delete; stale → conflict sin mutación parcial.
- [x] resolvedFeedback read-only; no re-ingresa como authoring.
- [x] schemaId = schemaName + major(schemaVersion); fail-safe.
- [x] Migrations: sólo registradas/lossless; receipt auditable cuando existan.
- [x] Golden round-trip sin pérdida semántica ni confusión definition/instance.

## Pendiente / siguiente

- #356 (parametric part relationships) consume este contrato como entrada.
- Transport/persistencia del estado aceptado (server authority) y export del
  envelope desde la extensión Ruby quedan para los issues que los requieran
  (#350/#354/#347 flujo), sin reabrir #346.
