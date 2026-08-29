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

Organization creation, invitation creation/acceptance, and support-session
creation require `Idempotency-Key` (16–128 URL-safe ASCII
characters). Scope is authenticated actor + organization + operation. A key is
retained for 24 hours. Same key and canonical request fingerprint replays the
recorded status/body and returns `Idempotency-Replayed: true`; different input
returns `409 IDEMPOTENCY_CONFLICT`. Receipts are process-local in #448's
transport component; DB-atomic durable receipts belong to the owning command
slice and durable outbox work (#452/#461).

## Migration boundary

Auth, Team and Platform consumers use generated types and runtime decoders in
this slice. There is no legacy fallback. Future #443 catalog writes must import
the same ETag/precondition/idempotency primitives rather than defining a
catalog-only variant.
