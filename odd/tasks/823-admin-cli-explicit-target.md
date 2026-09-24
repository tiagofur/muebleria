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

## T2 draft-PR CI correction

- Draft PR #839 exact-head CI run `35963706603` (candidate
  `99f76c32c3bba66be7847bd049025e23fc0d1cfe`, merge base
  `6184b4d2d36c5c73e3fbcabde2c2785e5335e565`) passed the other substantive
  jobs but failed the real-browser job and its dependent aggregate gate: the
  artifact-health case required `MEDIA_DIR`, and a separate engineering-state
  case observed no `.ptx` download within 20 seconds. This is not an
  exact-head PASS.
- Root cause of the deterministic artifact-health failure: `env -i` correctly
  removed ambient values, but `GATE_BROWSER_ENV` omitted the disposable
  `MEDIA_DIR` already supplied to the server. The DB-free double now poisons
  ambient `MEDIA_DIR` and checks that the actual launcher supplies the same
  gate-owned media directory to server and Playwright. RED: Playwright had
  `None`; GREEN: both match, without inheriting the ambient value.
- PTX attribution remains uncertain, not silently fixed by the media change.
  The failed CI log showed the `.ptx` event-count timeout, with no corresponding
  export HTTP failure. A single `--grep` invocation omitted the serial
  prerequisite and therefore was not valid state proof. The complete
  `engineering-state.spec.ts` passed 4/4 in a new disposable gate. A bounded
  run of the related `engineering-cutting-demand.spec.ts`,
  `engineering-state.spec.ts`, and `project-designs.spec.ts` together passed
  12/12, including PTX download and the previously failing artifact case.
  No PTX product code or test expectation was changed; full-suite recurrence
  remains for exact-head CI to decide.
- V0/V1: `bash -n`, `git diff --check`, and 44 Python CI tests with opt-in
  real-Go preflight passed. `verify_affected.py --base origin/main --plan`
  remained read-only and selected the browser gate plus broader existing
  checks; these checks need the leader's new exact-head CI run. V2 used only
  fresh loopback-bound, tmpfs PostgreSQL gates with synthetic identities and
  confirmed `granete_gate` readback; no persistent database was accessed.
- Scope/rollback: only the browser child environment, its real-launcher
  regression, this task evidence, and the canonical isolation paragraph.
  Delivery remains `Refs #823` / `Delivery: partial` for the independent
  direct-Playwright/API-to-DB attestation gap and unproven full #823 DoD.
- CI correction work-unit commit: `727a6140bd3354d1acc4e61cd8fc3d1308dbd50d`
  (46 additions, 1 deletion); fresh independent review and CI must target
  this correction plus its task-only evidence commit, not the prior PR HEAD.

## T2 draft follow-up — exact-base browser diagnosis and DB identity

Authorized continuation: keep PR #839 draft; compare base
`6184b4d2d36c5c73e3fbcabde2c2785e5335e565` and candidate
`8dca94be3595f5cce19aa5aebd016bd3a3489e7f` with the real launcher for
each SHA and disposable PostgreSQL only. Do not touch #460, the persistent
database, or unrelated PTX/401 behavior. No full CI until a corrected HEAD is
independently reviewed. One PR, with the approved `size:exception`.

- [x] **T2-F1 — Classify focused browser failures.** Run bounded equivalent
  prequote-design repetitions on fresh disposable gates, recording fetch/body,
  navigation, HTTP status, and authoritative persistence. Run PTX with its
  serial prerequisites, record related HTTP and all download events, then only
  the smallest preceding suite state if isolation passes. Compare env, media,
  backend executable, URLs, and process lifecycle across both SHAs.
- [x] **T2-F2 — Prove direct Playwright API-to-DB identity before writes.** Add
  a test-only, non-secret handshake that reads a disposable DB-scoped identity
  through the backend runtime pool and independently through the fixture DSN.
  A missing or mismatched handshake must abort before globalSetup writes.
  Observe safe RED then GREEN for positives and mismatches; validate with a real
  disposable PostgreSQL/browser gate. Avoid a production diagnostic endpoint.
