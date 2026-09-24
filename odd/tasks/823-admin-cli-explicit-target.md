# #823 — Explicit admin CLI target and guarded test preparation

## Objective and authority

Prevent administrative preparation from silently reaching a persistent local
database when its migration DSN is absent. This is the user-authorized,
partial continuation of approved issue #823 after PR #835 merged. Base:
`origin/main` at `aec03be9bc52b6ea9bd5e891d6d5eba8c9118e4f`.

The incident's account containment and data remediation are separate. This
change must not read or write the persistent database, touch the paused #460
worktree, or perform cleanup. Use synthetic data in tests and the PR.

T2 continuation: PR #837 was merged by human decision. The independent T2
branch starts from new `origin/main` at
`6184b4d2d36c5c73e3fbcabde2c2785e5335e565`; it does not reuse the T1
branch or reapply T1 commits. T2 is now authorized; its PR targets `main`.

## Scope and constraints

- Require an explicit, valid `MIGRATION_DATABASE_URL` for every admin CLI
  operation before opening a connection. Do not fall back to `DATABASE_URL` or
  any implicit persistent target. Preserve explicit legitimate admin use
  outside tests, without imposing test markers on human operations.
- T2 scope, separate from the merged T1 PR: validate and explicitly pass
  the runtime and admin DSNs used by the browser preparation's server and admin
  children. Keep its disposable container and loopback binding, and do not
  give the privileged migration role to the application runtime.
- Align CLI help/errors and the existing isolation contract. Do not expose DSNs
  or passwords in diagnostics, rewrite the backend test runner, relax RLS or
  `LoadConfig`, or create another metadata workflow.
- Deliver one scoped T1 PR to `main` with `Refs #823` and
  `Delivery: partial`; no merge or automatic issue closure. T2 is a later,
  independent PR to `main` only after human merge and separate authorization.

## Execution plan

Route: delegated direct. Mapping required more than four files; implementation
requires one bounded writer across non-trivial Go, shell, tests, and docs.
TDD: enabled by the project `AGENTS.md` strict-TDD setting. Observe safe RED,
then GREEN and REFACTOR for each behavior; never run a negative against the
persistent database. Focused Go runner: from `backend-go`,
`env -u DATABASE_URL -u MIGRATION_DATABASE_URL go test -count=1 ./cmd/admin`
with DB-free tests. The writer must name the exact safe shell/guard test runner
before editing that unit. Positive PostgreSQL checks use a disposable container.
RDD: disabled for this clone (`gentle-ai review mode status`, clone-local off).
Delivery strategy: user-selected sequential independent PRs to `main` (T1 now,
T2 after merge and separate authorization). The original 350-line feature
forecast became stale; record actual authored lines and do not code-golf if
the cohesive T1 proof exceeds about 400. Publication policy and any required
size exception remain the leader's responsibility.

## Tasks

- [x] **T1 — Fail closed at the admin CLI boundary.** Add a safe RED regression
  for missing, empty, malformed, and `DATABASE_URL`-only configuration without
  connecting to the habitual database. Make `openStore` resolve and validate the
  explicit admin DSN before `NewPostgresStore`/Ping; reuse #835's test isolation
  validation only when running as a test preparer. Cover error redaction, CLI
  help, and the real invocation boundary. Keep explicit legitimate manual DSNs.
  Route: delegated writer; evidence: mapping and multi-file Go/test/docs work.
  Additional user-authorized proof: run real `openStore` against a disposable
  PostgreSQL container with destination readback, and guard direct callers of
  the shared test-DB validators against host/database query overrides. Checks:
  focused DB-free RED/GREEN Go tests, a real disposable positive, and
  syntax/build checks. Initial behavior commit:
  `06694bc5c6bdfc62f35b7e9164795d7ad0576e0a`; continuation commit:
  `a3a3998ae26f0d12c8da2094d26b9bcbc7c0f0d2`. Review:
  disabled/unmanaged; the separate T1 candidate was independently reviewed,
  checked, and merged by a human via PR #837. T2 needs its own review.
- [x] **T2 — Guard the browser preparation boundary.** Guard the disposable browser
  preparation children. Add safe RED
  coverage for absent marker/incomplete DSNs and child environment forwarding.
  Before server migration and each admin child, prove the exact disposable
  loopback runtime/admin targets and pass both DSNs explicitly. Keep runtime
  role distinct from migration owner. Add an executable anti-regression check,
  update the canonical isolation documentation, and verify a valid disposable
  PostgreSQL preparation end-to-end. Do not rewrite the full runner.
  Route: delegated writer; evidence: shell, Go validation, tests, and docs.
  Checks: focused DB-free negatives, `bash -n`, relevant static gate, and real
  disposable positive. Commit identity: recorded below after the work-unit
  commit. Review: disabled/unmanaged; fresh repository review pending.

