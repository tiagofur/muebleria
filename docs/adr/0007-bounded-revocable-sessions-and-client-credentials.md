# ADR-0007 — Bounded revocable sessions and client-specific credentials

- **Status:** Accepted (SEC-1 and SEC-2A integrated; SEC-2B implemented pending review; SEC-3..SEC-9 in progress)
- **Date:** 2026-08-31
- **Tracking:** #460 (tracker), #446 (program)
- **Extends:** ADR-0005 §7, ADR-0006 §11
- **Canonical detail:** `docs/architecture/organization-foundation-v2.md` §13

## Context

ADR-0005 defined JWT v2 with organization-scoped claims; #441/#445 fixed the
finite 18-hour workday session and rejected sliding refresh. The gaps that
#460 must close: no server-side session registry (revocation is only
membership/org-wide), one non-rotatable HMAC secret with no `iss`/`aud`/`kid`,
any-HMAC algorithm acceptance, session JWTs accepted in query strings, and no
MFA/step-up anywhere. F199 left the integration point ready: `SessionScope`
carries `absolute_expires_at` and its cache keys anticipate an authoritative
session id.

## Decision

### 1. Server-side session registry is the revocation and lifetime authority

Every login, refresh upgrade, select-org upgrade, invitation acceptance and
support start creates a row in `auth_sessions` (migration 000105) and mints a
version-5 token whose `sid` names it. The middleware resolves the row live on
every request: `revoked_at` or a passed `absolute_expires_at` invalidates the
token immediately even with an unexpired JWT, and the row's `client_type` must
match the token transport. The row keeps `absolute_expires_at = issued_at +
18h` (web/mobile; 30d SketchUp device policy; 2h support) — refresh never
extends it.

**Current-scope authority.** The registry row is also the authority of the
session's CURRENT scope, not just its lifetime: a ver5 token only validates
while its claims equal the row's scope exactly (org-less while the row is
org-less; `membership_id`+`organization_id` when scoped; the linked
`support_sessions` row and organization for support). select-org's in-place
update therefore invalidates every previously issued bearer of the previous
scope on the next request — one session, one current scope, no second
generation counter.

**Scope coherence is enforced by the database.** Composite foreign keys require
the membership to belong to the session's user and to the session's active
organization, and a scope-shape CHECK admits exactly three states: org-less
(both scope columns NULL), normal scoped (both set), support (organization +
support session set, membership NULL). The storage boundary translates FK/CHECK
violations into `ErrAuthSessionScopeIncoherent`.

**Classification:** platform-global under RLS, `self-or-platform` — the owning
user may read and update their rows, platform staff reach any row through
their explicit authority, and inserts must carry the owning user. Organization
administration of other members' sessions is deliberately NOT a tenant policy:
it arrives with the SEC-2 capability-checked command boundary. Registered in
the policy inventory; no DELETE grant — sessions end by revocation.

### 2. Exact JWT policy with key rotation

Tokens are HS256 only — the exact instance, not the HMAC family — and every
registered claim is REQUIRED and cross-checked for ver5: `iss` (`granete-api`,
override `JWT_ISSUER`), `aud` per client type
(`granete-web|mobile|sketchup|support`), `typ` (`access_web`, `access_mobile`,
`device_sketchup`, `support_access`), `sid`, `jti`, `sub` (== `user_id`), `exp`,
`nbf`, `iat`, `ver=5`, and a `kid` header resolving into a keyring
(`JWT_KEYRING`; single-secret deployments register `JWT_SECRET` under kid
`legacy`). The `kid` header itself is mandatory for ver5 — a kidless token is
accepted only while it is ver4 — a malformed (non-string or empty) kid is
rejected outright, `iat` is validated against the clock (future `iat` fails)
in addition to being required, and `aud` must be exactly the single audience
of the token's client type. Absence of any claim fails closed — a correctly
signed token with stripped claims is not a credential, independent of what
the minting helpers emit. Rotation is zero-downtime: new tokens use the
active kid, validation accepts every registered kid, and removing a kid from
the ring revokes its tokens immediately.

### 3. Credential classes never interchange

`typ` and `aud` are validated against the token's own transport, and the
registry `client_type` is compared live. A web access token can never act as a
SketchUp device token, and neither can open a support session. Support
credentials additionally resolve their audited `support_sessions` row.

