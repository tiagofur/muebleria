# ODD 1215 — Guard de herraje en uso + copy veraz

## Outcome

Implemented the approved scope of issue #1215 on `fix/1215-hw-inuse-guard`
(base `origin/main` @ `b3fe8978`): an active→false transition on a referenced
hardware is refused with 409 and reference counts, from both write paths
(catalog PUT and soft DELETE); the catalog-save error toast surfaces business
4xx server messages; the deactivate confirm dialog copy no longer claims that
furniture keeps a copy of the hardware.

## Scope

- `backend-go/internal/storage/materials.go` — `ErrHardwareInUse` sentinel,
  `countHardwareUsage` (hardware_lines, project_item_choices,
  project_level_choices, design_revision_hardware_assets — the clean_demo
  reference families), guard in `UpdateHardware` (transition only) and
  `DeactivateHardware`.
- `backend-go/internal/api/catalog_handlers.go` — 409 mapping via
  `errors.Is` in the PUT and DELETE cases.
- `contracts/openapi/granete-api.v1.yaml` — DELETE `/catalog/hardware/{id}`
  declares 409 + operation description; regenerated artifacts byte-identical
  (`pnpm openapi:check` clean).
- `apps/web/src/stores/catalog/shared.ts` — patch error toast shows
  `GraneteApiError.message` for business 4xx (VERSION_CONFLICT warning kept).
- `packages/ui/src/catalogs/hardware/HardwareCatalog.tsx` — truthful confirm
  copy (reactivation via Inactivos filter, in-use refusal).
- Tests: `materials_hardware_in_use_guard_test.go` (PG real, disposable DB),
  catalogStore business-4xx toast test, HardwareCatalog copy test,
  `tests/organization/hardware-in-use-guard.spec.ts` (browser E2E).

Exclusions (issue #1215): engine fail-closed unchanged; no new reactivate
endpoint (UI toggle already reactivates via PUT); no guards for other
catalog families; #1168 scope untouched.

## Evidence

- V1 storage (PG real, ephemeral container via `scripts/backend-test.sh`):
  `TestHardware_InUseDeactivationBlocked` — PUT and DELETE refused with
  counts (1 línea / 2 elección / 1 activo), refused writes mutate nothing;
  unreferenced hardware deactivates; no-transition PUT and reactivation pass.
- V1 web: `pnpm typecheck` clean; `pnpm test` (all workspaces) green
  including the two new tests.
- V2 browser: `pnpm test:organization:browser
  tests/organization/hardware-in-use-guard.spec.ts` → 1 passed (8.9s):
  in-use refusal toast shows the counts, row rolls back; free hardware
  deactivates and reactivates through the Inactivos filter.
- Full `go test ./...` via `scripts/backend-test.sh`: run at freeze.

## Traps found (for recovery)

1. Fixture ids in org browser specs MUST be well-formed UUIDs: a malformed
   id in `GET /catalog/hardware/{id}` aborts the tenant transaction (22P02),
   the handler swallows it as 404, and the middleware surfaces
   "commit tenant transaction: commit unexpectedly resulted in rollback"
   as a 500.
2. `catalog-table` row actions reveal on hover — hover the row before
   clicking Desactivar/Reactivar (pattern from `hardware-3d-catalog.spec.ts`).
3. Toasts stack: assert with `getByTestId('ui-toast').filter({ hasText })`.
4. Status chips collide by substring ("Activos" ⊂ "Inactivos") — use
   `exact: true`.

## Delivery

Work-unit commits (backend guard + contracts; web toast + copy + tests;
browser spec). PR `Closes #1215`, `Delivery: complete`, base `main`, label
`type:bug`. Independent review before human merge.