- [ ] **T2-F3 — Freeze and hand off.** Record V0/V1/V2 checks, classify each
  failure with causal limits, make one cohesive work-unit commit, and hand the
  exact new HEAD/base to a fresh independent reviewer. No push or full CI by
  this writer. Engram mirror remains pending due ambiguous active sessions.

### Focused comparison and correction evidence

- Base and candidate were exercised from clean, separate worktrees at the exact
  pinned SHAs above. Each run used its SHA's real browser launcher, fresh
  loopback-only PostgreSQL container with disposable data, synthetic credentials,
  a sterile outer environment, and a process-group supervisor for the base's
  `go run` child. Diagnostic overlays changed only the two test files during
  diagnosis; they were restored before implementation. The base worktree was
  clean and removed afterward. No `muebles` connection was made.
- Prequote `:108`: five fresh gates per SHA, not five repetitions in one DB.
  Base 4/5 and candidate 4/5 passed. Repetition four failed identically on
  both: POST design 201, independent DB read `design persisted=true`, GET 200,
  route fetch/body/json readable, main-frame navigation observed, but the
  assertion read `designsBody=undefined`. This is classification **3:
  pre-existing test race reproducible on base**, not a demonstrated T2 product
  regression. `page.waitForResponse` ran ahead of the async route callback's
  body assignment/fulfillment; the next navigation could dispose its response.
  The minimal test-only correction awaits route completion before assertion
  and next navigation. Five new candidate gates passed 5/5 after correction.
- PTX `:307`: on both SHAs, the serial prerequisite prefix passed 3/3;
  after the nearest state-changing predecessor (`engineering-cutting-demand`),
  7/7; after the full immediate CI predecessor prefix (`cutting-demand`,
  `engineering-entry`, `engineering-physical-gate`), 15/15. PDF and PTX emitted
  `download` events with `.pdf`/`.ptx` suggested filenames; configured output
  also emitted `.ptx.manifest.json`. Each final URL was `blob:`; no `/api/`
  request fired in the capture window, so HTTP status, Content-Type,
  Content-Disposition, and non-download error envelope do not exist for the
  generated PTX file. Classification **4: not reproduced; CI cause remains
  inconclusive**. No PTX code, test expectation, or timeout was changed.
- Relevant T2 differences compared: candidate `env -i` passes explicit runtime,
  migration, fixture and media targets; base inherited outer environment but
  still constructed its own disposable URLs. Candidate runs the backend binary
  directly and reaps its PID; base runs a `go run` parent and was additionally
  process-group supervised during diagnosis. Both SHA outcomes above were
  equivalent for the failing cases. No missing forwarded variable was found.
- Direct Playwright RED: 6 DB-free tests exposed that URL/markers alone allowed
  mismatched API, DB, role, or expected identity to reach setup. Go handler
  tests failed to compile before implementation. GREEN: the launcher installs
  a random marker as a disposable database setting after preflight; the backend
  reads it via its actual runtime pool and emits only its digest on the existing
  health response when both test markers and the test-target guard hold.
  `globalSetup` compares that readback to an independent read-only fixture query
  and a gate-issued digest, and requires the frontend/API URLs to match before
  calling any setup writer. A production backend has no probe header.
  URL/ambient session-option spoofing is rejected before a writable child.
  Connection errors are redacted. Focused Go tests, 16 Vitest scenarios, real
  launcher doubles including twelve DB-free negative preflights, static CI
  checks, `bash -n`, `shellcheck`, `go vet`, and `pnpm typecheck` passed.
  Final real disposable V2: the actual gate read back `granete_gate|2|2`,
  logged backend/fixture identity match, and passed prequote plus PTX prefix
  4/4. PostgreSQL container and gate backend were removed afterward.