### 4. Transitional ver4 acceptance is finite

Deployed clients hold version-4 bearer tokens (no sid). Validation accepts
them with their existing semantics while ver5 is issued; refresh and select-org
upgrade them to ver5 by registering a session bounded by the ORIGINAL
`auth_started_at`, so the upgrade never extends a session. Kidless ver4 tokens
validate only against the `legacy` keyring entry — a deployment rotating to a
keyring must register the old secret as `legacy` or old tokens fail closed.
The acceptance window ends at the #460 SEC-9 gate, which removes
`LegacyTokenVersion` validation and the legacy minting helpers together.

### 5. Session ids are public identity, never secrets

`session_id` is returned by login/select-org/refresh and exposed on
`/auth/me`'s `SessionScope` (optional until SEC-9, then required). It replaces
F199's ephemeral cache generation so React server-state keys derive from the
authoritative session. A sid alone grants nothing: it must be paired with a
signed ver5 token whose claims the middleware revalidates.

### 6. Refresh credentials are opaque, hash-only and single-use

SEC-2A adds one refresh family per web/mobile `auth_session`. A credential is
32 cryptographically random bytes encoded as an opaque bearer; PostgreSQL
stores only an HMAC-SHA-256 verifier under the independent
`REFRESH_TOKEN_PEPPER`, never the raw value. The pepper is mandatory in
production, at least 32 bytes, and is not a JWT signing key. There is no
reversible lookup, bcrypt cost, query parameter transport or secret-bearing
audit field.

Rotation locks the presented credential row, then its family and session in a
single PostgreSQL transaction. The transaction revalidates account,
membership, organization and the credential epochs snapshotted by the family,
mints the capped access credential, inserts generation N+1, consumes N and
writes the durable security event before commit. Any callback, audit or commit
failure rolls the whole transition back, leaving N usable and N+1 absent.

The concurrency policy is deliberately strict: if two requests present N,
exactly one may create N+1. The second observes N consumed and is treated as
reuse; it atomically revokes the family and `auth_session`, so N+1 and every
still-unexpired access token from that session fail immediately. A refresh
expiry is exactly the session `absolute_expires_at`; access minting is also
explicitly capped there. No rotation creates a sliding lifetime.

`POST /api/auth/refresh` now has an unauthenticated OpenAPI request body with
the opaque credential plus expected web/mobile transport. `POST
/api/auth/logout` is enumeration-safe and idempotently revokes both family and
session. Web/mobile login and invitation acceptance emit the first credential;
React does not persist or consume it until SEC-4. The legacy no-body
access-bearer refresh branch remains a finite runtime-only compatibility bridge
for deployed clients and SketchUp until SEC-4/SEC-6; it is no longer the
canonical OpenAPI operation.

Pepper rotation cannot re-key stored HMACs because the raw secrets do not
exist server-side. Rotate it as a credential-boundary event: revoke affected
sessions/families, deploy the new independent pepper, and require re-login.
Missing or weak configuration fails server startup.

### 7. Session directory and revocation boundaries preserve least privilege

SEC-2B exposes bounded, active-first directories and exact session revocation
for self, organization and platform through the generated OpenAPI contract.
Responses contain session identity, client type, timestamps, current/status flags,
a non-secret device hint and optional current organization/membership; they never
contain access or refresh credentials and are capped at 100 rows. Login, refresh,
logout and every session-directory response are `no-store`. Session-directory
routes require an Authorization header and reject the generic query-token fallback.

Self may enumerate and revoke only its own session rows. Organization admins use
the live `team:revoke_sessions` capability and an exact target membership inside
the active organization. Because `auth_sessions` and `auth_refresh_families` keep
FORCE RLS `self-or-platform`, organization access is implemented by narrow
`SECURITY DEFINER` list/command functions with fixed `search_path`, exact actor,
organization, membership, session and live role validation. Support sessions have
no membership and therefore are absent from organization member directories;
revoking an auth session does not close or reinterpret the separate
`support_sessions` business row. Platform authority remains explicit. Foreign and
missing session ids produce the same typed `SESSION_NOT_FOUND` response.

