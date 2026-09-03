# Feature activa: #391 DT-7 — Detect and resolve duplicated managed furniture identity in SketchUp

- Actualizado: 2026-09-03 America/Mexico_City
- F202 (#460) sigue abierta en paralelo (SEC-8/SEC-9); esta sesión ejecutó el
  slice DT-7 en modo Demo Commercial Rescue sobre `feat/391-duplicate-furniture-instance-identity`.
- #391 implementada COMPLETE: detección de duplicación física de muebles en SketchUp
  (Copy/Paste/Move+Copy), backend autoritativo crea nueva entidad (origin='duplicate',
  origin_furniture_instance_id=fuente), reescritura atómica de metadatos exclusivamente
  sobre la copia manteniendo intacto el original, sincronización con DesignWorkingCopy,
  manejo explícito de unresolved en caso de desconexión y precheck de validación de
  identidad antes de publicar (#391 DT-7 §21-22). Detalle: `progress/implementation_391_dt7.md`.

## Historial previo — F202/#460 Organization Foundation P0

- Actualizado: 2026-09-02 America/Mexico_City
- F199 (#458) cerrada (`done`); ninguna otra feature `in_progress` salvo F202.
- F202 y #460 continúan abiertos. SEC-1, SEC-2A/B (PR #528), SEC-3 (PR #530),
  SEC-4A (PR #531), SEC-4B, SEC-5 y SEC-6 (PR #534, merge `f5d59a46`) están
  integrados; **SEC-7** (MFA TOTP + step-up para acciones sensibles) está integrado
  en `main` por PR #535 (merge `355be4ea`).
- Roadmap restante: SEC-8 trusted-proxy/rate limits distribuidos/account
  hardening, SEC-9 gate final + ver4 EOL.

## SEC-7 — qué se implementó

### Modelo y storage (migration 000109)

- `auth_mfa_factors`: factor TOTP por usuario, `pending → enabled → revoked`;
  secreto AES-256-GCM (nonce‖ciphertext‖tag) kid-pinned; `pending_expires_at`
  terminal; `last_used_counter` high-water de replay; CHECKs de shape.
- `auth_mfa_recovery_codes`: 10 verificadores HMAC-SHA256 (nunca plaintext),
  `used_at`/`revoked_at` single-use por UPDATE condicional.
- `auth_step_up_grants`: autoridad server-side (sid, user, scope, method,
  expiración ≤10 min); freshness joinea la fila viva de `auth_sessions` (la
  revocación corta el grant sin cleanup); S2 nunca hereda (sid distinto).
- `auth_sessions.step_up_at` (reservada en 000105) se mantiene como hint de
  frescura; los grants son la autoridad por scope.
- RLS platform-global self-or-platform en las tres tablas + registro en
  `rls_policy_inventory`; sin DELETE (revocación/uso son UPDATE; grants
  expiran solos).

### Crypto

- Keyring dedicado `MFA_ENCRYPTION_KEYS` (`{"active_kid","keys":{kid:base64}}`)
  o `MFA_ENCRYPTION_KEY` single (kid `primary`); ≥32 bytes; boot fail-closed
  (LoadConfig) igual que REFRESH_TOKEN_PEPPER. Subkeys por propósito vía
  HKDF-SHA256 (AEAD TOTP vs HMAC recovery no cruzan). Rotación: active kid
  sella lo nuevo; quitar un kid fail-closed su material.
- TOTP RFC 6238 (SHA1/6/30, ventana ±1) con vectores del RFC; replay
  protection atómica (counter aceptado una sola vez, incluso concurrente).
- Disjunto de JWT/refresh/media/device secrets por construcción.

### API y boundaries

- Endpoints (`/api/auth/mfa/*`, OpenAPI generado sin drift): factors list,
  totp:begin (URI una sola vez), totp/{id}:verify (habilita + recovery),
  factors/{id}:remove y recovery-codes:regenerate (security_admin step-up),
  step-up (un scope por verificación).
- `RequireStepUp(scope)` corre DESPUÉS de auth/platform y ANTES del wrapper de
  idempotencia: el challenge no consume la `Idempotency-Key`; el reintento
  verificado reutiliza la misma key (proof HTTP + browser).
- 403 tipado (nunca 401): `MFA_REQUIRED` (sin factor; sin bypass — enrollment
  exige TOTP vivo), `STEP_UP_REQUIRED` (+`details.scope`), `STEP_UP_EXPIRED`.
- Comandos protegidos: devices approve (device_enrollment), support entry
  (support_access), MFA remove/regenerate (security_admin), team
  change-roles/transfer-admin/offboard/revoke-sessions (organization_admin),
  org lifecycle + entitlements + set-account-status (platform_admin).
  Documentado: password change no existe aún (deberá nacer con step-up);
  self-revoke/revocación de dispositivo propio/suspend memberships quedan en
  su boundary (bajo impacto o reversibles); MFA obligatoria para admins NO se
  fuerza aún (decision de rollout para SEC-8/9; MFA_REQUIRED es la mecánica).
- Rate limiting por usuario+propósito: 5 fallos, refill 1/min, éxitos gratis
  (in-memory; SEC-8 lo distribuye). Auditoría `mfa_*`/`step_up_*` sin material
  secreto (proof de redacción en storage+HTTP).

### Web / Mobile

- `SecurityScreen` (`/security`, nav base para todo rol): wizard enrollment
  (QR en memoria + clave manual), verificación, recovery codes one-time
  (copiar/guardar), regenerar y eliminar factor con step-up.
- `useStepUp` + `StepUpModal`: modal ligado a la acción exacta ("Confirma tu
  identidad"), reintento del MISMO comando con la misma Idempotency-Key, sin
  retry global automático; hint MFA_REQUIRED → Seguridad. Nada MFA toca
  localStorage/sessionStorage/IndexedDB.
- Wiring: DevicesScreen (approve), UsersScreen (roles/transfer/offboard/
  revoke-sessions), PlatformScreen (support + account status),
  OrganizationLifecyclePanel (suspend/reactivate/terminate/begin-offboarding).
- Mobile: 403 STEP_UP se superficie como DomainError con code y NUNCA entra al
  path de refresh (regression proof).

## Evidencia ejecutada

- `GOFLAGS='-p=1' go test ./... -count=1`: verde (crypto/TOTP unit, storage
  PostgreSQL: migration fresh+upgrade, lifecycle, replay CON concurrencia,
  recovery single-use CON concurrencia, TTL/binding/scopes/revocación, RLS,
  redacción de audit; api: boundaries tipados, ver4 no elevable, fail-closed
  sin keyring; pilotreadiness HTTP real: enrollment, challenge+retry misma
  key, enrollment expirado post-MFA, scope isolation, TTL, session
  replacement, recovery+management, rate limit, redacción).
- `pnpm openapi:check`: sin drift. `pnpm typecheck`: verde.
- `pnpm test` (monorepo): verde (UI 1503 incl. SecurityScreen/stepUp/
  DevicesScreen challenge; mobile 6/6 apiClient).
- `scripts/organization-browser-gate.sh`: PASS con `mfa.spec.ts` (enrollment
  QR+manual, recovery one-time, STEP_UP_REQUIRED → verificación → mismo
  comando prospera, sin secretos MFA en storage).
- `scripts/smoke-deploy.sh`: 31/31 (con `MFA_ENCRYPTION_KEYS` añadida a la
  validación de compose y a `.env.production.example`).
- `git diff --check`: limpio.

## Decisiones documentadas

- ADR-0007 §12 (SEC-7) + status; organization-foundation-v2 §13 actualizado;
  `.env.example`/`docker-compose.prod.yml`/gates con el nuevo secreto.

## Estado de entrega

SEC-6 y SEC-7 integrados en `main`. F202 sigue `in_progress` y #460 sigue
abierto porque SEC-8/SEC-9 están pendientes. Roadmap restante explícito:
SEC-8 trusted-proxy/rate limits/account hardening, SEC-9 gate final + ver4
EOL.


## Coordinación activa — #461 mínimo para Gate A

- Rama: `feat/461-gate-a-durable-audit`, base `main@355be4ea`.
- Alcance: acoplar login/session creation, select-org y platform org patch a
  `security_audit_events` durable en la misma transacción; versión/correlación y
  RLS org-less mínimos; pruebas PostgreSQL de rollback.
- Fuera de alcance: #461 completo, outbox sin consumidor, Gate B, SEC-8/9 y #385.

## Foundation Gate A #462 — GREEN

- `pnpm gate:foundation:a`: PASS sobre PostgreSQL 16 fresh + upgrade fixtures,
  roles migration/runtime separados (`NOBYPASSRLS`), Go HTTP/auth/MFA y
  Chromium real.
- Coverage final: 34/34 (`progress/gate_a_462_coverage.md`); 22 proofs
  existentes reutilizados y sólo los 12 gaps exactos implementados.
- Durable audit: conserva `security_audit_events` como autoridad; failure
  injection prueba rollback de mutación crítica. No se agregó outbox sin
  consumidor.
- #460/F202 continúa `in_progress` por SEC-8/SEC-9; #461 completo y Gate B
  siguen pendientes.
- **#385 DT-1 may start.**

## F204 — #385 DT-1: identidad estable de FurnitureInstance (COMPLETE)

- Primera familia persistente post-Gate A. `furniture_instances`
  (migration 000111): una identidad estable por unidad física, project-owned,
  con provenance server-authoritative (`quote|design|manual|import|duplicate`),
  lifecycle terminal (`active|removed|cancelled`) y versionado optimista.
- RLS `explicitly-shared` + inventory + trigger de ownership + grants sin
  DELETE desde la primera migración; fresh + upgrade fixture verdes.
- API generada: `GET/POST /api/projects/{projectId}/furniture-instances`,
  `POST /api/furniture-instances/{instanceId}:remove`; idempotency durable en
  create/remove; audit `furniture_instance_created/removed` en la misma
  transacción tenant.
- Pruebas PostgreSQL real: identidad independiente (dos comandos idénticos →
  dos IDs), cross-project rechazado, cross-org bloqueado con rol app incluso
  sin filtro de tenant, projectId random → 404, retry no duplica identidad.
- Detalle: `progress/implementation_385_dt1.md`. NO implementado: #386, #387,
  SketchUp, reconciliation, release, machining.

## F205 — #386 DT-2: QuoteLine ↔ FurnitureInstance (COMPLETE)

- Segunda familia persistente post-Gate A. `quote_line_furniture_instances`
  (migration 000112): relación explícita línea comercial ↔ unidades físicas.
  Representación equivalente permitida por §4 del contrato digital-thread:
  QuoteLine = `project_items`, aceptación = `projects.status`
  (accepted/produced); sin modelo comercial paralelo.
- `quantity=N` materializa N identidades únicas (`origin='quote'`, reutiliza
  `CreateFurnitureInstance` de #385); idempotente por convergencia con
  advisory lock por línea (concurrencia exacta); increase preserva IDs y agrega
  sólo delta; decrease en draft retira las más nuevas con lifecycle terminal
  `cancelled` y **nunca recicla IDs** (hook de historia durable documentado
  para #387+).
- Inmutabilidad de aceptada en tres capas: error tipado `ErrQuoteRevisionAccepted`
  (409) en storage/API; policies RLS INSERT/DELETE con
  `app_project_quote_mutable` + org dueña (bloquea SQL directo); guards tipados
  contra eliminar/dropear líneas materializadas vía PUT de proyecto (FK
  compuesta deferible como backstop estructural; cross-project imposible).
- API generada: `GET /api/projects/{projectId}/quote-lines/{quoteLineId}/furniture-instances`,
  `POST .../quote-lines/{quoteLineId}:materialize` (idempotency durable, sin
  body: identidad server-authoritative). Audit `quote_line_furniture_materialized`
  en la misma transacción.
- Fix contenido de deuda preexistente desbloqueado por este trabajo:
  `loadProjectItems` bufferea items antes de las queries anidadas de choices
  (fallaba `conn busy` dentro de la tx de tenant del middleware).
- Detalle: `progress/implementation_386_dt2.md`. NO implementado: #387,
  #388 re-quote, SketchUp, reconciliation (#392), release, machining.
  **#387 DT-3 may start.**
