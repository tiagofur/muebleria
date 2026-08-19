# Sesión activa

**Feature:** F115 — cut_plan_optimizer_engine_and_persistence
**Estado:** Done
**Fecha:** 2026-08-19

## Objetivo
Implementar el motor de optimización de corte 2D guillotina multi-heurística en `packages/domain/src/optimizer/` (con kerf, refilado configurable de 4 lados [top/bottom/left/right], respeto estricto/libre de veta, deducción de cantos y detección automática de retazos útiles); persistencia de `cut_plan` JSONB en PostgreSQL y `backend-go`; conteo exacto de tableros enteros para Almacén; generador PDF vectorial profesional para taller con fases de corte y visualización acotada; y panel interactivo en UI.

## Tareas
- [x] **Dominio (Fase 1)**: Tipos y motor de optimización 2D guillotina en `packages/domain/src/optimizer/` (`types.ts`, `guillotine.ts`, `optimizer.ts`, `index.ts`), pruebas unitarias en `optimizer.test.ts` cubriendo kerf, veta, refilado de 4 lados, múltiples materiales y retazos útiles. Extender `Project` con `cutPlan?: CutPlan`.
- [x] **Backend & Persistencia (Fase 2)**: Migración `000060_project_cut_plan.up.sql` en `backend-go`, tipos en `backend-go/internal/domain/types.go`, operaciones en `internal/storage/projects.go` y serialización en `packages/storage/src/apiMappers.ts`.
- [x] **PDF de Taller (Fase 3)**: Generador vectorial `cutPlanPdfExport.ts` en `packages/excel` con carátula para Almacén, planos acotados por tablero con fases de corte, cantos, veta y retazos útiles. Tests unitarios en `cutPlanPdfExport.test.ts`.
- [x] **UI & Integración (Fase 4)**: Renovar `ProductionOrderOptimizationPanel.tsx` y `ProductionBoardView.tsx` para mostrar tableros exactos para Almacén, controles de refilado de 4 lados + kerf, visor SVG con cantos y retazos, guardar/congelar plan y exportar PDF en `App.tsx` y `projectStore.ts`.
- [x] **Verificación**: `./init.sh`, `pnpm test`, `pnpm typecheck`, `backend-go` tests verdes al 100%.

## Resultados de Verificación
- `@muebles/domain`: 658 tests unitarios pasando.
- `@muebles/storage`: 121 tests unitarios pasando.
- `@muebles/excel`: 72 tests unitarios pasando.
- `@muebles/ui`: 144 tests unitarios pasando.
- `apps/web`, `apps/desktop`, `apps/mobile`: 292 tests pasando.
- `backend-go`: tests pasando al 100%.
- Typecheck del monorepo: 0 errores.
- `./init.sh`: 100% verde.
