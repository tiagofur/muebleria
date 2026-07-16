# Sesión actual

- **Branch:** `feat/optimizer-cutlist-enrich-98`
- **Issue:** [#98](https://github.com/tiagofur/muebleria/issues/98) — F048 cut-list enriquecida
- **Estado:** rebased onto main (post #113 F046 + #114 F047) — conflictos resueltos
- **PR:** https://github.com/tiagofur/muebleria/pull/115

## Contexto merge

Main ya tiene:
- **F046** etiquetas PDF + `generatePieceLabels` / `formatEdgeBandingInstruction`
- **F047** resumen m²/herrajes + `generateProjectMaterialSummary`

Este PR añade **F048** sin pisar lo anterior:
- `formatOptimizerPartDescription` + metadata en `ProductionCutRow`
- Description enriquecida en cut-list; hoja **Referencias**
- Paridad Go

## Entregado F048

- Description Optimizer: `CÓDIGO · Pieza · MÓDULO`
- Metadata: partName, partCode, moduleCode, labelRef
- Sheet **Referencias** (taller) sin tocar columnas A–J
- feature_list: F046 + F047 + F048 done