- Direct Playwright operational mismatch V2: with valid isolation markers and
  a real disposable loopback PostgreSQL fixture, a deliberately wrong API
  answered only `GET /api/health` with an incorrect identity. The actual
  Playwright `globalSetup` exited nonzero on identity mismatch before the
  fixture writer ran: the wrong API saw no POST, and the disposable database
  still had zero public tables. The container was removed afterward. This
  demonstrates the direct-invocation fail-closed boundary without touching
  the persistent database.
- Remaining: fresh independent review on the new work-unit HEAD/base, then one
  full exact-head CI run by the leader. PR #839 remains draft and
  `Refs #823` / `Delivery: partial`; the broader #823 acceptance remains open.

## D1 — Temporary #839 PTX CI laboratory (not a delivery)

Human authorization dated 2026-09-24 permits one branch-only diagnostic experiment
from exact candidate `24b014906e4fdd0963d4017df4865fc6527d9bca`, with exact
base comparator `6184b4d2d36c5c73e3fbcabde2c2785e5335e565`. The branch is
`codex/839-ptx-diagnostic`; it must never become a PR or modify #839, #460,
main, persistent data, exporter semantics, auth, retries, or timeouts. It may
publish one explicitly dispatched, single-job Ubuntu x86_64 run using the real
disposable organization launcher, only the first 32 tests through PTX. If that
run fails, compare the base on the same runner type with equivalent probes. If
it passes, inspect evidence before at most one controlled prefix expansion.

- [x] **D1a — Branch-only safe launcher and probes.** Add a manual CI dispatch
  gate that skips normal CI jobs, records runner metadata, and retains only
  privacy-screened PTX event/trace artifacts. Observe a safe RED for an unsafe
  artifact or dispatch configuration, then GREEN with structural and focused
  checks. Route: one bounded delegated writer for multi-file workflow, launcher,
  browser test, and frontend diagnostic probes. Rollback: discard this
  temporary branch; no product or PR branch changes.
- [ ] **D1b — Candidate execution and evidence.** Parent dispatches exact
  diagnostic branch/ref once, reads run/metadata/artifacts, and classifies the
  last frontier without inventing a cause. V2 remains NOT_RUN until that run.
- [ ] **D1c — Conditional comparator or expansion.** On failure, run the exact
  base with equivalent diagnostic overlay; on clean pass, inspect artifacts
  first and then run at most one prefix expansion with PTX last. Do not repeat
  automatically. Current state: PENDING first-run evidence.

Forecast: diagnostic-only multi-file changes may exceed the ordinary 400-line
planning heuristic; this branch is explicitly non-delivery and receives no PR.
Strict TDD: enabled by `AGENTS.md`; runner is the existing
`scripts/organization-browser-gate.sh` plus DB-free artifact/workflow checks.
RDD: disabled/unmanaged. Engram mirror remains pending if the runtime cannot
disambiguate its registered session; this file is the recovery source.

D1a local evidence (no database connection): the baseline candidate's
`ci.yml` fails the new single-job-dispatch contract test (safe RED), while the
diagnostic version passes all 3 DB-free contract/privacy tests. The real
Playwright `--list` entrypoint, using a synthetic unreachable loopback DSN,
lists exactly 32 tests in 8 files, with the PTX case last. `pnpm typecheck`,
44 existing `test_ci_*.py` tests (one skipped), `bash -n`, Python compile,
YAML parse, and `git diff --check` passed. A synthetic local Chromium trace
successfully passed the fail-closed sanitizer; its network member was not
retained. The five frontend/test probe files applied cleanly to the exact base
in a disposable copy, and the base's own launcher remained its original code
plus only the same diagnostic artifact-copy/browser-flag hooks. No actual PTX
browser run or Ubuntu runner evidence has occurred yet. Candidate and base
runtime bytes are necessarily SHA + identical diagnostic overlay; do not call
the comparator a byte-identical uninstrumented run. The branch-only workflow
explicitly excludes every ordinary job on manual dispatch; only the scoped
diagnostic job is runnable. The raw log and raw trace stay on the ephemeral
runner; only privacy-screened event/action trace/screenshot/metadata files can
be uploaded, and a sanitizer failure withholds diagnostic evidence.

