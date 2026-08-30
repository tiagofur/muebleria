# Review — feature F196

**Veredicto:** CHANGES_REQUESTED

## Checkpoints
- C1: [x] `./init.sh` termina verde en `c3f06f7f`; migrations, OpenAPI, TypeScript, Ruby y Go pasan.
- C2: [x] Existe una sola feature `in_progress` y `progress/current.md` describe F196.
- C3: [ ] El nuevo trigger de compatibilidad de sectores no serializa cambios concurrentes de roles y sectores, por lo que el estado final puede violar su propio invariante.
- C4: [ ] Los proofs secuenciales y el pilot HTTP pasan, pero falta y falla el negative proof concurrente de sector insert versus role change.
- C5: [ ] F196 debe permanecer `in_progress` hasta corregir la carrera, repetir revisión, push y CI readback.

## Diseño UI/UX
- D1: [x] Los estilos nuevos usan tokens del design system.
- D2: [x] La pantalla conserva el patrón de tabla simple existente.
- D3: [x] Reutiliza el `Modal` común con focus trap, Escape y retorno de foco.
- D4: [x] Los toasts mantienen el comportamiento del sistema.
- D5: [x] Los iconos nuevos son Lucide con `strokeWidth={1.5}`.
- D6: [x] No introduce animaciones nuevas fuera del sistema.
- D7: [x] La carga del directorio y el gating por capability/role set permanecen correctos.
- D8: [x] El copy usa sentence case y los controles conservan labels accesibles.

## Cambios requeridos

1. **[P1] Serializar el invariante DB entre escrituras de roles y sectores.** `backend-go/db/migration/000098_membership_sector_compatibility.up.sql:55-60` lee la membership sin adquirir un lock que coordine con `:90-99`, que a su vez inspecciona sectores sin un lock común. Repro real sobre schema 98, con dos conexiones y `SET LOCAL ROLE granete_app` + tenant context válido:
   - estado inicial: Factory, membership `{produccion}`, sin sectores;
   - T1: `BEGIN; UPDATE memberships SET roles='{admin}' ...; pg_sleep(3); COMMIT;`;
   - T2 durante la espera: `BEGIN; INSERT INTO membership_sectors (..., 'cutting'); COMMIT;`;
   - ambos commits retornan éxito;
   - estado final: `roles={admin}`, `sector=cutting`, `membership_sector_is_compatible(...) = false`.

   El trigger de T1 ve cero sectores y el de T2 ve los roles committed anteriores, por lo que las comprobaciones MVCC separadas no forman un invariante. Usar un lock canónico común y orden estable para sector INSERT/UPDATE, membership role/org change y organization type change; agregar una prueba con dos conexiones que demuestre que exactamente una operación espera/falla o que el estado final siempre queda compatible.

2. **[P1] Publicar sólo después de la siguiente aprobación.** Tras corregir la carrera, ejecutar gate completo, solicitar una re-revisión fresca, push y confirmar SHA/CI remoto.

## Defectos anteriores verificados como corregidos

- `000098` rechaza secuencialmente sector desconocido, Store, rol no sector-scoped, Warehouse incompatible y role change residual bajo runtime role.
- `TeamMember` ahora expone `last_activity`, `credential_version` y `sessions_revoked_at` en OpenAPI generado y read model.
- `team_commands_http_test.go` ejecuta router + auth + idempotency + PostgreSQL real para change-sectors, transfer-admin, revoke, preview y offboard, incluyendo unauthorized, missing key, stale version, cross-org, replay, token revocation, stale impact y rollback observable.

## Evidencia ejecutada

- `DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable go test ./internal/storage -run 'TestMembershipSectorCompatibility' -count=1 -v` — 4 tests verdes.
- `DATABASE_URL=postgres://postgres:postgres@localhost:5445/muebles?sslmode=disable go test ./tests/pilotreadiness -run 'TestPilotReadiness_TeamCommandsExecuteThroughRealHTTPAndPostgres' -count=1 -v` — verde.
- `pnpm openapi:check` — generated contract/client drift verde.
- `pnpm --filter @granete/storage test` — 11 archivos, 174 tests verdes.
- `pnpm typecheck` — todos los workspaces verdes.
- Repro concurrente independiente con dos conexiones runtime-role — ambos commits verdes y estado final incompatible; datos de prueba eliminados después.
- `git diff --check origin/main...HEAD` — verde.
- Readback previo al artifact: `HEAD == origin/codex/451-safe-team-administration == c3f06f7f4c1b6d72db0d00303c929cf483a7d639`.
