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
- In automated preparation, validate and explicitly pass the runtime and admin
  DSNs used by the server and admin children. Reuse #835's executable Go test-DB
  validators, keep the disposable container and loopback binding, and do not
  give the privileged migration role to the application runtime.
- Align CLI help/errors and the existing isolation contract. Do not expose DSNs
  or passwords in diagnostics, rewrite the backend test runner, relax RLS or
  `LoadConfig`, or create another metadata workflow.
- Deliver one scoped PR with `Refs #823` and `Delivery: partial`; no merge or
  automatic issue closure.

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
Delivery strategy: `ask-on-risk`; forecast about 350 authored changed lines
(additions + deletions, excluding generated files), to be corrected from actual
work-unit commits. If the running total exceeds about 400, resolve PR slicing
before the next commit; do not code-golf or silently assume `size:exception`.

## Tasks

- [ ] **T1 — Fail closed at the admin CLI boundary.** Add a safe RED regression
  for missing, empty, malformed, and `DATABASE_URL`-only configuration without
  connecting to the habitual database. Make `openStore` resolve and validate the
  explicit admin DSN before `NewPostgresStore`/Ping; reuse #835's test isolation
  validation only when running as a test preparer. Cover error redaction, CLI
  help, and the real invocation boundary. Keep explicit legitimate manual DSNs.
  Route: delegated writer; evidence: mapping and multi-file Go/test/docs work.
  Checks: focused DB-free RED/GREEN Go tests and syntax/build checks. Commit:
  pending. Review: disabled/unmanaged.
- [ ] **T2 — Guard the disposable browser preparation children.** Add safe RED
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

- [ ] Missing/empty/invalid admin DSN and `DATABASE_URL`-only fail before connect.
- [ ] Test marker absent/incomplete or persistent DSNs cannot provision.
- [ ] Exact valid disposable runtime/admin DSNs reach the intended children.
- [ ] CLI errors redact credentials; help and docs name the same contract.
- [ ] Real disposable PostgreSQL positive passes; no persistent DB access.
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
- Operational boundary: no PostgreSQL or admin CLI command was run. A real
  disposable PostgreSQL preparation belongs to T2. No persistent database was
  read or written.
- Rollback boundary: revert this T1 work unit only (`backend-go/cmd/admin/main.go`,
  `backend-go/cmd/admin/database_target_test.go`, and the T1 documentation
  paragraph); no browser preparation behavior is included.
- Commit: pending; the next bookkeeping commit will record the behavior
  commit's exact SHA after it exists.
