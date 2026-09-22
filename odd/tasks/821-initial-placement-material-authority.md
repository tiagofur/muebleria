# 821 Initial SketchUp placement must carry the exact quoted materials and textures

Issue: #821 — [P0][SU-MAT] Colocación inicial SketchUp pierde materiales/texturas exactas de la cotización
Base: origin/main @ 7b5fc2b33b8e2dcc030bbb26d406c74626da75de
Branch: fix/821-initial-placement-material-authority
Status: implemented — V0/V1 green; V2 REAL HOST: NOT_TESTED (TestUp smoke added, not yet run on the installed RBZ)

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
