# Review — feature F192

**Veredicto:** CHANGES_REQUESTED

## Checkpoints
- C1: [x] Harness completo; `./init.sh` termina verde con Ruby 3.2.11 desde los shims de rbenv.
- C2: [ ] `progress/current.md` todavía mezcla F192 con sesiones anteriores; debe quedar coherente al cerrar la corrección.
- C3: [x] Los cambios permanecen en backend/storage y no introducen violaciones de boundaries TS.
- C4: [x] `./init.sh` y `scripts/pilot-gate.sh --fresh-container` pasan; las pruebas nuevas usan PostgreSQL real con rol runtime no propietario.
- C5: [ ] F192 sigue `in_progress`, no tiene entrada de cierre en `progress/history.md` y `progress/current.md` no está limpio; corresponde mantenerlo así hasta resolver los hallazgos y repetir review.

## Diseño UI/UX (si aplica)
- No aplica: el diff no modifica UI/UX.

## Cambios requeridos
1. **P0 — Las policies de hijos compartidos permiten escribir datos a nombre de una tercera organización.** En `backend-go/db/migration/000094_tenant_rls.up.sql:299-351`, `WITH CHECK (organization_id = app_current_organization_id() OR app_can_access_project(project_id))` acepta, por ejemplo, que Org A inserte/actualice un `project_item`, `project_item_choice`, `quote_snapshot` o `snapshot_price` con `organization_id = Org C` siempre que el `project_id` nuevo sea visible para A. Luego C puede leer la fila por la primera rama de la policy. Eso viola la matriz explícita y el requisito de que A no pueda afectar registros de C. Vincular el ownership del hijo a las organizaciones nombradas por el parent, impedir retargeting genérico de `organization_id`/parent y agregar negative proofs direct-SQL para insert y update hacia una tercera org.
2. **P0 — Un support token de Org A puede mutar sesiones de Org B del mismo operador.** `backend-go/db/migration/000094_tenant_rls.up.sql:389-391` autoriza UPDATE sólo por `platform_admin_user_id`; no exige `id = app_current_support_session_id()` ni `organization_id = app_current_organization_id()` cuando el actor ya está dentro de una sesión. Un repository sin WHERE podría cerrar o modificar todas las sesiones del operador, cruzando organizaciones. Separar el command org-less de plataforma del actor support-scoped, proteger como inmutables actor/organization y limitar el token de soporte a su sesión/organización. Añadir prueba A→B de UPDATE, no sólo prueba de lectura de customers.
3. **P1 — Readiness no detecta membresías de rol que habilitan un bypass equivalente.** `backend-go/internal/storage/rls_readiness.go:11-43` revisa atributos y ownership sólo de `current_user`. Un login runtime con atributos seguros pero miembro del rol migrator/owner pasa el check y puede ejecutar `SET ROLE` hacia ese rol. Validar la clausura de `pg_auth_members` (permitiendo únicamente parents runtime igualmente seguros) y probar que una membresía en owner/migrator hace fallar startup/readiness y no permite bypass.
4. **P1 — El down migration no revierte de forma acotada lo que agrega el up.** `backend-go/db/migration/000094_tenant_rls.down.sql:6-20` deshabilita RLS en toda tabla `public` que lo tenga, incluso una policy ajena a #449, mientras que sólo elimina `idx_api_idempotency_receipts_org_actor` y deja los otros índices creados en `000094_tenant_rls.up.sql:123-147`. Hacer el rollback table-scoped, eliminar los índices propios y añadir un test de round-trip de `000094` aislado que compare policies, FORCE/ENABLE, grants, columnas e índices antes/después.

## Evidencia ejecutada

- `RBENV_VERSION=3.2.11 PATH="$(rbenv root)/shims:$PATH" ./init.sh` — PASS.
- `scripts/pilot-gate.sh --fresh-container` — PASS, incluido SQL/RLS runtime, API y backup/restore.
- `git diff --check origin/main...HEAD` — PASS.
- Rama `codex/449-tenant-rls` limpia y commit `252ba9b` presente en `origin/codex/449-tenant-rls`.
