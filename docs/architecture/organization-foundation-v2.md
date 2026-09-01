# Organization Foundation v2 — Identity, Multi-Workshop and Sales Network

- **Status:** Proposed canonical contract
- **Date:** 2026-08-28
- **Program:** #446
- **Architecture issue:** #447
- **Decision record:** `docs/adr/0006-membership-lifecycle-and-organization-relationships.md`
- **Extends:** ADR-0005 and `docs/multi-organization-distribution-model.md`

> This document is the canonical architecture and implementation contract for
> Users, Memberships, Organizations, tenant isolation and the Sales Network.
> It distinguishes **implemented today** from **target required by #446**. Code
> and tests remain the authority for what is already implemented; this document
> is the authority for the ordered target and its invariants.

---

## 1. Why this foundation is P0

Granete already has a valuable multi-organization baseline:

- global `User` identities;
- `Membership` records with multiple roles per organization;
- organization-scoped JWTs;
- live revalidation of user, membership and organization state;
- row-level `organization_id` scoping in Go storage;
- platform administrators separated from workshop business access;
- audited, time-boxed support sessions;
- generated OpenAPI lifecycle contracts and typed errors;
- invitation-first onboarding with explicit account, membership and invitation states;
- PostgreSQL RLS enforced through tenant transactions and a non-owner runtime role;
- sales/manufacturing organization fields and manufacturing payload redaction;
- real PostgreSQL integration and cross-organization isolation tests.

Those decisions remain valid. The remaining program work is concentrated in
organization safety and incomplete cross-organization workflows:

- role changes and suspension do not protect the last active administrator;
- organization creation can leave an active organization without a complete
  catalog or bootstrap administrator;
- `parent_organization_id` describes hierarchy but not a commercial
  relationship with status, capabilities, terms, catalog and price policies;
- a normal store seller currently needs a membership in the factory to select
  it as manufacturer;
- a shared mutable `Project` aggregate is being used as the cross-organization
  boundary for sales, manufacturing and installation.

Adding new persisted business families before correcting this would spread the
same ambiguity into FurnitureInstance, DesignRevision, catalog publishing,
orders and later operational modules. Therefore #446 defines two mandatory
readiness gates before the normal roadmap continues.

---

## 2. Scope and bounded contexts

### 2.1 Identity

Owns:

- global user identity;
- authentication credentials and recovery;
- account-level status;
- sessions/devices and MFA enrollment;
- platform administrator flag.

Does **not** own:

- workshop roles;
- production sectors;
- customer/project portfolio;
- organization type;
- factory/store identity.

### 2.2 Organization Access

Owns:

- memberships;
- membership roles and effective capabilities;
- membership status and offboarding;
- organization-scoped sectors;
- invitations;
- seat enforcement;
- last-administrator invariant.

### 2.3 Organizations

Owns:

- organization identity, type and lifecycle;
- license and entitlements;
- atomic provisioning/readiness;
- organization settings and namespaces;
- suspension, offboarding and termination.

### 2.4 Sales Network

Owns:

- explicit relationships between organizations;
- relationship lifecycle, capabilities, terms and territory;
- factory catalog publications and store subscriptions;
- wholesale and retail price policies;
- cross-organization quote submission and order projections;
- installation-organization assignment.

### 2.5 Existing business contexts

This foundation does not absorb existing domain authorities:

- Sales owns customers, commercial quotes and retail outcome;
- Projects owns `Project` and stable physical `FurnitureInstance` identity per
  the Digital Thread #384;
- Design owns immutable `DesignRevision` snapshots;
- Engineering/Production own manufacturing truth and `ProductionRelease`;
- Installation keeps the visits/issues/punch/closeout model completed in #303;
- security audit does not replace project, stock or floor operational ledgers.

---

## 3. Implemented today vs target

