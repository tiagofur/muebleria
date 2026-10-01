# #677 — SketchUp live commercial total, quote delta and Presentation mode

## Objective and authority

Complete the remaining approved scope of [#677](https://github.com/tiagofur/muebleria/issues/677) (`[P0][SU-COMM] Show live commercial total, quote delta and Presentation mode in SketchUp`) under the portable G-ODD contract.

PR #702 previously delivered the Go `CommercialProjection` endpoint and the baseline SketchUp commercial card. This increment completes the remaining acceptance requirements:
1. **Modo Presentación ("Present to client mode")**: An explicit toggle in the SketchUp panel that removes direct costs, margin factors, internal fingerprints, administrative actions, and irrelevant technical diagnostics from both the visual layout and the accessibility tree (`aria-hidden="true"` / display suppression), while preserving permitted sale information (estimated sale total, currency, revision delta, honest status).
2. **Contextual furniture & item summary**: Show the count of quantified items/furniture clearly in the projection card.
3. **Verification**: `bundle exec rake verify` (RuboCop, Minitest, JS tests, token health, deterministic RBZ) and isolated dialog DOM verification.

- Issue: [#677](https://github.com/tiagofur/muebleria/issues/677), OPEN, `status:approved`.
- Base: `origin/main@8ecbbc284617f6c4be0ba2c3fcf988880cbfa51f`.
- Branch: `feat/677-sketchup-commercial-presentation`.
- One-writer constraint: No other active writer on #677.

## Hard boundaries and non-goals

- Server authority: Ruby and HtmlDialog NEVER calculate prices, mutate QuoteRevisions, approve DesignRevisions, or fabricate financial figures.
- Presentation is not a security boundary; the backend already redacts `costsWithheld` / `saleAmountsWithheld`. Presentation mode is a UX privacy shield for when the designer shows the screen to the client.
- No changes to backend database schemas or pricing engines.
- Clean exit: Presentation mode toggle must be reversible with single click and persist across panel refreshes within the same active session/model binding.

## Tasks

- [ ] T1 — **UI & Affordances for Presentation Mode**: Add the "Modo presentación" toggle button and indicator in `apps/sketchup-extension/src/granete_for_sketchup/resources/dialog.html` and styles adhering to `docs/design.md` tokens.
- [ ] T2 — **Commercial Projection Logic & Accessibility Tree Filtering**: In `granete-commercial-projection.js`, handle presentation mode state toggling. Ensure cost rows, margin rows, internal IDs, and admin buttons (`btn-open-in-granete`, `btn-initial-quote` when in presentation mode) are cleanly suppressed from DOM and accessibility tree without corrupting normal commercial updates. Display item count summary.
- [ ] T3 — **Unit & JS Test Coverage**: Add test cases in `apps/sketchup-extension/test/js/commercial_projection_test.js` and `apps/sketchup-extension/test/unit/commercial_projection_js_test.rb` verifying presentation mode activation, DOM/a11y suppression of internal fields, item count rendering, and toggle reversibility.
- [ ] T4 — **Rake Verification & RBZ Packaging**: Run `bundle exec rake verify` to ensure zero regressions in RuboCop, unit suites, dialog contracts, and deterministic RBZ build.

## Evidence

- Pending execution.
