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
- PTX `:307` (initial focused comparison, superseded by the Linux A/B below):
  on both SHAs, the serial prerequisite prefix passed 3/3;
  after the nearest state-changing predecessor (`engineering-cutting-demand`),
  7/7; after the full immediate CI predecessor prefix (`cutting-demand`,
  `engineering-entry`, `engineering-physical-gate`), 15/15. PDF and PTX emitted
  `download` events with `.pdf`/`.ptx` suggested filenames; configured output
  also emitted `.ptx.manifest.json`. Each final URL was `blob:`; no `/api/`
  request fired in the capture window, so HTTP status, Content-Type,
  Content-Disposition, and non-download error envelope do not exist for the
  generated PTX file. This comparison alone was inconclusive; the subsequent
  same-runner A/B isolated the CI filename regression. No PTX product code,
  test expectation, or timeout was changed.
- Relevant T2 differences compared: candidate `env -i` passes explicit runtime,
  migration, fixture and media targets; base inherited outer environment but
  still constructed its own disposable URLs. Candidate runs the backend binary
  directly and reaps its PID; base runs a `go run` parent and was additionally
  process-group supervised during diagnosis. Both SHA outcomes above were
  equivalent for those focused cases. The later diagnostic prefix identified
  the browser child's missing `LANG` as the relevant environment delta.
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

## T2 Linux browser filename correction

- Scope and route: delegated direct, one sole writer on the existing productive
  PR #839 branch; strict TDD from `AGENTS.md`; no diagnostic branch or #460 edits.
  Existing `size:exception` applies to the cohesive T2 PR. This correction
  changes only the browser child environment, its actual-launcher regression,
  and this artifact. Product PTX/CADmatic export remains untouched.
- Causal evidence: on diagnostic HEAD `c665165bbd828e3f6143b975b83e742763601748`
  and the same Ubuntu runner image, the 32-test prefix with isolated browser
  environment failed with `suggestedFilename="download"` for PDF, PTX, and
  manifest (run 36043055408); forwarding only `LANG` passed 32/32 with their
  proper extensions (run 36042472576). The DOM `download` attribute/property
  and blob href were correct before click in both modes. CDP already reported
  the generic name without `LANG`, so the defect is the Linux browser harness
  environment rather than exporter output or Playwright's event mapping.
  Chromium's internal locale conversion is a supported inference, not a traced
  internal execution path. The diagnostic branch is evidence only, not merged.
- Safe RED: the focused DB-free real-launcher double failed 10 assertions:
  UTF-8 `LANG` did not reach Playwright, and missing/non-UTF-8 `LANG` still
  launched writable children. No PostgreSQL connection occurred.
- GREEN: the launcher requires a non-empty, recognizable UTF-8 `LANG` before
  Docker or any writable child. It accepts `.UTF-8`, `.utf8`, and `.UTF8`
  case-insensitively, rejects unsafe values without echoing them, and adds only
  that validated value to `GATE_BROWSER_ENV` under `env -i`. `GATE_BASE_ENV`,
  `GATE_SERVER_ENV`, and `GATE_ADMIN_ENV` are unchanged. The real-launcher
  double confirms browser-only forwarding; all listed ambient `PG*` keys,
  ambient DSNs, and sampled credential variables remain excluded. No fallback
  locale, timeout, filename rewrite, or PTX test relaxation was added.
- Focused V1: seven Python launcher tests passed with one opt-in real-Go test
  skipped; the broader DB-free `test_ci_*.py` collection passed 46 tests with
  the same one skip. `pnpm test` and `pnpm typecheck` passed with all DB connection
  environment variables absent. V0 `bash -n`, `shellcheck`, and
  `git diff --check` passed. `verify_affected.py --base origin/main --plan`
  was read-only and conservatively selected broader jobs; it did not run them.
  Go source was not changed, so focused Go checks are not applicable to this
  correction. The new HEAD's operational Ubuntu 32-test prefix, independent
  review, and full CI remain pending; prior diagnostic runs are not proof for
  the productive HEAD.
