# ODD — #989 El preview vivo de la web consume la demanda de herrajes por perfil

- **Issue**: tiagofur/muebleria#989 (`status:approved`, elección del owner
  2026-10-03 sobre el menú post-merge de la demanda comercial).
- **Lane**: Delegated Direct. Un escritor.
- **Base**: `origin/main` @ `e6dab065` (post #988). Rama
  `feat/989-preview-demand`, worktree `../muebles-worktrees/989-preview-demand`.
- **Estado**: IN_PROGRESS — opción (B) RATIFICADA por el ODD según contrato de
  la issue (cumple server authority + paridad + estados honestos). Unidad 1
  COMMITTED (e7082d34). Unidad 2 con plan listo (abajo).

## Hechos verificados (T1, 2026-10-03)

1. **Plugin HUD: YA cubierto.** `apps/sketchup-extension/.../granete-commercial-projection.js`
   renderiza la proyección comercial SERVIDA (backend), que desde #987 incorpora
   demanda. Falta sólo la verificación/evidencia pedida por la issue (proof o
   lectura de camino), código sólo si hay hueco real.
2. **La web ya consume el breakdown servido**: `projectStore.ts:2484` hace POST
   `/projects/{id}/calculate` → `backendBreakdown` — ese endpoint es
   demand-priced desde #987 (`DeriveLiveProfileDemand` + breakdown extendido).
   PERO: (a) el endpoint opera sobre el estado GUARDADO del proyecto (no acepta
   payload); (b) `resolveDisplayBreakdown(local, remote, showCosts)`
   (derivations/breakdown.ts:112) muestra LOCAL primero para quien ve costes —
   y el local (`computeSelectedProjectBreakdown` → `calcProjectBreakdown`) no
   tiene demanda.
3. **La demanda es verdad del servidor**: asignaciones + perfiles pineados +
   recetas + política viven server-side. La respuesta del resolve de autoría YA
   trae `hardwareProfileDemand` por unidad (validada en
   `sketchupAuthoringResolve.ts:1111`); el web ya corre resolve en las pantallas
   de diseño (JoineryResolveSection, queries keyed por intent).

## Decisión de seam pendiente (opciones)

- **(A) Remote-first condicionado**: mostrar el breakdown servido cuando esté
  fresco y no haya edits sin guardar; local con estado stale/explícito cuando
  hay edits. Respeta server authority al máximo; cambia la semántica de
  `resolveDisplayBreakdown` + estados.
- **(B) Join de demanda del resolve en el espejo local** (RECOMENDADA): el
  espejo TS del breakdown acepta la matriz de demanda (misma forma index-aligned
  que Go, consumiendo `calcProfileDemandHardwareTotal` ya pineada por fixture) y
  las pantallas de diseño la alimentan con el `hardwareProfileDemand` del
  resolve que YA fetch-ea el servidor (React no recrea resolve/pricing: une la
  derivación del servidor a su espejo de respuesta inmediata). Proyectos sin
  diseño/resolve: preview byte-idéntico. Requiere hoistear/compartir las
  queries del resolve (hoy viven en JoineryResolveSection) hacia la derivación
  del preview + estados loading/blocked honestos mientras la demanda no llegó
  (NUNCA $0 silencioso).
- **(C) Estimar servido con payload**: extender /calculate para aceptar estado
  no guardado — nueva superficie HTTP; descartada por costo/contrato salvo que
  el owner pida lo contrario.

## Pendiente del owner/ODD al (re)tomar

1. Ratificar (B) (o elegir A) — el precio de (B) es mover las queries del
   resolve a alcance de la derivación del preview.
2. `computeModuleCostPreview` (preview de DEFINICIÓN, breakdown.ts:79): sin
   colocación física no hay contactos → sin demanda por contrato; DOCUMENTAR en
   UI/doc en vez de forzar inputs (el ODD de #986 ya lo nombró).
3. Implementación: espejo TS del parámetro demanda (calcProjectBreakdown con
   matriz opcional) → wiring derivación/pantalla → estados → spec browser gate
   (diseño con joinery gobernado → preview muestra herrajes → consistente con
   cotización) → verificación HUD.
4. Absorber sugerencias del review de #987: (b) test E2E Q1-con-demanda + test
   HTTP estimado-con-demanda en este slice si toca estimado; (c) skip
   preset-driven observable.


## Unidad 1 (COMMITTED e7082d34)

- `calcProjectBreakdownWithProfileDemand` TS (pricing.ts) + barrels +
  tests espejo con números a mano en engine.test.ts (160→180, venta 1272.6;
  identidad sin demanda toEqual; fail-closed ghost/qty-0). Domain suite
  125/125 archivos, 1765 tests PASS; typecheck root PASS.

## Unidad 2 (COMMITTED 1ca1e3b9 — hook + threading, sin caller todavía)

- `ResolvedMachiningV1` gana `hardwareProfileDemand?` tipada (el validador ya
  la exigía). `apps/web/src/derivations/useProjectProfileDemand.ts`: hook con
  transporte inyectado (resolve + getCatalogRevision), skip contract espejo de
  Go, extracción fail-closed, status loading/ready/unavailable/error.
  `computeSelectedProjectBreakdown` acepta la matriz (3er parámetro);
  `QuoteDerivationsDeps.profileDemand` opcional + `projectDemandStatus`
  expuesto. Tests: unit (skip contract, extracción, fail-closed) + suite web
  570/570 + typecheck PASS.

## Unidad 3 — RESTANTE (plan listo)

1. ShellView/AppContent: instanciar `useProjectProfileDemand` (GraneteApiClient
   memo pattern de ShellView:975; enabled = session auth + authToken; project =
   selectedProject; catalog) y pasar `profileDemand` a useQuoteDerivations
   (AppContent.tsx:1520).
2. UI honesta: el badge de demanda va en ProjectTotalsAside (fila Herrajes,
   línea ~200 del camino live; el camino quoteAuthority congelado YA es verdad
   del snapshot). Threading vía useProjectDetail context (ProjectDetailView*
   en packages/ui/projects) — 'loading' ⇒ indicador junto a Herrajes (nunca $0
   silencioso), 'error' ⇒ estado de error, 'unavailable' ⇒ sin cambio.
3. Browser spec del gate: diseño con joinery gobernado → preview ≡ cotización.
4. HUD plugin: evidence de lectura (granete-commercial-projection.js ←
   proyección servida con demanda desde el merge de la demanda comercial).
5. Absorber sugerencias review #987 si tocan estimado: test HTTP
   estimado-con-demanda.

## Unidad 2 — plan listo-para-ejecutar (web)

Hechos: transporte `api.resolveFurnitureAuthoring(token, request, signal)` y
`api.getFurnitureCatalogRevision(token, signal)` YA existen en el api client
web (usados por ProjectDesignsScreen:521/1168). Request builder en domain:
`buildWebAuthoringResolveRequest` (webAuthoringResolve.ts:45). La demanda viaja
en `response.resolved.machining.hardwareProfileDemand` (validador en
sketchupAuthoringResolve.ts:1111).

1. `apps/web/src/derivations/useProjectProfileDemand.ts`: hook con useQuery
   `['project-profile-demand', catalogRevision, items-fingerprint]` —
   Promise.all de resolve por item del proyecto (definitionId + params
   escalares + choices del PROJECT item); extrae hardwareProfileDemand con
   shape-check fail-closed; devuelve `{ demandByItemId, status:
   'loading'|'ready'|'unavailable'|'error' }`. 'unavailable' = org sin
   release/perfiles (resolve 200 con demand ausente en TODOS los items) —
   preview byte-idéntico.
2. `computeSelectedProjectBreakdown(project, catalog, profileDemandPerItem?)`:
   tercer parámetro matriz index-aligned (item.id ↔ matrix por orden de
   project.items), resultado + `demandStatus` para la UI.
3. ShellView/AppContent: pasar `demandStatus` al display del hardwareTotal —
   loading ⇒ indicador explícito (nunca $0 silencioso); error ⇒ estado de
   error del preview; unavailable ⇒ sin cambio visual.
4. Tests: derivación con demanda (números a mano), hook con transporte mock,
   regresión sin demanda.
5. Browser spec: diseño con joinery gobernado → preview ≡ cotización.
6. HUD plugin: evidence de lectura (granete-commercial-projection.js ←
   proyección servida con demanda desde el merge de la demanda comercial).
