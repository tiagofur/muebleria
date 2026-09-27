# #642 Production release discovery

## Objective

Prove, in a real browser against disposable PostgreSQL, that the normal Production Dashboard fails to discover the same React-created project when it remains `draft` but has a canonical exact P1 `ProductionRelease`, then fix only that first demonstrated #642 discovery boundary without adding a second acceptance write or expanding horizontally into the remaining factory surfaces.

## Authority and pinned state

- Issue: `#642` is open and labeled `status:approved`.
- Current owner boundary: #642 owns the remaining list/dashboard operational eligibility that still depends on legacy `Project.status`; it explicitly forbids restoring `Project.status = accepted` as an acceptance workaround.
- Branch: `fix/642-production-release-discovery`.
- Worktree: `/Users/tiagofur/.codex/worktrees/642-production-discovery/muebles`.
- Exact base: `origin/main@5b93d336b194077ec116a10d9bd7fff9d4ca9658`.
- Starting HEAD: `5b93d336b194077ec116a10d9bd7fff9d4ca9658`.
- Ownership: one delegated writer for this bounded #642 vertical; the issue has no assignee and no open PR for this branch at artifact creation.
- Remote state: PR `#869` exists for this branch. Its exact-head CI exposed the verification defect below; this correction must not force-push, open another PR, merge, or push from this delegated task.
- Lane: substantial ODD work with this single execution artifact.
- Historical boundary: existing historical #642 artifacts remain untouched. This artifact records only the current production-release discovery vertical.

## Problem and current evidence

Current source inspection indicates that `ProductionManagerDashboard.tsx` filters projects through legacy `Project.status` values `accepted|produced`. The approved same-ID Q1 -> R1 -> P1 path intentionally leaves the Project status at `draft`, while contextual Engineering and the exact `/orders/{project}` route can already work from canonical release authority. This makes the dashboard filter the suspected first discovery boundary, not proof of a total factory block.

At artifact creation there was no current product RED. Task `642-DISC-01` has now observed the fresh branch-specific dashboard RED on this exact base; the evidence is recorded below. No product code changed before that RED.

The sibling #398 candidate at `c7760d434bbc0c988c1692de59bb6ab5eb88f607` is independently approved, test-only historical local evidence. It proves a normal same-ID React Customer/Project/FurnitureInstance -> Q1 -> R1 -> P1 -> Engineering journey while `Project.status` remains `draft`; it is not part of this branch, must not be modified, and does not substitute for the fresh dashboard RED required here.

PR `#869` exact-head CI run `36297444946` exposed a separate pre-existing UI lifecycle defect after all `176` UI files and `2006` tests passed: `ProjectDesignsScreen` left a two-second copy-feedback timer alive past jsdom teardown, and the delayed reset dispatched React state after `window` had been removed. The affected source and test are unchanged from the pinned base and current `origin/main`; this correction restores reliable verification for the same PR and does not expand #642 product acceptance.

## Authorized scope

- Add the smallest real-browser assertion that creates or reaches the same normal React identity, confirms `Project.status = draft`, confirms the canonical exact P1 identity, opens the normal Production Dashboard, and expects that project to be discoverable.
- Run that assertion first and record the actual failure before editing product code.
- Fix only the first proven dashboard discovery/eligibility root by reusing canonical exact ProductionRelease authority already present in the product.
- Preserve exact project/design/quote/release identity and fail closed when the required release authority is missing or stale.
- Keep the browser proof on disposable PostgreSQL and the normal product route; do not replace it with an API-only or direct-route assertion.
- If the same root inseparably changes a shared card selector, retain only the minimum coherent correction and prove its bounded effect. Otherwise leave queue/station consumers as explicit remaining #642 acceptance.
- Add one deterministic regression proof for copy-feedback timer ownership, then make `TechnicalCopyButton` own and cancel its pending reset on unmount and before a later copy.

## Exclusions

