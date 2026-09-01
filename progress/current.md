# Feature activa: F202 (#460) — SEC-4B in progress

- Actualizado: 2026-09-01 America/Mexico_City
- F199 (#458) cerrada (`done`); ninguna otra feature `in_progress`.
- F202 y #460 continúan abiertos. SEC-1, SEC-2A, SEC-2B (PR #528), SEC-3 (PR
  #530) y SEC-4A (PR #531) están integrados; slice **SEC-4B** (Web in-memory
  access credential, cookie bootstrap/refresh, serialización cross-tab y
  eliminación del bearer en localStorage) implementado en rama
  `feat/460-4b-web-in-memory-auth`, pendiente de revisión independiente y sin
  merge.
- SEC-5/6/7/8/9 no avanzaron en este slice.

## Hechos implementados SEC-4B

### Backend (TTLs y cap estructural)

- `WebAccessTokenTTL = 15m` ROLLING desde el mint (`min(now+15m,
  auth_sessions.absolute_expires_at)`), nunca desde el session origin (eso
  mintearía tokens ya vencidos tras el minuto 15). `MobileAccessTokenTTL =
  18h` y `ExtensionTokenTTL` intactos hasta SEC-5/6; `WebSessionAbsoluteTTL`/
  `MobileSessionAbsoluteTTL` = 18h (refresh nunca los desliza); ver4 legacy
  mintea su política histórica (`LegacyAccessTokenTTL`).
- Cap ESTRUCTURAL: `IssueTransportToken`/`issueTransportTokenUntil` rechazan
  un mint web sin cap absoluto futuro (error de programación, no política).
  Todos los paths web (login org-less, login, select-org, invitación,
  cookie refresh) usan `IssueTransportTokenUntil`; select-org resuelve la
  fila ANTES del mint (401 SESSION_REVOKED si murió) y reutiliza el mismo
  cap para metadata.
- `AccessTokenExpiry` (metadata `access_expires_at`) comparte la aritmética
  exacta del minting — proof HTTP: JWT exp == access_expires_at al segundo.

### Frontend (arquitectura client-side)

- `webAuthRuntime` — ÚNICA autoridad del credential Web en memoria
  (web|support|anonymous, generación monotónica para late-response guards;
  ningún secret sale salvo el access al fetch boundary). `getAuthUser` vive
  en estado del store (nada de usuario persistido).
- `webAuthClient` — boundary canónico: Authorization sólo para origin+base
  exacto de la API (URL externa jamás recibe bearer); cookie bootstrap y
  refresh bodyless `credentials:'include'` + `X-Granete-CSRF: 1` (sin
  Authorization) bajo lock; 401 de negocio → coordinated refresh → retry
  EXACTAMENTE UNA vez y sólo con mismo sessionId+organizationId (org switch
  o session replacement mid-request ⇒ WebSessionTransitionError, nunca
  replay cross-tenant); refresh terminal (INVALID/EXPIRED/REVOKED/REUSED) ⇒
  fin de sesión local; 5xx/red NO cierra sesión (cookie viva server-side);
  403 CSRF fail-closed sin loop; scheduler por access_expires_at real
  (~2 min lead) + wake visibility/focus/online con singleflight in-tab (20
  callers = 1 rotación).
- `webSessionLock` — TODA mutación de cookie (refresh/logout/select-org)
  serializada cross-tab: `navigator.locks` o fallback lease NO-secreto en
  localStorage (tab id random + expiry, verify-after-write, takeover de
  vencidos). Proof fallback: 3 actores concurrentes ⇒ peak 1 rotación en
  vuelo, lease sin secrets.
- `webSessionChannel` — BroadcastChannel `granete-web-session` con payloads
  `{ type }` ÚNICAMENTE (session-replaced/session-ended/scope-changed);
  refresh normal no recarga pestañas; el resto purge+reload y re-deriva
  estado desde la cookie (jamás tokens por mensaje).
