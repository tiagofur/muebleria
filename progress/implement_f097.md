# F097 — Producción: dashboard honesto y surtido visible

## Alcance implementado

- El KPI principal del Dashboard de Producción ahora cuenta `productionProjects`,
  exactamente la misma colección `accepted`/`produced` que se renderiza en la
  lista. Ya no consume el agregado de backend que puede venir de otro scope.
- Las obras sin módulos muestran `Sin módulos cargados`, progreso `—` y no
  renderizan etapas `0/0`; nunca se presentan como `Completado`.
- El estado terminal de las obras con módulos usa el label `Completado`.
- Los emojis de sectores fueron sustituidos por iconos Lucide (`Scissors`,
  `Wand2`, `Armchair`, `Package`, `Truck`, `House` y fallback `Settings2`),
  todos con `strokeWidth={1.5}`.
- El board de Corte/Encintado recibe el estado de picking persistido como
  `pickingStatus`, no como un booleano inventado. `despachado` muestra
  `Surtido por almacén`; `pendiente` muestra `Almacén: Pendiente`; si no hay
  una fila persistida, no muestra ningún estado de surtido.

## Límite de la asociación de picking

La persistencia disponible es `ProjectPickingState { projectId, material }`,
donde `material` es una categoría (`tableros` o `cintillas`), no un ID de
tablero ni de canto. Por eso el estado sólo se une cuando existe exactamente la
relación persistida obra×categoría correspondiente; se replica como estado de
la lista de esa categoría, sin afirmar disponibilidad de stock ni atribuir un
despacho a un material/canto individual. El detalle por material/canto requerirá
un contrato de picking nuevo y queda fuera de F097.

## Pruebas añadidas

- `ProductionManagerDashboard.test.tsx`: KPI igual a lista, estado explícito
  para cero módulos e iconos Lucide en sectores.
- `fabricProjectCards.test.ts`: conservación de `pendiente` y ausencia de
  asociación falsa.
- `FabricScreen.test.tsx`: wiring visible de estado pendiente sin afirmar
  despacho/stock.

## Verificación

- `pnpm --filter @muebles/ui exec vitest run src/production/ProductionManagerDashboard.test.tsx src/production/FabricScreen.test.tsx src/production/fabricProjectCards.test.ts` — 25 tests OK.
- `pnpm --filter @muebles/ui typecheck` — OK.
- `pnpm test` — OK (UI: 105 archivos, 959 tests).
- `pnpm typecheck` — OK.
- `./init.sh` — OK.
- `git diff --check` — OK.

## Estado

Implementación lista para revisión. F097 permanece `in_progress`.

## Entrega

- Commit de cierre: `5cdba26` — `fix(production): align dashboard and picking status`.
- Push confirmado a `origin/codex/f095-production-claims`.