- Test-shim caveat: Python can set `LC_CTYPE` itself while coercing the C
  locale, even when `env -i` supplied no locale variables. The shim therefore
  asserts no `LC_ALL`/`LANGUAGE` forwarding and the launcher array is the
  evidence that `LC_CTYPE` is not explicitly forwarded; treating Python's
  post-start `LC_CTYPE` as an inherited leak would be a false positive.
- Rollback boundary: this `LANG` validation and browser-only forwarding in
  `scripts/organization-browser-gate.sh` plus its regression in
  `scripts/test_ci_organization_browser_preparation.py`. The existing T2 DB
  isolation, direct-Playwright identity handshake, and merged T1 stay intact.
  Delivery remains `Refs #823` / `Delivery: partial`; #823 remains open.

## T3–T4 continuation — explicit interactive disposable gate (pending)

- Authority and base: the human authorized a local, opt-in interactive lifecycle
  for the disposable Phase 1 harness, not auth/MFA/token/RLS changes or a
  functional Project/Design fix. This independent #823 worktree starts clean at
  `origin/main` `b5697951021f6484cf3e71161ec396ff6f434194` on
  `codex/823-interactive-gate`. Preserve the #398 checkpoint `fdd11ea4` and all
  other worktrees; #398 remains the product-reproduction coordinator. Its
  Phase 1 spec and gate-only loopback listener fix are not on this base.
- Objective and scope: keep the existing automatic prepare → test → cleanup
  path as default. Add a minimal explicit prepare/run-state/continue/stop
  lifecycle with one preparation, a private local run identity, visible
  non-secret environment and test states, a bounded maximum age, and
  run-owned idempotent cleanup. Reuse the current tmpfs PostgreSQL, distinct
  runtime/migration roles, preflight, browser/backend DB identity handshake,
  scoped `env -i`, UTF-8 browser locale, and disposable media. Do not create a
  persistent DB, generic environment manager, production endpoint, or
  credential/session workaround. No SketchUp, Keychain, or owner-file mutation
  is authorized by these tasks.
- Route: delegated direct; the existing launcher, Go listener, Playwright
  configuration/setup, CI launcher doubles, and isolation documentation are
  multiple non-trivial files. One bounded writer owns T3–T4. Strict TDD is
  enabled by `AGENTS.md`; observe safe RED, GREEN, then REFACTOR. DB-free
  runners: `python3 scripts/test_ci_organization_browser_preparation.py` and,
  if the Go listener changes, `cd backend-go && go test ./cmd/server`.
  Operational positive uses the existing exact disposable runner
  `LANG=en_US.UTF-8 bash scripts/organization-browser-gate.sh tests/organization/prequote-design.spec.ts`;
  the new interactive command must be documented only after it exists.
- Delivery: `ask-on-risk` is resolved for this increment by the human's explicit
  choice of **one coherent partial #823 PR**. The existing approximately
  400-authored-line figure is only a review-planning heuristic. For this work,
  0–800 authored additions plus deletions is normal; at 801–1,200 assess and
  document cohesion/risk without stopping or splitting solely for size; above
  1,200, checkpoint with a breakdown and proposed boundary before substantial
  expansion or publication. T3 and T4 may be separate work-unit commits in the
  same PR, but do not separate an open environment from its stop/cleanup proof.
  Count handwritten additions **and** deletions in behavior, tests, and docs;
  report generated changes separately. No `size:exception` or protected label
  is presumed. If a real checker requires an exception, report its exact
  command/diagnostic; do not preemptively change the checker or repeat a size
  authorization question. No code-golf, omitted proof, force push, or auto-merge.
- Pre-write component forecast (authored additions + deletions): interactive
  lifecycle/ownership 300–420; integration with the current launcher and
  gate-only loopback bind 140–210; deterministic doubles and focused Go/browser
  regressions 300–390; concise operational/isolation documentation and task
  evidence 60–100. Total approximately **800–1,120 authored lines**; generated
  files expected: none. Likely touched files:
  `scripts/organization-browser-gate.sh`, one small lifecycle helper under
  `scripts/` only if necessary, `scripts/test_ci_organization_browser_preparation.py`,
  `backend-go/cmd/server/main.go`, a focused `backend-go/cmd/server/` bind test,
  `playwright.organization.config.ts`, at most one focused
  `tests/organization/support/` seam, `docs/architecture/test-database-isolation.md`,
  and this existing task document. Reconcile this forecast with actual diffs;
  crossing 800 alone is not a stop condition.

