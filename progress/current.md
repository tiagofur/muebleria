# Feature activa: F202 (#460) — SEC-1 in progress

- Actualizado: 2026-08-31 America/Mexico_City
- F199 (#458) cerrada (`done`); ninguna otra feature `in_progress`.
- F202 tracker abierto con slice **SEC-1** (session registry + token taxonomy
  + JWT hardening) implementado en rama `feat/460-1-session-registry`.

## Estado SEC-1

- Migration `000105_auth_session_registry` (RLS platform-global + inventory +
  grants sin DELETE; fresh y upgrade probados).
- `auth.Authority`/`Keyring`: ver5 con sid/typ/iss/aud/jti/kid, HS256 exacto,
  keyring con rotación, aceptación transitoria de ver4 (EOL en SEC-9).
- Middleware: validación live del registry row por request (revocación/expiry
  cortan JWT vigente; client_type debe matchear; fail-closed sin lookup).
- Handlers login/select-org/refresh/me/soporte/invitación con sid estable y
  `session_id` en LoginResponse/SessionScope (OpenAPI regenerado, códigos
  SESSION_REVOKED/TOKEN_TYPE_MISMATCH).
- ADR-0007 + foundation-v2 §13 actualizados; ledger F202 in_progress.
- Verificación: `go test ./...` verde (con PostgreSQL real), `pnpm
  openapi:check`/`test`/`typecheck` verde.

## Siguiente

- SEC-2 (refresh rotation + reuse detection + logout + directorio de sesiones)
  tras merge de SEC-1; media (SEC-3) y proxy/rate-limit (SEC-8) pueden
  avanzar en paralelo según banda.
