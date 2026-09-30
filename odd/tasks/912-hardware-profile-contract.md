# ODD — #912 HW-PROFILE domain contract

- Issue: #912 (status:approved 2026-09-30, owner authorization quoted in the
  issue comment). Lane: ODD.
- Base: `origin/main` @ `faa5449b`. Branch: `feat/912-hardware-profile-contract`.
- Scope: contract/documentation + minimal domain types + tests + shared
  fixture. NO migrations, NO CRUD UI, NO resolve wiring, NO overlay code.

## Facts established (audit 2026-09-30, main @ faa5449b)

- `domain.Hardware` (types.go:208-249): commercial entity with Code UNIQUE,
  Unit, CostPerUnit, Category, CompatibleRoles, `Machining *HardwareMachiningProfile`
  (per-hardware drilling footprint, JSONB). BOM keyed by `HardwareLine.HardwareID`
  (`collectAllHardwareLines` → `ResolvedHardwareLine` → `HardwarePurchaseRow`);
  prices live only here.
- Profile-like concepts alive (reuse, don't duplicate):
  - `HardwareMachiningProfile` on catalog hardware (drilling footprint per part/role).
  - `ManualMachiningProfile` compiled table keyed by hardware CODE — its doc
    says it "defers to a real MachiningProfile family (post-Gate A)".
  - `ShelfSupportJoineryRule` joinery systems (minifix-dowel/dowel-only, hardware by code).
  - `HardwarePlacement` with `derivedMachining` override (per-application, not a catalog).
  - `CompatibleRoles` + `Component.CompatibleHardwareCategories` — role gating exists.
  - `ResolvedMachiningProvenance` already declares `TechnicalProfileID/Revision`,
    `RecipeRevision`, `FamilyID` — the slots a profile fills.
  - `FamilyTechnicalProfile` = frozen TEST-ONLY seam (never the industrial model).
- Library platform: `LibraryReleaseResourceRef{ResourceKind TEXT unconstrained,
  ResourceID, ResourceRevision, DefinitionHash, PackageKind free|standard}` —
  kind `"hardware_profile"` needs no DDL; manifest #773 content-addressed;
  pinning via `design_revisions.effective_library_release_id`; overlay #775
  permits the `hardware.` namespace with 3-way rebase; two revision systems
  live (AuthoringIndustrialRulesRevision → catalogRevision; release manifests)
  — must not fork.
- `ContactOperationRecipe` is REQUEST-ONLY today: identity (RecipeID+Revision)
  but no server-side storage. A Hardware Profile referencing recipes by
  RecipeID/Revision is their first home.
- Component side vocabulary: the six canonical board faces (front/back/left/
  right/top/bottom) are the joinery/anchor/entry-face standard; component
  placement (base/lateral_izquierdo/…) is a DIFFERENT concept (cabinet slot).

## Contract decisions (this PR)

1. `HardwareProfile` = catalog resource referencing hardware by ID (never
   copies prices/units); `HardwareProfileItem{HardwareID, Quantity>0,
   ApplicationRole?}` with unique HardwareID per profile; `RecipeRef
   {RecipeID, RecipeRevision}` = the versioned recipe the profile embodies.
   `ContactOperationRecipe.TechnicalProfileID` MUST be a HardwareProfile ID
   (pinned in the contract; enforced at resolve time when #916 lands).
2. `ComponentSideAssignment{ComponentID, Side, ProfileID}` where Side is one
   of the six canonical board faces — no L1/W1 aliases. Mounting face and
   tool entry face stay separate concepts (recipe rules own those).
3. Precedence (documented; wiring in later slices): explicit
   relationship/contact override > component side assignment > factory
   policy/overlay > library default; conflicting equal-specificity = error,
   never last-wins.
4. Versioning: non-blank `Revision` from day one (required by
   LibraryReleaseResourceRef); profiles ride releases as kind
   `hardware_profile`; factory parameterization rides the #775 overlay
   (Granete Standard stays the default upstream).
5. Fail-closed validation now (structural): blank identity/revision, empty
   items, non-positive quantity, duplicate hardwareId, broken RecipeRef,
   unknown side → structured ContractIssues.

## Tasks

- [x] Go: domain/hardware_profile.go (types + Validate) + tests (new file,
      not types.go — monolith rule).
- [x] TS: packages/domain/src/hardwareProfile.ts (twin + Validate) + tests.
- [x] Shared fixture contracts/hardwareProfile.contract.json consumed by both
      runtimes (valid: simple screw profile, composite minifix+dowel with
      RecipeRef, side assignments; invalid: each fail-closed rule).
- [x] docs/architecture/hardware-profiles.md (canonical: glossary, boundary,
      decisions, precedence, versioning, prohibitions, integrations).
- [x] docs/architecture/hardware-profile-flow.md (flow + issue sequence).
- [ ] Suites: go test ./internal/domain/..., domain vitest, typecheck.

## Evidence log

- 2026-09-30 startup: preflight OK; branch from origin/main @ faa5449b.
- 2026-09-30 contract green: Go domain tests (fixture valid/invalid parity,
  six-face vocabulary) ok; TS hardwareProfile.test 4/4; typecheck clean.
  Fixtures assert exact paths (hardwareProfile.items[1].hardwareId etc.) so
  both runtimes fail identically.
