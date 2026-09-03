# Implementación #386 — DT-2: QuoteLine ↔ FurnitureInstance

- **Fecha:** 2026-09-02 (America/Mexico_City)
- **Feature:** F205 · ledger `feature_list.json`
- **Autoridad:** `docs/architecture/project-design-digital-thread.md` §§4, 6,
  15–16, 25.1, 25.3, 26, 28, 30–31 · ADR-0003 · `docs/architecture/domain-model.md`
- **Estado:** COMPLETE (pending review/merge)
- **Base:** `main@d0749175` (#385 DT-1 mergeado vía PR #538).

## Qué se implementó

El mundo comercial puede responder de forma autoritativa **qué unidades físicas
representa cada línea de cotización**. `QuoteLine.quantity` sigue siendo
agrupación comercial; cada unidad física conserva su propio
`FurnitureInstance.id` (I2). FurnitureInstance sigue siendo Project-owned: la
cotización sólo referencia esa identidad (ADR-0003).

### Representación equivalente (§4 permite adaptar nombres físicos)

No existe aún un agregado `Quote`/`QuoteRevision` persistido (auditoría del
modelo actual): la verdad comercial de hoy es `project_items` (module +
quantity por proyecto) y la aceptación es `projects.status`
(`accepted`/`produced`). La relación se ancla ahí sin crear un modelo comercial
paralelo (anti-pattern 4):

- **QuoteLine** = `project_items` (id estable, module, quantity).
- **QuoteRevision aceptada** = proyecto `accepted`/`produced` (verdad
  comercial fijada).
- Cuando la familia revisionada de SalesQuote aterrice, añade su FK aquí y
  migra el ancla con autoridad explícita; el contrato conceptual
  (quoteRevisionId, quoteLineId, furnitureInstanceId) no cambia.

### Persistencia — `db/migration/000112_quote_line_furniture_instances`

- `quote_line_furniture_instances`: `organization_id` (= projects.owner),
  `project_id`, `quote_line_id`, `furniture_instance_id` **UNIQUE** (una
  unidad es representada por a lo sumo una línea activa; re-quote (#388) debe
  deslinkear primero), `created_at`.
- **Cross-project estructuralmente imposible**: FKs compuestas
  `(quote_line_id, project_id) → project_items(id, project_id)` y
  `(furniture_instance_id, project_id) → furniture_instances(id, project_id)`
  + unique indexes `(id, project_id)` en ambas tablas padres. Una línea del
  proyecto A no puede referenciar una instancia del proyecto B ni por SQL
  directo.
- FK a project_items `DEFERRABLE INITIALLY DEFERRED`: el PUT de proyecto que
  re-inserta los mismos IDs de items (replaceProjectItemsTx) sigue funcionando;
  eliminar una línea materializada **falla loud** en COMMIT si el guard tipado
  no atrapó el caso antes.
- RLS desde la primera migración: clasificación `explicitly-shared`; policies
  separadas read/insert/delete. **Immutabilidad comercial estructural**: las
  policies INSERT/DELETE exigen `app_project_quote_mutable(project_id)`
  (status en `draft|quoted`) Y `organization_id = app_current_organization_id()`
  — un proyecto aceptado/producido no puede ganar ni perder links ni por SQL
  directo con rol app, y la contraparte sales/manufacturing puede leer pero no
  mutuar links. Grants `SELECT, INSERT, DELETE` (sin UPDATE: un link es un
  hecho inmutable). Inventory + trigger de ownership.
- Down migration completa (tabla + función + índices ancla).

### Materialización — `internal/storage/quote_line_furniture_instances.go`

`MaterializeQuoteLine` converge las unidades activas linkeadas a
`project_items.quantity`:

- **menos que quantity** → crea el delta con `origin='quote'` reutilizando
  `CreateFurnitureInstance` de #385 (validación de catálogo/ownership + audit
  `furniture_instance_created` por unidad) y linkea.
- **más que quantity** (decrease en draft) → retira el excedente **más nuevo**
  (orden estable `created_at,id`; las identidades más tempranas sobreviven)
  con lifecycle terminal `cancelled` + unlink. **Nunca DELETE físico, nunca
  reciclaje**: materialize sólo INSERTa identidades nuevas.
- **links huérfanos** (instancia removida explícitamente vía #385 `:remove`)
  se deslinkean y la cantidad se recubre con una identidad nueva.
- **Idempotente por convergencia**: segunda ejecución con el mismo estado es
  no-op (listas created/cancelled/unlinked vacías). Retry HTTP con la misma
  `Idempotency-Key` reproduce la respuesta almacenada (`RequireIdempotency`
  durable); una key distinta converge sin duplicar.
- **Concurrencia exacta**: `pg_advisory_xact_lock` por línea serializa
  comandos concurrentes con keys distintas → exactamente `quantity` unidades
  (probado).
- **Aceptación**: status `accepted`/`produced` → error tipado
  `ErrQuoteRevisionAccepted` (HTTP 409 CONFLICT) en ambas direcciones. No hay
  mutación in-place de una revisión aceptada; los cambios posteriores
  requieren una nueva revisión (ChangeOrder/futuro).
- **Historia durable**: hook `quoteLineInstanceDurableHistory` — hoy bloquea
  retirar unidades que este flujo no creó (origin != 'quote'); #387+ DEBE
  extenderlo con referencias de DesignRevisionItem, revisiones aceptadas y
  producción. La identidad con historia durable sobrevive; nunca se recicla.
- **Audit durable**: `quote_line_furniture_materialized` (con
  created/cancelled/unlinked ids exactos) en la misma transacción tenant.

### Guards en el flujo existente de proyectos

- `replaceProjectItemsTx` y `RemoveProjectItem` validan antes de borrar items
  si alguna línea aún representa unidades materializadas → error tipado
  `ErrQuoteLineStillMaterialized` (409). Un PUT normal que conserva los IDs de
  items sigue funcionando (probado end-to-end); el FK deferido es el backstop
  estructural.
- Fix mínimo contenido en `loadProjectItems` (deuda preexistente
  desbloqueada por este trabajo): las queries anidadas de choices corrían con
  el result set de items abierto, lo que falla con `conn busy` dentro de la
  transacción tenant que AuthMiddleware aplica a toda request. Ahora los items
  se bufferean antes de cargar choices.

### API — `internal/api/quote_line_furniture_instances.go` + OpenAPI generado

- `GET /api/projects/{projectId}/quote-lines/{quoteLineId}/furniture-instances`
  — responde qué unidades representa la línea (DTO con `furniture_instance`
  embebido).
- `POST /api/projects/{projectId}/quote-lines/{quoteLineId}:materialize` —
  comando idempotente de convergencia; sin body: la identidad es
  server-authoritative (sin inputs de instancia del cliente). Response
  `MaterializeQuoteLineFurniture` con el estado post-comando.
- Contratos en `contracts/openapi/granete-api.v1.yaml` (schemas
  `QuoteLineFurnitureInstance`, `MaterializeQuoteLineFurniture`, parámetro
  `QuoteLineId`) con clientes TS/Go generados (`pnpm openapi:generate`) — sin
  DTO manual paralelo. Errores tipados existentes (NOT_FOUND/FORBIDDEN/
  CONFLICT/VERSION_CONFLICT/BAD_REQUEST).

## Pruebas (PostgreSQL real, rol app real)

| Prueba | Prueba de |
|---|---|
| `TestQuoteLineFurniture_MigrationFreshAndUpgrade` | fresh + upgrade fixture 111→112; inventory, FORCE RLS, 3 policies, FK deferible, uniques compuestos, función mutable ejecutable, grants SELECT/INSERT/DELETE sin UPDATE |
| `TestQuoteLineFurniture_MaterializationLifecycleAndAudit` | **negative proof central: qty 3 → exactamente 3 IDs únicos**; qty 1; idempotencia (no-op); increase 2→4 preserva IDs y agrega sólo delta; decrease 4→2 retira las más nuevas (cancelled v2, identidad sobrevive, unlink); increase post-decrease crea IDs NUEVOS (nunca recicla); unlink de instancia removida + recubre cantidad; accepted/produced → `ErrQuoteRevisionAccepted` en ambas direcciones con links intactos; línea random/wrong-project → 404 storage; manufacturing lee pero no materializa; RemoveProjectItem/PUT que dropea línea materializada → typed conflict; PUT que conserva IDs funciona; FK deferido: delete+reinsert mismo ID pasa, delete sin reinsert falla en COMMIT; cross-project imposible por FK compuesta; audit con actor/org exactos y un evento `furniture_instance_created` por unidad |
| `TestQuoteLineFurniture_ConcurrentMaterializationConverges` | dos comandos concurrentes (keys distintas) → exactamente 3 unidades activas |
| `TestTenantRLS_QuoteLineFurnitureDirectSQLCrossOrg` | SELECT sin filtro no cruza orgs; INSERT en proyecto aceptado denegado por policy (immutabilidad estructural); DELETE en aceptado → 0 filas; INSERT cross-org / org equivocada → WITH CHECK; UPDATE sin grant; DELETE cross-org → 0 filas; manufacturing (org B) lee el proyecto compartido pero no puede delete/insert; owner en draft sí puede |
| `TestQuoteLineMaterializeHTTP_Postgres` | HTTP real: qty 3 → 3 únicos; misma Idempotency-Key → replay (`Idempotency-Replayed`) sin duplicar; key distinta → no-op convergente; GET lista; línea random → 404; manufacturing → 403 materialize / 200 lista; accepted → 409 CONFLICT tipado con links intactos |
| `internal/api/quote_line_furniture_instances_test.go` | role guards, DTO generado snake_case, mapping de errores tipados (accepted → 409 CONFLICT), command router |

## Invariantes preservadas (I2/I3/I10)

- **I2** — `quantity=N` materializa N identidades únicas asignadas por la BD;
  el comando no acepta ningún input de identidad (sin line-id-as-identity,
  array index, definition o nombre). Negative proof explícito en tests.
- **I3** — aceptación comercial (status accepted/produced) congela la
  materialización: error tipado en API/storage Y policies RLS bloquean
  INSERT/DELETE de links por SQL directo. No hay mutación in-place.
- **I10** — nada aquí muta silenciosamente cotizaciones o revisiones: el
  decrease sólo actúa en draft y sobre unidades sin historia durable; el
  increase nunca reemplaza identidades existentes.

## Quote-first flow (objetivo de demo)

`QuoteLine → materialize → FI-001/FI-002/FI-003`: las identidades quedan
persistidas en `furniture_instances` con origin `quote` y son consumibles por
`GET /api/projects/{projectId}/furniture-instances` (#385) — #387
Design/DesignRevision y SketchUp consumen exactamente esos IDs sin crear
identidades nuevas (probado: los IDs materializados aparecen en el listado
del proyecto).

## No implementado (explícito)

- #387 Design / DesignRevision / DesignRevisionItem / working copy / publish.
- #388 re-quote/link de instancias existentes (design-first hacia quote).
- SketchUp: Ruby, plugin, HtmlDialog, pairing, persistent_id, placements.
- #392 reconciliation (`quoted_not_modeled` etc.): sólo quedan los datos
  (relación activa + lifecycle) para computarla después.
- ProductionRelease, machining, DXF, hardware/Blum, Gate B, SEC-8/9,
  Sales Network, refactors generales.

## Verificación

- `GOFLAGS='-p=1' go test ./... -count=1` (PostgreSQL real 5445): verde,
  incluidas las suites nuevas y pilotreadiness (HTTP real).
  - Nota ambiental preexistente (verificada idéntica en `origin/main`): con
    `DATABASE_URL` de superuser los tests de `internal/config` exigen también
    `MIGRATION_DATABASE_URL` separado; con DSN de app-role, 4 tests legacy de
    hardware/material migran vía `DATABASE_URL` y requieren superuser. Sin
    relación con #386.
- `pnpm openapi:check`: sin drift (con negative proofs de operación).
- `pnpm typecheck`: verde. `pnpm test` (monorepo): verde.
- `git diff --check`: limpio.
- Gate A (`scripts/foundation-gate-a.sh`): ver PR (sin cambios en los 34
  proofs de Foundation; la familia nueva no altera ningún proof existente).
