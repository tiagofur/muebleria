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
- UI: `packages/ui/src/catalogs/hardware/{Hardware3DSection,HardwareCatalog}.tsx`,
  `hardwareDraft.ts`, `apps/web/src/stores/catalog/hardware.ts`,
  `packages/ui/src/preview3d/HardwareMesh.tsx` (grip usa dims efectivos).
- Fixture paridad: `contracts/hardwareDimensions.contract.json` (familias +
  fórmulas HW/HH/HD) consumido por vitest + go test.

## Tareas

- [x] Evidencia inicial (lecturas acotadas, sin delegación extra)
- [x] TS domain + tests
- [x] Go domain/engine/storage + migration + tests
- [x] OpenAPI + regeneración + mappers
- [x] UI + tests
- [x] Fixture paridad consumido por ambos motores
- [ ] Congelar candidato, verify_affected, PR

## Verificación observada (candidato congelado 70c5c0b3, base 13fed4ee)

- V0: `pnpm typecheck` workspace completo PASS; `pnpm openapi:check` sin drift; `go build ./...` OK.
- V1: vitest domain 2075/2075 (incl. `hardwareDimensions.contract.test.ts` 2/2, drilling 28/28, placement 41/41, offsetFormula 1/1); vitest ui 2398/2398 (incl. HardwareCatalog 24/24 con 3 tests nuevos de Dimensiones); vitest storage 279/279 (mapper dimensions round-trip 3 nuevos); vitest web 610/610; `go test ./... -p 1` verde completo (incl. `TestHardwareDimensionsSharedContract`, `TestAssemblyMemberFormulaSeesHardwareDimensions`).
- V2: `foundation-gate-a --stage postgres` **PASS** (mig 000173 fresh+upgrade sobre PostgreSQL real); `organization-browser-gate hardware-3d-catalog.spec.ts` **PASS** 1/1; `organization-browser-gate agregado-offset-formula.spec.ts` **PASS** 1/1 (simulación con lookup de dimensiones).

## Entrega

PR con `Refs #1453` + `Delivery: partial`: Fase 1 completa; Fase 2 (xRef/yRef
panel-side + hwAnchor + presets por tipo de frente) queda en la issue.

## Ronda de corrección consolidada (review CHANGES_REQUESTED + fallo CI)

- **CI (Storage shard 2/4)**: `TestGetFullCatalogRejectsDirectSQLInvalidParameterDefinitions`
  re-anclado 171→173 siguiendo el patrón documentado del propio test (el pin
  sube cada vez que la lectura de catálogo requiere columnas nuevas).
  Reproducido con PG real (7/7 FAIL → PASS); **4 shards oficiales locales:
  153+157+153+183 = 646 PASS, 0 FAIL, 0 SKIP**. El verde local previo del
  storage era SKIP silencioso (sin MIGRATION_DATABASE_URL).
- **B1**: backfill de la migración ahora excluye filas cuyos preview*
  producirían ejes no positivos (diámetro 0 / proyección 0 = flush): quedan
  NULL y los fallbacks runtime aplican. `scanHardwareDimensions` además
  degrada objetos null/parciales/no-positivos de SQL directo a nil.
- **B2**: `resolveModuleAgregadoAssemblies` (preview de proyecto) pasa
  `hardwareDimensions` desde el catálogo — misma paridad que Go; nuevo test
  `agregadoModuleAssembliesDimensions.test.ts` (236 vs 300 con HW=0).
- **B3**: tests de regresión añadidos — drilling con HW real (preview 128→136,
  dims 160→120, derivado sin registro→152 histórico), 422 tipado POST×2 +
  PUT×2 en `catalog_handlers_test.go`, placement con dims (fórmula HW +
  precedencia standoff), geometría del mesh (grip length/diameter por eje).
