# ADR-0007 — Bounded revocable sessions and client-specific credentials

- **Status:** Accepted (SEC-1, SEC-2A and SEC-2B integrated; SEC-3 and SEC-4A integrated; SEC-4B implemented pending review; SEC-5..SEC-9 in progress)
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

`POST /api/auth/refresh` dispatches per transport (SEC-4A): the mobile JSON
body carries the opaque credential with `transport: "mobile"`; the Web rotates
bodyless through its HttpOnly cookie under the CSRF boundary. `POST
/api/auth/logout` is enumeration-safe and idempotent and revokes both family
and session from either the mobile body or the Web cookie. Web login and
invitation acceptance emit the first credential exclusively as the
`granete_web_refresh` cookie; React consumes the cookie flow in SEC-4B. The
legacy no-body access-bearer refresh branch remains a finite runtime-only
compatibility bridge now RESTRICTED to the credential classes without an
opaque family — SketchUp extension tokens and support sessions — until SEC-6;
web/mobile bearers are denied there, and it is not the canonical OpenAPI
operation.

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

### 8. Media reads use resource-scoped short-lived grants; the query-string session JWT is gone

SEC-3 removes the generic `?token=<session JWT>` authentication from the
middleware entirely: a session credential only travels as an Authorization
header, and every route — auth, business and media — answers 401 to a
session JWT in the URL (the explicit precedence is header-wins; the query
string never participates in session authentication).

Direct-URL media consumers (web `<img>`, SketchUp HtmlDialog webviews) that
motivated the historical fallback now use a dedicated `media_read` credential
class. `POST /api/media:authorize` authenticates a session (organization scope
required) and mints one signed grant per canonical catalog media filename that
physically exists under the caller's organization partition — typed resource
ids only, never an arbitrary URL/path to sign, and files of other tenants are
omitted so responses stay enumeration-safe. A grant carries
`ver=1|typ=media_read|iss=granete-media|aud=granete-media`, the exact
canonical resource key `media/<filename>` (in both `resource` and `sub`), the
owning `org_id`, `op=read`, mandatory `exp/nbf/iat/jti` and optional
`sid`/`uid` mint provenance. `GET /api/media/{name}` accepts exactly one of
two credential classes: a session Authorization header (full live policy) or
`?grant=<media_read>`; precedence is explicit (header present → grant ignored),
a grant naming any other file is a plain 404, and consumption is stateless —
the exact-resource and organization binding are signed material, not runtime
lookups.