D1a diagnostic work-unit commit: `27ef22ea721ccac0ac258bc5018297c30c27b167`
(`test(ci): add temporary PTX prefix diagnostic lab`). This is not a PR
delivery and has no review, Ubuntu runtime result, or issue-closure authority.

D1a reopened after independent read-only review of exact HEAD
`2169f9cdc26579b0b70ce9344b2bcc0454061f65`: pre-click evidence must
include plan/selection and actual disabled reason even if the handler never
runs; handler errors need a safe cause code; a passive Chromium download
signal should be attempted without changing download policy; and missing
trace/events must not erase all sanitized failure context. One consolidated
diagnostic-only correction is authorized. DB-free RED: the new pre-click/CDP
contract check failed, and the missing-artifact context check errored because
the summarizer did not exist. No database or browser suite ran for RED.

Consolidated correction GREEN: before the PTX click, the test reads the
panel's diagnostic-only DOM snapshot (CutPlan ID/version/frozen state,
resolved output and exact disabled reasons), the shell's selected
machine/profile/postprocessor tuple, and server engineering status/version.
Those snapshots do not depend on the click handler running. Handler exceptions
now report a fixed phase/cause code and allowlisted error kind, never the raw
message. A Chromium page CDP session subscribes to `Page.downloadWillBegin`
after `Page.enable`; it does not call `setDownloadBehavior`. A DB-free synthetic
Blob download observed the native Page event and Playwright download event
once each after enabling the Page domain; without that enable call, the native
event count was zero. Absence on another runner is still inconclusive.
Playwright documents CDP sessions/events at
https://playwright.dev/docs/api/class-cdpsession and Chromium documents the
Page event at https://chromedevtools.github.io/devtools-protocol/tot/Page/.
The sanitizer now emits only fixed failure codes, a known failed-spec name,
artifact-presence flags, and an allowlisted last stage when raw PTX events or
trace are missing. Raw error text never uploads. A successful prefix without
events/trace still fails closed; a sensitive trace/event fails the privacy
screen. The runner always attempts to upload the safe failure context even
when trace screening fails.

Correction checks: DB-free RED was observed in two new contract cases; GREEN
6/6 diagnostic contract cases, 44 existing CI tests (one skipped), `pnpm
typecheck`, Python compile, `bash -n`, YAML parse (10 jobs), and `git diff
--check` passed. The synthetic unreachable-loopback Playwright `--list`
still selected exactly 32 tests in 8 files ending at the PTX case. The six
frontend/test probe files apply cleanly over exact base `6184b4d2`; the
base's launcher receives only artifact-copy/browser diagnostic hooks. No
database connection, Ubuntu execution, PR change, or product delivery was
claimed. Fresh independent review is pending on the corrected exact HEAD.
The correction work-unit commit is
`027db58670bad317781f9e73f80a06ad37166a20`.

## D2 — Temporary PTX browser-environment A/B (Experiment 1 only)

Human authorization dated 2026-09-24 retains this non-delivery branch and
candidate/base pins. Controlled Ubuntu runs 36031771764 (candidate: PTX
fails) and 36032511188 (base: 32/32 passes) observed downloads in both, but
candidate PDF/PTX/manifest suggested filenames were `download`; base names
retained their extensions. This is class G, not a proven `env -i` root cause.
Do not alter #839, product export semantics, retries, timeouts, or other
worktrees. Only a diagnostic A/B of the Playwright/Vite child is authorized;
server and admin children retain the exact T2 isolated environment.

Route: delegated direct sole writer, because the real launcher, workflow,
probe, and DB-free child-process regressions span multiple non-trivial files.
Strict TDD: enabled by `AGENTS.md`; safe RED then GREEN using
`python3 -m unittest scripts.test_ci_organization_browser_preparation
scripts.test_ptx_diagnostic_contract` with child doubles and no DB access.
Delivery: temporary branch only, no PR. Forecast: one small diagnostic work
unit with tests; line count is advisory, not a reason to omit a guard.
Engram mirror remains pending if the runtime cannot disambiguate its session.