| Concern | Implemented today | Required target |
|---|---|---|
| Identity | Global `users`; `active` boolean | Explicit account status; no workshop approval semantics |
| Workshop access | Active memberships with `roles[]` | Explicit membership lifecycle, version and history |
| Onboarding | Public register + legacy approve; invitations | Invitation-first; atomic accept for new/existing user |
| Team administration | Admin-only routes, direct updates | Capability-based commands, last-admin, offboarding, seats |
| Tenant enforcement | Middleware + scoped Go queries + tests | Same defenses plus tenant transactions and FORCE RLS |
| Organization lifecycle | `active` boolean | provisioning/active/suspended/offboarding/terminated/failed |
| Organization creation | Create + clone + membership as separate steps | Idempotent provisioning with readiness and compensation |
| Sales network | `parent_organization_id` and cloned catalog | `OrganizationRelationship`, publication, subscription, policies |
| Store→factory | Generic Project ownership fields | Immutable quote submission → factory-owned ManufacturingOrder |
| Installation access | Manufacturer-only routes | Explicit assigned installation organization |
| API contract | Manual Go/TS DTOs and casts | Versioned OpenAPI, generated types/client, runtime validation |
| Concurrency | Partial timestamps/BroadcastChannel | ETag/version + If-Match + idempotency commands |
| Audit | Append-only table, critical writes best-effort | Transactional audit/outbox and human-readable read model |
| Web state | Zustand + manual fetch/server snapshots | Tenant-keyed server state; Zustand only for session/local UI |
| Web credential | Bearer JWT persisted client-side | Revocable bounded session with absolute 18-hour lifetime |

Nothing in the target column may be presented as already implemented until its
own issue and readiness gate are complete.

---

## 4. Non-negotiable invariants

### Identity and membership

1. `User` is a global identity, never a factory, store or job title.
2. Business access exists only through an active `Membership` in an active
   `Organization`.
3. Roles and sectors belong to the membership, never to the global user.
4. Account status and membership status are separate dimensions.
5. An organization administrator manages memberships, not arbitrary global
   identities.
6. B2B onboarding is invitation-first.
7. Accepting an invitation to Organization B creates/reactivates only the
   membership in B and enters B directly.
8. Suspending B never disables the user's membership in A.
9. Every active organization has at least one active administrator; the
   invariant is transactionally protected against concurrent changes.

### Tenant isolation

10. Tenant identifiers in request bodies are references to validate, never the
    source of authorization.
11. Cross-organization resource access is indistinguishable from a missing
    resource where existence itself is sensitive.
12. Go authorization and scoped repositories remain mandatory.
13. PostgreSQL RLS is a second barrier; the runtime DB role cannot bypass it.
14. Tenant context is established with `SET LOCAL` inside transactions and
    cannot leak through pool reuse.
15. Every new tenant table is registered in the RLS inventory and direct-SQL
    isolation suite in its first migration.

### Organization lifecycle

16. An organization is not active until provisioning readiness is complete.
17. No API may return an active success while catalog/settings/admin/bootstrap
    steps failed.
18. Create/provision and sensitive commands are idempotent.
19. Suspend/offboard/terminate preserve history and use explicit blockers;
    ordinary lifecycle commands do not hard-delete business data.

### Sales network

20. Cross-organization authorization comes from an active
    `OrganizationRelationship` plus actor capabilities, not from artificial
    memberships in the counterparty.
21. A relationship grants only named capabilities, never general tenant access.
22. Suspending a relationship blocks new operations but does not rewrite or
    delete historical orders.
23. Catalog and price artifacts used by a quote/order are immutable and pinned;
    never resolve accepted work from implicit `latest`.
24. Factory cost, wholesale price and store retail price have different owners
    and visibility rules.
25. Sales, manufacturing and installation do not share one unrestricted mutable
    aggregate.

### API, UI and audit

26. OpenAPI-generated DTOs/client are the Go↔React contract for these surfaces.
27. Behavior is selected by typed error code, not localized message substring.
28. Sensitive writes use expected version and explicit commands.
29. React success appears only after an authoritative commit or a complete
    optimistic mutation with rollback.
30. Every server-state cache key includes organization scope.
31. There are no silent fallbacks from new APIs to legacy APIs.
32. Critical business/security mutation and its audit/outbox record commit
    together.
33. Technical identifiers are English; user-facing copy is Spanish.

---

## 5. Canonical data model

The following shapes express responsibilities. Final SQL/Go/TypeScript names
may vary only if they preserve the same boundaries.

### 5.1 User

```ts
interface User {
  id: string;
  email: string;
  normalizedEmail: string;
  name: string;
  accountStatus: 'active' | 'disabled';
  emailVerifiedAt?: string;
  platformAdmin: boolean;
  lastLoginAt?: string;
  createdAt: string;
  updatedAt: string;
}
```

