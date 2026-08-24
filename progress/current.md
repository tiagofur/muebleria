# Sesión

**Feature en curso:** F157 — prod_views_multi_space_scope (issue #256)
**Inicio:** 2026-08-24
**Rama:** `fix/256-prod-views-multi-space` (desde origin/main post-PR #359)

## Plan

- Bug QA #256: con OP accepted y 2+ ambientes, planta muestra sólo el activo y
  el 3D mezcla muros del activo + cola lineal de los otros espacios
  (`resolveProject3DPreview` lee layout top-level = espejo del espacio activo,
  pero `project.items` trae toda la obra).
- Fix en `ProductionOrderViewsPanel`: con multi-ambiente (scope "Toda la obra"),
  tabs de ambiente del panel controlan planta (`PresentationKitchenPlanSlide`
  controlada) y 3D per-espacio vía `projectScopedToProductionSpace` (dominio
  existente, UI no calcula dominio).
- Ítems sin colocar en ninguna planta → hint explícito con
  `unplacedItemIdsForProduction`, no cola fantasma.
- Elevaciones fuera de scope (QA las dio por aceptables por ambiente/prefijos).
- Tests jsdom del panel con 2 ambientes + suite + typecheck.

## Estado

- [x] Investigación: wiring hub→panel, patrón tabs controladas
      (`ProjectPresentationMode`), helpers de dominio disponibles.
- [ ] Implementación.
- [ ] Tests.
- [ ] Review.
