# 469 Placement tool with cursor-following preview (increment 1)

Issue: #469 — [P1][SU-UX-2] Constraint-aware furniture placement, snapping and repeat placement
Base: origin/main @ 1484d20a2912e9132932c74653c67ffb1ed5d78b
Branch: feat/469-placement-preview
Status: R1-R4 review corrections applied (R4 on b98c8637); V0/V1 green; V2 host pending owner walk

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
- R2: `bundle exec rake verify`: 978 unit runs / 6558 assertions + 6
  boundary runs / 3287 assertions, 0 failures; 222 files lint-clean
  (controller lifecycle suite now 22 tests; tool suite 26).
- R3: `bundle exec rake verify`: 983 unit runs / 6584 assertions + 6
  boundary runs / 3287 assertions, 0 failures; 222 files lint-clean
  (controller suite 27 tests: refresh-conserva, re-enrollment, logout,
  backend, contexto ilegible, begin sin contexto, sólo-basis ×2).
- R4: `bundle exec rake verify`: 1022 unit runs / 6791 assertions + 6
  boundary runs / 3287 assertions, 0 failures; 224 files lint-clean
  (+11 real-DeviceProvider context tests, +1 counterfactual basis
  characterization with its 27 inherited reruns). Installed host build
  (v0.1.5 @65fdd6d1) predates R3/R4 — reinstall is OUT of scope for this
  round and remains owner-coordinated.
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

## R2 review corrections (same candidate line)

1. Real close: `cancel_active_placement_preview` runs from the dialog's
   own `set_on_closed` (native X, `close_dialog` callback via
   dialog.close, and controller.close all converge there), idempotent,
   no recursion, no bridge pushes to a closed dialog; the three routes
   are tested and a dead tool can no longer commit afterwards.
2. Preview geometry: `layout_signature` now digests per-board geometry
   (width×thickness×length + local translation) in addition to ids — a
   600→900 board change under unchanged ids without dimensionsMm fails
   closed; extents derivation keeps the local MINIMUM (origin_mm) so the
   anchor maps the real furniture box (shifted-layout test proves the
   committed transform anchors the box minimum at the click).
3. Tool lifecycle: the tool holds the model captured at gesture time
   (never the dynamic active model), deactivation by tool switch does
   NOT select_tool(nil) over the user's next tool (explicit cancels
   still restore), activate is idempotent (host select_tool + explicit
   activation), and a failure AFTER select_tool cleans the model and
   session with a working retry.
4. Authenticated context: `Service#context_fingerprint` (backend
   endpoint + one-way SHA-256 of the current credential — no secret
   travels or persists) is captured with the gesture; logout, a rotated
   session or a different backend invalidate the commit even when model
   and binding ids are unchanged. Tested with doubles; no Keychain or
   owner credentials touched.
   Controller regressions run through the REAL boundaries: window
   callbacks (dialog.callbacks fetches, set_on_closed block, close_dialog
   route) and the host tool protocol (onMouseMove/onLButtonDown/
   onKeyDown/deactivate on the actual selected tool).

## R3 review corrections (same candidate line)

1. Geometric fingerprint now covers the full #414 frame:
   `LayoutBoardTransform#geometry_fingerprint` (authority-owned) digests
   size + translation + BASIS with rounding; `layout_signature` consumes
   it, so a rotation-ONLY change (same id/sizes/translation, no
   dimensionsMm) is detected as composition_changed before insert or
   identity creation. The 600→900 and origin_mm regressions stay.
2. Authenticated context with explicit semantics: the bearer is never
   the identity. `Auth::Provider#session_context_id` (DeviceProvider:
   one-way digest of the token's NON-VOLATILE claims + server endpoint;
   base/Null: nil) is stable across a technical token refresh, changed
   by logout/re-enrollment/backend switch, nil when unknown/unreadable.
   The gesture STARTS only under a pinnable context
   (auth_context_unavailable otherwise) and the commit guard fails
   closed on nil — [nil] never equals [nil]. Server-side validations in
   the canonical commands are untouched.
   2026-09-23: v0.1.5 (65fdd6d1) installed on the owner's SketchUp 2026
   for manual pruebas (backup of 0.1.4 kept); the R3 candidate is a
   LATER HEAD — reinstall after review when the owner closes SketchUp.

## R4 review corrections (same candidate line)

1. Session identity projection is EXPLICIT against the real Go issuer
   (Authority.issueToken renews jti/nbf/exp/iat on every mint):
   CONTEXT_IDENTITY_CLAIMS whitelists session (sid, auth_started_at),
   user, org/membership, credential epochs, transport boundary — volatile
   mint claims are excluded by construction. Validity gates: configured?,
   refresh attempt, still-expired-after-refresh → nil, empty payload →
   nil, missing essentials (user + transport boundary) → nil. A decodable
   payload alone is not a usable identity. Go renewal behavior, token
   validation and server authorization untouched.
2. The REAL DeviceProvider runs hermetically
   (device_provider_context_test.rb, 11 tests — same secure-storage
   override as the #460 suite; no Keychain, no credentials, no network):
   full renewal (jti+nbf+iat+exp) keeps identity; jti-only and nbf-only
   keep it; new session / org / membership / credential epoch change it;
   logout and expired-without-recovery yield nil; empty payload and
   missing essentials yield nil; expired-with-recovery restores; backend
   endpoint participates. FakeAuth controller tests kept.
3. Rotation-only fixture now isolates basis: dimensionsMm IDENTICAL on
   both endpoints, ids/sizes/translation unchanged, only basis rotates.
   Counterfactual characterization test proves the old basis-less
   signature is blind (placement wrongly succeeds) while the live
   signature answers composition_changed — no geometry inserted, no
   FurnitureInstance created on either lane. Width 600→900 and origin_mm
   regressions preserved.

## Remaining for #469 (not this increment)

- Semantic snapping (wall/face, furniture side-to-side, floor), numeric mm
  offsets, repeat placement, anchor/rotation UX usability on the real host,
  real-host evidence for the whole walk, disconnected Library lane
  (`insert_furniture`) still origin-first (local-compat lane).
