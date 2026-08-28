# Multi-Organization & Distribution Model

- **Product intent:** factories, stores, dealers and service partners operate in
  one continuous commercial-to-operational network.
- **Implemented baseline:** ADR-0005, #325–#327.
- **Target implementation authority:**
  `docs/architecture/organization-foundation-v2.md` and ADR-0006.
- **Program:** #446.

> This document explains the product and business model. It does not replace the
> canonical implementation contract. Sections marked **Implemented today**
> describe the current MVP. Sections marked **Target** describe the ordered
> Organization Foundation v2 program and must not be represented as already
> available.

## 1. Purpose and positioning

Granete must support both an independent workshop and a manufacturer that grows
into a distributed network of stores, dealers and installation/service teams.

The product is not positioned as a cheaper copy of a design tool. Its value is
continuity:

```text
Customer
  → Sales organization
  → Design / approved revision
  → Manufacturing organization
  → Production and quality
  → Shipping
  → Assigned installation organization
  → Closeout and after-sales
```

Each organization sees and changes only the information required by its work.
The network keeps stable identity and exact revisions across the handoffs.

## 2. Core identity model

A user is not a factory, store or dealer. A user belongs to one or more
organizations through memberships.

```text
User
  |
  +-- Membership in Factory A
  |      +-- roles[]
  |      +-- sectors
  |      +-- status
  |
  +-- Membership in Store B
         +-- roles[]
         +-- status
```

The same person may be:

- an administrator in one organization;
- a seller in another;
- a seller + engineer + production operator in a small factory.

The roles and effective permissions of one membership never leak into another.

### Implemented today

- global users;
- memberships scoped to organizations;
- multiple canonical roles per membership;
- live role/organization revalidation;
- organization selector for multi-membership users.

### Target

- explicit account status separate from membership status;
- invitation-first onboarding;
- suspended/left memberships remain visible and auditable;
- race-safe last-administrator protection;
- offboarding, responsibility reassignment, seats and session revocation;
- capabilities that permit sales/production managers to manage only their
  authorized team subset.

Full lifecycle and invariants live in ADR-0006 and #450–#451.

## 3. Organization types

The current contract supports:

```ts
type OrganizationType =
  | 'factory'
  | 'store'
  | 'dealer';
```

The target may add a first-class installation/service partner when #457 needs a
company that is neither a sales store nor a manufacturer. Adding a type requires
updates to:

- role availability;
- relationship capabilities;
- entitlements;
- navigation and UI;
- API/OpenAPI contracts;
- RLS policies;
- readiness tests.

Do not model these distinctions as `user.isFactory` or `user.isStore`.

## 4. Roles and capabilities

Membership roles use the canonical identifiers in `contracts/roles.json`:

```text
admin
user
vendedor
gerente_ventas
gerente_produccion
ingeniero
produccion
almacen
```

Conceptual business language maps to those implemented roles:

| Business concept | Canonical membership role |
|---|---|
| owner / organization administrator | `admin` |
| sales manager | `gerente_ventas` |
| seller | `vendedor` |
| designer / technical engineer | `ingeniero` |
| production manager | `gerente_produccion` |
| plant operator | `produccion` |
| warehouse operator | `almacen` |
| approved member without assigned post | `user` |

An installer role/company remains a deliberate target decision. It must not be
silently mapped to production if its permissions and ownership differ.

Roles produce product capabilities. The server remains authoritative. For
example, a sales manager may manage sellers but must not assign `admin`,
`ingeniero`, `produccion` or `almacen` unless the canonical capability policy
explicitly allows it.

## 5. Factory organization

A factory may own:

- internal sales;
- engineering/design release;
- catalog manufacturing truth;
- materials and procurement;
- production execution;
- quality and costing;
- shipping;
- its own installation team;
- relationships with stores, dealers and external service partners.

An independent pilot factory may act as both sales and manufacturing
organization. The cross-organization split is unnecessary when both owners are
the same organization, but the data model must remain compatible with later
network growth.

