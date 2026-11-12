# odd/tasks/1598-library-dev-mode-gate

Issue: #1598 — modo dev de biblioteca: sólo admin e ingeniero, restringido en servidor y plugin, y documentado.
Lane: Delegated Direct. Writer: sesión 11-11. Base: origin/main `f92b6efd`. Rama: `feat/1598-library-dev-mode-gate` (worktree `1598-dev-mode-gate`).

## Outcome observable

Un usuario sin rol de administración o ingeniería no puede usar el modo dev de biblioteca: el servidor rechaza con código estable el resolve sin pin que llega del plugin (`LIBRARY_DRAFT_FORBIDDEN`, 403, envelope estructurado), el menú del plugin no alterna sin la capacidad confirmada por servidor, y una sesión sin permiso no hereda un modo dev dejado encendido en esa máquina. Un taller sin release publicada sigue resolviendo contra el catálogo vivo (comportamiento actual), la web (resolves sin pin, otro cliente) no cambia, y el modo queda documentado en `docs/guia-de-uso.md` §11b.

## Decisión de diseño (por qué flag de cliente y no ausencia de pin)

«Sin pin» tiene hoy dos significados: modo dev del plugin O taller sin release publicada O **la web, que también resuelve sin pin** (`ProjectDesignsScreen`, `useProjectProfileDemand` + 2 specs Playwright). Castigar la ausencia de pin rompe la web. El gate usa entonces el cliente real del request: sólo `claims.Client == auth.ExtensionClient` pasa por la verificación; el rol sale de la membresía viva (`claims.Roles`, ADR-0005, ya re-validada por request en el middleware).

## Cambios

- **Servidor**: `RoleCanUseLibraryDraft` (admin||ingeniero, `rbac.go`) + gate en `HandleFurnitureAuthoringResolve` tras parsear el pin: extension sin pin y sin rol → 403 `LIBRARY_DRAFT_FORBIDDEN`; con rol → pasa; sin release publicada en el taller → pasa (el vivo es lo único que hay); error de lectura de release → 500 fail-closed (nunca sirve el borrador). Código nuevo en las tres listas cerradas (schema JSON, TS, Ruby) + paridad verde.
- **Sesión**: `/auth/sketchup/profile` expone `capabilities.can_use_library_dev_mode` (proyección, jamás roles; org-less la omite). OpenAPI regenerado (`SketchupProfileCapabilities`), drift-check verde.
- **Plugin**: `toggle_library_dev_mode` exige la capacidad para ON (OFF siempre permitido, mensaje honesto «DENIED»); `connection_status` revoca un modo dejado encendido cuando el perfil confirmado no tiene la capacidad (avisa una vez y vuelve al pin publicado; perfil no confirmado no toca nada — el servidor es el control); `AuthoringResolveTransport.interpret` ya no pierde los issues de un 403 estructurado (antes colapsaba todo 403 a «Licencia requerida»); `EXTENSION_VERSION` 0.1.115 → 0.1.116.
- **Docs**: guía de uso §11b (para qué sirve, cómo se usa, cómo saber que está encendido, quién puede, riesgos).

## Verificación

- V0: `check_openapi_drift` OK con negative proofs; `ci_extension_version --base origin/main` PASS (bump 0.1.116); gofmt limpio en archivos tocados; rubocop 318 archivos 0 ofensas.
- V1 Go (corredor canónico con postgres efímero, `scripts/backend-test.sh`): `TestAuthoringResolveLibraryDraftIsEngineeringOnly` (9 casos: vendedor/gerente_producción rechazados con código+envelope; ingeniero/admin/unión pasan; sin release pasa; web sin pin pasa; pin consultado jamás llega al gate; release ilegible → 500) + `TestRBAC_LibraryDraft` + perfil: vendedor `{false}` exacto, org-less omite, admin de org-2 `true`. Suite no-storage completa: PASS (resultado en el PR). Storage sin tocar (cero diff en `internal/storage`); CI corre sus 4 shards.
- V1 Ruby: `rake unit` 1497 runs / 0 failures (toggle gate ×2, revoke ×2, 403 estructurado ×2, capacidad en status, taxonomía 403) + `rake boundary` + `package:verify` (RBZ firmado). Nota: `application_test.rb` no corre aislado con `-n` por un `require` faltante de `ReleaseApiClient` PREEXISTENTE en main (la suite completa sí lo carga vía otro archivo); no se tocó.
- V2 en vivo: owner — ingeniero enciende, edita sin publicar, ve el borrador en SketchUp; usuario sin permiso no puede encenderlo y un modo heredado se apaga solo.

## Delivery

PR `Closes #1598` / Delivery: complete (código+tests+docs+CI). El vivo del owner queda como condición de cierre, no bloquea el merge.
