# ODD — #875 [P1][WEB-MFG] Factory self-service construction settings and component connection editor in React

**Issue**: https://github.com/tiagofur/muebleria/issues/875  
**Title**: [P1][WEB-MFG] Factory self-service construction settings and component connection editor in React  
**Status**: IMPLEMENTED_PENDING_REVIEW — Delivery: **partial** (independent review 2026-09-30: CHANGES_REQUESTED against the complete claim; blockers corrected, remaining scope explicit in §3)  
**Lane**: ODD  
**Base**: `main` @ `faa5449b249eb59d80568ff622249cae1b14be15`  
**Branch**: `feat/875-factory-construction-settings`  
**Writer**: tiagofur  

---

## 1. Outcome

Provide a self-service industrial construction policy and component connection editor entirely within the React web application so that workshop/factory administrators can configure their assembly methods (screws, dowels, minifix, stations, margins) on top of the shared Granete Standard library without editing every cabinet definition or requiring manual Granete intervention.

Required user-facing surfaces:
1. **Config → Fabricación / Ingeniería → Construcción y uniones** (`packages/ui/src/settings/`): Global factory policy governing compatible cabinet assemblies (floor-to-side, top-to-side, back-panel, shelves) via the factory's manufacturing overlay.
2. **Componentes → Editar → Construcción** (`packages/ui/src/components/editor/`): Component-level construction role, connection faces/edges, connection families, and component-specific recipe overrides with explicit scope and "Restaurar herencia".

---

## 2. Architecture & Authority Boundaries

- **`docs/architecture/factory-construction-and-joinery.md` (C1–C4, V1, E1)**: Authoritative architectural specification.
- **`#775` (Overlay persistence)**: The factory's construction selections live inside `library_overlays.overrides` under the `joint.` namespace under PostgreSQL RLS and the organization tenant boundary. Never in `StoreCatalogOverlay` (sales/commercial only) or browser `localStorage`.
- **`#874` / `#496` (Contacts, recipes & resolver)**: The Go engine and TS domain resolvers resolve connections and station coordinates; React renders options, previews, and diagnostics from the backend without calculating alternative drilling coordinates or geometry hacks.
- **Inheritance & Immutability**:
  - Granete Standard (`00000000-0000-0000-0001-000000000001`) is immutable upstream.
  - Overlays store only intentional deltas for the specific factory organization.
  - Activating a new policy sets the default for new contexts; existing projects/releases remain pinned to their exact historical revisions.
  - "Restaurar herencia" deletes the override key, allowing the value to fall back cleanly to the upstream Standard default.

---

## 3. Acceptance Criteria (from Issue #875) — state after independent review 2026-09-30

The first candidate claimed `Delivery: complete`; the independent review
(`CHANGES_REQUESTED`, PR 943 comment) demonstrated the claim outran the
evidence. Delivery is **partial**: the rows below separate what this PR
demonstrates from what remains open.

Demonstrated in this PR:

- [x] Factory A configures screw-only/4-stations self-service and persists it to ITS overlay; Factory B's overlay stays untouched — real browser against Go + disposable PostgreSQL (`tests/organization/factory-construction-settings.spec.ts`, 4/4), reload-proof persistence.
- [x] Compatible component inherits the factory policy; a component-level override flips the provenance badge to *Componente (Excepción)* and "Restaurar herencia" returns to the inherited value (UI model + e2e).
- [x] Overlay access is organization-scoped by the caller's token (never a client-supplied org), 404-vs-null semantics pinned, RLS below (#775).
- [x] Accessibility, loading/error/saving states and Spanish copy with one contextual primary action.
- [x] Cross-tenant: another organization's overlay is invisible (same null response), pinned by handler tests.

Remaining open (why this is partial):

