# #577 warehouse/reservations — implementation handoff

## Scope and authority

Base: `97636e18ac0b827e3b77522a0015d0198987e6aa`; branch: `codex/577-warehouse-reservations-continuity`. Parent publishes the final exact head. Authorization: #573 comment 5574451831, bounded to 1,000 authored lines excluding generated output.

Reserve and materials-release commands carry the existing exact `ProductionRelease.id`. Canonical planning must match the frozen release, design/quote, numbers, fingerprint and requirements. Existing planning owns reservation provenance; no new snapshot or release authority. Re-derivation cannot move any reservation history to another demand snapshot. Canonical beats a coexisting stale legacy blob; legacy-only commands remain supported.

## Reservation and transaction behavior

Explicit reservation lines are capped by remaining requirement demand and locked stock; duplicate lines share both caps. Explicit lines retain additive semantics within remaining demand. Reserve-all replay after coverage completes is a no-op with no duplicate reservation/event; repeated release conflicts without additional writes. Shortage is an audited partial/zero reservation, not an all-or-nothing stock promise.

The existing project transaction locks warehouse stock in stable material order before reading all project reservations. The locked query itself supplies stock quantities: newly inserted rows cannot enter an unlocked later read. Project planning, release stamp and audit share the existing tenant transaction; borrowed commit remains middleware-owned. Generic project UPDATE does not write material planning.

Canonical warehouse cards reuse the planning panel and its provenance instead of mutable catalog/BOM picking rows. Frozen board quantities remain sheets, not invented square meters. Canonical API commands never run local domain mutations, and session/plan/command guards discard stale results.

## Focused evidence

- `go test ./internal/storage -run 'TestWarehouseReservationsConcurrentProjects|TestProductionReleaseCaptureHTTPFrozen' -count=1`: PASS, 2.600s. Real authenticated HTTP/tenant transactions cover later design and project/catalog mutations, stale legacy, wrong/missing release/project, foreign read/reserve, shortage, project-update/audit-insert rollback, demand caps, reserve-all replay, stale planning and exact release audit. Legacy-only reservation also passes.
- `go test ./internal/storage -run TestWarehouseReservationsConcurrentProjects -count=3`: PASS, 3.192s; two projects cannot double-reserve one stock unit.
- `go test ./internal/api -run TestMaterials -count=1`: PASS. `go test ./internal/domain -run 'ReservationCaps|PlanReservations' -count=1`: PASS.
- Domain TS: 101 files / 1,281 tests PASS, including six shared reservation-cap scenarios. UI: 157 files / 1,624 tests PASS before the final additional canonical-card assertion; that assertion is rerun separately.
- `pnpm typecheck`, `pnpm openapi:check`, `git diff --check`: PASS. Generated files: Go OpenAPI `types.gen.go` and TS OpenAPI `types.ts`.
- External logs: `/Users/tiagofur/dev/carpinteria/work/577-warehouse-reservations/` (focused API/PG/concurrency, domain TS, UI, typecheck and OpenAPI logs).

## Required final gates and remaining scope

Final exact-head full Go/init, real React+Go+PostgreSQL browser gate, independent review and CI are PENDING at handoff; no approval claimed. The existing browser canonical flow now asserts exact reservation command identity and frozen readback before normal material release.

Part executions, machine outputs, full stage continuity and the single whole-#577 golden path remain outside this delivery. Canonical stage entry already works without the engineering timestamp; the project-level materials-release stage seam is unchanged. #577 stays open; no merge is authorized.

Rollback boundary: revert this warehouse command/read-model unit and its tests/generated request schemas together; no migration or independent inventory model was added.

## Bounded independent-review correction

The single authorized correction suppresses legacy empty-state claims while a canonical card is visible, with a three-material-tab UI regression. The real browser fixture now checks canonical card/provenance/reservation controls at 390, 768 and 1280 px, saving synthetic screenshots only when an absolute `WAREHOUSE_VISUAL_DIR` is explicitly supplied. Final new-head full gates, screenshot inspection and re-review remain pending; earlier passing evidence does not approve the corrected head.