## Acceptance and verification record

- [x] Missing/empty/invalid admin DSN and `DATABASE_URL`-only fail before connect.
- [x] Test marker absent/incomplete or persistent DSNs cannot provision.
- [x] Exact valid disposable runtime/admin DSNs reach the intended children.
- [x] CLI errors redact credentials; help and docs name the same contract.
- [x] Real disposable PostgreSQL positive passes; no persistent DB access.
- [ ] Fresh independent review and exact HEAD/base checks before publication.

Initial state at document creation: issue #823 reopened and still
`status:approved`; PR #835 merged; new branch and worktree are isolated from
#460. No source edits or tests existed at that point.
Engram task mirror `odd/823-admin-cli-explicit-target/tasks`: pending because
Engram cannot choose among multiple active runtime sessions; this file is the
recovery source of truth.

## T1 implementation evidence (first work unit)

- Scope: `cmd/admin` now requires an explicit migration URL before pool open,
  rejects incomplete/invalid URLs and target-overriding query options, applies
  the existing test-admin guard when `GRANETE_TEST_DATABASE=1`, and redacts
  connection failures. Explicit manual admin URLs outside test mode remain
  usable. Help and the canonical isolation contract describe this boundary.
- Safe RED: from `backend-go`,
  `env -u DATABASE_URL -u MIGRATION_DATABASE_URL go test -count=1 ./cmd/admin`
  failed to compile because `openStore` did not accept the injected fake
  connector. No CLI command, connection, or database access ran. After the
  first implementation pass, the focused test failed specifically for URL
  query overrides of `dbname` and `host`; the connector fake was invoked in
  both cases. The guard was then extended to reject those options.
- GREEN: the same focused command passed (`ok`, approximately 0.5 s);
  `env -u DATABASE_URL -u MIGRATION_DATABASE_URL go vet ./cmd/admin` passed;
  `git diff --check` passed. All test connectors were in-memory fakes.
- Operational boundary at the first T1 commit: no PostgreSQL or admin CLI
  command had run. The later T1 continuation added a real disposable-only
  connection check. No persistent database was read or written.
- Rollback boundary: revert this T1 work unit only (`backend-go/cmd/admin/main.go`,
  `backend-go/cmd/admin/database_target_test.go`, and the T1 documentation
  paragraph); no browser preparation behavior is included.
- Behavior commit: `06694bc5c6bdfc62f35b7e9164795d7ad0576e0a`.
  The isolated branch had 303 authored changed lines at this commit,
  including this task document. The original 350-line feature forecast is
  likely low; apply `ask-on-risk` before a later work-unit commit if the
  projected running total crosses about 400. T2 remains open.

## T1 continuation — user-authorized proof and slice boundary

- User decision: sequential independent PRs to `main`, with T1 now and T2
  only after human merge plus separate authorization. Necessary T1 evidence
  may exceed about 400 authored lines; no code-golf or size-checker changes.
- Shared validator RED: with all `DATABASE_URL`, `MIGRATION_DATABASE_URL`,
  and `PG*` connection variables unset, the focused `internal/storage` test
  showed both writable and admin validators accepted synthetic `dbname`,
  `host`, `port`, and `service` query overrides and a URL without a host.
- Shared validator GREEN: `parseAndValidateCommon` rejects those ambiguous
  targets before returning a URL. Focused storage guard tests and `cmd/admin`
  tests passed with connection variables unset; `go vet` passed. No DB access
  occurred in those tests.
- Operational positive: a new `postgres:16-alpine` container with tmpfs data,
  synthetic credentials, random `granete_test_admin_*` database, and a random
  `127.0.0.1` host port was identity- and port-checked before the opt-in test.
  The actual `openStore()` connected, then read back the database, user, and
  server port from that disposable instance. The container was stopped and
  removed by `--rm`; no persistent database was accessed. Final positive run:
  container `8948c886a717`, `postgres:16-alpine`, tmpfs
  `/var/lib/postgresql/data`, bind `127.0.0.1:56491`, database
  `granete_test_admin_57fac47f0393`; readback matched that database,
  `admin_cli_probe`, and server port `5432`. The opt-in command was
  `go test -count=1 ./cmd/admin -run '^TestOpenStoreAgainstDisposablePostgres$' -v`
  with only this disposable DSN and `GRANETE_TEST_DATABASE=1` supplied;
  PASS. Post-run Docker readback found no container with the test label.
