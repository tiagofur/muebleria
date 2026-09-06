# Implementation Report — #571 Commercial QuoteRevision Lifecycle (P0 DEMO BLOCKER)

- **Date**: 2026-09-06 America/Mexico_City
- **Issue**: #571 — `[P0][WEB-DT-4] Commercial QuoteRevision lifecycle — create, publish and accept exact revisions` (child of #396)
- **Priority**: P0 DEMO BLOCKER (origin: `docs/demo/demo-golden-path-rehearsal-20260906.md`)
- **Base SHA**: `fb8610a1644358edbe7362122110b6dab0e9a01d` (PR #570 merged into `main`)
- **Status**: Complete & Verified

---

## 1. Problem & Finding
The 2026-09-06 Demo Golden Path Rehearsal identified that while Granete could requote, reconcile, approve, and release exact revisions, a real user had no supported HTTP or Web mechanism to:
1. Create the initial commercial revision (Q1) from the project's editable state.
2. Publish Q1.
3. Accept Q1.
4. Publish Q2 (after requote).
5. Accept Q2 (superseding Q1).

As a consequence, the Playwright browser E2E test (#502) was relying on direct SQL insertions using the migration superuser role (`seedAcceptedQuoteRevision` and `seedAcceptanceForNewestRevision`).

---

## 2. Implemented Architecture & Operations

### A. Database Invariant & Storage
- **Accepted Uniqueness**: Added migration `000121_quote_revision_accepted_uniqueness.up.sql` defining partial unique index `uq_quote_revisions_one_accepted_per_project` ON `quote_revisions (project_id) WHERE status = 'accepted'`.
- **Atomic Acceptance & Supersede**:
  - In `backend-go/internal/storage/quote_lifecycle.go`, `AcceptQuoteRevision` executes inside a tenant transaction with project row locking (`SELECT id FROM projects WHERE id = $1 FOR UPDATE`).
  - When transitioning a revision to `accepted`, any previously accepted revision for the project is atomically updated to `status = 'superseded'` in the same transaction before updating the target row.
  - `UpdateQuoteRevisionStatus` in `backend-go/internal/storage/reconciliation.go` was updated to mirror this atomic supersede invariant.
- **Initial Quote Snapshot Authority**:
  - `CreateInitialQuoteRevision` converges physical units per quote line (`MaterializeQuoteLine`, idempotent #386) and snapshots each unit's commercial definition and parameters (`custom_dims` or catalog module dimensions `widthMm`, `heightMm`, `depthMm`).
  - Strict separation of commercial and authoring truth: Q1 represents what was quoted, preserving physical unit identity (`FurnitureInstance.id`) for exact reconciliation against subsequent design revisions.
- **Exact Project Scoping & Tenant Isolation**:
  - All operations validate exact `projectId` and `quoteRevisionId`. Mismatches return uniform 404 to avoid information leaks.
  - Multi-org access controls enforce owner organization write authority; non-owning organizations with shared read access receive 403 `ErrFurnitureInstanceProjectNotWritable`.
- **Durable Audit**:
  - Operations record `quote_revision_created`, `quote_revision_published`, `quote_revision_accepted`, and `quote_revision_superseded` events inside the same transaction.

### B. Generated API & OpenAPI
- Updated `contracts/openapi/granete-api.v1.yaml` with:
  - `POST /projects/{projectId}/quote-revisions`: `createInitialQuoteRevision`
  - `POST /projects/{projectId}/quote-revisions/{quoteRevisionId}:publish`: `publishQuoteRevision`
  - `POST /projects/{projectId}/quote-revisions/{quoteRevisionId}:accept`: `acceptQuoteRevision`
- Added RBAC capability `RoleCanAcceptQuoteRevisions` / `roleCanAcceptQuoteRevisions` assigned to owner, admin, and sales roles.
- Handlers in `backend-go/internal/api/quote_lifecycle.go` and routes in `backend-go/internal/api/routes.go`.
- OpenAPI client regenerated without drift (`pnpm openapi:generate` and `pnpm openapi:check`).

### C. Web UI & Disambiguation
- **Reconciliation Workspace**:
  - When no revisions exist, renders an explicit CTA: `Crear revisión de cotización (Q1)`.
  - Added `QuoteLifecyclePanel` in `packages/ui/src/digitalThread/ReconciliationCommandPanels.tsx`:
    - Shows current revision status badge (`Borrador`, `Publicada`, `Aceptada`, `Reemplazada`).
    - Contextual action buttons: `Publicar Q1/Q2` and `Aceptar Q1/Q2`.
  - Added `AcceptQuoteModal` requiring confirmation and explicitly warning that accepting Q2 will supersede Q1 while preserving it in historical records.
- **Legacy Project Status Disambiguation**:
  - Relabeled legacy project status buttons in `ProjectDetailHeader.tsx` and `ProjectDetailView.tsx` from "Aceptar cotización" to "Marcar estado comercial (obra)" with explanatory tooltips to prevent confusion with `QuoteRevision` authority.

---

## 3. Verification & Evidence
1. **OpenAPI & Types**:
   - `pnpm openapi:check`: PASS (clean spec).
   - `pnpm typecheck`: PASS (0 errors across all 7 packages).
2. **Go Suite**:
   - `go test ./internal/api ./internal/storage`: PASS.
3. **Web & UI Unit Tests**:
   - `packages/ui`: 1597 tests passing (including 36 tests in `ProjectReconciliationScreen.test.tsx`).
4. **Browser + PostgreSQL E2E Gate**:
   - `tests/organization/project-reconciliation.spec.ts`: Direct SQL insertions (`seedAcceptedQuoteRevision` and `seedAcceptanceForNewestRevision`) completely removed.
   - Tested full commercial golden path via UI: Create Q1 draft -> Publish Q1 -> Accept Q1 -> Requote -> Publish Q2 -> Accept Q2 (atomic supersede of Q1) -> Approve exact R2 against Q2 -> ProductionRelease P1.

---

## 4. Remaining Scope
- **P0-2 Remains Open**: Canonical `ProductionRelease` -> BOM/warehouse/operations derivation (operational bridge) is intentionally deferred to its dedicated issue.
- **#499 & #503**: Web<->SketchUp pairing and machine evidence are intentionally out of scope.