## 6. Store and dealer organization

A store or dealer is a commercial organization. Its initial roles are limited
to commercial membership roles by the canonical role policy.

A store may:

- manage its sales team;
- create customers and quotes;
- use factory-published products and options;
- define permitted retail presentation and pricing overlays;
- obtain customer approval;
- submit an exact accepted quote revision to an authorized factory;
- follow a commercial projection of manufacturing status;
- coordinate installation when it is the assigned service organization;
- manage customer-facing change, closeout and after-sales within its authority.

A store must not receive or mutate factory-internal information such as:

- manufacturing cost and margin;
- suppliers and internal stock;
- BOM details beyond an explicitly published commercial contract;
- cut plans, CNC instructions and machining internals;
- internal production notes and operator activity;
- job costing;
- unrelated customers/projects from the factory.

### Implemented today

#327 redacts manufacturing fields when sales and manufacturing organizations
differ and returns 404 from manufacturer-only subresources. This is an important
migration defense.

### Target

The target reduces dependence on a growing field blacklist by creating explicit
sales, manufacturing and installation ownership boundaries and separate DTO
projections. Redaction remains as defense-in-depth during migration.

## 7. Relationship between organizations

### Implemented today

A factory admin can create a store/dealer through the Sales Network settings:

```text
Create child Organization
→ set parent_organization_id
→ clone the factory catalog
→ grant the creator an admin membership
→ switch into the new organization and invite its team
```

This proved organization creation, catalog ownership and multi-membership
switching. It is not the final commercial contract.

### Target: OrganizationRelationship

Collaboration is authorized by an explicit relationship:

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
  status:
    | 'draft'
    | 'invited'
    | 'active'
    | 'suspended'
    | 'terminated';
  capabilities: RelationshipCapability[];
  catalogPolicyId?: string;
  pricePolicyId?: string;
  territoryId?: string;
  termsVersion: number;
  version: number;
}
```

The relationship expresses:

- which organizations are connected;
- the direction and type of collaboration;
- current lifecycle status;
- the exact allowed actions;
- terms and effective dates;
- catalog, price and territory policies;
- audit history.

A relationship never grants general access to the other tenant.

### Critical authorization rule

A seller from Store B does **not** need a membership in Factory A. The seller is
authorized by:

1. active account;
2. active seller membership in Store B;
3. permission to submit the quote;
4. an active Store B ↔ Factory A relationship;
5. the relationship capability for submission/order creation;
6. compatible organization state, entitlement, catalog and price versions.

Knowing a factory UUID without an active relationship authorizes nothing.

`parent_organization_id` becomes migration/compatibility data after #453, not
the runtime authorization source.

## 8. Partner onboarding

The target partner onboarding is a single recoverable workflow:

```text
1. Business identity and organization type
2. Relationship type and capabilities
3. Territory / service scope
4. Published catalog assortment
5. Wholesale and retail price policies
6. Initial administrator and team invitations
7. Installation/service responsibilities
8. Terms and effective dates
9. Review
10. Provision and activate
```

The workflow may be one DB transaction or an idempotent provisioning saga. In
both cases:

- the organization stays `provisioning` until all mandatory steps pass;
- an external failure never returns an active success;
- retries use the same provisioning identity;
- failed provisioning is visible and repairable;
- abandoning the wizard does not create an active orphan;
- each side sees a final summary of the capabilities and information granted.

## 9. Catalog distribution

### Implemented today

A new store receives a cloned catalog with its own `organization_id` rows. This
is safe for initial ownership and workshop independence, but clones diverge and
lose publication provenance.

### Target: publication and subscription

```text
Factory catalog
  → CatalogPublication v1 (immutable)
     → Store subscription
        → permitted commercial overlays

Factory catalog
  → CatalogPublication v2 (immutable)
     → explicit/controlled subscription update
