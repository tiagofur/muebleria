# #642 Slice 2a — QuoteRevision consumers
Status: `IMPLEMENTED_PENDING_REVIEW`; PR #653; base `ad8865e132c0d319324f34aa50505dd8149c7c48`.
Authenticated Cotizaciones project detail now loads QuoteRevisions through the
generated client and selects the accepted revision, or newest exact revision when
none is accepted. Identity/status/totals come only from `commercialSnapshot`.
Missing/legacy authority fails closed; no Project.status, priceSnapshot or live
fallback. Enviar/Aceptar now opens exact lifecycle. Cached failure is stale+retry.

Boundary: smallest coherent work unit, 399 authored additions. Remaining consumers are in
§16A; PDF/XLSX exports, geometry and machine output were untouched.

## Evidence
- UI behavior: exact accepted Q2 overrides conflicting draft Project.status;
  legacy missing snapshot fails closed and opens exact lifecycle.
- Browser gate extends the real PostgreSQL Q1→Q2 flow: Project.status remains
  draft while Cotizaciones renders accepted Q2 identity and frozen total.
- Focused UI: 43/43 PASS; authority selector: 2/2 PASS.
- Full `pnpm test`, typecheck, OpenAPI drift check and diff check: PASS.
