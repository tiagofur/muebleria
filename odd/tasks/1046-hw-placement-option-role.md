# ODD — #1046 HW-GROUP (herrajes por grupo de opciones o específico)

- **Issue**: tiagofur/muebleria#1046 (`status:approved`; autorización del
  owner 2026-10-04 en conversación directa: «creemos una solución para esto,
  que yo pueda elegir entre grupos que tenga de herrajes o a veces si quiero
  dar solo 1 opción»).
- **Lane**: Delegated Direct (multi-paquete TS+Go+UI, riesgo de taller por
  tocar el camino de perforaciones). Un escritor.
- **Base**: `origin/main` @ `3c4fa98a` (post #1045). Rama
  `feat/1046-hw-placement-option-role`, worktree
  `../muebles-worktrees/1046-hw-group`.
- **PR**: tiagofur/muebleria#1051 (`Refs #1046`, `Delivery: partial`).
- **Estado**: IMPLEMENTED_PENDING_REVIEW (S1 entregado; restante: browser
  proof E2E del flujo — aceptación #5).

## Hechos verificados (2026-10-04, main 3c4fa98a)

1. El mecanismo de grupos ya existía de punta a punta para `HardwareLine`:
   `OptionGroup kind='hardware'` (catálogo+RLS+UI `/option-groups`), choice
   por ítem/nivel proyecto (`effectiveOptionChoices`) y resolución
   `hardwareId` **o** `optionChoices[optionRole]` en TS
   (`engine/bom.ts:221`) y Go (`engine/engine.go:126`).
2. El hueco exacto: `HardwarePlacement.hardwareId` requerido y sin rol —
   los herrajes posicionados en 3D (donde viven las bisagras de una puerta;
   base de perforaciones, machining y demanda por posiciones) exigían un
   herraje concreto. La lista "en cantidad" del agregado soportaba rol con
   dos selects paralelos confusos (S4 #1009).
3. Punto único de resolución Go: `expandLayoutInstances`
   (`engine/layout.go:731`) copia los placements de instancias (módulo,
   estructura y agregados pasan por ahí) con `optionChoices` en alcance; el
   authoring resolve materializa placements server-side para la web
   (`webAuthoringResolve` sólo manda identidad/parámetros/choices).
4. El gate choices ≡ consumo (#727) vive en `ConsumedOptionRoles`
   (`release_unit.go:174`) + `collectModuleOptionRoles` (TS,
   `exportIssues.ts:82`) — ninguno contaba placements.

## Cambios (3 commits atómicos)

1. `feat(domain)` a7dbd956: tipo + `resolvePlacementHardwareId` + consumo en
   estimado del agregado (`optionOverrides` de instancia), drilling
   (`resolvePartDrilling` con choices efectivas por ítem; fallback F074
   intacto) y colector de roles con placements (módulo/estructura/agregados).
2. `feat(backend-go)` 4b751f19+: `resolvePlacementHardwareIDs` en
   `hardware_placement_resolve.go`, llamado en `expandLayoutInstances`;
   `ConsumedOptionRoles` consume roles de placements (walk módulo +
   estructura + agregados); `HardwarePlacement.OptionRole` en
   `domain/module.go`.
3. `feat(ui)`: Modo "Grupo de opciones / Herraje específico" por fila en
   `HardwarePlacementsEditor` (agregados, módulos, estructuras) con hint de
   miembros + costo y aviso "se elige al cotizar"; la lista en cantidad del
   agregado adopta el mismo Modo (adiós "(Por Rol)" escondido). Sin grupos
   el editor queda exactamente como antes.

## Semántica fail-closed (idéntica TS/Go)

- `hardwareId` concreto gana (nunca consulta choices).
- Rol + elección → se sustituye el herraje elegido ANTES de machining/
  drilling/demanda (esos pipelines no cambian).
- Rol sin elección: grupo `required` (o desconocido) → error del resolve;
  grupo opcional → el placement queda fuera, nunca fabricado.
- Ni `hardwareId` ni rol → error de autoría.
- Elección inactiva → error.
- `ConsumedOptionRoles`/`collectModuleOptionRoles` cuentan el rol sólo con
  elección resuelta; el gate de release congela la choice.

## Verificación (local)

- Typecheck 8/8; domain vitest 1781/1781; ui vitest 2116/2116.
- Go: `./internal/domain/... ./internal/api/...` PASS; `./internal/storage/`
  PASS contra PostgreSQL real en contenedor desechable (`granete_test_1046`
  @5522, `GRANETE_TEST_DATABASE=1`, roles separados) — migraciones + RLS.
- Nuevos tests: resolución unitaria (TS+Go), layout sustituye/falla/deja
  fuera, gate de consumo, drilling por rol, UI Modo en ambas superficies.
- NOT_RUN local: gates browser/proyectar visual (los corre CI sobre el PR);
  `rake verify` SketchUp (host real; contrato SU sin cambios en S1).

## S2 (fuera de este PR, nombrado en la issue)

Inspector SketchUp con grupos y reemplazo entre miembros; `DoorHingeRule`
honrando la elección; acabados de herraje (snapshot comercial v2).

## S3 — Herrajes por grupo en el Inspector de mueble (2026-10-05)

- **Autorización**: owner en conversación directa («empezamos» sobre el plan
  revisado: elegir modelo de herraje como frente/interior). Encuadre exacto del
  S2 restante nombrado por la issue: «inspector muestra grupo y reemplazo entre
  miembros». Quedan FUERA: DoorHingeRule dinámico (#1078), acabados de herraje
  (snapshot v2), hardwareChoices a nivel diseño (#784 extensión).
- **Base**: `origin/main` @ `875f2b65` (post #1099). Rama
  `feat/1046-hw-group-mueble-inspector`, worktree
  `../muebles-worktrees/1046-hw-group-mueble`. El checkout main queda intocado
  (dirty de #1056, otro escritor).
- **Hechos verificados (base 875f2b65)**:
  1. El update de mueble ya manda SOLO
     `{furnitureDefinitionId, catalogRevision, parameters, materialChoices}`
     (`submit_minimal_authoring_resolve`, catalog_provider.rb:258) — sin
     `hardwarePlacements` → `present=false` → el motor materializa los
     placements del definition sustituyendo grupos por choices. Una elección de
     grupo viaja limpia SIN pinnear (el fork semántico sólo existe en
     `substitute_hardware`/`update_hardware_placement`).
  2. La proyección de taller (`workshopFurnitureCatalog`,
     furniture_catalog.go:131) NO incluye `hardware` ni `optionGroups`: el
     plugin cae SIEMPRE a la lista estática de demo (`all_hardware` fallback).
     La sustitución por familia del S2 lista candidatos estáticos, no el
     catálogo real del taller. Este slice lo corrige.
  3. `resolved.layout.hardware` no lleva `optionRole` (ni Go engine, ni api
     wire, ni TS type, ni parser Ruby) — el plugin no puede distinguir un
     placement por grupo de uno concreto.
  4. TS valida `resolved.layout.hardware` sólo como array (sin allowlist por
     clave) → campo opcional pasa sin tocar el fixture compartido
     (decisión: NO editar `sketchupAuthoringResolve.contract.json`; evita
     polución cross-spec tipo #1096).
  5. Contrato Ruby de materialChoices valida strings sólo → los grupos
     hardware viajan en el mismo mapa sin cambio de contrato.
- **Diseño**:
  - Go: `LayoutHardware.OptionRole` (engine) + wire api response; proyección
    de taller gana `hardware` (activos, sin costos — decisión: precio fuera del
    payload del plugin v1) y `optionGroups` kind=hardware; ambos entran al hash
    de `revisionId` (choices dependen de ellos).
  - Ruby: parser layout `optionRole` opcional; metadata hijo
    `intent['optionRole']`; SelectionContext `optionRole` +
    `hardwareGroups` (escaneo por mueble, fail-closed por hijo); guard
    client-side que RECHAZA offset/sustitución por ocurrencia sobre placements
    por grupo (evita el pin; código `HARDWARE_GROUP_MANAGED`).
  - JS: sección «Herrajes por grupo» en la card del mueble (sólo grupos
    consumidos; sin grupos no aparece), modal selector propio
    (`granete-hardware-group-selector.js`, patrón #848 Phase B), pick al draft
    existente (#784) y Apply por `update_furniture` — sin mutación nueva. Card
    hijo: badge «Por grupo» + bloqueo con derivación a la sección del mueble.
- **Verificación**: Go engine/api/catalog tests; Ruby unit (layout contract,
  builder, selección, guard, provider); JS harness (inspector, child, selector);
  `bundle exec rake verify` + `verify_affected` al congelar. V2 host real
  (TestUp/smoke) queda NOT_RUN en este slice — se declara en el PR.

## S3 — Entrega (2026-10-05)

- **Candidato**: `feat/1046-hw-group-mueble-inspector` @ `d527f8f6`
  (base `origin/main` @ `875f2b65`). 4 commits atómicos:
  966dbefa (backend+contratos), c2e4ddbb (Ruby plugin), 0d843c00 (UI),
  d527f8f6 (boundary fix).
- **Decisión de producto tomada en vuelo**: el payload de hardware al
  plugin NO lleva costos (precio sigue siendo del lado servidor;
  estimado/preflight lo reflejan). Documentada acá para revisión.
- **Hallazgo de extensión**: el eco de placements en mutaciones de
  componente (#467) es equivalente-por-construcción para grupos (eco de la
  elección vigente; el metadata hijo se escribe desde el layout resuelto
  que preserva optionRole; materialChoices persiste) — sin pin real. El
  único pin posible (sustitución/offset manual) queda guardeado en Ruby.
- **Verificación local (HEAD d527f8f6)**:
  - `bundle exec rake verify` (Ruby 3.2 pin): syntax+lint 0 offenses+unit
    1348/0+boundary+RBZ readback (sha256 7df0c21f…).
  - Go `./internal/api/ ./internal/domain/...` ok (golden del contrato
    regenerado y revisado: sólo cambian los hash catalogRevision).
  - `pnpm typecheck` ok; `@granete/domain` vitest 1792/1792.
  - `check_openapi_drift.py` current; scripts factory/ci OK.
  - Harness JS: inspector 52, child 25, selector 5 — todos los *_test.js
    del diálogo pasan.
  - NOT_RUN local (CI/owner): `go test ./...` storage (PG), `pnpm test`
    web/ui completo, visual/browser/foundation gates, **smoke host real
    (TestUp/SketchUp)** — el DoD de UX de autoría pide evidencia de host:
    queda pendiente para el owner tras instalar el RBZ de este branch.
- **Restante de #1046** (sigue partial): DoorHingeRule honrando la elección
  (cantiad de bisagras dinámica → #1078), acabados de herraje (snapshot
  comercial v2), hardwareChoices a nivel diseño (#784 extensión), y el
  smoke host de este slice.