- [x] **D2a — Browser-only environment A/B.** Default A uses current `env -i`;
  explicit B starts from ambient runner variables, removes all PG/DB and
  credential-bearing entries, then reapplies only T2-validated disposable
  targets, markers, handshake, API bases, and media path. Reject invalid mode
  before writable children. Check real launcher doubles prove only browser
  differs and no ambient DB or secret reaches any child.
- [x] **D2b — Observe DOM-to-download boundary.** Before anchor click record
  attribute/property names and href scheme, without Blob contents or secrets;
  retain CDP and Playwright filenames for PDF/PTX/manifest. Keep the 32-test
  one-worker PTX prefix; no general test repair.
- [x] **D2c — Freeze and handoff.** Run V0/V1 DB-free checks, commit the
  coherent diagnostic work unit, and hand exact HEAD for independent review.
  V2 Ubuntu A/B remains `NOT_RUN` until parent dispatches reviewed commits.

Rollback boundary: discard this temporary diagnostic branch; no change is
intended for the product PR from the A/B experiment itself.

D2 local evidence: DB-free RED: the real-launcher double showed B still
dropped an inert runner key, and an invalid environment variant launched
writers; the branch workflow/probe contract checks also failed before their
implementation. GREEN: 15 focused Python cases (one opt-in skipped), 46 CI
contract cases (one opt-in skipped), 25 targeted web-export Vitest cases,
`pnpm typecheck`, `bash -n`, `shellcheck`, Ruby YAML parse (10 jobs), Python
compile, and `git diff --check` passed. A targeted Vitest run initially caught
the diagnostic DOM probe calling `getAttribute` on injected fake anchors; the
probe now runs only in diagnostic mode and tolerates missing fake DOM methods.
No database or Ubuntu browser experiment ran locally. The conservative
`verify_affected.py --plan` selects global gates because workflow/launcher
files changed; broad gates are intentionally `NOT_RUN` on this laboratory
work unit. V2 Ubuntu A/B is `NOT_RUN` pending parent dispatch after review.
The A/B canary confirms CI metadata and a harmless ambient marker reach only
the B browser child, while backend/admin remain isolated and ambient PG,
database, and credential-shaped keys are absent from all captured children.
The fixture explicitly poisons `PGHOSTADDR`, `PGSERVICEFILE`, `PGOPTIONS`,
`PGPASSWORD`, `PGPASSFILE`, the ambient fixture DSN, and a second DB URL;
the real-launcher child capture confirms none of their keys or targets reaches
the browser/backend/admin after preparation. Focused extension: 2/2 passed;
full DB-free CI contract suite: 46 tests, one opt-in skipped. The behavioral
RED was observed against the pre-switch launcher before D2 implementation;
this explicit poison extension passed without a further production change.
Diagnostic behavior work-unit commit:
`319bbf05cdf38196ece245acd9651cb8323a4db1`. The final artifact-only
evidence commit records this identity; independent review and Ubuntu runs
remain pending. No push, dispatch, PR, or merge was performed by the writer.

Experiment 1 V2 subsequently observed on the reviewed diagnostic HEAD
`1669140dff978f9e2cd4693744692fb799e395d6`: run 36037531885 with
`isolated` failed after three Chromium and Playwright download events, each
with `suggestedFilename=download`, while the DOM anchor attribute/property
retained the requested filename and `blob:` scheme. Run 36038172721 with
`inherited-safe` passed 32/32 and the three names retained `.pdf`, `.ptx`,
and `.manifest.json`. Both used Ubuntu image `20260920.314.1`, x86_64,
the same PostgreSQL image digest, disposable preparation, and the same
functional candidate. This establishes a browser-child environment effect,
not which omitted variable causes it. Earlier `NOT_RUN` statements above
describe local handoff status, not the later Ubuntu result. No #839 change.

