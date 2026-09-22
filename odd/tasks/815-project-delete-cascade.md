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
