# ADR-0006 — Explicit membership lifecycle, relationship-based authorization and organization foundation gates

- **Status:** Proposed
- **Date:** 2026-08-28
- **Decision owners:** Product + Engineering
- **Tracking:** #446, #447
- **Extends:** ADR-0005
- **Canonical detail:** `docs/architecture/organization-foundation-v2.md`

## Context

ADR-0005 established the correct baseline for Granete:

- shared row-level tenancy;
- global users and organization memberships;
- multiple roles per membership;
- organization-scoped JWTs;
- licenses per organization;
- a platform administrator separated from workshop business data;
- audited support sessions;
- cloned catalogs for initial workshop provisioning.

The implementation and hardening work in #325–#327, #421/#422 and F179/F182
proved that multiple organizations can coexist in one installation. A later
review found that the model is not yet complete enough to be the foundation of
all future persisted features:

- account and workshop membership state are conflated;
- public registration and legacy approval still assume an initial workshop;
- team management can hide suspended memberships and lacks last-admin safety;
- organization provisioning can finish partially while returning success;
- `parent_organization_id` is used as a sales-network substitute;
- store→factory authorization depends on individual memberships in both
  organizations;
- PostgreSQL RLS is still deferred;
- Go and React contracts drift because DTOs are maintained manually;
- a shared mutable Project payload is being used as a cross-organization
  workflow boundary.

The Digital Thread #384 and future catalog/order tables would inherit these
ambiguities if implemented first.

## Decision

Granete adopts **Organization Foundation v2** with the following decisions.

### 1. User identity and organization access are separate lifecycles

`User` is a global identity with an account-level status. It does not carry a
factory/store flag or workshop job title.

`Membership` is the only source of workshop access and has an explicit
lifecycle:

```text
active | suspended | left
```

Roles, sectors, membership version and offboarding history belong to the
membership. Suspending membership A never disables membership B or the global
identity.

### 2. B2B onboarding is invitation-first

Organization access is created through an `Invitation` scoped to an
organization and allowed roles. Accepting an invitation:

- creates or reuses the global user;
- creates/reactivates exactly one organization membership;
- marks the invitation accepted;
- returns a session scoped to the invited organization;
- commits atomically and idempotently.

Workshop administrators no longer approve, reject or delete arbitrary global
users. The legacy InitialOrganization approval bridge is removed.

### 3. Active organizations always retain an active administrator

Role change, membership suspension/leave and organization lifecycle commands
share a race-safe transaction gate:

```text
active organization ⇒ at least one active membership containing admin
```

Administration transfer is an explicit command. A check performed only in UI
or before the transaction is insufficient.

### 4. Organization lifecycle and provisioning are explicit

Organization state becomes:

```text
provisioning | active | suspended | offboarding | terminated | provisioning_failed
```

Provisioning includes bootstrap membership, settings/entitlements, catalog
strategy, namespaces and audit/outbox. It is transactional when DB-only and a
recoverable idempotent saga when external work is required.

An API never returns an active `201` while required steps failed. Async
provisioning returns `202` and activates only after readiness succeeds.

### 5. PostgreSQL RLS is required defense-in-depth

ADR-0005's deferred RLS becomes a required Foundation Gate deliverable.

Every table is classified as:

- tenant-owned;
- explicitly shared;
- platform-global;
- append-only ledger/audit.

Business transactions set tenant context with `SET LOCAL`. The runtime DB role
is separate from the migration role, does not own protected tables and does not
have `BYPASSRLS`. Protected tables use `ENABLE` and `FORCE ROW LEVEL SECURITY`.

Go authorization/scoped storage/tests remain mandatory. RLS is the second
barrier, not a replacement.

### 6. OrganizationRelationship authorizes collaboration

Factories, stores, dealers and installation/service partners collaborate through
an explicit `OrganizationRelationship` containing:

- source and target organizations;
- relationship type;
- lifecycle status;
- named capabilities;
- terms/version/vigency;
- catalog, price and territory policy references.

A relationship never grants general access to the counterparty tenant. A store
seller acts through the store membership and active relationship; the seller
does not need an artificial membership in the factory.

`parent_organization_id` becomes migration/compatibility data and is removed as
runtime authorization authority.

### 7. Catalog and pricing exchange are immutable and versioned

Factory assortment is shared through immutable `CatalogPublication` versions
and store subscriptions. Store commercial overlays are separate and cannot
mutate factory manufacturing truth.

Pricing separates:

```text
FactoryCost
FactoryWholesalePrice / PartnerPricePolicy
StoreRetailPricePolicy
```

Accepted quote/order revisions pin exact catalog and price versions. No accepted
work resolves from implicit `latest`.

Catalog-local per-entity persistence and optimistic concurrency remain the scope
of #443. Cross-organization publication/subscription remains the scope of #454.

### 8. Sales, manufacturing and installation use explicit ownership boundaries

The target boundary is:

```text
SalesQuote / QuoteRevision       owned by the sales organization
ManufacturingOrder              owned by the manufacturing organization
InstallationOrder assignment    owned/accessed by the assigned service organization
```

These objects reference the same Project/FurnitureInstance/Design identities
where defined by #384; they do not create parallel furniture identities.

A quote is submitted through an idempotent command that validates relationship,
publication, price and exact revision. It does not mutate organization ownership
through generic Project PUT. Receiving an order does not automatically create a
ProductionRelease.

The Installation workflow completed in #303 remains the operational truth.
`InstallationOrder` or an equivalent assignment boundary determines which
organization may execute it and what purpose-scoped data is exposed.

### 9. OpenAPI-generated contracts are mandatory for these surfaces

