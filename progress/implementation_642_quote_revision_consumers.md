# #642 Slice 2a — QuoteRevision consumers
Status: `IMPLEMENTED_PENDING_REVIEW`; PR #653; current base
`e1d2e832b07e936bbdb7884021b7bf3c6f0ca307`.
Authenticated Cotizaciones project detail now loads QuoteRevisions through the
generated client and selects the accepted revision, or newest exact revision when
none is accepted. Identity/status/totals come only from `commercialSnapshot`.
Missing/legacy authority fails closed; no Project.status, priceSnapshot or live
fallback. Enviar/Aceptar now opens exact lifecycle. Cached failure is stale+retry.

Boundary: smallest coherent work unit. Remaining consumers are in §16A;
PDF/XLSX exports, geometry and machine output were untouched.

## Evidence
- UI behavior: exact accepted Q2 overrides conflicting draft Project.status;
  legacy missing snapshot fails closed and opens exact lifecycle.
- Browser gate extends the real PostgreSQL Q1→Q2 flow: Project.status remains
  draft while Cotizaciones renders accepted Q2 identity and frozen total.
- Focused UI: 82/82 PASS across Cotizaciones and lifecycle suites; authority
  selector: 2/2 PASS.
- Full `pnpm test`, typecheck, OpenAPI drift check and diff check: PASS.

## Review correction

- Loading, error, empty and legacy authority states now hide mutable project
  identity, customer, currency, line quantity and margin instead of relabeling
  them as frozen commercial truth.
- Ready detail derives customer ID, identity, currency and summed line quantity
  from the exact commercial snapshot. WhatsApp resolves the phone only for that
  frozen customer ID and fails closed when the directory cannot resolve it.
- Authenticated totals render only the frozen snapshot breakdown. Mutable
  material summary, nesting, version history and live-calculation states remain
  outside authority mode.
- Create, publish, accept and requote invalidate both the reconciliation reads
  and the tenant/session-scoped Cotizaciones authority key. The real browser
  gate primes accepted Q1, accepts Q2, returns within the cache window and sees
  exact accepted Q2.
- Evidence after correction: focused UI 82/82, full UI 1695/1695, full web
  444/444, all-workspace `pnpm test` PASS, typecheck PASS, OpenAPI drift PASS,
  and Chromium + Go + PostgreSQL browser gate 4/4 PASS.

## UI Definition of Done rereview

- The real Chromium + Go + PostgreSQL gate now exercises accepted Q2 in
  Cotizaciones at 390×844, 768×900 and 1280×800. Each viewport asserts no
  document overflow, bounded project detail and bounded frozen-totals panel.
- Six screenshots (overview + frozen totals for each viewport) are stored in
  `test-results/issue-642-slice2a-responsive-rereview/`. The screenshot review
  against `docs/design.md` §8 found no clipped content, overlap, competing
  primary action or broken responsive hierarchy. Phone/tablet correctly use
  the closed drawer; desktop retains the navigation rail.
- The first diagnostic capture observed the sidebar transition immediately
  after resizing. Waiting for the system animation produced the stable final
  state; this was capture timing, not a product defect. No UI product code was
  changed in this rereview.
- Final real browser run: 4/4 PASS (33.8 s). The screenshots were manually
  inspected at their original resolutions; 390 shows the stacked commercial
  header and two-column frozen breakdown, 768 uses the wide single-column
  content flow, and 1280 preserves the sticky totals aside.

## Go CI timeout rereview

- Original exact-head job `103099438915` failed only because the global Go
  timeout expired at 600.211 s while `internal/storage` was applying another
  fixture migration; the PR contains no backend change and no assertion failed.
- The exact job was rerun as attempt 2 (`103123806142`) without code changes.
  It completed successfully in 9m51s; `internal/storage` passed in 275.163 s and
  the full Go job concluded green. The narrow margin confirms accumulated suite
  load/flakiness rather than a branch-related backend regression; the timeout
  remains recorded rather than hidden.

## Current-main reconciliation

- Merged `origin/main@e1d2e832b07e936bbdb7884021b7bf3c6f0ca307`
  into the same branch. The sole conflict was `progress/current.md`; resolution
  preserves both this Slice 2a record and the newly integrated #650 optimizer
  record. No feature code required conflict resolution.
- Post-merge evidence: focused Cotizaciones/lifecycle UI 82/82, integrated
  optimizer 56/56, full workspace tests (domain 1339, storage 191, Excel 165
  passed + 3 skipped, desktop 17, mobile 73, UI 1695, web 444), typecheck,
  OpenAPI drift and diff checks all PASS. The real Chromium + Go + PostgreSQL
  gate also passed 4/4 in 34.1 s and regenerated the six reviewed screenshots.
- The immutable final branch head and exact authored additions/deletions are
  recorded in the live PR #653 body after push/readback.
