# Sesión activa

**Feature:** F119 — shell_refactor_slim (cierre con scope honesto)
**Estado:** Done (remanente → F120)
**Fecha:** 2026-08-20

## Objetivo

Slimming del shell tras el Judgment Day del Shell: sacar el bloque de compras/stock a store, unificar los exports en un helper, limpiar muertos y completar deep-links.

## Qué se hizo (4 commits)

1. **purchasingStore** (`apps/web/src/stores/purchasingStore.ts`, 478 L): migrado verbatim el bloque Fase 3/3b/3c (~450 L de App.tsx) — picking, stock + ledger, proveedores, OCs y `togglePick` (con revert best-effort del ledger). RBAC gates quedan en wrappers finos del shell; `stockDebitLinesFor` se pasa como callback (deriva de proyectos/catálogo vivos). Reset en logout (patrón F118 S2).
2. **runExport** (`apps/web/src/exports/runExport.ts`): flujo compartido (busy contador + issues inline + deliver + stamp + toasts + guard de excepciones). Los 14 handlers pasaron de ~50 L copy-paste a configuración delgada (~20 L c/u). `guardExport` eliminado (absorbido).
3. **Derivación pura + muertos**: `buildStockCatalog` en `apps/web/src/derivations/stockCatalog.ts`; removidos memo `repository`, `optionalNotes`, props duplicados de export en EngineeringWorkspace; `ProductionManagerDashboard` con ScreenBoundary.
4. **Deep-links**: `finishes` ahora consume `/finishes/:id` (useRoutableEntitySelection en AmbientMaterialsCatalog) y `addOns` agregado a ENTITY_SECTIONS + cableado (AgregadosScreen ya lo soportaba).

## Scope final honesto

- App.tsx: 4101 → **3622 L** (meta <800 postergada a **F120**: split de render por área + módulo completo de derivaciones).
- `confirmFabricBatch` modal: diferido a F120 (requiere reestructurar flujo síncrono en FabricScreen, packages/ui).

## Resultados de Verificación

- `pnpm test`: domain 660 · storage 125 · excel 72 · ui 1124 · web 285 · mobile 36 · desktop 17 — **todos verdes**.
- `pnpm typecheck`: 0 errores. `./init.sh`: 100% verde.

## Próximos pasos

F120 (shell_slim_phase2) → luego próximos JD: Cotizaciones/Proyectos, Producción, Proyectar 3D.
