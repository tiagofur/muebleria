# Review — feature F197

**Veredicto:** APPROVED

**Implementation head revisado:** `bedfad356d3e0dd859f08238492e61a058537a84`

## Checkpoints

- C1: [x] `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS='-p=1 -parallel=1' ./init.sh` terminó con exit code 0 contra PostgreSQL 16 aislado.
- C2: [x] F197 es la única feature `in_progress` y el tracker integra el alcance de #452 sobre `main@d85d6fd2`.
- C3: [x] Los commands y read models de Organization lifecycle respetan separación Platform/tenant, autorización exacta y RLS bajo el runtime role real.
- C4: [x] Las pruebas enfocadas verifican denegación SQL, truth de readiness/entitlements, missing-target fail-closed y rollback/replay de Factory; los gates completos también pasan.
- C5: [x] El implementation tree estaba limpio y pushed antes del artifact; el ledger permanece correctamente `in_progress` hasta este veredicto y el cierre queda habilitado.

## Diseño UI/UX

- D1: [x] Variables CSS del design system usadas, sin valores visuales ad hoc nuevos.
- D2: [x] La UI mínima conserva los patrones existentes de Platform y Settings.
- D3: [x] Se reutiliza el componente `Modal` existente.
- D4: [x] El éxito se presenta después de `active` más readiness.
- D5: [x] Se mantiene Lucide React.
- D6: [x] No se agregan animaciones nuevas.
- D7: [x] Se recorrió `docs/design.md` §8; lifecycle no activo no se presenta como empty state.
- D8: [x] Copy, foco y controles conservan los contratos existentes de accesibilidad.

## Evidencia ejecutada

- Remote readback previo al artifact: PR #484 y `origin/feat/452-organization-lifecycle-provisioning` apuntaban exactamente a `bedfad356`; no había commits locales, archivos sin commit ni errores de whitespace contra `main@d85d6fd2`.
- GitHub CI run `33329798521` terminó verde para el implementation head: harness/contract drift, TypeScript, Go y SketchUp en Ubuntu, macOS y Windows.
- Suite enfocada PostgreSQL 16 aislada, serial: `TestOrganizationLifecyclePrivileges_DirectOrganizationDMLDeniedButCommandAllowed`, `TestPlatformLifecycleHTTPPostgresInheritedRuntimeRole` y `TestFactoryProvisioningHTTPPostgresRuntimeRoleSuccessRollbackAndReplay` pasaron.
- El probe HTTP + PostgreSQL con login heredero de `granete_app` leyó readiness materializado y entitlements exactos; readiness y entitlements de targets inexistentes no devolvieron 200.
- El mismo probe confirmó suspend, reactivate, offboarding preview/start y terminate sin otorgar acceso tenant general al actor Platform.
- Las negativas directas conservaron denegados INSERT/UPDATE/DELETE y las funciones privilegiadas create/metadata/transition para el runtime login.
- Factory provisioning conservó success atómico, rollback por step fallido, retry y replay idempotente.
- `./init.sh` completo pasó: TypeScript, Go, Ruby 3.2.11 (241/2230), contrato Ruby (3/1029), Rubocop y RBZ.
- `GOFLAGS='-p=1 -parallel=1' scripts/pilot-gate.sh --fresh-container` pasó sin skips sobre migraciones fresh hasta `00101`.

## Cierre de hallazgos anteriores

- [x] `app_session_is_runtime()` reconoce miembros seguros heredados de `granete_app` y excluye principals privilegiados.
- [x] Invocaciones directas no autorizadas de create, metadata y transition quedan denegadas.
- [x] Platform lifecycle conserva actor org-less y autoriza únicamente el target exacto.
- [x] Readiness y entitlements consultan con el mismo target acotado y devuelven la verdad persistida bajo RLS.
- [x] Targets inexistentes fallan cerrados sin respuesta exitosa.
- [x] Factory provisioning conserva success, rollback, retry y replay.

No quedan hallazgos bloqueantes para F197.
