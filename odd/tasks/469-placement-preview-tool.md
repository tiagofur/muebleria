# 469 Placement tool with cursor-following preview (increment 1)

Issue: #469 — [P1][SU-UX-2] Constraint-aware furniture placement, snapping and repeat placement
Base: origin/main @ 1484d20a2912e9132932c74653c67ffb1ed5d78b
Branch: feat/469-placement-preview
Status: MERGED via PR #832 (R1-R4). Increment 2 continues below.

## Increment 2 — semantic snaps + exact mm offset + visual feedback

Base: origin/main @ aec03be9 (includes #832 via 3394c60c)
Branch: feat/469-semantic-snaps
Status: IMPLEMENTED_PENDING_REVIEW

Scope (this increment): the three semantic snap families over the EXISTING
shared tool (no rewrite): wall/face back alignment (orientation derived from
the face normal, never resizing), floor/base plane (transform-only), and
furniture side-to-side against Granete-managed roots resolved by
`ManagedFurniture` metadata identity (never component name/GUID); a
deterministic candidate policy (per-axis ranking by displacement → type →
key, cross-axis composition with orientation-consistency filter — unit
tested); exact mm gap input through the host VCB (`onUserText` +
`enableVCB?`, no event stealing); viewport feedback (aligned-face highlight
+ Spanish label with target/gap; no matrices/IDs in UX). Revalidation at
click re-runs discovery from the fresh pick (stale targets cannot be
committed by construction). Snap/offset only alter the top-level transform
the canonical commit already consumes; negative proofs pin that
extents/materials/layout signature are untouched. Excluded: repeat
placement, #784, disconnected Library lane, dialog JS changes (VCB is
host-native).

### Design decisions pinned by tests

- Face candidates come from the host InputPoint face only (pick ON the
  plane); no synthetic ground plane — a free pick is never hijacked toward
  z=0 (#832 free-follow semantics preserved, suite green).
- Floor/base-plane candidates accept EITHER horizontal winding (±Z):
  Face#normal sign is not authority for walls (round 1) nor for floors
  (round 2) — a reversed floor is the same base plane; the smoke no
  longer forces floor.reverse!.
- Wall orientation is resolved from the CAMERA EYE side of the plane,
  never from Face#normal (review P1: a reversed face must never leave the
  furniture front facing the wall). No eye / eye exactly on the plane →
  no wall candidate (fail-safe, never guessed).
- Furniture sides are FINITE rectangles (review P1): the cursor must be
  within TOLERANCE of the side along the constrained axis AND within
  TOLERANCE of the side's span on the tangential axis and Z (clamped
  interval distance). Close-in-X-but-meters-away-in-Y/Z is not a target.
- Cursor-loop scan budget (review P1): the managed-neighbor provider (a
  full local model index) runs exactly ONCE per gesture (lazy snapshot)
  and exactly ONCE more at the click as commit-time revalidation against
  CURRENT geometry — never one model index per mouse event (call-count
  test pins 1 call for N moves, 2 with the click).
- Tolerance 250mm on per-AXIS anchor displacement; ranking
  (displacement, type furniture_side<face<floor, key) is a stable total
  order; wall+floor compose across axes; conflicting orientation
  proposals drop the weaker (never averaged/mirrored).
- The VCB gap applies to the PRIMARY (best horizontal) constraint and is
  keyed to that target's identity — it never leaks to a different or
  absent target.
- Arrows are answered with a hint while an orientation-proposing snap is
  active (the target fixes the front); free/floor rotation unchanged.
- Front-anchored grabs + wall snap exceed tolerance by construction
  (anchor must jump one depth) — documented behavior: grab a back corner
  to align to walls.
- Duplicated furnitureInstanceId roots, erased entities and frames off
  the quarter grid never become snap targets (fail closed).

### Known limitation (remaining #469 scope — do not overclaim)

Wall/face and side snapping support ONLY axis-aligned (quarter-grid)
planes: sloped walls and furniture rotated to arbitrary angles offer no
candidate. Arbitrary-angular support is remaining scope of #469; until
it lands, wall/face snapping is not "complete".

### Observed evidence (this candidate — final HEAD after both review rounds)

- `bundle exec rake verify` (homebrew ruby 3.2 + vendor bundle; env pin
  per memory) at the frozen candidate: RuboCop 228 files 0 offenses;
  1113 unit runs / 7258 assertions, 0 failures (seed-stable: 4242/12345/
  606/1/999 verdes tras hacer hermético el suite de fidelidad del
  stub); 6 boundary runs / 3359 assertions; RBZ deterministic readback
  (v0.1.6), sha256
  `0e53528336d5fcdd54ddedf1218c0caa799353704ab5e9dd4ea4c339ee97b752`.
- New `host_stub_faithfulness_test.rb` (3 runs, review r3 negative
  proof): the stub must never re-expose `Geom::BoundingBox#transform`
  nor `ComponentInstance#entities` — APIs the REAL host does not have;
  the faithful traversal (`Group#entities`, ComponentInstance via
  `definition.entities`) is pinned positively.
