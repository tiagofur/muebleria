# Sesión cerrada: Issue #302 — Operational Core O3: MRP ligero, reservas, compras, QC y retrabajo

**Fecha:** 2026-08-21
**Feature:** F138 — `operational_core_o3` — **done**
**Rama:** `feat/f138-mrp-qc` (pusheada)

## Resumen

OC-050..OC-054 + OC-060..OC-062 implementados de punta a punta: requerimientos
desde el BOM liberado (sin heurísticas), disponibilidad honesta de 6 cantidades,
reservas con caps, shortage→PO con allocation/costos/fechas, liberación con
evidencia y override auditado; QualityIssue/ReworkAction con job costing y
efecto físico, checklist QC por unidad y gate server-side antes de empaquetar.

- Dominio TS puro + contracts de paridad TS↔Go (materialPlanning,
  qualityStatuses) con tests espejo.
- Backend Go: migraciones 000071–000073, endpoints server-authoritative con
  SELECT FOR UPDATE + eventos en la misma tx, QC gate 409 en advance unit,
  anti-smuggling de materials_release en el PUT agregado, fix de paridad RBAC
  de eventos de calidad.
- Storage TS (mappers + repo API + POs guest) y UI (MaterialPlanningPanel en
  Almacén, QualityPanel en Embalaje, wiring store/AppContent).

Review: CHANGES_REQUESTED (3 defects menores) → aplicados → **APPROVED**
(ver `progress/review_F138.md` y `progress/history.md`).

## Verificación final

domain 875 · storage 147 · ui 1186 · web 301 · mobile 45 · desktop 17 ·
excel 89 · `pnpm typecheck` OK · `go test ./...` OK.

## Deuda registrada (no bloquea el DoD del issue)

- R2 review F138: cablear `consumePlannedMaterials` al despacho de picking
  (`purchasingStore.togglePick`) para consumir reservas al despachar.
- R1 review F138: marcar `≈` en líneas de tableros de la cobertura (la
  estimación de planchas ya está rotulada en su sección).
- F123 (pending, tests Compras/Almacén) solapa con esta área.
