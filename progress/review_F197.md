# Review — feature F197

**Veredicto:** CHANGES_REQUESTED

**Implementation head revisado:** `977da45706b577057a0186a86078fcf0dfd7cc5d`

## Checkpoints

- C1: [x] `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS='-p=1 -parallel=1' ./init.sh` terminó con exit code 0 contra PostgreSQL 16 aislado.
- C2: [x] F197 es la única feature `in_progress` y el tracker integra el alcance de #452 sobre `main@d85d6fd2`.
- C3: [x] Los dos P0 anteriores quedaron cerrados: todo runtime login admitido aplica autorización en los commands, y Platform lifecycle conserva contexto org-less con target acotado.
- C4: [ ] Los comandos y gates pasan, pero dos read models nuevos de Platform siguen consultando tablas RLS sin autorizar el target y no devuelven la verdad persistida.
- C5: [ ] No corresponde cerrar F197 hasta que readiness y entitlements tengan prueba HTTP + PostgreSQL bajo el runtime role real.

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

- Remote readback: tracker, PR #484 y `origin/feat/452-organization-lifecycle-provisioning` apuntaban a `977da457`; no había commits locales ni archivos sin commit antes de este reporte.
- PR #484 estaba draft, mergeable y con sus seis checks GitHub `SUCCESS` para el head revisado.
- `git diff --check d85d6fd2..977da457` pasó.
- Suite enfocada PostgreSQL: direct DML/commands, Platform lifecycle HTTP completo y Factory rollback/retry/replay pasaron en PostgreSQL 16 aislado.
- Repetición manual del exploit anterior: el login heredero de `granete_app` recibió `organization create actor mismatch`, exit 3, y dejó cero organizaciones con el slug atacado.
- Platform HTTP + PostgreSQL pasó suspend, reactivate, offboarding preview/start y terminate bajo el login heredado real.
- `./init.sh` completo pasó: TypeScript, Go, Ruby 3.2.11 (241/2230), contrato Ruby (3/1029), Rubocop y RBZ.
- `GOFLAGS='-p=1 -parallel=1' scripts/pilot-gate.sh --fresh-container` pasó sin skips.
- Prueba directa del read model pendiente: una organización con `active_admin_count=1`, settings=1 y entitlements=1 para el owner produjo team_state=0, settings=0 y entitlements=0 bajo el mismo runtime login con el contexto org-less que establece `PlatformAdminMiddleware`.

## Revisión de P0 anteriores

- [x] `app_session_is_runtime()` reconoce miembros seguros heredados de `granete_app` y excluye superuser, bypass, create-role/create-db y owner de `organizations`.
- [x] Invocaciones directas no autorizadas de create, metadata y transition quedan denegadas.
- [x] Platform lifecycle usa `AuthorizedOrganizationIDs` sin convertir el actor platform en tenant actor.
- [x] Los locks de Organization/offboarding atraviesan commands acotados y el flujo HTTP completo pasa.
- [x] Factory provisioning conserva success, rollback, retry y replay.

## Cambio requerido

1. **[P1] GET readiness y GET entitlements de Platform no autorizan el target bajo RLS.** `HandleOrganizationReadiness` llama el service con `r.Context()` sin establecer `AuthorizedOrganizationIDs` (`backend-go/internal/api/organization_lifecycle.go:180-191`), y `GetReadiness` consulta directamente team state, settings y entitlements (`backend-go/internal/application/organizations.go:268-273`; `backend-go/internal/storage/organization_lifecycle.go:25-43`). Con el token Platform org-less, RLS oculta las tres filas y el endpoint responde un readiness falso. El branch GET de `HandleOrganizationEntitlements` tiene el mismo defecto (`backend-go/internal/api/organization_lifecycle.go:299-313`; `backend-go/internal/storage/organizations.go:1300-1314`) y termina como error aunque la fila exista. Aplicá al target exacto el mismo contexto acotado que ya usa offboarding preview, y agregá pruebas HTTP + PostgreSQL para ambos GET que comparen la respuesta con filas owner-visible; incluí un target inexistente/ajeno para conservar fail-closed.
