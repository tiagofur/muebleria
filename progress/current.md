# Sesión actual

- **Branch:** `feat/project-material-summary-97`
- **Issue:** [#97](https://github.com/tiagofur/muebleria/issues/97) — F047 resumen m² / herrajes
- **Estado:** implementado — conflictos con main resueltos (unión F046+F047)
- **PR:** https://github.com/tiagofur/muebleria/pull/114
- **PR anterior mergeado:** https://github.com/tiagofur/muebleria/pull/113 (F046 / #96)

## Entregado F047

- Domain: `generateProjectMaterialSummary` (m² por material, ML cantos, herrajes)
- UI: panel “Resumen de materiales” en detalle (costos solo si `showCosts`)
- Shell: calcula con domain cuando el preview no está bloqueado
- Tests domain + UI

## Ya en main (F046)

1. Domain: `PieceLabel`, `formatEdgeBandingInstruction`, `generatePieceLabels`
2. PDF: `pieceLabelsPdfExport` + botón **Etiquetas**
3. Merge conflict resolution kept both F046 and F047 surfaces

## Siguiente

- H03 / #98 cut-list enrich (PR #115) — rebasar después de mergear #114
