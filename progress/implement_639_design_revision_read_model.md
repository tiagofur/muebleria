# Issue #639 implementation handoff

## Binding

- Base: `origin/main@55399890173e76b3ae30d858ec9a9472bcd78ab1`
- Branch: `fix/639-design-revision-read-model`
- Exact verified implementation commit: `e7f7e528`
- Product diff: 32 files, 1,707 insertions, 222 deletions (includes generated OpenAPI and exploration evidence).
- Delivery state: `IMPLEMENTED_PENDING_REVIEW`; no PR, issue, label, merge, or close mutation was performed.

## Delivered

- Migration `000129` adds nullable server-owned working/revision material source metadata, immutable versioned presentation snapshots, and frozen publication/approval actor labels. Legacy rows are deliberately not backfilled.
- Go publication and SketchUp artifact finalization build descriptors inside the existing tenant transaction; approval freezes its actor label in the lifecycle transition. Reset preserves provenance without copying presentation state into the mutable working copy.
- Definition, semantic parameter, room, material name/code/thickness, and provenance descriptors are frozen. Direct authored/quoted sources, canonical front aliases as inherited defaults, and unresolved evidence remain distinct.
- OpenAPI source plus generated Go/TypeScript clients expose explicit `available|unavailable_legacy` descriptor state; API maps only frozen snapshot data.
- React uses human-readable revision cards; raw IDs are hidden in a keyboard-accessible technical disclosure with copy controls. Historical URL selection remains exact across refresh. Browser proof captures 390/768/1280 widths.
- Canonical architecture and UX documents describe ownership, immutability, and the legacy policy.

## Verification

PASS:

- `pnpm openapi:check`
- `pnpm --filter @granete/storage test` — 191/191
- `pnpm --filter @granete/ui exec vitest run src/digitalThread/ProjectDesignsScreen.test.tsx src/digitalThread/RevisionSnapshotItemsPanel.test.tsx` — 35/35
- `pnpm --filter @granete/ui typecheck`
- `pnpm typecheck`
- `go test ./internal/domain ./internal/domain/engine ./internal/api`
- Focused real-PostgreSQL storage publication, artifact-finalization, provenance, fresh/upgrade/down migration, immutability, rename stability, approval, and legacy tests.
- `scripts/organization-browser-gate.sh tests/organization/project-designs.spec.ts` — Chromium + Go + PostgreSQL, 1/1, including exact R1/R2 refresh and 390/768/1280 descriptor captures.
- `git diff --check`

A pre-fix full `go test ./internal/storage` run exposed six artifact-finalization failures because that second publication entrypoint had not yet invoked the descriptor builder. The root cause was fixed in `FinalizeDesignPublish`; all six affected publish tests and the new storage suite passed afterward.

Independent coordinator readback then ran final `./init.sh` against implementation commit `e7f7e528`: monorepo typecheck and TypeScript tests passed, `go test ./...` passed including `internal/storage` in 275.263s and `tests/pilotreadiness` in 243.523s, and the Ruby/RBZ gate passed with 643 runs / 4,440 assertions plus the 6-run distribution check. This closes the earlier full-suite evidence gap.

## Review focus

- `backend-go/internal/storage/design_revision_presentation.go`
- `backend-go/internal/storage/designs.go` and `design_publish.go`
- `backend-go/db/migration/000129_design_revision_read_model.*.sql`
- `contracts/openapi/granete-api.v1.yaml`
- `packages/ui/src/digitalThread/RevisionSnapshotItemsPanel.tsx`
- `tests/organization/project-designs.spec.ts`

## PR #646 correction round 1

Reviewed head: `d359ca305b5de0627a765c192795e322c4ed85b4`. This is the single authorized correction round.

Corrections applied:

- Updated the Foundation project-pairing consumer from the removed table test ID to the semantic revision item list/article contract.
- Added storage-level table coverage for `authored`, `quoted`, `inherited_default`, and `unresolved` presentation provenance.
- Strengthened the real browser fixture with a persisted board material and site-survey room. Chromium now asserts frozen module name/code, parameter label/unit, material name/code/thickness/provenance, room and actor; it also proves keyboard activation/focus and verifies every inspector/list/card edge stays inside the 390/768/1280 viewports with zero document overflow.
- Restored the exact pre-000129 RLS inventory rationale and policy version in the down migration, with fresh and upgrade/down assertions.
- Reconciled the disclosure with the design system: `btn--small`, `--weight-semibold`, hover/focus-visible/active states, and focused semantic disclosure coverage.
- Corrected `belong inonly in` to `belong only in`.

Correction evidence:

- `go test ./internal/storage -run 'TestPresentationMaterialProvenanceCoversAllServerOwnedStates|TestDesignRevisionReadModelMigrationFreshUpgradeAndDown' -count=1` — PASS.
- Focused UI (`RevisionSnapshotItemsPanel` + `ProjectDesignsScreen`) — 35/35 PASS.
- `scripts/organization-browser-gate.sh tests/organization/project-designs.spec.ts` — Chromium + Go + PostgreSQL 1/1 PASS.
- `pnpm gate:foundation:a` — PASS: OpenAPI drift, monorepo typecheck/tests, deployment 31/31, PostgreSQL/RLS/API/fresh/upgrade/atomic proofs, Pilot Readiness, and all 31 Chromium cases including both project-design and project-pairing paths; final gate reports 34/34 Foundation scenarios executable.
- `git diff --check` — PASS.