- No `Project.status` mutation, mirroring, hidden acceptance write, or test fixture workaround.
- No claim that the entire factory path is blocked; direct contextual routes already provide a bypass.
- No horizontal expansion into `ProductionQueue`, station screens, Cut/CNC/Edge/Assembly, or other factory cards unless the first demonstrated dashboard root is technically inseparable.
- No SketchUp or `#867`, PTX, serializer, warehouse, stock, picking, exports, or unrelated commercial consumer work.
- No changes to the sibling #398 worktree or candidate.
- No persistent development/production database, destructive cleanup, push, PR creation, merge, issue closure, force push, or second product writer.
- No global timer guard, `typeof window` workaround, swallowed exception, sleep, test-only product branch, dashboard/browser-fixture rewrite, Queue/station work, #848/#867, Phase 1, or PTX change.

## Route and execution controls

- Route: **delegated direct**.
- Trigger evidence: the leader already performed the bounded cross-file mapping, and the preparation/writer trigger is satisfied by this single delegated writer. The expected browser test plus non-trivial product correction touch at least two files; implementation remains with this writer rather than returning inline to the parent.
- Skill resolution: `paths-injected` (`implementer`, `work-unit-commits`, `go-testing`, and `control-in-app-browser`).
- TDD: **enabled** by repository `AGENTS.md` (`Strict TDD Mode: enabled`).
- Safe TDD runner: `bash scripts/organization-browser-gate.sh tests/organization/production-release-discovery.spec.ts` using the runner's disposable PostgreSQL/runtime-role isolation. The spec path is planned and does not exist at artifact creation.
- TDD contract: RED must be the fresh normal-dashboard visibility assertion for a `draft` Project with canonical exact P1. Only after observing and recording that product-owned RED may the minimum product fix begin; then run GREEN and a bounded refactor/readback. A setup or assertion bug is harness-owned and must not be misreported as product RED.
- CI correction TDD runner: `pnpm --filter @granete/ui exec vitest run src/digitalThread/ProjectDesignsScreen.test.tsx`. The new regression must deterministically fail before the product edit by proving that an unmounted copy button still invokes its reset callback when pending timers advance; only that observed lifecycle RED authorizes the source change.
- Receipt-driven development: clone-local **off**; review/delivery status remains `disabled/unmanaged` unless the user explicitly enables it.

## Tasks

- [x] **642-DISC-01 — Observe the first real dashboard RED from zero**
  - Read only the existing same-ID browser helpers and the affected dashboard eligibility seam needed to author the test.
  - Add one focused browser scenario that starts from the normal React journey, preserves the same Project/FurnitureInstance/Q1/R1/P1 identities, and proves both `Project.status = draft` and canonical exact P1 before opening the normal Production Dashboard.
  - Assert that the project is discoverable on the dashboard, using stable IDs or exact user-visible identity rather than names, ordering, dates, or status mutation.
  - Run the safe focused gate and record the first failure with Expected, Actual, exact boundary, and ownership.
  - Stop without a product edit if the scenario is immediate GREEN, fails before reaching the dashboard, or proves a different owner/root.
  - Acceptance: an observed, reproducible product-owned RED at the normal dashboard discovery boundary under the disposable PostgreSQL browser gate.

- [x] **642-DISC-02 — Replace only the proven legacy eligibility boundary**
  - Reuse the existing canonical exact ProductionRelease projection/authority; do not introduce another lifecycle, API, status mirror, or per-card N+1 query.
  - Make the smallest coherent dashboard eligibility change that admits the exact P1 project while it remains `draft` and continues to exclude projects without eligible canonical release authority.
  - Keep late/stale responses and project/tenant/session boundaries fail-closed.
  - Run RED -> GREEN with the same focused browser gate, then perform only a bounded refactor/readback justified by the change.
  - Stop horizontal expansion after the first proven root. Record Production Queue/station/card gaps as remaining acceptance unless the corrected code path is literally shared and inseparable.
  - Acceptance: the focused browser scenario is GREEN; the exact Project remains `draft`; the canonical P1 identity is unchanged; and the negative no-eligible-release case remains hidden or blocked according to existing semantics.
  - Work-unit evidence: focused command/result, runtime scenario/result, rollback boundary, and Conventional Commit identity with test and behavior together.

