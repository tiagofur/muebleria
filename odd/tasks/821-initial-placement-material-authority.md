# 821 Initial SketchUp placement must carry the exact quoted materials and textures

Issue: #821 — [P0][SU-MAT] Colocación inicial SketchUp pierde materiales/texturas exactas de la cotización
Base: origin/main @ 7b5fc2b33b8e2dcc030bbb26d406c74626da75de
Branch: fix/821-initial-placement-material-authority
Status: hardening R1-R5 applied; V0/V1 green; V2 REAL HOST PASS (8/8)

## Proven first divergence (trace + empirical)

1. Placement resolves via GET `/furniture/definitions/{id}/layout` carrying ONLY
   the commercial seed; empty/partial/role-mismatched maps silently degrade to
   the role palette (flat tan, no texture). The material edit path sends a
   COMPLETE map (JS merges `defaultMaterialChoices(def) ∪ intent ∪ edit`), so
   its rebuild resolves materials + textures. Divergent input semantics at the
   same visual boundary.
2. React Q1 displays the FROZEN `commercial_snapshot` of the authority revision
   (accepted > highest number — quoteRevisionAuthority.ts). SketchUp seeds
   `display.material_choices` from MUTABLE `project_item_choices` via the
   `state='current'` link. No parity guarantee → authority bug (task's audit
   confirmed).
3. GET /layout never validates choices; POST /furniture/authoring/resolve does
   (`MATERIAL_CHOICE_INVALID`, pinned catalog revision).

Verified correct (untouched): Go engine core (shared by both), Ruby
LayoutContract parsing, MaterialApplier/TextureCache synchronous auth'd
download, paint_board, seeding on consistent data (real HTTP trace: display +
layout both return full per-board material+texture metadata; empirical Ruby
test painted both materials + textures on first placement).

## Scope

- Ruby `RemoteCatalogProvider#resolved_native_layout` becomes the single
  productive material-aware boundary: POST `/furniture/authoring/resolve` with
  the minimal accepted snapshot (definitionId + pinned catalogRevision +
  parameters + complete materialChoices; components/hardwarePlacements omitted
  → default occurrences). CATALOG_REVISION_STALE → one refresh! + retry.
  Rejections raise (never fall back to the weaker GET). GET /layout stays as
  fallback only for providers without resolve_authoring / unpinned catalog
  (offline/local dev), and remains available server-side for other consumers.
  INSERT (panel place + design-first create_and_place), UPDATE/REBUILD and
  RESTORE all consume `resolved_native_layout`, so all three unify.
- Go `ListFurnitureInstanceSummariesByProject`: DisplayMaterialChoices now
  derives from the frozen commercial snapshot of the project's authority quote
  revision (accepted > highest revision number; NULLS LAST), keyed by
  furnitureInstanceId; falls back to live `project_item_choices` when no
  revision/snapshot/unit exists (legacy). Dims precedence unchanged.
- Regression fixture: INTERIOR white-id + `/textures/blanco.jpg`; FRENTES
  moscato-id + `/textures/moscato.jpg`. Ruby test places ONCE through the real
  Placer with a parsed NativeLayout and asserts first-paint materials +
  textures; then updates ONLY INTERIOR and asserts FRENTES material identity +
  texture unchanged.
- Strengthen #620 test beyond the nil-stub: FakeCatalog returns a real parsed
  NativeLayout; assert renderer-applied materials/textures on FIRST placement.
- Go tests: storage cross-layer (mutable choices diverge from frozen snapshot →
  display = frozen), API authoring-resolve minimal snapshot returns exact
  material map + texture metadata per board; GET layout choices parity.
- Real-host TestUp smoke for first-placement material textures if available;
  otherwise report REAL HOST: NOT_TESTED.

## Exclusions

No MaterialApplier/UV/TextureCache rewrites, no auto-rebuild after insert, no
material simulation, no monocolor repaint, no name/color/manufacturer
inference, no display-name aliases, no WorkingCopy reset, no blind
quote→WorkingCopy overwrite, no immutable history mutation, no flat-color
success masking, no #810/#811 revert. GET /layout endpoint is NOT removed.

## Evidence log

- 2026-09-22 trace: GET instances display.material_choices = {FRENTES: ARA-MOS,
  INTERIOR: ARA-BLA}; GET layout with choices → door Moscato #8A694C +
  /api/media/a40a….jpg, interior Blanco #F3F7FA (catalog material has NO
  preview_texture_url locally — data gap noted, not code).
- Empirical scratch Ruby test (removed after verdict): first placement painted
  both materials + textures through the real Placer/builder/stubs.
