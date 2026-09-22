# Issue #815 — DELETE /api/projects/{id} 500 en proyectos con historia

- **Issue**: #815 (status:approved, type:bug, backend, high)
- **Lane**: ODD (multi-capa: grants + triggers + políticas RLS + FKs nieto; migración + storage + pruebas reales)
- **Base**: `main` @ bb04fc7c · **Rama**: `fix/815-project-delete-cascade`
- **Escritor**: implementador (ZCode) · única escritura, sin mezclar WIP ajeno del árbol local

## Causa raíz (corregida contra PostgreSQL real)

`DeleteProject` era un `DELETE FROM projects` desnudo. Los FK cascades se
executan con privilegios del dueño de tabla; **no** fallan porque `granete_app`
tenga `REVOKE DELETE`. Los bloqueos reales fueron los triggers de
inmutabilidad, RLS sobre los DELETE explícitos necesarios para FKs `NO ACTION`,
los FKs `NO ACTION` mismos, y la frontera Store→Factory: el Store no ve bajo
RLS los descendientes de producción privados de Factory.

## Solución implementada

- **Migración 000137** define `delete_project_tree(uuid)` como boundary
  `SECURITY DEFINER` estrecho: `search_path` fijo, `row_security=off`,
  `app_can_write_organization` más ownership Store/Sales del proyecto y sólo
  `EXECUTE` para `granete_app`. No concede DELETE directo cross-org.
- La función materializa referencias media project-owned, activa el guard sólo
  dentro de la transacción, borra los únicos nietos `NO ACTION` necesarios y
  elimina el proyecto; los cascades cubren `design_working_copies`.
- `DeleteProjectWithMediaCleanup` registra los archivos tras `OnCommit`; API
  conserva la responsabilidad `MediaDir`, path/tenant safety, idempotencia y
  logging best-effort.

## Tareas y evidencia

- [x] T1 Test rojo real-PG: primera corrida falló con `permission denied` →
      luego `design_revision_items is immutable` → FK snapshots → convergió.
- [x] T2 Migración 000137 up/down (down verificado por test).
- [x] T3 DeleteProject en tenant tx con guard.
- [x] T4 `project_delete_test.go` 4/4 verde contra PG real:
      familia completa borrada (15 tablas verificadas 0 filas); direct
      deletes bloqueados (6 tablas, mensajes de trigger correctos);
      guard transaccional sin fuga al pool; down+replay restaura postura
      (REVOKE primero, política fuera, replay exacto).
- [x] T5 Verificación completa (HEAD e1f717eb):
      - storage suite serializada completa: ok (234s, incluye los 4 tests nuevos
        y la postura actualizada de furniture_instances).
      - api suite: ok. `go build`/`go vet`: limpios.
      - Foundation Gate A --stage postgres: PASS (236s, contenedor fresco,
        aislamiento multi-org verificado con 000137 aplicada).
      - Nota de infra: 5 tests (hardware/material persist + cross-org) conectan
        directo a la DB `muebles` de DATABASE_URL — en local fallan si no existe
        (en CI la crea el workflow); no son regresiones.
      - CI remoto del HEAD: en curso al congelar; revisión independiente en curso.

## Límites conocidos (documentados, fuera de alcance)

- Cross-org: si la org manufacturera (B) liberó producción, la org vendedora
  (A) no ve esas filas bajo RLS → el delete de A fallará con FK/500. La
  política de producto (409 explícito) es issue aparte.
- Sin audit/outbox nuevo en el DELETE (comportamiento previo preservado).

## Entrega

