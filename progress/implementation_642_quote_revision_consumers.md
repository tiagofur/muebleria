# #642 Slice 2a — QuoteRevision consumers
Status: `IMPLEMENTED_PENDING_REVIEW`; PR #653; base `ad8865e132c0d319324f34aa50505dd8149c7c48`.
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
