# Review — feature F197

**Veredicto:** CHANGES_REQUESTED

**Implementation head revisado:** `ec01057065c361d0ff4026f0530de858d11b1570`

## Checkpoints

- C1: [x] `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS='-p=1 -parallel=1' ./init.sh` terminó con exit code 0 contra PostgreSQL 16 aislado.
- C2: [x] F197 es la única feature `in_progress` y el tracker integra el alcance de #452 sobre `main@d85d6fd2`.
- C3: [ ] Las funciones `SECURITY DEFINER` no identifican el runtime role que el propio harness y Pilot Readiness declaran válido; permiten saltar autorización y no ejecutan el camino real de Platform.
- C4: [ ] Las suites pasan, pero los positivos PostgreSQL usan un login heredero de `granete_app` que accidentalmente evita todas las comprobaciones `runtime_caller`; falta prueba negativa de invocación directa y prueba HTTP de lifecycle Platform con la autorización SQL realmente activa.
- C5: [ ] No corresponde cerrar F197 mientras exista un bypass P0 en la frontera autoritativa.

## Diseño UI/UX

- D1: [x] Variables CSS del design system usadas, sin valores visuales ad hoc nuevos.
- D2: [x] La UI mínima conserva los patrones existentes de Platform y Settings.
- D3: [x] Se reutiliza el componente `Modal` existente.
- D4: [x] El éxito se presenta después de `active` más readiness.
- D5: [x] Se mantiene Lucide React.
- D6: [x] No se agregan animaciones nuevas.
- D7: [x] Se recorrió `docs/design.md` §8; lifecycle no activo no se presenta como empty state.
- D8: [x] Copy, foco y controles conservan los contratos existentes de accesibilidad.

## Evidencia ejecutada

- Remote readback: tracker y `origin/feat/452-organization-lifecycle-provisioning` apuntaban a `ec010570`; no había commits locales ni archivos sin commit antes de este reporte.
- PR #484 estaba draft, mergeable y con seis checks GitHub `SUCCESS`, incluyendo Go, TypeScript, harness y Ruby en los tres sistemas operativos.
- `git diff --check d85d6fd2..ec010570` pasó.
- Suite enfocada PostgreSQL: migrations, lifecycle, RLS y Factory rollback/retry/replay pasaron en PostgreSQL 16 aislado.
- Harness completo `./init.sh`: TypeScript, Go, Ruby 3.2.11 (241/2230), contrato Ruby (3/1029), Rubocop y RBZ pasaron.
- Prueba directa adicional: un login `review_runtime ... IN ROLE granete_app`, sin platform admin ni tenant context, obtuvo `pg_has_role(...)=true` y creó `unauthorized-org` con status `provisioning` mediante `command_create_organization`.
- Control de compatibilidad: al conectar exactamente como `granete_app`, un platform admin con el contexto que construye `OrganizationService.transition` recibió `ERROR: organization lifecycle transition is not authorized`.

## Revisión de correcciones anteriores

- [x] El runtime role ya no puede ejecutar `INSERT`, `UPDATE` ni `DELETE` directo sobre `organizations`.
- [x] Factory rollback, retry y replay materializan un único child cuando se ejecutan con el fixture actual.
- [x] `provisioning_failed -> terminated` y sus timestamps tienen prueba ejecutable.
- [x] `git diff --check` quedó limpio.
- [ ] El cierre de DML directo quedó reemplazado por un bypass equivalente a través de funciones privilegiadas; por eso la corrección de autoridad no está completa.

## Cambios requeridos

1. **[P0][security] Los comandos privilegiados omiten autorización para todos los runtime logins heredados.** `runtime_caller` sólo reconoce `session_user = 'granete_app'` o un `SET ROLE` explícito (`backend-go/db/migration/000100_organization_lifecycle_foundations.up.sql:111-112,166-167,202-203`), pero los fixtures y el gate crean un login directo y le otorgan membresía en `granete_app` (`backend-go/internal/storage/tenant_rls_test.go:78-80`; `backend-go/tests/pilotreadiness/fixture_test.go:351-369`). Con `INHERIT`, ese login puede ejecutar las tres funciones concedidas a `granete_app`, queda clasificado como no-runtime y salta por completo los bloques de actor/platform/factory. La reproducción creó una fábrica arbitraria sin platform admin, membership ni parent. Hacé que la autorización se aplique a toda identidad runtime admitida por `VerifyRLSReadiness`, sin volver a clasificar al owner/superuser como runtime, y agregá negativos directos para create, metadata y transition bajo el login heredado real.

2. **[P0] El lifecycle Platform sólo funciona hoy porque el fixture salta la autorización anterior.** El SQL admite al platform admin únicamente con `app.organization_id IS NULL` (`000100...up.sql:218-223`), pero suspend/reactivate/offboarding/terminate reemplazan el contexto org-less del token por `TenantActor{OrganizationID: cmd.OrganizationID}` (`backend-go/internal/application/organizations.go:306,380,419`). Con la autorización activa y una conexión exacta `granete_app`, el command devuelve SQLSTATE `42501`. Alineá el contexto transaccional del servicio con la política SQL y añadí un test HTTP + PostgreSQL que pruebe Platform suspend/reactivate/offboarding/terminate con el runtime login realmente soportado; el positivo actual de `organization_lifecycle_migration_test.go:331-340` no sirve porque usa el login heredado que evita el bloque.
