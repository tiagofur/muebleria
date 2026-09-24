# #460 — Web auth refresh continuation for generated quote reads

## Objective and authority

Deliver a bounded, partial #460 fix so a recoverable 401 from the real generated QuoteRevision client refreshes and completes the original read once, without replaying commercial intent. The human explicitly authorized implementation and one scoped PR with `Refs #460`, `Delivery: partial`, and `type:bug`. #398 retains the original journey evidence. Base: `origin/main` at `f00549ec8ea1d411007ea40082e21f2cb22c31e7`; branch: `fix/460-web-auth-refresh-replay` in the isolated worktree.

## Problem and evidence

- `quoteRevisionAuthority.ts` constructs `GraneteApiClient` without a fetch adapter. The client sends an explicit bearer through global fetch.
- The global `auth401` handler starts refresh but returns the original 401. The existing `authenticatedApiFetch` coordinates refresh, validates context, and retries once, but currently does not replace an explicit stale bearer, distinguish same-context late 401 from a scope switch, or check cancellation immediately before replay.
- The first 401 seen in the prior #398 browser journey is not yet causally classified. A valid refresh without continuation is proven separately; do not claim it proves why that first access failed.

## Scope and constraints

- Reuse the existing web auth coordinator and generated client adapter seam. No new refresh coordinator, global indiscriminate retry, generated-file edit, per-screen patch series, or Go auth policy change without a demonstrated need.
- Preserve one retry, authorized API origin, request parameters/headers/signal, context isolation, logout/org-switch invalidation, concurrent refresh coalescing, and terminal 401/refresh/network/error behavior. Preserve idempotency/preconditions if a shared boundary reaches mutations.
- No absolute-session extension, credential policy, MFA, CSRF, SketchUp, Keychain, production catalog, or persistent database change.
- #835 is open and touches only the database-env line of `prequote-design.spec.ts`; do not edit that file without prior coordination. The #398 response-capture failure is distinct and may remain an explicit follow-up.
- For browser proof use new disposable PostgreSQL with separate migration/runtime roles and real RLS. Expose API, database, and Vite only on host loopback and verify sockets/ports before testing. Do not reuse the destroyed #398 environment.

## Mode, route, and delivery

- Strict TDD: **enabled** by project AGENTS instructions. Unit runner: `pnpm --filter @granete/web exec vitest run src/webAuthClient.test.ts src/auth401.test.ts <new generated-client regression>`; observe RED before product edits, then GREEN and refactor. Browser runner: `pnpm exec playwright test --config=playwright.organization.config.ts <scoped spec>` in a disposable environment. Run applicable focused/typecheck and `scripts/verify_affected.py` gates on the frozen candidate.
- Route: delegated direct. Understanding requires at least `auth401.ts`, `webAuthClient.ts`, `main.tsx`, `quoteRevisionAuthority.ts`, generated-client/storage adapter, and tests (mapping trigger); implementation spans multiple non-trivial files (writer trigger). One bounded writer owns source edits; a fresh reviewer owns the exact candidate.
- Forecast: approximately 380 authored additions plus deletions across two work units; monitor actual count rather than omitting tests to meet this estimate. Delivery strategy: `ask-on-risk`. No RDD review: effective clone-local switch is off; ordinary independent review remains required.

## Tasks

- [ ] **T1 — Generated-client recovery contract.** Add a RED regression invoking `listProjectQuoteRevisions` through the production adapter, including a recoverable 401 and the observed final body. Implement the smallest shared web-auth integration. Verify stale explicit bearer, same-context late 401, cancellation, context switches, concurrency, second 401, terminal refresh, network errors, non-401 errors, and own-origin restriction with focused tests. Record RED/GREEN commands and a Conventional Commit identity.
- [ ] **T2 — Real browser acceptance.** Add or adapt a scoped Chromium scenario using Go and disposable PostgreSQL/RLS. Induce a recoverable access failure without disabling authorization; observe 401, refresh, one replay, correct project content and unchanged FI/Q1 count without manual login/reload. Include terminal refresh and organization-switch negatives. Distinguish controlled invalid/expired access from a naturally timed expiry. Record loopback socket/port readback, backend HEAD, commands/results, cleanup, and a work-unit commit.

## Candidate and publication gate

- [ ] Inspect `python3 scripts/verify_affected.py --base origin/main --plan`; run applicable gates on frozen HEAD. Report failures and unavailable checks honestly.
- [ ] Obtain independent review of exact HEAD/base and resolve at most one consolidated correction/revalidation pass.
- [ ] Publish a scoped, truthful PR with first lines `Refs #460` and `Delivery: partial`, exactly one `type:bug` label, no merge or issue closure. Read back exact remote HEAD/base, CI, labels, and mergeability.

## Progress and next step

Exploration complete. #460 is open/approved and has no existing matching PR or issue artifact on this base. #835 remains open at `4fc05bf88cbf67bbeac8bf69c73c48602042f845`. Initial worktree preflight: `PREFLIGHT_OK_NOT_VERIFIED`, clean.

**Safety pause (2026-09-23):** The T1 writer observed a meaningful RED through the generated quote client (`pnpm --filter @granete/web exec vitest run src/quoteRevisionAuthority.test.ts`: 1 failure, original 401 surfaced despite refresh 200 and a simulated successful replay response). T1 source changes are now **uncommitted and unverified**, and the writer was interrupted. No PR or push. During disposable browser setup, the host admin CLI was invoked without `MIGRATION_DATABASE_URL`; its source defaults to `localhost:5445/muebles`, and private logs reportedly show two successful test platform-admin/org creations. Actual persistent-DB effects are **unverified**: no read or cleanup was performed there. Disposable containers/services are stopped, owned listeners closed, and private logs preserved. T2 is **BLOCKED/NOT_RUN**. Do not resume tests, commit, or publication until the human authorizes a scoped incident audit and the environment is made fail-closed.
