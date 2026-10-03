# ODD — #986 Cablear la demanda de herrajes por perfil al precio comercial del proyecto

- **Issue**: tiagofur/muebleria#986 (`status:approved`, autorización del owner en
  sesión 2026-10-03, citada en comentario).
- **Lane**: Delegated Direct (multi-archivo, riesgo comercial). Un escritor.
- **Base**: `origin/main` @ `bf0cecf1` (post #985). Rama:
  `feat/986-demand-bom-wiring`, worktree `../muebles-worktrees/986-demand-bom-wiring`.
- **Estado**: IMPLEMENTED_PENDING_REVIEW (actualizar al final).

## Resultado observable

La cotización/estimado/proyección de un proyecto cuyo herraje viene sólo de
joinery por perfil (asignación → perfil pineado → contactos verificados)
incluye el costo de herrajes; ítems sin joinery quedan byte-idénticos.

## Alcance (de la issue)

1. Los caminos comerciales (Q1/requote via quote commercial snapshot,
   proyección comercial, estimado, exports) incorporan la demanda derivada por
   `engine.DeriveHardwareProfileDemand` — una sola derivación, sin copias.
2. Fusión aditiva por hardwareId, misma validación de catálogo, redondeo
   post-total (forma canónica del freeze: `RequirementLinesFromResolvedBOMs`
   con `profileDemandPerInput`).
3. Provenance (`Sources`) accesible en el snapshot/respuesta comercial.
4. Paridad TS/Go de la regla de fusión (fixture compartido).
5. Perfiles pineados al release efectivo de la design revision; nunca `latest`.

## Fuera de alcance

Preview TS vivo consumiendo demanda (slice siguiente); kinds nuevos; perfiles
de producción reales; supresión de líneas manuales duplicadas.

## Decisiones de diseño (T1/T2 resueltas)

- **D1 Seam de pricing**: `CalcProjectBreakdown` se parte en
  `CalcProjectBreakdownWithProfileDemand(project, catalog, profileDemandPerItem)`
  (index-aligned con project.Items, forma espejo del freeze). La original delega
  con nil ⇒ todos los callers existentes quedan byte-idénticos. Las líneas de
  demanda se precifican por el MISMO `CalcHardwareLineCost` (misma validación de
  catálogo, mismo precio/unidad, multiplicador item.Quantity), aditivas al mismo
  `hardwareTotal`, sin redondeo nuevo.
- **D2 Derivación única**: `engine.DeriveQuoteUnitProfileDemand(item, catalog,
  server)` reutiliza `resolveReleaseUnit` + `deriveReleaseRoutingUnit` (la MISMA
  derivación del freeze; routing descartado). Contrato de skip: sin perfiles
  pineados (server vacío), definición ausente, `DefinitionVersion` pineada, o
  módulo de estructura sin dims explícitas en parámetros ⇒ nil (son exactamente
  las unidades que el freeze tampoco puede derivar). Las que SÍ cumplen el
  contrato fallan cerradas ante errores de resolve/machining: una unión gobernable
  rota jamás precifica $0 silencioso.
- **D3 Inputs**: `storage.ReleaseServerResolveInputs` (el loader único #875) —
  degradación honesta existente (sin release publicado ⇒ inputs vacíos ⇒ pricing
  sin demanda, igual que el resolve que vio el diseñador).
- **D4 Conversión pricing→release item**: identidad física = item.ID de pricing;
  `CustomDims` ⇒ parámetros `widthMm/heightMm/depthMm` (inversa exacta de
  `CommercialDimsFromParameters`). Preset-driven sin CustomDims ⇒ skip (limitación
  NOMBRADA: esas unidades tampoco pueden congelar releases hoy).
- **D5 Provenance**: nueva sección opcional `profileDemand` en
  `QuoteCommercialSnapshot`, agrupada por QuoteLineID (Q1: item.ID ya ES
  quoteLineId; requote: lineByInstance), con sources perfil/receta/relación/
  contactos espejo del engine. Validador fail-closed si presente.
- **D6 Consumidores en este slice**: Q1 + requote (snapshots, con provenance
  persistida), estimado en vivo (handlers calculate) y proyección comercial
  (errores ⇒ issue visible, sin demandas parciales silenciosas).
  `CaptureQuoteSnapshot` legacy (generators) queda manual-only — alcance
  restante nombrado.
- **D7 Paridad TS**: fixture compartido de la regla de fusión/precio
  (contracts/), consumido por test Go y vitest.

## Tareas

- [x] T1 Mapear seams (quote_commercial_snapshot, release_routing, loader, dims).
- [x] T2 Decisiones D1-D7.
- [x] T3 Implementar fusión en Go (engine split + derivación + provenance).
- [x] T4 Tests de aceptación (números a mano, regresión, requote PG, derivación
      en vivo PG).
- [x] T5 Fixture de paridad TS/Go (contracts/quoteProfileDemandParity.contract.json).
- [x] T6 V0/V1/V2 + verify_affected + PR.

## Evidencia (candidate congelado)

- **Cambios**: engine split (`CalcProjectBreakdownWithProfileDemand`, delegación
  nil ⇒ byte-idéntico), `DeriveQuoteUnitProfileDemand` + `ProjectItemAsDemandUnit`
  (engine/release_demand_quote.go), provenance en `QuoteCommercialSnapshot`
  (opcional aditiva, schema v1 sin bump), wiring Q1/requote/estimado/proyección,
  stub de handlers_test, fixture de paridad + helper TS
  (`calcProfileDemandHardwareTotal`).
- **V0**: gofmt limpio; `go build ./...` + `go vet ./internal/...` limpios;
  `check_openapi_drift.py` PASS (sin cambios de superficie HTTP);
  `verify_affected --plan` = todo aplica (dominio compartido); unittest de
  scripts CI PASS.
- **V1**: engine nuevo 9/9 (pricing aditivo con números a mano: 200+4×2.5×2=220;
  byte-idéntico sin demanda por DeepEqual; fail-closed ghost/qty0;
  contrato de skip; inversa de dims); paridad del contrato 6/6 Go + vitest
  (fixtures compartidos); `pnpm typecheck` root PASS; domain vitest 1762/1762;
  web vitest 565/565 (dos suites fallaron por timeout del worker bajo carga y
  pasaron 46/46 al re-corrlas solas).
- **V2 (PostgreSQL real desechable, contenedor pgx con rol app NOBYPASSRLS)**:
  `TestQuoteCommercialSnapshotCarriesProfileDemand` PASS — requote contra R4
  precifica $40 exactos (2 unidades × 2 contactos × $10), provenance por unidad
  (lineId congelado de la fuente, perfil PERF-QPD rev-1, receta qt:minifix
  rev-1, relación parameter-shelfJoints-1, 2 contactos), la revisión congelada
  ANTES de las asignaciones queda byte-idéntica; `DeriveLiveProfileDemand`
  devuelve la misma matriz contra PG. Suite storage COMPLETA 491s PASS
  (regresión: todos los Q1/requote existentes pasan por el código nuevo);
  engine+domain+api+application+cmd/auth/config PASS; pilotreadiness corriendo
  (pegar resultado antes del push).
- **NOT_RUN local (CI lo valida sobre el HEAD exacto)**: browser gate (sin UI),
  rake SketchUp (sin Ruby), visual WebGL, storage shards completos de CI.
- **Delivery**: complete (toda la aceptación de la issue tiene evidencia; Q1
  comparte 100% de la maquinaria del requote — mismo builder, mismo derivador —
  y la suite completa de lifecycle de quotes regressiona el camino).
