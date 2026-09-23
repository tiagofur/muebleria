# 469 Placement tool with cursor-following preview (increment 1)

Issue: #469 — [P1][SU-UX-2] Constraint-aware furniture placement, snapping and repeat placement
Base: origin/main @ 1484d20a2912e9132932c74653c67ffb1ed5d78b
Branch: feat/469-placement-preview
Status: R1 review corrections applied (CHANGES_REQUESTED on 2921e9f7); V0/V1 green; V2 host NOT_RUN

## Scope separation from parallel work (coordination registry)

The repository's per-issue ODD artifact is the coordination mechanism (the
global progress ledger was removed in 3a3e0547). Registration:

- #469 increment 1 (this artifact): SketchUp **placement interaction** —
  shared preview tool, Project + Library entry points, Ruby plugin + HtmlDialog
  JS + focused tests. Files: `apps/sketchup-extension/` only.
- Codex (separate writer, own worktree `~/.codex/worktrees/398-host-candidate`,
  branch `codex/642-nullable-commercial-summaries`, clean tree @ f610948d):
  pre-Q1 #398 digital-thread fix via child issue #642 — `backend-go/internal/
  storage/quote_revisions.go`, `quote_commercial_summaries_test.go`, and
  `odd/tasks/642-nullable-commercial-summaries.md`. Zero file overlap with this
  increment; no shared reservations. Integration point: none required — this
  increment does not touch backend, contracts or commercial summaries.

## Bounded increment (this PR)

Main walk: Proyecto panel → pendiente → Colocar → shared placement tool →
ghost preview follows cursor from a semantic anchor → SketchUp inference →
click → canonical `place_existing_furniture(transformation:)` (same
furnitureInstanceId, no commercial quantity change) → working-copy convergence.
Esc cancels with zero residue; unit stays pending. One placement = one host
undo operation. Biblioteca (connected, #390) consumes the SAME tool; identity
is minted only inside the commit callback.

Reuse (no new mutation machinery):

- canonical command: `Model::FurnitureBuilder#place_existing_furniture`
  (already accepts `transformation:`/`prepare:`) — extended callers only;
- `Connection::ProjectFurniture::Placer#place` / `#create_and_place` — new
  optional `transformation:` threaded to the canonical command;
- `PositionSyncCoordinator#converge_inserted_unit` — unchanged post-insert
  convergence (readback-validated PUT);
- `ManagedFurniture` scans — unchanged; the preview draws only through
  `view.draw` (no entities, no definitions, no metadata → invisible to scans,
  WorkingCopy, undo and publication by construction);
- new `Tools::FurniturePlacementTool` — interaction only; holds NO transport,
  NO service, NO builder: it physically cannot issue a request per mouse move
  or mutate the model.

Preview data (dimensions/orientation) resolved server-side at Colocar time,
outside the cursor loop, from the existing authoritative NativeLayout
(`dimensionsMm` [w,h,d]; fallback: AABB derived from the resolved boards —
preview/compat use per interaction-model §7). Furniture-local frame per
engine convention: X=width, Y=depth (front = +Y at max depth), Z=height;
origin = back-left-bottom. Anchors: BACK_LEFT_BOTTOM (default),
BACK_RIGHT_BOTTOM, FRONT_LEFT_BOTTOM, FRONT_RIGHT_BOTTOM. Tab cycles anchor,
←/→ rotate 90° about Z through the anchor — preview transform only, never
productive geometry (negative proofs included).

## Exclusions (this increment)

- No semantic snapping (wall/face/furniture-side), no numeric mm offset input,
  no repeat placement, no advanced snapping UI — later #469 increments.
- No backend/contract/migration changes; no #391 duplication; no PTX/CNC.
- Disconnected/local Library insert (`insert_furniture`, offline lane) keeps
  its current origin+Move behavior — local-compat lane per offline/fallback
  rules, not the professional connected flow; noted for a later increment.