An exact revoke locks the session, monotonically revokes the session when open,
always CAS-revokes any still-open refresh family, and writes one critical audit
event in the same transaction if either row transitioned. This repairs the edge
where a session was already revoked but its family remained open; a later retry
changes neither timestamp nor audit. Concurrent commands produce one transition.
Failure updating the family or inserting audit rolls back both rows and leaves the
access and refresh credentials usable. Membership-wide revocation uses the same
atomic boundary so the membership credential epoch, every matching session and
every refresh family commit or roll back together. Idempotent command transactions
preserve the live membership actor used by database authorization.

## Alternatives considered

- **Keep exp-derived sessions without a registry.** Rejected: no per-session
  revocation, no reuse detection (SEC-2 needs the registry), no device
  directory, and the 18h bound could not be enforced server-side independently
  of token expiry.
- **Asymmetric signatures (RS256/EdDSA).** Not needed today: only the Go API
  validates tokens (the SketchUp extension decodes payloads unverified as an
  expiry hint), so HMAC with kid rotation gives equal rotation properties with
  fewer moving parts. Revisit if a second verifier appears.
- **Hard version cutover (reject ver4 immediately).** Rejected: it would force
  a coordinated re-login of every client at deploy time during the #460
  program; the finite acceptance window keeps each slice independently
  deployable and revertible.

## Consequences

- Every authenticated request resolves one extra indexed registry row; the
  middleware already performs per-request DB revalidation, so this adds no new
  pattern (measured budgets: #462 Gate A).
- `auth_sessions` is append-mostly platform-global data; retention/cleanup is
  an operational decision owned by #461 observability, not this ADR.
- select-org is atomic with the F199 contract: every fallible step (target
  validation, user fetch, token mint) runs BEFORE the scope mutation, so a
  failed switch leaves the previous scope and its bearer untouched; after the
  scope update only the best-effort audit and the 200 response remain, and any
  hard failure surfaces as 5xx and rolls the transaction back together with
  the switch.
- SEC-2A builds refresh families, rotation/reuse detection and real logout on
  this registry. SEC-2B implements the self/org/platform session directory and
  the capability-checked organization boundary the RLS model intentionally leaves
  out; SEC-4 replaces the web
  bearer-in-localStorage with short-lived in-memory access plus a rotating
  refresh credential; SEC-6 registers SketchUp devices; SEC-7 stores step-up
  freshness (`step_up_at`) server-side.

## Verification

`internal/auth/auth_test.go` (exact-algorithm policy; every registered claim
required — exp/iat/nbf/sub==user_id/iss/aud/jti/sid/typ — with iat
clock-validated, exactly-one audience, and a ver5-mandatory kid header
including kidless/malformed-kid negatives; keyring rotation; legacy window), `internal/api/session_registry_test.go`
(revocation cuts an unexpired JWT, absolute expiry cut, fail-closed lookup,
client-type confusion, current-scope invalidation of previous bearers across
select-org A→B, failed-switch scope preservation with failure injection,
stable sid across select-org, ver4 upgrade bounded by
the original origin), `internal/storage/auth_sessions_test.go` (migration
fresh+upgrade, lifecycle under the app role, membership/user/organization
coherence negative proofs, and direct-SQL RLS under `granete_app`: self access,
same-org ordinary member denied, other-org denied, platform authority path,
owner-scoped inserts only).

SEC-2A adds `internal/auth/refresh_test.go` (opaque generation, keyed verifier,
malformed inputs and access-exp cap), `internal/storage/auth_refresh_test.go`
(fresh+upgrade migration, verifier-scoped RLS, atomic rotation/replay,
concurrency, absolute expiry, membership isolation, logout and failure
injection for mint/audit/revoke/commit), and the real-PostgreSQL HTTP proof in
`tests/pilotreadiness/auth_refresh_test.go`.


SEC-2B adds `internal/storage/session_directory_test.go` (fresh and upgrade
migration, unchanged direct-RLS role graph, bounded self/org/platform listing,
cross-tenant and seller denial, concurrent/idempotent exact revocation,
family-only repair and family/audit rollback), `internal/api/session_directory_test.go`
(typed HTTP behavior, current-session cut and query-token rejection), and the
real PostgreSQL/runtime-role HTTP proof in
`tests/pilotreadiness/session_directory_http_test.go` (independent memberships,
self current/other session, organization and platform boundaries, access+refresh
cut, enumeration safety and both failure injections).
