# Granete API v1

`granete-api.v1.yaml` is the executable HTTP contract for Organization
Foundation. It is JSON-formatted YAML so the repository generator needs only
the Python standard library.

Run `pnpm openapi:generate` after changing the spec. Generated Go DTOs,
TypeScript DTOs/runtime schemas, and the TypeScript operation client are
committed. `pnpm openapi:check` regenerates in a temporary directory and
byte-compares outputs; CI fails on drift.

## Concurrency

Mutable resources use strong ETags formatted as `"v<N>"`. A sensitive write
requires `If-Match`; missing is `428 PRECONDITION_REQUIRED`, malformed is
`400 BAD_REQUEST`, and stale is `412 VERSION_CONFLICT` (or the more specific
`MEMBERSHIP_VERSION_CONFLICT`). A stale request MUST NOT mutate state.

## Idempotency

Organization creation, factory-network provisioning, invitation
creation/revocation/acceptance, and support-session creation require
`Idempotency-Key` (16–128 URL-safe ASCII
characters). Scope is authenticated actor + organization + operation. A key is
retained for 24 hours. Same key and canonical request fingerprint replays the
recorded status/body and returns `Idempotency-Replayed: true`; different input
returns `409 IDEMPOTENCY_CONFLICT`. PostgreSQL receipts guarantee at least 24
hours of retention. Receipt insertion, the command mutation, critical audit and
the completed response commit in one transaction; replicas serialize on the
receipt key, and a crash cannot leave a committed side effect without its exact
replayable response. Client-error responses roll back the command to a
savepoint, then commit only their replayable 4xx receipt. Server errors roll
back the receipt and every command mutation.

## Authentication transport

`LoginRequest.transport` is the single canonical login boundary (`web |
mobile | sketchup`) and is preserved in token claims across select-org,
refresh and `/me`. `support` remains an `AuthTransport` only for responses and
tokens issued by the audited support-session operation; ordinary login cannot
request it. All active web, mobile and SketchUp consumers send the canonical
field; omitted transport and the legacy `client: sketchup-extension` payload
are rejected. Reading transport/client claims from already-issued JWTs remains
temporarily compatible only until those finite tokens expire; that is token
migration, not an HTTP DTO fallback.

## Migration boundary

Auth, Team, Platform and the current `/factory/organizations` sales-network
consumer use generated types and runtime decoders in this slice. The future
relationship and `/sales-network` schemas remain declared for #459 but are not
implemented here. There is no legacy fallback on migrated operations. Future #443 catalog writes must import
the same ETag/precondition/idempotency primitives rather than defining a
catalog-only variant.