- Baratas del review: hoist del lookup fuera del loop de instancias
  (layout.go), gofmt de los archivos tocados. NO adoptadas (documentadas):
  default de altura 32 del backfill vs 12 del mesh TS (decision documentada),
  divergencia mm fraccional por redondeo int en Go (convención preexistente).
- Corregidas inexactitudes de este artefacto señaladas por el review
  (superficie sin HardwareFormModal; no hay caso HW en
  agregadoOffsetFormula.contract.json).

## Notas de borde (para el review)

- El PUT de herraje distingue ausente vs null sólo para kit_hardware_id (#1436); `dimensions` viaja SIEMPRE en el payload del único writer real (hardwareToApi incluye la clave, null u objeto), y no hay terceros en el MVP. Sharp edge documentado: un cliente API parcial que OMITA dimensions en un PUT lo limpiaría.
- El seed demo inserta hardwares sin dimensions (NULL) — cubiertos por los fallbacks efectivos en runtime.
- `slide`/`rail`/`leg` no reciben backfill (sección transversal no modelada en F1): NULL → fallbacks runtime.
- Copia de organización (organizations.go) ahora copia `dimensions`; las demás columnas ausentes ahí (available_finishes, design_parts, kit_hardware_id, visual_asset) son brecha preexistente fuera de alcance.

## Non-goals (fijos)

Fase 2 (xRef/hwAnchor), #1452 espejo copias, #1065 perforaciones por dimensión.

## FASE 2 (post-merge a30d6bf9, rama feat/1453-f2-herraje-anclaje)

Diseño fijado:

- `relativePosition` gana `xRef`/`yRef: 'min'|'max'|'center'` (base del offset
  sobre la cara; ausente = 'min' = histórico byte-idéntico). `HardwarePlacement`
  gana `hwAnchor: 'mount'|'center'|'hole:<opId>'` — qué punto del herraje
  aterriza en el punto del panel. mount=(0,0) default; center=(dims.w/2,
  dims.h/2) para assets con origen en esquina; hole:<opId>=(op.xMm, op.yMm) del
  maquinado, rotado por rotZ como el drilling.
- Resolución compartida por superficie: punto final = clamp(ref base + offset
  ó fórmula − offsetDeAncla rotado). El clamp aplica SOLO al punto final.
  TS: helper en hardwarePlacement.ts consumido por resolveHardwarePlacement Y
  partDrillingResolver (paridad preview/CNC). Go: helper gemelo en layout.go;
  resolveHardwareToWorld usa el punto corrido para local/faceRender/OffsetMm
  (OffsetMm es el origen de perforación #1322 → CNC sigue solo).
- UI: HardwarePlacementsEditor con selects «X desde/Y desde» + «Ancla» +
  presets «Cajón centrado» (xRef center +0) y «Puerta borde» (max + offset).
- SketchUp: proxy box centrado en el origen (mata la divergencia
  esquina-vs-centro) + EXTENSION_VERSION bump.
- Fixture: casos xRef/hwAnchor consumidos por vitest + go test.

### Evidencia F2 (candidato, rama feat/1453-f2-herraje-anclaje)

- V0: typecheck workspace ✓, openapi:check sin drift ✓, `go build ./...` ✓, Ruby syntax ✓.
- V1: domain 2083/2083 (nuevo `hardwarePlacementAnchoring.contract.test.ts` 8 casos), ui 2402/2402 (HardwarePlacementsEditor 16/16 con 3 tests F2), Go full suite verde (incl. `TestHardwarePlacementAnchoringSharedContract`), rake verify 1483/0.
- SketchUp: proxy centrado EN GEOMETRÍA (`build_hardware_proxy_box`: in-plano centrado, +Z outward) — el origen de instancia queda en el punto de cara (contrato 405 intacto); primer intento (trasladar la instancia) rompía material_rebuild_test y se revirtió. EXTENSION_VERSION 0.1.92.
- Sin migración DB: xRef/yRef/hwAnchor viajan en el JSONB de overrides existente.