- dialog.html:4362/4435 — update payload carries defaults-merged complete map.
- Implemented (this branch):
  - `PlacementAuthoringResolve` module (catalog_provider.rb): productive
    `resolved_native_layout` → POST authoring/resolve minimal snapshot, pinned
    revision, one stale-refetch retry, loud structured rejections, GET only
    when unpinned/offline.
  - `ListFurnitureInstanceSummariesByProject` (furniture_instances.go):
    DisplayMaterialChoices = frozen authority-revision snapshot (accepted >
    highest revision number, mirroring React selectCommercialQuoteRevision),
    live current-link fallback for snapshot-less units/projects.
  - Ruby tests: 2 provider boundary tests + stale retry + unpinned fallback
    (29/29 file); #620 FakeCatalog now returns a real parsed NativeLayout;
    2 regression tests (first-placement paint with textures; INTERIOR-only
    update keeps FRENTES identity+texture) — 55/55 file; extension rake:
    910+6 runs, rubocop clean, RBZ reproducible.
  - Go tests: TestFurnitureInstances_ListSummariesFrozenQuoteChoicesAuthority
    (frozen wins over diverged live; legacy fallback; divergence after
    acceptance cannot leak) — storage 513s full suite green;
    TestAuthoringResolveMinimalSnapshotCarriesExactMaterialMetadata (exact
    materialId/name/color/texture/tile per role, unchosen roles invent
    nothing, default occurrence expansion) + existing GET-parity test —
    api 19.7s green; domain/engine green.
  - TestUp: TC_ProjectFurnitureSmoke gains
    test_place_existing_with_resolved_layout_paints_quoted_finish_textures_first_render
    (pure-Ruby PNG textures, installed-RBZ-only rules). NOT RUN on the real
    host in this pass → REAL HOST: NOT_TESTED.

## Remaining scope (Delivery: partial)

- Run TC_ProjectFurnitureSmoke (and ideally a live first-placement against
  the dev server) on the real SketchUp host with the installed RBZ built from
  this branch; attach evidence to close #821.

## Hardening round (independent review R1-R5, 2026-09-22)

- R1: `seed_material_choices` now composes by authority — base = frozen
  display choices, overlay = explicit WorkingCopy roles (`compose_effective_choices`).
  The pending create-and-place intent composes identically (it is a delta).
  Regressions: partial item {INTERIOR: black} over frozen {INTERIOR: white,
  FRENTES: moscato} resolves {INTERIOR: black, FRENTES: moscato} with the
  Moscato texture kept on first render; same for the pending-intent variant.
- R2: snapshot units PRESENT with options=[] are a frozen EMPTY authority —
  `DisplayMaterialChoices` nil, live choices do NOT leak back (new PG test
  TestFurnitureInstances_ListSummariesFrozenEmptySnapshotUnit; snapshot-absent
  fallback test preserved).
- R3: TestUp smoke PNG emitter extracted to test/support/smoke_textures.rb
  (fixes `Zlib.cRC32` typo) with a portable structural unit proof (chunk CRC
  recomputation, IDAT inflate, IHDR validation).
- R4: dev catalog verified — ARA-BLA-FRO-15 has NO preview_texture_url (data
  gap stands; expected live render = identity/color only until catalog data
  provides it); ARA-MOS-15 carries /api/media/a40a….jpg. The synthetic PNG
  smoke proves the renderer, NOT real Blanco texture.