`User.accountStatus` answers whether the identity can authenticate. It does not
answer which workshop the person can enter.

### 5.2 Membership

```ts
interface Membership {
  id: string;
  organizationId: string;
  userId: string;
  status: 'active' | 'suspended' | 'left';
  roles: UserRole[];
  version: number;
  joinedAt: string;
  suspendedAt?: string;
  suspendedBy?: string;
  suspensionReason?: string;
  leftAt?: string;
  leftBy?: string;
  leaveReason?: string;
}
```

Membership lists include suspended/left records according to authorized
filters. They are not hidden by `WHERE active` and are not represented by the
user account status.

### 5.3 MembershipSector

```ts
interface MembershipSector {
  membershipId: string;
  sector: ProductionSector;
  assignedAt: string;
  assignedBy: string;
}
```

A user's sectors in Factory A do not apply in Factory B. Store/dealer
memberships cannot carry plant sectors.

### 5.4 Invitation

```ts
interface Invitation {
  id: string;
  organizationId: string;
  normalizedEmail: string;
  roles: UserRole[];
  status:
    | 'pending'
    | 'delivered'
    | 'opened'
    | 'accepted'
    | 'expired'
    | 'revoked';
  tokenHash: string;
  expiresAt: string;
  invitedBy: string;
  acceptedBy?: string;
  acceptedAt?: string;
  revokedBy?: string;
  revokedAt?: string;
  revokedReason?: string;
  version: number;
}
```

A raw token is returned/delivered once. Resend rotates it and invalidates the
previous token. Accept is transactional and idempotent.

### 5.5 Organization

```ts
interface Organization {
  id: string;
  slug: string;
  name: string;
  type: 'factory' | 'store' | 'dealer' | 'installation_partner';
  status:
    | 'provisioning'
    | 'active'
    | 'suspended'
    | 'offboarding'
    | 'terminated'
    | 'provisioning_failed';
  licensePlan: LicensePlan;
  version: number;
  createdAt: string;
  updatedAt: string;
}
```

`installation_partner` may be activated when #457 needs a first-class company
rather than forcing it into store/dealer semantics. Adding the type requires
contract and role-policy updates, never an ad-hoc UI flag.

### 5.6 OrganizationEntitlements

```ts
interface OrganizationEntitlements {
  organizationId: string;
  maxActiveMembers: number;
  maxSalesPartners: number;
  sketchupSeats: number;
  manufacturingEnabled: boolean;
  salesNetworkEnabled: boolean;
  advancedAuditEnabled: boolean;
  version: number;
}
```

Entitlements are enforced on the server. UI displays the resulting limits but
is not the gate.

### 5.7 OrganizationRelationship

```ts
interface OrganizationRelationship {
  id: string;
  sourceOrganizationId: string;
  targetOrganizationId: string;
  type:
    | 'sales_channel'
    | 'manufacturer'
    | 'installation_partner'
    | 'service_partner';
  status: 'draft' | 'invited' | 'active' | 'suspended' | 'terminated';
  capabilities: RelationshipCapability[];
  catalogPolicyId?: string;
  pricePolicyId?: string;
  territoryId?: string;
  validFrom: string;
  validTo?: string;
  termsVersion: number;
  version: number;
}
```

`parent_organization_id` is a migration aid only after #453. It cannot remain
the authorization source.

### 5.8 CatalogPublication and subscription

```ts
interface CatalogPublication {
  id: string;
  factoryOrganizationId: string;
  version: number;
  status: 'draft' | 'published' | 'retired';
  sourceFingerprint: string;
  manifest: CatalogPublicationManifest;
  publishedAt?: string;
  publishedBy?: string;
}

interface StoreCatalogSubscription {
  id: string;
  relationshipId: string;
  storeOrganizationId: string;
  factoryOrganizationId: string;
  status: 'active' | 'suspended' | 'ended';
  currentPublicationId: string;
  updatePolicy: 'manual' | 'auto_non_breaking';
  version: number;
}
```

Published versions are immutable. Store commercial overlays are separate rows
and cannot mutate factory manufacturing definitions.

### 5.9 Price ownership

