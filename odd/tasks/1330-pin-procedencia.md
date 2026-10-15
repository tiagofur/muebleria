# ODD — #1330 Procedencia visible del pin de apertura (diseño, cotización, Inspector)

- **Lane**: Delegated Direct (backend acotado + contrato + web + plugin).
- **Base**: `origin/main` @ 4d6201c6 (incluye #1343 mergeada) · **Rama**: `feat/1330-pin-procedencia` · **Escritor**: implementer sesión 2026-10-15 (reserva en la issue).
- **Aprobación**: owner en sesión 2026-10-15 («continue con 1330»); label `status:approved` aplicado.

## Entregables (de la issue)

1. Web — tarjeta/ficha: «Apertura: CODE vN · descuento · muesca · herrajes» leído del pin, sólo lectura, en el drawer de la unidad (sección Procedencia).
2. Cotización — código+versión del perfil pineado junto a las líneas de apertura (sección #1263).
3. Plugin Inspector — tarjeta muestra perfil+versión pineados; «sin pin — re-aplicar» para selecciones previas (truthful absence).
4. Dato existente — sin backend nuevo de escritura; el pin ya viaja en GET/PUT del diseño.

Non-goals: no editar el pin desde UI; no bloquear por procedencia; no duplicar el dato del estándar (#1329).

## Diseño (tras Explorer)

- El pin YA lleva `profileCode` + `bom.profileVersion` y GET/PUT lo serializan (pinned por test API). Plugin: gratis.
- **Web no tiene método cliente** para GET /designs/{id}/opening (fuera del contrato). Decisión: NO exponer ese payload plugin-facing al contrato (resolver completo es enorme); se **ensancha el DTO del working copy** (`toDesignAuthoringDefaultsDTO` hoy recorta la apertura) con `opening` (selección + pin) — contrato aditivo, el working copy ya es consumido por web con schema validado.
- **Cotización**: el snapshot congela `profileId+profileVersion` pero no el código. Se agrega `profileCode` (omitempty) a `QuoteCommercialOpeningBOMLine`, poblado del pin en la derivación (design_opening_quote.go:138). Snapshots viejos: ausencia veraz (UI muestra «perfil vN» sin código).
- Plugin `getSummary`: `profileName` prefiere `pin.profileCode` (verdad congelada) con fallback al catálogo vivo; nota persistida muestra «CODE vN» o «sin pin — re-aplicar» (gola sin pin; handle/bottom_overhang no llevan pin).

## Tareas

- [x] Backend: ProfileCode en OpeningBOMLine + derivación (con versión del PIN, no la viva); DTO working-copy con opening/pin; contrato yaml (DesignOpeningSelection/ProfilePin/…PinBOM + DesignAuthoringDefaults.opening + QuoteCommercialOpeningBomLine.profileCode); regen Go/TS; tests Go. → 567244fe
- [x] Web: join openingBom en quoteRevisionPresentation + render en ProjectItemsSection; drawer Procedencia (working copy en contexto working, snapshot de revisión en contexto revision, gate por presencia) + estados honestos; vitest 18/18 + 5/5. → ed860fb3
- [x] Plugin: persistedNote con pin + getSummary pin-first (degrada al código congelado si el perfil sale del catálogo) + «sin pin — re-aplicá»; harness 24/24; bump 0.1.76. → bd6ac9f1
- [x] E2E browser (opening-bom-quote extendido): cotización muestra «Apertura: GOLA-L-8006 v1 · perfil + 3 soportes + tapas»; drawer lee el mismo pin; editar el perfil (v1→v2, H−40→H−35) NO mueve la tarjeta; re-aplicar mueve el pin a v2·H−35 visible. → dce13c32 (+ fix del mapper DTO que recortaba profileCode — cazado por el E2E).

## Estado

- 2026-10-15: inicio, Explorer completó el mapa. #1343 mergeada en la base — el estándar/fabricante conviven.
- 2026-10-15: candidato congelado dce13c32. Hallazgos: (1) la versión mostrada debe ser la del PIN (el resolve consume catálogo vivo — mostrar ésa mentiría); (2) el mapper DTO de la snapshot perdía profileCode (el dominio lo traía). Verificación enfocada: quote/requote storage PASS (17s), api completo PASS, E2E gate PASS.
