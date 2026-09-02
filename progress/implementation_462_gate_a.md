# Foundation Gate A #462 — implementation report

Date: 2026-09-02
Branch: `feat/462-gate-a-executable`
Base: `main@02ad7cd05c0690b0632c211a883b7b38e48dcf84`

## Delivery

- Pull request: https://github.com/tiagofur/muebleria/pull/537
- Target: `main`
- Gate B and #385 implementation remain outside this PR.

## Result

`Foundation Gate A = PASS` and the final matrix is **34/34** in
`progress/gate_a_462_coverage.md`. Therefore **#385 DT-1 may start**.

This PR does not implement Gate B, SEC-8/SEC-9, full #461, Sales Network, or
any #385 persistence.

## Gap implementation

- Added real HTTP/PostgreSQL revoked-invitation and absent-register
  mutation-free proofs, including sanitized failure audit evidence.
- Added factory/store manager capability and allowed/denied command proofs.
- Added acceptance/reactivation seat-limit proofs with zero partial mutation
  and durable `seat_limit_blocked` evidence.
- Added seven real provisioning failure points (entitlements, settings,
  bootstrap membership, catalog clone, start audit, activation, completion
  audit), each followed by successful safe retry.
- Added real provisioning idempotency payload-mismatch and concurrent
  same-slug collision proofs.
- Extended the existing composed lifecycle HTTP/PostgreSQL proof to assert one
  correlated, versioned durable audit for suspend, reactivate, offboard and
  terminate.
- Added real browser proofs only for scenarios 31–33. The browser run also
  exposed and fixed a real authority bug: selecting a tenant downgraded a
  platform administrator to the factory provisioning contract. Platform
  authority is now preserved for the explicit platform command.

## Single executable gate

`scripts/foundation-gate-a.sh` is exposed as `pnpm gate:foundation:a` and is the
single CI entrypoint. It composes:

1. generated OpenAPI drift and TypeScript checks;
2. monorepo tests and deployment smoke checks;
3. fresh PostgreSQL and representative upgrade fixtures;
4. real RLS/runtime-role, HTTP/auth/session/MFA, audit rollback, provisioning,
   idempotency and concurrency proofs;
5. real Vite/Go/PostgreSQL/Chromium organization scenarios;
6. explicit critical-suite no-skip detection and `git diff --check`.

The browser harness independently verifies the migration role is separate and
the runtime app role is `LOGIN`, `NOSUPERUSER`, `NOBYPASSRLS`. Temporary logs,
credentials and browser artifacts are removed on exit; synthetic fixture data
only is emitted.

## Verification

```text
pnpm gate:foundation:a                                  PASS
  pnpm openapi:check                                    PASS
  pnpm typecheck                                        PASS
  pnpm test                                             PASS
  scripts/smoke-deploy.sh                               PASS (31/31)
  PILOT_GATE_FOUNDATION_A=1 pilot-gate --fresh-container PASS
  scripts/organization-browser-gate.sh                  PASS (17/17 Chromium)
  git diff --check                                      PASS

shellcheck scripts/foundation-gate-a.sh \
  scripts/pilot-gate.sh scripts/organization-browser-gate.sh PASS
GOCACHE=/tmp/muebleria-go-cache GOFLAGS='-p=1' \
  go test ./... -count=1                              PASS
```

The PostgreSQL pilot package passed in 239.212s in the final authoritative run.
That run explicitly executed and passed the composed lifecycle HTTP/PostgreSQL
scenario (`TestPlatformLifecycleHTTPPostgresInheritedRuntimeRole`) and both
fresh/upgrade audit-envelope fixtures. No critical proof was skipped. The
browser output contained no screenshots, traces, videos, credentials, secrets,
or customer data.

## Durable audit

PR #536's existing `security_audit_events` authority remains the only durable
audit mechanism. No asynchronous consumer exists, so this PR does not invent
an outbox/worker. Gate A now executes the PR #536 audit-failure rollback proofs
for login, organization selection and platform organization patch, plus the
existing atomic Team/session/MFA/device/support families and the new
provisioning/lifecycle assertions.

## Governance

- `progress/review_461_gate_a.md` preserves the approved exact-SHA review for
  the prerequisite durable foundation.
- F202/#460 remains `in_progress`; SEC-8 and SEC-9 remain pending.
- #461 remains intentionally incomplete beyond the Gate-A-critical durable
  foundation.
- Gate B remains unopened.

## Remaining blocker before #385

`NONE` — **#385 DT-1 may start**.

## Key Learnings:

1. Gate A required an executable composition and narrow real-boundary proofs,
   not a second Foundation test system.
2. Tenant selection scopes business data but must not erase platform authority
   for an explicit platform command.
3. Audit-only events do not justify an asynchronous outbox when no projection
   or external consumer exists.
