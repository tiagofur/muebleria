# #882 — Avoid catalog writes for an unchanged quote customer

## Objective and problem

Creating a draft quote with an existing, unchanged customer currently invokes a catalog upsert and persists the whole catalog. The user observed a burst of catalog PUT requests during this otherwise unrelated action. Correct the no-op trigger without changing legitimate customer persistence.

## Authority and scope

- Approved issue: https://github.com/tiagofur/muebleria/issues/882 (`status:approved`, open).
- Base: `origin/main` at `7c8d33f80a67908c5649eda2a0662cc6d55ea31c` (rebased from `a902c9934a8914a80c7f8b16a3b3224fac4b94d6`).
- Branch/worktree: `codex/882-catalog-noop` in this isolated checkout; one writer.
- In scope: normal draft quote creation with an existing or newly created customer, plus focused regression tests.
- Out of scope: catalog repository redesign (#443), SketchUp identity display (#883), backend/schema changes, quote publication, production workflows, credential changes, and the user's SketchUp model.

## Execution and delivery

- Lane: ODD; one coherent work unit.
- Route: delegated direct. Mapping required four or more source/test files, and the implementation crosses non-trivial source and test files. A single bounded writer owns the change.
- TDD: enabled by the project's explicit strict-TDD instruction. Runner: `pnpm --filter @granete/web exec vitest run src/stores/projectStore.test.ts` (focused `-t` selector for the new regression when suitable). Observe RED before the fix, then GREEN and REFACTOR. Use local/offline dependencies only; report unavailable tooling rather than silently downloading.
- Forecast: 80–140 authored changed lines, excluding generated files. Delivery strategy: `ask-on-risk`; forecast is below the ~400-line review heuristic. Running count: 106 authored additions plus deletions in the implementation commit, including this artifact.
- RDD: disabled by clone-local setting; ordinary functional checks and independent review still apply. No native review transaction is authorized.

## Task checklist

- [x] **T1 — Prevent no-op catalog persistence in draft quote creation.** Add a test that first demonstrates a catalog save for an unchanged existing customer while a quote is created. Make the smallest source change that skips the save for this no-op and preserves a real new-customer save. Run focused checks, inspect the diff, and record one Conventional Commit containing behavior, tests, and this artifact.

## Acceptance and checks

- An unchanged existing customer can be used to create a draft quote without a catalog save/PUT.
- A genuinely new customer still persists through the authorized catalog path.
- Quote creation and returned identity are unchanged.
- V0: focused diff, format/type/structural checks, `factory_preflight.py --require-clean` after commit.
- V1: exact focused Vitest command and conservative `verify_affected.py --base origin/main --plan` followed by applicable validation.
- V2: authorized local React-to-Go browser flow with quote readback and no catalog PUT for the unchanged-customer action; mark NOT_RUN if unavailable. Do not touch SketchUp for this fix.

## Progress and evidence

- Preflight: `PREFLIGHT_OK_NOT_VERIFIED` on clean branch at the base above; tests `NOT_RUN`.
- Read-only map: existing-customer quote path unconditionally calls `upsertCustomers`; the customer catalog store patches unconditionally; repository `saveCatalog` writes all catalog families. Current no-op test checks state but not persistence. Test requires an active workspace session to exercise the save boundary.
- Local dependencies: `pnpm install --offline --frozen-lockfile` succeeded with zero downloads; no lockfile change.
- RED: `pnpm --filter @granete/web exec vitest run src/stores/projectStore.test.ts -t 'skips catalog persistence for an unchanged customer but saves a new customer'` failed, 1 failed/72 skipped, at `expect(saveCatalog).not.toHaveBeenCalled()`; the spy observed one full-catalog save.
- GREEN: `pnpm --filter @granete/web exec vitest run src/stores/projectStore.test.ts` passed, 73/73. Refactor/readback: only `createProject` guards the upsert on an appended customer; the test proves no save for an existing customer, one save for a new customer, and quote/customer identity alignment.
- V0: `git diff --check` passed. `pnpm --filter @granete/web typecheck` passed. `python3 scripts/factory_preflight.py --require node pnpm --require-clean` returned `PREFLIGHT_OK_NOT_VERIFIED` at the clean implementation commit. No generated API or schema changed.
- V1: `pnpm --filter @granete/web test` passed, 45 files and 558 tests. `python3 scripts/verify_affected.py --base origin/main --plan` returned a conservative all-jobs plan because this ODD artifact is an unknown input; unrelated Go/SketchUp/PostgreSQL/browser gates are not claimed from the focused web validation.
- V2 (narrow #882 flow): PASS observed before the rebase on the corrected React worktree at `64a1792ceace0befd3780ea317a129eac20be9ac`, temporarily served at `localhost:5173` against the local Go backend at `localhost:8080` and local PostgreSQL at `[::1]:5445`. The `projectStore.ts` and `projectStore.test.ts` Git blob IDs are identical after rebasing (`e819bd0f1db9d4207bcd67e062dce4a044166562` and `ed950546156daf416d3a688958ea72ac6898aaf1`); the live flow was not replayed on the new base.
  - The signed-in browser session created draft `Prueba catálogo sin cambios #882` for existing synthetic customer `Pin Test Customer 224046.086565`. The untruncated action-window capture contained four events total, including `OPTIONS /api/projects` (204) and `POST /api/projects` (201), with zero catalog `PUT` requests.
  - Reload capture was truncated, so it does not establish a complete reload request count; `/api/projects` returned 200 and the persisted React list showed 5/5 quotes including the new draft. This proves only the bounded unchanged-customer create/readback, not broader Phase 1 behavior or the new-customer browser path.
  - The original `localhost:5173` development server from the main checkout was restored and verified by listener cwd, HTTP 200, the same signed-in account, and the draft remaining visible. No SketchUp model or credentials were changed.
- Rollback boundary: revert only this task's `projectStore.ts` guard and matching `projectStore.test.ts` regression; no storage, backend, SketchUp, or schema change.
- Rebased work-unit commit: `716cd4490abcbac0d95264a84af789ae26fe3a6f` (`fix(web): skip catalog save for unchanged quote customer`), with behavior, tests, and this artifact. Rebased evidence commits: `33c36aa65e3f87451808796a8f4ce19810fda404` and `e0767cf6c9687475b87dd7ae3ff9e1cde0934949`. These supersede the pre-rebase commit identities without changing the source/test blobs.
- Post-rebase checks at `e0767cf6c9687475b87dd7ae3ff9e1cde0934949`: focused Vitest 73/73, full web tests 558/558 across 45 files, and web typecheck passed. `git diff --check` passed. `python3 scripts/verify_affected.py --base origin/main --plan` again selected all jobs because the ODD artifact is an unknown input; unrelated jobs were not run locally. No source edits followed these checks.
- Review and CI: pending for the new exact HEAD after this evidence-only update; the independent review of the pre-rebase HEAD reported no source blocker but does not certify the rebased candidate. RDD `disabled/unmanaged`.

## Next step

Hand the new exact HEAD/base plus the bounded V2 proof to a fresh reviewer. Push, PR publication, exact-HEAD CI, and human handoff remain pending under the leader's control; do not claim broader Phase 1 completion.
