# #461 Gate-A durable audit foundation — implementation report

Date: 2026-09-02
Branch: `feat/461-gate-a-durable-audit`
Base: `main@355be4ea4d3fead73cacd5ff67525ee8de80eb25`

## Scope delivered

This PR implements only the minimum durable #461 mechanism required by Gate A.
It does not complete #461, run/declare Gate A green, implement Gate B, or start
#385.

### Existing authority retained

- `security_audit_events` remains the single append-only durable audit store.
- Existing ambient request transactions, application-owned transactions and
  durable idempotency receipts remain the commit authority.
- Existing atomic Foundation families (admin transfer, offboarding, sectors,
  invitation acceptance, organization lifecycle/provisioning, session
  revocation, refresh/logout, MFA, devices and support sessions) were not
  duplicated or redesigned.
- No outbox worker was added: Gate A has no asynchronous projection/consumer.

### Critical best-effort gaps closed

1. Successful login now creates the session, initial refresh credential,
   updates `last_login_at`, generates the bounded token and inserts
   `login_success` inside one transaction. Required-audit failure returns 500,
   exposes no refresh cookie, and rolls every mutation back.
2. `select-org` now inserts required `organization_selected` evidence after
   changing session/family scope inside the existing authenticated request
   transaction. Audit failure rolls scope back to the previous state.
3. Platform organization PATCH now requires platform-admin step-up and durable
   idempotency, and writes `organization_renamed` /
   `organization_license_updated` before the transaction commits. Audit failure
   rolls name/license/version back; the same idempotency key can retry.
4. A source guard fails if these critical Foundation event families return to
   `Server.audit` best-effort calls.

### Minimal audit envelope and RLS

Migration `000110_security_audit_envelope` adds:

- `schema_version INTEGER NOT NULL DEFAULT 1` with a positive constraint;
- nullable, shape-validated `request_id` plus a partial index;
- actor/target-self or live-platform visibility for organization-less events;
- platform authority to insert organization-scoped evidence while remaining
  org-less, without granting ordinary actors cross-organization insertion;
- updated `rls_policy_inventory` metadata;
- complete down migration restoring the previous schema/policies.

`InsertSecurityAuditEvent` now persists the structural envelope, promotes
legacy `details.request_id`, and fails closed on JSON serialization errors or
secret-bearing field names (`password`, raw token/secret/cookie/authorization,
TOTP/recovery/pairing material). The old `encode_error` success placeholder was
removed.

## Executable evidence

### Real PostgreSQL / runtime-role / migrations

- `TestSecurityAuditEnvelopeMigrationFreshUpgradeAndDown`
  - fresh migration through 000110;
  - upgrade from 000109 with backfill verification;
  - down migration;
  - schema/request constraints.
- `TestSecurityAuditEnvelopeOrglessRLSAndStrictPersistence`
  - real `granete_app_test` role;
  - unrelated actor cannot read org-less evidence;
  - org-less platform admin can write scoped evidence;
  - ordinary actor cannot write another tenant's evidence;
  - structural version/request correlation persists;
  - unserializable and secret-bearing payloads fail closed.

### Real HTTP + PostgreSQL failure injection

- `TestGateADurableAuditFailureRollsBackLoginSession`
  - trigger rejects `login_success`;
  - session/family/last-login do not commit;
  - no refresh credential is exposed.
- `TestGateADurableAuditFailureRollsBackOrganizationSelection`
  - trigger rejects `organization_selected`;
  - session remains organization-less; new scope does not commit.
- `TestGateADurableAuditFailureRollsBackPlatformOrganizationPatch`
  - platform MFA step-up and real idempotency boundary;
  - trigger rejects `organization_renamed`;
  - name/version remain unchanged;
  - retry with the same key succeeds after failure removal and writes exactly
    one durable event.

Focused PostgreSQL commands passed:

```text
GOCACHE=/tmp/muebleria-go-cache go test -v ./internal/storage \
  -run '^TestSecurityAuditEnvelope' -count=1
GOCACHE=/tmp/muebleria-go-cache go test -v ./tests/pilotreadiness \
  -run '^TestGateADurableAuditFailure' -count=1
```

Other verification:

```text
GOCACHE=/tmp/muebleria-go-cache GOFLAGS='-p=1' go test ./... -count=1  PASS (real PostgreSQL)
pnpm test                         PASS
pnpm typecheck                    PASS
pnpm openapi:check                PASS
git diff --check                  PASS
```

The OpenAPI contract now declares `Idempotency-Key` on platform organization
PATCH; the generated TypeScript client was regenerated via
`scripts/generate_openapi.py` and creates a key by default.

## Documentation and governance

- Preserved the three current-state exploration reports, including the A/B/C/D
  operation matrix and 34-scenario Gate A coverage inventory.
- Corrected stale SEC-7 status in `progress/current.md`, `feature_list.json`
  and ADR-0007: PR #535 is integrated in `main@355be4ea`; F202/#460 remain open
  because SEC-8/SEC-9 are still pending.
- F202 remains the only ledger feature `in_progress`; this Gate-A rescue is
  explicitly coordinated and does not falsely complete #460.

## Deferred intentionally

- Full #461 audit timeline/read model, filters/export, observability, metrics,
  alerting, SIEM and supply-chain work.
- Any outbox/retry/dead-letter worker without a real asynchronous consumer.
- Additional representative audit-failure proofs already classified B in the
  inventory; PR B should add only those demanded by the final Gate-A matrix.
- Gate B, Sales Network, SEC-8/SEC-9, #453–#459 and #385.

## Gate status

`PR A durable foundation = PASS` based on the evidence above.

`Foundation Gate A = NOT YET CLAIMED`: PR B must compose/reuse the 34 scenarios,
fill only its exact coverage gaps, execute the named final gate, and only then
record `#385 DT-1 may start`.

## Delivery

- Implementation commit: `666466285c934cb9b399375589bcd32f49ab91b0`
- Pull request: [#536](https://github.com/tiagofur/muebleria/pull/536)
  against `main`, labeled exactly `type:feature`; not merged.
- The PR deliberately uses `Part of #461` rather than a closing keyword: this
  rescue slice does not complete the full #461 timeline/observability scope.

## Key Learnings:

1. Gate A needed no asynchronous outbox; its missing integrity boundary was
   synchronous audit atomicity on three success paths.
2. Platform PATCH had two coupled gaps: best-effort audit and an org-less
   platform actor that lacked explicit RLS authority to write scoped evidence.
3. Failure responses must be captured before any credential reaches the client;
   transaction rollback alone is insufficient if a cookie was already exposed.