- No real-host install/run this session (owner coordinates host validation);
  TestUp real-host rehearsal documented as NOT_RUN.

## Verification plan

V0: rake syntax/lint; V1: focused Ruby unit tests (tool mechanics, placer
transformation threading, controller preview flow with FakeTransport journal,
JS dialog tests under the node harness); V2: RBZ build + SHA-256 + TestUp
rehearsal spec prepared but NOT_RUN (host).

## Observed evidence (this candidate)

- R1: `bundle exec rake verify`: 965 unit runs / 6491 assertions + 6
  boundary runs / 3287 assertions, 0 failures; 222 files lint-clean.
- Focused suites: `furniture_placement_tool_test.rb` 17 runs (anchor math on
  the 800×560×2100 asymmetric fixture, quarter-turn rigidity, double-click
  single commit, Esc/deactivate zero-residue, late-event discard, one
  InputPoint pick per mouse move, extents from dimensionsMm/boards-AABB);
  `placement_preview_flow_test.rb` 10 runs (preview resolves without POST/PUT
  or model mutation, commit lands the accepted transform with the same
  furnitureInstanceId and ONE 'Colocar Mueble' undo operation, no Move
  handoff with a final transform, stale-context commit fails closed, catalog
  preview never mints identity, commit mints exactly one with the idempotency
  key, first render keeps resolved materials); `dialog_placement_preview_
  test.js` 9 tests under node (both entry points route to the shared
  callbacks, honest disabled/re-armed states, cancel keeps the unit pending,
  legacy fallbacks preserved).
- RBZ built deterministically; SHA-256 recorded in the PR body.
- REAL HOST (TestUp `TC_PlacementPreviewSmoke`): NOT_RUN this session — no
  install/restart allowed; the owner coordinates the host validation. The
  spec covers preview → cancel → place → undo → redo with the invariants.

## R1 review corrections (this candidate)

1. Gesture context captured and verified: begin stores model + binding
   triple + unique gesture id + layout fingerprint
   (`PlacementGuards.layout_signature`: definition + dimensions +
   occurrence ids); commit fails closed `context_changed` on a different
   model OR a different binding inside the SAME model, and
   `composition_changed` when the authoritative composition no longer
   matches the previewed one — before any host/server mutation.
2. No silent returns: a second entry point while a preview is live gets a
   correlated `preview_busy` answer and its controls re-arm; select_tool /
   activate failures answer `activation_failed` with the session
   discarded — the retry works (tested).
3. Invalid InputPoint picks invalidate the stale position (preview stops
   drawing, click cannot commit on it); the click RE-PICKS at its own
   coordinates and commits only on the fresh verified position. Single
   confirmation and zero requests during movement preserved.
4. The anchor label draws at the projected SCREEN point
   (`View#screen_coords` + pixel lift); the test asserts the exact point.
5. Smoke now prohibits POST /furniture-instances specifically (not the
   legitimate binding:validate POSTs); new controller suite (14 tests)
   covers the DialogController lifecycle end-to-end including the REAL
   convergence through PositionSyncCoordinator/SafeWrite (one PUT with
   the #810 workingVersion token + authoritative readback).
6. Catalog extents failure fixed (`key_name:` call-site bug) with an
   end-to-end negative test (`preview_unavailable` + definitionId).
   Lifecycle: Esc, tool switch, model change, binding change and dialog
   close all cancel cleanly; a late end of an OLD gesture cannot cancel,
   clear or answer for a NEW one (gesture-matched handlers; the ensure
   block only consumes the session of a gesture that actually ran).

## Remaining for #469 (not this increment)

- Semantic snapping (wall/face, furniture side-to-side, floor), numeric mm
  offsets, repeat placement, anchor/rotation UX usability on the real host,
  real-host evidence for the whole walk, disconnected Library lane
  (`insert_furniture`) still origin-first (local-compat lane).