```text
FactoryCost             factory-private
FactoryPriceBook        wholesale terms exposed by relationship policy
StoreRetailPricePolicy  store-owned retail rules
QuoteRevisionSnapshot   resolved immutable wholesale + retail snapshots
```

A store must not receive the factory cost stack merely to calculate retail.

### 5.10 Cross-organization work

```ts
interface ManufacturingOrder {
  id: string;
  projectId: string;
  salesOrganizationId: string;
  manufacturingOrganizationId: string;
  relationshipId: string;
  sourceQuoteRevisionId: string;
  catalogPublicationId: string;
  catalogPublicationVersion: number;
  pricePolicyVersion: number;
  furnitureInstanceIds: string[];
  status: ManufacturingOrderStatus;
  version: number;
}
```

The Sales organization owns the customer-facing quote. The factory owns the
ManufacturingOrder and manufacturing subresources. Both may reference the same
Project/FurnitureInstances according to #384, without sharing unrestricted
write authority.

```ts
interface InstallationOrder {
  id: string;
  projectId: string;
  manufacturingOrderId: string;
  salesOrganizationId: string;
  manufacturingOrganizationId: string;
  assignedInstallationOrganizationId: string;
  relationshipId: string;
  installationJobId: string;
  status: InstallationOrderStatus;
  version: number;
}
```

The operational `InstallationJob`, visits, issues and punch items remain the
single implementation from #303. This boundary determines who is assigned and
which purpose-scoped data that organization may access.

---

## 6. Lifecycle machines

### Membership

```text
active ──suspend──> suspended ──reactivate──> active
   └────leave─────> left
```

`left` is historical and normally not reactivated without a new explicit
membership/invitation decision.

### Invitation

```text
pending → delivered → opened → accepted
   │          │          ├────→ expired
   └──────────┴──────────┴────→ revoked
```

Providers may not support delivered/opened initially. Missing telemetry stays
missing; the API does not label every historical record as pending.

### Organization

```text
provisioning → active
      │          ├→ suspended → active
      │          └→ offboarding → terminated
      └→ provisioning_failed → provisioning | terminated
```

### Relationship

```text
draft → invited → active ↔ suspended → terminated
```

Termination is not deletion and cannot silently retarget historical work.

### ManufacturingOrder

```text
submitted → factory_review
factory_review → clarification_required → resubmitted → factory_review
factory_review → accepted | rejected
accepted → scheduled → in_production → ready_to_ship → completed
```

These states do not replace Project stage, ProductionRelease or floor execution.

---

## 7. Authorization model

Every sensitive decision receives an actor context built by the server:

```ts
interface ActorContext {
  userId: string;
  sessionId: string;
  membershipId?: string;
  organizationId?: string;
  roles: UserRole[];
  capabilities: string[];
  supportSessionId?: string;
  platformAdmin: boolean;
}
```

### Organization-local action

Authorization requires:

1. active account;
2. active organization;
3. active membership in that organization;
4. required effective capability;
5. resource ownership/scope;
6. lifecycle and expected-version gates.

### Cross-organization action

Authorization requires all local conditions plus:

1. active relationship;
2. required relationship capability;
3. compatible organization types/status/entitlements;
4. resource bound to that exact relationship/organizations;
5. purpose-specific projection or data grant.

A seller in Store B never receives an artificial membership in Factory A merely
to submit an authorized quote.

### Team-management capabilities

Initial policy:

- admin manages all permitted organization roles;
- sales manager manages sales members only;
- production manager manages production/warehouse members and sectors only;
- no manager can assign admin or roles outside the managed capability set;
- support sessions preserve the real platform actor.

React may use capabilities to present controls, but Go remains the authority.

---

## 8. Tenant transactions and PostgreSQL RLS

### 8.1 Table classification

Every table belongs to one class:

1. tenant-owned;
2. explicitly shared by two/more organizations;
3. platform-global;
4. append-only ledger/audit with its own policy.

A policy inventory is versioned and checked by CI. A new table without a class
and policy fails the gate.

### 8.2 Runtime transaction context

Business transactions set local values from revalidated claims/service
commands:

```sql
SET LOCAL app.organization_id = '<uuid>';
SET LOCAL app.user_id = '<uuid>';
SET LOCAL app.membership_id = '<uuid>';
SET LOCAL app.support_session_id = '<uuid-or-empty>';
```

