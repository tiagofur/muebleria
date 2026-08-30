# Review — feature F197

**Veredicto:** APPROVED

**Implementation head revisado:** `f4b7eee5a5326d88895ab0dbf5af4e7c015e08a8`

## Checkpoints

- C1: [x] Harness, documentos, skills y archivos base presentes; `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS='-p=1 -parallel=1' ./init.sh` terminó con exit code 0 contra PostgreSQL 16 aislado.
- C2: [x] F197 es la única feature `in_progress`; `progress/current.md` describe exactamente la corrección pendiente de esta revisión.
- C3: [x] La corrección mantiene la autoridad server-side: application service transaccional, lock PostgreSQL compartido, RLS, credential epoch y auditoría requerida sin lógica de dominio en UI.
- C4: [x] Suite enfocada y gates completos prueban ambos órdenes de la carrera, migración fresh/upgrade/down, revocación por estado/epoch, HTTP runtime-role y rollback de auditoría.
- C5: [x] El implementation head estaba limpio, pushed y coincide con el remoto; no hay archivos sospechosos ni commits locales. F197 permanece `in_progress` hasta que el artifact de aprobación sea consumido por el cierre posterior.

## Diseño UI/UX

- D1: [x] Los estados nuevos usan variables CSS del design system; no se agregaron colores visuales hardcoded.
- D2: [x] Platform y Settings conservan los patrones de pantalla existentes y consumen el provisioning autoritativo compartido.
- D3: [x] Los modales reutilizan el componente existente y sus contratos de foco/cierre.
- D4: [x] El éxito sólo se muestra después de `status=active` y readiness autoritativa.
- D5: [x] Los iconos siguen usando Lucide React con `strokeWidth={1.5}`.
- D6: [x] No se agregaron animaciones nuevas.
- D7: [x] Recorrido completo de `docs/design.md` §8: provisioning, suspended, offboarding, terminated y provisioning_failed no se presentan como empty state ni éxito falso.
- D8: [x] Copy, controles deshabilitados, labels y feedback mantienen los contratos existentes de accesibilidad.

## Evidencia ejecutada

- Readback previo: `HEAD`, PR #484 y `origin/feat/452-organization-lifecycle-provisioning` coincidían exactamente en `f4b7eee5a5326d88895ab0dbf5af4e7c015e08a8`; base `main@d85d6fd21aa040c4d1f08c5c76c0ab099db7c83b`, PR `OPEN/CLEAN`, issue #452 abierto y 6/6 checks CI remotos verdes.
- No había commits locales, cambios de implementación, archivos sin trackear ni errores de whitespace.
- `TestSupportSessionStartAndOrganizationSuspendSerializeOnOrganizationLock` pasó sobre PostgreSQL real en ambos órdenes: start primero queda cerrado por suspensión; suspensión primero hace que start falle. Ambos terminan `suspended` con cero sesiones abiertas.
- `TestPlatformLifecycleHTTPPostgresInheritedRuntimeRole` pasó: token activo funciona, suspensión lo corta, reactivación no revive el token anterior, token nuevo funciona y offboarding lo corta con `ended_via=org_offboarding`.
- Migración `000102_support_session_credential_epoch`: backfill, snapshot inmutable, live epoch/status, writes sólo en transacción, down roundtrip y rechazo de rollback lossy pasaron.
- Matriz de middleware negó sesión faltante/incorrecta, actor u organización incorrectos, ended, expired, suspended, offboarding, terminated y ambos desajustes de epoch.
- Claims de soporte preservaron credential epoch y lifetime absoluto; credenciales incompletas y organización divergente fueron rechazadas.
- Auditoría requerida de start/end revierte la mutación ante failure injection; logout ajeno no revela ni termina la sesión.
- `pnpm --filter @granete/domain test`: 94 archivos, 1181 tests verdes.
- `./init.sh` completo pasó: TypeScript, Go/PostgreSQL, Ruby 3.2.11 (241 tests / 2230 assertions), contrato Ruby (3 / 1029), Rubocop y RBZ determinístico.
- `GOFLAGS='-p=1 -parallel=1' scripts/pilot-gate.sh --fresh-container` pasó sin skips funcionales sobre migration head `00102` y runtime-role RLS.

## Cierre de la corrección

- [x] StartSupportSession y los lifecycle commands toman el mismo lock dentro de la transacción.
- [x] El status `active` se revalida después del lock antes de insertar.
- [x] Sesión y JWT quedan ligados al Organization credential epoch vigente.
- [x] Cada request revalida sesión, vencimiento, actor, organización, estado vivo y epochs.
- [x] Suspensión/offboarding cierran sesiones atómicamente; reactivación no revive tokens antiguos.
- [x] Start y logout escriben su audit requerido en la misma transacción de la mutación.
- [x] `org_offboarding` es representable y la migración evita rollback silenciosamente lossy.

No quedan hallazgos bloqueantes para F197 en el head revisado.
