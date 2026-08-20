# Sesión activa

**Feature:** F126 (`cut_strategy_ui_export_dispatch`) — serie nesting de corte: F124 ✅ → F125 ✅ → **F126**
**Estado:** in_progress
**Fecha:** 2026-08-20

## Objetivo

UI del tab Optimización (Ingeniería): selector de tipo de corte antes de generar y export exclusivo por modo. `docs/design.md` leído completo antes de tocar `.tsx` (regla dura).

## Bitácora

- [15:00] Panel `ProductionOrderOptimizationPanel.tsx`: selector «Tipo de corte: Sierra | CNC Nesting» (toggles con `aria-pressed`, patrón de los selectores de tablero existentes), input condicional (kerf ↔ espaciado fresa con tooltip), subtítulo dinámico.
- [15:02] `handleGenerateCutPlan` envía `cutStrategy` + `toolSpacingMm` al `optimizeCutPlan`. El área de export sigue la estrategia del PLAN GENERADO (`planStrategy`), no la del selector vivo — el archivo siempre corresponde al layout en pantalla.
- [15:03] Export exclusivo: sierra → PDF de taller + **Optimizer XLSX** (card nueva, prop `onExportOptimizer` ya existente en EngineeringWorkspace) + placeholder seccionadoras; nesting → card **DXF** (tableros/piezas) que reemplaza el placeholder «CNC Nesting / G-Code — Próximamente». Sidebar de secuencia de cortes solo sierra (nesting no tiene secuencia).
- [15:04] Wiring: `EngineeringWorkspace` pasa `onExportOptimizer`/`onExportCutPlanDxf` → `ShellView` prop `handleExportCutPlanDxf` → `useExportHandlers` handler con toast + busy → `apps/web/src/exportCutPlanDxf.ts` (nuevo) → `dxfCutPlanExport` de `@muebles/excel`. MIME `.dxf` agregado a `downloadOptimizerXlsx`.
- [15:05] Tests panel (6): testids + selector swap kerf/espaciado + exclusividad sierra/nesting + calls DXF con variante + secuencia condicional (requiere `cutRows` no vacío — la sección 3 muestra empty state si no).
- [15:08] `pnpm test` completo verde (2338), `pnpm typecheck` 7 workspaces.
- [15:10] `docs/roadmap-screens/02-ingenieria.md` actualizado: selector + card DXF en spec del tab.

## Próximo paso

Review F126 → done + history → push final de la serie.