- `workspaceStore` — login/loginWithAuthPayload/selectOrg/enterSupport/
  exitSupport/logout/markSessionEnded/boot sobre el runtime; `authBootstrapping`
  evita el flash login→shell; `sessionBootError` (unavailable/config) y
  `logoutServerPending` (logout server fallido: purge local inmediato, retry
  visible, bootstrap suprimido — nunca claim "logout completado");
  `granete_session` queda como hint no-secreto de guest por pestaña.
- Support: token SOLO en memoria tab-local (applySupportCredential), entry
  sin tocar cookie, exit = DELETE con token support → purge → cookie
  bootstrap que recupera la sesión platform (o login); 401 en modo support
  NUNCA se reintenta con otra credential class (negative proof).
- `APIWorkspaceRepository(baseUrl, { getAccessToken, fetchImpl })` — cero
  localStorage; el web inyecta el boundary autenticado (refresh-once).
  `AcceptInvitationScreen` acepta `fetchImpl` (web pasa credentialed fetch).
- Legacy: `migrateLegacyStorageKeys` DESTRUYE `muebles_token`/
  `granete_token`/`muebles_user`/`granete_user` (DELETE, NEVER SEND) y
  sigue migrando las claves guest; `auth401` reescrito (runtime + refresh
  coordinado, sin storage); `sessionSync` eliminado (reemplazado por el
  canal no-secreto).

## Inventario granete_token (estado final)

Runtime Web bearer persistence: CERO. Los únicos matches restantes son las
listas de discard (`legacyStorageKeys.DISCARDED_CREDENTIAL_STORAGE_KEYS`,
`session.LEGACY_BEARER_STORAGE_KEYS`), comentarios y tests que asertan la
destrucción/never-send. Storage del lock = lease no-secreto `{holder,
expiresAt}`. BroadcastChannel payloads `{type}`-only.

## Evidencia ejecutada

- `GOFLAGS='-p=1' go test ./... -count=1`: verde, incl.
  `TestWebAccessTokenShortTTLAndAbsoluteCap` (HTTP real + PostgreSQL: web
  ~15m con exp==access_expires_at y cap al bound shrunk T+17:59; mobile
  ~18h intacto), `TestAccessTokenTTLSeparation`, proofs auth/unbounded-web-
  mint-rejected/mobile-policy/rolling-vs-origin.
- `pnpm typecheck`: verde (web, mobile, desktop, ui, storage, domain, excel).
- `pnpm test`: verde (web 404 incl. suites nuevas runtime/lock/fallback/
  client: bootstrap, singleflight, 401-retry-once, cross-scope no-retry,
  session replacement, support-401, scheduler fake-timers, lease secrets;
  monorepo 3475 tests; mobile 49 sin regresión).
- `pnpm openapi:check`: verde sin drift (SEC-4B no cambió contrato).
- `scripts/organization-browser-gate.sh`: PASS 13/13 chromium — nuevos gates
  SEC-4B: no-bearer-en-storage + cookie HttpOnly no legible, reload bootstrap
  (access nuevo ≠ previo), pestaña nueva bootstrap sin transporte de token,
  refresh concurrente DOS PESTAÑAS a través del lock del app (ambos
  `refreshed`, sesión viva, sin REFRESH_REUSED), org switch dos tabs
  (bearer B ≠ A, storage limpio), logout corta ambas pestañas. Specs
  existentes (switch/lifecycle) actualizados al modelo memoria.
- `scripts/smoke-deploy.sh`: 30/30.
- `git diff --check`: limpio.

## Decisiones documentadas

- ADR-0007 §10 (SEC-4B) + status actualizado; organization-foundation-v2
  security section actualizada (cutover implementado).
- Re-login explícito para sesiones web stale (bearer localStorage destruido,
  sin credencial de migración long-lived) — intencional, heredado de SEC-4A.

## Estado de entrega

SEC-4A integrado. SEC-4B `implemented pending review`. F202 sigue
`in_progress`, #460 sigue abierto, sin merge. Roadmap restante explícito:
SEC-5 Mobile credential migration, SEC-6 SketchUp device credentials, SEC-7
MFA/step-up, SEC-8 trusted-proxy/rate limits/account hardening, SEC-9 gate
final + ver4 EOL.
