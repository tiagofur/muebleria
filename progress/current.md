# Sesión activa

> **Siguiente prioridad de UI:** F102 — Semantic Tabs: two patterns, one workspace family. Alcance y no-goals en `progress/explore_f102_tabs_scope.md`. Normaliza tabs de estación (underline) y tabs peer de workspace (pill) migrando únicamente Órdenes e Ingeniería.
>
> **Pendiente histórico por id:** F077 — prep_venta_pricing_landing.
>
> Notas del working tree: `packages/domain/src/processStage.{ts,test.ts}`
> modificados son WIP ajeno del dueño (App.tsx ya los consume). No pertenece a
> F101/F102; no modificar, commitear ni mezclar sin confirmación.

skill_resolution: paths-injected

## F102 en curso — 2026-08-19

- Se consolidan `WorkspaceTabs` (peer/píldora) y `WorkflowTabs` (estación/subrayado).
- Migración limitada a `ProductionOrderHub`, `EngineeringWorkspace` y cobertura de regresión de `FabricScreen`.
- No se toca el WIP ajeno `packages/domain/src/processStage.{ts,test.ts}`.
- Verificación: focused tabs (30), `pnpm test`, `pnpm typecheck` y `./init.sh` verdes.
- Evidencia visual: bloqueada en este runtime; no hay Browser/Chrome/Computer Use disponible para abrir y capturar los breakpoints 390/768/1280. La estructura responsive queda cubierta por el contrato CSS (`tabs__scroller` sin wrap + overflow-x) y pruebas de semántica.
