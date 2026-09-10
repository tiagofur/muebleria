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

A pre-fix full `go test ./internal/storage` run exposed six artifact-finalization failures because that second publication entrypoint had not yet invoked the descriptor builder. The root cause was fixed in `FinalizeDesignPublish`; all six affected publish tests and the new storage suite passed afterward. The full 255-second storage suite was not rerun after the fix due the bounded handoff window, so no final full-storage claim is made. Final `./init.sh` was likewise not rerun; focused affected gates plus monorepo typecheck and real browser integration are the final evidence.

## Review focus

- `backend-go/internal/storage/design_revision_presentation.go`
- `backend-go/internal/storage/designs.go` and `design_publish.go`
- `backend-go/db/migration/000129_design_revision_read_model.*.sql`
- `contracts/openapi/granete-api.v1.yaml`
- `packages/ui/src/digitalThread/RevisionSnapshotItemsPanel.tsx`
- `tests/organization/project-designs.spec.ts`
