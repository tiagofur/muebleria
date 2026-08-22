# Sesión activa: Issue #302 — Operational Core O3: MRP ligero, reservas, compras, QC y retrabajo

**Fecha:** 2026-08-21
**Feature:** F138 — `operational_core_o3` — `in_progress` (implementada; espera review)
**Rama:** `feat/f138-mrp-qc` (desde origin/main, F137 mergeado via PR #320)
**Issue:** #302 (status:approved) — OC-050..OC-054 + OC-060..OC-062

## Objetivo

Conectar BOM liberado → materiales → producción y registrar calidad/retrabajo
(docs/operational-core-v1.md §8–§9).

## Plan (ejecutado)

- [x] F138 registrada en `feature_list.json` (in_progress)
- [x] Dominio puro `packages/domain/src/materialPlanning.ts` + tests (22):
      MaterialRequirement ligado al ProductionRelease (bomFingerprint),
      disponibilidad onHand/reserved/available/incoming/required/shortage,
      reservas active/released/consumed con caps por disponibilidad,
      shortage→PO (allocation), release con 3 gates + override auditado
- [x] Dominio puro `packages/domain/src/quality.ts` + tests (17):
      QualityIssue (7 categorías, open→resolved→verified con reopen),
      ReworkAction (rework/refabricate/scrap/accept_as_is con materialCost/
      laborMinutes), checklist QC por unidad (6 puntos de production-flow-v2
      §10) y gate evaluables con override de supervisor
- [x] PO extendida (OC-052/053): `unitCost` snapshot + `allocatedProjectId`
      por línea, `requiredBy`/`expectedAt` por OC, `poLineCost`/`poTotalCost`
- [x] Contracts: `materialPlanning.json` + `qualityStatuses.json` + parity
      TS (tests dominio) y Go (`materialPlanningParity_test.go`,
      `qualityParity_test.go`)
- [x] Backend Go: migraciones 000071 (projects.material_planning JSONB),
      000072 (projects.quality JSONB), 000073 (columnas PO); dominio espejo
      (validación shape/transitions + gates + PlanReservations/coverage);
      endpoints GET /materials + POST derive/reserve/release (SELECT FOR
      UPDATE, stock+plannings+POs en la tx, RBAC por evento, events en la
      misma tx), GET /quality + POST issue/transition/rework/qc/override;
      QC gate 409 en POST units advance (module_qc→packaged); PUT agregado
      deja de escribir materials_release (anti-smuggling OC-054); FIX
      paridad RBAC Go: quality_issue_reported/rework_started faltaban
- [x] Storage TS: mappers (planning/quality/PO campos nuevos) + métodos repo
      API (getMaterialPlanning/derive/reserve/release con
      MaterialsReleaseGateError, getQuality/report/transition/rework/qc/
      override) + POs locales guest con campos nuevos + tests roundtrip
- [x] UI: `MaterialPlanningPanel` (evidencia cobertura/shortage/gates con
      override) integrado en PurchasingScreen (botón "Planificar y liberar"
      abre el panel cuando hay datos), `QualityPanel` (issues + rework con
      costing + checklist QC + override supervisor) en estación packaging de
      FabricScreen, QC gate espejo en `advanceModuleUnitLocal`, wiring
      AppContent (runMaterialPlanningAction/runQualityAction: API→endpoint,
      local→acción pura), `roleCanSuperviseFloor` TS (paridad Go)
- [x] Docs: `docs/project-lifecycle.md` §4.5/§4.6 — eventos de materiales
      ahora emitidos por el subproceso + eventos de calidad documentados
- [x] Verificación completa

## Verificación (evidencia)

- `pnpm --filter @muebles/domain test`: **875 tests** OK (+22 planning, +17 quality)
- `pnpm --filter @muebles/storage test`: **147 tests** OK (+4 roundtrip planning/quality/PO)
- `pnpm --filter @muebles/ui test`: **1186 tests** OK (+13: MaterialPlanningPanel 6 + QualityPanel 7)
- `pnpm test` monorepo OK (web 301 · mobile 45 · desktop 17 · excel 89)
- `go test ./...`: OK — parity fixtures, gates OC-054 (release sin evidencia
  409 con checks; override audita ambos eventos), reserve caps+shortage,
  handlers quality (issue/transition/rework con efecto físico/scrap/QC/
  override), QC gate bloquea packaging (409 con checks) y pasa con checklist
  aprobado, issue abierto bloquea, smuggling de materials_release por PUT
  agregado ya no es posible (columna fuera del UPDATE)
- `pnpm typecheck` monorepo: OK

## Notas de diseño

- Planning y quality como JSONB por obra (`projects.material_planning`,
  `projects.quality`), patrón F137; escrituras SÓLO por endpoints dedicados
  (el PUT agregado lee pero no escribe; planning ni siquiera viaja en el PUT
  — los handlers son acciones, no replace).
- `materials_ready` ahora se emite live (antes sólo backfill); release sin
  gates requiere override con motivo → emite `materials_release_overridden`
  antes de `materials_ready` y guarda failingChecks.
- Reserve server-side computa caps contra stock−reservas de TODAS las obras
  dentro de la tx (SELECT FOR UPDATE de la fila del proyecto + lectura de
  plannings/stock/POs en la misma tx).
- QC gate: `module_qc → packaged` exige checklist aprobado + sin issues
  abiertos por unidad/mueble; override de supervisor (RoleCanSuperviseFloor,
  paridad TS↔Go nueva) habilita auditadamente; espejo local en el store para
  modo offline.
- Allocación a obra por línea de PO (`purchase_order_items.allocated_project_id`):
  incoming por obra = Σ remaining de líneas allocadas.
- Conocido-postergable: consumo de reservas al despachar picking
  (`consumePlannedMaterials` existe en dominio, falta cablear en
  purchasingStore.togglePick) — no bloquea el DoD del issue.

## Estado

Implementada y verificada. Pendiente: review.
