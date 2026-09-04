# Operational vertical audit
Snapshot: `316df57c7c3c9d5470b5a3f22b39fffeacfd7676`. Source-only worker; no product or DB writes, no tests executed.

## Verdict
There is substantive operational implementation, not merely screens: role-gated customer/project handlers, quote freeze logic, dedicated physical execution and installation closeout commands, domain gates, row-lock storage and test cases. **The chain is not certified end-to-end**: generic aggregate writers undermine frozen/physical authority and quote UI success precedes persistence.

## OP-FLOW-01 — Customer → quote creation
Status: PARTIAL source / UNKNOWN runtime.
### Confirmed mechanisms
- Customer create uses role permission plus owner assignment; duplicate key mapped409.
- Customer store saveAndToast waits for catalog patch resolution, unlike project patch immediate success.
- Quote creation resolves existing/new customer and then sends project create.
### Invariants
- Customer ID links quote to customer; owner resolution enforced server-side; tenant supplied by OrgFromCtx, not client request.
### Vertical evidence
- UI: packages/ui/src/customers/CustomersScreen.tsx:141-163
- state customer: apps/web/src/stores/catalog/customers.ts:17-52
- state quote: apps/web/src/stores/projectStore.ts:751-799
- repository: packages/storage/src/apiWorkspaceRepository.ts:624-643
- routed API: backend-go/internal/api/routes.go:251-255
- handler permission/ownership: backend-go/internal/api/handlers.go:998-1036
- database: backend-go/internal/storage/customers.go:41-72
### Missing proof
- New inline customer upsertCustomers returns void while project create starts independently: ordering/rollback under slow customer request NEEDS VERIFICATION.
- Real browser create→reload and cross-owner/cross-tenant denial not executed.
- Customer name validation source in UI does not establish server validation coverage.

## OP-FLOW-02 — Quote status → frozen price and structure pins
Status: PARTIAL source / UNKNOWN runtime.
### Confirmed mechanisms
- UI/domain explicitly model frozen prices and revisions; backend pins structures on closing and protects reopen permission.
### Invariants
- TS open→closed captures price snapshot and structure pins; closed→closed preserves existing price; reopen removes snapshot.
- Role-specific reopen and produced transitions exist server-side.
- Accepted/frozen truth must be server-owned; current generic write violates this invariant (OP-01).
### Vertical evidence
- state: apps/web/src/stores/projectStore.ts:1025-1054
- domain price freeze: packages/domain/src/engine/pricing.ts:392-440
- domain version snapshot: packages/domain/src/projectVersioning.ts:96-135
- repository: packages/storage/src/apiWorkspaceRepository.ts:637-643
- route: backend-go/internal/api/routes.go:342-346
- handler: backend-go/internal/api/handlers.go:1447-1524
- database: backend-go/internal/storage/projects.go:1189-1240
### Missing proof
- OP-01 client-supplied snapshot can replace/delete frozen snapshot.
- OP-03 success before save and no rollback in project patch.
- No real browser quote→accept→catalog price change→reload freeze proof executed here.

## OP-FLOW-03 — Engineering → materials → physical production → packaging
Status: PARTIAL source / UNKNOWN runtime.
### Confirmed mechanisms
- Dedicated physical routes and domain convergence/stale-revision checks exist.
- UI differentiates part and unit callbacks.
- Order workspace explains missing material release separately from missing order.
### Invariants
- Cuts/CNC/edges operate parts; assembly requires ready parts of same unit/revision; packaging requires QC or recorded override.
- Physical endpoint row lock atomically updates JSON, derived legacy status and audit.
- Generic project mutation must not override physical state; current second writer violates boundary OP-02.
### Vertical evidence
- process stage domain: packages/domain/src/processStage.ts:37-68
- UI physical action: packages/ui/src/production/FabricScreen.tsx:466-485
- shell/API: apps/web/src/AppContent.tsx:1621-1674
- local mirror persistence: apps/web/src/stores/projectStore.ts:660-725
- routes: backend-go/internal/api/routes.go:420-433
- API convergence/QC: backend-go/internal/api/partExecutions.go:372-411
- domain convergence: backend-go/internal/domain/partExecution.go:283-342
- locked storage: backend-go/internal/storage/partExecutions.go:30-119
- schema: backend-go/db/migration/000069_part_executions_and_module_units.up.sql:1-4
### Missing proof
- OP-02 generic state replacement undermines dedicated gates and Web re-persists local mirror after dedicated advance.
- WEB-01 picking ledger/state non-atomic; materials flow is not certified by production gate presence.
- Real station scan, concurrent users, rollback and required piece→unit sequence not executed here.