- [ ] **Resolver consumption — the core of the issue**: the saved policy never reaches `deriveAuthoringMachining`/resolve; per the issue, "a form that saves JSON but does not affect the resolver does NOT complete this issue". The next slice must wire the effective policy (pinned overlay) into joinery resolution and demonstrate A=4/B=2 machining differences (AC12/AC01 "obtain their respective results").
- [ ] Component-level exception persistence: the component override is UI state; it needs a server-side save path (AC03 persistence).
- [ ] Concurrent-editor conflict proof: the save is a read-modify-write PATCH; a visible-conflict (If-Match/version) test is missing (AC07).
- [ ] Draft vs activate lifecycle (AC: invalid draft saveable, not activatable; activation semantics over history).
- [ ] Second authorized user / visitor-sales permission matrix over these surfaces.
- [ ] User/support documentation reproducing the A/B case.

---

## 4. Negative Proof (Tests/Review must fail if)

- React writes raw JSON into an arbitrary field instead of the structured construction policy.
- A factory customization mutates Granete Standard definitions directly.
- Commercial `StoreCatalogOverlay` or user personal preferences are used as a backdoor for manufacturing construction rules.
- "Restaurar herencia" duplicates the current effective value as a hidden override instead of removing the override key.
- Changing an organization's policy silently rewrites existing historical projects, quotations, or published production releases.
- Cross-tenant requests can read or mutate another factory's overlay.

---

## 5. Tasks Breakdown

- [x] **T1: Domain Models & Schemas (`packages/domain`)**
  - Define typed `FactoryConstructionPolicy`, `JointFamilyRule`, `BackPanelFamilyRule`, `ComponentConstructionOverride` interfaces and validation helpers in `packages/domain/src/factoryConstructionPolicy.ts`.
  - Comprehensive unit tests in `packages/domain/src/factoryConstructionPolicy.test.ts`.
- [x] **T2: Backend Active Overlay API (`backend-go`)**
  - Added `GET /api/manufacturing-libraries/overlays/active` to `contracts/openapi/granete-api.v1.yaml` and generated code.
  - Implemented `OverlayService.GetActiveOverlayByOrg` and `HandleGetActiveLibraryOverlay` in `backend-go/internal/api/overlay_handlers.go`.
  - Comprehensive unit tests in `backend-go/internal/api/overlay_handlers_test.go`.
- [x] **T3: Client & Storage Layer (`packages/storage`)**
  - Added `getActiveStandardLibraryOverlay` and `saveConstructionPolicy` to `GraneteApiClient` in `packages/storage/src/apiClient.ts`.
  - Tested in `packages/storage/src/apiClient.test.ts`.
- [x] **T4: React UI — Factory Construction Settings (`packages/ui/src/settings/`)**
  - Implemented `ConstructionSettingsSection.tsx` integrated in `SettingsScreen.tsx` under "Ingeniería y Producción" / "Construcción y uniones".
  - Shows overlay status, base release info, joint families (floor, top, shelf, back-panel) with station count inputs, margins, hardware system options, and "Restaurar herencia".
  - Tested in `packages/ui/src/settings/ConstructionSettingsSection.test.tsx`.
- [x] **T5: React UI — Component Connection Editor (`packages/ui/src/components/editor/`)**
  - Implemented `ComponentEditorJoineryPanel.tsx` in `packages/ui/src/components/editor/` as tab "Construcción".
  - Configures constructive role, connection surfaces, joinery system override, station count, and origin provenance badges (*Biblioteca* / *Fábrica* / *Componente (Excepción)*).
  - Tested in `packages/ui/src/components/editor/ComponentEditorJoineryPanel.test.tsx`.
- [x] **T6: Web Shell Integration (`apps/web/src/ShellView.tsx`)**
  - Created `useFactoryConstructionPolicy` hook.
  - Wired overlay state and save handlers into `SettingsScreen` and `ComponentEditorForm`.
- [x] **T7: Verification & E2E Proofs**
  - V0: `python3 scripts/check_openapi_drift.py` passes; `pnpm typecheck` passes across all 7 workspace projects.
  - V1: `@granete/domain` (122 files, 1744 tests pass), `@granete/storage` (18 files, 241 tests pass), `@granete/ui` (181 files, 2050 tests pass), Go backend `TestHandleGetActiveLibraryOverlay` (3/3 pass).
  - V2: `scripts/organization-browser-gate.sh tests/organization/factory-construction-settings.spec.ts` passes (4/4 tests pass in 13.6s with disposable PostgreSQL and real Vite browser gate).
