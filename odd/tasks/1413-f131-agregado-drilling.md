# ODD — #1413 F131: perforaciones de herrajes posicionados en AGREGADOS llegan a CNC

- **Issue**: tiagofur/muebleria#1413 ([P2][Motor/Máquina]) — `status:approved`
- **Lane**: Delegated Direct (multi-archivo: dominio TS + contrato de paridad + test Go)
- **Base**: `origin/main` `6b11af7f15b6a63716f0d6737227f84a03ed57d9` (limpia, CI 23/23)
- **Rama**: `feat/1413-agregado-drilling-cnc`
- **Escritor**: único (este agente). Sin PR previo ni reserva ajena verificada al arranque (preflight OK, cola sin PRs abiertos).

## Alcance aprobado (de la issue)

1. Incluir `hardwarePlacements` de `agregado.components[].overrides` en
   `resolveProjectDrilling`, resolviendo la pieza anfitriona por link `agr-*`
   (contadores #434), con evaluación de fórmulas y dedupe/validaciones F128.
2. Paridad TS↔Go con fixture compartido del patrón de taladro de un cajón con
   corredera.
3. Fail-closed: sin taladros inventados; pieza/link roto = error explícito.
4. Open question (mecanizado de miembros rígidos de receta): **decisión — se
   difiere con seguimiento propio** (issue propia al cierre). La issue lo
   autoriza explícitamente («o dejarlo explícitamente fuera con seguimiento propio»).

## Diagnóstico (evidence, code-verified)

- **El gap es el transporte TS**: `packages/domain/src/projectDrilling.ts`
  `manualPlacementsForPart` sólo lee instancias de estructura+módulo
  (`projectDrilling.ts:65`). Los ids de piezas de agregado
  (`agr-<agregadoId>-[instance-<iid>-]u<N>-<componentId>-copy-<k>`,
  construidos en `engine/bom.ts:903`) nunca matchean un `instance.componentId`
  → cero taladros manuales en `ProjectDrillingData` → KDT/MPR/DXF web.
- **Go ya transporta**: el layout expanda componentes de agregado como boards
  con sus placements (`backend-go/internal/domain/engine/layout.go:1104` →
  `:935`), y el camino release (`ManualPlacementsPresent=false`) materializa
  placements efectivos desde `board.hardware` de TODOS los boards
  (`authoring_resolve.go:1053`) → `deriveManualPlacementMachining` → op DRILL
  con provenance `manualHardwarePlacement` → congelada en
  `release_routing.go`. El test Go del fixture compartido lo fija como
  contrato (hoy no existe test que lo pruebe).
- **Consumidores del fail-closed**: `apps/web/src/exports/useExportHandlers.ts:485`
  lanza con `resolutionIssues[0]` → una nueva issue de resolución bloquea el
  export ruidosamente.

## Diseño

- `projectDrilling.ts`: helper nuevo que enumera prefijos EXACTOS por instancia
  de agregado (`agr-<id>-[instance-<iid>-]u<N>-`, unidades `0..max(1,quantity)-1`,
  instanceTag sólo cuando la instancia se repite — espejo de `bom.ts:875-910`)
  en vez de parsear el id hacia atrás (los ids comerciales llevan guiones).
  El resto del id tras el prefijo es `<componentId>-copy-<k>`; los placements
  salen de la definición del agregado en el catálogo.
- Fail-closed: `agr-*` que no matchea prefijo ni componente = issue de
  resolución nueva `DRILLING_AGREGADO_HOST_UNRESOLVED` (blocking), stage
  `agregado-host`. Sólo se evalúa cuando el BOM secundario resolvió (el fallo
  de BOM ya reporta la suya). Sin throw: el export corta por el consumidor
  existente y las demás piezas conservan su patrón.
- Fixture de paridad `contracts/agregadoPlacementDrilling.contract.json`:
  herraje `HER-PLACA-BIS` (perfil estático Go: piloto tornillo Ø5×10 face
  anchor; el perfil TS autorado del catálogo espeja esos valores) → los holes
  TS y las ops DRILL Go coinciden valor a valor sobre el mismo host `agr-*`.

## Fuera de alcance

- Miembros rígidos de receta → CNC (issue propia al cierre).
- Estrategia de perforaciones / política de fábrica → #1065 / #1218 item 3.
- Skew pre-existente Go-perfil-estático vs TS-perfil-autorado para otros
  herrajes (no se toca; el fixture elige un código cubierto en ambos).

## Verificación plan

- V0: tsc/vitest del dominio, go vet/build, drift check del fixture.
- V1: suite projectDrilling TS (nueva + existente), contract test TS + Go del
  fixture compartido, tests negativos (sin perfil = 0 taladros; host roto =
  issue explícita).
- V2: readback del programa congelado / KDT en vivo — se intenta sobre el
  stack local; si la infra no acompaña → NOT_RUN honesto con causa.

## Evidencia observada

- **TS**: helper `agregadoManualPlacementsForPart` (prefijos exactos espejo de
  `bom.ts:875-910`) + wiring en el loop de links con issue de resolución
  `DRILLING_AGREGADO_HOST_UNRESOLVED` (stage `agregado-host`, dedupe por
  partId, sólo cuando el BOM secundario resolvió). Suite dominio completa:
  **151 archivos / 2064 tests PASS**; tsc 0.
  - `agregadoPlacementDrilling.contract.test.ts` — fixture compartido, hole
    byte-idéntico en u0/u1, fallbackUsed=false, sin issues.
  - `projectDrilling.agregado.test.ts` — fail-closed del helper (prefijo
    ajeno / componente fantasma / passthrough no-agr), instancias repetidas
    con instanceTag (`#388`), negativo sin perfil = 0 taladros.
- **Go**: `agregado_placement_drilling_contract_test.go` sobre el MISMO
  fixture — `ResolveAuthoringLayout` (camino release definition-default)
  produce 1 op DRILL por unidad con host `agr-…-copy-0` exacto, provenance
  `manualHardwarePlacement` y hole idéntico al esperado. **Pasa sin cambiar
  una línea de Go**: el transporte agregado→CNC ya existía server-side; el
  fixture lo fija como contrato (antes sin cobertura). `go build ./...` y
  `go test ./internal/domain/engine/` PASS.
- **Contratos**: `check_openapi_drift.py` OK; meta CI `test_ci_*.py` 95 OK.
- **Lecciones de fixture**: el copy index arranca en 0 (`copy-0`, paridad
  #995); `inferHoleType` clasifica por NOMBRE del herraje («Bisagra»→hinge) —
  el fixture usa un nombre neutro; la cara `top` de un tablero no tiene
  espacio para offsets de herraje → el fixture usa `front`.

## Verificación por nivel

- **V0** PASS: tsc, go vet/build, drift OpenAPI.
- **V1** PASS: 2064 tests dominio (incluye los 9 nuevos), engine Go completo,
  meta CI 95.
- **V2** NOT_RUN: readback del programa congelado / KDT en vivo sobre
  GRA-CAJ-TEL exige autorar un placement con perfil en el catálogo real del
  owner + re-cortar release (mutación de datos demo del owner, fuera de la
  autorización de esta sesión). Camino frozen probado por el contract test Go
  sobre las mismas operaciones que `DeriveReleaseRoutingProgram` congela.
  Scope restante nombrado en el PR (`Delivery: partial`).

## Entrega

- HEAD/base y paths en el handoff al reviewer. Modo: **partial** (queda
  verificación en vivo owner + evidence pack #1061). Open question de la
  issue resuelta: miembros rígidos → issue propia (diferido autorizado por la
  issue).

## Ronda de corrección (post-review dual, 10-30)

- **Review**: judgment-day ciega, 2 jueces (A/B), ronda 1 — 0 severos,
  2 WARNINGs coincidentes (info), CI 22/22 en 13ecd88e.
- **Fix 1 (atribución)**: `DRILLING_AGREGADO_HOST_UNRESOLVED` cita ahora el
  item DUEÑO de la plantilla vía `itemIdByKey` (primera línea que resolvió el
  cacheKey, misma regla de identidad del mapa partId→módulo) en vez de
  first-match por moduleId — con varias líneas del mismo módulo (o con
  customDims distintos) antes podía citar la línea equivocada.
- **Fix 2 (aserción)**: el negativo «sin perfil» fija directamente
  `fallbackUsed === true` y el patrón byte-idéntico a la misma pieza SIN el
  placement (línea base) — cualquier taladro inventado rompería la igualdad.
- Revalidación V1 local: 2064/2064 dominio, tsc 0. Nuevo HEAD → CI y
  re-juzgamiento scoped (ledger congelado + delta) re-corridos.
