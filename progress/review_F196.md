# Review — feature F196

**Veredicto:** APPROVED

## Checkpoints
- C1: [x] `./init.sh` termina verde en `bf6d4f1b`; harness, migrations, OpenAPI, TypeScript, Ruby y Go pasan.
- C2: [x] Existe una sola feature `in_progress` y `progress/current.md` describe F196 hasta completar el delivery posterior a esta aprobación.
- C3: [x] Capabilities, commands, RLS, invariantes de último admin/seats, sectores, revocación y offboarding respetan los boundaries canónicos.
- C4: [x] Hay pruebas unitarias, contractuales, PostgreSQL/runtime-role, carreras en ambas direcciones y pilot HTTP real; no queda evidencia sólo declarativa.
- C5: [x] El implementation tree estaba limpio y pushed antes del artifact; `HEAD == origin/codex/451-safe-team-administration == bf6d4f1b3f45075abbd46ad0dc72aa1d00320e2f`, PR #482 apunta a `main` y CI remoto está completamente verde.

## Diseño UI/UX
- D1: [x] Los estilos nuevos usan tokens del design system.
- D2: [x] La pantalla conserva el patrón de tabla simple existente.
- D3: [x] Reutiliza el `Modal` común con focus trap, Escape y retorno de foco.
- D4: [x] Los toasts mantienen el comportamiento del sistema.
- D5: [x] Los iconos nuevos son Lucide con `strokeWidth={1.5}`.
- D6: [x] No introduce animaciones nuevas fuera del sistema.
- D7: [x] Directorio e invitaciones tienen estados independientes y las acciones se presentan por capability + role set de destino.
- D8: [x] Copy en sentence case, estados account/membership separados y controles accesibles.

## Verificación de defectos previos

- **Sector semantic enforcement:** migrations 000098/000099 rechazan vocabulario, organization type, live roles y asignaciones residuales incompatibles bajo runtime role.
- **Sector race:** 000099 adquiere advisory transaction locks en orden organización → membership para insert/update de sectores, cambios de roles/membership scope y cambio de organization type. Las carreras role-first/sector-first y type-first/sector-first esperan el mismo lock, rechazan la segunda mutación incompatible y conservan un estado compatible.
- **Repro independiente:** la carrera exacta antes vulnerable, ejecutada con dos conexiones `granete_app`, ahora produce role update exit 0, sector insert exit 3 con `membership_sector_compatibility`, y estado final `{admin}` con cero sectores.
- **Team read model:** OpenAPI generado y proyección PostgreSQL exponen `last_activity`, `credential_version` y `sessions_revoked_at`, además de account/membership status, roles, sectors, blockers y version.
- **HTTP/PostgreSQL proof:** pilot readiness ejecuta router + auth + If-Match + idempotency + PostgreSQL para change-sectors, transfer-admin, revoke, preview y offboard, con unauthorized, stale, cross-org, replay, token invalidation, stale impact y rollback observable.

## Evidencia ejecutada

- `DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable go test ./internal/storage -run 'TestMembershipSectorCompatibility_(RoleChangeAndSectorInsertSerialize|OrganizationTypeAndSectorInsertSerialize)|TestMembershipSectorRaceLockingMigration' -count=1 -v` — 5 subtests/races verdes.
- `DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable go test ./internal/storage -run 'TestMembershipSector(Compatibility|Race)' -count=1` — verde.
- `DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable go test ./tests/pilotreadiness -run 'TestPilotReadiness_TeamCommandsExecuteThroughRealHTTPAndPostgres' -count=1` — verde.
- `DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable go test ./internal/api -run 'Test(RegisterRoutes|CanonicalAdministration|OrgTeam|OrgMember|CanonicalTeam|CanonicalRevoke)' -count=1` — verde.
- `pnpm openapi:check` — generated contract/client drift verde.
- `pnpm --filter @granete/storage test` — 11 archivos, 174 tests verdes.
- `pnpm --filter @granete/ui exec vitest run src/users/UsersScreen.test.tsx` — 21 tests verdes.
- `pnpm typecheck` — todos los workspaces verdes.
- `git diff --check origin/main...HEAD` — verde.
- PR #482 readback: base `main`, head `bf6d4f1b`, merge state `CLEAN`; Validate Harness, TypeScript, Go y Ruby Linux/macOS/Windows en `SUCCESS`.

## Cambios requeridos

Ninguno.