- Engine suite 36 runs: walls at 30°/37.5°/45°/23° (back on the rotated
  plane, eye-side orientation, reversed-wall identical placement, exact
  perpendicular gap 40mm along the normal — with the explicit negative
  that no world-axis coordinate equals it), neighbor sides at
  17/30/37.5/45/123° (fronts parallel, oriented plane x·right=600
  exact), gap 5mm perpendicular to a 37° run, the world-AABB
  negative-proof fixture (45°: oriented side plane ≠ AABB face), finite
  rectangle along the ORIENTED run axis, FINITE base-plane footprint
  (close-Z-but-meters-away-in-XY rejected; footprint covering the cursor
  snaps), tilted/mirrored frames fail closed, wall+rotated-side corner
  at 30°, wall+floor at 45°, horizontal-unit front, candidate tangents
  ⟂ normals (dot=0; floors carry none).
- Tool suite 50 runs: wall 30° back-face plane + reversed-wall transform
  equality; arbitrary-yaw basis unit/orthogonal/+Z vertical det +1;
  rotated neighbor 30° side-to-side with exact 5mm along the oriented
  normal + rigidity; stale 30°→35° rotation committed with the FRESH
  frame; wall+floor composition THROUGH the tool (preview + commit);
  base-plane budget 1/gesto + 1/click; distant floor never hijacks a
  free pick; base-plane click revalidation against a MOVED nested floor
  (fresh plane) and a DELETED one (wall survives, Z free).
- Controller suite 35 runs: the canonical commit PERSISTS
  placementEnvelopeMm (dimensionsMm-derived) read back through the real
  convergence path; provider uses the persisted envelope, never
  definition.bounds (protruding-asset regression; units without
  envelope excluded); rotated 45° root yields the oriented descriptor;
  exclusions unmanaged/duplicated/erased/tilted/scaled/mirrored; the
  base-plane provider RECURSES into Groups and Component instances with
  the accumulated world transform (world footprint, tilted container
  rejected, no requests); lanes compose wall 30° + floor through the
  real tool with a real working-copy PUT.
- TestUp `TC_PlacementPreviewSmoke`:
  `test_arbitrary_angle_wall_neighbor_composition_and_undo` (A wall 30°
  + 40mm VCB gap with camera-fixed room side, B same wall reversed →
  identical placement, C managed neighbor rotated 30° → FI_2
  side-to-side 5mm over the PERSISTED envelope, D wall+floor
  composition THROUGH THE REAL TOOL with the controller-shaped
  providers — recursive scan + finite footprints, E cancel zero
  residue): NOT_RUN this session — no host available; owner-coordinated
  like R1-R4.

### Review corrections (ronda 2 sobre el candidato, mismo PR)

1. **P1 — base planes espacialmente finitos + nesting**: el provider de
   base planes ya no trata cada cara horizontal como un plano infinito
   global. El scan es RECURSIVO (Groups/ComponentInstances con el
   transform acumulado — los room fixtures no tienen que vivir en la
   raíz; se parte de la raíz del modelo de forma determinista, no de
   active_entities, para que snapshot y revalidación no diverjan con el
   contexto de edición abierto) y cada plano conserva su FOOTPRINT
   mundial (bounds transformados: intervalo XY + punto del plano); el
   motor acepta un base plane sólo si el cursor está a ≤250mm del
   footprint en AMBOS ejes XY además de la tolerancia Z — una plataforma
   cercana en Z pero a metros en XY ya no gana. La normal MUNDIAL debe
   seguir vertical (contenedor inclinado → sin candidato). Planes sin
   footprint (la cara picada vía InputPoint) siguen infinitos: el pick
   está sobre la cara por construcción. Presupuesto intacto: 1 scan por
   gesto + 1 revalidación en click. Regresiones A (plataforma lejana en
   XY, engine), B (piso bajo el cursor compone con pared, tool +
   controller con PUT real), C (piso equivalente en Group y en
   Component con transform, provider), D (piso movido/borrado pre-click:
   commit contra el plano fresco o caída segura con la pared intacta,
   tool).
2. **P2 — evidencia consistente**: el body del PR y este artifact citan
   exactamente el HEAD final (runs/assertions/archivos/RBZ arriba); los
   números del primer candidato quedan sólo en el historial de pushes.

### Review corrections (ronda 3 sobre el candidato, mismo PR)

