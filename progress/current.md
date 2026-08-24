# Sesión

**Features cerradas:** F157 — prod_views_multi_space_scope (issue #256)
**Inicio:** 2026-08-24 · **Cierre:** 2026-08-24
**Reviews:** `progress/review_F157.md` (APPROVED)
**Rama:** `fix/256-prod-views-multi-space` (pusheada, PR abierto)

## F157 — Resultado

Bug QA #256 (padre #251): con OP accepted y 2+ ambientes, la planta quedaba
sin control de ambiente a nivel panel y el 3D mezclaba los muros del espacio
activo con una cola lineal fantasma de los otros ambientes —
`resolveProject3DPreview` lee el `kitchenLayout` top-level (espejo del espacio
activo vía `flattenActiveSpace`) mientras `project.items` trae toda la obra.

Fix en `ProductionOrderViewsPanel`:

- Con multi-ambiente (scope "Toda la obra"), el panel toma ownership de tabs
  de ambiente (patrón `ProjectPresentationMode`): controlan la planta
  (`PresentationKitchenPlanSlide` controlada, sin tabs locales) y resuelven el
  3D per-espacio vía `projectScopedToProductionSpace` (dominio, PROD-4.4).
- Nunca se mezclan muros/placements de ambientes distintos ni se inventa cola
  lineal de otros espacios; la isla free viaja en su espacio.
- Ítems sin colocar en NINGUNA planta: hint explícito con conteo
  (`unplacedItemIdsForProduction`) en la sección 3D, no cola fantasma.
- Hint de corrida ahora nombra el ambiente ("Según plano de Cocina (2
  colocadas)"); mono-ambiente sin tabs y con copy previo intacto.
- Elevaciones fuera de scope (QA #256: aceptables por ambiente/prefijos).
- UI no calcula dominio: todo el scoping delega en `productionScope.ts`.

## Verificación (evidencia)

- `pnpm test` 3.057 verdes (ui 1.410: 2 tests nuevos de panel con 2 ambientes
  — scoping por espacio, ausencia de cola lineal/hint, isla free, unplaced,
  cambio de tab, wiring tabpanel); `pnpm typecheck` 0 errores.
- Gate §8: delta visual limitado a `WorkspaceTabs` compartido (F109);
  justificación de responsive/screenshot en `progress/review_F157.md`
  (sin seed multi-ambiente para smoke browser; re-verificación vía QA #251).

## Siguientes pasos

- #255 (islas en planta/elevación dedicada) es el follow-up natural de #256
  (mismos archivos del hub Vistas).
