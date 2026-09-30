# ODD — #939 resolve contract drift: schema `recipes` + fixed-shelf golden

- Issue: #939 (bug, status:approved). Owner authorized the correction in
  conversation 2026-09-30 after the drilling-profiles audit.
- Lane: ODD (two coherent work units over one contract surface).
- Base: `origin/main` @ `786f46ef`. Branch: `fix/939-resolve-schema-recipes-golden`.
- No other writer on these files; no open PRs at start.

## Facts established (read-only)

- `contracts/sketchupAuthoringResolve.schema.json` `$defs/relationship` is
  `additionalProperties:false` with `families` but no `recipes`, while the Go
  decoder (`authoring_resolve.go:94`), the TS request validator
  (`sketchupAuthoringResolve.ts:600-685`, `RELATIONSHIP_KEYS` includes
  `recipes`), and Ruby (`AuthoringRecipeValidation`,
  `authoring_resolve_contract.rb:459-540`) all accept/validate `recipes`.
  Introduced by J2-B PR #911 (commit `9307f974`), which updated the response
  `relationshipProvenance` def but not the request-side relationship def.
- No resolve-level golden scenario exercises `fixed-shelf-side` + `recipes`
  (named remaining scope in `odd/tasks/874-j1-contact-machining.md`).
- `packages/domain/src/sketchupAuthoringResolve.schema.test.ts` validates
  every golden scenario request+response against the schema, so a
  recipe-bearing golden scenario is the natural RED for the drift.
- Shape constraints to mirror (union of the three code validators, pure shape
  only): recipe keys contactId/recipeId/recipeRevision/technicalProfileId/
  technicalProfileRevision/rules; rule keys ruleId/ruleRevision/
  participantRole(A|B)/operationRole/entryFace(6 faces)/offsetMm[3]/
  axis[3]/diameterMm>0/depthMm>0. Semantic gates (fixed-shelf-side only,
  exact contactIds, complete coverage, recipes⊕families, unit axis) stay in
  code — same split `families` already uses.
- DISCOVERY during WU2: the fixture's `mod-comp-shelf` occurrence is authored
  across the cabinet — its width 542 spans assembly X (18→560) and its length
  564 spans assembly Y (18→582), so its x-planes are width faces
  (`left`/`right`) outside the A0a contact classes (A face ∈ {bottom,top},
  B face ∈ {front,back}) and its X span never reaches both side inner faces
  (582). The top panel has no Z overlap with the sides. The honest productive
  golden therefore declares the floor panel (the same verified contacts as
  scenario 20 — the fixed-panel↔sides joint class) with kind
  `fixed-shelf-side`; the scenario comment documents this explicitly.