- [x] **T3 — Preserve one safe preparation and restrict the gate listener.**
  First pin the 20-minute boundary by source line and process sequence. Add the
  gate-only loopback bind behavior missing from this base (without changing the
  normal server bind) and extract only the preparation/ownership seam needed by
  both modes. Keep automatic execution and teardown unchanged. RED/GREEN checks:
  focused DB-free Go bind tests and existing launcher doubles, including
  rejected targets before writes, ambient-variable exclusion, and automatic
  success/error/signal cleanup. Run `bash -n`, focused Go checks, and one real
  disposable automatic gate before closing this work unit. Record exact commit,
  authored-line count, rollback boundary, and observed checks here.
- [x] **T4 — Continue one interactive run and clean it exactly.** Add the
  opt-in private run state, concrete continue/stop actions, owned backend/DB/
  web/browser lifetimes, and maximum-age expiry without recreating the DB or
  changing auth/MFA/step-up. Completion of automated React/Go work must leave
  the same environment available for human and host steps; incomplete waiting
  must record host/binding/placement as `NOT_RUN`, never Phase 1 PASS. RED/GREEN
  launcher doubles must cover opt-in only, single preparation, continued
  availability, wrong/replayed run, explicit stop, failure/interruption,
  expiry, idempotent cleanup without harming foreign resources, and CI never
  waiting for a human. Then run a real disposable start → identity → ready →
  stop → process/port/container/temp-profile cleanup readback. Document the
  actual commands, sanitized state, maximum age, and honest forced-termination/
  power-loss recovery limit. Record exact commit, authored-line count, rollback
  boundary, and observed checks here.

Acceptance remains partial: the interactive infrastructure and isolation need
fresh independent review and exact-head checks. Installed SketchUp, MFA/device
approval, same-ID placement, WorkingCopy, and the Phase 1 product result remain
outside this increment and `NOT_RUN` until separately observed. Next step:
record the T4 work-unit identity, mirror this full document to Engram, then
request fresh independent review and exact-head checks before the partial PR.

### T4 observed work-unit evidence

- Safe RED: the new DB-free launcher lifecycle test initially ran `prepare`
  against the prior gate, which treated it as a Playwright argument and exited
  without a run ID. No PostgreSQL connection or writable child was used.
  GREEN: `python3 scripts/test_ci_organization_browser_preparation.py` passed
  10 tests (one opt-in real-Go preflight skip). The added tests cover one
  preparation, correct synthetic DB targets and ambient-secret exclusion,
  waiting/continue/stop state, invalid ID and max age before writers, failed
  preparation, four-second expiry, forced-owner loss and exact-run recovery,
  idempotent stop, and no surviving test-owned server/web/browser. Existing
  cases retain automatic success/failure/cancellation and a foreign sentinel.
- The first real detached attempt passed the automated 2/2 Chromium checks and
  created a ready browser, but its launcher environment reaped the detached
  supervisor when `prepare` exited. `status` reported `ORPHANED` rather than
  claiming availability; exact-run `stop` removed the container and profile.
  The corrected procedure keeps the preparation terminal attached while the
  supervisor runs. This is a lifecycle requirement, not an auth timeout fix.
- Real disposable positive with the attached procedure: `LANG=en_US.UTF-8
  bash scripts/organization-browser-gate.sh prepare
  tests/organization/prequote-design.spec.ts` produced a private run ID,
  `WAITING_FOR_HUMAN`, `automated_result=PASS`, and `host_result=NOT_RUN`.
  Readback showed 2/2 Chromium tests, ready browser profile, backend and web
  listening only on `127.0.0.1`, and PostgreSQL published only on loopback.
  `continue` recorded `HOST_CHECK_IN_PROGRESS` without host PASS. Two `stop`
  calls returned `FINISHED`/`cleanup=COMPLETE`; independent readback found zero
  owned PIDs/listeners, no container, and no temporary profile. A separate
  ordinary automatic command passed the same 2/2 Chromium suite and exited.
  No persistent database, Keychain, installed SketchUp, or human MFA session
  was touched.
