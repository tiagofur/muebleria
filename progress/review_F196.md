# Review — feature F196

**Veredicto:** CHANGES_REQUESTED

## Checkpoints
- C1: [x] El harness y las suites base terminan verdes en `7a7e59d9`; el router completo ya no entra en panic.
- C2: [x] Existe una sola feature `in_progress` y `progress/current.md` describe F196.
- C3: [ ] `membership_sectors` permite que el runtime role escriba sectores inválidos o incompatibles con el tipo de organización y los roles.
- C4: [ ] Faltan pruebas HTTP/PostgreSQL integradas de los commands nuevos y un negative proof directo de sector compatibility; los tests unitarios separados no cubren ese wiring.
- C5: [ ] La rama está cuatro commits adelante de `origin/codex/451-safe-team-administration`; F196 debe permanecer `in_progress` hasta corregir, push y CI readback.

## Diseño UI/UX
- D1: [x] Los estilos nuevos usan tokens del design system.
- D2: [x] La pantalla conserva el patrón de tabla simple existente.
- D3: [x] Reutiliza el `Modal` común con focus trap, Escape y retorno de foco.
- D4: [x] Los toasts mantienen el comportamiento del sistema.
- D5: [x] Los iconos nuevos son Lucide con `strokeWidth={1.5}`.
- D6: [x] No introduce animaciones nuevas fuera del sistema.
- D7: [x] La carga del directorio quedó independiente de invitaciones y las acciones se ocultan por capability y role set de destino.
- D8: [x] El copy corregido usa sentence case y los controles nuevos conservan labels accesibles.

## Cambios requeridos

1. **[P1] Cerrar sector compatibility también en la frontera PostgreSQL.** `backend-go/db/migration/000097_membership_sectors.up.sql:24-34` acepta cualquier `TEXT` y `:61` concede `INSERT/UPDATE` al runtime role. Con `SET LOCAL ROLE granete_app` y tenant context válidos, una membership `admin` de una organización `store` aceptó `sector='totally_invalid_sector'` (`INSERT 0 1`). El control de `backend-go/internal/storage/team_commands.go:246-276` sólo protege el método Go y puede evadirse por SQL directo; también una actualización directa de roles puede conservar sectores residuales incompatibles. Agregar constraints/trigger race-safe para vocabulario + organization type + live role set, y pruebas runtime-role de INSERT/UPDATE y role change incompatibles.

2. **[P1] Completar el read model obligatorio de Team.** `contracts/openapi/granete-api.v1.yaml:1716-1792` expone account/membership status, roles, sectors y blockers, pero omite `last_activity` y cualquier resumen de sesión disponible. Ya existen `users.last_login_at` y datos membership-scoped `credential_version`/`sessions_revoked_at` (`backend-go/internal/storage/organizations.go:125`), por lo que #451 exige representarlos de forma tenant-safe (nullable/missing cuando no haya evidencia; no filtrar actividad de otra organización). Actualizar OpenAPI generado, storage projection, API y contract tests.

3. **[P1] Añadir un proof integrado de los commands nuevos.** `backend-go/tests/pilotreadiness/` sólo cubre el listado y los `PUT` legacy de membership; no ejecuta por router + auth middleware + idempotency + PostgreSQL real `:transfer-admin`, `:change-sectors`, `:offboarding-preview`, `:offboard` ni `:revoke-sessions`. Los tests actuales prueban handlers con stubs y storage por llamada directa, separación que no detecta errores de wiring como el panic del router anterior. Agregar al menos un flujo pilot HTTP completo y denegaciones cross-org/stale/rollback relevantes para estos commands.

4. **[P1] Publicar la revisión corregida antes de cierre.** `git log origin/codex/451-safe-team-administration..HEAD` contiene cuatro commits. Después de resolver los defectos, ejecutar el gate completo, push, leer el SHA remoto y esperar CI; el reviewer no puede aprobar trabajo sólo local.

## Evidencia ejecutada

- `pnpm --filter @granete/storage test` — 11 archivos, 174 tests verdes en `7a7e59d9`.
- `pnpm typecheck` — todos los workspaces verdes.
- `pnpm openapi:check` — generated contract/client drift verde.
- `pnpm --filter @granete/ui test -- UsersScreen.test.tsx` — suite UI completa, 147 archivos y 1457 tests verdes.
- `go test ./internal/api -run 'Test(RegisterRoutes|Membership|Team|Invitation|Idempotency)' -count=1` — verde.
- `DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable go test ./internal/storage -run 'Test(TeamFoundation|MembershipSectors|TransferOrganizationAdmin|ChangeMembershipSectors|UpdateMembershipRolesRejectsResidual|OffboardMember|MembershipResponsibility)' -count=1 -v` — verde.
- Repro directo PostgreSQL dentro de transacción con runtime role y tenant context — sector inválido en Store fue aceptado; la transacción se revirtió al finalizar la prueba.
- `git diff --check origin/main...HEAD` — verde.
