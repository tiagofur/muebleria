# Multi Organization & Distribution Model

## Purpose

Granete must support not only individual factories, but also factories that operate sales networks with stores, dealers and distributed teams.

The product positioning is not to be a cheaper alternative to existing design tools. The goal is to become the ideal operational platform for small and medium furniture manufacturers by connecting sales, design, production and installation.

Implementation decisions for this model (row-level tenancy, multi-role
memberships, platform admin support sessions, per-organization catalogs and
licenses) live in
[`docs/adr/0005-multi-organization-tenancy.md`](adr/0005-multi-organization-tenancy.md).

## Core Concept

A user is not a factory or a store. A user belongs to one or more organizations through memberships.

The base model is:

```
Organization
  |
  +-- Membership
          |
          +-- User
          +-- Role
```

## Organization Types

The initial supported types are:

```ts
type OrganizationType =
  | "factory"
  | "store"
  | "dealer";
```

Future types may include installer companies or service partners.

## Roles

Roles belong to memberships, not users.

```ts
type OrganizationRole =
  | "owner"
  | "admin"
  | "sales_manager"
  | "sales"
  | "designer"
  | "production_manager"
  | "installer";
```

Role availability depends on organization type.

### Implemented roles (ADR-0005)

The implemented system keeps the 8 canonical operational roles (OC-004) as the
membership roles — `OrganizationRole` above stays conceptual and maps onto them:

| Conceptual role | Implemented membership role |
|---|---|
| owner | `admin` (first membership of an organization) |
| admin | `admin` |
| sales_manager | `gerente_ventas` |
| sales | `vendedor` |
| designer | `ingeniero` |
| production_manager | `gerente_produccion` |
| installer | future (`installer` is not a canonical role yet) |
| — | `produccion`, `almacen`, `user` (sector operators / no post) |

Memberships carry a **set** of roles (`roles[]`); effective permissions are the
union. This supports small workshops where one person covers several areas
(e.g. `vendedor` + `ingeniero`) while sensitive combinations remain an explicit
admin decision. Roles are validated against `contracts/roles.json` with TS ↔ Go
parity.

Pilot talleres are organizations of type `factory` that act as their own sales
organization. Platform staff (`users.platform_admin`) are not a membership role:
they manage organizations from the platform console and may open audited,
time-boxed support sessions into an organization (see ADR-0005 §5).

## Factory Organization

Factories can manage:

- production teams;
- designers;
- internal sales teams;
- installation teams;
- connected stores and dealers.

Example:

```
Factory
 |
 +-- Store Guadalajara
 |
 +-- Store Monterrey
 |
 +-- Production Team
```

## Store / Dealer Organization

Stores represent commercial teams that sell furniture produced by factories.

Allowed roles:

- owner;
- admin;
- sales_manager;
- sales;
- installer.

Stores should not access factory internal data such as:

- production planning;
- suppliers;
- manufacturing costs;
- CNC information;
- internal BOM details.

**Enforcement (server-side, #327 hardening).** When `sales_organization_id ≠
manufacturing_organization_id`, the project aggregate payload served to the
sales organization redacts the manufacturing-internal fields (`engineering_log`,
`cut_plan`, `part_instances`, `module_units`, `production_release`,
`materials_release`, `nesting_import`, floor events and the installation job);
their PUTs restore the stored copy so a round-trip cannot wipe them either.
Organization ownership is assigned once at create — validated against the
caller's active memberships, and the manufacturing organization must be of
type `factory` — and is immutable through the generic update endpoint.
Sub-resource endpoints keep their own RBAC gates: store/dealer organizations
cannot hold production roles, so production/warehouse routes fail closed.

## Factory and Store Relationship

A factory can create and manage connected stores.

Initial flow:

```
Factory Admin
    |
    +-- Create Store
            |
            +-- Invite users
            +-- Assign allowed roles
```

Future flow:

```
Store requests dealership
        |
Factory approves
```

## Project Ownership

Projects need commercial ownership and manufacturing ownership separated.

Example:

```
Project
 |
 +-- Manufacturing Organization: Factory
 |
 +-- Sales Organization: Store
 |
 +-- Created By: Sales User
```

A store can create and sell projects, but the factory controls production execution.

## Permissions Principles

Sales users can:

- create customers;
- create proposals;
- design projects;
- submit approvals.

Factory users can:

- approve production;
- generate BOM;
- manage manufacturing;
- control installation;
- analyze real costs.

## Screens Required

Future administration areas:

- Organization Settings;
- Sales Network;
- Stores and Dealers;
- Invitations;
- Team Members;
- Role Management.

## Architecture Requirements

Avoid:

```ts
user.companyId
user.isFactory
user.isStore
```

Prefer:

```ts
User
Membership
Organization
Role
```

This allows future growth into franchises, multiple factories, external installers and enterprise groups.

## Strategic Goal

Granete should enable a factory to grow from a single operation into a complete furniture network:

```
Customer
  -> Store
  -> Factory
  -> Production
  -> Installation
  -> After Sales
```

The system should preserve one source of truth while allowing each team to see only the information required for their work.
