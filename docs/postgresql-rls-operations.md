# PostgreSQL RLS operations

Issue #449 makes PostgreSQL row-level security a mandatory second barrier behind
authentication, live membership checks, capabilities, ownership, and repository
scope. The runtime process fails startup if its role or policy inventory is unsafe.

## Data classification

Migration `000094_tenant_rls` installs `rls_policy_inventory`, the executable and
complete inventory of every public base table. Startup fails when a new table is
not classified.

| Classification | Rule | Current examples |
|---|---|---|
| `tenant-owned` | Exact transaction organization; writes use the same check | customers, catalog, production, stock, warranties |
| `explicitly-shared` | Access derives from an explicitly shared parent or named project organization | projects and project children |
| `platform-global` | No tenant row policy; runtime access is explicitly restricted | schema migrations and the inventory itself |
| `append-only` | Tenant-readable and insertable; runtime cannot update or delete | security audit, stock movements, structure revisions |

Run this for the per-table matrix and rationale:

```sql
SELECT table_name, classification, read_scope, write_scope, rationale
FROM rls_policy_inventory ORDER BY table_name;
```

`projects` is the only current cross-organization aggregate: its owner, sales,
and manufacturing organizations can read it. Deletes remain owner/sales-only and
a trigger prevents generic updates from changing those ownership columns. Shared
children retain the primary project organization as immutable ownership; named
sales/manufacturing organizations gain visibility, not authority to attribute a
row to a third tenant or retarget its parent. Catalog
clone authorizes its source and destination explicitly inside one transaction.

## Roles and deployment

Use different credentials:

- `MIGRATION_DATABASE_URL`: schema owner/migrator; never used to serve HTTP.
- `DATABASE_URL`: direct `granete_app` login; no superuser, `BYPASSRLS`, role or
  database creation, replication, or protected-table ownership.

Fresh Compose databases create the login with
`scripts/postgres-init-app-role.sh`. Existing volumes must be upgraded before the
new backend starts:

```bash
docker compose exec -e APP_DATABASE_PASSWORD='generated-secret' postgres \
  /docker-entrypoint-initdb.d/010-app-role.sh
```

Back up first. Rotate the runtime password with `ALTER ROLE granete_app PASSWORD
'...'`, update `APP_DATABASE_PASSWORD`, and restart the backend. Never give the
runtime role membership in the migration role. Readiness recursively inspects
role memberships and fails if `SET ROLE` could reach a privileged role or a
protected-table owner.

## Transaction contract

Authenticated HTTP work runs in one PostgreSQL transaction. After live user,
membership, organization, and support-session validation, the middleware applies
transaction-local settings:

- `app.organization_id`
- `app.user_id`
- `app.membership_id`
- `app.support_session_id`
- `app.authorized_organization_ids` for an explicitly authorized cross-org command

`SET LOCAL` state disappears on commit or rollback and cannot contaminate a pooled
connection. An absent organization is fail-closed; there is no runtime initial-
organization fallback. Public invitation lookup is an exact-token,
`SECURITY DEFINER` function and acceptance enters tenant scope before mutation.

Migration `000095_identity_membership_lifecycle` replaces the mutable
`users.active` and `memberships.active` authorities with explicit account and
membership states. It also versions the inventory entries for `users`,
`memberships`, and `invitations`. Public acceptance can lock only the invitation
identified by the supplied token hash; the function fixes `search_path`, exposes
no hash/list surface, and grants only `EXECUTE` to `granete_app`. Identity lookup
then serializes on normalized email before User creation, so concurrent
organization invitations cannot create duplicate global identities.

## Verification and monitoring

```bash
scripts/pilot-gate.sh --fresh-container
```

The gate runs direct, unfiltered SQL with a real non-privileged login and the API
pilot suite. It covers two tenants, reads, update/delete, malicious upsert,
rollback, pooled-connection reuse, shared projects, support scope, and attempted
`row_security=off`. PostgreSQL permits a normal role to request `off`, but the
subsequent protected query fails because the role cannot bypass forced RLS.

Every SQLSTATE `42501` observed by the API increments `rls_denial_total` and emits
a structured warning with only operation, SQLSTATE, request ID, and counter. It
does not log tenant IDs, row values, tokens, or SQL parameters. Investigate a
spike by request ID; keep cross-org client responses generic/404 according to the
endpoint contract and never expose policy text.

Startup readiness verifies direct-login identity, role attributes, ownership,
inventory coverage, `ENABLE/FORCE RLS`, policies, and organization-first indexes.

## Staged rollout and rollback

1. Take and verify a restorable backup.
2. Provision/rotate `granete_app` without elevated attributes.
3. Run migration `000094` with the migration credential.
4. Run the pilot gate against the upgraded database.
5. Start the backend with separate runtime and migration DSNs; readiness must pass.
6. Monitor authorization denials and application 5xx before expanding traffic.

Rollback stops the backend first, uses the migration credential, runs
`000094_tenant_rls.down.sql`, and restores the previous application release. The
down migration removes only #449 policies/functions/indexes and runtime grants,
preserves unrelated RLS objects, and intentionally keeps the externally managed
login. Rollback is an emergency compatibility path,
not permission to continue multi-tenant production without the barrier.

For `000095`, take a restorable backup and stop application traffic before
rollback. Its down migration refuses to collapse `left`, `delivered`, or
`opened` history into legacy booleans/timestamps. Reconcile those rows explicitly
or restore the backup; never bypass the guard by deleting lifecycle history.

## Coordination boundaries

- #450 owns the complete account/membership/invitation lifecycle.
- #451 owns Team and last-admin workflows.
- #452 owns full organization provisioning.
- #456 owns future relationship authorization; #449 only supports already
  explicit project organizations and bounded catalog clone scope.
- #461 owns the durable audit/outbox expansion; #449 preserves current append-only
  audit behavior and makes idempotency receipts tenant/actor scoped.
