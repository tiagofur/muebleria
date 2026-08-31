# Granete for SketchUp — Backlog Reconciliation 2026-08-30

Status: **Review record / execution inventory**  
Canonical architecture: `docs/architecture/sketchup-backend-web-integration-excellence.md`  
Canonical product benchmark: `docs/sketchup-product-usability-benchmark.md`  
Program: #465

## 1. Scope

This reconciliation reviewed the active and historical SketchUp, Project Digital Thread, Organization Foundation, machine-readiness and React integration backlog after the merge of typed parameter delivery #486.

The goal was to remove stale status, close completed work, correct ownership/dependencies and create the missing cross-surface slices required for a commercially excellent product.

## 2. Main conclusion

The technical SketchUp baseline is strong:

- native managed entities;
- stable semantic identities;
- material-aware geometry;
- authoritative resolve/preflight;
- SelectionContext;
- rich authoring contract;
- typed parameters;
- real-host evidence.

The remaining risk is no longer primarily geometry. It is fragmented product integration and incomplete product usability:

```text
SketchUp host UX incomplete
+ furniture HTTP contracts outside generated API authority
+ React cannot administer new parameter/binding model
+ Project/Design persistence not implemented
+ no secure Web↔SketchUp handoff
+ machine/output/support workflows lack Web product ownership
+ no measured onboarding/library/usability gate
```

## 3. New issues created

| Issue | Purpose | Gate boundary |
|---:|---|---|
| #496 | Generated furniture/authoring/Design API contract | Current stateless surface may advance before Gate A; persistent Design APIs after Gate A |
| #497 | React typed parameter definitions/bindings editor | May consume current catalog persistence; final transport uses #496 |
| #498 | Shared SketchUp host orchestration, modular HtmlDialog, atomic mutation/degraded guards | May advance before Gate A |
| #499 | Secure one-time Web↔SketchUp Project/Design pairing | Contract/discovery before Gate A; runtime after #385/#387/#388/#460 |
| #500 | React Project Furniture matrix/physical-unit traceability | After Gate A + #385/#386 |
| #501 | React Designs/immutable revisions/artifacts | After Gate A + #387/#392 |
| #502 | React reconciliation/requote/approval/release | After #393–#395 |
| #503 | React MachineProfile/evidence/manufacturing artifact workspace | After #348/#351; final release link after #395 |
| #504 | Privacy-safe correlated SketchUp diagnostics/support bundle | Local shell may advance; complete correlation after #460/#461/#496 |
| #506 | Professional onboarding, library discovery and measured usability pilot | Design/baseline may begin earlier; final pilot after representative #466–#471 workflow |

No new competing META was created. #465 remains the product/integration authority and #384 remains the Project Digital Thread authority.

## 4. Existing issue changes

### #465

Rewritten as the current professional-authoring and complete Go/React integration program.

Changes include:

- removed obsolete Wave 0/draft wording;
- marked #476/#477 complete;
- added #496/#498/#497 as cross-surface foundations;
- added #499–#504 to the execution program;
- defined progressive React slices;
- added exact ownership matrix and final E2E;
- added #506 through a product-usability reconciliation comment.

### #396

Converted from one oversized Web implementation issue into a tracker:

```text
#500 Project Furniture
#501 Designs/revisions/artifacts
#502 reconciliation/approval/release
#499 secure SketchUp handoff
```

### #401

Closed as completed after verifying #402–#405 are all closed and delivered. The previous comment that listed them pending is historical.

### #388

Corrected downstream ownership:

- publication/artifacts = #392;
- existing model adoption = #397;
- pairing/deep link = #499.

Added generated contract, server validation, safe rebind and exact Project/Design/base revision requirements.

### #354

Upgraded from a primarily domain/manufacturing golden suite to a P0 cross-layer regression gate requiring:

- #498 host runtime;
- #466 preflight review/navigation;
- #467 real internal authoring;
- #468 real hardware authoring;
- real SketchUp operation/undo/save-reopen;
- exact revision/release context;
- separate real machine readback.

### #466/#467/#468

Added dependency reconciliation comments:

- #498 is shared host-runtime prerequisite;
- #496 is the generated API/error/capability boundary;
- no feature-specific duplicate transport/store/rollback/error model is allowed.

### #474

Clarified that #498 owns minimum fail-closed state/mutation guards while #474 retains full cache/reconnect/pending-intent policy.

### #413

Reconciled as substantially complete but correctly open until #416 proves safe legacy Group migration.

### #290

Clarified as upper portfolio/history umbrella. Current executable order lives in #465, #384, #446/#462, #354 and #355.

### #355/#460/#461/#462/#398/#351/#472

Added coordination comments so the new slices are not orphaned:

