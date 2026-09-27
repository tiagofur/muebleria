# #870 — Project Furniture missing unit: restore original position or place manually

## Objective and authorization

Issue: https://github.com/tiagofur/muebleria/issues/870 (`status:approved`,
owner-created 2026-09-27). Tracks #389, #469 and #723; post-#848 product/demo
work (does NOT reopen #848). Base `1ca9951a5ccfae3a72f4537fe151bb490b25f7a2`
(origin/main), branch `feat/870-missing-unit-dual-recovery`, one writer.

A `missing_local` Project Furniture unit offered one oversized action
("Restaurar en este archivo") that visually dominated the card. This work
gives the SAME existing unit two compact, same-level recovery intents:

1. **Restaurar posición** — the Restorer at the recorded WorkingCopy
   transform (behavior unchanged, new label only).
2. **Colocar manualmente** — the existing #469 placement preview reinserts
   THAT unit at a user-chosen transform. No new unit, no second tool,
   session manager, callback or payload.

## Root design facts (from the pre-implementation audit)

- `Placer#place` rejected `missing_local` rows (`host_reconciliation_required`,
  from a38d518c/#723) to keep missing units out of the ordinary
  origin+Move lane; `resolve_unit` and `prepare_placement_preview` already
  admitted them, so a preview would start and fail only at the click.
- The ordinary `placement_inputs` seeds parameters from the quoted display;
  the Restorer uses the WorkingCopy item verbatim (`preserve_parameters`).
  Merely relaxing the guard would rebuild an authored unit with quoted
  seeds — an authored-configuration regression (#821 class).
- Therefore the manual lane resolves inputs from the authoritative
  WorkingCopy item in BOTH `prepare_placement_preview` and the commit, so
  the pinned `layout_signature` covers the authorized composition and the
  existing `converge_inserted_unit` merge-PUT owns only transform/locator.

## Work unit

- [x] Ruby `Placer`: `placement_admission` (missing_local admitted ONLY
      with an explicit preview transformation; incompatible/unknown and the
      origin+Move path stay fail-closed), `missing_local_row?`,
      `resolve_placement_inputs`, `missing_unit_inputs` (item verbatim),
      `insert_physical_unit` gains `preserve_parameters:` pass-through.
      Zero changes to PlacementPreviewBridge / bridges / callbacks.
- [x] JS `granete-project-furniture.js`: `pfPlacing` entries carry
      `{button, label, lane}` so the shared #469 handlers re-arm each lane
      with its own label; lane-aware cancel copy; missing card is a stacked
      recovery card (`pf-unit-card--recovery`) with the new plain copy,
      muted `Unidad <short-id>` ref line and the two compact actions below
      (mutually exclusive while either is in flight).
- [x] CSS `project.css`: `.pf-unit-card--recovery` (column), `.pf-unit-actions`
      (flex-wrap, token gap) and compact `.pf-unit-actions .btn`
      (padding `--space-2/--space-3`, width auto) — tokens only.
- [x] Tests: JS focal harness (dual-recovery section), integrated dialog
      harness, Ruby placer + preview-flow suites.
- [x] Docs: `sketchup-host-reconciliation.md` §5 documents both intents and
      the manual-lane rules.

## Identity invariant proofs

- Ruby: manual placement of a missing unit issues NO POST
  `/furniture-instances`, stamps the SAME `furnitureInstanceId`, reinserts
  exactly one root, and the layout resolve demonstrably consumed the
  WorkingCopy item's parameters/choices (not the quoted display).
- Ruby: without an explicit transformation the lane stays
  `host_reconciliation_required` (existing test kept green).
- Ruby: composition drift between preview and click fails closed
  (`composition_changed`, nothing inserted).
- JS: the missing lane never calls `create_project_furniture` (explicit
  bridge assertion + the module keeps zero create-flow symbols).

## Verification (all on this candidate, main checkout, ruby 3.2.11)

1. `node test/js/granete_project_furniture_test.js` — 41/41.
2. `node test/js/dialog_project_furniture_test.js` — 27/27.
3. `ruby -Itest test/unit/project_furniture_test.rb` — 59 runs, 455
   assertions, 0 failures (includes the 2 new #870 tests).
4. `ruby -Itest test/unit/placement_preview_flow_test.rb` — 15 runs, 97
   assertions, 0 failures (includes the 2 new #870 tests).
5. `bundle exec rake verify` — PASS (syntax + lint 261 files 0 offenses +
   unit + boundary 6 runs/4043 assertions + package readback; RBZ sha256
   e3fd9e7001596ed105614aa55ec264e1c6e8b3e5e9b66633199ee9a3640212e4).
   RuboCop note: the first pass showed 6 offenses introduced by this work
   (AbcSize/MethodLength/ModuleLength/EmptyLineAfterGuardClause); fixed by
   real extraction (no new disables), file back to 0 offenses.
6. `git diff --check` clean.
7. `verify_affected.py --base origin/main --plan` selects all jobs
   conservatively (pre-existing untracked inputs); the applicable job for
   this diff is `sketchup-local-os: bundle exec rake verify` → executed,
   PASS. No backend/React/generated-contract file changed, so Go/TS jobs
   are outside this diff's surface.

NOT_RUN (declared, not substituted): real-host SketchUp smoke of the two
recovery actions (V2 evidence per apps AGENTS — needs the owner's host);
browser/PostgreSQL gates (untouched surfaces).

## Scope and exclusions

Only the missing-unit dual recovery. No backend, no React, no #848, no
recovery of `incompatible`/`unknown`/`recovery_blocked` rows, no new
placement engine/tool/session pipeline, no unrelated UI cleanup. The
shared ref line now reads `Unidad <short-id>` on ALL rows (one element,
per-state divergence would be inconsistent UI — declared here as the only
visible change beyond the missing card).

## Delivery

Pre-commit checkpoint delivered to the owner; NO commit, NO push, NO PR yet
(owner review first, per request). Files changed (8): placer Ruby, dialog
JS module, project.css, 2 JS harnesses, 2 Ruby suites, reconciliation doc
(+ this artifact).