- SECOND DISCOVERY (golden's acceptance gate): the Ruby extension provenance
  parser (`AuthoringResolveWireParsing.provenance`) still whitelisted only
  `sourceKind/relationshipId/catalogRuleId` for relationship provenance —
  missing `familyId` (since #908; never exposed because no golden with
  families emits operations) and the recipe identity fields (since #911).
  Fixed fail-closed: variant whitelist extended, unknown keys still reject.

## Tasks

- [x] WU1 RED: schema test accepts a recipe-bearing fixed-shelf-side request
      and rejects malformed rules (unknown key, bad participantRole, non-3
      vector, non-positive depth) — RED: `must NOT have additional properties`.
- [x] WU1 GREEN: `$defs/contactOperationRecipe` + `$defs/contactOperationRule`
      added; `recipes` property on `$defs/relationship`. Schema test 6/6.
- [x] WU2: golden scenario `28-fixed-shelf-recipes` (floor↔sides, kind
      fixed-shelf-side, per-contact recipes `test:synthetic-fixed-shelf`,
      stationCount 3, margins 30/50). Go-authored regeneration; fixture diff
      is 1417 additions / 0 deletions (pre-existing scenarios byte-identical);
      golden test idempotent without regen.
- [x] WU2 hand verification: stations left [30,261,492] / right [30,252,474]
      (same useful spans as scenario 20); 12 productive ops (3 stations ×
      pilot+counterbore × 2 contacts) with recipe provenance; pilots enter
      the panel via bottom (left) / top (right) at depth 12; counterbores
      enter the sides through their outer faces (side-left `back` x=0,
      side-right `front` x=600) at offset 18, depth 9; hole local coords
      match the #356 face convention (verified per-side against the
      published localTransforms).
- [x] WU2 parity: TS contract test recomputes scenario 28 (ops, statuses and
      full manufacturing fingerprint byte-for-byte; presence + joinery
      lists pinned). Ruby parses the golden fail-closed after the provenance
      vocabulary fix (49 runs, 534 assertions; positive + unknown-key pins).
- [x] WU3 cleanups (separate commit): dead `inward` local removed from Go
      `stationHole`; stale TS foundation comment refreshed.
- [x] Freeze: Go engine+api `-count=1` ok; gofmt clean on touched files
      (repo-wide gofmt debt pre-existing, untouched); full domain 1734/1734;
      full workspace TS suites green (storage 239, excel 649, ui 2042, web
      561, desktop 17, mobile 87, databaseIsolation 16); root typecheck ok;
      OpenAPI drift ok; ci-scripts/factory checks ok; rubocop clean on the
      two touched Ruby files; Ruby contract test 49/49.

## Evidence log

- 2026-09-30 startup: preflight `PREFLIGHT_OK_NOT_VERIFIED` (main, untracked
  docs only). Branch created from fetched `origin/main` @ `786f46ef`.
- 2026-09-30 WU1: RED captured (schema test), GREEN after schema edit.
- 2026-09-30 WU2: first regeneration attempt with the shelf as source failed
  CONTACT_FACE_REQUIRED → geometry probed via a temporary api test (removed)
  and the published `localTransform` wire; discovery recorded above; final
  scenario uses the floor as the fixed participant and verifies hand-computed
  expectations exactly. Ruby RED (ambiguous provenance) → provenance
  vocabulary fix → 49/49.

## Round 2 — owner correction (2026-09-30): "el entrepaño debe ser como el piso"

- The owner reviewed the cross-orientation discovery and ordered the fix:
  interior panels must share the floor board's rotation and X/Y measures.
  Root cause found: the catalog definition already matched the floor
  (LengthFormula PW-2*T, WidthFormula PD-T); the cross orientation came from
  `defaultPoseForPlacement("interno", …)` having NO rotation (Go layout.go +
  TS twin spatialPlacement.ts), unlike base/superior (rotateY 90).
- Fix: interno pose gains rotateY: 90 in both runtimes. Regenerated golden:
  scenario 28 now uses the real entrepaño occurrence (moved to z=400) as the
  fixed panel — both side contacts VALID, stations [30,261,492] both contacts
  (the shelf's width spans the full interior depth), MACHINING_READY with 4
  productive operations / 12 holes carrying recipe provenance; hand-checked
  hole coords against the published localTransforms (shelf pilots local
  x=30/261/492 y=9; side counterbores 512/281/50 and 530/299/68 at z=409).
- Second contract incompatibility the golden exposed: the authored
  fixed-shelf-side joint still materialized the legacy shelf-support binding
  for the same panel and both systems drilled the same faces (minifix Ø15 vs
  recipe pilot Ø3 at [492,9]) — DRILLING_CONFLICT. One panel end carries one
  joint system: `materializeBoundRelationships` now suppresses the
  shelf-support binding for a source panel that carries an authored
  fixed-shelf-side joint; other boards keep theirs (pinned both ways in
  TestAuthoredFixedShelfRecipeReplacesShelfSupportBinding).
- Fixture diff vs main is no longer additions-only: scenarios containing the
  shelf change machining/localTransform with the corrected orientation
  (160 additions / 450 deletions at round-2 HEAD); the catalog revision is
  unchanged (the rotation lives in the layout pose, not the catalog).
- Re-verification at round-2 HEAD 8046cde6: gofmt clean on touched files;
  Go engine+api ok; full Go suite 14 packages ok; domain Vitest 1734/1734;
  full workspace TS suites green (storage 239, excel 649, ui 2042, web 561,
  desktop 17, mobile 87, databaseIsolation 16); root typecheck ok; Ruby
  contract test 49/49; golden idempotent without regen.
- NOT_RUN locally (CI gates for the exact HEAD): Go with isolated
  PostgreSQL, Foundation Gate A postgres/browser, TestUp/host, machine
  proof. No V2 claim beyond CI's own gates.
