# #642 — Slice 1: Immutable commercial snapshot authority

Issue: [#642](https://github.com/tiagofur/muebleria/issues/642) —
`[P1][QUOTE-AUTH] Make exact QuoteRevision the sole commercial authority`
(Slice 1 ONLY: immutable commercial snapshot).

- Base: `origin/main@b3efd4191526010e440aafe20e80378f21615161`
- Branch: `feat/642-quote-commercial-snapshot`
- Corrección de review ejecutada en la misma rama/PR. Sin merge ni cierre de issue.
- Preflight `./init.sh`: PASS (2026-09-10).
- Implementación y corrección de bloqueos autorizadas directamente por el
  owner. La sincronización final de governance/metadata queda a cargo del
  coordinador después de conocer el tamaño exacto.

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
  laborModular, laborFixedCost, marginFactor, salePrice), `lines[]`
  (`quoteLineId`, `quantity`, `furnitureInstanceIds[]`, `amounts` autoritativos
  por línea) y `units[]` (`furnitureInstanceId`, `quoteLineId`, `moduleCode`,
  `moduleName`, `lifecycleStatus`, `options[] {groupCode, groupLabel, choiceId,
  choiceLabel}`). Dos líneas visualmente idénticas conservan identidad y
  agrupación separadas; quantity coincide con sus unidades físicas activas.
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
  completo (líneas con base mode/presets/pins/kitchen layout). Nunca copia el
  `priceSnapshot` legacy, que no conserva autoridad por línea. Misma frontera
  de consistencia que el snapshot de items.
- Q2+ (`RequoteProjectQuote`): input sintetizado por unidad ACTIVA
  (definición + choices congeladas + dims de parámetros, `CustomDims` sólo con
  las 3 dimensiones presentes y positivas), resuelto contra el catálogo una
  sola vez a la hora del requote; status forzado draft (nunca consulta el
  snapshot legacy del proyecto). Unidades removed/cancelled quedan en `units[]`
  con su lifecycle pero no contribuyen a los totales (misma semántica que la
  cantidad comercial editable).
- Cada línea congela su propia contribución autoritativa de materiales, cantos,
  herrajes, costo directo, labor modular y precio de venta; la suma reconcilia
  con el breakdown global y el labor fijo se aplica una sola vez al snapshot.
- Líneas no precioables o descriptores customer-facing ausentes (módulo, grupo,
  opción) → error tipado `ErrInvalidRevisionSnapshot` accionable; NUNCA precio
  inventado ni UUID presentado como fallback. Opciones ordenadas por
  `groupCode` + `choiceId` antes de persistir.

## Inmutabilidad

- Trigger DB endurecido (`protect_quote_revision_immutability`, 000130):
  TODO INSERT posterior a la migración exige un snapshot v1 semánticamente
  válido (también bajo `granete_app`), draft y sin timestamps. El validador DB
  exige los ocho montos del breakdown, los seis montos de cada línea,
  no-negatividad/margen positivo y reconciliación de sumas; un objeto vacío no
  cuenta como autoridad. Sólo las filas que YA existían al aplicar 000130
  conservan NULL. `commercial_snapshot` es inmutable (ni rewrite ni inyección
  NULL→valor); `published_at` fijable SOLO por draft→published (NULL→valor);
  `accepted_at` SOLO por published→accepted; superseding preserva ambos.
- Backstop fail-closed: `draft → published` con snapshot NULL es rechazado por
  el trigger (legacy no publica historia sin precio).
- Writer único (#393) `CreateQuoteRevision` persiste el snapshot validado;
  comandos de producción (initial/requote) SIEMPRE lo adjuntan. No se admiten
  nuevos seeds NULL después de 000130; sólo el legado preexistente permanece
  snapshot-less y falla cerrado en publish/lectura.
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
  `RedactQuoteCommercialSnapshot`: costos/margen globales a 0, `salePrice`
  global comercial permanece y TODOS los montos de línea, incluido su
  `salePrice`, quedan en 0). Así el labor fijo no puede inferirse como total
  menos suma de líneas; agrupación/cantidad/descriptores/moneda permanecen.
- Cross-tenant: 404 uniforme (store) + RLS niega SQL directo bajo app role con
  contexto org B (probado).

## API generada

- `QuoteRevision` y `QuoteRevisionDetail` += `publishedAt?`, `acceptedAt?`,
  `commercialSnapshot?` (opcional — ausencia = legacy fail-closed, nunca
  recálculo); por eso create/publish/accept/requote y list/detail exponen la
  misma autoridad exacta.
- Schemas: `QuoteCommercialSnapshot`, `QuoteCommercialIdentity`,
  `QuoteCommercialBreakdown`, `QuoteCommercialLine`,
  `QuoteCommercialLineAmounts`, `QuoteCommercialUnit`,
  `QuoteCommercialOption`.