- [x] **642-DISC-03 — Freeze, review, and hand off the bounded candidate**
  - Read back the exact diff and authored-line count; run applicable V0/V1/V2 checks and the conservative affected-check plan.
  - Run `python3 scripts/factory_preflight.py --require node pnpm --require-clean` after work-unit commits.
  - Record every command/result plus explicit `NOT_RUN`, `BLOCKED`, and remaining queue/station acceptance.
  - Update this artifact and its Engram mirror with exact base/HEAD, changed paths, commits, rollback boundary, and next step.
  - Hand the exact candidate to a different fresh reviewer. Do not self-approve, push, or create a PR without renewed authorization.
  - Acceptance: reviewable Conventional Commit work unit(s), clean exact-head evidence, and an honest partial #642 handoff.
  - Reopened after PR `#869` full browser CI run `36295531023`: the new scenario passed, then six later scenarios failed because it overwrote the shared `GATE_MODULE_A_ID` preset with `Continuity 600`. The saved-catalog upsert does not restore shared fixtures.
  - Correction boundary: give this scenario one stable exclusive module ID and use it through React selection, quote/design/release assertions, and live-default mutation. Do not overwrite or restore a shared module; keep its edge, material, hardware, and option fixtures on exclusive IDs and isolated catalog writes.
  - Correction acceptance: the focused scenario remains GREEN and `bash scripts/organization-browser-gate.sh` passes the complete disposable-PostgreSQL browser suite without downstream contamination.

- [ ] **642-CI-04 — Own and cancel copy-feedback timers**
  - Add deterministic fake-timer coverage for copy -> pending reset -> unmount -> timer advance, requiring no post-unmount reset callback or unhandled error. Cover replacement of an earlier pending reset when a second copy occurs if it stays within the same focused component contract.
  - Observe the focused lifecycle RED before changing production source. Stop without a product edit if the assertion cannot fail for the diagnosed reason.
  - Give `TechnicalCopyButton` local ownership of its pending timeout, cancel it on unmount and before scheduling another reset, and preserve current copied-label and rejection behavior.
  - Run the focused ProjectDesigns screen, focused Production Manager dashboard, full UI suite with zero unhandled errors, UI typecheck, `git diff --check`, final clean preflight, and the focused disposable-PostgreSQL browser gate.
  - Update this artifact and its complete Engram mirror, then create one Conventional Commit containing the regression, lifecycle fix, and artifact evidence. Do not push or mutate PR metadata.
  - Acceptance: deterministic RED -> GREEN is recorded; no reset dispatch survives unmount; recopy owns one current reset; all required checks pass; and the candidate is handed back at an exact clean HEAD for independent review.

## Verification plan

- V0: artifact/diff readback, `git diff --check`, focused format/type checks for changed paths, `python3 scripts/verify_affected.py --base origin/main --plan`, and final clean preflight.
- V1: focused component/unit checks selected by the exact eligibility code changed, including eligible canonical P1 and ineligible/no-release behavior.
- V1 CI correction: focused `ProjectDesignsScreen.test.tsx`, focused `ProductionManagerDashboard.test.tsx`, full `@granete/ui` suite with zero unhandled errors, and `@granete/ui` typecheck.
- V2 correction gate: `bash scripts/organization-browser-gate.sh` with disposable PostgreSQL and a real browser across the complete organization suite; the focused spec remains a diagnostic check only.
- Existing #398 browser evidence is historical routing evidence only and is not V2 proof for this candidate.
- Production Queue, station progression, physical execution, SketchUp/TestUp, PTX, and warehouse evidence are `NOT_RUN` unless separately authorized and applicable.

## Verification results

