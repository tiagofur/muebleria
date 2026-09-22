# Issue #815 — DELETE /api/projects/{id} 500 en proyectos con historia

- **Issue**: #815 (status:approved, type:bug, backend, high)
- **Lane**: ODD (multi-capa: grants + triggers + políticas RLS + FKs nieto; migración + storage + pruebas reales)
- **Base**: `main` @ bb04fc7c · **Rama**: `fix/815-project-delete-cascade`
- **Escritor**: implementador (ZCode) · única escritura, sin mezclar WIP ajeno del árbol local

## Causa raíz (capas confirmadas empíricamente contra PostgreSQL real)

`DeleteProject` era un `DELETE FROM projects` desnudo; el cascade chocaba:

1. **REVOKE DELETE a granete_app** en las hijas (el cascade corre con los
   privilegios de quien borra): furniture_instances (000111), designs
   (000113), design_revisions + items (000113), design_publish_sessions
   (000114), quote_revisions + items (000115), production_releases (000119),
   manufacturing snapshots (000122), release engineering (000134).
2. **Triggers de inmutabilidad absolutos en DELETE** (11 funciones):
   protect_quote_revision_immutability (000130), protect_design_revision_
   immutability (000129), protect_release_engineering_transitions (000134),
   protect_release_manufacturing_snapshot_immutability (000122),
   protect_production_release_immutability (000119),
   protect_design_revision_artifact_immutability (000114),
   protect_design_revision_item_immutability (000113),
   protect_quote_revision_item_immutability (000128),
   protect_agregado_assembly_immutability (000135, familia assembly),
   protect_hardware_asset_row_immutability (000131, design_revision_
   hardware_assets).
3. **Sin política RLS FOR DELETE** en toda la familia: un DELETE bajo RLS sin
   política aplicable borra 0 filas silenciosamente (production_releases/
   snapshots/engineering no tenían nada; el resto sólo SELECT/INSERT/UPDATE).
4. **FKs nieto NO ACTION**: design_publish_sessions y design_working_copies →
   design_revisions; production_releases → quote/design revisions;
   snapshots/engineering → releases.

## Solución implementada

- **Migración 000137** (up/down simétricos):
  - Las funciones de inmutabilidad permiten DELETE **solo** con el guard
    transaccional `app.allow_project_cascade_delete = 'on'`
    (`current_setting(..., true) IS DISTINCT FROM 'on'` — ojo trampa NULL:
    `<> 'on'` con NULL no dispara el RAISE). UPDATE sigue absoluto.
  - Trigger genérico `protect_project_scoped_delete_guard` en las tablas cuya
    única barrera era el REVOKE: furniture_instances, designs,
    design_publish_sessions.
  - GRANT DELETE + CREATE POLICY *_delete (espejo del scope read:
    app_can_access_project / owner-org) en las 14 tablas de la familia.
  - rls_policy_inventory: rationale + policy_version bump en las 14.
- **Storage `DeleteProject`**: `runInTenantTxErr` + `set_config` transaccional
  del guard + borrado explícito de los nietos NO ACTION en orden
  (design_publish_sessions → design_working_copies → snapshots → engineering →
  production_releases) + `DELETE FROM projects` (el cascade hace el resto).
  El guard muere con el commit (pool-safe).
- Handler sin cambios de contrato.

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
