# Multi Organization & Distribution Model

## Purpose

Muebleria must support not only individual factories, but also factories that operate sales networks with stores, dealers and distributed teams.

The product positioning is not to be a cheaper alternative to existing design tools. The goal is to become the ideal operational platform for small and medium furniture manufacturers by connecting sales, design, production and installation.

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

Muebleria should enable a factory to grow from a single operation into a complete furniture network:

```
Customer
  -> Store
  -> Factory
  -> Production
  -> Installation
  -> After Sales
```

The system should preserve one source of truth while allowing each team to see only the information required for their work.
