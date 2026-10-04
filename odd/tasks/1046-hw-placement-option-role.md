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