The app role:

- does not own protected tables;
- does not have `BYPASSRLS`;
- cannot disable row security;
- is separate from the migration role.

### 8.3 Policies

Tenant-owned rows compare the current tenant in both `USING` and `WITH CHECK`.
Shared rows use explicit sales/manufacturing/assigned organization fields or a
validated relationship binding. Platform access does not become an RLS bypass;
support creates one scoped actor context.

### 8.4 No initial-organization fallback

`InitialOrganizationID` may exist only in migration fixtures or explicit legacy
tooling. HTTP/runtime storage operations without organization scope fail loud.

### 8.5 Required tests

- A→B and B→A API operations;
- direct SQL under the app role;
- missing-filter repository mutation;
- pooled connection reuse;
- upsert/conflict targets;
- support/platform behavior;
- shared-resource policies;
- policy inventory and role attributes.

---

## 9. API and command contract

OpenAPI is the source for organization-foundation DTOs and the TypeScript
client. Public contracts avoid `map[string]interface{}`.

### Error envelope

```json
{
  "code": "LAST_ADMIN",
  "message": "La organización debe conservar al menos un administrador activo.",
  "fieldErrors": {},
  "requestId": "req_...",
  "retryable": false,
  "details": {}
}
```

UI behavior uses `code`; `message` is localized presentation.

### Concurrency

Mutable resources expose `version`/ETag. Writes supply `If-Match` or the
canonical equivalent. A stale mutation returns a typed conflict and never
silently overwrites.

### Idempotency

Critical creates/commands require `Idempotency-Key`, including:

- invitation create/resend/accept;
- organization provisioning;
- relationship proposal/accept;
- catalog publish/apply;
- price-book publish;
- quote submission;
- ManufacturingOrder/InstallationOrder creation.

Same key + same command returns the same result. Same key + different payload
returns `IDEMPOTENCY_CONFLICT`.

### Commands instead of generic aggregate PUT

Sensitive transitions use explicit commands, such as:

```text
ChangeMembershipRoles
SuspendMembership
TransferOrganizationAdmin
ProvisionOrganization
SuspendOrganization
ProposeRelationship
PublishCatalog
SubmitQuoteToFactory
AcceptManufacturingOrder
AssignInstallationOrganization
```

A generic `PUT Project` cannot change organization ownership, manufacture an
order submission or overwrite hidden manufacturing fields.

---

## 10. Transaction boundaries and durable events

The application-service layer owns transactions and orchestration. HTTP
handlers parse/authenticate/map errors; storage persists; React does not repeat
business rules.

Critical mutation and audit/outbox commit together:

```text
BEGIN
  validate/lock current state
  apply domain transition
  persist resource/version
  append audit/outbox record
COMMIT
```

Workers are at-least-once and idempotent. External media/email jobs use outbox
or a provisioning saga. They do not require distributed transactions, and an
external failure cannot make an organization appear active prematurely.

### Race-sensitive invariants

Use explicit locks/constraints/version checks for:

- last active administrator;
- invitation accept/replay;
- slug reservation;
- organization/relationship state;
- catalog/price version sequence;
- one ManufacturingOrder per submission key;
- installation assignment/reassignment.

---

## 11. Visibility contract

| Information | Store | Factory | Assigned installer | Platform console |
|---|---:|---:|---:|---:|
| Customer/quote commercial data | yes | purpose-scoped | assigned-site minimum | metadata only |
| Store retail price/margin | yes by role | no unless contract says so | no | no |
| Wholesale price | by policy | yes | no | no |
| Factory cost/margin | no | yes by role | no | no |
| Catalog published assortment | yes | yes | only relevant install refs | metadata only |
| Internal BOM/cut/CNC | no | yes | no | no |
| Production commercial status | summary | full/internal | schedule-relevant summary | metadata only |
| Job costing/suppliers/stock | no | yes by role | no | no |
| Installation visits/issues/punch | relevant project | relevant project | assigned jobs | metadata only |
| Security audit | own authorized scope | own authorized scope | own authorized scope | platform metadata; support scoped detail |

Redaction is server-side with positive/negative serialization tests. Hiding a
field or route only in React is never authorization.

---

## 12. React architecture and UX contract

