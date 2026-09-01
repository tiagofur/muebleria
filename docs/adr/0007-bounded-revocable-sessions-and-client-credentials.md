# ADR-0007 — Bounded revocable sessions and client-specific credentials

- **Status:** Accepted (SEC-1 implemented; SEC-2..SEC-9 in progress)
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
extends it. Classification: platform-global under RLS (self or active
organization or platform admin; inserts must carry the owning user), registered
in the policy inventory; no DELETE grant — sessions end by revocation.

### 2. Exact JWT policy with key rotation

Tokens are HS256 only — the exact instance, not the HMAC family — with `iss`
(`granete-api`, override `JWT_ISSUER`), `aud` per client type
(`granete-web|mobile|sketchup|support`), `typ` (`access_web`, `access_mobile`,
`device_sketchup`, `support_access`), `sid`, `jti`, `ver=5` and a `kid` header
resolving into a keyring (`JWT_KEYRING`; single-secret deployments register
`JWT_SECRET` under kid `legacy`). Rotation is zero-downtime: new tokens use the
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
- SEC-2 builds refresh families, logout and the session directory on this
  registry; SEC-4 replaces the web bearer-in-localStorage with short-lived
  in-memory access plus a rotating refresh credential; SEC-6 registers SketchUp
  devices; SEC-7 stores step-up freshness (`step_up_at`) server-side.

## Verification

`internal/auth/auth_test.go` (exact-algorithm/iss/aud/typ/sid/jti policy,
keyring rotation, legacy window), `internal/api/session_registry_test.go`
(revocation cuts an unexpired JWT, absolute expiry cut, fail-closed lookup,
client-type confusion, stable sid across select-org, ver4 upgrade bounded by
the original origin), `internal/storage/auth_sessions_test.go` (migration
fresh+upgrade, lifecycle under the app role, RLS scopes and insert policy).
