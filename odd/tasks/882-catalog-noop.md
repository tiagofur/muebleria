# #882 — Avoid catalog writes for an unchanged quote customer

## Objective and problem

Creating a draft quote with an existing, unchanged customer currently invokes a catalog upsert and persists the whole catalog. The user observed a burst of catalog PUT requests during this otherwise unrelated action. Correct the no-op trigger without changing legitimate customer persistence.

## Authority and scope

- Approved issue: https://github.com/tiagofur/muebleria/issues/882 (`status:approved`, open).
- Base: `origin/main` at `a902c9934a8914a80c7f8b16a3b3224fac4b94d6`.
- Branch/worktree: `codex/882-catalog-noop` in this isolated checkout; one writer.
- In scope: normal draft quote creation with an existing or newly created customer, plus focused regression tests.
- Out of scope: catalog repository redesign (#443), SketchUp identity display (#883), backend/schema changes, quote publication, production workflows, credential changes, and the user's SketchUp model.

## Execution and delivery

- Lane: ODD; one coherent work unit.
- Route: delegated direct. Mapping required four or more source/test files, and the implementation crosses non-trivial source and test files. A single bounded writer owns the change.
- TDD: enabled by the project's explicit strict-TDD instruction. Runner: `pnpm --filter @granete/web exec vitest run src/stores/projectStore.test.ts` (focused `-t` selector for the new regression when suitable). Observe RED before the fix, then GREEN and REFACTOR. Use local/offline dependencies only; report unavailable tooling rather than silently downloading.
- Forecast: 80–140 authored changed lines, excluding generated files. Delivery strategy: `ask-on-risk`; forecast is below the ~400-line review heuristic. Running count: 54 source/test additions plus deletions before this artifact update.
- RDD: disabled by clone-local setting; ordinary functional checks and independent review still apply. No native review transaction is authorized.

## Task checklist

- [ ] **T1 — Prevent no-op catalog persistence in draft quote creation.** Add a test that first demonstrates a catalog save for an unchanged existing customer while a quote is created. Make the smallest source change that skips the save for this no-op and preserves a real new-customer save. Run focused checks, inspect the diff, and record one Conventional Commit containing behavior, tests, and this artifact.

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
- V0: `git diff --check` passed. `pnpm --filter @granete/web typecheck` passed. No generated API or schema changed.
- V1: `pnpm --filter @granete/web test` passed, 45 files and 558 tests. `python3 scripts/verify_affected.py --base origin/main --plan` returned a conservative all-jobs plan because this ODD artifact is an unknown input; unrelated Go/SketchUp/PostgreSQL/browser gates are not claimed from the focused web validation.
- V2: NOT_RUN. The live React-to-Go browser flow belongs to a running app from another checkout; this isolated worktree was not installed into it, and no live process or model was changed.
- Rollback boundary: revert only this task's `projectStore.ts` guard and matching `projectStore.test.ts` regression; no storage, backend, SketchUp, or schema change.
- Commit: pending; source and focused tests will be one work unit.
- Review and CI: pending; RDD `disabled/unmanaged`.

## Next step

Commit this work unit, run final clean preflight, and hand the exact HEAD/base to a fresh reviewer. Repeat the authorized V2 flow from the corrected checkout before claiming complete delivery.