### 12.1 Generated client

Team, Organization, Platform and Network screens do not issue ad-hoc `fetch`
requests or cast arbitrary JSON. A shared adapter handles auth, request IDs,
typed errors, runtime validation and session expiry.

### 12.2 Server state

Remote data uses tenant-keyed query state, for example:

```text
['organization', organizationId, 'memberships', filters]
['organization', organizationId, 'relationships', filters]
['organization', organizationId, 'manufacturing-orders', filters]
```

Zustand remains appropriate for session state, local UI state and editor
drafts. It is not the authoritative cache for remote organization lists.

Switching organization:

- checks unsaved drafts;
- exchanges/changes session scope;
- removes or isolates old-tenant caches, stores and media URLs;
- recomputes roles/capabilities/navigation;
- navigates to a valid route;
- follows an explicit multi-tab policy.

### 12.3 Honest async states

Screens distinguish:

- loading;
- stale/refetching;
- empty;
- no search results;
- partial endpoint failure;
- permission denied;
- provisioning/syncing;
- suspended;
- conflict;
- offline/retry.

An endpoint failure never becomes an empty list. A new endpoint failure never
triggers a legacy fallback.

### 12.4 Team UX

The final Team workspace includes:

- active/invited/suspended/seat summaries;
- paginated/filterable membership directory;
- account and membership status separately;
- member detail drawer;
- effective permission preview;
- scoped role/sector editor;
- session revoke;
- transfer-admin and offboarding flows;
- invitation state/resend/revoke/copy handling;
- audit timeline.

### 12.5 Sales Network UX

The Network workspace includes:

- partner onboarding/readiness wizard;
- relationships, terms and capabilities;
- catalog publish/subscription/diff;
- wholesale/retail policy;
- quote submission and factory review queue;
- shared commercial order timeline;
- installation assignment;
- actual/provenance-aware metrics.

---

## 13. Session and security contract

The 18-hour workday decision from #441/#445 remains absolute:

```text
absoluteSessionExpiresAt = issuedAt + 18 hours
```

Technical access-token rotation may reduce exposure but cannot extend the
absolute lifetime. Target web architecture uses revocable server sessions,
short-lived access in memory and a protected rotating credential, with CSRF
controls and refresh-reuse detection. Mobile and SketchUp use client-specific
credentials and secure storage/device registration.

