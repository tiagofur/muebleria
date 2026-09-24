# #823 — Explicit admin CLI target and guarded test preparation

## Objective and authority

Prevent administrative preparation from silently reaching a persistent local
database when its migration DSN is absent. This is the user-authorized,
partial continuation of approved issue #823 after PR #835 merged. Base:
`origin/main` at `aec03be9bc52b6ea9bd5e891d6d5eba8c9118e4f`.

The incident's account containment and data remediation are separate. This
change must not read or write the persistent database, touch the paused #460
worktree, or perform cleanup. Use synthetic data in tests and the PR.

## Scope and constraints

- Require an explicit, valid `MIGRATION_DATABASE_URL` for every admin CLI
  operation before opening a connection. Do not fall back to `DATABASE_URL` or
  any implicit persistent target. Preserve explicit legitimate admin use
  outside tests, without imposing test markers on human operations.
- Deferred #823 scope, not part of this T1 PR: validate and explicitly pass
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

- [ ] **T1 — Fail closed at the admin CLI boundary.** Add a safe RED regression
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
  pending. Review: disabled/unmanaged.
- [ ] **T2 — Deferred; not authorized in this PR.** Guard the disposable browser
  preparation children. Add safe RED
  coverage for absent marker/incomplete DSNs and child environment forwarding.
  Before server migration and each admin child, prove the exact disposable
  loopback runtime/admin targets and pass both DSNs explicitly. Keep runtime
  role distinct from migration owner. Add an executable anti-regression check,
  update the canonical isolation documentation, and verify a valid disposable
  PostgreSQL preparation end-to-end. Do not rewrite the full runner.
  Route: delegated writer; evidence: shell, Go validation, tests, and docs.
  Checks: focused DB-free negatives, `bash -n`, relevant static gate, and real
  disposable positive. Commit: pending. Review: disabled/unmanaged.

## Acceptance and verification record

- [x] Missing/empty/invalid admin DSN and `DATABASE_URL`-only fail before connect.
- [ ] Test marker absent/incomplete or persistent DSNs cannot provision.
- [ ] Exact valid disposable runtime/admin DSNs reach the intended children.
- [x] CLI errors redact credentials; help and docs name the same contract.
- [x] Real disposable PostgreSQL positive passes; no persistent DB access.
- [ ] Fresh independent review and exact HEAD/base checks before publication.

Initial state at document creation: issue #823 reopened and still
`status:approved`; PR #835 merged; new branch and worktree are isolated from
#460. No source edits or tests existed at that point.
Engram task mirror `odd/823-admin-cli-explicit-target/tasks`: pending because
Engram cannot choose among multiple active runtime sessions; this file is the
recovery source of truth.

## T1 implementation evidence (candidate before commit)

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
