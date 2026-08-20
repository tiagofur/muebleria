# Sesión activa

**Feature:** F124 (`cnc_nesting_engine`) — primera de la serie nesting de corte: F124 (motor) → F125 (DXF) → F126 (UI)
**Estado:** in_progress
**Fecha:** 2026-08-20

## Objetivo

Habilitar corte CNC nesting diferenciado del corte con sierra, conforme al plan acordado con el dueño del producto:

1. **F124 (esta feature):** `CutStrategy` en el dominio + motor MaxRects no-guillotina (`optimizer/nesting.ts`) que mezcla piezas grandes y chicas con espaciado de herramienta (`toolSpacingMm`) en vez de kerf. Dispatch por estrategia en `optimizeCutPlan` (default sierra = comportamiento actual intacto).
2. **F125:** writer DXF R12 ASCII en `packages/excel` (variantes tableros nesteados / piezas sueltas).
3. **F126:** UI — selector de tipo de corte + export exclusivo por modo (sierra → XLSX+PDF; nesting → DXF).

**Decisión de producto registrada:** D5 (production-module.md) revisada 2026-08-20 — nesting nativo habilitado por pedido explícito; Optimizer.xlsx sigue siendo la verdad de corte para sierra; DXF es la salida CNC. D6 (sin post-procesadores de marca) sigue vigente.

## Plan F124

- `optimizer/types.ts`: `CutStrategy`, `DEFAULT_TOOL_SPACING_MM = 8`, `CutPlanConfig.cutStrategy?` + `toolSpacingMm?`, `CutPlanSheet.strategy?` (todo opcional → retrocompatible con `Project.cutPlan` persistido).
- Extraer `unrollRows`/`PieceToPlace` a `optimizer/pieces.ts` (compartido guillotine/nesting, sin ciclo).
- `optimizer/nesting.ts`: `packSingleSheetMaxRects` (Best Short Side Fit, split de rectángulos libres maximalistas, spacing infla el rect usado en +X/+Y) + `optimizeSingleMaterialNesting`.
- `guillotine.ts`: dispatch en `optimizeSingleMaterial` cuando `cutStrategy === 'cnc-nesting'`; `buildSheetModels` registra `strategy` (default saw).
- Tests `nesting.test.ts`: invariantes (sin solapes, bounds con trims, spacing, veta grain=1 nunca rota, todo colocado), strategy/instructions vacías, fixture determinista kerf 12 vs spacing 4 donde nesting gana un tablero, y backward-compat del default.

## Bitácora

- [14:10] Entorno `./init.sh` verde. F122 (terminado, verificado) estaba sin commitear → commit aparte `fc02f62` para no mezclar features.
- [14:15] F124-F126 registradas en feature_list.json. F123 (hardening Compras) sigue pending — no es parte de esta serie.
