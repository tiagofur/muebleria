# Review — #461 Gate-A durable audit foundation (PR #536)

**Veredicto:** APPROVED

**Base revisada:** `origin/main@355be4ea4d3fead73cacd5ff67525ee8de80eb25`
**Head remoto exacto:** `c9c53ed782643163b9c2abcf8876c122eba07e97`

## Revisión del blocker previo

- [x] `packages/ui/src/platform/PlatformScreen.tsx:251-263` ejecuta la edición
  mediante `stepUp.run('platform_admin', ...)`.
- [x] El callback entrega explícitamente la key de `useStepUp` a
  `api.updatePlatformOrganization(..., key)`; el intento desafiado y el retry
  posterior a MFA usan exactamente la misma `Idempotency-Key`.
- [x] Un resultado `null` cancela sin toast de éxito, sin cerrar la edición y
  sin recargar organizaciones.
- [x] `PlatformScreen.test.tsx` prueba por el cliente/ruta reales del componente:
  primer PATCH `STEP_UP_REQUIRED`, TOTP `platform_admin`, segundo PATCH exitoso,
  dos intentos y key idéntica.
- [x] Prueba focalizada local: 8/8 tests verdes.

## Contrato durable y scope

- [x] Reutiliza `security_audit_events`; no inventa outbox, worker, retry queue
  ni dead-letter sin consumidor asíncrono.
- [x] Login success confirma session, refresh family, `last_login_at` y audit en
  una sola transacción; fallo de audit revierte todo y no expone cookie.
- [x] Select-org confirma scope + audit requerido en la transacción autenticada;
  fallo inyectado conserva el scope anterior.
- [x] Platform organization PATCH combina step-up, idempotencia, mutación y audit
  requerido; fallo inyectado revierte name/version y la misma key puede reintentar.
- [x] Migration 000110 es aditiva; cubre envelope versionado/correlacionado,
  RLS org-less y ciclos fresh/upgrade/down.
- [x] Pruebas direct-SQL usan runtime role real sin `BYPASSRLS` y cubren actor,
  platform admin y rechazo cross-org.
- [x] Serialización inválida y metadata secret-bearing fallan cerrado; no queda
  el placeholder best-effort `encode_error`.
- [x] OpenAPI sigue siendo autoridad; el cliente TypeScript está generado y no
  presenta drift.
- [x] El guard impide devolver los eventos Foundation críticos conocidos a
  `Server.audit` best-effort.
- [x] No incluye Gate B, #385, SIEM, OTel, analytics ni plataforma general de
  outbox. El PR declara correctamente que Gate A completo aún corresponde al
  slice siguiente.

## Checkpoints

- C1: [x] Harness completo; `PATH="$HOME/.rbenv/shims:$PATH" ./init.sh` termina
  con exit code 0 sobre el head exacto.
- C2: [x] `feature_list.json` válido, una sola feature `in_progress` (F202), sin
  declarar #461 ni Foundation Gate A completos.
- C3: [x] Boundaries backend/OpenAPI/storage/UI respetados; business mutation y
  evidence crítico comparten autoridad transaccional.
- C4: [x] Typecheck, suite TypeScript completa, Go completo con PostgreSQL,
  pilotreadiness, Ruby/RBZ y `pnpm openapi:check` verdes; Ruby reporta 0 skips.
- C5: [x] Head local = head remoto; no existen commits locales sin push ni
  artifacts sospechosos. El único untracked es este reporte de review solicitado.

## Diseño UI/UX

- D1: [x] No agrega CSS, tokens ni valores visuales.
- D2: [x] Reutiliza el patrón canónico `useStepUp` ya presente en la pantalla.
- D3: [x] Reutiliza el modal accesible existente; no crea overlays paralelos.
- D4: [x] Sólo anuncia éxito después del retry autoritativo exitoso.
- D5: [x] No agrega ni modifica iconos.
- D6: [x] No agrega motion.
- D7: [x] El cambio es conductual y no altera layout, responsive, estados de
  pantalla ni jerarquía visual; los ítems visuales de `docs/design.md` §8 no
  afectados quedan N/A.
- D8: [x] Mantiene copy contextual y flujo de teclado/modal del primitive
  existente.

## Verificación y readback

- `./node_modules/.bin/vitest run packages/ui/src/platform/PlatformScreen.test.tsx`:
  PASS, 8/8.
- `pnpm typecheck`: PASS.
- `pnpm openapi:check`: PASS.
- `PATH="$HOME/.rbenv/shims:$PATH" ./init.sh`: PASS completo.
- `git diff --check origin/main...origin/feat/461-gate-a-durable-audit`: limpio.
- `origin/feat/461-gate-a-durable-audit..HEAD`: vacío.
- GitHub readback del head exacto `c9c53ed7`: `mergeStateStatus=CLEAN`; verdes
  `Validate Feature List & Harness`, `TypeScript (Typecheck & Tests)`,
  `Organization Browser Gate`, `Go Backend Tests` y SketchUp Ruby en Ubuntu,
  macOS y Windows.

## Cambios requeridos

Ninguno.