A versioned OpenAPI specification is the authority for Go/TypeScript DTOs and
the React client. The shared contract includes:

- structured error codes;
- request IDs;
- resource version/ETag and `If-Match`;
- `Idempotency-Key` semantics;
- session/client distinctions.

React may not use unchecked `res.json() as Type` as the boundary proof, and
business behavior may not depend on localized message substrings.

### 10. Critical audit is durable

Security/business-critical mutation and its audit/outbox record commit in the
same transaction. Best-effort audit is insufficient for:

- membership/role/admin/session changes;
- organization/relationship/license changes;
- catalog/price publications;
- quote/order/installation assignment decisions;
- support-session actions.

The read model is typed, paginated and human-readable. Secrets and unrestricted
customer payloads are excluded by schema allowlists.

### 11. Web sessions remain finite

The absolute 18-hour session lifetime decided in #441/#445 remains in force.
Any access-token rotation or protected refresh mechanism must not extend the
absolute expiry. Sessions become server-side revocable, client-type specific and
MFA/step-up capable for privileged actions.

### 12. Two executable gates control implementation order

#### Gate A — Organization Foundation Readiness

Before any new persisted business family, including DT-1 #385:

- generated contract;
- tenant transaction/RLS;
- membership/invitation lifecycle;
- safe team administration;
- organization provisioning/lifecycle;
- tenant-safe Team/Platform web state;
- critical session/audit foundations;
- real PostgreSQL + browser E2E.

Discovery and documentation may continue before Gate A; schema/API
implementation may not.

#### Gate B — Sales Network Readiness

Before Red de Ventas is production-operable:

- relationship authorization;
- catalog publication/subscription;
- partner price policy;
- quote→ManufacturingOrder handoff;
- installation organization assignment;
- complete web workflow;
- security/observability and real end-to-end proof.

## Alternatives considered

### Keep the current model and patch each bug

Rejected. The defects share missing lifecycle, relationship, transaction and
contract boundaries. Local patches would preserve parallel APIs and require
repeated data migrations.

### Put organization type and role on User

Rejected. It prevents multi-membership and creates global privilege leakage.

### Require every store user to join the factory

Rejected. Membership expresses employment/access inside an organization;
commercial authorization belongs to the relationship between organizations.

### Keep cloned catalogs as the permanent network model

Rejected. Clones diverge without provenance, make updates destructive and
cannot pin quotes to an authoritative publication.

### Keep a single mutable Project aggregate for every organization

Rejected. Blacklist redaction becomes fragile as fields grow, and generic PUT
cannot safely express cross-organization state transitions.

### Rely on Go queries and tests without RLS

Rejected. Tests are necessary but do not stop a newly introduced unscoped query
at runtime. RLS supplies independent defense-in-depth.

### Database/schema per organization

Rejected for the current scale. ADR-0005 shared row-level tenancy remains
appropriate; this ADR strengthens it rather than changing deployment topology.

### Sliding refresh with indefinite sessions

Rejected. It contradicts #441. Technical rotation must preserve the absolute
18-hour lifetime.

## Consequences

### Positive

- Future tables inherit a secure tenant contract from their first migration.
- Team administration becomes reversible, auditable and safe under concurrency.
- Organization provisioning cannot produce active partial tenants.
- Stores can sell for factories without fake user memberships.
- Catalog/pricing/order history becomes versioned and explainable.
- Factory, store and installer see only the data required for their role.
- React and Go share one executable contract.
- Security audit and readiness become operational tools, not raw JSON logs.

### Costs and risks

- RLS and explicit transactions increase migration/query complexity.
- The current register/admin-user bridges require a finite compatibility
  migration and cleanup.
- Existing cloned catalogs require reconciliation; ambiguous divergence cannot
  be auto-overwritten.
- Splitting cross-organization ownership requires transition adapters around the
  current Project model.
- More explicit states/commands increase initial implementation work.
- Gate A deliberately delays new persistent Digital Thread tables.

These costs are accepted because correcting them after FurnitureInstance,
DesignRevision, publications and orders exist would be more expensive and risky.

## Migration and compatibility rules

1. Existing memberships backfill to explicit status without changing roles.
2. Inactive users without membership/invitation are reported; they are not
   assigned automatically to the initial organization.
3. `/api/admin/users/*` workshop callers and InitialOrganization approval are
   removed after the new Team API/UI is live; no silent fallback remains.
4. Current parent links are backfilled to relationships only when evidence is
   valid; invalid/cyclic cases require manual resolution.
5. Current catalog clones are compared to a factory publication baseline and
   classified as equivalent, valid overlay, conflict or orphan.
6. Historical cross-org Projects become ManufacturingOrders only where events
   support an honest state; no migration invents acceptance/submission facts.
7. Existing InstallationJobs default to the manufacturing organization because
   that is the implemented current behavior; other owners require explicit
   assignment.
8. Compatibility columns/routes have an issue and removal criterion. “Later” is
   not a valid permanence strategy.

## Verification

The decision is complete only when #462 demonstrates:

- fresh and upgrade migrations;
- API and direct-SQL RLS isolation;
- last-admin race safety;
- invitation replay/concurrency;
- provisioning failure injection/idempotent recovery;
- tenant-safe browser switching;
- store seller without factory membership;
- exact catalog/price/revision pinning;
- store/factory/installer serialization boundaries;
- outbox retry without duplicate effects;
- absence of legacy runtime paths.

## Supersession

This ADR **extends**, rather than replaces, ADR-0005. ADR-0005 remains the
record for choosing shared row-level tenancy, memberships, organization licenses
and support sessions. Where ADR-0005 describes RLS as future or a simple
parent/cloned-catalog network as sufficient, ADR-0006 is the newer authority.