- `pnpm openapi:generate` ejecutado; `pnpm openapi:check` PASS (sin drift).
  TS (`packages/storage`) re-exporta los tipos generados — sin DTO manual.

## Tests (PostgreSQL real, cero skips)

Storage/domain/API (13 tests `TestQuoteCommercialSnapshot*` más pruebas API):

- Q1 congela `quoteLineId`, quantity 2, dos FurnitureInstance exactos y montos
  autoritativos de línea (materials/direct 192, labor 100, sale 388) que
  reconcilian con sale total 488 al sumar labor fijo 100.
- Dos líneas visualmente idénticas (mismo módulo/material) conservan IDs,
  cantidades 2 y 3, y cinco unidades físicas correctamente agrupadas.
- Q2 por requote hereda la línea estable de cada unidad y congela verdad
  independiente; Q1/Q2 permanecen byte-identical tras mutar Project/catálogo.
- Label customer-facing ausente falla `ErrInvalidRevisionSnapshot`; dos órdenes
  distintas de múltiples opciones producen JSON idéntico y no mutan el input.
- Publish/accept, retry y concurrencia mantienen snapshot/timestamps/audit
  inmutables; cross-tenant retorna 404 uniforme y RLS app-role ve cero filas.
- INSERT SQL directo NULL o con snapshot corrupto falla en PostgreSQL. Un draft
  corrupto simulado por restore privilegiado tampoco puede publicarse bajo
  `granete_app`. El upgrade real
  siembra draft/published/accepted antes de 000130, preserva identidad/status/
  created_at con snapshot/timestamps NULL, prueba fail-closed, FORCE RLS,
  down y replay. `granete_app` no puede insertar ni envelope inválido ni
  snapshot canónico en estado distinto de draft.
- Create HTTP con la misma idempotency key ejecuta una vez y reenvía status,
  header y bytes exactos, incluyendo lines/quantity/quoteLineId. List/detail y
  lifecycle mapean el mismo contrato. La regresión API prueba que el actor
  cost-blind conserva el total comercial pero NO puede reconstruir labor fijo
  desde los montos de línea.

## Tamaño (additions + deletions, no neto)

El diff excede el alcance de la autorización de tamaño anterior; el incremento
autorado requiere una decisión nueva del owner. No se ocultan artifacts del total:

- Total PR contra base: **3713 additions + 127 deletions = 3840 líneas**.
- Autorado (producción + tests + docs): **3562 + 106 = 3668 líneas**.
- Generado OpenAPI Go/TS: **151 + 21 = 172 líneas**.
- Rondas: `4661745`: **1071 + 268 = 1339**; `85beb97`: **330 + 90 =
  420 líneas** (generated 2; autorado 418).

## Pendiente / siguientes slices

- Slice 2 (cotizaciones UI derive de QuoteRevision exacta) y Slice 3 (PDF/XLSX
  por revisión exacta + retirement guards) NO iniciados (exclusión explícita).
- Revisión independiente requerida tras publicación del PR.

## Verificación ejecutada

- `./init.sh` PASS (preflight).
- `go vet ./...` PASS.
- `GOFLAGS='-p=1' go test ./...`: PASS (storage 282.998 s; pilotreadiness 220.970 s; cero fallos).
- Focused: domain + **13/13** `TestQuoteCommercialSnapshot*` (incl. upgrade
  pre-000130, down/replay y app-role INSERT) + API quote/idempotency +
  regresiones lifecycle/requote/release/Digital Thread PASS.
- `pnpm openapi:check` PASS (sin drift) · `pnpm typecheck` PASS.
- `pnpm test`: verde — UI 1.690, Web 442, Mobile 73, Desktop 17 (más storage/
  domain/excel en el mismo run, EXIT 0).
- Browser gate real (`scripts/organization-browser-gate.sh
  tests/organization/project-reconciliation.spec.ts`): **4/4 PASS (26.6 s)** —
  Chromium + Go + PostgreSQL efímero; el golden path comercial completo (Q1 →
  publish → accept → requote Q2 → aprobación → release → tenant isolation)
  funciona con la captura del snapshot.
- `git diff --check` limpio.

## Publicación

- Issue #642 conserva aprobación del owner. La excepción previa NO cubre el
  nuevo total autorado; falta decisión nueva y el PR permanece sin
  `size:exception`.
- PR: `feat(quote): freeze canonical commercial snapshot per QuoteRevision`,
  primera línea del body `Refs #642`, label único `type:feature`, sin cierre.

## Verdict

`IMPLEMENTED_PENDING_REVIEW` — PR publicado; se requiere revisión
independiente read-only antes de cualquier merge.
