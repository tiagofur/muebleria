# Feature activa: F202 (#460) — SEC-4A in progress

- Actualizado: 2026-09-01 America/Mexico_City
- F199 (#458) cerrada (`done`); ninguna otra feature `in_progress`.
- F202 y #460 continúan abiertos. SEC-1, SEC-2A, SEC-2B (PR #528) y SEC-3
  (PR #530) están integrados; slice **SEC-4A** (Web refresh-cookie protocol,
  CSRF boundary y credential transport contract) implementado en rama
  `feat/460-4a-web-refresh-cookie`, pendiente de revisión independiente y sin
  merge.
- SEC-4B/5/6/7/8/9 no avanzaron en este slice. El frontend Web sigue
  operando con `granete_token` en localStorage exactamente como antes: el
  cutover React es SEC-4B.

## Hechos implementados SEC-4A

- Cookie Web dedicada `granete_web_refresh` (`internal/api/web_refresh_cookie.go`):
  `HttpOnly; SameSite=Strict; Path=/api/auth`, host-only (sin `Domain`),
  `Secure` por defecto (zero value fail-closed), expiración =
  `auth_sessions.absolute_expires_at` (nunca now+TTL; la cadena de FKs
  compuestos sessions←families←credentials hace el bound un invariante
  estructural de la BD). Clearing con los mismos atributos. No es
  `granete_token` ni reutiliza su namespace.
- Transporte por flow: login web / aceptación de invitación (onboarding web
  hoy; mobile no acepta invitaciones) / rotación web escriben R1/R2 sólo vía
  `Set-Cookie`; el JSON web nunca contiene `refresh_token`. Mobile conserva
  el contrato body íntegro. SketchUp/support sin cookie.
- Dispatcher total en `POST /api/auth/refresh` (`refreshTransitionHandler`):
  body JSON → mobile (único `RefreshTransport` del contract); bodyless +
  cookie → flow web con CSRF boundary; bodyless + bearer → bridge legado
  ahora RESTRINGIDO a sketchup/support (web/mobile bearers denegados,
  `REFRESH_INVALID`). Mezcla body+cookie → 400 fail-closed (refresh y logout).
- Rotación web = el mismo `RotateAuthRefreshCredential` SEC-2A (verifier →
  lock → validación live → mint → R2 → consume R1 → audit → commit) con
  `ExpectedClient=web`; `Set-Cookie` R2 sólo después del commit. Strict reuse
  detection intacto: replay R1 → `REFRESH_REUSED` + familia y sesión
  revocadas (proof HTTP con PostgreSQL real).
- Logout web: cookie + CSRF → `LogoutByRefreshCredential` (familia+sesión),
  clearing de cookie, idempotente/enumeration-safe; logout sin credencial
  también 200 + clear. Logout mobile por body intacto.
- select-org NO crea segunda familia ni rota cookie: mismo sid/familia con
  scope in-place; proof: login A (cookie) → select B → refresh misma cookie →
  access B-scoped.
- CSRF boundary (`requireWebCookieCSRF`): `Origin` exacto ∈ allowlist CORS Y
  header `X-Granete-CSRF: 1` exacto; 403 uniforme sin revelar qué boundary
  falló. Un form cross-site no puede activar refresh/logout (no puede setear
  el header; sin Origin o con Origin extranjero denegado).
- CORS (`CORSMiddleware`): `Access-Control-Allow-Credentials: true` sólo
  junto al origin exacto reflejado (nunca `*`; extranjero no recibe el par);
  `X-Granete-CSRF` añadido a `Access-Control-Allow-Headers`.
- Config fail-closed (`GRANETE_ENV` + `WEB_REFRESH_COOKIE_SECURE=auto|true|false`):
  `auto` baja `Secure` sólo si TODOS los orígenes CORS son loopback HTTP
  (forma local de dev/gates); `GRANETE_ENV=production` (fijado, no
  sobreescribible, en `docker-compose.prod.yml`) + cualquier resolución
  insegura → el server se niega a arrancar. Unit tests table-driven de todas
  las combinaciones.
- Metadata server-clock en `LoginResponse` (todos los auth responses):
  `access_expires_at` (misma aritmética exacta del minting vía
  `auth.AccessTokenExpiry`, helper compartido con `issueToken` — sin drift
  posible) y `absolute_session_expires_at` (fila del registry). React no
  necesita decodificar JWT para programar refresh (prepara SEC-4B).
- Redacción de secretos probada: captura de slog durante login/rotación/
  replay/logout incl. fallo interno inyectado (trigger PG) — ni el valor de
  cookie ni el prefijo `grt_refresh_v1.` aparecen en logs.
- OpenAPI (`granete-api.v1.yaml`) + regeneración Go/TS sin drift: body de
  refresh/logout opcional (flow web bodyless), enum `RefreshTransport=[mobile]`,
  `refresh_token` documentado mobile-only, headers `Set-Cookie` documentados
  en login/refresh/logout/invitaciones, summaries/descriptions del contrato
  de transporte. `refresh_contract_test.go` actualizado al nuevo lock
  (body opcional + enum mobile + cookie flow).

## Inventario de transports (pedido del slice)

| Flow | credential in | access out | refresh out |
|---|---|---|---|
| login web | email/password | JSON token | Set-Cookie |
| login mobile | email/password | JSON token | JSON body |
| login sketchup | email/password | JSON token | — |
| invitación:accept (web) | token+password | JSON token | Set-Cookie |
| refresh mobile | JSON body | JSON | JSON rotado |
| refresh web | cookie+CSRF (bodyless) | JSON | Set-Cookie rotado |
| refresh sketchup/support | bearer bodyless (bridge finito) | JSON | — |
| logout mobile | JSON body | — | 200 |
| logout web | cookie+CSRF (bodyless) | — | 200 + clear |
| logout sin credencial | — | — | 200 + clear |

Mobile no consume `/auth/invitations:accept` ni `/auth/refresh` hoy
(verificado: ningún caller en `apps/mobile`); nada de Mobile se rompió.
Web no llama refresh/logout hoy (logout era puramente client-side), por lo
que SEC-4A no rompe producción entre 4A y 4B.

## Invariantes documentados para SEC-4B (ADR-0007 §9)

- La serialización cross-tab del refresh (navigator.locks +
  BroadcastChannel) es PREREQUISITO de SEC-4B: la detección de reuse
  server-side permanece STRICT y NO se relaja (dos tabs refrescando la misma
  cookie concurrentes = replay = familia revocada).
- La activación del short Web access TTL pertenece a SEC-4B, cuando React
  refresque automáticamente. SEC-4A no cambió ningún lifetime.
- El cutover eliminará `granete_token` de localStorage: las sesiones web
  vigentes harán un re-login explícito; no se crea credential de migración
  long-lived para evitarlo.

## Evidencia ejecutada

- `GOFLAGS='-p=1' go test ./... -count=1`: verde (api, auth, config, storage,
  pilotreadiness con PostgreSQL real incl. `web_refresh_cookie_http_test.go`:
  atributos de cookie, matriz de transports sin secretos en JSON web,
  rotación preservando bound absoluto contra fila shrunk live, denegaciones
  CSRF incl. request form-compatible, mezcla de credenciales, replay strict,
  logout+clear+aislamiento de sesiones, redacción de logs, CORS exact-origin
  credentialed).
- `pnpm openapi:check`: verde sin drift.
- `pnpm typecheck`: verde (web, mobile, desktop, ui).
- `pnpm test`: verde (372 web tests, suites completas).
- `scripts/smoke-deploy.sh`: 30/30.
- `scripts/organization-browser-gate.sh`: PASS (7/7 chromium; Web sigue
  operando con el flujo actual — el cutover es 4B).
- `git diff --check`: limpio.

## Review externa (PR #531 — CHANGES REQUIRED) y correcciones

Tres blockers de semántica de cookie corregidos en el parche post-review
(`refresh_handlers.go` + `web_refresh_cookie.go`):

1. **Refresh 500 ya no borra la cookie**: `HandleWebCookieRefresh` sólo
   limpia `granete_web_refresh` ante errores públicos terminales
   (`REFRESH_INVALID/EXPIRED/REVOKED/REUSED/...`); un fallo interno (la
   transacción hizo rollback y R1 sigue siendo la credencial live) responde
   500 **sin** Set-Cookie de borrado. Proof con failure injection (trigger PG
   sobre la rotación): 500 sin Set-Cookie + retry con la misma R1 rota y
   `/api/auth/me` 200.
2. **Logout limpia la cookie después del commit**: el flow cookie ahora
   revoca (`revokeByRawRefreshCredential`) y sólo tras éxito (o credencial
   desconocida/inválida, no-op enumeration-safe) emite el clearing. Proof con
   trigger sobre el audit `logout`: 500 preserva cookie, sesión/familia
   rollback-coherentes (abiertas), retry cierra todo + limpia cookie +
   `/me` 401 + refresh `REFRESH_REVOKED`.
3. **Logout sin credencial es mutation-free**: responde 200 idempotente sin
   mutación ni Set-Cookie — un form cross-site (que no puede portar la cookie
   Strict) ya no puede provocar el borrado de la cookie del navegador
   (logout-CSRF). Negative proof incluido (form-compatible, Origin extranjero:
   sin Set-Cookie, sesión viva, cookie sigue rotando).

Corrección menor también aplicada: `requireWebCookieCSRF` devuelve un único
error público uniforme (`csrfDeniedMessage`) para ambos boundaries; el test
unitario verifica que las denegaciones son byte-idénticas.

## Estado de entrega

SEC-4A queda `SEC-4A implemented pending review`. F202 sigue `in_progress`,
#460 sigue abierto, sin merge. Roadmap restante explícito: SEC-4B Web
in-memory access cutover + cross-tab refresh serialization + eliminación de
`granete_token`/localStorage, SEC-5 Mobile credential migration, SEC-6
SketchUp device credentials, SEC-7 MFA/step-up, SEC-8 trusted-proxy/rate
limits/account hardening, SEC-9 gate final + ver4 EOL.