## E2 — Temporary safe-variable group bisection (Experiment 2 only)

Authorized only because D2 A/B diverged. Retain the exact 32-test prefix,
one worker, disposable database, backend/admin `env -i`, and DOM/CDP/Playwright
probes. Start from isolated browser env and add only explicit safe groups:
`ci+locale`, `ci`, `locale`, then `linux` if needed. The CI group contains
CI, GITHUB_ACTIONS, RUNNER_OS, RUNNER_ARCH; locale contains LANG, LC_ALL,
LC_CTYPE, LANGUAGE; Linux user/runtime contains USER, LOGNAME, SHELL and
non-path XDG session metadata only. These are diagnostic variants, not a
final product allowlist. Never forward ambient DB/PG/proxy or credential
variables. Available/forwarded variable **names** may be recorded only from
this harmless allowlist, with dropped sensitive classes represented by counts;
no values, raw environment, or secret-bearing names may be uploaded.

Route: delegated direct sole writer across launcher, manual workflow, privacy
sanitizer, and DB-free real-launcher regressions. Strict TDD remains enabled;
safe runner: `python3 -m unittest scripts.test_ci_organization_browser_preparation
scripts.test_ptx_diagnostic_contract`. V2 Ubuntu group runs are parent-owned
and `NOT_RUN` until independent review of the new exact diagnostic HEAD.
Rollback remains discarding this non-delivery branch; no PR, merge, #839,
#460, main, or persistent DB mutation.

- [x] **E2a — Name-only, fail-closed group switch.** Add the guarded modes and
  allowlisted safe-name report, preserving T2 child environments and privacy.
- [x] **E2b — Real-launcher child regressions.** Observe safe RED, then GREEN:
  groups reach only Playwright/Vite; ambient DB/PG/secret canaries never reach
  any child; unknown modes stop before writable launch.
- [x] **E2c — Freeze for review.** V0/V1 checks, work-unit commit and exact
  HEAD handoff. Ubuntu V2 remains pending the parent's deliberate dispatch.

E2 local proof: safe RED against the real launcher before implementation:
all four requested group modes rejected before child launch, the branch
workflow lacked those choices, and the sanitizer did not retain the name-only
artifact. GREEN: 17 focused DB-free Python cases (one opt-in skipped), 47 CI
contract cases (one opt-in skipped), `shellcheck`, `bash -n`, Python compile,
YAML parse (10 jobs), `pnpm typecheck`, and `git diff --check` passed. Real
launcher doubles verify the exact safe CI/locale/Linux groups reach only
Playwright/Vite, with all backend/admin children still isolated; poisoned
PG/DB/proxy/credential-shaped keys never reach a child. The safe report lists
only allowlisted variable names plus dropped-class counts, and the sanitizer
rejects secret-named or value-looking substitutions. On macOS, Python's
startup can synthesize `LC_CTYPE` in child-double processes even when `env -i`
removed it; the test checks the explicit injected locale separately rather
than mistaking that Python artifact for launcher forwarding. The unchanged
32-test, one-worker PTX workflow selection and download probes remain in place.
V2 Ubuntu group runs are `NOT_RUN`, and no #839/DB/product changes occurred.
E2 diagnostic work-unit commit:
`c7dd8c7f4cac23eb449832f68b77b8e0bfc97ee3`. An artifact-only evidence
commit follows; independent review and group-mode Ubuntu runs are pending.
The writer did not push, dispatch, create a PR, or merge.

E2 independent review reopened the group value boundary before any Ubuntu
dispatch: allowlisted **names** alone do not make an ambient **value** safe.
For example, CI could carry a credential-like value or LANG a PostgreSQL DSN;
copying either into a browser `env -i` child would violate the diagnostic
isolation claim. Keep the prior group-name and sanitizer work, but reopen
only value admission and its real-launcher regressions. The review also noted
the safe-name report covers only 13 preselected keys; record an explicit
unclassified-key count if possible, never call that an exhaustive safe-key
inventory.

