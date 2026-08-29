# F191 / issue #448 implementation evidence

Date: 2026-08-28  
Branch: `feat/448-generated-openapi-contract`  
Status: implementation complete, ledger intentionally remains `in_progress` pending reviewer verdict.

## Authority and entry audit

- Confirmed the branch starts from `origin/main` at merge PR #463 and issue #447 is closed.
- Read the Organization Foundation v2 canonical document, ADR-0006, ADR-0005, architecture/conventions/verification docs, and issues #446, #448, #462, and #443.
- Detailed entry audits are preserved in:
  - `progress/explore_448_authority.md`
  - `progress/explore_448_backend.md`
  - `progress/explore_448_web.md`
- Computed the ledger ID from the live file (`max(existing numeric IDs) + 1`), registered exactly one feature (`F191`), and preserved exactly one `in_progress` feature.

## Implemented contract

- Added the versioned OpenAPI 3.1 source of truth at `contracts/openapi/granete-api.v1.yaml` and its operational contract at `contracts/openapi/README.md`.
- Covered the real Auth, Team, invitation, Platform organization/user/audit, and support-session routes. Relationship and Sales Network schemas are declared for future consumers without registering placeholder runtime endpoints.
- Added the deterministic, dependency-free generator `scripts/generate_openapi.py`. It validates OpenAPI version, required properties, and internal schema references, then emits:
  - Go DTOs: `backend-go/internal/api/openapi/generated/types.gen.go`
  - TypeScript DTOs and runtime schemas: `packages/storage/src/openapi/generated/types.ts`
  - TypeScript operation client: `packages/storage/src/openapi/generated/client.ts`
- Added `scripts/check_openapi_drift.py`, root generation/check scripts, and a CI drift gate.
- Documented the authorized size exception: generated contract and its consumers are an atomic cross-runtime review unit requested as one PR.

## Backend integration

- All HTTP errors now use the generated envelope (`code`, `message`, `fieldErrors`, `requestId`, `retryable`, `details`). Security-sensitive behavior has stable codes rather than message substring matching.
- Added validated/generated `X-Request-ID`, context propagation, response header propagation, structured internal-error logging, and audit correlation.
- Added reusable strong version ETags (`"v<N>"`) and `If-Match` parsing with typed 428/400/412 responses.
- Migration `000092_org_api_versions` adds positive `version` columns to organizations, memberships, and invitations.
- Membership role/active mutations and Platform organization mutation perform atomic expected-version updates. Stale membership proof verifies the stored version/roles remain unchanged.
- Added reusable 24-hour idempotency receipts scoped by actor + organization + operation + key. JSON payloads are canonicalized for fingerprints; identical/concurrent retries replay the exact recorded response, while key reuse with different input returns `IDEMPOTENCY_CONFLICT`.
- Applied idempotency to organization creation, invitation creation/acceptance, and support-session creation. The process-local receipt implementation is deliberately bounded to #448; DB-atomic durable receipts/outbox remain owned by #452/#461 as documented by the canonical plan.
- Migrated Auth responses/requests, Team projections/mutations/invitations, Platform organizations/users/audit/support sessions to generated DTOs or explicit generated adapters. No new/migrated Organization Foundation response is a public `map[string]interface{}` contract.
- Corrected Platform users to flattened organization membership fields and audit to `ip` plus JSON-object `details`; request IDs are included in audit details.
- Preserved existing correct routes and adapted the real PostgreSQL pilot-readiness fixture to the required idempotency and precondition headers.

## TypeScript and web integration

- Added the common `GraneteApiClient`, backed by the generated operation client, with centralized bearer auth, request IDs, typed errors, runtime response validation, `If-Match`, and `Idempotency-Key`.
- Invalid successful JSON is rejected at the boundary. Invalid upstream error envelopes become a safe typed error while preserving `X-Request-ID`.
- Migrated web login/register/me/select-org/support logout, public invitation acceptance, Team, and Platform consumers to the generated client/types.
- Removed the Team list fallback from `/org/team` to `/admin/users`; legacy account approval/rejection remains an explicitly separate account workflow, not a membership fallback.
- Removed blind HTTP response casts from the migrated Auth/Team/Platform surfaces.
- Platform contract tests reject the old nested membership shape and old `ip_address`/`metadata` audit shape.

## Negative proofs

- Invalid generated response payloads fail runtime validation.
- Localized error messages can change without changing decisions based on `ApiError.code`.
- An invalid inbound request ID is replaced; a valid one reaches response headers and the error envelope.
- Missing/malformed `If-Match` is rejected.
- A stale membership write returns typed 412 and cannot overwrite roles/version.
- Same idempotency key + same canonical payload replays; different payload conflicts; concurrent duplicate executes once; an expired receipt executes again.
- Platform user/audit legacy shapes are rejected.
- Team source test proves the `/admin/users` list fallback is absent.

## Verification

Green commands executed on the final implementation:

```text
python3 scripts/check_openapi_drift.py
  OpenAPI generated files are current

git diff --check
  PASS

pnpm typecheck
  PASS — all 7 runnable workspace projects

pnpm test
  PASS — domain 1153, excel 93, storage 166, desktop 17,
         mobile 48, UI 1451, web 331 tests

pnpm --filter @granete/storage test
  PASS — 167 tests (includes the final invalid-envelope request-ID proof)

GOCACHE=/tmp/muebleria-go-cache go test ./... -count=1  # backend-go, PostgreSQL local
  PASS — cmd/admin, db, internal/api, auth, config, domain,
         domain/engine, storage, and tests/pilotreadiness

GOCACHE=/tmp/muebleria-go-cache go test ./internal/api \
  -run 'Test(RequestID|VersionETag|Idempotency|StaleMembership)' -count=1
  PASS — final focused contract proof after response replay header hardening
```

Expected jsdom/WebGL warning output remains non-failing and unchanged. No acceptance blocker remains.