- #355 consumes #496/#503/#504 and measured #506 findings for broad release;
- #460 owns client-specific session identity, one-time #499 grants and no credential URLs;
- #461 correlates pairing/resolve/revision/release/artifact/diagnostic events without payload leaks;
- #462 explicitly separates pre-Gate-A stateless/host work from post-Gate-A persistent runtime;
- #398 consumes #354 and #499–#502 in the global E2E without a dependency cycle;
- #351 remains machine-domain authority while #503 owns React operations;
- #472 coordinates performance evidence with #506 task usability.

## 5. Pull request changes

### PR #486

Corrected stale final text that said the PR remained unmerged and #483 open. It now records:

- merge commit `72dd224167adb6e4fa92abf28c70fbc8d587561c`;
- #483 closed;
- #497 owns the remaining React administration surface.

### PR #494

Review identified three integration blockers before absorption into tracker #493:

1. Query root needs a non-secret identity/generation for each actual login/session.
2. Query-filter normalization must not sort every array and collide ordered filters.
3. `SessionScope` must be an internal projection from a generated/validated session DTO, not another manually evolved wire contract.

A non-blocking recommendation also requests a dedicated network-error class instead of retrying every `TypeError`.

GitHub does not permit the PR author to submit `REQUEST_CHANGES` on their own PR, so the findings were recorded as a visible review comment rather than falsely represented as a blocking review state.

### PR #505

Created the documentation/governance package:

- new cross-surface architecture;
- reconciled live execution plan;
- backlog inventory;
- root/scoped AGENTS routing;
- measured product usability benchmark.

The PR changes documentation/routing only and does not modify the runtime ledger or mark another feature active.

## 6. Current execution priority

The repository records F199/#458 as the active feature. Preserve the single-active-feature policy unless coordination is explicitly documented.

### Current active chain

```text
#493 tracker
→ correct/integrate #494
→ remaining #458 slices
→ close #458
→ critical #460/#461
→ Gate A #462
```

### Approved discovery/preparation in parallel

- #496 generated API architecture;
- #498 host-runtime design/fixtures;
- #497 editor UX/contract planning;
- #466–#468 canonical fixtures and TestUp plan;
- #499 pairing protocol/UX;
- #500–#503 read-model/API planning;
- #504 diagnostic schema/privacy review;
- #506 benchmark fixture/task/baseline planning.

Do not mark those implementation features `in_progress` while F199 is active unless repository governance explicitly authorizes coordinated parallel delivery.

## 7. Recommended implementation order after F199 policy allows it

### Before Gate A

```text
#496 generated current furniture API
   +
#498 shared SketchUp host runtime
→ #466 preflight review/navigation
→ #467 internal authoring
→ #468 hardware authoring/substitution
→ #469/#470/#471

#497 React typed parameter/binding editor may proceed once #496 transport is ready.
```

### Gate A path

```text
finish #458
→ #460/#461 critical portions
→ #462 Gate A
```

### After Gate A

```text
#385
→ #386 + #387
→ #500 early Project Furniture Web slice
→ #388 + #499 + #389
→ #390/#391/#392
→ #501 revision/artifact Web slice
→ #393/#394/#395
→ #502 reconciliation/release Web slice
→ #397/#398
```

### Machine/commercial/product path

```text
#348
→ #351
→ #352/#353
→ #503
→ #354

representative #466–#471 workflow
→ #506 measured usability pilot/fixes

#354 + #472 + #473 + #506 + security/migration/degraded/support evidence
→ #355 broad commercial readiness
```

## 8. Cross-surface completion rule

An issue is not complete because one isolated layer exists.

Each PR must declare applicable delivery/proof:

```text
[ ] domain
[ ] Go API/storage/RLS
[ ] generated OpenAPI/JSON Schema
[ ] React UI/server state
[ ] Ruby adapter/host
[ ] HtmlDialog interaction
[ ] shared parity/golden
[ ] real SketchUp TestUp
[ ] browser/PostgreSQL E2E
[ ] real machine readback
[ ] product usability evidence
[ ] docs/ledger
```

A user-visible host feature normally requires actual HtmlDialog/viewport behavior, rollback/undo and real-host evidence. A Web integration feature requires generated DTOs plus backend/read-model integration, not static mocks. A commercial product claim requires the relevant technical, performance, compatibility and usability evidence.

## 9. Canonical final demo

The program is successful only when the complete scenario in `sketchup-backend-web-integration-excellence.md` is demonstrated: React catalog authoring, physical Project units, secure SketchUp pairing, semantic shelf/hardware editing, authoritative preflight correction, immutable DesignRevision, reconciliation/requote, exact ProductionRelease, evidence-backed machine artifact, identity-safe copy/migration/adoption and privacy-safe diagnostics.

#506 additionally proves representative target users can complete the workflow and recover from expected failure states with measured evidence.

## 10. Governance note

This reconciliation is documentation/backlog governance. It does not mark a new runtime feature in progress and does not claim that creating issues implements their capabilities.