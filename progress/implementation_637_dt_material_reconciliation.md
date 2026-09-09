# Implementation #637 — DT Material Reconciliation

- Base: `origin/main` `c40618688dd874e80aea8817e4c47e6615a0c3c0`
- Branch: `fix/637-dt-material-provenance-reconcile`
- Issue: #637 (`[P0][BUG][DT-MAT] Repair quoted materials missing from existing working snapshots`, OPEN, `status:approved`)

## Root cause (Phase 1, pre-edit)

Pre-#621, la colocación de una unidad existente nunca sembraba los acabados
cotizados (`placement_inputs` sembraba sólo parámetros) y
`buildInitialQuoteItems` ponía siempre `MaterialChoices = {}` en la revisión
inicial de cotización. El confirm merge conserva verbatim las choices de un
item existente y el publish copia el working copy verbatim a la revisión: nada
re-siembra desde la cotización, por lo que `material_choices = {}` se congela
en el working copy y en R1→R3 para unidades ya conectadas. La verdad cotizada
sigue viva en `project_item_choices` de la línea current (la misma autoridad
que #621 expone como `display.material_choices` y snapshottea en revisiones
nuevas).

## Authority model

- quoted: línea de cotización current (`project_item_choices` vía
  `quote_line_furniture_instances.state='current'`).
- authored: `design_working_items.material_choices` (verdad de diseño; el
  publish la copia verbatim).
- effective/default: NO existe default material server-side para roles de
  tabla (`engine.ResolveMaterial` falla cerrado); la única herencia probable
  es el alias legacy (ZOCLO/PUERTA/PUERTA_*/FRENTE_CAJON ← FRENTE). Los
  defaults visuales de SketchUp son estado local del host, nunca verdad del
  server.
- historical: `design_revision_items` inmutable; la reconciliación #393
  compara revisiones exactas y nunca muta.

## Diseño entregado

1. **Clasificador puro** (`engine/material_provenance.go`):
   `authored | quoted_missing_from_working | inherited_default |
   missing_unresolved` por rol (unión working ∪ quoted). EffectiveChoice sólo
   cuando el server puede probarlo (authored o alias). `ReconcilableMaterialChoices`
   devuelve SOLO los candidatos (faltantes y no gobernados por alias).
2. **Detección read-only** `GET /api/designs/{designId}/working-copy/material-provenance`:
   storage `GetDesignWorkingCopyMaterialProvenance` (un solo query LATERAL por
   snapshot; leer nunca repara).
3. **Comando explícito** `POST /api/designs/{designId}/working-copy/material-choices:reconcile`
   (`RequireIdempotency("design.reconcile-working-materials")`):
   design + furniture instance exactos, `expected_updated_at` opcional
   (optimistic concurrency a microsegundos bajo el lock del design row FOR
   UPDATE — el mismo punto de serialización que el PUT/reset), llena SOLO los
   roles candidatos, preserva authored/alias, bump de
   `design_working_copies.updated_at/by`, audit durable
   `design_working_copy_materials_reconciled` en la MISMA tx. No-op idempotente
   honesto (sin mutation, sin bump, sin audit). Fail-closed: design
   desconocido/no-activo, instancia de otro proyecto, instancia no colocada,
   tenant cruzado, token stale.
4. **SketchUp**: sin autoridad local; el plugin ya relee el working copy
   (panel/publish) y el merger conserva verbatim las choices reconciliadas.

## Evidence

- Go: `go test ./... -count=1` verde completo.
- PostgreSQL real (`internal/storage/design_material_provenance_test.go`):
  detección de candidatos, authored nunca sobrescrito (quote distinto),
  multi-rol (faltantes llenos + existentes preservados + ZOCLO protegido por
  alias FRENTE), sin invención (unidades sin quote/unplaced), fail-closed
  (cross-project, RLS-invisible, unplaced, design random), tenant isolation
  (org B denegado), retry idempotente (sin bump/audit), optimistic
  concurrency (stale → ErrVersionConflict), R1–R3 lógicamente idénticas
  (snapshot parametrizado congelado antes/después) y R4 como primera revisión
  con las choices reconciliadas.
- API: contract shape snake_case, 404/409/400/401 tipados, `expected_updated_at`
  parseado y plomeado al comando.
- OpenAPI: `pnpm openapi:generate` + `pnpm openapi:check` verde (sin drift);
  codegen Go/TS regenerado.
- Ruby: `bundle exec rake unit` 643 runs / 4,440 assertions 0F/0E/0S;
  `bundle exec rake boundary` 6 runs / 2,531 assertions 0F/0E/0S; rubocop
  limpio en los archivos tocados. Dos pruebas nuevas: working copy reconciliado
  → resolve con las choices exactas → confirm las conserva verbatim; espejo
  negativo: item histórico vacío NO se rellena localmente en el confirm.
- TS: `pnpm typecheck` y `pnpm test` (monorepo, exit 0) verde.

## NOT PROVEN

- Real-host SketchUp 2026 smoke (abrir design conectado, reconciliar desde
  web/backend, refresh, publicar R4, verificar R1–R3): NO ejecutado. Sin
  claim real-host; clasificado NOT PROVEN.
- React UI: sin superficie nueva por scope (el comando es explícito vía API;
  el workspace #502 compara revisiones, no working copies).

## Delta

- Lógica Go autorada: ~727 líneas (dentro de 300–800).
- Contrato OpenAPI autorado: +242 líneas (superficie generada obligatoria
  #496: 2 paths + 5 schemas) → total autorado ~969, EXCEDE el techo ~900;
  reportado explícitamente en el PR. Tests: ~940 líneas Go/Ruby + codegen
  regenerado (+90).
- Sin migraciones (repara tablas existentes), sin tocar #636/artifact URLs.

## Rollback

Revert del PR completo. No hay migración ni dato irreversible: el working copy
mutado por reconciliación es recuperable vía `working-copy:reset` a la revisión
base; R1–R3 nunca cambian.