## OP-FLOW-04 — Installation visits → punch/issues → sign-off → closeout
Status: PARTIAL source / UNKNOWN runtime.
### Confirmed mechanisms
- Typed job schema and lifecycle transitions; field issues/punch and append-only events modeled.
- Server computes gates from locked unit/item/job state and writes job/events together.
- Web closeout success waits on endpoint response (unlike quote patch).
### Invariants
- Installation completion is not project close: all units installed and no open visits; sign-off requires physical/issue/punch/visit gates; closing additionally requires sign-off.
- Non-blocking open punch is not same as blocking punch.
- Installation facts cannot be smuggled through generic PUT: handler restores stored Installation.
- Dedicated job PUT forbids changing closeout facts; closeout endpoint authors them under lock.
### Vertical evidence
- shell closeout: apps/web/src/AppContent.tsx:1775-1840
- repository: packages/storage/src/apiWorkspaceRepository.ts:1123-1197
- route manufacturing boundary: backend-go/internal/api/routes.go:445-448
- API install update: backend-go/internal/api/installation.go:177-214
- API closeout gate: backend-go/internal/api/installation.go:253-324
- domain: backend-go/internal/domain/installation.go:542-592
- database lock + audit: backend-go/internal/storage/installation.go:29-116
- schema: backend-go/db/migration/000070_project_installation.up.sql:1-3
### Missing proof
- Handler tests use direct calls and stubStore; not real router/auth/RLS/transaction evidence.
- OP-02 can change underlying module_units through generic PUT, weakening confidence in closeout physical prerequisites.
- Real visit→installed units→issue resolution→sign-off→close browser with DB not executed.
- Physical units/legacy fallback behavior must be shown honestly for chosen demo fixture.

## Findings
### OP-01 — Generic project PUT accepts replacement/removal of frozen quote price
Handler preserves old snapshot only for produced transition with omitted snapshot; same-status quoted/accepted update can replace it. Storage deletes old quote_snapshots then inserts supplied payload, or none if omitted.
Impact: Frozen quote price is not authoritative against alternate client or stale full-aggregate save.
Evidence: backend-go/internal/api/handlers.go:1487-1505; backend-go/internal/storage/projects.go:1189-1238
Recommendation: Preserve server frozen snapshot for closed revisions; generate freeze on server; explicit versioned amend/reopen commands, regression with crafted same-status PUT.
Runtime: NEEDS VERIFICATION; root/synthesis may add separate executed evidence

### OP-02 — Generic aggregate physical writer bypasses dedicated assembly/QC authority
Generic update writes client part_instances/module_units/production_release without dedicated gates. Web awaits advance endpoint, discards returned authoritative object and locally advances then persists entire project through patch.
Impact: Stale Web saves or authorized generic writes can overwrite gated physical state; dedicated row-lock protection alone is insufficient.
Evidence: backend-go/internal/api/handlers.go:1407-1524; backend-go/internal/storage/projects.go:1160-1187; apps/web/src/AppContent.tsx:1621-1655; apps/web/src/stores/projectStore.ts:668-725
Recommendation: Remove physical/release fields from generic mutation authority; hydrate exact server result after command; test generic PUT denial plus stale-client concurrency.
Runtime: NEEDS VERIFICATION; root/synthesis may add separate executed evidence

### OP-03 — Quote status and metadata report success before rejected persistence
Project patch updates memory then starts unawaited save; changeProjectStatus immediately toasts accepted/frozen. Failure emits error but does not restore project. Metadata save has same success-before-save pattern.
Impact: Sales can believe accepted/frozen quote persisted when server rejected it; reload may lose visible progress.
Evidence: apps/web/src/stores/projectStore.ts:697-725; apps/web/src/stores/projectStore.ts:862-870; apps/web/src/stores/projectStore.ts:1025-1054
Recommendation: Await command; return committed server project; maintain pending/failure without success, reconcile or rollback safely.
Runtime: NEEDS VERIFICATION; root/synthesis may add separate executed evidence

## Tests: actual scope
Installation and physical handler fixtures instantiate stubStore and invoke handlers directly. They cover source assertions for sequence, stale revision, supervisor override, QC, closeout smuggling, roles and gates; they do not exercise the production router, auth middleware, PostgreSQL RLS or transactional lock. Domain TS/Go parity fixtures are not a complete operational browser journey.

## Fastest safe demonstration boundary
Use persisted prevalidated fixtures; do not demonstrate unrestricted live stock dispatch or claim frozen/physical server authority until OP-01/02/03 and WEB-01 have been resolved or bounded by convincing executed evidence. A guest local walkthrough demonstrates interaction only. Installation closeout mechanisms are stronger but rely on physical inputs whose other write paths must be closed.

## Key Learnings:
1. A dedicated row-lock command is insufficient if a generic aggregate update remains another writer of the protected state.
2. Physical installation completion, client sign-off and project closure are distinct gates.
3. Stub-handler tests must not be represented as routed/authenticated/RLS evidence.

## Final verification boundary and priorities
OP-01 and OP-02 remain **CONFIRMED_STATIC / runtime NEEDS VERIFICATION**. No routed real-DB reproduction was completed; root independently checked the handler/storage source. Scope is an authorized same-organization project mutator. These findings do not claim cross-tenant leakage or authentication bypass.

- OP-01: P0 before relying on frozen quote authority. Preserve server frozen snapshots, derive initial snapshot on server and permit changes only through explicit revision/amend/reopen rules. Prove same-status replacement and omission cannot alter frozen price.
- OP-02: P0 before claiming live physical gate enforcement. Remove generic physical/release write authority and consume authoritative command response without re-PUT. Prove stale generic saves cannot overwrite physical progress and generic writes cannot bypass assembly/QC.
- OP-03: next reliability fix on the same sales path: success follows persisted result, never a fire-and-forget save.
