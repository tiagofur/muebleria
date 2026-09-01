# Feature activa: F202 (#460) — SEC-2A in progress

- Actualizado: 2026-08-31 America/Mexico_City
- F199 (#458) cerrada (`done`); ninguna otra feature `in_progress`.
- F202 tracker abierto; **SEC-1** fue mergeado por PR #526 y el slice
  **SEC-2A** se implementa en `feat/460-2-refresh-rotation`.

## Base SEC-1

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

## Plan SEC-2A

- migration `000106` con refresh families y credentials hash-only;
- HMAC-SHA-256 con pepper independiente y configuración fail-closed;
- emisión inicial web/mobile, rotación atómica single-use y reuse detection;
- logout server-side idempotente y typed OpenAPI sin migrar React (SEC-4);
- pruebas unitarias, PostgreSQL real, API, concurrencia y failure injection.

SEC-2B (directorio de sesiones y revocación self/org/platform) queda como child
dependiente después del merge de SEC-2A para mantener el presupuesto revisable.

## Evidencia SEC-2A

- `GOFLAGS='-p=1' go test ./... -count=1`: verde, PostgreSQL real sin skips.
- `pnpm openapi:check`, `pnpm typecheck`, `pnpm test`: verdes.
- `scripts/organization-browser-gate.sh`: 7/7 Chromium con Go/PostgreSQL real.
- `scripts/smoke-deploy.sh`: 29/29; `shellcheck` y `git diff --check`: verdes.
- `PATH="$HOME/.rbenv/shims:$PATH" ./init.sh`: gate integral verde con Ruby 3.2.11.