- Rollback boundary for this continuation: the shared target-validation
  change and focused tests in `backend-go/internal/storage/testdb_guard*.go`,
  the opt-in PostgreSQL test in `backend-go/cmd/admin/database_target_test.go`,
  and their canonical documentation paragraph. No browser runner or ordinary
  backend authentication behavior was modified.
- Applicable final checks: focused `cmd/admin` and named storage guard tests,
  `go vet` for those two packages, `git diff --check`, and the read-only
  `verify_affected.py --plan`. Broad backend/React/browser/SketchUp gates in
  that conservative plan remain `NOT_RUN` for this T1 slice; they are not
  database-safe without separate disposable fixture preparation.
- T2 server/admin child forwarding, browser preparation, broad suites, and
  independent review remain outside the T1 proof.
- T1 behavior boundary: `06694bc5c6bdfc62f35b7e9164795d7ad0576e0a`
  and `a3a3998ae26f0d12c8da2094d26b9bcbc7c0f0d2`, with task-only evidence
  commits on the same branch. At the continuation behavior commit the running
  authored count was 510 additions plus deletions across work-unit commits;
  the net `origin/main..HEAD` diff was 464 lines including this task document,
  or 306 product/test/documentation lines without the task document. Keep the
  cohesive slice; the leader will handle publication policy and any required
  size exception. Delivery remains partial because T2 is not implemented.

## T2 continuation — isolated browser preparation candidate

- Base: `origin/main` at `6184b4d2d36c5c73e3fbcabde2c2785e5335e565`
  after human merge of #837. One writer in the clean
  `fix/823-browser-preparation-guard` worktree. No #460 paths changed.
- Route: delegated direct, because shell launcher, Go guard/tests, CI gate,
  and canonical documentation are non-trivial multi-file work. Strict TDD
  remains enabled by `AGENTS.md`; RDD is clone-locally off. Delivery strategy
  remains sequential PRs to `main`, never a stacked tracker. The user
  explicitly approved `size:exception` for one cohesive T2 PR rather than
  splitting protection from its regression; no code-golf or artificial slice.
- Safe RED: `go test -count=1 ./cmd/testdb-preflight` failed to compile for
  missing `validateBrowserGateTargetPair`. The real-shell double test against
  the *base* launcher failed because it did not invoke preflight and did not
  pass test markers to the server/admin children. No PostgreSQL connection or
  writable child ran in these RED checks.
- GREEN: Go preflight tests reject absent markers, absent runtime/admin URL,
  persistent target on either side, mismatched instance/base, target-overriding
  URL query, wrong role, and non-loopback/missing port without connecting.
  The launcher calls that shared-validator-based preflight before the server
  or five admin commands, passes scoped `env -i` with both DSNs/markers to
  every child, and supplies Playwright the same validated fixture target.
  Real-launcher doubles confirm ambient database/PG variables do not leak.
  Local opt-in integration runs the *real Go preflight* through that launcher
  for ten unsafe cases and observes exactly the preflight child, no writer.
- Direct Playwright RED: the pre-change config's actual `--list` entrypoint
  accepted a fixture URL with `?dbname=muebles`; a mocked globalSetup test
  observed that the same URL reached `prepareAuthoritativeOrganizations`.
  GREEN: config and globalSetup now call one shared TypeScript target guard,
  rejecting host/port/database/service query overrides, non-loopback or
  incomplete URLs before any API setup. The direct config negative rejects
  before a web server starts; its safe synthetic positive lists 2 tests. The
  globalSetup regression has four negative override cases plus a safe
  positive, and the root `pnpm test` script/CI static check retain this gate.
- V2 positive: `scripts/organization-browser-gate.sh --list
  tests/organization/prequote-design.spec.ts` ran real disposable PostgreSQL,
  migrations, runtime backend, five admin commands, and safe readback
  (`granete_gate|2|2`), then destroyed the container. A second run executed
  the actual Chromium `prequote-design.spec.ts` flow: 2/2 tests passed after
  the same setup/readback. No persistent DB was read or written. The runner
  checks `granete_app` as LOGIN/NOSUPERUSER/NOBYPASSRLS before server start.
