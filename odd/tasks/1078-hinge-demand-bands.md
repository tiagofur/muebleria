# ODD 1078 — Cantidades de bisagras por banda de altura de puerta

- **Issue**: #1078 (`status:approved` 2026-10-07, este prompt = autorización owner)
- **Base**: origin/main @ b8b6b375 (incluye #1212/#1213/#1214/#1216 mergeados)
- **Rama**: `feat/1078-hinge-demand-bands` (worktree `muebles-worktrees/1078-hinge-bands`)
- **Rol**: Implementador único; revisión independiente pendiente.

## Alcance aprobado (issue)

1. Demanda de bisagras derivada de la altura de puerta por bandas
   (≤900→2, 901–1600→3, 1601–2000→4, 2001–2400→5, clamp 5; Blum +1 si
   ancho>650) por puerta colocada, honrando optionRole/elección de grupo
   (#1046).
2. Banda overridable por política de fábrica con escalera C3 completa.
3. Perforación de cazoletas con las MISMAS posiciones que la demanda cuenta.
4. Retirar la línea fija 2×BISAGRA de los seeds; la demanda deriva.
5. Fuera de alcance (issue): mecanizado de cazoletas por kind (#874), peso de
   puerta como input, bandas por marca.

## Auditoría (lo que YA existe y se reutiliza)

- `suggestHingeCount` (`packages/domain/src/workshopRules.ts:21`) ya gobierna
  DÓNDE perfora F129 (`hingePositions` ← `doorHingePlacements`,
  `jointDrillingRules.ts:149/323`), pero con bandas viejas (≤800/1400/2000)
  y sin recargo por ancho. La demanda (cuánto se compra) es la línea fija
  `2×BISAGRA` en `hardware_lines` (3 seeds Go + 5 fixtures TS).
- `resolveBomCommon` (`resolve.go:136`) ya tiene la escalera de #1213:
  `collectPlacementHardwareDemand` → posiciones ganan sobre línea bulk
  (`resolvedBulkHardwareID`) → `resolveBomFromParts` appendea
  `positionedLines`. La banda se inserta como TERCER origen en esa escalera:
  **posiciones > banda > línea bulk** (dedupe por hardware resuelto).
- `FactoryConstructionPolicy` (Go+TS, fixture de paridad) NO toca bisagras;
  familias floor/shelf/backPanel. La política hoy no entra al resolve del
  BOM — viaja por `ReleaseServerInputs` a routing/perfiles.
- Puerta = parte con `OptionRole "FRENTE"` (criterio canónico
  `isDoorBoard`, `authoring_door_swing.go:82`); el componente seed
  COM-PUE-01 lleva `option_roles ["FRENTE"]` y dims 717×296.
- Gate de cotización (`collectUsedOptionRoles`, optionGroupHelpers.ts) lee
  roles de líneas, componentes, placements y agregados + roles sintéticos
  de base. Si los seeds sueltan la línea, la banda debe declarar el rol.

## Diseño

### Banda pura (paridad TS↔Go por fixture compartido)

`contracts/hingeDemandBands.contract.json` pinnea: bandas default, recargo
Blum, clamp, bandas custom, rol. Consumido por vitest + go test.

- TS `packages/domain/src/hingeDemand.ts`: `HingeDemandBand`,
  `HingeDemandPolicy { optionRole?, bands, widthSurgeOverMm? }`,
  `DEFAULT_HINGE_DEMAND_POLICY`, `hingesForDoor(h, w, policy?)`.
- `suggestHingeCount` se realinea a las bandas de la issue (delegando) →
  perforación y demanda comparten la MISMA función (aceptación #3).
- `hingePositions(doorHeightMm, endMarginMm, gridMm, widthMm?, policy?)` y
  `doorHingePlacements` pasan el ancho de puerta + política opcional.
- Go `engine/hinge_demand.go`: espejo exacto (`HingesForDoor`).

### Identidad y escalera de dedupe

Identidad de la banda = resolución del rol (`BISAGRA` default, configurable
en la política) por las choices efectivas — mismo camino #1046/#1213. Sin
elección → sin línea (el gate exige el grupo antes de cotizar). Escalera por
(módulo, hardware resuelto): **placements (#1213) > banda > línea bulk**.
La banda además DEJA GOBERNAR la línea bulk del mismo hardware: su cantidad
fija muere (issue paso 4).

### Nivel fábrica: la política viaja en el catálogo

`domain.Catalog.ConstructionPolicy *FactoryConstructionPolicy` (nuevo, opc.):

- `GetFullCatalog` lee el overlay de la org y parsea (parse existente
  extendido con familia `doorHingeDemand`).
- `publishResolutionCatalog` lo hornea → releases inmubles usan la política
  congelada (parity cotización↔release por construcción).
- `resolveBomCommon` la lee del catálogo: cero cambios en entry points.
- Nivel componente (C3): `BoardPart.CatalogComponentID` (nuevo, opc.,
  seteado en `expandComponentInstances`) + `ComponentOverrides[id].hingeDemand`.
- TS: `Catalog.constructionPolicy?` + `resolveBom` acepta política opcional
  en params (web la pasa cuando tiene el overlay); paridad por fixture.

### Gate y UI

- `collectUsedOptionRoles`: módulo con componente puerta (placement
  `puerta`) → agrega el rol de la banda (default BISAGRA). El picker/gate
  siguen exigiendo la elección (#1046) aunque no haya línea.
- La línea derivada lleva `DescriptionOverride "Banda por altura de puerta"`
  → visible en cotización/breakdown/export; browser proof: cambiar altura
  deriva la cantidad (720→2, alto→5).

### Seeds

Quitar `2×BISAGRA` de MOD-GAB-01, MOD-BAJO-ZOCLO-600, MOD-BAJO-PERFIL-600
(seed.go) y de los fixtures TS (cocinaLopezDemo ×2, plantillaDemo ×3).
Paridad numérica: puerta 717×296 → 2 bisagras (≤900, sin recargo) = misma
cantidad que la línea fija; cambia el origen/ID (`hingeband-*`), no el total.

## Fuera de alcance declarado (reste explícito)

- Puertas en AGREGADOS (AGR-PUE-*): demanda TS-only hoy; banda para
  agregados queda como follow-up (no está en la aceptación de la issue).
- Política de fábrica → perforación F129 server-side (Go no deriva F129).

## Tareas

- [x] T1 TS: hingeDemand.ts + realineo suggestHingeCount/hingePositions +
      fixture compartido + tests (24/24 contrato + 1831/1831 domain).
- [x] T2 Go: tipos a domain (alias engine), familia doorHingeDemand
      (tri-estática surge: ausente=hereda, null→0=desactivada, número=umbral),
      excepción por componente, catálogo lleva la política (vivo + freeze),
      resolveBomCommon banda + escalera dedupe, tests Go (contrato fixture +
      comportamiento; suite engine completa verde).
- [x] T3 seeds Go fuera línea fija (MOD-GAB-01, MOD-BAJO-ZOCLO-600,
      MOD-BAJO-PERFIL-600) + economía demo fijada por test
      (demoHingeEconomics.test.ts: cada total autorizado sobrevive la banda).
- [x] T4 resolve TS espejo (bom.ts ambos brazos + collector +
      Catalog.constructionPolicy tipado), gate ui (puerta ⇒ grupo exigible,
      picker, estructura), 4 aserciones de engine.test a la realidad derivada,
      spec E2E navegador hinge-demand-bands.spec.ts (typecheck 0).
- [x] T5 verificación: pnpm typecheck 0 errores; pnpm test workspace 0 (2
      pasadas); backend PG real VERDE (backend-test.sh 713s: storage 491s,
      api 22s, pilotreadiness 186s — el seed sin línea fija sobrevive toda
      la suite); browser gate hinge-demand-bands.spec.ts exit 0 (playwright
      propagate; script imprime PASS en stderr); gofmt limpio en archivos
      del slice; rake sketchup NOT_RUN (0 diffs Ruby — superficie intacta,
      la demanda vive en Go/TS ya probados).

## Hallazgos de implementación (para el revisor)

- JSON null vs ausencia: Go `*float64` no distingue — el parser de overlay
  mapea null→0 (desactivada) y el fixture usa 0; TS lee 0 igual (0>0 falso).
- `HingesForDoor` hereda la política COMPLETA por defecto (bandas Y surge) —
  el bug que el probe detectó (sólo bandas heredaban) quedó cubierto por test.
- Consumo de rol en release: la línea hingeband-* cae en la rama #830 de
  ConsumedOptionRoles (no es línea de catálogo) — el choice queda consumido
  sin tocar validateReleaseUnitChoices.
- Línea bulk de ROL sin elección: el resolve YA falla cerrado (comportamiento
  preexistente verificado por test) — el escenario post-seed es sin línea y
  sin elección = demanda 0 y resolve verde; el gate exige el grupo antes.
- Puertas en cajoneras (frente_cajon) no son puerta: líneas bulk sobreviven
  (probado en economía demo plantilla).

## Reste explícito (fuera de la aceptación de la issue)

- Cableado web de la política de fábrica en previews vivos: el cliente
  resuelve con la escalera de librería (server es la autoridad de $); la web
  ya carga el overlay (useFactoryConstructionPolicy) — pasar
  doorHingeDemand al resolve vivo es follow-up (familia nueva, sin overlays
  reales: ambos lados acuerdan por defecto).
- Puertas en agregados (AGR-PUE-*): demanda TS-only hoy; banda para
  agregados queda como follow-up.
- Política de fábrica → perforación F129 server-side (Go no deriva F129;
  la paridad perforación=demanda vive en la función compartida TS).

## Verificación (V0/V1/V2)

- V0 estructural: typecheck + builds.
- V1 funcional: unit TS/Go (fixture compartido, escalera, dedupe), PG real
  con delta exacto (720→2 / 2100→5 / recargo ancho / swap elección /
  posiciones-ganan).
- V2 operativa: browser E2E gate+deriva; export EXP-08 refleja banda.

## Entrega

Un PR con commits convencionales por slice. `Closes #1078` +
`Delivery: complete` sólo si toda la aceptación está probada; si algo queda,
`Refs + Delivery: partial` con el reste nombrado.