**Implemented through SEC-2A; SEC-2B implemented pending review (ADR-0007 / #460):** the
`auth_sessions` registry is the live revocation, absolute-lifetime AND
current-scope authority behind ver5 tokens (sid, typ, iss/aud per client,
sub==user_id, exp/nbf/iat, jti, kid keyring, exact HS256): revocation cuts
unexpired JWTs immediately, a token only validates while its scope equals the
session's current scope (so a select-org switch invalidates the previous
scope's bearers at once), and membership/user/organization coherence is
enforced in PostgreSQL. Ver4 acceptance is transitional and ends at the SEC-9
gate. Web/mobile sessions receive hash-only opaque refresh families with
single-use atomic rotation, strict concurrent-reuse revocation, non-sliding
absolute expiry and real server-side logout. Generated, bounded directories and
exact revocation now exist for self, organization and platform. Organization
administration requires live `team:revoke_sessions` through fixed-search-path
command functions while auth session/family RLS remains self-or-platform; an
exact or membership-wide revoke commits session, family, credential epoch and
critical audit coherently. Support-session business lifecycle remains separate.
Login, refresh, logout and all session-directory responses are no-store; directory
routes reject query tokens. The generic `?token=<session JWT>` authentication
is removed entirely (SEC-3): session credentials only travel as Authorization
headers, and media reads that need direct URLs use `media_read` grants —
short-lived (3 minutes), signed with the dedicated `MEDIA_SIGNING_KEY`, bound
to one exact canonical media file of one organization, minted only after the
live session/org authorization via `POST /api/media:authorize`, and capped at
the session's absolute expiry. React resolves them through a token-scoped
in-memory cache; SketchUp webviews never see the extension credential (Ruby
exchanges it for per-file URLs and re-mints on expiry). The Web refresh
credential now travels exclusively as the HttpOnly `granete_web_refresh`
cookie (SEC-4A): `HttpOnly; SameSite=Strict; Path=/api/auth`, host-only,
`Secure` in production (fail-closed boot under `GRANETE_ENV=production`),
bounded by the session's absolute expiry, rotated through the same SEC-2A
family with strict reuse detection, and guarded by the CSRF boundary
(exact allowed `Origin` + required `X-Granete-CSRF: 1` header) with
exact-origin credentialed CORS. Web login/refresh/invitation responses carry
no refresh secret in JSON; mobile keeps the body contract; SketchUp/support
keep the bodyless bearer bridge, now transport-restricted. The React cutover
(in-memory access, cookie bootstrap, cross-tab refresh serialization, removal
of the `granete_token` localStorage bearer — one explicit re-login for stale
Web sessions) is SEC-4B, together with the short Web access-token TTL.
MFA/step-up and trusted-proxy rate limiting remain target work of the
following #460 slices.

Mandatory hardening:

- exact JWT algorithm, issuer, audience, token type and session ID;
- key rotation with `kid`;
- MFA/step-up for platform support and sensitive administrator commands;
- resource-scoped signed media access instead of generic session JWT in query;
- trusted-proxy policy and abuse-resistant rate limiting;
- hashed/single-use recovery/invitation credentials;
- immediate session revocation on membership/organization changes.

---

## 14. Audit and observability

Critical audit is durable, structured and append-only. It records actor,
membership, organization, target, relationship, resource, before/after
allowlisted changes, reason, request/trace IDs and support session.

It never records passwords, bearer/refresh tokens, raw invitation tokens or
unbounded customer payloads.

Human read models render known events as sentences instead of raw UUID/JSON.
Unknown schema versions use a safe fallback.

Required observability:

- request and trace correlation UI→API→DB→outbox;
- auth/RLS/last-admin/invitation metrics;
- provisioning and relationship/order metrics;
- DB pool, slow query and outbox lag metrics;
- separate liveness and readiness;
- readiness verifies DB, migration version, RLS inventory/app role, outbox and
  required storage/config;
- alerts/runbooks for provisioning failure, RLS anomalies, support misuse,
  outbox dead letters and backup/pilot-gate failure.

---

## 15. Migration strategy

Migration must be staged, observable, backwards-safe and finite. Compatibility
bridges have an explicit removal slice; they are not permanent fallbacks.

### Stage A — contract and inventory

- merge this document and ADR-0006;
- introduce OpenAPI/error/version/idempotency contract;
- inventory tenant tables, queries, legacy endpoints and UI callers;
- add upgrade fixture based on current multi-org schema.

### Stage B — tenant barrier

- add runtime/migration DB roles;
- introduce tenant transaction runner;
- enable/force RLS by classified batches;
- remove runtime InitialOrganization fallback;
- prove API + direct-SQL isolation.

### Stage C — identity and organization lifecycle

- add membership/invitation states and versions;
- migrate current active/inactive facts without inventing memberships;
- replace registration/approval with invitation-first;
- add last-admin/offboarding/seat/session commands;
- add organization status/provisioning/readiness;
- migrate Team/Platform React to generated APIs;
- remove `/api/admin/users/*` workshop callers/routes/storage bridges.

### Gate A

Run #462 Foundation Readiness from fresh DB and upgrade fixture. No new
persisted business family proceeds before this gate.

### Stage D — relationship and catalog/pricing

- backfill valid parent links to explicit relationships;
- reconcile cloned catalogs against a publication baseline;
- classify local differences as valid overlay, source-equivalent, conflict or
  orphan; never overwrite ambiguity;
- publish/subscription and price policy become authority;
- deprecate parent/clone runtime authority.

### Stage E — cross-organization work

- create ManufacturingOrder from exact QuoteRevision submission;
- migrate historical cross-org Projects only where events support an honest
  state; otherwise report manual reconciliation;
- add InstallationOrder ownership around existing #303 workflow;
- remove generic Project ownership/handoff writes.

### Gate B

Run full Network Readiness scenario. Only after it passes may Red de Ventas be
called production-operable.

---

## 16. Program order and dependencies

| Slice | Issue | Responsibility |
|---|---:|---|
| Docs | #447 | Canonical contract and ADR |
| API | #448 | Generated contract/errors/version/idempotency |
| Tenant | #449 | Tenant transactions and RLS |
| Identity | #450 | Membership/invitation lifecycle |
| Team | #451 | Last admin/offboarding/seats/sectors |
| Organization | #452 | Lifecycle and provisioning |
| Web foundation | #458 | Session/Team/Platform tenant-safe UX |
| Security | #460 | Bounded sessions/MFA/media/auth |
| Operations | #461 | Audit/outbox/observability |
| Gate A/B | #462 | Executable readiness gates |
| Relationship | #453 | OrganizationRelationship |
| Catalog network | #454 | Publication/subscription/overlay |
| Pricing | #455 | Wholesale/retail policies |
| Handoff | #456 | QuoteRevision → ManufacturingOrder |
| Installation | #457 | Cross-org assignment |
| Web network | #459 | Network operational UX |

#443 remains catalog-local concurrency and consumes #448/#449. #384 remains the
Digital Thread authority; #385/#386 start after Gate A and feed #456.

---

## 17. Required E2E proof

### Gate A

At minimum prove:

- new and existing-user invitation acceptance;
- membership suspension/reactivation across multiple organizations;
- role delegation and no privilege escalation;
- concurrent last-admin protection;
- offboarding blockers/reassignment;
- seat enforcement;
- API and direct-SQL RLS isolation;
- pool-context isolation;
- platform/support boundaries;
- provisioning failure at every step and idempotent retry;
- tenant-safe organization switching in browser/multiple tabs;
- no legacy Team fallback;
- absolute 18-hour session bound and revocation;
- critical audit rollback/outbox behavior.

### Gate B

```text
Provision Factory A
→ provision Store B + active relationship
→ publish Catalog v1 + Price Policy v1
→ invite Seller S into Store B
→ create accepted QuoteRevision pinned to v1
→ submit to Factory A without Seller membership in A
→ exactly one ManufacturingOrder despite retry/double-click
→ clarification and explicit resubmission
→ factory accept/schedule
→ publish v2 without changing v1 work
→ verify Store cannot read BOM/cost/CNC/internal notes
→ assign InstallationOrder to Partner C
→ installer accesses only assigned work
→ reuse #303 visits/issues/punch/closeout
→ suspend relationship and block new submissions without deleting history
```

Both gates use real PostgreSQL, migrations, app role/RLS, real Go router,
outbox/projections and browser E2E. Gate mode never skips because a dependency is
missing.

---

## 18. Definition of Done

The program is complete only when:

- all child issues in #446 are closed by their full DoD;
- ADR/doc/code/OpenAPI/migrations/tests/feature ledger agree;
- Team no longer calls `/api/admin/users/*` or falls back silently;
- global registration/approval no longer assigns workshop access;
- membership history, last admin, offboarding, seats and sessions are proven;
- FORCE RLS protects every tenant table and direct SQL tests pass;
- organization provisioning cannot produce active partial state;
- relationship, publication and price policies are versioned and authoritative;
- a store seller submits to a factory without factory membership;
- SalesQuote, ManufacturingOrder and InstallationOrder have explicit ownership
  and projections;
- React state is tenant-keyed and reports honest commit/conflict/error states;
- critical audit is durable and human-readable;
- Gate A and Gate B are mandatory in CI/deployment;
- no bridge remains with a promise to remove it later.

---

## 19. Rejected anti-patterns

Do not implement:

- `user.companyId`, `user.isFactory`, `user.isStore`;
- global workshop roles on User;
- public registration interpreted as a request to the initial workshop;
- a hidden legacy fallback after a new endpoint fails;
- organization active with failed bootstrap steps;
- last-admin checks outside a transaction;
- tenant authorization from body `organizationId`;
- app runtime DB role with `BYPASSRLS`;
- `SET` tenant context outside transaction/pool-safe boundaries;
- relationship authorization based on every seller joining the factory;
- mutable catalog clone overwrite as a publication mechanism;
- one `marginFactor` for factory cost, wholesale and retail;
- implicit `latest` catalog/price/design/release resolution;
- generic Project PUT as cross-org submission;
- installation permanently restricted to manufacturer organization;
- React casts as proof that backend DTOs match;
- best-effort audit for security-critical mutations;
- success toast before server commit;
- E2E gate that skips when PostgreSQL/browser/RLS is unavailable.
