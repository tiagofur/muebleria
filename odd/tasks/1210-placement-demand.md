# ODD — #1210 los placements de módulo/estructura son demanda de herrajes

- Issue: https://github.com/tiagofur/muebleria/issues/1210 (aprobación del
  owner en conversación 2026-10-07, label `status:approved` registrada).
- Base: `origin/main` @ `fb5fa861` — rama `feat/1210-placement-demand`
  (worktree `muebles-worktrees/1210-placement-demand`, escritor único).

## Regla implementada (misma en TS y Go)

Un placement de componente (módulo o estructura) es DEMANDA de herraje:

1. **Resolución**: hardwareId concreto gana; si no, `optionRole` resuelve
   con las choices efectivas (ítem ⊕ proyecto) — el mismo mapa que consumen
   tableros y líneas.
2. **Posiciones ganan**: la línea en cantidad del módulo cuyo hardwareId
   RESUELTO esté posicionado se excluye (fuente única, sin doble conteo —
   mismo patrón que `agregados.ts`); las posiciones emiten líneas
   `POSITIONED` (id `placement-mod-<hardwareId>`) que cotizan por el mismo
   camino de validación y precio que las líneas manuales.
3. **Rol sin elección**: no fabrica demanda (el gate de precio bloquea
   required — #1046/1211 — y release falla cerrado); saltarlo mantiene
   estables las cotizaciones legacy.
4. **Sin identidad** (ni hardwareId ni optionRole): falla cerrado con error
   explícito (doctrina #1147).
5. **Choice inactiva/inexistente**: error, igual que una línea rota.
6. La cantidad de la instancia de componente multiplica; los placements de
   `structure_components` entran vía la estructura (viva o pineada) del
   módulo.
7. **Release incluido**: `ResolveBomForRelease` pasa por el mismo
   `resolveBomCommon` — el BOM de release lleva la demanda posicionada, y el
   gate choices ≡ consumo ya contaba esos roles (#1046).

## Alcance no cubierto (explícito)

- **Placements de componentes de AGREGADO en Go**: TS ya los expande con
  dedupe por instancia (`resolveAgregadoInstance`); el Go lo requiere
  reestructurar `collectAllHardwareLines` para dedupe por instancia
  (seguimiento pequeño, atrás del TS — hoy una cotización Go con agregados
  que posicen sigue sin contarlos desde Go; el TS sí).

## Verificación

- V1 Go: 6 tests nuevos en `hardware_placement_demand_test.go`
  (posiciones-ganan, concreto prices, rol sin elección salta, sin identidad
  falla, estructura × cantidad multiplica, choice inactiva falla); suite
  engine completa verde. Storage completa: ver PR.
- V1 TS: 6 tests nuevos en `engine.test.ts` (misma matriz); vitest
  workspace completo verde; `pnpm typecheck` OK.
- V2 (PG real, contenedor desechable):
  `TestQuoteCommercialSnapshot_PlacementDemandPricesExactHardware` — módulo
  compuesto SIN línea en cantidad, placement por grupo en
  `structure_components.overrides` → Q1 congela HardwareTotal = 80
  (2 unidades × 1 bisagra × $40) + descriptor BISAGRA-P por unidad. Antes
  de este fix ese mueble cotizaba $0 herrajes.
