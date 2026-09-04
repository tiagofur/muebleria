# Documentation and governance audit

Baseline: `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`. Source archive only; no product or GitHub writes.

## Result

The product documentation contains real architectural direction but several current-state summaries lag the executable baseline. Gate A is NOT a present blocker: baseline CI evidence was verified centrally (`main-checks.json`, all seven checks successful, including Foundation Gate A). Gate B and complete Digital Thread remain separate deliverables.

## Coverage

- 371 tracked documentation files indexed: 221 history/archive, 52 progress, 88 general documentation, 8 ADR, 2 instructions.
- 15 files received targeted content/code contrast. 356 remain inventory-only; this is not a claim that every document has been audited.
- 204 historical feature-ledger rows, each labelled UNKNOWN until vertical verification; original status retained separately.
- 54 open issues + 100 recently updated closed issues captured with full body/comments. All requested #384–398 / #446 / #460–462 / #465 / #496–504 included.
- 100 recent PRs captured; 94 confirmed ancestors of baseline; 1 unmerged (#550); 5 merged refs not proven local ancestors. PR bodies/checks are not code verification.

## Canonical contrasts

| Document | Classification | Action |
|---|---|---|
| `AGENTS.md` | STALE | §6 priority snapshot still names F199/#458 before Gate A; baseline progress and PR537 establish later state. |
| `docs/adr/0003-project-owned-furniture-identity-and-versioned-design.md` | CORRECT | Project-owned identity and immutable revisions are executable in backend; remaining release flow belongs to #395. |
| `docs/adr/0006-membership-lifecycle-and-organization-relationships.md` | STALE | Status Proposed even though mandatory authority and major foundation slices are merged; decision lifecycle should be reconciled. |
| `docs/architecture.md` | INCOMPLETE | Normative boundaries distinguish target from implementation poorly in overview; relationships/ManufacturingOrder are future. |
| `docs/architecture/domain-model.md` | CORRECT | Physical identity vs commercial/design snapshots matches reconciliation and stable FurnitureInstance code; broad full product intent remains target. |
| `docs/architecture/organization-foundation-v2.md` | STALE | §3 implemented-today rows lag generated contracts, FORCE RLS, lifecycle, bounded sessions and MFA. |
| `docs/architecture/project-design-digital-thread.md` | INCOMPLETE | DT1–9 implementation notes coexist with target DT10–14; annotate per-slice status and React surface gaps. |
| `docs/pilot-readiness.md` | CORRECT | Gate A explicitly complete; Gate B excluded. Exact baseline remote CI proof supplied centrally. |
| `docs/prd-v2.md` | INCOMPLETE | Product intent is appropriate; installation target is substantially implemented and needs explicit baseline links. |
| `docs/production-flow-v2.md` | CORRECT | Piece→unit convergence and explicit legacy bridge documented; physical runtime gate is separate evidence. |
| `docs/project-lifecycle.md` | STALE | §3 says ProjectEvent and closeout absent; implementations exist. Exact new Digital Thread release remains unfinished; do not conflate old project snapshots with new aggregate. |
| `docs/verification.md` | CORRECT | Defines real boundaries and no-skip gates; this audit does not claim completion from source grep. |
| `feature_list.json` | INCOMPLETE | 204 ledger rows end at F208/DT5; merged DT6–9 appear in progress/GitHub without corresponding ledger entries. |
| `progress/current.md` | CORRECT | DT9 current, F202 security remainder open; newer than AGENTS priority snapshot. |
| `progress/gate_a_462_coverage.md` | CORRECT | 34 scenario historical proof matrix, not a substitute for exact SHA live run. |

## Evidence-backed findings

### DOC-001 — Agent priority snapshot lags actual main and completed Gate A

**MEDIUM · CONFIRMED**

ACTUAL: AGENTS priority block says F199/#458 first and Gate A pending; progress says F199 done, DT9 complete, F202 remainder active.
EXPECTED: Navigation map must point to live issue/current progress, not an old verified priority snapshot.
GAP / IMPACT: Wrong next-work choice and needless blocking delay demo preparation.
RECOMMENDATION: Update only priority snapshot and link exact gate evidence; preserve hard-prerequisite rule.

- `AGENTS.md:401-407`
- `progress/current.md:1-27`
- `docs/pilot-readiness.md:45-48`

### DOC-002 — Foundation implemented-today table describes superseded security architecture

**HIGH · CONFIRMED**

ACTUAL: §3 lists active booleans/manual DTOs/best-effort audit/client persisted bearer while lifecycle/generated API/RLS/MFA are merged. ADR0006 remains Proposed.
EXPECTED: Date-bound implementation matrix linked to executable versions.
GAP / IMPACT: Misleads sales readiness and agents; risks duplicate or regressive security work.
RECOMMENDATION: Reconcile current column per concern; leave Sales Network/Gate B target explicit, not globally complete.

- `docs/architecture/organization-foundation-v2.md:122-142`
- `docs/adr/0006-membership-lifecycle-and-organization-relationships.md:1-8`
- `backend-go/internal/api/organization_lifecycle.go:218-276`
- `backend-go/db/migration/000094_tenant_rls.up.sql`
- `packages/storage/src/openapi/generated/client.ts`
- `progress/current.md:29-81`

### DOC-003 — Lifecycle gaps understate implemented events and installation closeout

**MEDIUM · CONFIRMED**

ACTUAL: Lifecycle §3 says events/closeout absent although TS domain, Go domain/API, row-locked JSONB storage and UI wiring exist.
EXPECTED: Separate old processStage bridge from implemented ProjectEvents/installation and future Digital Thread release.
GAP / IMPACT: Hides demonstrable operations value or encourages redundant redesign.
RECOMMENDATION: Replace obsolete gaps with capability-by-capability evidence. Keep native-host and browser proof requirements explicit.

- `docs/project-lifecycle.md:81-94`
- `docs/prd-v2.md:401-415`
- `packages/domain/src/types.ts:1217-1229`
- `packages/domain/src/installation.ts:278-369`
- `backend-go/internal/storage/installation.go:25-113`
- `apps/web/src/AppContent.tsx:1726-1778`

### DOC-004 — Ledger does not enumerate latest merged Digital Thread slices

**LOW · CONFIRMED**

ACTUAL: feature_list has 204 rows through F208/DT5, while main contains DT6–9 with progress records and PR546–549.
EXPECTED: Inventory must not treat ledger as all implemented functionality.
GAP / IMPACT: False feature counts and omission of demo-related integration progress.
RECOMMENDATION: Reconcile ledger references or explicitly label it historical; preserve GitHub as operational backlog.

- `feature_list.json`
- `progress/current.md:1-17`
- `progress/implementation_393_dt9.md:1-43`

### DOC-005 — Backend reconciliation must not be marketed as complete bidirectional user flow

**DEMO BLOCKER · CONFIRMED**

ACTUAL: Exact-ID read-only reconciliation exists; generated client exists but no apps/web caller located; #500–502 remain open; #394/PR550 is not merged into baseline.
EXPECTED: Demonstrable explicit Quote↔Design flow with approved exact revisions, no manual reconstruction.
GAP / IMPACT: Claiming seamless end-to-end design-to-quote/release would exceed baseline evidence.
RECOMMENDATION: Show supported API/SketchUp subset honestly; finish scoped #394/#395 and #500–502 then run #398 cross-surface scenario before broad claim.

- `backend-go/internal/api/reconciliation.go:16-85`
- `backend-go/internal/domain/reconciliation.go:12-30`
- `backend-go/internal/api/routes.go:379-390`
- `packages/storage/src/openapi/generated/client.ts:187`
- `https://github.com/tiagofur/muebleria/issues/502`
- `https://github.com/tiagofur/muebleria/pull/550`

## Product map and vertical evidence

### Physical identity and quote/design

Project owns FurnitureInstance; quantity expands physical identity rather than borrowing QuoteLine position or SketchUp persistent_id. Baseline #393 compares exact quoteRevisionId/designRevisionId, resolves snapshots from PostgreSQL, and joins by FurnitureInstance. The route (`routes.go`), handler (`api/reconciliation.go`), pure domain (`domain/reconciliation.go`), storage (`storage/reconciliation.go`), migrations 000115/000116, generated TypeScript client, and domain/API/storage tests form an implemented backend chain. No direct browser reconciliation caller was located. This proves backend structure, not a complete user journey.

PR550 / #394 is unmerged and outside this snapshot. Its title or current working-tree presence must never be used to credit the baseline. #395 exact new DesignRevision approval/release and #500–502 React workspaces remain open. The old `packages/domain/src/projectLifecycle.ts` already has ProductionRelease (designRevisionId + bomFingerprint); do not call release wholly missing, and do not mistake that legacy project snapshot structure for #395 completion.

### Production and installation

The canonical production flow correctly states Cut/CNC/Edge operates on pieces and Assembly+ on physical units. It documents an explicit legacy bridge, 409 denial for direct item transitions when physical units exist, stale-release assembly checks, and row-lock mutation boundaries. Runtime execution coverage is owned by the central audit.

Installation chain: routes.ts `/installations/:projectId` → ShellView installation panel → AppContent runInstallationJobAction → repository saveInstallation → Go HandleProjectInstallation → domain transitions and closeout gates → MutateProjectInstallation row lock and JSONB project persistence plus project_events in one transaction. Separate POST closeout handles complete_installation/sign_off/close. Go/TS status parity is explicit. Source inspection is not proof of successful real-browser closeout.

### Organization and commercial network

Foundation API lifecycle commands use generated DTOs and migration 000094 establishes tenant RLS; SEC7 and GateA delivery evidence supersedes old implemented-today summaries. OrganizationRelationship / ManufacturingOrder / installer cross-org assignment remain target programs and must not be described as complete because Foundation Gate A is green.

## Governance recommendation

Use the pinned source SHA as implementation authority; use GitHub state as planning metadata only. Update existing documentation/issue scopes rather than opening duplicates. Preserve #462 open for Gate B, #460 for remaining SEC8/9, #461 for remaining operational scope, and #384/#465 trackers. Do not automatically close trackers based on merged slices.

## Remaining verification

- **DOC-U1 / All inventory-only documents**: 356 documents are indexed, not substantively audited; most are historical progress. Historical status is classification by path, not verified supersession.
- **DOC-U2 / Feature ledger completeness**: 204 ledger rows are not 204 verified end-to-end capabilities. Integrate other workers vertical audits and named absent DT slices.
- **DOC-U3 / GitHub PR diff review**: 100 PR metadata/body inventory; 9 detailed comments/check snapshots; no full per-PR diff audit. Five merged refs not proven ancestors locally must not be treated baseline.
- **DOC-U4 / Installation demonstrated end-to-end**: Source chain read and tests exist, but this worker did not operate installation UI against real database nor validate sign-off concurrency runtime.
- **DOC-U5 / Gate B / complete Sales Network**: Gate A is not Gate B. Relationship/order/publishing end-to-end readiness not demonstrated; retain #453–459 and #462 open scope.

## Collection notes

`gh issue list --state open --limit 1000`, closed list limit 100, per-issue body/comments, `gh pr list --state all --limit 100`, selected PR detail and `git merge-base --is-ancestor` were read-only. The full captured metadata and evidence schema are in `audit/data/docs-governance.json`. Path headings/status extraction indexes documents but does not count as substantive review.
