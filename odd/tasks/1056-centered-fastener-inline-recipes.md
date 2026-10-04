# G-ODD — #1056 Recetas inline y herraje único centrado (stationMode center)

Topología: **Delegated Direct** (GLM/ZCode, sesión demo KDT 2026-10-04). Escritor único;
revisor fresco pendiente sobre el HEAD/base exactos de este PR.

## Slices entregados

1. `stationMode: "center"` en `ContactOperationRule` (Go + espejo TS): la regla aplica
   una vez al punto medio del overlap (`StationIndex -1`, slot final del orden
   station-major estable); validación fail-closed (`OPERATION_RULE_INVALID`).
2. `recipes` inline en bindings `structureRelationship`: `FurnitureParameterRecipeBinding`
   + validación en `furniture_parameters.go` + conversión por target en
   `authoring_resolve.go` (1 patrón total / N=targets 1:1 para espejados). Gana a la
   síntesis del servidor por diseño (authored-override-wins).
3. Mapa de mecanizado manual: `BIS-BLUM-110`, `HER-PLACA-BIS`, `JAL-TUB-SAT`,
   `HER-TOR-3X20`, `HER-TAQ-8X30`. Fixture de contrato regenerado (Go golden author).

## Evidencia

- Go: `TestContactRuleStationModeCenter` + suites Contact/FixedShelf/Parameter verde.
- TS: `stationMode center` en `sketchupRelationshipMachining.test.ts` (77/77) y paridad
  de contrato 20/20; `tsc --noEmit` limpio.
- E2E real (demo KDT, no forma parte del PR): resolve 0 issues con manguetes
  "2 Spax + 1 taquete central por lado" y respaldo 4×Ø3×15; liberación congelada con 60
  agujeros; 8 XML KDT con el central a 75mm verificado. Artefactos:
  `artifacts-local/kdt-demo-2026-10-04/`.

## Desviaciones / notas

- La UI de autoría de recetas inline queda para la superficie de construcción de
  componentes (#1052); hoy la declaración es vía definición JSON.
- El chequeo `check_pr_metadata.py` es CI-only: FALLA local esperado.
