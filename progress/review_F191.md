# Independent audit — feature F191 / issue #448

**Technical result:** AUDIT_CLOSED after corrections

This document records an independent contract/code audit, not a receipt-driven
or formal RDD approval. Receipt-driven review was not enabled for this work.

| Stage | Commit | Result |
|---|---|---|
| Initial audit | `98a8446fc8fbaa310abbe9c51328b1a1676c7b99` | `CHANGES_REQUIRED` |
| Runtime/contract corrections | `30e380a` | Findings corrected |
| Deterministic generated EOF | `601f68b` | Drift/whitespace corrected |

## Initial blocking findings

1. **Durable idempotency was not durable or atomic.** Receipts lived in one
   process, so restart, replicas and the crash window could duplicate committed
   side effects. A caught PostgreSQL error also left the transaction aborted,
   preventing a replayable 4xx receipt, and factory organization creation could
   leave partial state.
2. **Team mixed identity and membership state.** An inactive membership was
   rendered as a pending global user and could trigger global approve/delete
   endpoints instead of a versioned membership command.
3. **The generated TypeScript client duplicated operations.** Its verbs, paths
   and schemas were hardcoded in the generator rather than derived from OpenAPI,
   so operation drift could pass CI.
4. **Typed/runtime validation was incomplete.** `fieldErrors` degraded to
   unknown values; `additionalProperties`, string/number constraints, patterns
   and formats were not enforced.
5. **Platform audit hid failures.** A rejected load became an empty/stale success
   instead of an honest error with retry.
6. **Auth transport had two authorities.** The OpenAPI field and legacy
   `client` field diverged; normal login could accept/emit `support` without the
   required support claims.
7. **Other boundary gaps remained.** Invitation revoke exposed version without
   `If-Match`; Platform PATCH emitted an undocumented ETag and accepted raw
   unknown keys; strict decode failures could write two error envelopes; mobile
   parsed login manually and targeted an origin without `/api`; the current
   factory organization baseline still used a manual contract.

## Correction audit

### Idempotency, concurrency and transactions

- Migration `000093_idempotency_receipts` creates a shared PostgreSQL receipt
  table with a 24-hour expiry boundary.
- `PostgresStore.ExecuteIdempotent` serializes the scope across replicas and
  commits the successful business mutation with its HTTP receipt atomically.
- The command runs under a savepoint. A 4xx rolls back business changes before
  storing the response; a callback error or 5xx rolls back the whole
  transaction. This also recovers a transaction aborted by caught SQL errors.
- Fingerprints include method, path, canonical body and `If-Match`; scope
  includes actor, organization, operation and key.
- PostgreSQL tests cover restart, two store instances, concurrent duplicate,
  crash rollback, retention, caught SQL/409 replay and factory-provisioning
  rollback. API tests cover replay, mismatch and precondition identity.

### Generated contract and boundaries

- The generator now consumes OpenAPI `paths`; the drift checker mutates
  operation ID, verb, path, request and response and requires generated output
  to change.
- Go/TS field errors preserve string values. Runtime validation covers
  additional properties, bounds, lengths, patterns and `date-time`.
- Generated decoders reject unknown keys and trailing JSON exactly once.
  Platform PATCH has an explicit allowlist matching the generated schema.
- PATCH organization and invitation revoke declare/return ETag; revoke requires
  `If-Match`, increments version, returns typed 412 when stale and is
  idempotent.
- `GET|POST /factory/organizations` now use generated operations. Create is an
  atomic idempotent command across organization, clone, membership and critical
  audit. Broader #459 UX was not started.

### Auth, Team and Platform consumers

- Generated `LoginTransport` is limited to web/mobile/sketchup. Support is only
  an authenticated response/token transport created through the audited support
  session path with support claims.
- Legacy/missing/mismatched transport payloads are rejected. Web, mobile and
  SketchUp use the canonical field; mobile uses the shared generated client and
  `/api` base URL.
- Team projects account and membership state separately and performs versioned
  membership activation instead of destructive account actions.
- Platform audit surfaces failed loads and provides retry; generated users/audit
  shapes reject legacy projections.

## Acceptance result

All initial P0/P1 findings above are corrected in the code, OpenAPI, migration,
generated artifacts, consumers and negative proofs. F191 may move from
`in_progress` to `done` on this local evidence; remote PR CI remains mandatory
before merge.

## Verification evidence

```text
pnpm openapi:check && pnpm typecheck && pnpm test
  PASS — 7 typecheck projects; domain 1153, storage 170, excel 93,
         desktop 17, mobile 49, UI 148 files / 1454 tests,
         web 26 files / 331 tests

GOCACHE=/tmp/muebleria-go-cache go test ./... -count=1
  PASS — all backend packages, PostgreSQL storage proofs and pilotreadiness

PATH=/Users/tiagofur/.rbenv/versions/3.2.11/bin:$PATH \
  BUNDLE_PATH=/tmp/muebleria-bundle bundle exec rake test
  PASS

git diff --check origin/main...HEAD
  PASS
```
