# Implementación #394 / DT-10 — Classify reconciliation impact + explicit re-quote

- Fecha: 2026-09-03 (America/Mexico_City)
- Modo: Demo Commercial Rescue
- Base: `main` @ `316df57c` (PR #549 / #393 DT-9 mergeado)
- Rama: `feat/394-impact-classification-requote`

## Qué se implementó

Evolución del `ReconciliationResult` de #393 hacia clases semánticas
accionables (`commercial`, `manufacturing`, `spatial` — NO exclusivas) y el
flujo explícito de re-quote que crea una nueva `QuoteRevision` draft desde una
cotización aceptada sin reescribirla jamás.

### Dominio puro (`backend-go/internal/domain/`)

- `reconciliation_impact.go`: `ClassifyReconciliation(recon) ->
  ImpactClassificationResult`. Consume el resultado EXACTO de #393 (no
  recompara snapshots: imposible que diverja de la reconciliación). Política
  central `ClassifyDifferencePath(path)`:
  - `furnitureDefinitionId`, `definitionVersion`, `parameters.*`,
    `materialChoices.*` → commercial+manufacturing (V1: estos inputs
    determinan completamente la resolución de BOM; el fingerprint resuelto
    llega con #395);
  - `transform.*`, `room` → spatial-only;
  - path desconocido → fail-closed commercial+manufacturing.
- Semántica por status: `modeled_not_quoted` → commercial+manufacturing;
  `quoted_not_modeled` → commercial only (la verdad de manufactura vive en el
  diseño, que no reporta delta); `synced`/`removed`/`conflict` → sin impacto
  per-item. `removed` es informativo: ya está reflejado en el snapshot
  comercial base.
- `requiresRequote` se DERIVA (`exists commercial impact`), nunca es flag
  independiente ni user-set. `conflict` ⇒ `requiresResolution=true`,
  `canRequote=false` (fail-closed).
- Evidencia espacial: `CommercialItemSnapshot` gana `Transform`/`RoomID`
  opcionales (solo in-memory; NUNCA se persisten — §20). `Reconcile` compara
  espacial SÓLO cuando AMBOS lados llevan evidencia explícita (exactamente lo
  que el comentario de #393 anticipaba); un lado sin evidencia no produce
  diferencia (§42 preservado, sin inventar transform comercial NI espacial).
- `requote.go`: `BuildRequoteDraft(quote, design, recon, plan)` puro.
  Reglas por status:
  - `synced` → quote verbatim;
  - `modified` con impacto comercial y seleccionado → valores del diseño
    (misma identidad); spatial-only o no seleccionado → quote verbatim;
  - `modeled_not_quoted` seleccionado → incorporado desde el diseño con la
    MISMA identidad (nunca se acuña FI nueva);
  - `quoted_not_modeled` → se conserva verbatim (unidad vendida no se borra;
    queda pending placement);
  - `removed` → verbatim con lifecycle terminal (nunca resucita);
  - `conflict` → error.
  El plan `Include` (nil = incorporar todo) restringe la incorporación; una
  selección que no incorpora nada se rechaza. El builder deep-copia y strip
  transform/room/locators técnicos del output (snapshot puramente comercial).

### Storage (`backend-go/internal/storage/`)

- `RequoteProjectQuote` (`requote.go`): una transacción (`WithinTenantTx`) —
  carga snapshots exactos → `Reconcile` → `BuildRequoteDraft` (clasifica
  server-side) → `CreateQuoteRevision` de #393 (Status=draft,
  SourceType=requote, items atómicos, concurrency fail-closed de base) →
  audit `quote_revision_created_from_design` en la MISMA tx → commit. Sin Q4
  parcial.
- `CreateQuoteRevision` extendido con provenance
  (`base_quote_revision_id`, `source_design_revision_id`); fail-closed si un
  requote llega sin provenance exacta. `loadReconciliationInputs` extraído y
  compartido con `ReconcileProject` (una sola carga fail-closed).
- Ownership: sólo la organización dueña del proyecto puede requotear
  (`ErrFurnitureInstanceProjectNotWritable` para shared-read).

### Migración 000117 (`quote_revision_requote_provenance`)

- Columnas `base_quote_revision_id` / `source_design_revision_id` en
  `quote_revisions`, FKs compuestas al mismo proyecto (provenance cross-project
  estructuralmente imposible), índices, y trigger endurecido: la provenance es
  inmutable una vez escrita. Down restaura el trigger 000116 y dropea columnas.
- Fresh + upgrade probados (`TestRequote_ProvenanceMigration_FreshAndUpgrade`).

### API / contrato

- `POST /api/projects/{projectId}/quote-revisions:requote` (operationId
  `requoteProjectQuote`) detrás de `RequireIdempotency("quote.requote", ...)`:
  el retry repele la MISMA revisión, nunca acuña Q5. RBAC:
  `RoleCanMutateProjects` (quote:edit). Request: `baseQuoteRevisionId` +
  `designRevisionId` exactos (nunca `latest` implícito) + selección opcional
  `includeFurnitureInstanceIds`. Response 201 con la revisión creada +
  clasificación.
- El response de `POST /projects/{projectId}/reconciliation` (#393) gana
  `impact` por diferencia, por item y a nivel resumen (aditivo) — una sola
  autoridad de clasificación compartida backend/superficies; la UI no
  bifurca reglas.
- Contract fixture: `contracts/reconciliationImpact.json` (escenario demo
  completo) consumido por
  `domain/reconciliation_impact_contract_test.go` con prueba de
  determinismo.

## Decisiones y boundaries

1. **Clasificación por paths, no por fingerprints paralelos**: la política
   path→impacto ES el "contrato normalizado de comparación" por grupo
   semántico (§15 permite fingerprints O equivalente). Un mecanismo de
   fingerprint paralelo podría divergir de `compareItems` (p. ej. definición
   one-sided: #393 no emite diff, un fingerprint sí diferiría) — eso crearía
   exactamente las "reglas en conflicto" que la issue prohíbe.
2. **Espacial demo vs persistido**: el flujo persistido jamás produce diffs
   espaciales (quote_revision_items no tiene transform/room por contrato
   §20), por diseño fail-closed. La capacidad espacial-only existe y está
   fijada por contrato cuando un consumidor legítimo aporta evidencia en
   ambos lados (p. ej. futuro ChangeOrder con provenance de colocación).
3. **Pricing boundary (#394 §§25–27)**: `QuoteRevision` no lleva precios
   (diseño de #393); el pricing del proyecto vive en `engine`/QuoteBreakdown.
   El requote crea el snapshot de configuración comercial; recalcular precio
   es el flujo comercial del proyecto, no la revisión. No se inventaron
   valores.
4. **Design revision de cualquier status como fuente**: exactitud por ID
   explícito (§18); el usuario reconcilió exactamente ese par. La
   concurrencia que importa es la base comercial (CreateQuoteRevision
   fail-closed).
5. **conflict unreachable en storage**: las constraints DB (unique
   revision+instance, FKs) hacen imposible persistir duplicados/IDs
   malformados; el guard fail-closed se prueba a nivel dominio.

## Invariantes tocadas (I1–I14)

- I3/I4 (inmutabilidad): Q3 accepted queda byte-idéntico (storage test);
  provenance inmutable por trigger.
- I7 (reconciliation detecta, nunca muta): clasificación read-only pura.
- I10: decoración/espacial no entra al snapshot comercial.
- Identidad: FIs conservan su ID en el requote (nunca se acuña nueva).

## Verificación

- `go test ./internal/domain/ ./internal/api/` — verde (clasificación,
  requote, handler, mapping de errores).
- `go test ./internal/storage/ -run TestRequote_` — verde contra PostgreSQL
  real bajo app role (7 tests: integridad de Q3, stale base, synced/move
  rechazados, selección, RLS multi-org, provenance fresh+upgrade).
- `pnpm openapi:generate` + `pnpm openapi:check` — verde (Go + TS generados).
- Contract fixture determinista verde.
