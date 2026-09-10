# Issue #639 — immutable DesignRevision presentation read model

## Decision

Issue #639 is valid, but it is **not a single-PR change**. The smallest historically honest solution is an additive, server-authored presentation snapshot captured in the same transaction as publication, plus server-owned per-role material-source metadata carried from the working copy. Reading an old revision must never join the mutable current catalog to manufacture historical labels.

Exact exploration base: `origin/main@55399890173e76b3ae30d858ec9a9472bcd78ab1` on `fix/639-design-revision-read-model`.

## Non-obvious blocker in the current model

`design_working_items.material_choices` and `design_revision_items.material_choices` are plain `role -> material UUID` maps. PR #638 reconciles a quoted choice into that same map. After the write, a later publisher cannot distinguish a user-authored choice from a quoted/reconciled choice. Therefore equality with the current catalog or current quote is not honest provenance.

The implementation must preserve a server-owned `role -> authored|quoted` source map in the working copy. Rules:

1. preserve the existing source for an unchanged choice;
2. a new or changed value received through the generic authoring PUT is `authored`, except an initial quote-first value may be `quoted` only when it matches the exact immutable `Design.source_quote_revision_id` item;
3. `ReconcileDesignWorkingMaterials` writes `quoted` for the roles it fills;
4. a legacy working/revision choice without source metadata remains `unresolved_legacy`; never relabel it as authored;
5. publication freezes the source map and expands it through the authoritative material-role resolver.

This is read-model provenance, not permission for the browser to calculate materials.

## Minimum immutable model

### Revision header

- Keep `created_by` and `approved_by` UUIDs as audit identity.
- Add frozen `created_by_display_name` at publication and `approved_by_display_name` during the exact approval transition.
- Capture names from `users.name` in the same transaction as the event. Do not expose email.
- A system publication has the explicit system actor presentation; it is not a catalog/user lookup fallback.

### Revision item presentation snapshot

Persist one nullable, versioned JSONB `presentation_snapshot` on each `design_revision_item`:

```text
schemaVersion: 1
unit: label, unitIndex?, unitTotal?
definition: code?, name?
parameters[]: key, label?, type?, value, unit?, state
materials[]: role, roleLabel?, materialId?, code?, name?, effectiveThicknessMm?, provenance
room: id?, label?, state
```

Rules:

- `unit.label` is a frozen business label built from the definition name/code and a deterministic project-level occurrence ordinal; it is not a new business identity. `FurnitureInstance.id` remains the authority and stays in technical audit.
- Definition code/name come from the tenant catalog at publication time.
- Parameter label/type/unit come from the definition's typed `parameter_definitions`; legacy width/height/depth use the existing canonical dimension projection. Values are copied from the exact item. Unknown legacy keys are retained with `state=unavailable`, not given invented labels.
- Material roles are enumerated and resolved by the existing Go layout/material-role path (`ResolveFurnitureLayout`, including the explicit legacy alias contract), not by a new UI resolver. Freeze role code/label, material UUID/code/name and the same effective thickness used by the resolver.
- Provenance is `authored`, `quoted`, `inherited_default`, or `unresolved`. A direct choice uses the server-owned source map; an explicit alias/default resolution is `inherited_default`; missing/unknown material evidence is `unresolved`.
- Resolve a room label only by an exact `room_id` match in an authoritative project space source available in the publication transaction (currently `projects.site_survey.spaces`). Otherwise freeze `state=unavailable`; do not treat a UUID-like ID or arbitrary current Proyectar label as historical truth.
- A catalog/room/actor rename or deletion after publication cannot change the snapshot.

JSONB is preferable to a new parallel read table: it is part of the immutable revision item, follows the same project ownership, and avoids a second joinable aggregate. Decode it into strict Go domain types; unknown schema versions or malformed snapshots fail closed.

## Legacy policy

- Migration performs **no business-data backfill** and never updates R1–Rn.
- `presentation_snapshot IS NULL` means `unavailable_legacy`, not an empty valid snapshot.
- API always exposes an explicit descriptor state. For legacy rows it returns technical snapshot fields plus `descriptor_state=unavailable_legacy`; display data is absent.
- React shows `Descripción histórica no disponible` and keeps raw IDs only under `Detalles técnicos de auditoría` with copy affordances.
- No read path consults the current module/material/room/user rows for a legacy revision. A separately marked current-catalog projection is intentionally excluded from the minimum implementation.

## Persistence and RLS

Proposed additive migration: `000129_design_revision_read_model`.

- `design_working_items.material_choice_sources JSONB NULL` (server-owned; null is legacy unknown).
- `design_revision_items.material_choice_sources JSONB NULL` and `presentation_snapshot JSONB NULL`.
- `design_revisions.created_by_display_name TEXT NULL` and `approved_by_display_name TEXT NULL`.
- JSON shape constraints (`object`) and trimmed/non-empty display-name checks when non-null.
- Extend the revision immutability trigger so `created_by_display_name` cannot change and `approved_by_display_name` can only be written with the existing `published -> approved` transition. The item trigger already blocks every update/delete.
- No new table or grants. These columns inherit the existing `explicitly-shared / project-organizations` RLS scope and immutable owner-write policy. Update `rls_policy_inventory` rationale/version and prove direct-SQL cross-org denial.
- Down migration restores the previous trigger body before dropping columns.

## Exact implementation surface

### Domain and persistence

