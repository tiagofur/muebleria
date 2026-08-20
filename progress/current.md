# Sesión activa

**Feature:** F116 — catalogs_critical_bugfixes
**Estado:** Done
**Fecha:** 2026-08-19

## Objetivo

Corregir los bugs críticos de pérdida de datos silenciosa en catálogos detectados por el Judgment Day de Catálogos (docs/history/judgment-day-catalogos-2026-08-19.md §3), más paridad de seeds TS↔Go.

## Qué se hizo (por bloque)

### Bloque 1 — Store TS (commit 5839a25)
- **C1**: `materialPreviewFinishFields` helper — PBR (roughness/metalness/clearcoat) ahora persiste en create/updateMaterial (antes se descartaban silenciosamente).
- **C5**: previewColor solo se persiste normalizado (adiós doble asignación que dejaba pasar hex inválido crudo).
- **C7**: helpers `saveAndToast`/`patchSaved` — TODOS los handlers del catalogStore cantan éxito solo tras confirmar el save (createEdge, createHardware, módulos, estructuras, componentes, agregados, option groups, categorías, customers, setXActive).
- **C6**: `migrateWorkspace` extraído a módulo propio (sin node:fs) y aplicado en LocalStorageWorkspaceRepository (guest). Fix adicional: migración v1→v2 ahora tolera módulos sin boardParts (crasheaba).

### Bloque 2 — Unicidad (commit 1f580a0 aprox)
- `validateUniqueCode`/`findActiveCodeConflict` ahora validan contra TODOS los ítems (activos+inactivos), consistente con SQL UNIQUE(code). Aplica a materiales, cantos, herrajes, acabados, estructuras, componentes.
- `apiWorkspaceRepository.upsert`: PUT-409 y POST-409 dejan de tragarse como éxito → rechazan con error claro.

### Bloque 3 — Go/Postgres (commit 2d17491)
- **C3**: migración 000061 — edge_bands.thickness_mm INT→DOUBLE PRECISION + CHECK (>=0); Go EdgeBand.ThicknessMm int→float64.
- **C4**: `DeleteAgregado` (hard delete) con guard de referencias vía JSONB containment en modules/structures.agregados; handler DELETE mapea 409 (in use) / 404; FE deleteAgregado ahora llama REST en modo auth.
- **A1**: PUT material mapea duplicate-key → 409.
- **A2**: DeleteModule con pre-check de project_items → 409 "in use" (antes: 500 tras borrado optimista local).
- **A3**: seeds no destructivos: edges sin `SET id = EXCLUDED.id`, ensurePlinthCatalog `DO NOTHING`.
- **A4**: seed Go con paridad TS: preview_shape/dims/PBR en herrajes demo (bisagra/jaladera/pata/corredera visibles en 3D), previewColor en materiales, espesores 0.5/2/0.

### Bloque 4 — Trackers
- F080 → done (estaba shipped en 951631f pero marcado CONGELADO/pending).
- F069/F070: notas de divergencia implementación vs aceptación (gizmo nunca montado, acabados como presets en código).

## Resultados de Verificación

- `pnpm test`: domain 659 · storage 124 · excel 72 · ui 1122 · web 275 · mobile 36 · desktop 17 — **todos verdes**.
- `pnpm typecheck`: 7/7 workspaces sin errores.
- `go test ./...` (backend-go): todos los paquetes ok.
- Tests de integración nuevos contra Postgres local (5445): `TestEdgeBand_FractionalThicknessRoundTrip` y `TestAgregado_HardDeleteWithUseGuard` PASS (migración 000061 aplicada vía RunMigrations).
- `./init.sh`: **100% verde**.

## Tests nuevos

- `apps/web/src/stores/catalogStore.test.ts` — describe "F116 bugfixes" (C1 create/update, C5, C7, C4 REST).
- `packages/storage/src/localStorageMigration.test.ts` — migraciones v1→v2→v3 + guest localStorage migration.
- `packages/storage/src/apiWorkspaceRepository.test.ts` — PUT/POST 409 ahora rechazan.
- `packages/ui/src/catalogs/catalogHelpers.test.ts` — unicidad incluye inactivos.
- `backend-go/internal/storage/catalog_f116_test.go` — espesor fraccional round-trip + delete agregado con guard.

## Notas para el reviewer

- Los tests viejos de setMaterialActive/duplicateModuleById se actualizaron: los toasts ahora son async (comportamiento corregido, no regresión).
- El stubStore de handlers_test.go ganó DeleteAgregado stub.
- Pendiente para F117 (siguiente feature): refactor de archivos grandes de catálogos.