```

A publication contains only the product/options/metadata contract authorized
for the partner. It does not expose manufacturing costs, suppliers, stock or
unnecessary CNC/BOM internals.

Store overlays may control:

- commercial display name and description;
- retail category/order;
- marketing images authorized for use;
- local visibility/availability;
- store-owned retail price policy;
- commercial notes.

Store overlays may not control:

- stable factory product identity;
- manufacturing definition/revision;
- BOM and material constraints;
- drilling/machining truth;
- factory cost;
- production rules.

Every accepted quote/order pins the publication and product revisions used.
Publishing v2 cannot change work pinned to v1.

### Reconciliation of current clones

Existing clones must be compared to a factory baseline and classified as:

- source-equivalent;
- a valid commercial overlay;
- a manufacturing divergence requiring manual resolution;
- orphan/unknown.

Ambiguous differences are never overwritten automatically.

## 10. Pricing model

A distribution network requires three different truths:

```text
FactoryCost
FactoryWholesalePrice
StoreRetailPrice
```

### Factory cost

Factory-private operational truth used for costing and internal decisions.

### Wholesale price and partner policy

The factory publishes or assigns a versioned wholesale price book/policy to the
relationship. It may include tiers, terms, effective dates and discount floors.

### Store retail price

The store owns retail markup, promotions, seller discount limits and customer
presentation. One store's policy never mutates another store or the factory.

### Visibility

| Value | Factory | Store admin/manager | Seller | Installer |
|---|---:|---:|---:|---:|
| Factory cost | internal role policy | no | no | no |
| Wholesale price | yes | according to relationship | according to policy | no |
| Store retail price | only if required by contract | yes | yes | no |
| Store margin | no unless explicitly contracted | yes | according to role | no |
| Factory margin | yes | no | no | no |

A store quote must not calculate retail from an accidentally exposed factory
cost stack. The server resolves pricing from pinned publication and policy
versions.

## 11. Commercial and manufacturing ownership

### Implemented today

Projects expose commercial and manufacturing organization IDs. Store callers
receive a redacted aggregate; manufacturer-only routes remain inaccessible.

### Target boundary

```text
SalesQuote / QuoteRevision
  owner: sales organization
  contains: customer, seller, retail snapshots, customer decision,
            exact published products and stable FurnitureInstance references

ManufacturingOrder
  owner: manufacturing organization
  contains: exact source quote revision, relationship, catalog/price versions,
            manufacturing review and commitment

InstallationOrder assignment
  owner/access: assigned installation organization
  references: existing InstallationJob/visits/issues/punch