- V0/V1: `bash -n scripts/organization-browser-gate.sh`, `shellcheck` on the
  same script, `node --check scripts/organization-interactive-browser.mjs`,
  `git diff --check`, `pnpm typecheck`, `pnpm test`, and focused
  `cd backend-go && go test ./cmd/server` passed. The conservative
  `verify_affected.py --base origin/main --plan` selects broader CI because T3
  changes Go server binding; those checks and independent exact-head review
  remain pending. The final state-only `failure_reason` addition has DB-free
  test/static proof; final exact-head operational evidence is for the parent
  to confirm after candidate freeze.
- Rollback boundary: interactive branches of the existing gate, new private
  browser helper, Playwright external-web reuse switch, lifecycle doubles,
  and the interactive paragraph in the canonical isolation contract. T3's
  loopback bind and ordinary automatic preparation remain independent.
  Forced-kill recovery depends on private run metadata and exact process
  fingerprints; a power loss can erase temporary metadata, so no recovery PASS
  is claimed without fresh resource readback. #398's Phase 1 installed-host,
  MFA/device, placement, and WorkingCopy acceptance remain `NOT_RUN`.

### T3 observed work-unit evidence

- The 20-minute limit is in #398 checkpoint `fdd11ea4`,
  `tests/organization/phase1-project-design.spec.ts:212-214,278-284`:
  `PHASE1_HANDOFF_SECONDS` is capped at 1,200 and the test awaits that interval.
  When Playwright returns, the existing launcher at
  `scripts/organization-browser-gate.sh:229-231` exits; its `EXIT` trap at
  lines 9-20 kills the backend and removes the container and temporary media.
  This is not evidence of authentication expiry, and the #398 file was not
  copied or changed here.
- Safe RED, before implementation: `cd backend-go && go test ./cmd/server -run
  '^TestServerListenAddress$' -count=1` failed to compile with
  `undefined: serverListenAddress`. The DB-free launcher double
  `python3 scripts/test_ci_organization_browser_preparation.py` failed only
  its new server bind assertion (`None` versus `127.0.0.1`); 7 tests ran,
  with one opt-in preflight test skipped. No database connection was made.
- GREEN: `cd backend-go && go test ./cmd/server` passed; the targeted bind
  test passed, including ordinary `:PORT`, gate-only loopback, and missing/
  non-loopback rejection. The launcher double passed 7 tests (one opt-in
  skip); with `GRANETE_TEST_REAL_GO_PREFLIGHT=1` it passed all 7, including
  real Go preflight against synthetic rejected targets without connecting.
  `bash -n scripts/organization-browser-gate.sh`, `shellcheck` on that script,
  and `git diff --check` passed.
- Real disposable automatic gate: `LANG=en_US.UTF-8 bash
  scripts/organization-browser-gate.sh tests/organization/prequote-design.spec.ts`
  exited 0, read back `granete_gate` with two users and two organizations,
  matched backend/fixture database identity, passed 2/2 Chromium tests, and
  printed `[organization-gate] PASS`. This proves the default automatic path
  remains functional; it does not yet prove an interactive session or an
  installed SketchUp host. An OS socket readback was not captured in this run;
  the gate-only bind is covered by Go unit tests and launcher forwarding checks.
- `python3 scripts/verify_affected.py --base origin/main --plan` selected
  broader jobs because the backend changed; those broad jobs remain `NOT_RUN`
  for this T3 work unit and must be considered on the final exact candidate.
  The new `run_prepared_automatic_gate` function is only an ownership seam;
  T4 must reuse the preparation above it, not duplicate a second setup.
- Rollback boundary: gate-only Go listener decision and focused test,
  server-only bind setting and automatic runner seam in the launcher, and the
  bind-forwarding assertion in its Python double. Existing admin/DB guards,
  default production bind, and #398 checkpoint remain untouched. T4 is next;
  the interactive mode is still `NOT_IMPLEMENTED`.
- T3 work-unit commit: `51ad935c86c968f73b718175fbb4f8da63d9954b`
  against `b5697951021f6484cf3e71161ec396ff6f434194`, with 184 authored
  additions and 5 deletions (189 total), generated files: none. One coherent
  partial #823 PR remains the authorized delivery; no size exception is
  assumed. Fresh independent review and final exact-head CI remain pending.
