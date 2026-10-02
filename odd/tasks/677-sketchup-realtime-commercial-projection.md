# #677 — Real-Time Debounced Design Sync & Live Commercial Projection in SketchUp

## Objective and authority

Complete the remaining live pricing acceptance requirement of [#677](https://github.com/tiagofur/muebleria/issues/677) (`[P0][SU-COMM] Show live commercial total, quote delta and Presentation mode in SketchUp`) under the portable G-ODD contract.

### Context and prior deliveries
- **PR #702** delivered the Go backend `CommercialProjection` endpoint (`GET /projects/{projectId}/designs/{designId}/commercial-projection`) and the baseline SketchUp commercial card with quote delta comparison. It required manual refresh/sync and was marked `Delivery: partial`.
- **PR #957** delivered Presentation mode ("Modo Presentación") and item count summary in the commercial HUD. It was marked `Delivery: partial`.
- **PR #811** (#810) delivered the conflict-safe `DesignWorkingCopy` write boundary and manual "Sincronizar diseño" button.

### Problem statement
Currently, whenever a designer inserts, alters, or removes a furniture unit in SketchUp, the commercial card flags local changes as `stale` ("El cambio local todavía no se sincronizó con el diseño del servidor"). To see the updated estimated price, the designer must manually click "Sincronizar diseño" or may mistakenly think they must emit a new `QuoteRevision` (creating Q1, Q2... Q50).

### Scope of this increment
1. **Debounced automatic synchronization**: When a furniture mutation commits (insert via catalog preview, parameter update in inspector, material choice, deletion, or transform), schedule a background debounced sync (~1500ms after the model becomes idle).
2. **Automatic commercial projection refresh**: On confirmed sync readback from the Go backend, automatically call `GraneteCommercialProjection.refresh()`. The HUD updates the estimated total in near real-time without user clicks.
3. **Mutation and lifecycle safety**:
   - If a new mutation starts during the debounce window, cancel and reschedule the timer.
   - If `mutationInFlight == true` (`GraneteMutation.phase()`), pause auto-sync until the mutation reaches a terminal state.
   - If a sync conflict occurs, surface the conflict state honestly without corrupting or deleting local geometry.
4. **Presentation mode support**: Auto-sync and commercial refresh operate silently in Presentation mode, ensuring the client sees the live price update without exposing administrative sync buttons.
5. **Absolute Invariants**:
   - **Server Authority**: Ruby and JavaScript NEVER calculate prices, margins, or taxes. All calculations are executed by Go `CalcProjectBreakdown`.
   - **Zero QuoteRevision pollution**: This workflow is read-only regarding formal quotes. No `QuoteRevision` (Q1, Q2...) is ever created or mutated.

- Issue: [#677](https://github.com/tiagofur/muebleria/issues/677), OPEN, `status:approved`, `type:feature`, `size:exception`.
- Downstream boundary: [#679](https://github.com/tiagofur/muebleria/issues/679) retains ownership of cross-client SSE event streams and remote multi-device invalidation.

## Hard boundaries and non-goals

- No new `QuoteRevision` creation: formal quotes remain an explicit user action via "Emitir cotización".
- No cross-client SSE/WebSocket infrastructure: real-time updates are driven by local authoring triggers; cross-device stream remains #679.
- No pricing engine changes: backend OpenAPI contracts and pricing calculators remain unchanged.
- No optimistic price guessing: the HUD only displays prices confirmed by the backend projection.

## Tasks

- [x] T1 — **Debounce Engine for Working Copy Sync**: Add a debounced auto-sync trigger in `apps/sketchup-extension/src/granete_for_sketchup/resources/js/granete-project-furniture.js` that fires after local furniture insertion, parameter update, material assignment, or deletion, when the model is idle.
- [x] T2 — **Commercial HUD Automatic Refresh Hook**: Connect the successful debounced sync callback to `window.GraneteCommercialProjection.refresh()`, eliminating the requirement for manual sync clicks to see price changes.
- [x] T3 — **Concurrency and Lifecycle Protection**: Guard the debounce against active `GraneteMutation` phases (`resolving`, `applying_host_mutation`), rapid repeated edits, model disconnection, and background conflict states.
- [x] T4 — **Tests & Packaging**:
  - Add Node/JS unit tests in `apps/sketchup-extension/test/js/` validating debounce scheduling, cancellation on new edits, and projection refresh.
  - Run Ruby verification suite: `bundle exec rake verify` (RuboCop, Minitest, deterministic RBZ).
  - Validate that zero `QuoteRevision` records are created during continuous editing.

## Verification criteria

1. Inserting a furniture item automatically updates the commercial projection within ~2 seconds without manual sync click and without creating any quote.
2. Editing furniture dimensions in the inspector triggers debounced sync and updates the estimated total.
3. Deleting a furniture piece triggers debounced sync and updates the estimated total.
4. Rapid consecutive changes (e.g., resizing width 3 times quickly) collapse into a single server sync request.
5. Zero `QuoteRevision` rows are generated in the database during editing.
6. All tests pass: `node apps/sketchup-extension/test/js/commercial_projection_test.js` and `bundle exec rake verify`.
