# F191 / issue #448 — implementation evidence

Date: 2026-08-28
Branch: `feat/448-generated-openapi-contract`
Status: complete after independent audit and full local verification.

## Outcome

Issue #448 now has one versioned OpenAPI v1 contract consumed by generated Go
and TypeScript artifacts across the migrated Organization Foundation surfaces.
Auth, Team, invitations, Platform, support sessions and the current factory
organization read/create baseline use generated request/response shapes without
a runtime legacy fallback.

The initial implementation at `98a8446` failed independent audit. Commit
`30e380a` closes the runtime and contract gaps; `601f68b` makes generated file
endings deterministic. The audit trail is in `progress/review_F191.md`.

## Contract and generation

- `contracts/openapi/granete-api.v1.yaml` is the versioned source of truth.
- `scripts/generate_openapi.py` emits Go DTOs, TypeScript DTOs/runtime schemas
  and the operation client from the OpenAPI schemas and paths.
- `scripts/check_openapi_drift.py` proves that changes to operation ID, verb,
  path, request and response alter generated output; CI runs the drift check.
- Runtime validation enforces declared object properties,
  `additionalProperties`, string/number bounds, patterns and `date-time`.
- Generated errors preserve typed string `fieldErrors` and the common envelope:
  `code`, `message`, `fieldErrors`, `requestId`, `retryable`, `details`.
- Generated files are normalized to exactly one final newline.

## Backend boundary and command semantics

- Generated request decoding is strict on migrated routes: one JSON document,
  no unknown properties and no duplicate error response on decode failure.
- Request IDs are validated or generated, propagated in headers/context/errors,
  and correlated with audit details.
- Strong version ETags and `If-Match` protect priority membership,
  organization and invitation-revoke mutations. Stale writes return typed 412
  without mutating stored state.
- Migration `000093_idempotency_receipts` adds shared PostgreSQL receipts with a
  database-enforced 24-hour retention boundary.
- The idempotency scope covers actor, organization, operation and key; the
  fingerprint covers method, path, `If-Match` and canonical JSON body.
- A business mutation and its successful replay receipt commit atomically.
  Client failures roll the command back to a savepoint before persisting the
  replayable 4xx; server failures roll back both mutation and receipt.
- Restart, multi-replica concurrency, crash, retention, payload mismatch,
  caught SQL error and rollback of partial factory provisioning are executable
  PostgreSQL proofs.
- Platform organization creation validates generated required fields and clone
  source before insertion. Factory organization create/clone/membership/audit is
  one atomic idempotent command.

## Auth and consumers

- Login accepts only generated `LoginTransport` values: `web`, `mobile` or
  `sketchup`. Missing, legacy, mismatched and unknown transport payloads fail at
  the boundary.
- `support` remains a response/token transport and can only be produced by the
  audited support-session path with support claims. The regular access-token TTL
  remains 18 hours; #448 does not reintroduce a 15-minute token.
- Web, mobile and SketchUp send the canonical transport. Mobile uses the common
  generated client and pins the `/api` base path.
- Team separates global account status from membership status and uses
  versioned membership commands; it no longer routes inactive membership rows
  through destructive global-user actions.
- Platform users/audit consume the generated shape. Audit load failures remain
  visible with retry instead of becoming an empty/stale success.
- The current `GET|POST /factory/organizations` baseline is in the generated
  contract/client. The broader Sales Network redesign remains outside #448 and
  is owned by #459; no second runtime implementation was started.

## Negative proofs

Tests fail if any of these regressions return:

- invalid or constraint-breaking success/error JSON accepted at a TS boundary;
- invalid/legacy auth transport accepted, or ordinary login emits support claims;
- operation metadata changes without generated-client drift;
- unknown request properties or more than one JSON document accepted;
- stale membership/invitation/organization write overwrites current state;
- one idempotency key replays a different body or `If-Match` value;
- restart/second replica/crash executes a committed command twice;
- a replayable 4xx retains a partial business mutation;
- Platform audit hides a failed load or accepts the legacy shape;
- Team treats inactive membership as pending global account approval.

## Verification

Executed against the corrected branch:

```text
pnpm openapi:check && pnpm typecheck && pnpm test
  PASS — OpenAPI current; 7 typecheck projects; domain 1153, storage 170,
         excel 93, desktop 17, mobile 49, UI 148 files / 1454 tests,
         web 26 files / 331 tests

GOCACHE=/tmp/muebleria-go-cache go test ./... -count=1  # backend-go
  PASS — cmd/admin, db, internal/api, auth, config, domain, engine,
         storage and pilotreadiness

PATH=/Users/tiagofur/.rbenv/versions/3.2.11/bin:$PATH \
  BUNDLE_PATH=/tmp/muebleria-bundle bundle exec rake test  # SketchUp
  PASS

git diff --check origin/main...HEAD
  PASS after generated/document file-ending normalization
```

Expected jsdom/WebGL warnings remained non-failing. Remote CI is still required
by repository policy before merge; it is not replaced by this local evidence.

## Scope boundary

This change does not start #449. RLS, tenant transactions, lifecycle expansion,
complete Sales Network UX and later Organization Foundation slices remain owned
by their existing issues. The generated contract and its cross-runtime
consumers stay in one PR under the documented size exception.
