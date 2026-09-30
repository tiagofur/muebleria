# #497 — Typed furniture parameter definitions and semantic bindings editor (React)

## Objective

A workshop administrator can author, validate, preview and evolve typed furniture
parameter definitions (`number | string | boolean | enum`) and semantic bindings
entirely from the React module editor ("Parámetros" section), with server-side
validation, optimistic concurrency, impact preview before destructive edits, and
an authoritative resolve preview — no JSON editing, no duplicated semantics, and
the exact same definition consumed by SketchUp and Go.

Issue: https://github.com/tiagofur/muebleria/issues/497 (`status:approved`, P0,
`[WEB-CAT-1]`). Tracks #465, #401, #349, #290. Coordinates with #496.
Base `origin/main` @ `9ed33bda` (merge #929), branch
`feat/497-web-catalog-param-editor`, one writer (GLM/ZCode). Plan-only pass:
no product code written yet; this artifact is the execution plan.

## Problem

The stack is operationally incomplete: backend persists
`modules.parameter_definitions` (JSONB, migration 000103, validated by
`backend-go/internal/domain/furniture_parameters.go`), SketchUp renders and
submits the controls (`granete-param-form.js`), but React cannot author or even
preserve them:

- **Silent data loss**: `ModuleDraft`/`draftToModule`
  (`packages/ui/src/modules/helpers/moduleDraftTransforms.ts`) has no
  `parameterDefinitions` field — editing a module through the current UI drops
  its parameter definitions (only untouched modules survive via verbatim
  storage round-trip in `packages/storage/src/apiMappers.ts:685,746`).
- **No parameter UI**: `moduleEditorTabs.ts` has no "Parámetros" tab; grep for
  `parameterDefinitions` under `apps/web`/`packages/ui` returns only the domain
  type.
- **No optimistic concurrency on modules**: `modules` has no `version` column;
  `UpdateModule` (`backend-go/internal/storage/projects.go:2071`) is a blind
  full-row UPDATE; module PUT responses carry no ETag (the only ETag on the
  furniture surface is the content-hash cache ETag of
  `GET /api/furniture/definitions`).
- **Untyped validation errors on the write path**: module create/update returns
  plain 400 text (`respondWithError`, `handlers.go:2147,2197`) instead of the
  typed `PARAMETER_DEFINITION_INVALID` envelope the furniture read surface uses.
- **No impact analysis and no draft resolve**: no endpoint answers "which
  presets/consumers use this parameter" or "does this edit change
  definitionHash/catalog revision", and
  `POST /api/furniture/authoring/resolve` resolves published definitions by id
  + pinned `catalogRevision` only — a draft definition cannot be resolved.
- **Outside the generated contract**: `/api/catalog/*` and the furniture
  surface are hand-written wire structs, not in
  `contracts/openapi/granete-api.v1.yaml` (#496 scope). Issue rule: UI discovery
  may start before #496 closes, but production data access must consume the
  generated contract.

## Why

P0 `[WEB-CAT-1]` in the approved queue (ordered before #875 `[P1][WEB-MFG]`).
Without React authoring, the typed parameter model delivered by #483/#486 and
consumed by SketchUp cannot be operated: `backend can persist it / SketchUp can
consume it / React cannot safely author-manage it`. The active data-loss path
(draft drops definitions) makes the gap worse than "missing feature".

## Scope

- Fix the module draft pipeline so `parameterDefinitions` round-trip verbatim
  through the React editor.
- Module optimistic concurrency: `modules.version`, ETag/If-Match on the module
  read/write path, typed `VERSION_CONFLICT` (412), adapted in
  `APIWorkspaceRepository` so the existing catalog save flow keeps working.
- Typed 422 `PARAMETER_DEFINITION_INVALID` issues on module create/update.
- Minimal generated-contract surface for this editor (see Open decision D1):
  module get/put (+list), `GET /furniture/definitions` published projection,
  and the new authoring preview endpoint — added to `granete-api.v1.yaml` with
  regenerated TS/Go clients under the existing drift gate.
- Server-authoritative **authoring preview endpoint**: draft parameter
  definitions + sample values + material choices → same validation + resolve
  engine → normalized definitions, would-be `definitionHash`, typed issues,
  projected dimension ranges/preset impact, resolve summary. Stateless; does
  not mutate the catalog or advance the revision.
- "Parámetros" tab in the module editor: list+order, create/edit definition
  (all four types, exact constraint fields, Spanish label/help, category,
  metadata-only rule), semantic binding editor (reviewed kinds only, concrete
  component IDs from module composition, ambiguity/incompatibility surfaced,
  never by name/index/geometry), safe-evolution impact panel, stale-conflict
  UX, and "Probar resolución" preview with structured issues (optional
  read-only 3D render from the accepted result).
- Cross-surface E2E fixtures: one authored definition pinned by
  `definitionHash`/`revisionId` proving React → catalog revision → SketchUp
  refresh/inspector → submit → Go resolve → React readback of the same
  normalized definition.

## Non-goals

- No new resolve/binding semantics, no engine changes; only surface what
  #483/#486/#477 already define (`dimensionColumn` stays projection-only and
  non-authorable; `structureRelationship` stays Go-resolver-only at the
  persisted boundary).
- No change to the versioned `granete.sketchup-authoring-resolve.v1` schema —
  the preview is a new sibling endpoint, not a schema extension.
- No full #496 unification (only the minimal surface this editor needs; #496
  remains open for the rest: layouts, project-design, remaining catalog paths).
- No #875 factory self-service screen; no manufacturing-library release/overlay
  UI; no separate "publish" action (saving a module advances the
  content-addressed `workshopCatalogRevisionID`; immutable distribution stays
  in the library-release platform).
- No raw-JSON editor as production workflow; no parameter-name-driven behavior
  inference in React.
- No parallel TS hash/resolve implementation: React imports
  `@granete/domain` (`furnitureParameters.ts`, `webAuthoringResolve.ts`);
  would-be hash and resolved consequences come from the server preview.
- No project/design parameter-override UI (design-time values are another
  surface).
- No module DELETE concurrency (follow-up if the owner wants it).

## Constraints

- Approved issue only; one writer; isolated branch from `origin/main` @
  `9ed33bda`; no force push; human merge. Publication metadata contract:
  `Closes #497 + Delivery: complete` only with full acceptance; else
  `Refs #497 + Delivery: partial` with remaining scope named.
- Ownership boundary: React owns catalog administration and explainable
  preview; Granete domain/backend owns definition validity and resolved
  consequences. Browser validation = `packages/domain/src/furnitureParameters.ts`
  (strict mirror, shared fixtures `contracts/furnitureParameterDefinitions.invalid.json`
  consumed by TS+Go+Ruby); anything beyond it fails closed to the server.
- Generated contracts only for production data access; `pnpm openapi:generate`
  + `scripts/check_openapi_drift.py` gate; new endpoints must import the same
  ETag/precondition/idempotency primitives (`contracts/openapi/README.md` rule),
  not a catalog-only variant.
- Reserved dimensions `widthMm`/`heightMm`/`depthMm` are projections from
  module columns + dimension presets (`buildDimensionParameter`,
  `furniture_catalog.go:353`); they are displayed read-only, never redefined by
  the persisted editor.
- UI: tokens only, Spanish copy, one contextual primary action, distinct
  loading/error/stale/offline/blocked states, a11y (aria tablist patterns,
  keyboard, `role="alert"` errors) per `docs/design.md` §4/§7/§8/§9; a11y and
  explicit-`false`/empty-string behavior demonstrated in component tests.
- Tests never write to a persistent dev/prod database: PostgreSQL only in a
  disposable container (`docs/architecture/test-database-isolation.md`).
  Missing infrastructure (real SketchUp host) is NOT_RUN, never PASS.
- ~400 authored additions+deletions per PR is the review heuristic; slice by
  coherent work unit, never code-golf.

### Open decisions for plan review

- **D1 (blocking for T2/T5)**: #497 lands the minimal generated-contract
  increment itself (recommended) vs. blocks on #496 closing. #496 is OPEN with
  no open PR and no visible active writer; its canonical decision already
  anticipates modular incremental additions (`furniture-authoring.v1.yaml`).
  Recommendation: land the increment here (module get/put, furniture
  definitions GET, authoring preview POST), leave #496 open for the rest, and
  cross-reference in both issues. Needs owner confirmation because it touches
  #496's declared scope.
- **D2**: preview endpoint shape — recommended
  `POST /api/furniture/authoring/preview` (sibling of resolve, same engine,
  stateless, draft-in/summary-out, no catalog mutation). Exact path/naming is
  an implementation choice validated in review.

## Authorized scope

- `packages/ui/src/modules/**` (new "Parámetros" tab, panels, list editors),
  `packages/ui/src/common/**` only where a shared primitive is genuinely
  reused.
- `apps/web/src/stores/catalog/**`, `apps/web/src/stores/workspaceStore.ts`
  (version/If-Match flow), `apps/web/src/routes.ts` if a deep link is needed.
- `packages/storage/src/apiWorkspaceRepository.ts`, `apiClient.ts`,
  `apiMappers.ts`, `packages/storage/src/openapi/generated/**` (regenerated).
- `contracts/openapi/granete-api.v1.yaml` (new paths/schemas),
  `contracts/furnitureParameterDefinitions*.json` (extend valid cross-surface
  golden if needed), `contracts/sketchupAuthoringResolve.contract.json` only if
  the preview golden reuses it.
- `backend-go`: `internal/api/{routes,handlers,furniture_catalog,preconditions}.go`
  + new preview handler, `internal/storage/projects.go` (versioned update),
  `internal/domain/furniture_parameters.go` only if a hash/summary accessor is
  needed, `db/migration/0001xx_modules_version.{up,down}.sql` (next free
  number), plus Go/TS/Ruby tests under existing suites.
- `apps/sketchup-extension` only if the cross-surface fixture needs a Ruby-side
  assertion (existing suites preferred; no adapter code — negative proof
  forbids a special hand-written adapter).

## Acceptance criteria

From the issue, each mapped to the task that proves it:

1. React can create/edit/order every currently supported parameter type — T3.
2. Explicit `false` and empty strings round-trip correctly — T3/T7 (component +
   cross-surface tests).
3. Numeric constraints, enum options and string limits match backend validation
   exactly — T3 (shared `@granete/domain` validator + fixture parity) and T5
   (server rejects anything the browser missed).
4. Binding targets use stable IDs and expose ambiguity/incompatibility
   honestly — T4 (composition IDs; ambiguity shown, never first-match).
5. Reserved dimensions cannot be redefined inconsistently — T3 (read-only
   projection display; persisted validator already rejects).
6. Metadata-only parameters cannot carry behavioral bindings — T3/T4
   (client rule + server `ValidatePublishedFurnitureParameterDefinitions`).
7. Preset/reference impact is shown before incompatible edits — T6 (impact
   panel from T5 preview + module data).
8. Stale writes fail with typed conflict and do not overwrite — T1
   (412 `VERSION_CONFLICT`, conditional UPDATE, UI reload prompt).
9. Preview consumes authoritative resolve and displays structured issues —
   T5/T6.
10. The exact definition authored in React is consumed by SketchUp without a
    parallel transformation model — T7 (cross-surface golden fixture by
    `definitionHash`/`revisionId`).
11. Tests cover keyboard/accessibility, contract errors, stale conflict and
    cross-organization isolation — T7 (component a11y tests, openapi/typed
    error tests, 412 test, RLS/organization-gate test).

Negative proofs enforced as failing conditions in review: no raw-JSON primary
workflow; no name-inferred behavior; no first-match on ambiguity; no
browser-only acceptance of a server-rejected definition; no silent mutation of
published/catalog-pinned definitions (catalog pinning honored: saved module
edits advance the content-addressed revision; pinned `catalogRevision` consumers
keep failing `CATALOG_REVISION_STALE` until they refresh); `false`/`""` never
treated as missing; no SketchUp hand-written adapter.

## Execution tasks

- [x] **T1 — Stop the silent data loss: draft pipeline round-trip**
  - Route: inline.
  - Trigger evidence: `ModuleDraft`/`draftToModule`
    (`packages/ui/src/modules/helpers/moduleDraftTransforms.ts:81-111,313`)
    drops `parameterDefinitions` today; smallest correctness prerequisite, and
    every later task depends on the field surviving an edit session.
  - Outcome: `ModuleDraft` carries `parameterDefinitions` verbatim (same
    round-trip contract as `packages/storage/src/apiMappers.ts`), regression
    test proves an edit-save preserves a definition-bearing module byte-for-byte
    on the wire. Small standalone PR. **DONE — commit `490e6b1a`.**

- [x] **T2 — Backend: module optimistic concurrency + typed validation errors**
  - Route: inline.
  - Trigger evidence: `modules` has no `version` column; `UpdateModule`
    (`backend-go/internal/storage/projects.go:2071`) is a blind UPDATE; module
    create/update returns plain 400 text. Issue requires "stale writes fail
    with typed conflict" and "browser-only validation accepts a definition
    rejected by Go" must be impossible.
  - Outcome: migration 000142 `modules.version` (DEFAULT 1, CHECK >= 1,
    fresh+upgrade proven); module list/get/create/PUT expose `version` +
    strong ETag `"v<N>"`; PUT resolves existence first (404 keeps the client
    POST-create fallback alive) then `RequireIfMatch` (428/400) and
    `UpdateModule(id, expectedVersion, m)` does a conditional
    `version = version + 1` UPDATE in one transaction — stale →
    `storage.ErrVersionConflict` → 412 `VERSION_CONFLICT` typed envelope,
    missing row → 404, invalid parameter definitions → 422
    `PARAMETER_DEFINITION_INVALID` (same envelope as the furniture read
    surface, now shared via `respondWithParameterDefinitionIssues`). Client:
    `Module.version` (display-only), `APIWorkspaceRepository` keeps a session
    version cache seeded by getCatalog and refreshed from every accepted
    write; PUT sends If-Match from the cache, a bare PUT (no cached version)
    fails closed on 428 via `ModuleVersionUnknownError`, and the catalog store
    maps stale conflicts to a distinct warning toast with the local change
    rolled back. **DONE — this commit.**

- [x] **T3 — Generated contract surface for the editor (D1: landed here)**
  - Route: inline.
  - Trigger evidence: production data access must consume the generated
    contract (#497 hard prerequisite); `/api/catalog/modules` was hand-written
    wire outside `granete-api.v1.yaml`.
  - Outcome: **DONE.** Spec gains `/catalog/modules` (GET list, POST create)
    and `/catalog/modules/{moduleId}` (GET, versioned PUT with If-Match + ETag)
    over 33 closed, runtime-validated schemas mirroring the Go wire exactly
    (typed-parameter definitions + bindings + relationship families/stations
    shared verbatim with the furniture projection). Web module transport moved
    to the generated client (list/get/create/update) with the version cache +
    412/404 semantics intact and learn-first replacing the bare PUT. **Declared
    deviations from the original task text:** (1) `GET /furniture/definitions`
    and the authoring/resolve surface stay OUT of the OpenAPI spec — the repo
    already consumes them under a single authority (domain golden-pin +
    workshop envelope contract; `GraneteApiClient.getFurnitureCatalogRevision`
    comment records the precedent) and a second validation model would violate
    the no-parallel-model invariant; (2) the authoring-preview path lands in
    T4 together with its implementation; (3) Idempotency-Key stays undeclared
    until the server enforces `RequireIdempotency` on module writes (T4+).
    Drift gate extended: versioned module PUT must declare ETag + If-Match.
    Cross-reference comment in #496.

- [x] **T4 — Backend: authoring preview endpoint (draft, server-authoritative)**
  - Route: inline.
  - Trigger evidence: no way to resolve a draft today — the resolve resolves
    published definitions by id + pinned `catalogRevision` only.
  - Outcome: **DONE.** Stateless `POST /api/furniture/authoring/preview`
    (D2 name landed as proposed): strict decode (DisallowUnknownFields, no
    query, 2 MiB), ONE catalog snapshot read, draft boundary validation
    (persisted → published incl. synthesized dimension projections from the
    module's dims/presets → consumer validation inside the engine against the
    module's real composition), sample-value evaluation and material-choice
    validation, then `engine.ResolveAuthoringLayout` on the draft. Accepted →
    would-be `definitionHash` + full draft published parameter set + resolved
    (layout/machining/preflight). Rejected → 422 with structured issues and
    NO resolved data. Never mutates the catalog (parity test asserts the
    module row untouched) — the preview does not advance the revision; it
    ECHOES the revision it used. **Contract decision (recorded deviation):**
    like the #477 resolve, the preview stays OUT of granete-api.v1.yaml — its
    `resolved` section is the resolve engine's wire, golden-pinned by the
    domain: Go parity test pins `contracts/furnitureAuthoringPreview.fixture.json`
    (UPDATE_AUTHORING_PREVIEW_GOLDEN=1; deterministic — fixed seed UUIDs) and
    `packages/domain/src/furnitureAuthoringPreview.ts` parses the same file
    fail-closed; the generated client is bypassed via
    `GraneteApiClient.previewFurnitureAuthoring` (resolve precedent). Web-only:
    extension tokens cannot POST it (absent from the extension allowlist).

- [ ] **T5 — UI: "Parámetros" tab — list, order, definition editor**
  - Route: inline.
  - Trigger evidence: no parameter UI exists; `moduleEditorTabs.ts` has no
    parameters tab; the editor must cover the complete current contract with
    exact constraint fields and Spanish copy.
  - Outcome: new `parameters` tab in `ModuleEditorForm` (aria tablist pattern,
    error-message → tab routing like `tabForModuleValidationError`): list
    (label, technical `name`, type, category, default, required/optional, unit,
    binding/consumer summary, usage count where available, valid/invalid +
    remediation via domain issue codes), `sortOrder` reordering, and a
    create/edit form for all four types with the exact constraint fields
    (number: min/max/step/integer/unit; string: maxLength; boolean preserving
    explicit `false`; enum: ordered options), Spanish label/help, authoring
    category, default/required semantics, metadata-only declaration. Validation
    via imported `@granete/domain` validators; reserved dimensions shown
    read-only as projections (name/unit/range from the module + presets).
    Explicit `false`/`""` never treated as missing. Component tests incl.
    keyboard/a11y.

- [ ] **T6 — UI: semantic binding editor**
  - Route: inline.
  - Trigger evidence: bindings ride inside `parameter_definitions` and
    `componentQuantity`/`componentCondition` are the persisted authorable
    kinds; targets must come from the module's actual composition
    (`ValidateModuleFurnitureParameterConsumers` semantics) with ambiguity
    fail-closed.
  - Outcome: binding editor inside the parameter form: select concrete catalog
    components/relationships from authoritative module composition IDs; explain
    the effect in user language; detect and show incompatible targets; show
    ambiguity instead of selecting the first component; never bind by display
    name, array index or geometry; block a metadata-only parameter from
    carrying a behavioral binding; `dimensionColumn`/`structureRelationship`
    explained as non-authorable (projection/resolver-only). Component tests
    for ambiguity/incompatibility/metadata cases.

- [ ] **T7 — UI: safe evolution impact + stale conflict UX + "Probar resolución"**
  - Route: inline.
  - Trigger evidence: issue requires impact before destructive/incompatible
    edits, optimistic-concurrency UX, and an authoritative preview with
    structured issues; T4 provides the server surface, this task surfaces it.
  - Outcome: impact panel before destructive edits (presets using the parameter
    — module dimension presets for the projected dimension ranges; honest
    "sin uso en presets" for authored parameters since `module_presets` carries
    dimensions only; defaults that will change; catalog-revision/`definitionHash`
    advance; reserved/referenced name), 412 `VERSION_CONFLICT` UX (stale editor
    cannot overwrite; reload prompt — same pattern as `UsersScreen` error
    mapping), and "Probar resolución": sample-values form (seeded from
    defaults), material choices, calls the preview endpoint, displays
    structured issues with Spanish copy (mirror `granete-param-form.js`
    messages) and an optional read-only 3D render from the accepted result via
    the existing `Furniture3DViewer`/`ModuleScene3D` (render only, never
    computes consequences).

- [ ] **T8 — Cross-surface fixtures + gates**
  - Route: inline.
  - Trigger evidence: the issue requires an E2E fixture proving React →
    revision change → SketchUp refresh → inspector control → submit → Go
    resolve → React readback of the same normalized definition; the
    established cross-layer pattern is shared contract fixtures
    (`furnitureParameterDefinitions.invalid.json`,
    `sketchupAuthoringResolve.contract.json`) consumed by Go+TS+Ruby.
  - Outcome: one valid authored-definition golden fixture pinned by
    `definitionHash`/`revisionId` consumed by (a) Go test: module save →
    `GET /furniture/definitions` returns the definition + advanced revision,
    resolve accepts submitted values; (b) TS contract test: the same normalized
    definition is read back and evaluates identically; (c) Ruby unit test:
    inspector renders the correct control per type and submits the value.
    Browser test in the organization gate: author parameter in React → save →
    revision advances → readback normalized (covers cross-org isolation via
    RLS). Real-host SketchUp smoke declared V2 NOT_RUN unless the owner's host
    is available.

## Verification plan

- `pnpm typecheck && pnpm test` (root; CI `typescript` job parity) — every PR.
- `python3 scripts/check_openapi_drift.py` and `pnpm openapi:generate` (CI
  `contract` job parity) — every PR touching contracts/generated code.
- Go: targeted `go test ./internal/...` with disposable PostgreSQL per
  `docs/architecture/test-database-isolation.md` (Docker container, per-fixture
  migrations) — T2/T4.
- Component tests: `packages/ui` vitest + jsdom (`ModulesScreen.test.tsx`
  pattern) with a11y/keyboard assertions — T5/T6/T7.
- Browser/PostgreSQL V2: `scripts/organization-browser-gate.sh` (disposable
  Postgres + built Go server + Vite web + Playwright) — T8.
- Ruby: `ruby -Itest test/unit/catalog_parameter_contract_test.rb` + new
  inspector-control test — T8 (host TestUp only if the owner's host is
  available; otherwise NOT_RUN).
- `python3 scripts/verify_affected.py --base origin/main --plan` before each
  freeze; run the selected gates once with the remaining budget.
- Final: `python3 scripts/factory_preflight.py --require node pnpm
  --require-clean`.

## Delivery forecast

- Forecast (authored additions+deletions; generated output excluded):
  T1 ~100, T2 ~450, T3 ~250 (spec hand-edits; generated excluded), T4 ~450,
  T5 ~800, T6 ~450, T7 ~500, T8 ~400 → ~3.400 lines total across 6-7 chained
  PRs, each under or near the ~400 heuristic with tests/docs kept with
  behavior.
- Delivery strategy: `auto-chain` — stacked PRs on
  `feat/497-web-catalog-param-editor`, each slice independently reviewable,
  human merge between slices; final PR carries `Closes #497 + Delivery:
  complete` only if all acceptance is demonstrated, otherwise `Refs #497 +
  Delivery: partial` with remaining scope named.
- Chain boundaries: PR1=T1 (immediately mergeable correctness fix); PR2=T2;
  PR3=T3+T4 (backend surface); PR4=T5+T6 (editor UI); PR5=T7; PR6=T8.
  Re-slice only with a recorded reason (size or review-focus), never to hide
  evidence.

## Progress and evidence

- 2026-09-29: Plan-only pass. Issue #497 read (approved, P0, no assignees, no
  comments, no existing PR, no prior `odd/tasks/497-*` artifact). No open PRs
  in the repo (base clean). Worktree
  `../muebles-worktrees/497-web-catalog-param-editor` created from
  `origin/main` @ `9ed33bda`. Read-only exploration (3 bounded parallel
  explorations + direct checks) established the facts cited in Problem/Scope;
  key sources: `packages/ui/src/modules/**`, `packages/domain/src/{smartFurnitureDomain,furnitureParameters,webAuthoringResolve}.ts`,
  `backend-go/internal/{api/furniture_catalog.go,storage/projects.go,domain/furniture_parameters.go,api/preconditions.go}`,
  `contracts/openapi/granete-api.v1.yaml`, migrations 000021/000083/000094/000103,
  `docs/architecture/{parametric-furniture-library,sketchup-authoring-interaction-contract,material-aware-furniture-resolution}.md`,
  `docs/design.md`. No product code written; `git status` clean except this
  artifact.
- Prerequisite state: #477 ✅, #483/#486 ✅, #448 ✅ merged; #496 OPEN (D1
  decision pending); Gate A satisfied per existing furniture-instance/design
  endpoints in the generated spec.
- 2026-09-29: **T1 implemented** — commit `490e6b1a` on
  `feat/497-web-catalog-param-editor` (base `9ed33bda`). Diff: 3 files,
  +98/−2 (`moduleDraftTransforms.ts` draft type + verbatim transforms +
  structural-only `parameterDefinitionRefRule` in `moduleDraftRule`;
  regression tests in `moduleHelpers.test.ts`; draft literal fix in
  `apps/web/src/stores/catalogStore.test.ts`). Key design fact: `objectRule`
  rejects unknown keys, so the field had to enter `moduleDraftRule` or every
  restored draft would fail `isModuleDraft`; the guard is structural-only
  (array of objects) so a domain contract growth can never discard restored
  drafts. V1 evidence: `packages/ui` vitest 2023/2023 (5 new: verbatim carry,
  restore/omit-empty, byte-for-byte edit-save incl. explicit `false` default,
  `isModuleDraft` accept/reject); `apps/web` vitest 558/558; root
  `pnpm typecheck` clean; root `pnpm test` green (all workspaces +
  databaseIsolation 16/16); `verify_affected.py --base origin/main --plan`
  selected all jobs (artifact = unknown input); executed the applicable
  `typecheck` + `typescript` gates once on the frozen candidate. V2
  NOT_RUN (browser/PostgreSQL untouched by this slice; no UI surface change).
  Delivery: partial (PR1 of the chain; #497 acceptance needs T2–T8).
- 2026-09-29: **T2 implemented** — one work-unit commit on
  `feat/497-web-catalog-param-editor` (base `9ed33bda` / PR1 head). Backend:
  migration 000142 + `domain.Module.Version` + conditional `UpdateModule` +
  handler ETag/If-Match/422/412 mapping (existence check BEFORE the
  precondition so PUT-404 → POST-create keeps working) + 422 helper shared
  with the furniture surface. Web: `Module.version`, mappers round-trip,
  repository version cache + `upsertModule` (If-Match; bare PUT fails closed
  on 428; 412 → `GraneteApiError`), catalog store stale warning toast +
  rollback, `updateModule` preserves the loaded version. V1 evidence: Go
  `internal/api` full suite ok (new `module_concurrency_test.go`: 428, 400
  malformed, expected-version forwarding + ETag, 412 typed, 422 typed, create
  v1+ETag, missing-row 404 without precondition); Go storage on disposable
  PostgreSQL 16 (`GRANETE_TEST_DATABASE=1` guard): new
  `TestModuleVersionConcurrency` (create v1 → update v2 → stale conflict
  without row mutation → version-less fail-closed → unknown-id 404) and
  `TestModulesVersionMigrationFreshAndUpgrade` (fresh default 1; legacy row
  upgraded to 1) PASS, plus adapted module tests PASS. TS: root `pnpm
  typecheck` 0 errors; root `pnpm test` all workspaces green (web 561 incl. 3
  new store tests, storage 229 incl. repository If-Match/412/428 + mapper
  version tests). Known environmental limit: the FULL `internal/storage`
  suite fails in the local disposable container on pre-existing
  RLS/tenant-boundary tests (auth sessions/devices, agregado tenant boundary)
  — reproduced identically on pristine `origin/main` in a temp worktree, so
  it is container role setup, not this change; CI's storage shards are the
  authoritative run for those. NOT_RUN: browser gate locally (CI
  organization-browser runs it); SketchUp host untouched. Delivery: partial
  (PR2 of the chain; remaining acceptance T3–T8).
- 2026-09-30: **T2 correction round (one consolidated round, per contract).**
  CI on PR2 caught two integration gaps local targeted runs missed:
  (1) storage fixtures pinning the schema at migration 103
  (`TestModuleParameterDefinitionsStorageRoundTrip`,
  `TestCreateAndUpdateModuleRejectPersistedDimensionDefinitions`) broke
  because CreateModule now scans `version` (migration 142) — their schema
  pins moved to 142 (they are store-contract tests; the pure migration
  tests at 102/103 stay pinned); (2) the browser gate hit
  `ModuleVersionUnknownError` on the seed-then-edit flow: a module seeded
  server-side mid-session leaves the editor without a cached version, and
  the bare PUT answered 428. Resolution — the client handshake is now
  learn-then-retry: on 428 the repository GETs the module's current version
  into the cache and retries the PUT ONCE under If-Match (still
  version-guarded; a mid-flight change answers 412); only an unlearnable
  version fails closed. `joinery-status.spec.ts` upsert helper got the same
  handshake for its direct API PUTs. Re-verified: root typecheck 0 errors,
  root pnpm test green (storage 230), Go parameter-definitions storage tests
  PASS on disposable PostgreSQL with the new pins. Commits: `0f4e9b7f` +
  correction `9fdb2639`; CI 17/17 on head `9fdb2639`.
- 2026-09-30: **T3 implemented** — one work-unit commit. Spec: 33 closed
  schemas + `/catalog/modules` + `/catalog/modules/{moduleId}` (If-Match/ETag),
  generated TS client + Go DTOs regenerated, drift gate extended (module PUT
  ETag+IfMatch, module GET ETag). Fidelity proof: the server wire was
  captured from a real storage round-trip into
  `packages/storage/src/catalogModule.wire.fixture.json` and a contract test
  validates it against `CatalogModule` and the mapper's write output against
  `CatalogModuleWrite` — the test immediately caught two real drifts: the
  mapper emitted legacy dead snake_case component fields the server never
  read (removed; the overrides bag is the only formula wire) and explicit
  `null`s where the Go wire is omitempty. Repository: `getCatalog` lists
  modules through `listCatalogModules` (runtime-validated), `upsertModule`
  is generated-client only with learn-first (unknown version → GET by id →
  404 ⇒ POST create, hit ⇒ versioned PUT); `version` is optional in the read
  schema because legacy backends omit it — the fail-closed lives at write
  time (`ModuleVersionUnknownError`). D1 resolved: increment landed in #497,
  #496 stays open (cross-reference comment posted). V1 evidence: root
  typecheck 0 errors; root `pnpm test` all workspaces green (storage 233
  incl. wire-contract + learn-first/412/POST-fallback tests; web 561);
  `go build ./... && go vet ./internal/...` clean (generated Go types are
  additive); `check_openapi_drift.py` PASS with the new assertions.
  NOT_RUN locally: browser gate (CI organization-browser runs it). Delivery:
  partial (PR3; remaining acceptance T4–T8). Commit `d2191d72`; CI 17/17;
  #932 awaiting review/merge.
- 2026-09-30: **T4 implemented** — one work-unit commit. V1 evidence: api
  stub suite 9/9 (accepted w/ synthesized dims + hash + revision echo;
  metadata-with-binding rejected without resolved; reserved name rejected;
  out-of-range sample → PARAMETER_OUT_OF_RANGE; missing module 404; unknown
  field 400; query 400; GET 405; inactive license 403; deterministic hash);
  storage parity on real PostgreSQL: preview(draft==persisted).definitionHash
  == published projection hash, revisionId equal, module row untouched
  (updated_at + version), deterministic across runs, golden fixture
  byte-pinned. TS: domain parser 3 tests (golden parse, rejected-smuggles-
  resolved, client-side draft rejection); root typecheck 0 errors; root
  `pnpm test` all workspaces green (domain 1727, web 561). NOT_RUN: browser
  gate (CI); SketchUp host unaffected. Delivery: partial (PR4; remaining
  acceptance T5–T8).

## Next step

Publish PR4 (T4) with `Refs #497 + Delivery: partial`; then T5+T6 (Parámetros
tab + binding editor, client-only, consumes the preview from T7) — or T5
alone; the "Probar resolución" wiring lands in T7 on top of T4's client
method.

## Next step

Publish PR3 (T3) with `Refs #497 + Delivery: partial`; then T4 (authoring
preview endpoint — contract path + implementation together, D2 naming
`POST /api/furniture/authoring/preview` proposed in the PR) or T5 editor UI
groundwork (client-only).
