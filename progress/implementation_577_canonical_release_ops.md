# Implementation #577 — OPS-DT-1: Canonical ProductionRelease → BOM, warehouse and production continuity

Fecha: 2026-09-06. Base: `main@cb6f78bd` (post PRs #565/#568/#569/#572).
Issue: [#577](https://github.com/tiagofur/muebleria/issues/577). Trackea #384/#396.
Rehearsal originario: `docs/demo/demo-golden-path-rehearsal-20260906.md` (P0-2).

## Qué cierra esta entrega

El tramo operacional Web (BOM/material planning, almacén, ejecución física)
deja de depender de las piezas legacy y queda gobernado por el
`ProductionRelease` canónico (#395/#502):

> Q2 accepted → R2 approved → **ProductionRelease P1** → exact manufacturing
> context desde P1/R2 → material planning → warehouse → producción,
> sin segunda liberación legacy y con proveniencia exacta.

## Cambios por capa

### Backend (Go)

- **`ResolvedProductionRelease` extendida** (`domain/production_release.go`):
  `Source` (`canonical|legacy`), `ReleaseNumber`, `DesignRevisionID/Number`,
  `QuoteRevisionID`, `Status`. Sigue siendo la ÚNICA authority shape; el
  adapter legacy (`ResolveLegacyProductionRelease`) marca `source=legacy`.
- **Proyección server-owned en el read model de proyecto** (#577):
  `projects.resolved_production_release` computado en `ListProjects`
  (batch: `LatestCanonicalReleasesByProject`, una query, sin N+1) y
  `GetProjectByID`. Canónico gana SIEMPRE sobre el blob coexistente; blob
  legacy sólo como fallback pre-DT. Nunca se persiste ni se acepta en writes
  (POST/PUT lo limpian); redactado para sales callers
  (`RedactProjectManufacturing`).
- **Derive con release exacto** (`api/materialPlanning.go`,
  `storage/materialPlanning.go`): `POST .../materials/derive` acepta
  `production_release_id`; cuando hay release canónico es OBLIGATORIO
  (409 implícito-latest); id ajeno/ausente → mismo 409. Nueva vía
  `MutateProjectMaterialPlanningForRelease` resuelve ESE release exacto en la
  tx (sin retarget a latest). Snapshot de requirements con pins de
  proveniencia: `source_production_release_id`, `source_release_number`,
  `source_design_revision_id/number`, `source_quote_revision_id` +
  `bom_fingerprint` (el fingerprint del release, sin segundo namespace).
  Evento `materials_required` auditado con la proveniencia completa.
- **`design_id` en el DTO de release** (contract generado): el release expone
  el design padre para cargar el snapshot exacto
  (`GET /designs/{designId}/revisions/{revisionId}`) sin escanear.

### Domain (packages/domain)

- **`releaseAuthority.ts`**: `ProductionReleaseAuthority` + `releaseAuthorityOf`
  (proyección server gana; blob legacy como compat; `undefined` = nunca
  liberado) + `releaseAuthorityLabel` (`Liberación #1 · Diseño R2`).
- **`releaseBomContext.ts`**: adapter puro DesignRevisionItems → input del
  engine TS existente (`quantity:1` por instancia física,
  `materialChoices`→`optionChoices` — mismos slots `board|hardware|edge`
  que `resolveBom` consume —, `parameters`→`customDims`). Sin segundo motor,
  sin copia persistida. `requirementLinesFromContext` es el ÚNICO builder de
  líneas (compartido con el path quote legacy).
- **`processStage`**: `sentToProduction` reconoce la authority canónica como
  envío a producción (sin handshake legacy). `canReleaseMaterials` igual.
- **`'rev-1'` eliminado** de toda derivación operacional
  (`partExecutionDerivation.ts`, `partExecution.ts`): el token es el id
  exacto de la authority (`''` sólo si nunca se liberó; el guard server 409
  cualquier otro). `materializeRequirements` y `captureCostBaseline` pasan a
  `releaseAuthorityOf`.
- Agregadores del engine (`generateProjectMaterialSummary`,
  `generateHardwareList`, `generateCutRows(WithLinks)`) tipados
  estructuralmente (`BomProjectContext`) para aceptar el context de release.

### Web (apps/web + packages/ui)

- `materialPlanningView.canDerive` desde la authority (canónico solo, sin
  blob, habilita derive); `provenance` human-readable
  (`Derivado de Liberación #1 · Diseño R2`, detalle técnico con ids/hash en
  tooltip) renderizado en `MaterialPlanningPanel`.
- `AppContent.onDerive` (path canónico): carga el context exacto por client
  generado (`listProjectProductionReleases` + `getDesignRevision`) →
  `requirementLinesFromContext` → derive con `production_release_id` exacto.
  Path legacy-only se conserva íntegro.
- `AppContent.handleGeneratePartExecutions`: gate + stamp por authority;
  contenido de piezas/unidades derivado del snapshot inmutable del release
  (identidad por furniture instance), no de `project.items`.
- CTAs legacy ocultos con canónico: "Enviar a Producción"
  (`EngineeringWorkspace`, badge `Liberación #1 · Diseño R2` en su lugar) y
  "Re-evaluar Liberación" del banner de staleness (re-release va por el
  Digital Thread).
- `FabricScreen`: el card de producción reconoce la liberación (label) y
  ofrece `Generar piezas físicas` desde la authority cuando no existen
  ejecuciones.
- `costingView` + `AppContent.hasSource` + `projectStore` (assembly
  readiness) + `ProjectOverviewPanel` desde la authority.

### Contract / storage TS

- OpenAPI: `design_id` (nullable) en `ProductionRelease`; regenerados Go+TS.
- `apiMappers`: `resolved_production_release` (from/to dominio) y pins de
  proveniencia del planning.
- `apiWorkspaceRepository.deriveMaterialRequirements(projectId, lines,
  {productionReleaseId})` + `getLatestReleaseBomContext(projectId)` vía
  `GraneteApiClient` generado (sin fetch manual nuevo).

### Bug latente corregido (expuesto por esta entrega)

`GET /projects/{id}/materials` paniqueaba (nil deref en
`buildMaterialsView`: `planning.ProjectID`) cuando la obra nunca derivó
requerimientos. Las pantallas operacionales leen el view ANTES del primer
derive, así que el flujo canónico (que ahora llega al almacén sin pasar por
el derive legacy) lo exponía. Fix: el view responde 200 con coverage vacío y
`planning: null` (test `TestMaterials_ViewWithoutPlanningAnswersEmptyEvidence`).

## Límites documentados (no silent fallbacks)

- El fingerprint cubre revision items (definición/versión/parámetros/
  materialChoices), NO el contenido agregado de `lines`: el contenido lo
  computa el engine TS existente sobre el snapshot exacto y el server
  vincula+audita; no se inventó un segundo namespace de hash.
- Los revision items no pinean option groups `edge` opcionales ni
  `structureRevisionPin` (fallbacks existentes del engine); los quote
  revision items tampoco pinean materialChoices hoy (siempre `{}`) — por eso
  el E2E operacional usa un release design-first con choices material-pinned.
- `project.productionRelease` (blob) sigue legible como estado de
  compatibilidad pre-DT y congelado al existir canónico; writers legacy
  intactos para proyectos sin release canónico.

## Evidencia

- Go: `TestMaterials_Derive*` (canonical exige id exacto, stamps, wrong id
  409, legacy compat) + `TestOpsDt1_*` (proyección canónica gana sobre blob
  coexistente, legacy-only, derive exacto, R4 no retarget, blob legacy NULL)
  sobre PostgreSQL real (RLS, app role).
- Domain TS: `releaseAuthority.test.ts` (canonical gana, legacy fallback,
  processStage sin handshake) + `releaseBomContext.test.ts` (mapeo +
  **paridad**: mismas líneas desde snapshot de release y estado quote
  equivalente; mutación de `project.items` no altera la derivación).
- UI: `MaterialPlanningPanel.test.tsx` (canDerive canónico solo, canonical
  gana sobre blob stale, provenance).
- Browser E2E real (React+Go+PostgreSQL, `tests/organization/project-reconciliation.spec.ts`):
  golden path Q1→Q2→P1 existente + tramo OPS-DT-1: fixture con choices
  material-pinned, proyección canónica en readback con blob NULL, negativos
  derive (implícito/ajeno → 409 sin plan parcial), derive UI con provenance
  `Liberación #1 · Diseño R1`, readback con pins exactos, mutación de
  project.items sin efecto, liberación de materiales (override auditado),
  producción reconoce la liberación + generación física, part-executions
  estampadas con el id exacto del release, blob legacy NULL al final.
- Regresiones: suites completas `pnpm test` (JS) y `go test ./...`
  (incl. storage sobre PostgreSQL real).

## Verification ejecutado

- `pnpm openapi:generate` + `pnpm openapi:check`
- `pnpm typecheck` (7/7 proyectos)
- `pnpm test` (domain 1257, ui 1612, storage 182, web 424, …)
- `GOFLAGS='-p=1' go test ./... -count=1`
- `scripts/organization-browser-gate.sh tests/organization/project-reconciliation.spec.ts`
  (Chromium real + Go + PostgreSQL 16 efímero, roles separados)
- `git diff --check`