Grants live 3 minutes and never exceed the minting session's absolute expiry
(cap = `auth_started_at` + the transport's session TTL), so a revoked session
can stop minting immediately while outstanding URLs decay within minutes at
most — the deliberate trade-off of a stateless signed read grant; the
observable signal without any stored secret is the authorize request itself.
Media responses stay `Cache-Control: private` (+`Vary: Authorization`) and
the authorize endpoint is `no-store`; a signed URL never turns a private file
into a public one, and the browser's freshness boundary never outlives the
credential: a grant-authorized read caps `max-age` at the signed grant's
remaining lifetime (≤ the 3-minute TTL) while session-header reads keep the
day-long private cache whose validity the live session re-establishes per
request. Grants are signed with the mandatory `MEDIA_SIGNING_KEY`
(≥ 32 bytes; boot fails closed), which shares no primitive with
`JWT_SECRET`/`JWT_KEYRING`/`REFRESH_TOKEN_PEPPER` — credential-class confusion
is rejected at the signature level on top of disjoint `iss`/`aud`/`typ`/`ver`.
React resolves media through a token-scoped in-memory cache (batched, deduped,
refreshed before expiry, dropped on logout/organization switch; never
persisted). The SketchUp webviews never receive the extension session
credential: Ruby exchanges it for per-file signed URLs and re-mints expired
grants on demand via the `refresh_media_url` callback. SketchUp's logger
redacts `grant=` query credentials like every other credential.

Remaining roadmap: SEC-4B Web in-memory access cutover, SEC-5 Mobile credential
migration, SEC-6 SketchUp device credentials, SEC-7 MFA/step-up, SEC-8 trusted
proxy/rate limits/account hardening, SEC-9 final gate + ver4 EOL.

### 9. Web refresh credential travels only in a HttpOnly cookie (SEC-4A)

The Web transport's rotating refresh credential is the SAME SEC-2A opaque
single-use secret Mobile receives as JSON — only the transport differs. It is
delivered exclusively as `Set-Cookie: granete_web_refresh=<opaque>` on login,
invitation acceptance and every rotation, with `HttpOnly; SameSite=Strict;
Path=/api/auth`, host-only (no `Domain`), and `Secure` in production. It never
appears in a Web response body, URL, log or client store; the Web JSON carries
only the access token plus server-clock `access_expires_at` /
`absolute_session_expires_at` metadata so SEC-4B can schedule refresh without
decoding JWTs. Mobile keeps the body contract untouched until SEC-5; SketchUp
and support keep the (now transport-restricted) bodyless bearer bridge until
SEC-6; invitation acceptance is Web onboarding today and therefore cookie-based.

The cookie expiry is the auth session's `absolute_expires_at` — never
`now + TTL` — so every `Set-Cookie` in a family preserves the original login
deadline; the composite FK chain (sessions ← families ← credentials) makes that
bound a structural database invariant. select-org rotates nothing: the cookie
stays in its family and the in-place scope update redirects the next rotation
to the current organization. Logout takes the credential from the cookie,
applies the CSRF boundary, revokes family + session through SEC-2A, clears the
cookie with matching attributes only AFTER that revocation commits, and stays
enumeration-safe/idempotent. A credential-less logout is a mutation-free 200:
it neither revokes anything nor emits a deletion Set-Cookie, so a cross-site
form — which SameSite=Strict keeps from carrying the cookie — cannot force the
browser to drop it. Internal (5xx) failures of refresh or logout never touch
the cookie: the transaction rolled back, the presented credential is still
the live one, and a retry must be able to succeed; the cookie is only cleared
for terminal public refresh states or after a committed logout.

**CSRF boundary.** Cookie-authenticated refresh/logout require BOTH an
exactly-allowed `Origin` (the CORS allowlist — never a wildcard) and the
non-simple custom header `X-Granete-CSRF: 1`. A cross-site form can set
neither; CORS alone is not trusted as the defense. `Access-Control-Allow-Credentials:
true` is emitted only next to an exactly reflected allowed origin. Presenting
a JSON body together with the Web cookie is rejected as credential mixing
(fail closed), and the refresh dispatcher precedence is total: body → mobile,
bodyless+cookie → Web, bodyless+bearer → SketchUp/support only.

**Fail-closed configuration.** `GRANETE_ENV` is an explicit deployment signal
(`docker-compose.prod.yml` pins it to `production`, not overridable via `.env`).
`WEB_REFRESH_COOKIE_SECURE` is `auto` (default: Secure unless every CORS origin
is loopback HTTP — the local gate shape), `true`, or `false`; any resolution
that would ship an insecure Web refresh cookie under
`GRANETE_ENV=production` makes the server refuse to boot.

**Deferred to SEC-4B by design:** the React cutover (in-memory access token,
cookie bootstrap/refresh, cross-tab refresh serialization via
`navigator.locks`/`BroadcastChannel`, removal of the `granete_token`
localStorage bearer — old Web sessions re-login once), and the short Web
access-token TTL, which activates only when React can refresh automatically.
Server reuse detection stays STRICT: two tabs refreshing the same cookie
concurrently look like replay and revoke the family, so cross-tab
serialization is a hard SEC-4B prerequisite, never a server-side relaxation.

### 10. Web access credential lives only in tab memory (SEC-4B)

The Web cutover completes the SEC-4 transport split: a SHORT access bearer in
process/tab memory plus the SEC-4A HttpOnly rotating cookie as the only
persistent session. `granete_token` (and the legacy `muebles_token`/`granete_user`/
`muebles_user`) stop being an authority at boot: the migration destroys them
(`DELETE, NEVER SEND`) — never migrates — and a Web session without a valid
refresh cookie requires an explicit re-login by design.

**Short rolling web access.** `WebAccessTokenTTL = 15m`, computed from the MINT
instant (`min(now+15m, auth_sessions.absolute_expires_at)`), never from the
session origin — origin-derived arithmetic would mint already-expired tokens
after minute 15. The absolute bound is structural: every web mint path (login,
org-less login, select-org, invitation accept, cookie refresh) goes through
`IssueTransportTokenUntil`, and an unbounded web mint is a rejected
programming error. Mobile keeps `MobileAccessTokenTTL = 18h` untouched until
SEC-5; both absolute sessions stay T0+18h (`WebSessionAbsoluteTTL` /
`MobileSessionAbsoluteTTL`), and refresh can never slide them — at the
deadline the client purges and shows login.

**Client architecture.** One canonical in-memory authority
(`webAuthRuntime`: web | support | anonymous, monotonic generation for
late-response guards) feeds a single authenticated fetch boundary
(`webAuthClient`): Authorization only for the exact API origin+base (external
URLs never receive the bearer), 401 → coordinated refresh → retry exactly
ONCE only when session id AND organization scope are unchanged — an org
switch or session replacement mid-request aborts the operation as a session
transition instead of replaying it under another tenant. Scheduling uses the
server-clock `access_expires_at` (refresh ≈2 min before expiry) plus
visibility/focus/online wake-ups; no fixed intervals, no refresh storms.

**Cross-tab serialization.** Every cookie rotation, logout and select-org runs
under one exclusive cross-tab mutation lock backed by a REAL mutual-exclusion
primitive: `navigator.locks` when available, otherwise an IndexedDB
transactional mutex — the acquisition is a `get`+`put` pair inside ONE
`readwrite` transaction over a single record, and IndexedDB serializes
overlapping readwrite transactions, so two tabs can never both believe they
hold the lock (a read/write/verify localStorage lease is NOT sufficient and
is not used). The record holds only `{holder: <random tab id>, expiresAt}`
(never tokens or user data); expired records are taken over inside the same
transaction (crash safety) and live locks renew while the mutation runs. If
no safe primitive exists (neither Web Locks nor IndexedDB), the mutation
FAILS CLOSED: it is not executed at all — a cookie rotation never runs
without genuine cross-tab exclusion. Broadcasts carry only `{ type }` signals
(`session-replaced`, `session-ended`, `scope-changed`); tabs resolve their own
state from the cookie via bootstrap, never from a broadcast token. A normal
refresh reloads nothing. Support stays a distinct tab-local memory credential:
entry/exit never touches the Web cookie, a support 401 is never retried under
another credential class, and exit recovers the platform session through
cookie bootstrap.

**Replacement/scope-change ordering.** When a refresh reveals that the cookie
now represents a different session (new sid) or a different scope (same sid,
other user/org — identity is compared across sid + userId + organizationId,
never sid alone), the new credential is NOT installed by the refresh itself.
A transition owner runs first and must, in order: invalidate the old
credential and purge all of the old tenant's business state, and only then
install the new credential, fetch the authoritative `/auth/me` snapshot, and
let the new session become visible/usable. The original request that
triggered the refresh is never retried under the new credential, and the
ordering never depends on the (best-effort) BroadcastChannel signal.

**Failure honesty.** Refresh 5xx/network errors keep the local session (the
cookie survived server-side) with bounded retries; only terminal states
(`REFRESH_INVALID/EXPIRED/REVOKED/REUSED`) end it, each surfaced with its own
UX (expired / revoked / security). CSRF 403 fails closed with an explicit
configuration error. A failed server logout never claims success: the tab
purges immediately (data protection) but exposes a retry affordance and
suppresses cookie bootstrap until the server confirms, so the user's logout
intent cannot be silently undone.

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
the original origin), SEC-4A proofs in
`internal/api/web_refresh_cookie_test.go` (cookie attributes, CSRF boundary,
dispatcher precedence), `internal/config/config_test.go` (production
fail-closed Secure resolution) and `tests/pilotreadiness/web_refresh_cookie_http_test.go`
(real-PostgreSQL HTTP: transport matrix with raw-secret absence in Web JSON,
rotation preserving the absolute bound against a shrunk live registry row,
CSRF denials incl. form-shaped requests, credential mixing, strict replay
revocation, cookie logout + session isolation, log redaction on the happy and
injected-failure paths, exact-origin credentialed CORS), `internal/storage/auth_sessions_test.go` (migration
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

SEC-3 adds `internal/auth/media_test.go` (canonical resource-key grammar, exact
grant claims, disjoint-issuer/audience/typ negatives, expiry), `internal/api/media_authorize_test.go`
(happy path over the full router, exact-resource and same-name cross-partition
binding, tenant omission, expiry with clock-controlled tokens, session/refresh
credential confusion in both directions, query-session-JWT negative proofs on
auth/business/media routes, header-wins precedence, extension POST capability,
fail-closed missing key, cache semantics and log redaction), the web resolver
suite `apps/web/src/stores/mediaAuthorization.test.ts` plus the workspace-store
media tests (batching, dedupe, TTL refresh, token-switch invalidation,
late-response drop, logout cleanup, JWT never in URLs), and the extension suites
`test/unit/media_authorizer_test.rb`, the dialog-controller grant/refresh proofs
and the `grant=` redaction proof in `test/unit/logging_test.rb`.
