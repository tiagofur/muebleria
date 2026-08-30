# Review — feature F195

**Veredicto:** SUPERSEDED — CHANGES_REQUESTED en re-review de `7703f0e8`

> Esta aprobación sólo cubría el implementation head `1d1c90cb`. La revisión posterior del
> head de cierre `7703f0e8` encontró gaps reproducibles de schema NativeLayout, coherencia de
> hardware semántico sin preview y transporte tipado 405/415. F195 volvió a `in_progress` y
> requiere un nuevo artifact independiente antes de cerrarse otra vez.

## Checkpoints

- C1: [x] `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS=-p=1 ./init.sh` termina verde en `1d1c90cb`; harness, TypeScript, Go, Ruby/RuboCop y RBZ pasan.
- C2: [x] Existe una sola feature `in_progress` y `progress/current.md` describe F195 hasta el cierre posterior a esta aprobación.
- C3: [x] TypeScript conserva tipos/validación pura, Go mantiene la autoridad de resolución/manufactura y Ruby sólo consume el resultado fail-closed; no se mueve drilling, joints ni preflight autoritativo al host.
- C4: [x] Schema JSON, fixture compartido, pruebas TS/Go/Ruby, negativos de transporte y TestUp real prueban el boundary completo; no queda evidencia únicamente declarativa.
- C5: [x] El implementation tree estaba limpio y pushed antes del artifact: `HEAD == origin/codex/477-rich-authoring-resolve == 1d1c90cb209516b27a8b0985a3deb300c45d775d`; PR #481 apunta a `main` y los seis checks remotos están verdes.

## Diseño UI/UX

No aplica: F195 no modifica pantallas, CSS ni interacción HtmlDialog; define el contrato que consumirán #467/#468.

## Verificación de defectos previos

- **Snapshot y pin:** una única lectura `GetFullCatalog` selecciona la definición y alimenta revisión + resolve; el pin incorpora reglas industriales versionadas y no existe `latest` implícito.
- **Contrato cross-runtime:** `contracts/sketchupAuthoringResolve.schema.json` gobierna request, accepted/rejected, issues y unions; Ajv valida el corpus Go y TS/Ruby lo consumen fail-closed.
- **Determinismo:** `precisionMm` es step real; el escenario compartido `10-unicode-quarter-step` prueba `0.25`, identidad no ASCII y fingerprint SHA-256 UTF-8 recomputado por TS desde respuesta Go.
- **Transporte:** content type, EOF estricto, RFC3339, límites, query params, schema/version y método fallan con códigos estables. El test de 405 atraviesa `RegisterRoutes`, evitando el bare 405 de `ServeMux`.
- **Ruby/host:** snapshot, preflight subset, issues/severity, números, provenance, correlación y coherencia layout/snapshot/placements se validan antes de mutar. TestUp prueba accepted atomic rebuild y cuatro rechazos sin mutación.
- **Alcance honesto:** v1 sólo proyecta parámetros dimensionales declarados por la definición actual; la proyección tipada general está separada en #483. `Module` no tiene lifecycle active/inactive, por lo que una definición retirada se representa honestamente como ausente (`CATALOG_REFERENCE_MISSING`).
- **Persistencia/seguridad:** el handler es stateless, no escribe business records ni receipts; la allowlist POST de extensión queda explícitamente transitoria y #460 conserva la capability final/commercial gate.

## Evidencia ejecutada

- `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS=-p=1 ./init.sh` — verde: 94/1179 domain TS, 11/174 storage, 20/93 excel, 147/1457 UI, 26/326 web; backend Go completo; Ruby 239/2197 + boundary 3/1029; RBZ determinista.
- `go test ./internal/api ./internal/domain/engine -run 'AuthoringResolve|IndustrialRules|RoundToPrecision|Fingerprint' -count=1` — verde.
- `pnpm exec vitest run src/sketchupAuthoringResolve.test.ts src/sketchupAuthoringResolve.contract.test.ts src/sketchupAuthoringResolve.schema.test.ts` — 23/23 verdes.
- `bundle exec ruby -Itest -Isrc test/unit/authoring_resolve_contract_test.rb` — 38 runs, 344 assertions, verde.
- TestUp SketchUp 26.2.242 / Ruby 3.2.2 contra RBZ instalado `17ae1bfa3f7c4cb613e0a93d48178b85ceca47f6b0461afd5f5ae618ed0c9e47` — 5/5, 50 assertions, ligado a `1bd72f65511d4c384cb2b96cdd50158bc9b5d8d5`.
- `git diff --check origin/main...HEAD` — verde; local/remoto sin divergencia.
- PR #481 readback: base `main`, head `1d1c90cb`, mergeable; `type:feature` + `size:exception`; los seis checks CI en `SUCCESS`.

## Cambios requeridos

- Publicar en el schema todos los campos visuales/PBR que `engine.LayoutComponent` puede emitir y probarlos cross-runtime.
- Permitir que placements manuales semánticos sin preview no aparezcan en la proyección visual `layout.hardware`.
- Conservar `METHOD_NOT_ALLOWED` y `CONTENT_TYPE_UNSUPPORTED` al interpretar 405/415 en Ruby.
- Regenerar golden, repetir TestUp real y someter el nuevo head a revisión independiente.
