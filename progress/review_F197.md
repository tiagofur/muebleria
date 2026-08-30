# Review — feature F197

**Veredicto:** CHANGES_REQUESTED

**Implementation head revisado:** `1327c4f85261a6d8862162bd49bdbb8ab42af350`

## Checkpoints

- C1: [x] Harness completo; `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS=-p=1 ./init.sh` terminó con exit code 0 contra PostgreSQL fresco.
- C2: [x] F197 es la única feature `in_progress` y `progress/current.md` describe el trabajo activo.
- C3: [ ] La autoridad de lifecycle y el provisioning Factory no respetan todavía la frontera PostgreSQL/RLS requerida; ver cambios 1 y 2.
- C4: [ ] Las suites existentes pasan, pero falta prueba ejecutable del caller Factory real bajo runtime role y la prueba directa de lifecycle cubre tablas de negocio, no `organizations`.
- C5: [ ] Cierre pendiente de correcciones y nueva revisión independiente; no corresponde cerrar ledger/history con este veredicto.

## Diseño UI/UX

- D1: [x] Los estados nuevos reutilizan variables CSS del design system.
- D2: [x] La UI mínima conserva los patrones existentes de Platform y Settings sin invadir #458.
- D3: [x] Los cambios reutilizan el componente `Modal`; no agregan un modal paralelo.
- D4: [x] El éxito se comunica sólo después de `status=active` y `readiness.ready`.
- D5: [x] Se mantiene Lucide React; no se introducen iconos ad hoc.
- D6: [x] No se agregan animaciones nuevas.
- D7: [x] Los estados no activos son visibles y la entrada queda deshabilitada con explicación.
- D8: [x] Copy en español, controles etiquetados y feedback de error persistente.

## Evidencia ejecutada

- `pnpm openapi:check` y el gate completo de TypeScript pasan dentro de `./init.sh`.
- `go test ./...` pasa dentro de `./init.sh` con PostgreSQL fresco y ejecución serial.
- `scripts/pilot-gate.sh --fresh-container` pasa completo, sin skips.
- Ruby 3.2.11: 201 runs / 1853 assertions; contrato: 3 runs / 1043 assertions; RBZ verificado.
- PR #485 apunta únicamente a `feat/452-organization-lifecycle-provisioning` (tracker #484), tiene `type:feature` + `size:exception`, y el implementation head está pushed (`origin/feat/452-lifecycle-implementation@1327c4f8`).

## Cambios requeridos

1. **[P0] El caller Factory no puede completar el provisioning bajo el runtime role.** `ProvisionOrganization` conserva como actor a la organización fábrica (`backend-go/internal/application/organizations.go:155-178`), pero `CreateOrganization` sólo autoriza el nuevo tenant cuando el actor es org-less (`backend-go/internal/storage/organizations.go:117-123`). En PostgreSQL fresco, con un actor factory real, el `INSERT` del child fue exitoso pero el siguiente `UPDATE organization_entitlements` afectó **0 filas** por RLS; `UpdateOrganizationEntitlementsVersion` lo convierte en `ErrVersionConflict` (`backend-go/internal/storage/organizations.go:1331-1352`). Por lo tanto el flujo que consume `SalesNetworkSection` nunca alcanza settings/admin/catalog/readiness. Corregir la autorización acotada del child sin ampliar el scope y añadir un test HTTP + PostgreSQL con runtime app role que pruebe Factory success, rollback y replay.

2. **[P0][security] El runtime role puede mutar `organizations.status` directamente y eludir command, audit, reason e `If-Match`.** La migración protege writes de tablas tenant mediante `app_can_write_organization` (`backend-go/db/migration/000100_organization_lifecycle_foundations.up.sql:52-144`), pero no aplica RLS ni revoca `UPDATE` sobre `organizations`. La prueba directa existente sólo intenta mutar `customers` (`backend-go/internal/storage/organization_lifecycle_migration_test.go:222-272`). En PostgreSQL fresco, un login `IN ROLE granete_app` con contexto tenant ejecutó `UPDATE organizations SET status='suspended', credential_version=credential_version+1 ...` y obtuvo **UPDATE 1**. Cerrar ese bypass con privilegios/policy compatibles con Platform/CLI y añadir negativos directos para UPDATE de la propia y otra organización, incluido status/version/epoch, además del positivo por el command autoritativo.

3. **[P3] `git diff --check` no está verde.** Reporta `backend-go/db/migration/000101_remove_organization_active.up.sql:3: new blank line at EOF`; corregir antes de la re-revisión para que la evidencia declarada coincida con el head publicado.