1. **P1 — APIs ficticias del stub eliminadas**: el footprint mundial de
   un base plane se calcula desde las POSICIONES de los vértices
   transformadas (`Face#vertices → position.transform(world) → min/max`)
   — el `Geom::BoundingBox#transform` que el stub había inventado NO
   existe en la API real y se eliminó. La recursión es HOST-FAITHFUL:
   `Group → entity.entities`, `ComponentInstance →
   entity.definition.entities` (un ComponentInstance real no tiene
   #entities); el `ComponentInstanceStub#entities` inventado se
   eliminó. Prueba negativa nueva (`host_stub_faithfulness_test.rb`)
   prohíbe reintroducir ambas APIs fantasma y fija el camino fiel; los
   tests de piso anidado en Group + Component siguen pasando sin APIs
   inventadas. Se preservan footprint finito, transforms acumulados,
   1 snapshot por gesto, 1 refresh en click y cero backend por mouse
   move.

### Review corrections (ronda 4 sobre el candidato, mismo PR)

1. **P1 — el scan de base planes NO desciende dentro de muebles
   Granete**: todo Group/ComponentInstance cuyo metadata marque
   `kind == furnitureInstance` (conectado o local) se PODA de la
   recursión — los boards/estantes/tapas/herrajes de un mueble colocado
   son mueble, no pisos de habitación, y no pueden convertirse en
   candidatos "Piso" que le ganen al piso arquitectónico por menor
   distancia Z. Regresión: mueble vecino con bottom board (z=0),
   estante (z=400) y tapa (z=720) → ninguna cara horizontal suya emite
   base plane; el piso arquitectónico cercano sí (y es el único). Se
   preservan groups/components arquitectónicos anidados, transform
   acumulado, footprint finito y el presupuesto 1/gesto + 1/click.
2. **P2 — footprint documentado como aproximación**: el criterio actual
   es una APROXIMACIÓN POR RECTÁNGULO DELIMITADOR (min/max XY de los
   vértices mundiales) — conservadora ante caras cóncavas, L-shapes y
   agujeros (los puntos del notch quedan incluidos; pinneado
   explícitamente en el test del engine para que el cambio a un
   footprint polygon-aware sea deliberado). SCOPE RESTANTE CONCRETO de
   #469: reemplazar el bounding-rectangle por un footprint poligonal
   real (loops con holes / prueba point-in-face o proximidad
   equivalente). El código y el PR NO lo describen como footprint
   exacto.

### Review corrections (ronda 5 sobre el candidato, mismo PR)

1. **P1 — base planes respetan la VISIBILIDAD EFECTIVA del modelo**: el
   scan mantiene el INSTANCE PATH durante la recursión y consulta la
   API REAL `Model#drawing_element_visible?(path)` (verificada en la
   documentación oficial: existe desde SketchUp 2020.0, acepta un
   `Array<Sketchup::Drawingelement>` — o `InstancePath` — y responde por
   el estado ACTUAL del modelo: flag propio, Tag/Layer y TODOS los
   padres de la ruta). El único host objetivo del repo es SketchUp
   2026.2 (README), donde el método existe y el bug documentado
   (excepción cuando el ÚLTIMO elemento del path era Group/Component,
   corregido en 2026.0) no aplica. Fallbacks EXPLÍCITOS y documentados
   para hosts más viejos, nunca silenciosos: método ausente (<2020) →
   caminata por-elemento (visible? + Layer visible? a lo largo de la
   ruta); ArgumentError (bug <2026) → "no se puede decidir → descender"
   — la llamada a nivel FACE (paths que terminan en Face, nunca
   afectados por el bug) es la autoridad. Orden preservado: visibilidad
   → prune furnitureInstance Granete → emitir Face / descender. El
   click re-valida la visibilidad (un piso oculto entre preview y
   commit no puede quedar en la solución). Presupuesto intacto: la
   visibilidad se evalúa DENTRO de los scans 1/gesto + 1/click.
   Regresiones: A piso oculto (z=80) ABSENT de los descriptores contra
   un visible z=0; B Tag apagado (Layers#add + Layer#visible= +
   Drawingelement#layer= — superficie REAL en el stub); C Group padre
   oculto; D ComponentInstance padre con Tag apagado; E los mismos
   contenedores anidados visibles siguen participando con transforms
   acumulados; F click revalida (pared sobrevive, Z cae a la
   inferencia fresca); G prune Granete sigue verde.
   `host_stub_faithfulness_test.rb` fija la firma/semántica del
   `drawing_element_visible?` del stub (propio, padre, tag) junto a
   las negativas existentes (BoundingBox sin #transform;
   ComponentInstance sin #entities). El smoke añade un piso oculto
   MÁS CERCANO en Z al escenario D (visible=false vía la API real) —
   NOT_RUN, coordinado con el owner.

### Versión 0.1.6 + footer de versión desde la fuente del plugin

- `EXTENSION_VERSION` 0.1.5 → 0.1.6 (identity.rb, única fuente).
- El rodapié del diálogo ya NO es texto plano: el markup lleva
  `id="granete-version-footer"` sin versión hardcodeada (el texto
  estático decía "v0.1.4" — dos versiones atrás) y
  `handle_dialog_ready` empuja
  `setPluginVersion({version: EXTENSION_VERSION})` por el bridge; el JS
  de la página renderiza "Granete for SketchUp · v<versión>" (payload
  sin versión no toca el texto). Tests: suite Ruby de dialog_controller
  (orden status → setPluginVersion → setCatalog con el valor exacto de
  identity.rb) + `dialog_version_footer_test.js` bajo node (sin literal
  de versión en el markup + render del valor pusheado + nil-safety).
- Instalación para pruebas del owner sobre SketchUp 2026.2 (host
  cerrado; backup del 0.1.5 previo conservado).

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
