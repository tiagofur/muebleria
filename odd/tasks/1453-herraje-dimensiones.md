# 1453 — Herrajes: dimensiones W×H×D (HW/HH/HD) — Fase 1

Issue: #1453 (`status:approved`). Rama: `feat/1453-herraje-dimensiones` desde `origin/main` (13fed4ee).
Topología: Delegated Direct. Este es el único artefacto de ejecución.

## Objetivo observable (Fase 1)

El registro de herraje tiene `dimensions {widthMm, heightMm, depthMm}` (canónico,
nullable), las fórmulas de placement y de receta exponen `HW/HH/HD` con paridad
TS↔Go, el path de perforaciones usa las dimensiones reales (no `96` hardcodeado),
y el formulario muestra/edita las tres medidas con valores sugeridos del diseño
(asset) vía botón «Cargar del diseño».

## Decisiones de diseño (fijadas al arrancar)

- **Columna**: `hardwares.dimensions JSONB` nullable (objeto completo o nada;
  sin estados parciales). Escaneo igual que `design_parts` (raw []byte).
- **Fallbacks efectivos shape-agnostic** (única fuente en runtime, TS+Go):
  `HW = dimensions.widthMm ?? previewSizeMm ?? 96` (byte-idéntico al comportamiento
  actual), `HH = dimensions.heightMm ?? previewDiameterMm ?? 0`,
  `HD = dimensions.depthMm ?? previewProjectionMm ?? 0`. `0 = no modelada`.
- **Backfill SQL (mig 000173)**: sólo shapes con mapeo unambiguous
  (bar-pull/cup-pull/knob/hinge con `preview_size_mm NOT NULL`):
  w=sizeMm, h=diameterMm (knob/hinge: sizeMm), d=projectionMm (default 25/32
  según familia). slide/rail/leg quedan NULL (sección no modelada en F1).
- **Standoff/extents**: `projection := dims.depth ?? previewProjection ?? 25`,
  `extentU := dims.width ?? size`, `extentV := dims.height ?? diameter` — sólo
  cambian filas CON dimensions (ninguna hoy → goldens sin cambio).
- **Evaluador**: TS sustitución `HW→HH→HD` antes de `PW/PH/PD/W/H/D` (orden de
  tokens, como hoy HW). Go parser: `HasPrefix("HH"/"HD")` tras `HW`, antes de
  `H`/`D`. Charset ya admite las letras — sin cambio de charset.
- **Assembly (receta)**: `AssemblyResolutionParams` gana lookup opcional
  `hardwareDimensions` (hardwareId → dims) que alimenta el env del
  `offsetFormula` del miembro; sin lookup → HW/HH/HD = 0 (como hoy).
- **UI**: sección «Dimensiones» (3 inputs + «Cargar del diseño» desde bbox del
  GLB vinculado; deshabilitado con hint si no hay asset/GLB).

## Superficie de edición

- TS domain: `packages/domain/src/types.ts` (Hardware.dimensions),
  `hardwarePlacement.ts` (helper efectivo + env HH/HD), `engine/shared.ts`
  (evaluador), `partDrillingResolver.ts` (env por placement), `agregadoAssembly.ts`
  (params + env).
- Go: `internal/domain/catalog.go` (struct), `engine/resolve.go` (formulaDims +
  parser), `engine/layout.go` (2 envs + extents), `engine/assembly_resolver.go`
  (params + env), `internal/storage/materials.go` (+columna en 4 stmts + scan),
  `db/migration/000173_hardware_dimensions.{up,down}.sql`.
- Contratos: `contracts/openapi/granete-api.v1.yaml` (+dimensions en esquemas
  hardware) → `pnpm openapi:generate` (types.ts/client.ts/types.gen.go);
  `packages/storage/src/apiMappers.ts`.
- UI: `packages/ui/src/catalogs/hardware/{Hardware3DSection,HardwareFormModal,
  HardwareCatalog}.tsx`, `hardwareDraft.ts`, `apps/web/src/stores/catalog/hardware.ts`,
  `packages/ui/src/preview3d/HardwareMesh.tsx` (grip usa dims efectivos).
- Fixture paridad: `contracts/hardwareDimensions.contract.json` (familias +
  fórmulas HW/HH/HD) consumido por vitest + go test; caso HW en
  `agregadoOffsetFormula.contract.json`.

## Tareas

- [x] Evidencia inicial (lecturas acotadas, sin delegación extra)
- [x] TS domain + tests
- [x] Go domain/engine/storage + migration + tests
- [x] OpenAPI + regeneración + mappers
- [x] UI + tests
- [x] Fixture paridad consumido por ambos motores
- [ ] Congelar candidato, verify_affected, PR

## Verificación observada (candidato, rama feat/1453-herraje-dimensiones)

- V0: `pnpm typecheck` workspace completo PASS; `pnpm openapi:check` sin drift; `go build ./...` OK.
- V1: vitest domain 2075/2075 (incl. `hardwareDimensions.contract.test.ts` 2/2, drilling 28/28, placement 41/41, offsetFormula 1/1); vitest ui 2398/2398 (incl. HardwareCatalog 24/24 con 3 tests nuevos de Dimensiones); vitest storage 279/279 (mapper dimensions round-trip 3 nuevos); vitest web 610/610; `go test ./... -p 1` verde completo (incl. `TestHardwareDimensionsSharedContract`, `TestAssemblyMemberFormulaSeesHardwareDimensions`).
- V2: gate postgres (foundation-gate-a --stage postgres) en corrida al momento de esta edición — resultado en el PR; browser gate hardware-3d-catalog pendiente.

## Notas de borde (para el review)

- El PUT de herraje distingue ausente vs null sólo para kit_hardware_id (#1436); `dimensions` viaja SIEMPRE en el payload del único writer real (hardwareToApi incluye la clave, null u objeto), y no hay terceros en el MVP. Sharp edge documentado: un cliente API parcial que OMITA dimensions en un PUT lo limpiaría.
- El seed demo inserta hardwares sin dimensions (NULL) — cubiertos por los fallbacks efectivos en runtime.
- `slide`/`rail`/`leg` no reciben backfill (sección transversal no modelada en F1): NULL → fallbacks runtime.
- Copia de organización (organizations.go) ahora copia `dimensions`; las demás columnas ausentes ahí (available_finishes, design_parts, kit_hardware_id, visual_asset) son brecha preexistente fuera de alcance.

## Non-goals (fijos)

Fase 2 (xRef/hwAnchor), #1452 espejo copias, #1065 perforaciones por dimensión.
