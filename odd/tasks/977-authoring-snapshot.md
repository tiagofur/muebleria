# #977 — Snapshot de autoría al eliminar: re-colocar no debe perder acabados

## Objective and authority

Owner report 2026-10-02: deleting a furniture unit in SketchUp and re-placing it lost the chosen finishes (and dimensions) — the unit re-entered as catalog defaults. Diagnosis confirmed in code + live data: the authored state (material choices, #784 lineage modes, parameters) lived ONLY in the design working item (#810 Caso 1 delete intent drops it ~1.5s after the delete via auto-sync) and in the deleted entity's metadata. The surviving FurnitureInstance carried no authored finishes (display choices derive from a quote line; unquoted projects have none). Tracked in [#977](https://github.com/tiagofur/muebleria/issues/977). Option A approved by the owner: snapshot on the instance.

## Tasks

- [x] T1 — Migration `000148_furniture_instances_authoring_snapshot`: `furniture_instances.authoring_snapshot jsonb` ({parameters, material_choices, material_choice_modes}). Column only — ownership/RLS/grants inherited from 000111. Renumbered from 000147 (main already carried `000147_hardware_profiles_platform_read` from #973).
- [x] T2 — `UpdateDesignWorkingCopy` (the SketchUp sync path): previous items now load parameters too; every previous item ABSENT from the new set is the conscious delete intent → its authoring state is snapshotted onto the instance in the SAME transaction. `version`/`updated_at` untouched (internal plumbing — a background sync must never poison a concurrent instance command's If-Match). Reset-to-revision does not snapshot (discarding authoring is conscious; only the update command writes).
- [x] T3 — API: `authoring_snapshot` optional on FurnitureInstance (OpenAPI + regenerated Go/TS DTOs, `pnpm openapi:check` clean); the summaries list query (the exact endpoint the placement flow consumes) selects/scans it; malformed capture fails closed.
- [x] T4 — SketchUp: fail-closed contract parse (`parse_authoring_snapshot!`, unknown lineage mode raises); `placement_inputs` now returns [parameters, choices, modes] — the modes always ride the SAME source that won the choices (pending intent / live item / snapshot). Live item still wins over the snapshot; snapshot parameters are verbatim (recovery_placement_parameters, same trust as #870), snapshot choices overlay the frozen quoted base (#821 R1 rule), snapshot modes ride the intent so the re-added item keeps its #784 lineage.

## Evidence (2026-10-02)

- Go storage (`scripts/backend-test.sh`, ephemeral PostgreSQL + RLS roles): `TestUpdateDesignWorkingCopyDroppedItemSnapshotsAuthoringState` (drop → snapshot verbatim; version/updatedAt unchanged) and `TestUpdateDesignWorkingCopyKeptItemWritesNoSnapshot` — both PASS; migration 000148 applies on the fresh path.
- Ruby: `rake verify` full pass (syntax/lint/unit/boundary + deterministic rbz sha256 `a0880113…`), including the new placer-level repro test (delete → empty working copy → place: finishes, modes and 650mm dims survive from the snapshot), the live-item-wins test, and the fail-closed contract parse test.
- `pnpm openapi:check` (no drift), `pnpm -r typecheck` (all packages, generated TS types compile), `go build ./... && go vet ./internal/...` clean.

## NOT_RUN / deferred

- Browser proofs + full Go/storage shards: covered by CI on the PR head.
- Live host (SketchUp) round trip: NOT_RUN — the placer-level test drives the real place flow against a stubbed transport; an owner smoke (delete → wait for sync → re-place → finishes present) validates the end-to-end timing after merge.
- Main's pre-existing browser regression (hardware-3d-catalog, from #971) is a separate issue, untouched here.
