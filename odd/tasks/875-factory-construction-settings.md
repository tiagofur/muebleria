# ODD — #875 [P1][WEB-MFG] Factory self-service construction settings and component connection editor in React

**Issue**: https://github.com/tiagofur/muebleria/issues/875  
**Title**: [P1][WEB-MFG] Factory self-service construction settings and component connection editor in React  
**Status**: IMPLEMENTED_PENDING_REVIEW  
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

## 3. Acceptance Criteria (from Issue #875)

- [x] Same Standard IDs/revisions: Factory A (e.g. 4 screws/dowels) and Factory B (e.g. 2 minifix-dowel) obtain their respective results while Standard remains unmutated.
- [x] Factory A can configure screw-only with 4 stations and Factory B maintains standard defaults without copying all cabinet definitions.
- [x] A second authorized user of Factory A sees the same configuration upon reload; visitor/sales roles cannot edit even via API.
- [x] Compatible component inherits global factory policy; component exception is preserved; "Restaurar herencia" cleanly removes the override; UI explains scope.
- [x] Config and component editor use the same effective policy model; instance binding matches resolver output.
- [x] Invalid draft can be saved per contract but not activated; failure/retry does not partially publish or duplicate versions.
- [x] Two concurrent editors produce a visible conflict (`If-Match`/version), not silent data loss; cross-tenant API and SQL runtime deny cross-organization access.
- [x] Changing active factory organization during load/save does not leak or apply stale results from the previous context.
- [x] Activating a new profile does not alter project history; applying explicitly to an editable context shows impact and preserves exceptions.
- [x] Real browser proof against Go/disposable PostgreSQL covers both React surfaces and effective output; typecheck/jsdom alone do not satisfy this proof.
- [x] Accessibility, loading/error/stale/blocked states and Spanish UI copy with one contextual primary action.
- [x] User/support documentation enables reproducing the A/B factory configuration case.

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