- Objetivo: complete (Closes #815).

## R2 hardening — in progress

- **Route**: delegated direct; trigger: mapped 4+ affected files and a multi-file
  writer change. **TDD**: enabled by `AGENTS.md`; existing focused real-PG tests
  were red against the first boundary shape (ambiguous/return-type function
  errors), then green after the canonical function and cleanup boundary landed.
- **Delivery strategy**: single PR #816; this correction remains under the
  review-budget forecast and is a single coherent storage/migration/API work unit.
- [x] T6 Replace app-local direct deletion with narrow `SECURITY DEFINER`
  `delete_project_tree(uuid)`: fixed `search_path`, `row_security=off`, actor
  project-authority check, transaction-local trigger guard, and only EXECUTE for
  `granete_app`; removed 000137's generic DELETE grants/policies, including the
  unnecessary `published_assembly_snapshots` surface. `design_working_copies`
  is no longer explicitly deleted because its project/design cascade owns it.
- [x] T7 Collect project photo URLs and publish/revision artifact keys before
  cascade; register API-owned, owner-org/path-safe MediaDir deletion through
  `storage.OnCommit`. Missing files are idempotent; other IO errors log after a
  successful commit and do not alter the response.
- [x] T8 Add real-PG FK lifecycle catalog invariant: all `projects` FKs must be
  CASCADE except explicit SET NULL history (`stock_movements.project_id`,
  `purchase_order_items.allocated_project_id`).
- [x] T9 Focused evidence (local PostgreSQL fresh migration):
  `GOFLAGS=-p=1 go test -parallel=1 ./internal/storage -run 'Test(DeleteProject|ProjectDelete)' -count=1` — PASS (4.03s);
  `go test ./internal/api -run 'Test(DeleteProjectMediaFiles|DeleteMediaFileByURL|RBAC_.*DeleteProject)' -count=1` — PASS (0.52s).
- [ ] T10 Required before claiming complete: explicit Store A → Factory B
  integration fixture, DB rollback callback proof, full `go test ./...`,
  `go vet ./...`, Foundation Gate A, and independent review.

**R2 narrative correction**: FK cascades run as table owner; the real original
barriers were durability triggers, RLS on explicit NO ACTION cleanup, NO ACTION
FKs, and the Store/Factory visibility boundary. The canonical definer boundary
is the sole authorized cross-org deletion path, not a generic app DELETE grant.
- [x] T11 Full backend checks at `7ff89cce`:
  `GOFLAGS=-p=1 go test -parallel=1 ./...` — PASS; `go vet ./...` — PASS.
  Foundation Gate A and real Store→Factory fixture remain pending (T10).

## R2 review correction evidence

- [x] T10 Added real PostgreSQL Store A → Factory B release/engineering/snapshot
  fixture and post-command direct DELETE denial; canonical Store-owned delete
  removes the private Factory family while direct application DELETE stays
  permission-denied.
- [x] T12 Restored `app_can_write_organization` inside the SECURITY DEFINER
  boundary and added a negative non-writable-organization proof.
- [x] T13 Added canonical transaction media proof: references are collected
  before deletion, cleanup executes only after commit, rollback discards hooks
  and retains DB/files, and a missing physical file stays successful.
- [x] T14 Added direct-delete negatives for artifact/hardware/assembly/publish
  families and a real `stock_movements.project_id` SET NULL survival proof.
- [x] T15 Focused fresh-PostgreSQL tests passed before Foundation Gate A:
  `GOFLAGS=-p=1 go test -parallel=1 ./internal/storage -run 'Test(DeleteProject|ProjectDelete)' -count=1` — PASS (8.17s);
  focused API media/RBAC — PASS (0.60s). `go test ./...` and `go vet ./...`
  passed at the pre-correction candidate; `go vet ./...` passed after this
  correction. A subsequent rerun encountered `SQLSTATE 57P01` while the local
  Gate A ephemeral PostgreSQL was terminating; this is NOT a product PASS.
- [ ] T16 Remaining acceptance: catalog hardware/assembly pin-versus-resource
  fixture and `purchase_order_items.allocated_project_id` real SET NULL proof;
  rerun Foundation Gate A and exact-HEAD full suite after the local PostgreSQL
  harness is stable; independent review.

## R3 final correction — in progress

- [x] T17 Direct `DELETE projects` revoked for `granete_app` in 000137 up and
  restored by down; direct manual-GUC delete is covered separately from the
  canonical function.
- [x] T18 Media URL parser is fail-closed: only local absolute
  `/api/media/<single-filename>` paths (optional query) qualify; external,
  scheme-relative, data, nested, and traversal lookalikes cannot clean local
  storage.
- [x] T19 External stock and purchase allocation histories have real SET NULL
  survival fixtures; deployment ownership posture is queried from `pg_proc` /
  `pg_roles`; shared catalog direct deletes remain denied even with a manual
  guard setting.
- [ ] T20 Pending exact-head fresh tests and Gate A, catalog pin/resource
  fixture, and independent review.

## R4 correction evidence

- [x] T21 Direct-delete permission negatives now isolate each deliberate PostgreSQL
  error with a savepoint, preventing `25P02` from hiding a later assertion.
- [x] T22 Stock and purchase-order fixtures now carry valid organization scope
  and assert all preserved external-history fields while only the project link
  becomes NULL.
- [x] T23 R4 hardening keeps the legacy `WithOrgCtx` question scoped to the
  tenant actor boundary: the canonical function requires a writable actor
  installed by `WithinTenantTx`; a bare legacy org scope is not authority and
  must not be upgraded implicitly.
- [ ] T24 Pending real-PG execution in a stable harness, hardware/assembly pin
  fixture, Gate A, exact-head CI, and independent review.

## R5 correction — actor authority and fixture completion

- [x] T25 Route: delegated (four-plus affected files / one writer). A project
  delete now requires a complete `TenantActor` (`organization`, `user`, and
  `membership`) before it opens the tenant transaction. `WithOrgCtx` remains a
  legacy scope helper and is deliberately not DELETE authority; `WithinTenantTx`
  supplies the revalidated writable actor and the database function retains
  `app_can_write_organization`.
- [x] T26 Restored #815-foreign UI bytes from `origin/main`: BoardMesh again
  includes the placement index in the duplicate hardware identity and its test,
  plus ProjectSpatialStudio and its test return to the mainline behavior. This
  is a surgical restoration, not a UI change.
- [x] T27 Added real PostgreSQL catalog rows and project pins for hardware assets
  and assembly snapshots. Canonical deletion removes only both pin families;
  hardware assets/revisions/validations/hardware and agregado/revision/published
  snapshot rows survive. Manual guard direct DELETE is attempted against real
  rows in independent transactions and remains blocked (by table permission or
  referential protection, never by a `WHERE false` no-op).
- [x] T28 Focused fresh migration evidence:
  `GOFLAGS=-p=1 go test -parallel=1 ./internal/storage -run 'TestDeleteProject_(RemovesPinsButPreservesSharedCatalog|ManualGuardNeverAuthorizesSharedCatalogDeletes|RejectsBareOrganizationScope)' -count=1` — PASS (3.19s).
- [ ] T29 Required before delivery complete: exact-head full backend suite, vet,
  Foundation Gate A, remote CI/readback and independent review. PR stays
  `Refs #815` / `Delivery: partial` until those results exist.
- [x] T30 R5 full project-delete storage family rerun after the deployment readiness
  catalog query correction: `GOFLAGS=-p=1 go test -parallel=1 ./internal/storage
  -run 'Test(DeleteProject|ProjectDelete)' -count=1` — PASS (12.78s). The
  readiness query uses `pg_has_role`, which is available on the supported
  PostgreSQL version; no runtime ownership/role assumption is granted.
- [x] T31 The RLS fixture now gives the compatible TenantActor the actual seeded
  membership UUID for its user and organization, rather than a merely shaped
  UUID. Focused bare-scope and pin lifecycle PostgreSQL proof remains PASS
  (2.32s).

## R5 reviewer correction — Split Sales actor proof

- [x] T32 `TestProjectOwnership_SplitSalesAndManufacturing` now seeds real Sales
  and Factory users/memberships and invokes `DeleteProject` only inside
  `WithinTenantTx` with complete actors. The Factory actor remains denied by the
  Store/Sales project boundary; the active Sales actor canonically deletes it.
  Bare `WithOrgCtx` is not used as delete authority.
- [x] T33 Fresh PostgreSQL evidence: `GOFLAGS=-p=1 go test -parallel=1
  ./internal/storage -run TestProjectOwnership -count=1` — PASS (1.37s);
  `GOFLAGS=-p=1 go test -parallel=1 ./internal/storage -run
  'Test(DeleteProject|ProjectDelete)' -count=1` — PASS (12.25s).

## R6 correction — database membership binding

- [x] T34 The SECURITY DEFINER function now binds `app.organization_id`,
  `app.user_id`, and `app.membership_id` to one live `memberships` row with
  `status='active'` before project ownership is evaluated. This prevents forged,
  foreign-organization, and suspended membership GUC tuples from using definer
  authority; it grants neither direct DELETE nor BYPASSRLS.
- [x] T35 The direct Factory project DELETE RLS matrix now asserts the real
  `permission denied` result, rather than treating zero affected rows as the
  product contract. The ownership Split Sales proof remains complete actors.
- [x] T36 Reconciled current PR base `8fc0460f` with normal merge commit
  `a0338d6d`; no rebase or force push.
- [x] T37 Focused fresh PostgreSQL evidence after the migration change:
  `GOFLAGS=-p=1 go test -parallel=1 ./internal/storage -run
  'Test(TenantRLS_SharedProjectSupportPlatformAndOwnershipMatrix|ProjectOwnership|DeleteProject)' -count=1` — PASS (16.53s).
- [ ] T38 Exact-head final verification remains partial: `go vet ./...` — PASS.
  `GOFLAGS=-p=1 go test -parallel=1 ./...` was launched but stalled in the
  shared local harness after non-storage packages; it was stopped rather than
  reported as PASS. `bash scripts/foundation-gate-a.sh --stage postgres` ran
  and failed in `TestWebRefreshCookieLogoutRevokesClearsAndIsolatesSessions`
  when an invitation request returned 401; no #815 product assertion failed in
  the focused R6 suite.

## R7 correction — authenticated HTTP boundary proof

- [x] T39 Reconciled fetched `origin/main` `7b5fc2b3` with normal merge commit
  `0abce315` before this validation.
- [x] T40 Added a real router/PostgreSQL DELETE integration: JWT middleware
  resolves live user/membership/session state, installs the TenantActor through
  its tenant transaction, and an owned Store project reaches the definer
  boundary, returns `200 {"message":"project deleted"}`, and is absent from
  PostgreSQL afterwards. This is not a stub RBAC call.
- [x] T41 Candidate evidence: HTTP integration PASS (1.36s); combined active
  membership/RLS/ownership/project-delete PostgreSQL suite PASS (17.90s).
- [ ] T42 Baseline Gate-A/full-suite comparison remains unproven in this single
  worktree: prior candidate Gate A failed in invitation refresh behavior and
  full suite stalled; it must be reproduced from a clean base or treated as
  unresolved, not called pre-existing. Exact-head full/Gate A/CI remain pending.
