# Review — feature F130

**Veredicto:** APPROVED

Commit revisado: `7002af8` (HEAD de main, pusheado; `git rev-parse HEAD origin/main` coincide,
working tree limpio).

## Checkpoints

- C1: [x] Harness completo. Nota OC-001 conocida de `init.sh`: se verificó con
  `pnpm test` + `pnpm typecheck` directos (ambos verde).
- C2: [x] Única feature `in_progress` = F130 (correcto a la espera de este review);
  `progress/current.md` describe la sesión activa.
- C3: [x] Boundaries respetados: `packages/domain/src/projectDrilling.ts` sólo importa
  módulos internos de domain (sin react/fs/xlsx); excel importa types de domain;
  ui/web llaman al dominio sin calcular. Sin `console.log`, sin `any` explícito en los
  archivos tocados (los `let drilling;` / `let data;` son evolving-let, pasan strict).
- C4: [x] `pnpm test` verde real: 2444 tests (domain 732, storage 134, excel 89,
  ui 1142, mobile 36, desktop 17, web 294). Goldens DXF regenerados pasan.
- C5: [x] Tree limpio, sin untracked sospechosos, todo pusheado. El cierre de sesión
  (history + status done) queda para el commit de cierre posterior, como en F128/F129.

## Aceptación (6 ítems)

1. **Capas por operación+Ø documentadas**: [x] `dxfCutPlanExport.ts:75-95` documenta
   la convención PERF_F<Ø> / PERF_B<Ø> / PERF_CANTO<Ø> con colores 4/1/6 y la razón
   "profundidad NO en la capa; capa=tool". Nota: la description ilustraba
   `PERF_8_CIEGO`/`PERF_35_TAZA` (por tipo); la implementación elige cara+Ø, decisión
   razonable y documentada (mismo Ø = misma herramienta; el tipo/persistencia vive en
   el reporte JSON). Desviación consciente, no defecto.
2. **Back espejado, usuario nunca transforma**: [x] Verificado POR EJECUCIÓN contra el
   módulo real (jiti + `dxfCutPlanExport`): pieza 600×590, agujero back x=590,y=100 →
   círculo en (100, **0**) — cae al borde contrario; back x=30 → Y=560 (=590−30);
   front x=590 → Y=590 (sin espejo). Convención documentada en
   `dxfCutPlanExport.ts:79-81` y `:248-250`.
3. **Reporte fuente real, schema v1 intacto**: [x] `resolveProjectDrilling` emite
   `ProjectDrillingData` (misma interfaz de `partDrilling.ts`, mismas claves) con
   conteos consistentes (test). Hub usa fuente real con fallback F074
   (`useProductionOrderDocuments.ts:51-60`).
4. **Pack ZIP + panel Ingeniería**: [x] `exportProductionPack.ts:158-168` agrega
   `perforaciones_<obra>.json` (best-effort); `useExportHandlers.ts:438-453` pasa
   drilling real al DXF con try/catch que preserva la geometría de nesting.
5. **Goldens contra writer R12**: [x] Delta de ambos goldens = solo 4 entradas LAYER
   nuevas + contador 6→10 + círculos reclasificados de `PERF` a `PERF_F10/PERF_F35`
   con coordenadas idénticas + 1 círculo `PERF_CANTO8` nuevo. Nada más cambió.
6. **Suites**: [x] `pnpm test` 2444 passed / `pnpm typecheck` 7 paquetes Done.

## Puntos específicos pedidos

- **Join manual `-copy-N`**: [x] stem `partId.slice(0, indexOf('-copy-'))` igual a
  `instance.componentId` cubre structure+module instances (bom.ts:493, idPrefix='' en
  líneas 566-580). Derived joins filtrados por `p.partId === link.partId` (F129 emite
  partIds del array resuelto, incluidas copias). Quantity×N no duplica patrones
  (patterns siguen links colapsados por fila; test 5/5 del assembler).
- **Fallback F074 marcado y no roto**: [x] `partDrillingResolver.ts:511-533` — sin
  perfiles resueltos aplica `inferHolesForPiece` con `fallbackUsed=true`; las piezas
  sin herraje no pierden perforaciones.
- **Join DXF labelRef→partCode**: [x] `dxfCutPlanExport.ts:239`
  (`get(p.labelRef ?? p.partCode) ?? get(p.partCode)`) — compat con fixtures manuales
  (los patterns F074 keyean por moduleCode-partCode).

## Observaciones no bloqueantes (para F131/limpieza)

1. `packages/excel/src/dxfCutPlanExport.test.ts:227` — la rama back/espejo no tiene
   test persistido (el fixture no tiene agujeros back; el propio test lo admite).
   Este review la verificó por ejecución, pero conviene agregar un back hole al
   `drillingFixture` con assertion de coordenada espejada para blindar regresiones.
2. `packages/domain/src/projectDrilling.ts:98,124-128` — `placementsByModule` se
   escribe pero nunca se lee (el loop por link recalcula `manualPlacementsForPart`).
   Cálculo muerto; eliminar o reutilizar.
3. `packages/domain/src/projectDrilling.ts:61-65` — el comentario "suffix match keeps
   the join working for both" sobresoporta: los ids de agregado llevan prefijo
   `agr-<id>-u<N>` (bom.ts:687-690) y `startsWith(componentId)` no puede matchearlos;
   placements agregado-scoped quedan efectivamente para F131 (deuda ya documentada en
   progress/current.md). Ajustar el comentario al cerrar F131.
4. `packages/domain/src/projectDrilling.ts:143-150` — atribución partId→módulo "first
   wins" asume ids de parte únicos por módulo; dos módulos de catálogo que compartan
   la misma estructura con dims distintas cruzarían los derived joints. Edge case sin
   fixture que lo ejerza; vigilar cuando existan estructuras compartidas.
5. `packages/excel/src/dxfCutPlanExport.ts:94` — `Math.round(diameterMm)` en el nombre
   de capa: Ø7.5 y Ø8 colisionarían en PERF_F8. Los Ø system-32 actuales son enteros
   y el reporte conserva el Ø exacto; observación.

## Diseño UI/UX

No aplica (sin cambios visuales; el diff UI es sólo enhebrado de props/catalog).
