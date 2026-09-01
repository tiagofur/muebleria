# Feature activa: F202 (#460) — SEC-2B in progress

- Actualizado: 2026-09-01 America/Mexico_City
- F199 (#458) cerrada (`done`); ninguna otra feature `in_progress`.
- F202 y #460 continúan abiertos. SEC-1 y SEC-2A están integrados; SEC-2B está
  publicado en PR #528 desde `feat/460-2b-session-directory`, pendiente de
  revisión independiente y sin merge.
- SEC-3/4/6/7/8/9 no avanzaron en este slice.

## Hechos implementados SEC-2B

- OpenAPI generado para directorios/revocación exacta self, organization y
  platform, con límite 100, orden activo/reciente y sin credenciales.
- Migration `000107_auth_session_directory`: funciones `SECURITY DEFINER`
  estrechas con `search_path` fijo para administración org; RLS de
  `auth_sessions`/`auth_refresh_families` permanece `self-or-platform`.
- Capability live `team:revoke_sessions`, validación exacta actor/org/membership/
  session y errores `SESSION_NOT_FOUND` indistinguibles para foreign/missing.
- Revoke exacto monotónico y atómico: session + family abierta + audit crítico;
  repara family abierta con session ya revocada y el retry no muta/audita.
- Revoke membership-wide ahora corta inmediatamente sesiones/families y actualiza
  epoch en la misma transacción/audit. No modifica `support_sessions`.
- Directory/auth responses `no-store`; las rutas nuevas rechazan token en query.
- Idempotency conserva `membership_id` del actor revalidado dentro de la
  transacción, necesario para el command boundary live.

## Evidencia enfocada ejecutada

- `pnpm openapi:check`: verde.
- `GOFLAGS='-p=1' go test ./internal/api -count=1`: verde.
- `GOFLAGS='-p=1' go test ./internal/storage -run '^(TestAuthSessionDirectory|TestMembershipWideSessionRevoke)' -count=1`: verde.
- `GOFLAGS='-p=1' go test ./tests/pilotreadiness -run '^TestSessionDirectoryHTTP' -count=1`: verde (`6.159s`).
- `GOFLAGS='-p=1' go test ./internal/storage -run '^TestAuthSessionDirectoryConcurrentExactRevokeTransitionsOnce$' -count=1 -v`: verde (`1.133s`).
- `GOFLAGS='-p=1' go test ./... -count=1`: verde, incluido PostgreSQL real sin skips.
- `pnpm typecheck` y `pnpm test`: verdes.
- `scripts/organization-browser-gate.sh`: 7/7 Chromium con Go/PostgreSQL real.
- `scripts/smoke-deploy.sh`: 29/29; `git diff --check`: verde.
- El pilot HTTP usa PostgreSQL real y runtime role sin BYPASSRLS; cubre self
  S1/S2/current, SA1/SA2/SB1 sobre memberships independientes A/B, admin/seller,
  cross-org, platform/non-platform, access+refresh, family/audit rollback y
  family-only retry monotónico.

## Estado de entrega

PR #528 está abierto contra `main`, con `type:feature` + `size:exception`. No se
marcó F202 como `done`, no se cerró #460 y no se hizo merge. El SHA final y el
readback remoto se reportan en la entrega externa para no autorreferenciar el
commit dentro del propio ledger.