```

The same business thread may reference a single Project and the stable
FurnitureInstances defined by Digital Thread #384. Ownership boundaries do not
create duplicate furniture identities.

## 12. Store-to-factory handoff

The target submission is an explicit command:

```text
SubmitQuoteToFactory(
  quoteRevisionId,
  relationshipId,
  expectedVersion,
  Idempotency-Key
)
```

The server validates:

- actor membership and capability in the sales organization;
- relationship and capability;
- exact immutable QuoteRevision;
- CatalogPublication and price-policy snapshots;
- factory readiness and entitlement;
- stable furniture references;
- idempotency and current version.

It creates exactly one `ManufacturingOrder` and durable audit/outbox records.

The factory can:

- review;
- request clarification;
- reject with reason;
- accept;
- schedule;
- share a commercial status projection.

A clarification that changes customer-approved content creates an explicit new
quote/design revision; it does not mutate the previously accepted revision.
Receiving or accepting an order does not automatically create
`ProductionRelease`.

The generic Project update endpoint is not the authority for this handoff.

## 13. Installation ownership

The professional installation domain from #303 remains the single source for:

- InstallationJob;
- visits and crews;
- field issues;
- punch items;
- evidence and sign-off;
- closeout gates.

The target adds an assignment boundary so installation can be executed by:

- the factory;
- the store;
- an authorized installation partner.

An installer accesses the work through a membership in the assigned
organization, not through an artificial membership in the factory. Assignment
creates a purpose-scoped grant for the minimum customer/site/design information
needed to install.

It never grants:

- factory cost/job costing;
- BOM/CNC/cut plans;
- suppliers/stock;
- unrelated customer projects;
- retail/wholesale information unless explicitly required.

Reassignment preserves visits, evidence and actor history. Closeout still obeys
punch/project/warranty gates.

## 14. Visibility principles

| Information | Sales organization | Manufacturing organization | Assigned installer | Platform |
|---|---:|---:|---:|---:|
| Customer and quote | yes | purpose-scoped | assigned-site minimum | metadata only |
| Retail price/margin | yes by role | not by default | no | no |
| Wholesale price | by policy | yes | no | no |
| Factory cost | no | yes by role | no | no |
| Published assortment | yes | yes | relevant install refs | metadata only |
| Internal BOM/cut/CNC | no | yes | no | no |
| Production status | commercial summary | full | schedule-relevant summary | metadata only |
| Installation workflow | relevant project | relevant project | assigned jobs | metadata only |
| Security audit | own authorized scope | own authorized scope | own authorized scope | platform metadata; support-scoped detail |

All serialization and routing are enforced server-side. React navigation and
hidden controls are usability, not authorization.

## 15. Screens and workspaces

### Team / Organization

- active, invited, suspended and seat summaries;
- membership directory and detail;
- role/capability preview;
- sectors;
- sessions;
- transfer admin and offboarding;
- invitation lifecycle;
- organization provisioning/lifecycle;
- human-readable audit.

### Factory Sales Network

- partner summary and action-required;
- partner onboarding and readiness;
- relationships, capabilities and terms;
- catalog publications/subscribers;
- price policies;
- store order review queue;
- installation partners;
- activity/audit and truthful metrics.

### Store / Dealer

- authorized factories;
- subscribed catalog and updates;
- retail policy;
- quote submission and order status;
- clarification actions;
- installation coordination;
- team management.

Screens distinguish loading, empty, no-results, partial failure, stale,
provisioning, suspended, conflict and permission-denied states. Endpoint failure
never appears as an empty network.

## 16. Security and isolation requirements

The distribution model depends on the Organization Foundation contract:

- generated OpenAPI client/DTOs;
- typed errors;
- expected version and idempotency;
- tenant-keyed web server state;
- tenant transaction context and FORCE RLS;
- runtime DB role without `BYPASSRLS`;
- support sessions scoped to one organization;
- revocable finite sessions and privileged MFA/step-up;
- resource-scoped media authorization;
- transactional audit/outbox;
- 404 for unrelated organizations where existence is sensitive.

No relationship, publication or order may introduce a general cross-tenant SQL
or API bypass.

## 17. Implementation program

The approved order is maintained by #446:

```text
#447 docs / ADR
→ #448 generated contract
→ #449 RLS + #450 membership lifecycle + #461 audit foundation
→ #451 safe team administration
→ #452 organization provisioning/lifecycle
→ #458 Web Organization
→ critical #460/#461
→ #462 Gate A
→ #453 relationship
→ #454 catalog publication
→ #455 partner pricing
→ #385/#386 Digital Thread identities after Gate A
→ #456 quote→ManufacturingOrder
→ #457 installation assignment
→ #459 Web Network
→ #462 Gate B
```

#443 remains catalog-local optimistic concurrency and must not absorb the
cross-organization publication model.

## 18. Strategic result

A small factory can begin as one organization acting as its own sales and
manufacturing owner. As it grows, the same identities and workflows support:

```text
Factory A
  ├── Store B
  ├── Dealer C
  ├── Store D
  └── Installation Partner E
```

A store may later work with more than one factory without changing its users or
creating artificial memberships. Every handoff names the exact relationship,
catalog, price and business revision. Each organization preserves its own data
and operational truth while the customer experiences one continuous process.

The Sales Network is production-operable only after the real PostgreSQL/RLS/API/
browser Gate B scenario in #462 passes. A list of child organizations or a
successful UI walkthrough alone is not completion.