- [x] **E2d — Validate optional group values before any writer.** Enforce a
  narrow per-key harmless domain at launcher entry for selected group keys;
  reject unknown, credential- or DSN-looking values without echoing them.
  Observe DB-free RED for contaminated safe-name canaries with zero writable
  child, then GREEN positives/negatives on the actual launcher.
- [x] **E2e — Honest inventory and handoff.** Add only a count for ambient
  non-sensitive-name-unclassified keys if safe, update sanitizer regression,
  run focused/static/typecheck, commit one bounded correction and hand its
  exact clean HEAD for a new independent review. Ubuntu V2 remains NOT_RUN.

E2 review correction evidence: 13 contaminated-value cases first failed
against the real launcher (all allowed the disposable Docker writer); after
per-key value admission moved ahead of Docker, the same cases passed with no
Docker run and no backend/admin/Playwright child. The reject diagnostic names
only the selected fixed key, never its value. Positive real-launcher doubles
prove CI, locale, or Linux values reach only the browser child, while admin
and backend remain `env -i` and the disposable DSNs/markers/identity are
unchanged. The name report now adds `ambient_unclassified_key_count`; this
is a count of remaining ambient keys, **not** a safe-name inventory or a
claim that all omissions were classified. Its schema and privacy boundary
are tested. DB-free checks: 18 focused tests passed (one opt-in skip), 48
CI-contract tests passed (one opt-in skip), 9 sanitizer/diagnostic tests
passed; `bash -n`, `shellcheck`, `pnpm typecheck`, and `git diff --check`
passed. Ubuntu V2 E2 remains NOT_RUN. Independent review of this new HEAD
is pending; no remote operation or persistent database access occurred.
The E2 corrective behavior-and-regression work-unit commit is
`f2e98b738cc0aac0c5d0bc4e50bbb72ce3239464`; this artifact-only
follow-up records its identity without changing executable behavior.

## Temporary T2 productive-HEAD Ubuntu proof carrier

- Authorized diagnostic-only work unit: add one `fixed` manual-dispatch target
  to the existing 32-test, one-worker prefix. It verifies temporary remote ref
  `codex/839-ptx-product-snapshot` resolves to exact productive commit
  `611d6b79de229c3614022d211bca74ac32a42336`, then checks out that SHA.
  `ptx_browser_env` must be `isolated`; the actual productive launcher retains
  its validated browser-only `LANG` and disposable DB preparation. No product
  PR code, diagnostic branch merge, #460, or persistent DB access is involved.
- The workflow carries only the existing six-file frontend/test instrumentation
  overlay from pre-diagnostic candidate `24b014906e4fdd0963d4017df4865fc6527d9bca`.
  It copies the existing patcher and sanitizer before checkout, then adds only
  `VITE_PTX_DIAGNOSTIC` and copy-out of evidence to the product launcher.
  The sanitizer admits `fixed` but still rejects credentials/DSNs in uploaded
  events and trace, strips network and non-image resources, and does not require the older
  diagnostic browser-environment name report for a successful fixed run.
- Safe TDD RED: two focused contract tests failed because `fixed` was absent
  from the workflow and sanitizer. GREEN: all 11 diagnostic contract tests
  passed; combined launcher/diagnostic checks passed 20 tests with one opt-in
  skip. A local throwaway worktree at the exact product SHA accepted the
  binary overlay, patched launcher passed `bash -n`, and the source SHA stayed
  exact; it was removed without a database connection. YAML parsed as ten
  jobs and the run-step shell passed `bash -n`; `shellcheck`, Python compile and
  `git diff --check` passed. Ubuntu V2 remains NOT_RUN until the parent pushes
  the temporary ref and dispatches exactly one run.
- Rollback boundary: remove this diagnostic-only workflow target, its fixed
  sanitizer admission, focused contract checks, and this evidence paragraph.
  The productive PR #839 and its locale correction are not part of this
  temporary branch's rollback.