- Strict-TDD product RED observed with the exact required command: `bash scripts/organization-browser-gate.sh tests/organization/production-release-discovery.spec.ts` -> exit `1`, `1 failed` after 13.0 seconds in Chromium.
- Disposable PostgreSQL preparation and backend/fixture database identity readback passed before the scenario. The test reached canonical Q1 acceptance, exact R1 approval, exact P1 creation/cutting-demand assertions, and the explicit `Project.status = draft` plus exact resolved P1/Q1/R1 assertions without an earlier setup or harness failure.
- The normal `/production-dashboard` route rendered the `Dashboard de Producción` heading, then the stable row assertion failed: expected `pm-project-row-30582ca6-5436-4645-bf95-97ed07b5c062` visible; actual element not found after 5 seconds.
- Product owner/root: #642, `packages/ui/src/production/ProductionManagerDashboard.tsx:66-74`, whose current local eligibility filter includes only `accepted|produced`. No production source was edited after RED.
- Focused component RED before the product edit: `pnpm --filter @granete/ui test -- ProductionManagerDashboard.test.tsx` ran the UI suite and failed only the two new dashboard authority assertions (`canonical draft` expected 1/received 0; modern/stale without canonical authority expected 0/received 2); 2004 existing tests passed.
- Minimal product fix: `ProductionManagerDashboard` now consumes the existing shared `projectAllowsProductionAccess` rule. Canonical release authority admits the draft/P1 project; explicit pre-Digital-Thread `hasDigitalThreadContext: false` preserves legacy accepted/produced compatibility; missing/modern/stale projections fail closed. No new query, cache, status mutation, queue rule, or cross-session state was added.
- Focused V1 GREEN: `pnpm --filter @granete/ui exec vitest run src/production/ProductionManagerDashboard.test.tsx` -> `8 passed`.
- Full UI V1 GREEN: `pnpm --filter @granete/ui test` -> `176 passed` files, `2006 passed` tests.
- V2 GREEN: `bash scripts/organization-browser-gate.sh tests/organization/production-release-discovery.spec.ts` -> `1 passed (10.3s)` and `[organization-gate] PASS`; disposable preparation read back two isolated organizations, and backend/fixture database identities matched.
- V0 GREEN: `pnpm --filter @granete/ui typecheck` and `git diff --check` completed successfully.
- V0 NOT_RUN: focused Prettier check could not run because `prettier` is not installed (`ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL`). No dependency installation was attempted.
- Affected-plan readback: `python3 scripts/verify_affected.py --base origin/main --plan` conservatively selected all jobs because the ODD artifact is an unknown/sensitive boundary. The exact UI suite, typecheck, and organization browser proof ran; unrelated backend, SketchUp, visual, and foundation full gates remain pending/not run for final handoff selection.
- Work-unit commit: `5897435fd47c74faca44e4db3b9fe4bfe8088465` (`fix(production): discover canonical release projects`) contains the dashboard behavior, focused unit proof, disposable-PG browser proof, and this execution artifact together.
- Rollback boundary: revert the work-unit commit to remove only the `ProductionManagerDashboard` shared authority filter, its focused tests, the new browser scenario, and this focused ODD artifact; no queue/station/backend/SketchUp behavior is coupled to it.
- Independent review APPROVED exact candidate `9682d706b3736ba64356edfe7338e74620879f2c` against base `5b93d336b194077ec116a10d9bd7fff9d4ca9658` with no blockers. The reviewer re-ran the release-authority domain suite (`15/15`), focused dashboard UI (`8/8`), disposable-PostgreSQL browser scenario (`1/1`), diff check, and clean preflight successfully.
- Parent spot-check: focused dashboard UI re-run passed `8/8` on the same reviewed candidate.
- PR `#869` full browser CI run `36295531023` is the strict-TDD correction RED: the new spec (`#61`) passed, then six later scenarios failed. Reviewer comparison proved the base full browser suite passes `92/92`; the candidate test alone mutated shared `GATE_MODULE_A_ID` to the `Continuity 600` preset, and `saveCatalog` upsert semantics made the attempted restore incomplete. This is a test-isolation defect, not a production regression.
- Verification correction: the scenario now owns stable module `89800000-0000-4000-8000-000000000010` (`DISCOVERY-P1`) and uses that identity in the React selector and every quote, FurnitureInstance, Q1, R1, and P1 assertion. Catalog writes contain only the scenario's exclusive edge, material, hardware, option groups, component, structure, and module; they no longer upsert or attempt to restore shared fixtures.
- Isolation readback inside the browser scenario proves the original `GATE-A` module remains byte-for-byte equal to its pre-write API projection and proves the exclusive edge, material/default edge, option memberships, preset, and module identities persisted as authored.
- Focused correction diagnostic: first local attempt reached a harness-owned strict-selector ambiguity because the broad module-name regexp also matched the scenario's material/hardware options; replacing it with the stable exclusive module-ID selector removed the harness ambiguity. No production failure was claimed.
- Focused V2 GREEN: `bash scripts/organization-browser-gate.sh tests/organization/production-release-discovery.spec.ts` -> `1 passed (11.1s)` and `[organization-gate] PASS` on disposable PostgreSQL.
- Required full V2 GREEN: `bash scripts/organization-browser-gate.sh` -> `93 passed (5.4m)` and `[organization-gate] PASS` on disposable PostgreSQL. The corrected scenario passed as test `#61`, and every downstream scenario, including the six that failed in CI, also passed.
- Correction V1/V0 GREEN: `pnpm --filter @granete/ui exec vitest run src/production/ProductionManagerDashboard.test.tsx` -> `8 passed`; `pnpm --filter @granete/ui typecheck` and `git diff --check` completed successfully.
- Exact-head CI and fresh independent review remain pending; the earlier approval does not cover the correction HEAD.
- Production Queue, station screens, physical progression, SketchUp/TestUp, PTX, and warehouse remain `NOT_RUN` and outside this task.
- `642-CI-04` diagnosis before source edits: PR `#869` run `36297444946` completed `176/176` UI files and `2006/2006` tests, then failed on one post-teardown `ReferenceError: window is not defined` from `TechnicalCopyButton`'s uncancelled two-second reset into `handleTechnicalCopyReset`. The target source and test were unchanged from both pinned base and current `origin/main`, so #869 exposed but did not introduce the defect.
- Strict-TDD lifecycle RED: `pnpm --filter @granete/ui exec vitest run src/digitalThread/ProjectDesignsScreen.test.tsx` -> `1 failed, 59 passed`. The isolated regression proved that unmount did not cancel the captured two-second reset timer. An initial fake-timer harness attempt also stranded fake timer bindings for later tests; the harness was corrected to observe the real timer handle and clean it explicitly before claiming the product RED.
- Second focused lifecycle RED after the first cleanup implementation: stale clipboard completion after unmount still scheduled one two-second reset (`1 failed, 60 passed`). The component now tracks mounted state as well as its timer, so neither resolved nor rejected stale clipboard work dispatches copy state after unmount.
- Minimal lifecycle fix: each `TechnicalCopyButton` owns one reset timer, cancels a prior reset before recopy, clears the current reset on unmount, and ignores clipboard completion after unmount. Existing copied-label timing and rejection reset behavior remain unchanged while mounted; no global guard, sleep, swallowed exception, or test-only product path was added.
- Focused Project Designs GREEN: `pnpm --filter @granete/ui exec vitest run src/digitalThread/ProjectDesignsScreen.test.tsx` -> `61 passed`.
- Focused dashboard GREEN: `pnpm --filter @granete/ui exec vitest run src/production/ProductionManagerDashboard.test.tsx` -> `8 passed`.
- Full UI GREEN: `pnpm --filter @granete/ui test` -> `176 passed` files, `2008 passed` tests, exit `0`; log scan found zero `Unhandled Errors`, `ReferenceError: window is not defined`, or unhandled-error matches.
- V0 GREEN: `pnpm --filter @granete/ui typecheck` and `git diff --check` completed successfully.
- Focused disposable-PostgreSQL V2 GREEN: `bash scripts/organization-browser-gate.sh tests/organization/production-release-discovery.spec.ts` -> `1 passed (10.2s)` and `[organization-gate] PASS`, with matching backend/fixture database identity.
- Affected-plan readback again selected every job because the ODD artifact is a sensitive/unknown boundary. The required UI, typecheck, diff, and focused organization browser checks ran; unrelated backend, SketchUp, visual, and foundation full gates remain `NOT_RUN` for this bounded CI correction.