- V0/V1 checked so far: `bash -n`, focused Go preflight/admin tests,
  `git diff --check`, `go vet`, 42 Python CI tests (one opt-in skip), 5 direct
  Playwright fixture guard tests, and ten opt-in real-Go-preflight negative
  launcher cases passed. `pnpm test` and `pnpm typecheck` passed with all DB
  environment variables absent; the new Vitest fixture guard is in the root
  test command. The full disposable browser gate passed 2/2 Chromium tests
  again after the direct guard change. Broader exact-head CI and fresh
  independent review remain pending until candidate freeze.
- Rollback boundary: `backend-go/cmd/testdb-preflight/`,
  `scripts/organization-browser-gate.sh`, its CI launcher regression test,
  shared direct Playwright guard/tests and wiring, root test script, and the
  T2 paragraphs in the canonical isolation contract. The merged T1 admin CLI
  contract and shared URL validators are not part of T2 rollback.
- Publication completeness for #823 requires the leader's reconciliation of
  remaining issue acceptance against #835/#837 and exact-head checks; this
  candidate alone is not a self-approval or incident-resolution claim.
- T2 behavior work-unit commit: `96c210594c24d75f10f49a00766129b62a1c70bf`
  against base `6184b4d2d36c5c73e3fbcabde2c2785e5335e565`. It contains
  492 additions and 69 deletions (561 authored lines) across product,
  regressions, canonical documentation, and this existing task artifact. The
  human-approved `size:exception` keeps the guard and its proofs together.
- Direct Playwright limitation: the config and globalSetup now reject an
  overridden fixture URL, but a deliberately forged standalone environment
  could still provide markers plus a valid-looking fixture URL while directing
  `ORGANIZATION_API_BASE` at another backend. No API-to-DB identity attestation
  was added in T2. The canonical launcher builds both URLs from its disposable
  container and supplies its own API base; do not generalize that proof to an
  independently fabricated direct invocation.

## T2 independent-review correction and delivery boundary

- Fresh independent review of frozen HEAD
  `ef8689958b2774a4f8fea0e103e8bf304495ba68` requested one bounded
  correction: cleanup killed the `go run ./cmd/server` parent PID while its
  server child could survive. No direct Playwright API-to-DB attestation was
  attempted in this correction; that is an unproven separate boundary.
- Safe RED: the real-launcher DB-free double reproduced a surviving server
  child after an admin failure. A cancellation regression also failed because
  the signal trap returned and the launcher continued instead of exiting.
  Neither check contacted PostgreSQL or launched a real writable child.
- GREEN: build the backend under the prepared, scoped environment before
  launch, then `exec` the built server so the recorded PID is the process to
  stop and wait for. `INT`/`TERM` exit nonzero and run the single `EXIT`
  cleanup. Actual-launcher doubles now verify admin-failure and cancellation
  teardown, no later admin command after cancellation, and preservation of an
  unrelated sentinel process. No process-group-wide kill is used.
- Focused verification: `bash -n scripts/organization-browser-gate.sh` and
  `git diff --check` passed. `GRANETE_TEST_REAL_GO_PREFLIGHT=1 python3 -m
  unittest discover -s scripts -p 'test_ci_*.py' -q` passed 44 tests, including
  the ten DB-free real-Go negative preflights.
- Disposable V2 rerun: a new `postgres:16-alpine` container on loopback with
  tmpfs data, separate migration/runtime roles, and the actual browser gate
  passed `tests/organization/prequote-design.spec.ts` in Chromium (2/2).
  Safe readback showed `database=granete_gate users=2 organizations=2`.
  Post-run inspection found no `granete-org-gate-*` container or gate server
  process. The persistent database was not read or written.
- Delivery is **`Refs #823` / `Delivery: partial`**, not issue closure: the
  canonical launcher boundary has operational proof, but independent direct
  Playwright with deliberately forged markers, valid-looking fixture DSN,
  and `ORGANIZATION_API_BASE` aimed at another API lacks server-to-DB identity
  attestation. Full #823 DoD (including legacy Go runner/fallback inventory)
  remains separately unproven. Fresh review and exact-HEAD/base CI are still
  pending after this correction commit. Do not resume #460 from this work.
- Correction work-unit commit: `564ef00f2a139186d33ad036b82727cf0d050607`
  (129 additions, 17 deletions). The branch has 719 authored additions plus
  deletions across its three commits before this task-only evidence update;
  the human-approved `size:exception` applies to the cohesive T2 PR.