- `backend-go/db/migration/000129_design_revision_read_model.{up,down}.sql`
- `backend-go/internal/domain/design.go`
- new `backend-go/internal/domain/design_revision_presentation.go`
- new `backend-go/internal/domain/design_revision_presentation_test.go`
- `backend-go/internal/storage/designs.go`
- `backend-go/internal/storage/design_approval.go`
- `backend-go/internal/storage/design_material_provenance.go`
- new `backend-go/internal/storage/design_revision_presentation.go`
- new `backend-go/internal/storage/design_revision_presentation_test.go`
- new `backend-go/internal/storage/design_revision_read_model_migration_test.go`

Publication must build and insert the descriptor snapshot before returning the revision. Approval must capture the approver label in the same transaction. Reset copies source metadata but never copies a presentation snapshot into mutable state.

### Generated API

- `contracts/openapi/granete-api.v1.yaml`
- generated `backend-go/internal/api/openapi/generated/**`
- generated `packages/storage/src/openapi/generated/**`
- `backend-go/internal/api/designs.go`
- `backend-go/internal/api/designs_test.go`
- generated-client/contract drift tests under `packages/storage/src/openapi/`

Add explicit generated schemas for descriptor state, actor, unit, definition, parameter, material, room and provenance. Extend `DesignRevision`/`DesignRevisionItem`; do not create a handwritten React DTO.

### React presentation

`ProjectDesignsScreen.tsx` is already 1,286 lines, so it must remain an orchestrator. Extract:

- new `packages/ui/src/digitalThread/RevisionSnapshotItemsPanel.tsx`
- new `packages/ui/src/digitalThread/revisionSnapshotPresentation.ts`
- new colocated tests for both files
- new `packages/ui/src/digitalThread/revisionSnapshotItems.css`
- minimal wiring in `packages/ui/src/digitalThread/ProjectDesignsScreen.tsx`
- actor/header assertions in `ProjectDesignsScreen.test.tsx`
- `tests/organization/project-designs.spec.ts`
- architecture notes in `docs/architecture/project-design-digital-thread.md` and `docs/architecture/sketchup-backend-web-integration-excellence.md`; UI presentation rule in `docs/design.md`

Primary rows show unit label, definition name + code, semantic dimensions/parameters, material name + code + thickness + provenance, and room label. UUIDs, locators and raw maps remain in the technical disclosure. React only formats already frozen typed values; it never resolves catalog identity or material provenance.

## Required proof

### Pure/domain

- deterministic unit ordinals and stable ordering;
- typed parameter labels/units and unknown-key state;
- authored/quoted source preservation, explicit alias inheritance and unresolved roles;
- same material resolver/effective thickness as canonical layout;
- malformed/unknown snapshot schema fails closed.

### PostgreSQL/storage

- fresh migration, representative upgrade and down;
- pre-migration revision remains null/unavailable without invented backfill;
- new publication freezes all descriptors atomically;
- module/material/room/user rename or deletion after publication leaves Rn unchanged;
- approval freezes approver display name exactly once; replay does not rewrite it;
- #638 reconciliation marks filled roles quoted; later explicit authoring changes only the changed role to authored;
- item/revision immutability trigger proof;
- owner/shared read and foreign-organization direct-SQL denial under runtime role.

### API/UI/browser

- `pnpm openapi:generate` followed by `pnpm openapi:check`;
- generated Go/TS shapes and mapper tests for frozen and legacy states;
- React behavior/a11y tests: no UUID as primary label, honest legacy copy, provenance text not color-only, technical disclosure keyboard access, exact historical selection retained;
- real Chromium + Go + PostgreSQL E2E at 390/768/1280 px: names/codes/dimensions/materials/actors, no overflow, refresh stays pinned to the selected revision;
- affected Go suites, `pnpm --filter @granete/storage test`, `pnpm --filter @granete/ui test`, `pnpm typecheck`, final `./init.sh`, and exact-head CI.

## Size and delivery strategy

Honest estimate, excluding generated output: **1,650–2,250 authored changed lines**. OpenAPI generation likely adds another **350–600 mechanical changed lines**. A single PR cannot fit the 400-line review budget.

Use one strategy only: **sequential stacked PRs to `main`**, each independently backward-compatible. Partial slices use `Refs #639`; only the final integration PR uses `Closes #639`.

1. **Persistence + strict snapshot/source types** — migration, immutable/legacy contract, codec and migration/domain tests. Estimate 300–380 authored lines.
2. **Authoritative descriptor builder** — parameter/material/room/unit projection and pure tests, reusing the existing resolver. Estimate 320–400 authored lines.
3. **Atomic publication/approval capture** — storage wiring, #638 source preservation and PostgreSQL/RLS/immutability proofs. Estimate 350–430 authored lines; if the focused proofs exceed 400 after one honest split, request a narrow test-heavy `size:exception` rather than compressing tests.
4. **Generated API projection** — OpenAPI, mapper/client and contract tests. Estimate 220–300 authored lines; generated diffs may force a clearly labeled `size:exception` because generated Go/TS cannot be split from their source contract.
5. **Reusable revision presentation component** — extracted panel/helper/CSS with component and a11y tests, not additional inline screen bulk. Estimate 320–400 authored lines.
6. **Screen integration + real browser proof + docs** — minimal screen/header wiring, exact-selection E2E at all viewports and final canonical documentation. Estimate 220–340 authored lines.

This chain keeps every decision reviewable, avoids an inert shadow read model, and isolates the only likely size exceptions to cohesive storage proof or generated output.

## Out of scope

- Updating any published revision in place.
- Current-catalog lookup presented as historical truth.
- Artifact availability, Proyectar/SketchUp convergence, QuoteRevision exports or browser `.skp` parsing.
- Any UI calculation of material resolution/provenance.
