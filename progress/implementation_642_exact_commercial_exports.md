# #642 — Delivery 3: PDF/XLSX comerciales exactos por QuoteRevision

- Approval: prompt del propietario (2026-09-12). Issue #642 OPEN. Base exacta
  `main@fc095734923f789d50d86aa6b6a77f01ba97b923` (post-merge PR #675). Rama
  `feat/642-exact-commercial-exports`. Single writer; sin merge ni cierre.
- Started: 2026-09-12 08:50 CST.
- Result: `IMPLEMENTED_PENDING_REVIEW`.

## Regla entregada

```text
Selecciono Q2 → exporto Q2 → PDF/XLSX reproducen exactamente Q2
```

aunque después existan Q3, cambios de catálogo, cambios de Project, precios
actuales o renombres de obra/cliente. La única autoridad del export comercial
es `QuoteRevision exacta + commercialSnapshot`.

## Mapa de consumidores (antes → después)

| Consumer | Fuente anterior (riesgo mutable) | Fuente actual |
|---|---|---|
| `apps/web/src/exportCommercialQuote.ts` (XLSX) | `project.items` + `calcProjectBreakdown` vivo; fallback `priceSnapshot` legacy si `Project.status` cerrado; fecha `Project.updatedAt`; cliente por lookup vivo; labels de catálogo vivo | `buildExactCommercialQuoteExportModel({revision, snapshot}, {amountsVisible})` → renderer exacto |
| `apps/web/src/exportCommercialQuotePdf.ts` (PDF) | idem XLSX + variante | mismo modelo exacto compartido |
| `apps/web/src/exports/useExportHandlers.ts` | pasaba `selectedProject, catalog, customers` a los builders | recibe la `QuoteRevisionAuthority` visible y resuelve fail-closed por estado |
| `ShellView.tsx` (wiring) | handlers incondicionales (no plant) | handler presente sólo con autoridad comercial (auth); guest/local sin botones |
| `packages/ui/ProjectsScreen.tsx` (menú export) | labels sin revisión (`Exportar cotización`) | labels con QN exacta visible (`Exportar cotización Q2`, `PDF listado Q2`, `PDF resumen Q2`) |
| `packages/excel/commercialQuoteExport.ts` (renderer XLSX) | input con stack completo de costos internos (Materiales/Cantos/Herrajes/MO/Costo directo/Factor margen) al documento de cliente | `ExactCommercialQuoteExportModel`; sólo identidad de revisión, líneas exactas y montos de venta autorizados |
| `packages/excel/commercialQuotePdf.ts` (renderer PDF) | input plano sin QN ni identidad congelada | mismo modelo exacto; título `Cotización Q2 — …`, `Revisión/Estado/Precios congelados` explícitos |
| `ProjectTotalsAside.tsx` | rama con autoridad no renderizaba la lista inline de issues de export | fail-closed visible también bajo autoridad (legacy/ready) |

### Clasificación de fallbacks eliminados

- `Project` / `project.items` → eliminado del export (sin representación en el modelo).
- `projectEstimates` → nunca estuvo en los builders; sin cambios.
- `priceSnapshot` legacy → retirado de este consumer (queda compatibility-only
  para otras superficies; el export ya no lo consulta).
- `calcProjectBreakdown` en vivo → eliminado (ningún recálculo).
- nombre de cliente actual (lookup por `project.customerId`) → identidad
  congelada `snapshot.customer.name`.
- `Project.updatedAt` → fecha real de lifecycle
  (`acceptedAt → publishedAt → createdAt` de la revisión).
- labels de catálogo/modulo vivo → descriptores congelados del snapshot
  (`moduleCode`/`moduleName`/`options[].groupLabel/choiceLabel` por unidad).
- `Project.status` (labels comerciales) → status de la QuoteRevision
  (Borrador/Publicada/Aceptada/Reemplazada).
- `isProjectClosed(project.status) && priceSnapshot` ("precios congelados"
  condicionales) → congelamiento estructural: el documento siempre declara
  `Congelados (revisión Q{n})`.

## Modelo común (#16)

`ExactCommercialQuoteExportModel` (definido en `@granete/excel`, construido por
`apps/web/src/exports/exactCommercialQuoteModel.ts`):

```text
revisionNumber · statusLabel · dateLabel (lifecycle real)
projectName/customerName/currency (congelados del snapshot)
lines[]: quoteLineId · moduleCode/ModuleName (congelados) · quantity
          salePrice (null si no autorizado — nunca 0 redacted)
          units[]: furnitureInstanceId · lifecycleStatusLabel
                   dimensionsLabel (parámetros congelados del item)
                   optionsSummary (labels congelados por unidad)
saleTotal (breakdown.salePrice congelado)
```

- El join líneas/unidades/items reutiliza `buildRevisionLines`
  (`@granete/ui`), estrictamente por `quoteLineId`/`furnitureInstanceId`.
- Líneas distintas con nombre idéntico permanecen distintas.
- `quantity > 1`: cantidad comercial preservada; configuraciones por unidad NO
  se fusionan — si difieren, el render muestra `U1: …  U2: …`.
- Un único modelo alimenta `commercialQuoteExport` (XLSX) y
  `commercialQuotePdfExport` (PDF). No hay segunda lógica de joins.

## Selección exacta (Q2)

- Los handlers reciben la `QuoteRevisionAuthority` del detalle (la revisión
  visible: aceptada, si no la más reciente) y los botones la nombran
  (`Exportar cotización Q2`). Lo visible es lo que se exporta.
- Estados no-ready fallan cerrado con mensaje accionable (inline
  `ExportIssueList` + block message):
  - legacy: "Esta cotización anterior no tiene historial comercial congelado.
    Creá una nueva revisión actualizada para exportarla con precisión."
  - empty: crear Q1; loading: reintentar; error: reintentar la carga.
- Sesión guest/local (sin autoridad comercial posible): botones ausentes — sin
  fallback silencioso al estado local del Project.
- Endpoint nuevo: NO. El cliente ya lee la revisión exacta
  (`listProjectQuoteRevisions`); el export se construye client-side desde esa
  fuente exacta. Sin persistencia nueva.

## Permisos / cost-blind (#8)

- Política existente reutilizada sin cambios: `showCosts`
  (COST-01/COST-02, `rolesCanViewCosts` + flag del taller).
- Precio de línea: visible sólo con `amountsVisible` (mismo gate que el
  detalle); si no, la columna XLSX se omite completa (nunca celdas en 0).
- Total de venta congelado: siempre visible (la redacción server-side
  `RedactQuoteBreakdown` lo conserva para todos los lectores autorizados).
- Stack de costos internos (materiales/cantos/herrajes/MO/costo directo/
  margen): eliminado del documento de cliente en AMBOS formatos — el XLSX
  legacy lo exponía; ahora aplica la misma política que el PDF
  ("Client PDF never includes workshop costs").

## Filename (#11)

```text
Cotizacion-{obra congelada}-{cliente congelado}-Q{n}.xlsx
Cotizacion-{obra congelada}-{cliente congelado}-Q{n}-listado.pdf
Cotizacion-{obra congelada}-{cliente congelado}-Q{n}-resumen.pdf
```

Sanitizado (`\p{L}\p{N}-_`); fallback `cotizacion` si la identidad congelada
está vacía. Identidad tomada del snapshot (no de filas mutables).

## Determinismo PDF

`doc.save({ useObjectStreams: false })` → bytes reproducibles: dos builds del
mismo modelo son byte-idénticos (testeado). El golden PDF es además semántico:
el test extrae el texto real de los content streams (FLATE + `<hex> Tj` +
decodificación WinAnsi) y verifica QN, identidad congelada, líneas, medidas y
total.

## Tests

- `packages/excel` `commercialQuoteExport.test.ts` (6): identidad de revisión,
  líneas exactas con medidas/opciones/precios, unidades con configuración
  distinta no fusionadas, columna de precios omitida sin autorización (total
  visible), stack de costos ausente, fail-closed sin líneas.
- `packages/excel` `commercialQuotePdf.test.ts` (8): identidad QN en
  título/metadata/encabezado, listado con medidas por línea, unidades
  distintas, resumen sin listado, sin stack de costos, byte-determinismo,
  fail-closed, galería CRM Phase 4 intacta.
- `apps/web` `exports/exactCommercialQuoteModel.test.ts` (8): modelo desde
  snapshot congelado, fecha lifecycle (aceptada>publicada>creada), amounts no
  autorizados → null (nunca 0), 0.00 legítimo preservado, líneas homónimas
  distintas, resolución fail-closed por kind (ready/legacy/empty/loading/error).
- `apps/web` `exportCommercialQuote.test.ts` (7) y `exportCommercialQuotePdf.test.ts` (4):
  filename QN sanitizado, par determinista Q1(600/Q1 totales) vs
  Q2(650/Q2 totales) leyendo el workbook real, estabilidad ante mutación
  posterior (el builder sólo acepta la revisión congelada), cost-blind, fail-closed.
- `apps/web` `exportCommercialQuoteAmbientGuard.test.ts` (1): guard anti-leak
  de materiales ambientales reescrito sobre el modelo exacto.
- `packages/ui` `ProjectsScreen.test.tsx` (+3, 71 total): labels con QN bajo
  autoridad ready, botón presente bajo legacy (fail-closed al click), sección
  comercial ausente sin handler exacto (guest/local).

## Browser E2E real

`tests/organization/quote-exact-exports.spec.ts` (Chromium + Go + PostgreSQL,
gate `scripts/organization-browser-gate.sh`):

- Aislamiento de fixtures: el spec usa módulos/estructura/herrajes/cliente/
  obra PROPIOS (nuevos módulos como literales limpios — el POST
  `/catalog/modules` rechaza spreads de módulos existentes). NUNCA muta el
  módulo compartido del gate (`GATE_MODULE_A_ID`, cuyo nombre fija
  `switch.spec`); los upserts de fixture reintentan 500 transitorios
  (retryable por contrato). Verificado: spec + switch + legacy-recovery +
  list-authority en la MISMA corrida del gate → 9/9 PASS.

1. BeforeAll por API real: catálogo + obra + materialización; Q1
   create/publish/accept (600 mm); cambio real 600→650 por provenance de
   diseño (working copy + R1) + requote → Q2 publish/accept; mutaciones
   deliberadas post-congelamiento (renombrar obra, cliente y label del módulo
   propio). Readback: Q1 sigue 600/superseded con identidad congelada; Q2
   650/accepted.
2. Test 1: detalle muestra `Q2 · Solo lectura`; descarga XLSX con filename
   `Cotizacion-Cocina-Export-E2E-Cliente-Export-E2E-Q2.xlsx`; workbook leído
   con ExcelJS: `Cotización Q2`, identidad congelada (NO los renombres),
   `650×720×{depth} mm`, precio de línea y total == snapshot.breakdown.salePrice;
   sin rastro de los valores mutados. PDF listado descargado con filename
   `-Q2-listado.pdf` y `PDFDocument` title `Cotización Q2 — {obra congelada} —
   {cliente congelado}`.
3. Test 2: revisión legacy (snapshot NULL, seeded pre-migración vía DSN admin
   —sólo fixture—, flujo verificado 100% UI): badge `Q1 · Cotización anterior`,
   click en `Exportar cotización Q1` → alert inline con el CTA exacto
   ("no tiene historial comercial congelado … Creá una nueva revisión
   actualizada"), sin descarga.

## Limitaciones documentadas

- **Fiscalidad (#20)**: snapshot v1 no modela IVA/descuentos/retenciones; el
  export no inventa ninguno. El breakdown congelado ES el monto autoritativo.
- **Export de revisiones históricas desde la UI**: los botones del detalle
  actúan sobre la revisión visible (autoridad: aceptada, si no la más
  reciente) — no existe hoy selector de revisión histórica en el detalle de
  Cotizaciones. La reproducibilidad de Q1 está probada a nivel builder con
  datos congelados reales (tests Q1/Q2 y readback E2E del snapshot Q1), pero
  el click de browser exporta la autoridad visible (Q2). Un picker histórico
  sería superficie nueva (fuera de esta entrega).
- **Scenario A/B (#137)**: `exportScenarioPdf.ts` es una herramienta what-if
  de comparación de opciones (calculo vivo por diseño), no un documento de
  cotización por revisión; queda fuera de esta entrega y clasificado.
- `quantity > 1` con configuraciones por unidad distintas: preservadas y
  mostradas (`U1: … U2: …`); el XLSX/PDF no desglosa filas físicas por unidad
  (el desglose físico vive en el detalle y matrices operativas).
- **Guest/local**: sin QuoteRevisions no hay export comercial (botones
  ausentes por diseño); el flujo local legacy se retiró de este consumer.

## Verificación

- `pnpm typecheck` — 7/7 paquetes, 0 errores.
- `pnpm test` (monorepo) — domain 1407 / storage 191 / excel 341 (+3 skipped
  hardware preexistentes) / desktop 17 / mobile 73 / ui 1747 / web 460. Verde.
- `pnpm openapi:check` — 0 drift.
- `git diff --check` — limpio.
- Browser gate real (Chromium + Go + PostgreSQL efímero):
  `scripts/organization-browser-gate.sh tests/organization/quote-exact-exports.spec.ts`
  → 2/2 PASS; specs vecinos (quote-legacy-recovery, quote-list-authority,
  project-reconciliation) → 10/10 PASS en la misma corrida.
- `go test ./... -count=1 -p 1` contra PostgreSQL aislado dedicado
  (contenedor efímero `granete-642-exports-isolated`, DATABASE_URL propio):
  el Postgres compartido local (5445) estaba ocupado por una corrida
  concurrente de otra lane (`go test ./internal/storage/` con el mismo
  multiOrgFreshDB), que produce 57P01 mutuo por `DROP DATABASE … WITH
  (FORCE)`; la verificación se aisló siguiendo la práctica del repo
  (resultado exacto al pie del PR).

Sin cambios de backend/Go ni OpenAPI (el cliente ya tiene el read exacto de la
revisión; #19). Sin migraciones. Sin touch de dashboards, ProductionRelease,
SketchUp, Proyectar, PTX, hardware, warehouse, producción ni pricing.