## Forecast and delivery strategy

- Reviewed candidate authored size is **739 lines** (738 additions, 1 deletion). This remains below 800, so the explicit normal-range policy applies and no slicing evaluation is triggered.
- Corrected candidate authored size is **765 lines** (764 additions, 1 deletion) against pinned base `5b93d336b194077ec116a10d9bd7fff9d4ca9658`; it remains below 800, so no slicing evaluation is required.
- CI correction forecast: approximately **70-110 additional authored lines**, for an expected cumulative total of **835-875**. This enters the 800-1200 evaluation range. The evaluated strategy remains one PR because the lifecycle regression and fix directly restore this same PR's exact-head required UI check; separating them would leave #869 knowingly red and split one atomic correction. No code-golf or artificial split is justified. Stop for a human checkpoint if the actual total exceeds 1200.
- Actual pre-commit cumulative size is **893 authored lines** (889 additions, 4 deletions) against pinned base `5b93d336b194077ec116a10d9bd7fff9d4ca9658`. The prior 800-1200 evaluation therefore applies: keep this inseparable exact-head CI repair in PR #869, with no artificial split and no size exception.
- Strategy: **single PR** while the actual authored total remains in the user-authorized normal range.
- User size policy: **0-800 authored lines is normal; 800-1200 requires evaluation before delivery; over 1200 requires a user checkpoint before continuing or delivery**.
- The 400-line ODD value remains a planning heuristic only. Do not code-golf, omit proof, or split one coherent root change solely to satisfy it.
- If the actual scope crosses a policy threshold, update this artifact before the next commit and follow the required evaluation/checkpoint.

