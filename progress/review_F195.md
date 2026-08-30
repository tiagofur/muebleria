# Review — feature F195

**Veredicto:** APPROVED

## Checkpoints

- C1: [x] El harness está completo y `PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS=-p=1 ./init.sh` termina verde en `051512f3` contra una base PostgreSQL aislada migrada desde cero.
- C2: [x] Existe una sola feature `in_progress`; `progress/current.md` describe F195 y conserva el cierre del ledger para después de esta aprobación.
- C3: [x] Go mantiene la autoridad semántica/manufacturera, TypeScript valida el wire canónico y Ruby consume el NativeLayout fail-closed sin inventar geometría, materiales, hardware ni machining.
- C4: [x] Fixture Go, JSON Schema/Ajv, parser TS, parsers Ruby y TestUp real cubren los tres defectos de `7703f0e8` con pruebas positivas y negativas.
- C5: [x] El implementation tree estaba limpio y pushed antes del artifact: `HEAD == origin/codex/477-rich-authoring-resolve == 051512f344ac7aa25a75700cd5d16f92a360e1ce`; PR #481 apunta a `main`, está `CLEAN` y los seis checks remotos están verdes.

## Diseño UI/UX

No aplica: el cambio no modifica pantallas, CSS ni interacción HtmlDialog; corrige el contrato y el boundary de rebuild que consumirán #467/#468.

## Verificación de los gaps de `7703f0e8`

- **NativeLayout visual/PBR:** el schema declara image, texture, tile, roughness, metalness, clearcoat y grain; el escenario Go `11-material-pbr-roundtrip` atraviesa Ajv, `parseAuthoringResolveResponse` y `LayoutContract`. Accepted correlation/revision son no vacías, rejected exige issues y holes restringe face/coordenadas igual que Ruby.
- **Hardware semántico sin preview:** `12-cost-only-manual-hardware` conserva `hp-cost-only-01` en `normalizedSnapshot` y en el fingerprint recomputado Go↔TS, pero lo omite sólo de `layout.hardware`. Ruby exige que todo placement visual sea un subset coherente del snapshot, no igualdad inversa. TestUp demuestra que el rebuild atómico sigue siendo válido.
- **405/415 tipados:** Ruby parsea ambos statuses, admite correlación vacía únicamente para rechazos pre-body cerrados y conserva `METHOD_NOT_ALLOWED` / `CONTENT_TYPE_UNSUPPORTED` dentro de `AuthoringResolveError.issues`.

## Evidencia ejecutada

- Go enfocado: `go test ./internal/api ./internal/domain/engine -run 'AuthoringResolve|IndustrialRules|RoundToPrecision|Fingerprint' -count=1` — verde.
- TypeScript enfocado: resolve, fixture y schema — 25/25 tests verdes.
- Ruby enfocado: authoring resolve 40 runs/377 assertions y layout contract 14/57 — verde.
- Gate completo aislado: `DATABASE_URL=<isolated-review-db> PATH="$HOME/.rbenv/shims:$PATH" GOFLAGS=-p=1 ./init.sh` — verde; TS 94/1181 domain, 11/174 storage, 20/93 excel, 147/1457 UI, 26/326 web; Go completo; Ruby 241/2230 + boundary 3/1029; RBZ determinista.
- Baseline PostgreSQL: en la DB compartida, el único fallo fue `TestPostgresIdempotencyClientErrorRollsBackMutationAndReplaysAfterSQLError` por `organizations.active`; se reprodujo idéntico en un worktree detached de `origin/main@d66baf13`. La misma prueba y luego `./init.sh` completo pasan contra la DB aislada migrada sólo con las migrations del head, confirmando contaminación externa de schema y no regresión del PR.
- TestUp oficial `TestUp::CIJsonReporter`: SketchUp 26.2.242 / Ruby 3.2.2, 6/6, 58 assertions, 0 failures/errors/skips; RBZ `7c82a347863c46607c4712b6552f864f0c70b4cc69fb169307bac24c04d0ebd0`, source `8433cbdfad2649f606273ef8e9147d29b625aa81`, installed tree = source.
- `git diff --check origin/main...HEAD` — verde; local/remoto sin divergencia.
- PR #481: base `main`, head `051512f3`, `MERGEABLE/CLEAN`, `type:feature` + `size:exception`; seis checks CI en `SUCCESS`.

## Cambios requeridos

Ninguno.
