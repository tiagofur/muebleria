# Sesión

**Feature en curso:** F187 — COMPONENTINSTANCEID ÚNICO: CONTADOR GLOBAL DE
COPIES POR COMPONENTE (#434) (COMPLETADA; rama `fix/434-unique-copy-ids`
apilada sobre `feat/415-native-component-renderer`)
**Cerrados con evidencia (ledger done):** F169–F186 (PRs #419–#433 + #435 en
review; F186 incluye host smoke real 17/17 en SketchUp 2026.2,
`progress/host_smoke_F186_testup_ci.json`)
**Inicio:** 2026-08-27
**Contexto:** fix del hallazgo lateral de F186/#415 (registrado como #434).

## Problema

`expandComponentInstances` (TS, `bom.ts`) y `expandLayoutInstances` (Go,
`layout.go`) numeraban el copy index PER ENTRADA: dos entradas apuntando al
mismo ComponentID en una estructura/agregado emitían ambas
`{prefix}{id}-copy-0` → `componentInstanceId` duplicado en el layout
resuelto. Con el renderer nativo (#415) eso colisiona metadata de pieza y
vuelve ambiguos los `hostComponentInstanceId` de herrajes.

## Diseño entregado

1. **Contador global por componente** dentro de cada expansión (Map/Set →
   `copyCounters`), usado SÓLO para el ID: dos entradas qty 1+2 → copy-0/1/2
   únicos. Espejo exacto TS↔Go.
2. **Semántica #414 intacta:** el índice del loop por entrada sigue
   gobernando fórmulas espaciales (variable `i`/`I`) y poses; documentado en
   comentario en ambos engines. Cero cambio para autoring sin duplicados
   (golden sin drift).
3. **defID invariante:** `componentDefinitionId` sigue compartido por todas
   las copias (#346).

## Evidencia

- TS: `pnpm test` (domain incl.; test nuevo `#434 keeps copy ids unique…`
  pasa) + `pnpm typecheck`: OK.
- Go: `go test ./...` OK (TestLayoutComponentDefinitionIdentity extendido al
  escenario de entradas duplicadas con aserción de no-colisión).
- Golden `sketchupLayoutTransform.contract.json` sin cambios (fixture sin
  duplicados ⇒ ids intactos).

## Nota

PR apilado sobre `feat/415-native-component-renderer` (base del PR =
esa rama; se re-target a main cuando #435 mergee) porque `layout.go` toca las
mismas líneas que #435 (defID).