## Progress and evidence

- [x] Worktree, branch, exact `origin/main`, and starting HEAD read back at `5b93d336b194077ec116a10d9bd7fff9d4ca9658`.
- [x] Issue #642 read back as open and `status:approved`; no assignee or existing branch PR was present.
- [x] `python3 scripts/factory_preflight.py` -> `PREFLIGHT_OK_NOT_VERIFIED`; clean worktree at preflight; tests `NOT_RUN`; required local tools reported present.
- [x] CodeGraph index present in the isolated worktree before structural exploration.
- [x] Historical #398 evidence and sibling worktree preserved as read-only context.
- [x] Fresh normal-dashboard product RED observed: normal dashboard rendered, but the exact same-ID draft/P1 project row was absent.
- [x] Product correction implemented: shared canonical release authority drives only dashboard discovery; negative modern/stale no-release paths fail closed.
- [x] Work-unit commit created: `5897435fd47c74faca44e4db3b9fe4bfe8088465`.
- [x] Independent review completed: APPROVED with no blockers at `9682d706b3736ba64356edfe7338e74620879f2c` vs `5b93d336b194077ec116a10d9bd7fff9d4ca9658`.
- [x] Verification correction completed in work-unit commit `280f7930e60a69cc23f1f32af594679911efa349` (`test(organization): isolate #642 release fixture`): exclusive fixture persisted without shared-module mutation, focused browser passed `1/1`, and the complete disposable-PostgreSQL browser suite passed `93/93`.

## Next step

Execute `642-CI-04` under strict TDD, then return the exact clean correction candidate to the parent for fresh review and separately authorized PR update. Do not push from this task.
