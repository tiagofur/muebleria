# ODD — #875 [P1][WEB-MFG] Factory self-service construction settings and component connection editor in React

**Issue**: https://github.com/tiagofur/muebleria/issues/875  
**Title**: [P1][WEB-MFG] Factory self-service construction settings and component connection editor in React  
**Status**: Delivery **partial** — slice 1 merged (PR #943, 2026-09-30 review round). Slice 2 (factory policy → resolver + demand → BOM, §6) planned 2026-10-01  
**Lane**: ODD  
**Base (slice 2)**: `origin/main` @ `8957d96b112999654cbda41ab1c4ae98cec4fd39`  
**Branch (slice 2)**: `feat/875-policy-resolver-demand-bom` (slice 1 ran on `feat/875-factory-construction-settings`, merged)  
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

- [ ] **Resolver consumption — the core of the issue**: the saved policy never reaches `deriveAuthoringMachining`/resolve; per the issue, "a form that saves JSON but does not affect the resolver does NOT complete this issue". The next slice must wire the effective policy (pinned overlay) into joinery resolution and demonstrate A=4/B=2 machining differences (AC12/AC01 "obtain their respective results"). **ACTIVE — slice 2, §6.**
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

---

## 6. Slice 2 — factory policy → resolver + demand → BOM (planned 2026-10-01)

**Outcome**: the saved `joint.*` construction policy governs joinery resolution
(station counts, margins, system per joint family) and profile-driven hardware
demand reaches the frozen project/release BOM. Two factories with the same
Standard definition resolve different machining (A=4 / B=2 stations) and their
releases freeze different demand — without editing definitions, without
mutating Standard, and without retargeting historical releases.

**Verified code map (base `8957d96b`)**:

- Policy model + overlay keys: `packages/domain/src/factoryConstructionPolicy.ts`
  (structured `joint.constructionPolicy` blob + granular keys, defaults,
  validation). Save/read UI paths shipped in slice 1 (#943). The Go side still
  treats overlay overrides as opaque JSON — zero reads on the resolve path.
- Resolver entry: `backend-go/internal/api/authoring_resolve.go`
  `HandleFurnitureAuthoringResolve` → `s.resolvedSideRecipes(r)` (#916:
  published release pin → profiles → component side assignments). The org's
  overlay is never loaded on this path — the saved policy cannot affect
  resolution. Org is available in context (`storage.OrgFromCtx`).
- Engine: `engine.AuthoringResolveInput` (`authoring_resolve.go:134`) already
  carries the server-injected-input seam (`ResolvedSideRecipes`); station
  counts today come only from the definition parameter
  (`structureStationCount`, `authoring_resolve.go:572`).
- Release side: `storage/production_release_snapshot.go`
  `insertReleaseManufacturingSnapshot` freezes schema-v2 (Requirements +
  optional Routing) via `engine.DeriveReleaseRoutingProgram` →
  `ResolveAuthoringLayout` definition-default — no side recipes, no profiles,
  no policy: released units can never produce profile-driven machining or
  demand. `release.OrganizationID` is available at freeze time.
- Demand exists only on the authoring resolve result
  (`deriveHardwareProfileDemand`, `authoring_side_recipes.go:96`) and reaches
  no BOM/requirements consumer.

**Precedence contract** (mirrors the UI provenance ladder
Biblioteca → Fábrica → Componente/Excepción):

1. Explicit authored intent wins: authored relationship
   parameters/families/recipes and component-level mandatory constraints.
2. Factory policy governs everything compatible that did not pin explicitly —
   including the definition's DEFAULT station/system values. This is what makes
   the same Standard definition resolve A=4/B=2 per factory.
3. Library defaults last.

Fail-closed: malformed policy JSON, unknown family keys, or incompatible
system/hardware references surface as structured resolve issues, never silent
ignores; no overlay means library defaults, not an error.

**Tasks**:

- [x] **T8 — Go policy model + overlay parser**: typed factory construction
  policy and `joint.constructionPolicy`/granular-key parsing mirroring
  `overlayOverridesToPolicy` (flat dotted-key semantics, library-default
  fallback for absent scalars, engine-usability validation on top).
  Parity fixtures in `contracts/factoryConstructionPolicyParity.contract.json`
  consumed by BOTH sides (Go 7/7 + TS 7/7).
- [x] **T9 — engine input + application**: `AuthoringResolveInput.FactoryConstructionPolicy`;
  a factory-provenance rule replaces the definition's DEFAULT station
  pattern in `materializeBoundRelationships` and fills authored
  floor-side/fixed-shelf-side relationships that declare none
  (`applyFactoryStationPatterns`, same server-input injection contract as
  #916); explicit authored counts and construction-declared families stay
  policy-immune. A/B resolve to different machining → different
  fingerprints (pinned by the V2 gate).
- [x] **T10 — authoring-resolve API wiring**: ONE storage loader
  (`ReleaseServerResolveInputs` → `ReleaseServerInputsFromStore`) loads
  pinned profiles + #916 side recipes + the org's active-overlay policy for
  BOTH the authoring resolve and the release gates. No overlay / unparseable
  org / DB incident → logged honest degradation; an explicitly overridden
  unusable policy → structured `FACTORY_POLICY_INVALID` (422).
- [x] **T11 — release-side wiring + demand → BOM**: the gates load the
  releasing org's inputs; `ResolveReleaseCollection` derives the routing
  program and per-unit demand INSIDE the gate verdict
  (`DeriveReleaseRoutingProgram` gained the server inputs),
  `RequirementLinesFromResolvedBOMs` merges the profile demand into the
  hardware totals BEFORE package rounding (same validation as BOM lines),
  and the freeze persists that exact program + per-unit demand as an
  additive schema-v2 snapshot section (`hardwareProfileDemand`, omitempty —
  historical rows untouched, no v3).
- [x] **T12 — V1 tests**: policy parse/edge cases + parity fixture (Go),
  application/materialize precedence tests, demand merge pre-rounding
  (10-unit package rounding proof + unknown-hardware fail closed),
  collection routing derivation + empty-inputs invariance, storage loader
  happy/degrade/fail-closed (fake reader), handler governance (422 invalid /
  200 usable / degrade) with the shared-orchestration stub.
- [x] **T13 — V2 browser proof (resolve leg)**:
  `tests/organization/factory-construction-policy-resolve.spec.ts`: real
  browser + real Go + disposable PostgreSQL — one factory, three governed
  states of the SAME definition (structural fixed-shelf-side binding with
  station margins, parameter default 3): no policy → 3 stations;
  `shelfToSide=4` → 4 stations; `shelfToSide=2` → 2 stations. Each
  definition-default resolve reaches MACHINING_READY through the pinned
  profile, the drilling pattern physically differs, demand is present and
  every fingerprint is distinct — the saved overlay demonstrably governs
  the real resolve. **Named gap**: the two-factory A/B shape of the
  acceptance needs EACH organization to hold a recipe-bearing profile;
  org-admin-authored profiles carry no recipe by design (#955 surface) and
  the platform `/seed` provisions one organization (500 elsewhere), so the
  cross-factory gate lands with the release-freeze follow-up, which needs
  the same provisioning story.

**Verification (frozen candidate)**: V0 openapi drift OK + factory script
unittests OK + workspace typecheck 0 errors. V1 Go full suite with disposable
PostgreSQL (`scripts/backend-test.sh ./...`: api/storage/engine/application/
pilotreadiness all ok) + domain TS 1751/1751 + workspace TS suites (web 565,
storage, ui) + rake verify (SketchUp 6 runs / 3855 asserts, RBZ built).
V2 org browser gate for the A/B governed resolve (T13). **V2 remaining**:
the release-freeze leg of the gate (real release freezing `hardwareProfileDemand`
+ merged requirements through the browser flow) and the two-factory A/B
gate (blocked on per-org recipe-bearing profile provisioning, named above) —
the mechanics carry V1 evidence (demand merge + collection derive + full
release suite); the integrated browser proofs are the named follow-up.
SketchUp host NOT_RUN — out of slice scope (the extension consumes the
resolve contract unchanged).

**Forecast**: one PR, ~450–600 authored lines (Go model + engine + api,
fixtures, tests, e2e extension). If the frozen candidate outruns review
planning, publish T8–T10 as `Refs #875 / Delivery: partial` and stack T11+.

**Delivery strategy**: single candidate on
`feat/875-policy-resolver-demand-bom` from base `8957d96b`; work-unit commits
(domain → engine/api → tests+e2e); fresh independent reviewer with exact
HEAD/base after frozen V0–V2 evidence.

**Review pass (2026-10-02, PR #963 REQUEST CHANGES → corrections)**:

- [x] **Tenant isolation (the review's blocker) — demonstrated in test, not
  assumed**: `TestReleaseServerInputsTenantIsolation` (real disposable
  PostgreSQL, granete_app role, real `WithinTenantTx` per factory). The
  assignments read is NOT implicit-RLS-only: `ListAllComponentSideAssignments`
  filters `WHERE organization_id = OrgFromCtx(ctx)` AND the table carries
  read/write RLS (`app_current_organization_id()`, migration 000144). The
  test proves: A's assignment synthesizes A's recipe with A's pinned
  profile; B's cross-org reference attempt is rejected as MISSING (never
  leaked); B's own post-publication profile synthesizes nothing (not pinned
  in the release); the overlay policy is filtered by the explicit org
  argument (A=4, B=2 across orgs through the SAME loader).
- [x] **OrgFromCtx (review D)**: the authoring resolve handler now passes
  the org ROW the license gate already loaded and validated (`org.ID`),
  never a second context read; the release gates pass `projectOrgID` from
  the locked project row. The empty/unparseable-org degrade is unreachable
  for authenticated production requests on both surfaces (org-less tokens
  are rejected 403 before the handler; the store-level degrade only serves
  direct callers/tests).
- [x] **A/B multi-org dependency made formal**: issue #964 tracks per-org
  provisioning of recipe-bearing profiles (the #955 surface + platform seed
  are single-org); the two-factory gate and the #919 vertical depend on it.
- [x] **Historical release freeze (review B) — DONE (2026-10-02)**:
  `TestProductionReleaseFreezesFactoryConstructionPolicy` (real disposable
  PostgreSQL) freezes R1 under shelfToSide=4 with EXACTLY the 4-station
  routing (16/16 holes across 2 units × 2 contacts per rule diameter), its
  hardwareProfileDemand (4) and the demand-merged requirements (4); moving
  the policy to 2 leaves R1 byte-identical; R2 freezes exactly 2 stations
  (8/8) with the same per-contact demand (#917); numbering R1=1/R2=2, no
  retargeting. Browser leg: the gate's freeze test reads the same frozen
  truth through `GET /api/projects/{id}/part-executions` — R1's piece rows
  are byte-identical after the policy change (never a re-resolve) and only
  R2's own snapshot regenerates them. **Enabler**: release units now accept
  relationship bindings of the GOVERNED kinds (the routing derive owns
  them; ungovernable kinds are still rejected in `resolveReleaseUnit`
  exactly as before — the pre-existing reject test passes untouched).

**Decisions pinned in this plan** (a reviewer may contest with evidence):
- Policy overrides definition-default station/system values; explicit authored
  per-relationship declarations and component mandatory constraints keep
  precedence (issue: "afecta a todos los muebles compatibles del contexto
  efectivo sin editar sus definiciones" + "no forzar métodos a relaciones
  incompatibles ni a componentes con restricciones obligatorias").
- Snapshot stays schema-v2 with an additive optional demand section (v2
  already carries optional Routing); no v3, no historical retarget (release
  continuity #741; issue: "la nueva versión no retargetea Q/R/releases ni
  cambia su BOM").
- Component-level exception persistence, If-Match concurrent-editor conflict,
  draft/activate lifecycle, permission matrix, and user documentation remain
  open after this slice (§3) — they are follow-up slices of this same issue.

---

## 8. Slice 4 — overlay If-Match concurrency + permission matrix (#875 AC07/AC3)

**Outcome**: two editors of the same factory produce a VISIBLE version
conflict instead of a silent last-write-wins (AC07), and the mutation
surfaces of the construction policy enforce the role matrix — an authorized
second user reads the same configuration; visitor/sales cannot mutate it by
API (AC3). The issue's "Seguridad, concurrencia y versiones" section.

**Design**:

- Version: `library_overlays.version` (bigint, default 1, bumped by every
  overrides update — migration 000148, fresh+upgrade). Same strong `"v<N>"`
  ETag contract the modules already use (`FormatVersionETag`/`RequireIfMatch`).
- PATCH /overlays/{id} requires If-Match; a stale token → typed 412
  VERSION_CONFLICT (storage.ErrVersionConflict), 428 without one. Reads
  return the version in the detail payload (OpenAPI detail schema gains
  `version`) so the client can always send it back.
- Client: `updateLibraryOverlay` carries If-Match from the overlay version;
  `saveConstructionPolicy` passes the active overlay's version. A stale save
  surfaces the conflict message (hook error state) — reload-and-retry is the
  recovery, never a silent overwrite.
- Permissions: the overlay MUTATION endpoints (create, PATCH, rebase,
  conflict resolve) require `RoleCanMutateCatalog` (admin/ingeniero); reads
  stay member-readable. Server-authority: the UI flag was never the gate.
- Evidence: a focused gate spec proves the 412 conflict round-trip (stale
  writer loses nothing silently; re-read + retry converges), the second
  authorized user reading the same config, and the vendedor 403 by API.
  The joinery-status/settings failure taught the suite-order lesson: this
  spec writes NO persistent overlay state of its own beyond its own keys.

**Tasks**:

- [ ] T18 — migration 000148 + storage conditional update (ErrVersionConflict)
  + version in scans; service signature; handler If-Match + 412 + role guards;
  ETag on overlay reads. V1 Go tests: conflict path, missing If-Match 428,
  permission 403, second-user read.
- [ ] T19 — OpenAPI detail version + regenerate; client If-Match + stale-save
  error surfacing; spec call sites updated.
- [ ] T20 — V2 gate spec (conflict round-trip, second user, vendedor 403).
