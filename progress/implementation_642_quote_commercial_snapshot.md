# #642 — Slice 1: Immutable commercial snapshot authority

Issue: [#642](https://github.com/tiagofur/muebleria/issues/642) —
`[P1][QUOTE-AUTH] Make exact QuoteRevision the sole commercial authority`
(Slice 1 ONLY: immutable commercial snapshot).

- Base: `origin/main@b3efd4191526010e440aafe20e80378f21615161`
- Branch: `feat/642-quote-commercial-snapshot`
- Single writer: GLM. Sin merge ni cierre de issue.
- Preflight `./init.sh`: PASS (2026-09-10).
- ⚠️ Issue #642 está OPEN pero **sin label `status:approved`** al momento de
  iniciar (a diferencia de #640/#641). La implementación fue autorizada por
  instrucción directa del owner; el preflight de publicación de PR exige el
  label antes de publicar.

## Authority inventory (pre-código)

Flujo trazado: `Project → quote calculation → priceSnapshot → QuoteRevision
creation → publish → accept → PDF/XLSX → Cotizaciones/Dashboard`.

| Campo mostrado/exportado hoy | Fuente actual | ¿Mutable? | ¿Debe congelar? |
|---|---|---|---|
| Nombre de obra | `Project.name` | Sí | Sí (identidad comercial) |
| Cliente | `customers` vía `Project.customerId` (lookup vivo) | Sí | Sí |
| Moneda | `Project.currency` | Sí | Sí |
| Estado comercial | `Project.status` (legacy) | Sí | Sí → status de revisión |
| Fecha del documento | `Project.updatedAt` | Sí | Sí → lifecycle timestamps |
| Código/nombre de módulo (línea) | `catalog.modules` lookup vivo | Sí | Sí |
| Cantidad por línea | `project_items.quantity` | Sí | Sí (unidades congeladas) |
| Resumen de opciones (línea) | optionGroups + materiales/cantos/herrajes lookup vivo | Sí | Sí |
| Totales (8 campos del breakdown) | `priceSnapshot` (cerrado) O `calcProjectBreakdown` vivo | Sí | Sí |
| Impuestos | — no existen en el modelo runtime | — | No (no inventar) |
| Descuento | tiers TS `discountTiers` — sin persistencia ni consumidores runtime | — | No (breakdown congelado ES el monto) |

Hallazgos clave:

- `quote_revisions`/`quote_revision_items` (#393/#571) ya congelan identidad,
  versión, parámetros y choices — pero **cero montos, cero descriptores
  customer-facing, cero moneda/cliente, sin `published_at`/`accepted_at`**.
- El engine Go `CalcProjectBreakdown` existe y es la autoría server-side del
  pricing (la UI no calcula dominio); `discountTiers` TS no tiene fuente
  persistida (siempre vacío en runtime) → Go/TS coinciden en la práctica.
- `priceSnapshot` legacy vive en `quote_snapshots` (por proyecto, mutable) —
  clasificado compatibility-only.

## Consumer inventory (Project.status / priceSnapshot)

Clasificación por consumidor runtime (no se cambió ninguno en Slice 1):

| Consumidor | Autoridad actual | Autoridad objetivo | Slice |
|---|---|---|---|
| `apps/web/src/exportCommercialQuote.ts` (XLSX) | Project.status + priceSnapshot/live calc | snapshot Q exacta | 3 |
| `apps/web/src/exportCommercialQuotePdf.ts` | ídem | ídem | 3 |
| `apps/web/src/exports/useExportHandlers.ts` / `AppContent.tsx` (hasSource) | priceSnapshot | snapshot Q | 3 |
| `apps/web/src/derivations/useQuoteDerivations.ts` | Project.status + priceSnapshot | QuoteRevision exacta | 2 |
| `packages/ui ProjectDetailHeader/ProjectTotalsAside/costingView` | Project.status + priceSnapshot | QuoteRevision | 2 |
| `packages/ui sales/dashboard helpers` (won/funnel/estimates) | Project.status + capturedAt | QuoteRevision + timestamps | 2 |
| `packages/ui production/*` (queue, fabric, embarques, instalaciones) | Project.status (etapas operativas) | operacional no-comercial / compat | 2 (rename presentación) |
| `packages/ui engineering` | Project.status | operacional | — |
| `apps/web/src/stores/projectStore.ts` (Enviar cotización/Aceptar obra legacy) | Project.status | QuoteRevision lifecycle | 2 |
| `packages/domain engine/pricing.ts` captureQuoteSnapshot | legacy snapshot machinery | compatibility-only | — |
| Go `handlers.go` `RedactQuoteBreakdown` (vendedor) | Project.PriceSnapshot | redacción aplicada TAMBIÉN al snapshot Q (hecho en Slice 1) | 1✓ |

## Snapshot schema (persistencia)

Migración **000130** (aditiva sobre la persistencia canónica existente — SIN
tabla paralela, SIN segundo dominio):

- `quote_revisions.commercial_snapshot JSONB NULL` — payload
  `granete.quote-commercial-snapshot.v1`: `schema`, `capturedAt`, `currency`,
  `customer {id, name}`, `project {id, name}`, `breakdown` (los 8 campos que
  el XLSX consume: materialsCost, edgeTotal, hardwareTotal, directCost,
  laborModular, laborFixedCost, marginFactor, salePrice), `units[]`
  (`furnitureInstanceId`, `moduleCode`, `moduleName`, `lifecycleStatus`,
  `options[] {groupCode, groupLabel, choiceId, choiceLabel}`).
  Cantidad por línea = conteo de unidades congeladas (identidad exacta).
- `quote_revisions.published_at`, `accepted_at TIMESTAMPTZ NULL` — eventos de
  lifecycle reales fijados por la transición que los posee; jamás derivados de
  `created_at`/`updated_at`. NULL en filas legacy = ausencia honesta.

## Estrategia monetaria

**Option B acotada** (authoritative calculated amounts): el engine de pricing
EXISTENTE corre exactamente UNA vez, server-side, dentro de la misma
transacción que crea la revisión; el OUTPUT se congela. El motor puede evolucionar
sin reescribir historia. No se congelan inputs completos ni versión de engine
como dependencia (prohibido depender del engine actual para siempre); el
marcador `schema` versiona el payload.

- Q1 (`CreateInitialQuoteRevision`): pricing del estado comercial EDITABLE
  completo (líneas con base mode/presets/pins/kitchen layout, snapshot legacy
  si el proyecto ya estaba cerrado-legacy — el engine decide, esa ES su verdad
  actual). Misma frontera de consistencia que el snapshot de items.
- Q2+ (`RequoteProjectQuote`): input sintetizado por unidad ACTIVA
  (definición + choices congeladas + dims de parámetros, `CustomDims` sólo con
  las 3 dimensiones presentes y positivas), resuelto contra el catálogo una
  sola vez a la hora del requote; status forzado draft (nunca consulta el
  snapshot legacy del proyecto). Unidades removed/cancelled quedan en `units[]`
  con su lifecycle pero no contribuyen a los totales (misma semántica que la
  cantidad comercial editable).
- Líneas no precioables (choice faltante, definición inexistente) → error
  tipado `ErrInvalidRevisionSnapshot` accionable; NUNCA precios inventados.

## Inmutabilidad

- Trigger DB endurecido (`protect_quote_revision_immutability`, 000130):
  `commercial_snapshot` inmutable una vez escrito (ni rewrite ni inyección
  NULL→valor); `published_at` fijable SOLO por draft→published (NULL→valor);
  `accepted_at` SOLO por published→accepted; superseding preserva ambos.
- Backstop fail-closed: `draft → published` con snapshot NULL es rechazado por
  el trigger (legacy no publica historia sin precio).
- Writer único (#393) `CreateQuoteRevision` persiste el snapshot validado;
  comandos de producción (initial/requote) SIEMPRE lo adjuntan; NULL sólo se
  tolera para filas legacy/estilo-legacy (seeds) que fallan cerrado en publish
  y lectura.
- `UpdateQuoteRevisionStatus` fija timestamps en la transición exacta y gate
  tipado `ErrQuoteCommercialSnapshotMissing` en draft→publish sin snapshot.

## Comportamiento upgrade legacy

- Migración aditiva: filas existentes quedan `commercial_snapshot NULL`,
  `published_at/accepted_at NULL` — NO se inventan montos ni fechas históricas.
- Publicar un draft legacy sin snapshot → `ErrQuoteCommercialSnapshotMissing`
  (409 accionable: "creá una nueva revisión") + backstop de trigger.
- Revisiones published/accepted legacy SIN snapshot: read model expone
  `commercialSnapshot` ausente (fail-closed honesto); la continuación es una
  nueva revisión (re-quote) — jamás recálculo desde Project/catálogo/settings.

## Seguridad / RLS

- Clasificación invariada: `explicitly-shared` (read project-organizations,
  write owner-organization); RLS + FORCE revalidadas por test; inventario
  actualizado (rationale + policy_version, restaurado en down).
- `GET /api/projects/{id}/quote-revisions` aplica la MISMA redacción de costos
  que el resto de la plataforma (`actorCanViewCosts` →
  `RedactQuoteCommercialSnapshot`: costos/margen a 0, `salePrice` comercial
  permanece, descriptores/moneda intactos).
- Cross-tenant: 404 uniforme (store) + RLS niega SQL directo bajo app role con
  contexto org B (probado).

## API generada

- `QuoteRevisionDetail` += `publishedAt?`, `acceptedAt?`, `commercialSnapshot?`
  (opcional — ausencia = legacy fail-closed, nunca recálculo).
- Schemas nuevos: `QuoteCommercialSnapshot`, `QuoteCommercialIdentity`,
  `QuoteCommercialBreakdown`, `QuoteCommercialUnit`, `QuoteCommercialOption`.
- `QuoteRevision` += `publishedAt?`/`acceptedAt?` (respuestas de lifecycle).
- `pnpm openapi:generate` ejecutado; `pnpm openapi:check` PASS (sin drift).
  TS (`packages/storage`) re-exporta los tipos generados — sin DTO manual.

## Tests (PostgreSQL real, cero skips)

Storage (`quote_commercial_snapshot_test.go`, 10 tests ≈ los 14 proofs):

1-2. Q1 congela valores exactos (fixture determinista: 2 unidades × 0.48 m² ×
$200/m², labor 50/u, margin 1.5, fijo 100 → materials 192 / sale 488) +
descriptores (CS-MOD/Gabinete CS, INTERIOR/Acabado interior, Tablero Roble).
3. publish/accept fijan timestamps exactos una vez; snapshot idéntico.
4-7. Mutar Project (nombre/moneda/margin/labor/status + rename cliente) y
catálogo (rename módulo/material/grupo + board_price 9999 + waste 50) → bytes
almacenados y read model IDÉNTICOS.
8-9. Q2 por requote real (design revision publicada, unidad 2 cambia a
material $400/m²) → materials 288 / sale 632 ≠ Q1; Q1 y Q2 reproducibles
independientemente tras nueva mutación.
10. Cross-tenant: org B → 404 uniforme (list + publish) + SQL directo bajo
app role con GUC org B ve 0 filas.
11. Legacy sin snapshot: publish por comando y por owner de transición fallan
`ErrQuoteCommercialSnapshotMissing`; SQL directo → trigger; fila queda draft.
12. Inmutabilidad DB: 5 UPDATEs (rewrite/NULL del snapshot, published_at,
accepted_at set/NULL) rechazados; accepted→superseded preserva todo verbatim.
13. Retry de CreateInitialQuoteRevision → `ErrQuoteRevisionConflict`, 1
revisión, snapshot intacto.
14. Publish/accept concurrentes (2 goroutines): exactamente 1 ganador, réplica
tipada, exactamente 1 audit event c/u.

Migración (`quote_commercial_snapshot_migration_test.go`): fresh + upgrade
129→130 + down (columnas eliminadas, semántica pre-#642 restaurada, inventario
revertido, RLS intacta).

API (`quote_commercial_snapshot_api_test.go`): DTO completo con costos para
admin; redacción para vendedor sin flag (costos 0, salePrice/descriptores
intactos); legacy sin snapshot → `commercialSnapshot` ausente; publish sin
snapshot → 409 accionable.

Fixtures actualizados (semántica #642, no debilitación): lifecycle tests
siembran choice BODY precioable (el módulo compuesto del fixture requiere el
rol; el pricing fail-closed es el comportamiento correcto);
`reconciliation_test` draft/draft2 llevan snapshot (publicar legítimo sigue
sintiéndose legítimo por SQL directo).

## Tamaño

- Producción nueva (SQL migración up+down, domain, storage builder): 785 líneas.
- Diffs Go en archivos existentes: +240/−38 (≈202 netas).
- Spec OpenAPI autorado: +196 líneas (los artifacts GENERADOS Go/TS quedan
  fuera del presupuesto autorado según la issue).
- Total Go+SQL autorado ≈ 987 (< tope duro 1000; rango suave 400–900
  excedido principalmente por comentarios de convención y el par up/down del
  trigger — se reporta para criterio del owner/reviewer).

## Pendiente / siguientes slices

- Slice 2 (cotizaciones UI derive de QuoteRevision exacta) y Slice 3 (PDF/XLSX
  por revisión exacta + retirement guards) NO iniciados (exclusión explícita).
- Revisión independiente requerida tras publicación del PR.

## Verificación ejecutada

- `./init.sh` PASS (preflight).
- `go vet ./...` PASS.
- `GOFLAGS='-p=1' go test ./... -count=1`: **10/10 paquetes ok, cero fallos**
  (incl. `internal/storage` 316 s sobre PostgreSQL real, cero skips).
- Focused: `TestQuoteCommercialSnapshot*` 10/10 (14 proofs) + migración
  fresh/upgrade/down + API quote surfaces PASS.
- `pnpm openapi:check` PASS (sin drift) · `pnpm typecheck` PASS.
- `pnpm test`: verde — UI 1.690, Web 442, Mobile 73, Desktop 17 (más storage/
  domain/excel en el mismo run, EXIT 0).
- Browser gate real (`scripts/organization-browser-gate.sh
  tests/organization/project-reconciliation.spec.ts`): **4/4 PASS (29.3 s)** —
  Chromium + Go + PostgreSQL efímero; el golden path comercial completo (Q1 →
  publish → accept → requote Q2 → aprobación → release → tenant isolation)
  funciona con la captura del snapshot.
- `git diff --check` limpio.

## Publicación

- Owner (tiagofur) autorizó el label `status:approved` y la excepción de
  tamaño (comentario en la issue #642, 2026-09-10) antes de publicar.
- PR: `feat(quote): freeze canonical commercial snapshot per QuoteRevision`,
  primera línea del body `Refs #642`, label único `type:feature`, sin cierre.

## Verdict

`IMPLEMENTED_PENDING_REVIEW` — PR publicado; se requiere revisión
independiente read-only antes de cualquier merge.