- R5: origin/main merged (10ae92b8, PR #816 project-delete); the shared test
  file reconciled cleanly (fiActorA/B MembershipID + direct-DELETE savepoint
  proofs coexist with the #821 tests).
- Host smoke fixes (pre-existing latent bugs surfaced by the first real run):
  bare `ProjectFurniture::` constants never resolved on the installed runtime
  (now `Connection::ProjectFurniture::`); API add_instance does not clone
  entity attribute dictionaries (duplicates now carry the identity
  explicitly, matching real copy/paste); empty groups are purged by host
  operations (the nesting test's parent group carries a face).

## Final verification (candidate 2bedc514 + evidence commits)

- Ruby rake verify: 914+6 runs, rubocop clean, RBZ deterministic
  sha256 66a05c101c04f09e99374b3dddce21c68c099ad31b3bca644f4d9debb7fb0c30.
- Go: storage full (434s, real PostgreSQL + RLS, post-merge with #815),
  api 24.6s, domain+engine — green.
- OpenAPI drift none; pnpm typecheck green; git diff --check clean.
- REAL HOST (SketchUp 2026, arm64, installed RBZ 66a05c10…):
  progress/host_smoke_821_testup_ci.json — Success, 8/8 tests, 49
  assertions, 0 failures 0 errors, including
  test_place_existing_with_resolved_layout_paints_quoted_finish_textures_first_render
  (first render paints Blanco INTERIOR + Moscato FRENTES with their
  photographic textures). Evidence commits add tests/evidence/docs only;
  product src unchanged since 2bedc514 → the run pins the final candidate.

## Follow-up PR1: validate frozen catalog option kinds (2026-09-22)

Issue #821 remains open and approved. The operator later reported that an
existing project unit did not enter SketchUp: authoring rejected the frozen
`BISAGRA` choice as `MATERIAL_CHOICE_INVALID` because it is hardware, not an
active board. The same option map carries board, hardware and edge choices;
discarding `BISAGRA` would lose commercial intent. This PR repairs that Go
authoring boundary only. It does not include the local diagnostic UI or the
intermediate `/auth/me` client, which lacks extension route authorization.

- [x] T821-F1a Validate each frozen choice against its catalog option group,
  kind, membership and active matching entity; preserve exact board finishes
  and generic hardware/edge choices. Reject unknown, non-member, wrong-kind
  and inactive choices. No host mutation, quote rewrite or fallback.
- [ ] T821-F1b Independently verify insertion and exact finishes with the
  PR1 backend and installed SketchUp process in a safe model. The operator's
  successful v0.1.4 placement is valuable reported evidence, NOT an exact
  PR1 process/version readback.

Route: delegated direct, sole writer. Strict TDD from AGENTS.md; historical
RED→GREEN focused Go evidence exists in the source work unit, and this slice
must rerun Go API/engine, OpenAPI drift, affected-plan checks and diff check.
Forecast: 319 authored source/test/contract +/- lines plus this scoped ODD
record (under 400); generated types remain visible but excluded from authored
count. Delivery: `ask-on-risk`, user-selected `stacked-to-main`. PR1 targets
`origin/main` at `8c78eac9`; later diagnostic, scoped-profile API and final
v0.1.5 plugin slices start from main only after each preceding human merge.
No push, PR creation, merge, server restart, host install or design mutation
is part of this candidate. Rollback boundary: authoring choice validation,
supporting catalog/fixture contract and their tests.

PR1 verification: the source patch from local work unit `f58e4184` applied
cleanly, then PR1 rebased onto exact `8c78eac9`, without intermediate Ruby
identity commits.
The original work unit observed RED 422 for `BISAGRA` and acceptance of an
unknown group; its tests now cover BISAGRA/EDGE plus exact INTERIOR/FRENTES,
and negative inactive, wrong-kind and non-member cases. On this isolated PR1
tree, focused Go API/engine tests PASS; full `go test ./internal/api
./internal/domain/engine -count=1` PASS; OpenAPI drift PASS; direct storage
TypeScript typecheck PASS; shared TS authoring contract 10/10 PASS; Ruby
authoring contract 47/47 and remote catalog provider 29/29 PASS. The
conservative affected plan also selects full Go/storage/PostgreSQL, browser,
visual and host lanes: NOT_RUN here, not a claim of integrated V2 proof.
`git diff --check` PASS. The reported real v0.1.4 placement belongs to a
different combined local candidate and does not pin this PR1 backend binary.
PR1 work-unit commit after rebase: `a39ecb48` (`fix(sketchup): validate quoted catalog
options by group kind`); this evidence SHA is recorded in a separate
artifact-only commit. RDD is disabled/unmanaged; independent review is pending.

Base drift and isolation correction: `8c78eac9` adds the approved
`docs/architecture/test-database-isolation.md` contract. Automated tests must
not write persistent `muebles`; full Go/storage/PostgreSQL and normal-backend
browser suites remain NOT_RUN until an explicit throwaway DB is supplied.
After rebase, only confirmed stub/pure tests were rerun: focused Go API/engine
(including golden and BOM) PASS, OpenAPI drift PASS, storage `tsc` PASS, TS
contract 10/10 PASS, and Ruby fake-boundary suites 47/47 plus 29/29 PASS.
The earlier full Go API/engine result belongs to the pre-drift base, not to
this exact candidate. No DB, backend process or SketchUp model was touched.


## Follow-up PR2: placement diagnostics and v0.1.4 (2026-09-22)

PR1 catalog-option validation was merged as PR #825 at `3d14d645`;
issue #821 remains open. This independent stacked-to-main slice addresses
only the observable callback/UI failure state and v0.1.4 package identity.
It deliberately excludes the intermediate `/auth/me` implementation and
later scoped-profile/v0.1.5 correction.

- [x] T821-F2 Correlate every place result, including host exception, to the
  requested furnitureInstanceId; release the correct busy button on failure
  or pending-position success, and retain a selectable diagnostic after the
  toast. Do not mutate host geometry in the error path.
- [x] T821-F4 Align source/footer/test/README version to v0.1.4 and build a
  deterministic RBZ with package-byte readback. Installation/process proof
  belongs to a separate safe-host step.

Route: delegated direct, sole writer in isolated worktree. Strict TDD enabled
by AGENTS.md; original work-unit evidence records one Ruby callback and one
Node dialog RED failure before the GREEN change. On this exact slice rerun
focused Ruby/JS and full Ruby `rake verify`, package/readback, diff check and
preflight. Forecast 92 authored +/- code/test/version lines plus this scoped
ODD record; generated/vendor output excluded, no code-golf. Delivery remains
`ask-on-risk` with user-selected `stacked-to-main`; PR2 targets exact
`origin/main` `3d14d645`, after merged PR1. Rollback boundary: dialog
controller, project-furniture HtmlDialog error state and tests, plus v0.1.4
version literals. No backend, PostgreSQL, browser, SketchUp install/model,
push, PR creation or merge is authorized in this worker.

PR2 verification on this isolated base: original `74c5c574` records RED one
Ruby callback and one Node dialog failure before GREEN. Reapplied only its
callback/error-state patch plus `d43a1aa5` package-version patch; no identity
source or tests. Exact-slice Node project-furniture 27/27 PASS, Ruby dialog
controller 44/44 (260 assertions) PASS. Full local Ruby `rake verify` PASS:
916 unit (6218 assertions), 6 boundary (3251 assertions), zero failures;
syntax/lint and deterministic RBZ readback PASS. RBZ SHA-256 is
`804c67fd9fba790ff27a61ecee4e1a7e523c698326de909a96096d15c2d991b4`;
archive readback confirms identity/footer v0.1.4, persistent selectable
diagnostic, and callback correlation. `git diff --check` PASS. The operator's
successful placement with Blanco/Moscato textures was reported for a prior
combined v0.1.4 candidate, not this exact PR2 host process. V2 installation,
live callback/error capture and real host model remain NOT_RUN;
Go/PostgreSQL/browser are unchanged by this slice and not claimed.

PR2 work-unit commit: `01eeb6cb` (`fix(sketchup): recover placement errors
in v0.1.4`). This SHA readback is recorded in a separate artifact-only
commit; RDD disabled/unmanaged and independent exact-HEAD review pending.


## Follow-up PR3: scoped SketchUp identity endpoint (2026-09-22)

PR #827 merged the PR2 diagnostic/v0.1.4 slice into exact `origin/main`
`cd049733`; #821 remains open/approved. The installed extension still shows
blank Usuario/Correo. Current Ruby's attempted full `/auth/me` read is not on
main and would receive 403 from the ExtensionClient allowlist. The full web
response also includes other memberships/support context, so it must not be
opened to SketchUp. This PR adds ONLY the backend/API contract for a minimal
current-device-session profile; the Ruby consumer and v0.1.5 are later slices.

- [x] T821-F3a Add exact GET `/api/auth/sketchup/profile` capability for the
  current extension bearer, active user/current organization membership and
  license. Expose name/email plus current org/license/scope only; no other
  memberships, roles or support context. Reject web/support/wrong-org,
  malformed/expired/revoked and query credentials; preserve `/auth/me` denial.
- [x] Generate Go/TS clients from OpenAPI and verify drift, safe stub-backed
  HTTP route/middleware tests, package typecheck and clean diff. No persistent
  PostgreSQL writes, Ruby client, package install or host mutation.

Route: delegated direct, sole writer in isolated worktree. Strict TDD enabled
by AGENTS.md: observe focused Go RED before implementation, then GREEN and
REFACTOR; do not infer from the older monolithic candidate. Forecast ~180
non-generated authored +/- lines plus scoped ODD (~30), below 400 advisory.
Delivery remains `ask-on-risk`, user-selected `stacked-to-main`, PR3 based on
`cd049733`. Rollback boundary: exact API route/allowlist/handler, minimal
schema/generated clients and associated stub-backed tests. V2 live service
and SketchUp display/logout readback remain later work, not this PR.

PR3 TDD and verification: new stub-backed real-router HTTP test first returned
404 for `/api/auth/sketchup/profile` (RED), while existing `/api/auth/me`
remained denied to the extension. GREEN focused Go API run covers own
name/email/current org/license with no other membership fields, no-store,
web/query/malformed/expired/wrong-org/support rejection, and minted device
bearer plus post-revocation denial: PASS. OpenAPI generated drift PASS;
standalone generated TS client/types `tsc --noEmit` PASS; Go `gofmt -l` empty;
`git diff --check` PASS. Full storage package typecheck could not run in
this isolated worktree because it has no node_modules; using the shared
compiler with worktree config found missing worktree Vitest types, so only
generated-client typecheck is claimed. The affected-plan selects full Go,
PostgreSQL/browser, SketchUp and visual lanes; no persistent DB, backend
process, installed plugin or user's model was touched. Those V2 gates remain
NOT_RUN, not substituted by the stub tests. No Ruby client/version change.

PR3 work-unit commit: `e1b3e4e2` (`fix(sketchup): expose scoped
device-session profile`); this exact SHA is recorded in a separate ODD
artifact-only commit. RDD disabled/unmanaged; independent review pending.
